/**
 * Generate OneCAD/BIM PWA icons from official logo (canvas toDataURL).
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const logoPath = join(root, 'scripts', '.tmp-icons', 'onecad-logo.png')
const logoDataUrl = `data:image/png;base64,${readFileSync(logoPath).toString('base64')}`

async function renderIcon(page, size, opts = {}) {
  const { badge = false, pad = 0.16 } = opts
  const dataUrl = await page.evaluate(async ({ size, pad, badge, logoDataUrl }) => {
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const ctx = c.getContext('2d')

    const g = ctx.createLinearGradient(0, 0, size, size)
    g.addColorStop(0, '#00A651')
    g.addColorStop(1, '#006e36')
    ctx.fillStyle = g
    const r = size * 0.18
    ctx.beginPath()
    ctx.moveTo(r, 0)
    ctx.arcTo(size, 0, size, size, r)
    ctx.arcTo(size, size, 0, size, r)
    ctx.arcTo(0, size, 0, 0, r)
    ctx.arcTo(0, 0, size, 0, r)
    ctx.closePath()
    ctx.fill()

    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = logoDataUrl
    })

    const inset = size * pad
    const box = size - inset * 2
    const labelH = badge ? 0 : size * 0.14
    const availH = box - labelH
    const scale = Math.min(box / img.width, availH / img.height)
    const w = img.width * scale
    const h = img.height * scale
    const x = (size - w) / 2
    const y = inset + (availH - h) / 2

    const platePad = size * 0.045
    const pr = size * 0.08
    const px = x - platePad
    const py = y - platePad
    const pw = w + platePad * 2
    const ph = h + platePad * 2
    ctx.fillStyle = 'rgba(255,255,255,0.97)'
    ctx.beginPath()
    ctx.moveTo(px + pr, py)
    ctx.arcTo(px + pw, py, px + pw, py + ph, pr)
    ctx.arcTo(px + pw, py + ph, px, py + ph, pr)
    ctx.arcTo(px, py + ph, px, py, pr)
    ctx.arcTo(px, py, px + pw, py, pr)
    ctx.closePath()
    ctx.fill()
    ctx.drawImage(img, x, y, w, h)

    if (!badge) {
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${Math.round(size * 0.09)}px system-ui,Segoe UI,sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('BIM', size / 2, size - inset * 0.55)
    }

    return c.toDataURL('image/png')
  }, { size, pad, badge, logoDataUrl })

  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  return Buffer.from(b64, 'base64')
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.setContent('<!DOCTYPE html><html><body></body></html>')
try {
  const jobs = [
    ['public/icon-192.png', 192, { pad: 0.16 }],
    ['public/icon-512.png', 512, { pad: 0.16 }],
    ['public/badge-72.png', 72, { badge: true, pad: 0.1 }],
  ]
  for (const [rel, size, opts] of jobs) {
    const buf = await renderIcon(page, size, opts)
    writeFileSync(join(root, rel), buf)
    const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16)
    console.log(`Wrote ${rel} bytes=${buf.length} sha16=${sha}`)
  }
} finally {
  await browser.close()
}
