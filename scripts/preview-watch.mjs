/**
 * Local pre-deploy watch: rebuild dist on src/public change, wrangler --live-reload.
 * D1 stays --local only (never --remote).
 */
import { spawn } from 'node:child_process'
import { watch, existsSync, readFileSync, cpSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const port = process.env.PORT || '8788'

const copies = [
  ['public/static', 'dist/static'],
  ['public/index.html', 'dist/index.html'],
  ['public/preview.html', 'dist/preview.html'],
  ['public/sw.js', 'dist/sw.js'],
  ['public/manifest.webmanifest', 'dist/manifest.webmanifest'],
  ['public/icon-192.png', 'dist/icon-192.png'],
  ['public/icon-512.png', 'dist/icon-512.png'],
  ['public/badge-72.png', 'dist/badge-72.png'],
  ['public/brand', 'dist/brand'],
]

function copyPublic() {
  for (const [src, dest] of copies) {
    const from = join(root, src)
    const to = join(root, dest)
    if (!existsSync(from)) continue
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to, { recursive: true })
  }
  console.log('[preview:watch] copied public → dist')
}

function run(cmd, args) {
  return spawn(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })
}

function runNpm(args) {
  return new Promise((resolve, reject) => {
    const p = run(npmCmd, args)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exit ${code}`))))
  })
}

async function main() {
  console.log('[preview:watch] initial build…')
  await runNpm(['run', 'build'])

  console.log('[preview:watch] migrate local D1…')
  try {
    await runNpm(['run', 'db:migrate:local'])
  } catch {
    console.warn('[preview:watch] migrate skipped/failed — continuing')
  }

  console.log('[preview:watch] vite build --watch')
  const vite = run(npxCmd, ['vite', 'build', '--watch'])

  let copyTimer = null
  const scheduleCopy = () => {
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      try { copyPublic() } catch (e) { console.error(e) }
    }, 200)
  }
  try {
    watch(join(root, 'public'), { recursive: true }, scheduleCopy)
    console.log('[preview:watch] watching public/')
  } catch (e) {
    console.warn('[preview:watch] public watch unavailable:', e.message)
  }

  const workerPath = join(root, 'dist', '_worker.js')
  let lastHash = ''
  setInterval(() => {
    try {
      if (!existsSync(workerPath)) return
      const h = createHash('sha1').update(readFileSync(workerPath)).digest('hex').slice(0, 12)
      if (h !== lastHash) {
        const first = !lastHash
        lastHash = h
        if (!first) {
          copyPublic()
          console.log(`[preview:watch] worker rebuilt (${h}) — browser will live-reload`)
        }
      }
    } catch { /* ignore */ }
  }, 1000)

  console.log(`[preview:watch] http://127.0.0.1:${port}  (D1 local + live-reload)`)
  const wrangler = run(npxCmd, [
    'wrangler', 'pages', 'dev', 'dist',
    '--d1=bim-management-production',
    '--local',
    '--live-reload',
    `--port=${port}`,
    // Local-only auth secret (also in .dev.vars). Never use --remote with this.
    '--binding', 'JWT_SECRET=local-preview-jwt-secret-bim-pm-2026',
    '--binding', 'ALLOW_PREVIEW=1',
  ])

  const shutdown = () => {
    vite.kill()
    wrangler.kill()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  wrangler.on('exit', (code) => {
    vite.kill()
    process.exit(code ?? 0)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
