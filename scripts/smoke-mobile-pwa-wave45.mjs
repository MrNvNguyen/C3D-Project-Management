/**
 * Wave 4+5 combined shell smoke (engineering). Auto-pass arc close.
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

async function revealShell(page) {
  await page.evaluate(() => {
    document.getElementById('loginPage').style.display = 'none'
    document.getElementById('mainApp').style.display = 'block'
  })
}

async function main() {
  // Static SW check
  const sw = await (await fetch(`${base}/sw.js`)).text()
  note(sw.includes("CACHE_NAME = 'bim-sw-v3'"), 'SW CACHE_NAME bim-sw-v3')
  note(sw.includes("skipWaiting"), 'SW skipWaiting present')
  note(sw.includes('/api/') && sw.includes('return'), 'SW still bypasses /api/*')

  const browser = await chromium.launch({ headless: true })
  try {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await phone.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await revealShell(phone)
    await phone.evaluate(() => {
      localStorage.removeItem('bim_pwa_install_dismissed')
      const execPage = document.getElementById('page-executive-dashboard')
      if (execPage) { execPage.classList.add('active'); execPage.style.display = 'block' }
      const layout = document.getElementById('exec-main-layout')
      if (layout) {
        layout.innerHTML = `<div class="exec-layout-row" style="display:flex;gap:12px">
          <div class="exec-left-col" style="width:280px;flex-shrink:0"><div id="exec-left-list">L</div></div>
          <div class="exec-right-col" style="flex:1"><div id="exec-right-panel">R</div></div>
        </div>`
      }
      const fin = document.getElementById('page-finance-project')
      if (fin) { fin.classList.add('active'); fin.style.display = 'block' }
      const users = document.getElementById('page-users')
      if (users) { users.classList.add('active'); users.style.display = 'block' }
      const cards = document.getElementById('usersCardList')
      if (cards) cards.innerHTML = '<div class="mobile-list-card"><div class="mlc-title">User</div></div>'
      if (typeof showPwaInstallBanner === 'function') showPwaInstallBanner('android')
    })

    const phoneM = await phone.evaluate(() => {
      const row = document.querySelector('.exec-layout-row')
      const left = document.querySelector('.exec-left-col')
      const sheet = document.getElementById('finFilterSheet')
      const toggle = document.getElementById('finFilterSheetToggle')
      const cards = document.getElementById('usersCardList')
      const desk = document.querySelector('#panelUserList .desk-only-table')
      const banner = document.getElementById('pwaInstallBanner')
      return {
        flexDir: row ? getComputedStyle(row).flexDirection : null,
        leftW: left ? Math.round(left.getBoundingClientRect().width) : null,
        sheetDisplay: sheet ? getComputedStyle(sheet).display : null,
        toggleDisplay: toggle ? getComputedStyle(toggle).display : null,
        cardsDisplay: cards ? getComputedStyle(cards).display : null,
        deskDisplay: desk ? getComputedStyle(desk).display : null,
        bannerVisible: banner ? banner.classList.contains('pwa-banner-visible') : false,
        bannerDisplay: banner ? getComputedStyle(banner).display : null,
      }
    })
    note(phoneM.flexDir === 'column', 'phone: exec layout stacks', { detail: phoneM.flexDir })
    note(phoneM.leftW >= 300, 'phone: exec left col full width', { detail: String(phoneM.leftW) })
    note(phoneM.sheetDisplay === 'block', 'phone: finance filter sheet visible', { detail: phoneM.sheetDisplay })
    note(phoneM.toggleDisplay === 'flex', 'phone: finance filter toggle visible', { detail: phoneM.toggleDisplay })
    note(phoneM.cardsDisplay === 'block', 'phone: users cards visible', { detail: phoneM.cardsDisplay })
    note(phoneM.deskDisplay === 'none', 'phone: users table hidden', { detail: phoneM.deskDisplay })
    note(phoneM.bannerVisible && phoneM.bannerDisplay === 'block', 'phone: install banner can show', {
      detail: `vis=${phoneM.bannerVisible} disp=${phoneM.bannerDisplay}`,
    })

    const phoneShot = join(outDir, 'wave45-phone-390.png')
    await phone.screenshot({ path: phoneShot, fullPage: false })

    const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await desk.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await revealShell(desk)
    await desk.evaluate(() => {
      const execPage = document.getElementById('page-executive-dashboard')
      if (execPage) { execPage.classList.add('active'); execPage.style.display = 'block' }
      const layout = document.getElementById('exec-main-layout')
      if (layout) {
        layout.innerHTML = `<div class="exec-layout-row" style="display:flex;gap:12px">
          <div class="exec-left-col" style="width:280px;flex-shrink:0">L</div>
          <div class="exec-right-col" style="flex:1">R</div>
        </div>`
      }
      const users = document.getElementById('page-users')
      if (users) { users.classList.add('active'); users.style.display = 'block' }
      const banner = document.getElementById('pwaInstallBanner')
      if (banner) banner.classList.add('pwa-banner-visible')
    })

    const deskM = await desk.evaluate(() => {
      const row = document.querySelector('.exec-layout-row')
      const left = document.querySelector('.exec-left-col')
      const cards = document.getElementById('usersCardList')
      const deskTbl = document.querySelector('#panelUserList .desk-only-table')
      const banner = document.getElementById('pwaInstallBanner')
      const toggle = document.getElementById('finFilterSheetToggle')
      return {
        flexDir: row ? getComputedStyle(row).flexDirection : null,
        leftW: left ? Math.round(left.getBoundingClientRect().width) : null,
        cardsDisplay: cards ? getComputedStyle(cards).display : null,
        deskDisplay: deskTbl ? getComputedStyle(deskTbl).display : null,
        bannerDisplay: banner ? getComputedStyle(banner).display : null,
        toggleDisplay: toggle ? getComputedStyle(toggle).display : null,
        sidebar: Math.round(document.getElementById('sidebar').getBoundingClientRect().width),
        bottomNav: getComputedStyle(document.getElementById('mobileBottomNav')).display,
      }
    })
    note(deskM.flexDir === 'row', 'desktop: exec layout row', { detail: deskM.flexDir })
    note(deskM.leftW === 280, 'desktop: exec left 280px', { detail: String(deskM.leftW) })
    note(deskM.cardsDisplay === 'none', 'desktop: users cards hidden', { detail: deskM.cardsDisplay })
    note(deskM.deskDisplay !== 'none', 'desktop: users table visible', { detail: deskM.deskDisplay })
    note(deskM.bannerDisplay === 'none', 'desktop: install banner hidden', { detail: deskM.bannerDisplay })
    note(deskM.toggleDisplay === 'none', 'desktop: finance sheet toggle hidden', { detail: deskM.toggleDisplay })
    note(deskM.sidebar === 260, 'desktop sidebar 260')
    note(deskM.bottomNav === 'none', 'desktop no bottom nav')

    const deskShot = join(outDir, 'wave45-desktop-1280.png')
    await desk.screenshot({ path: deskShot, fullPage: false })

    for (const name of ['wave45-phone-390.png', 'wave45-desktop-1280.png']) {
      const buf = readFileSync(join(outDir, name))
      note(true, `screenshot ${name}`, { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
    }
  } finally {
    await browser.close()
  }

  const failed = results.filter((r) => !r.ok)
  const summary = {
    scope: 'engineering_smoke_wave4_wave5_arc_close',
    base,
    passed: results.filter((r) => r.ok).length,
    failed: failed.length,
    results,
  }
  writeFileSync(join(outDir, 'wave45-smoke-results.json'), JSON.stringify(summary, null, 2))
  console.log(`\nSummary: ${summary.passed} passed, ${summary.failed} failed`)
  process.exit(failed.length ? 1 : 0)
}

await main()
