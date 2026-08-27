/**
 * Wave 0 shell smoke (no login): dual viewport CSS + static PWA assets.
 * Scope: engineering smoke ≠ product PASS (needs logged-in role tabs).
 */
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.env.SMOKE_BASE || 'http://127.0.0.1:8788'
const outDir = join(root, 'docs', 'evidence', 'mobile-pwa')
mkdirSync(outDir, { recursive: true })

const results = []
function note(ok, msg, extra = {}) {
  results.push({ ok, msg, ...extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}${extra.detail ? ` — ${extra.detail}` : ''}`)
}

async function checkAssets() {
  for (const path of ['/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png', '/badge-72.png']) {
    const res = await fetch(`${base}${path}`)
    note(res.ok, `GET ${path}`, { status: res.status, contentType: res.headers.get('content-type') })
  }
  const sw = await (await fetch(`${base}/sw.js`)).text()
  note(sw.includes("CACHE_NAME = 'bim-sw-v2'"), 'SW CACHE_NAME bim-sw-v2')
  note(sw.includes('/api/') && sw.includes('return'), 'SW bypasses /api/*')
  note(!/PRECACHE\s*=\s*\[[^\]]*['"]\/['"]/.test(sw) && !sw.includes("'/static/app.js'"), 'SW does not precache index/app.js')
  const man = await (await fetch(`${base}/manifest.webmanifest`)).json()
  note(!!man.icons?.find((i) => i.sizes === '192x192'), 'manifest has 192 icon')
  note(!!man.icons?.find((i) => i.sizes === '512x512'), 'manifest has 512 icon')
  note(man.theme_color === '#00A651', 'manifest theme_color #00A651')
}

async function revealShell(page) {
  // mainApp is display:none until login — show for CSS layout smoke only
  await page.evaluate(() => {
    const login = document.getElementById('loginPage')
    const app = document.getElementById('mainApp')
    if (login) login.style.display = 'none'
    if (app) app.style.display = 'block'
  })
}

async function dualViewport() {
  const browser = await chromium.launch({ headless: true })
  try {
    // Phone
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await phone.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await revealShell(phone)
    const phoneShot = join(outDir, 'wave0-phone-390.png')
    await phone.screenshot({ path: phoneShot, fullPage: false })
    const phoneMetrics = await phone.evaluate(() => {
      const nav = document.getElementById('mobileBottomNav')
      const scrim = document.getElementById('mobileNavScrim')
      const sidebar = document.getElementById('sidebar')
      const csNav = nav ? getComputedStyle(nav) : null
      const closedLeft = sidebar ? sidebar.getBoundingClientRect().left : null
      return {
        hasNav: !!nav,
        hasScrim: !!scrim,
        hasSidebar: !!sidebar,
        navDisplay: csNav?.display,
        closedLeft,
        manifestHref: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
        appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
        viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
      }
    })
    note(phoneMetrics.hasNav && phoneMetrics.hasScrim, 'phone DOM has bottom nav + scrim')
    note(phoneMetrics.navDisplay === 'flex', 'phone ≤767 bottom nav display:flex', { detail: phoneMetrics.navDisplay })
    note(phoneMetrics.manifestHref === '/manifest.webmanifest', 'manifest link present')
    note(phoneMetrics.appleIcon === '/icon-192.png', 'apple-touch-icon present')
    note(!/maximum-scale\s*=\s*1/.test(phoneMetrics.viewportMeta), 'viewport allows pinch (no maximum-scale=1)')
    note(typeof phoneMetrics.closedLeft === 'number' && phoneMetrics.closedLeft < -100, 'phone drawer closed off-canvas', { detail: String(phoneMetrics.closedLeft) })

    // Drawer open/close via class (shell CSS; role tabs need login)
    await phone.evaluate(() => {
      document.getElementById('sidebar')?.classList.add('mobile-open')
      document.getElementById('mobileNavScrim')?.classList.add('mobile-open')
    })
    await phone.waitForTimeout(350) // match CSS transform transition 0.25s
    const openState = await phone.evaluate(() => {
      const s = document.getElementById('sidebar')
      const scrim = document.getElementById('mobileNavScrim')
      const rect = s ? s.getBoundingClientRect() : null
      return {
        left: rect?.left,
        width: rect ? Math.round(rect.width) : null,
        scrimDisplay: scrim ? getComputedStyle(scrim).display : null,
      }
    })
    note(openState.scrimDisplay === 'block', 'scrim visible when mobile-open')
    note(openState.left !== undefined && openState.left >= -1 && openState.left < 5, 'drawer left ≈0 when mobile-open', { detail: String(openState.left) })
    note(openState.width === 260, 'drawer width 260 when open', { detail: String(openState.width) })
    const drawerShot = join(outDir, 'wave0-phone-drawer-open.png')
    await phone.screenshot({ path: drawerShot, fullPage: false })

    // Desktop
    const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await desk.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await revealShell(desk)
    const deskShot = join(outDir, 'wave0-desktop-1280.png')
    await desk.screenshot({ path: deskShot, fullPage: false })
    const deskMetrics = await desk.evaluate(() => {
      const nav = document.getElementById('mobileBottomNav')
      const sidebar = document.getElementById('sidebar')
      const main = document.getElementById('mainContent')
      return {
        navDisplay: nav ? getComputedStyle(nav).display : null,
        sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null,
        mainMargin: main ? getComputedStyle(main).marginLeft : null,
      }
    })
    note(deskMetrics.navDisplay === 'none', 'desktop ≥1280 bottom nav hidden', { detail: deskMetrics.navDisplay })
    note(deskMetrics.sidebarWidth === 260, 'desktop sidebar width 260px', { detail: String(deskMetrics.sidebarWidth) })
    note(deskMetrics.mainMargin === '260px', 'desktop main margin-left 260px', { detail: deskMetrics.mainMargin })

    // Asset hashes (pointer, not blobs in markdown)
    for (const name of ['wave0-phone-390.png', 'wave0-phone-drawer-open.png', 'wave0-desktop-1280.png']) {
      const buf = readFileSync(join(outDir, name))
      const sha = createHash('sha256').update(buf).digest('hex')
      note(true, `screenshot ${name}`, { bytes: buf.length, sha256: sha })
    }
  } finally {
    await browser.close()
  }
}

await checkAssets()
await dualViewport()
const failed = results.filter((r) => !r.ok)
const summary = {
  scope: 'engineering_smoke_shell_no_login',
  base,
  passed: results.filter((r) => r.ok).length,
  failed: failed.length,
  results,
}
writeFileSync(join(outDir, 'wave0-smoke-results.json'), JSON.stringify(summary, null, 2))
console.log(`\nSummary: ${summary.passed} passed, ${summary.failed} failed`)
process.exit(failed.length ? 1 : 0)
