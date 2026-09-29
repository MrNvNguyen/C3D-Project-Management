import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PORT = 8794
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

function waitPort(ms = 60000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const s = createConnection({ port: PORT, host: '127.0.0.1' })
      s.on('connect', () => {
        s.end()
        resolve(true)
      })
      s.on('error', () => {
        s.destroy()
        if (Date.now() - start > ms) reject(new Error('port timeout'))
        else setTimeout(tick, 800)
      })
    }
    tick()
  })
}

const child = spawn(process.execPath, [
  WRANGLER,
  'pages',
  'dev',
  'dist',
  '--d1=bim-management-production',
  '--local',
  `--port=${PORT}`,
  '--binding',
  'JWT_SECRET=local-preview-jwt-secret-bim-pm-2026',
  '--binding',
  'ALLOW_PREVIEW=1',
], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

child.stdout?.on('data', (d) => process.stderr.write(d))
child.stderr?.on('data', (d) => process.stderr.write(d))

await waitPort()
const qa = spawn(
  process.execPath,
  [join(dirname(fileURLToPath(import.meta.url)), 'wave-h-hspl-input-methods-qa-attempt3-browser.mjs'), `http://127.0.0.1:${PORT}`],
  { cwd: ROOT, stdio: 'inherit', windowsHide: true }
)
const code = await new Promise((r) => qa.on('close', r))
child.kill('SIGTERM')
process.exit(code ?? 1)
