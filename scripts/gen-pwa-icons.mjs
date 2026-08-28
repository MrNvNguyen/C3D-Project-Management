/**
 * Generate PWA install icons only (mobile Add to Home Screen / favicon).
 * UI sidebar/login logo is unchanged — uses onecadvn.com wordmark in index.html.
 *
 * Source: public/brand/onecad-icon-source.jpg (preferred) or .png; fallback crop from onecad-mark.png
 * Usage: node scripts/gen-pwa-icons.mjs
 */
import sharp from 'sharp'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const brandDir = join(root, 'public', 'brand')
mkdirSync(brandDir, { recursive: true })

const sourceCandidates = [
  join(brandDir, 'onecad-icon-source.jpg'),
  join(brandDir, 'onecad-icon-source.png'),
]
const wordmarkPath = join(brandDir, 'onecad-mark.png')
const markOut = join(brandDir, 'onecad-icon.png')

async function loadSquareMark() {
  const sourceIcon = sourceCandidates.find((p) => existsSync(p))
  if (sourceIcon) {
    console.log('Using icon source:', sourceIcon)
    return sharp(readFileSync(sourceIcon)).ensureAlpha().png().toBuffer()
  }

  if (!existsSync(wordmarkPath)) {
    throw new Error('Missing brand art. Add public/brand/onecad-icon-source.jpg or onecad-mark.png')
  }

  console.log('Cropping mark from wordmark:', wordmarkPath)
  const raw = readFileSync(wordmarkPath)
  const meta = await sharp(raw).rotate().metadata()
  const cropW = Math.min(Math.round(meta.width * 0.34), meta.width)
  return sharp(raw)
    .rotate()
    .resize(cropW, meta.height, { fit: 'cover', position: 'left' })
    .trim({ threshold: 12 })
    .ensureAlpha()
    .png()
    .toBuffer()
}

const markBuf = await loadSquareMark()
writeFileSync(markOut, markBuf)
console.log('Wrote', markOut, 'bytes=', markBuf.length)

async function composeIcon(size, { pad = 0.14 } = {}) {
  const inset = Math.round(size * pad)
  const inner = size - inset * 2
  const logo = await sharp(markBuf)
    .resize(inner, inner, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer()
  const logoMeta = await sharp(logo).metadata()
  const lx = Math.round((size - logoMeta.width) / 2)
  const ly = Math.round((size - logoMeta.height) / 2)

  const radius = Math.round(size * 0.2)
  const bg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${radius}" fill="#ffffff"/>
    </svg>`
  )

  return sharp(bg).composite([{ input: logo, left: lx, top: ly }]).png().toBuffer()
}

const jobs = [
  ['public/icon-192.png', () => composeIcon(192)],
  ['public/icon-512.png', () => composeIcon(512)],
  ['public/badge-72.png', () => composeIcon(72, { pad: 0.1 })],
]

for (const [rel, fn] of jobs) {
  const buf = await fn()
  const dest = join(root, rel)
  writeFileSync(dest, buf)
  const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16)
  console.log(`Wrote ${rel} bytes=${buf.length} sha16=${sha}`)
}
