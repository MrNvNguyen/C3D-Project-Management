/**
 * Wave 1 shell smoke: coarse-pointer reveal + phone modal/notif + desktop hover intact.
 * Scope: engineering smoke ≠ logged-in product PASS.
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
    const login = document.getElementById('loginPage')
    const app = document.getElementById('mainApp')
    if (login) login.style.display = 'none'
    if (app) app.style.display = 'block'
  })
}

async function setPointer(page, value) {
  const client = await page.context().newCDPSession(page)
  // Only emulate pointer — do NOT set hover media (breaks CSS :hover cascade in Chromium)
  await client.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value },
      { name: 'any-pointer', value },
    ],
  })
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  try {
    // Phone + coarse pointer media
    const phone = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    })
    await phone.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await setPointer(phone, 'coarse')
    await revealShell(phone)

    // Inject fixture elements for hover-reveal + modal checks
    await phone.evaluate(() => {
      const host = document.createElement('div')
      host.id = 'w1Fixture'
      host.innerHTML = `
        <div class="group" id="w1Group">
          <button class="opacity-0 group-hover:opacity-100" id="w1HoverBtn">edit</button>
        </div>
        <button class="msg-delete-btn" id="w1DelBtn">del</button>
        <div class="st-actions" id="w1St" style="opacity:0">act</div>
      `
      document.body.appendChild(host)
      const bulk = document.getElementById('tsBulkModal')
      if (bulk) {
        bulk.style.display = 'flex'
        const modal = bulk.querySelector('.modal')
        if (modal) modal.classList.add('modal-wide')
      }
      const notif = document.getElementById('notifDropdown')
      if (notif) notif.style.display = 'block'
    })

    const phoneMetrics = await phone.evaluate(() => {
      const btn = document.getElementById('w1HoverBtn')
      const del = document.getElementById('w1DelBtn')
      const st = document.getElementById('w1St')
      const bulkModal = document.querySelector('#tsBulkModal .modal')
      const notif = document.getElementById('notifDropdown')
      const br = bulkModal ? bulkModal.getBoundingClientRect() : null
      const nr = notif ? notif.getBoundingClientRect() : null
      return {
        hoverOpacity: btn ? getComputedStyle(btn).opacity : null,
        delOpacity: del ? getComputedStyle(del).opacity : null,
        stOpacity: st ? getComputedStyle(st).opacity : null,
        delMinH: del ? parseFloat(getComputedStyle(del).minHeight) : null,
        bulkWidth: br ? Math.round(br.width) : null,
        bulkMinWidth: bulkModal ? getComputedStyle(bulkModal).minWidth : null,
        notifWidth: nr ? Math.round(nr.width) : null,
        notifLeft: nr ? Math.round(nr.left) : null,
      }
    })

    note(phoneMetrics.hoverOpacity === '1', 'phone coarse: group-hover action visible', { detail: phoneMetrics.hoverOpacity })
    note(phoneMetrics.delOpacity === '1', 'phone coarse: chat delete visible', { detail: phoneMetrics.delOpacity })
    note(phoneMetrics.stOpacity === '1', 'phone coarse: st-actions visible', { detail: phoneMetrics.stOpacity })
    note(phoneMetrics.delMinH >= 44, 'phone: delete hit ≥44px', { detail: String(phoneMetrics.delMinH) })
    note(phoneMetrics.bulkWidth <= 390 && phoneMetrics.bulkWidth >= 350, 'phone: tsBulkModal fits ≤390', { detail: String(phoneMetrics.bulkWidth) })
    note(phoneMetrics.bulkMinWidth === '0px' || phoneMetrics.bulkMinWidth === 'auto', 'phone: modal min-width cleared', { detail: phoneMetrics.bulkMinWidth })
    note(phoneMetrics.notifWidth >= 380 && phoneMetrics.notifLeft <= 2, 'phone: notif sheet full-width', { detail: `w=${phoneMetrics.notifWidth} left=${phoneMetrics.notifLeft}` })

    const phoneShot = join(outDir, 'wave1-phone-390.png')
    await phone.screenshot({ path: phoneShot, fullPage: false })

    // Desktop fine pointer — hover-only stays hidden until hover
    const desk = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      hasTouch: false,
    })
    await desk.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await setPointer(desk, 'fine')
    await revealShell(desk)
    await desk.evaluate(() => {
      const host = document.createElement('div')
      host.innerHTML = `
        <div class="group chat-bubble" id="w1GroupD" style="padding:20px">
          <button class="opacity-0 group-hover:opacity-100" id="w1HoverBtnD">edit</button>
          <button class="msg-delete-btn" id="w1DelBtnD">del</button>
        </div>
      `
      document.body.appendChild(host)
      const bulk = document.getElementById('tsBulkModal')
      if (bulk) bulk.style.display = 'flex'
    })

    const deskIdle = await desk.evaluate(() => {
      const btn = document.getElementById('w1HoverBtnD')
      const del = document.getElementById('w1DelBtnD')
      const bulk = document.querySelector('#tsBulkModal .modal')
      return {
        hoverOpacity: btn ? getComputedStyle(btn).opacity : null,
        delOpacity: del ? getComputedStyle(del).opacity : null,
        bulkMinWidth: bulk ? getComputedStyle(bulk).minWidth : null,
        sidebarW: Math.round(document.getElementById('sidebar').getBoundingClientRect().width),
        navDisplay: getComputedStyle(document.getElementById('mobileBottomNav')).display,
      }
    })
    note(deskIdle.hoverOpacity === '0', 'desktop: group-hover action hidden until hover', { detail: deskIdle.hoverOpacity })
    note(deskIdle.delOpacity === '0', 'desktop: chat delete hidden until hover', { detail: deskIdle.delOpacity })
    note(deskIdle.bulkMinWidth === '560px', 'desktop: modal-wide min-width 560', { detail: deskIdle.bulkMinWidth })
    note(deskIdle.sidebarW === 260, 'desktop sidebar 260', { detail: String(deskIdle.sidebarW) })
    note(deskIdle.navDisplay === 'none', 'desktop no bottom nav', { detail: deskIdle.navDisplay })

    // Close modal overlay so hover can reach fixture
    await desk.evaluate(() => {
      const bulk = document.getElementById('tsBulkModal')
      if (bulk) bulk.style.display = 'none'
    })
    await desk.hover('#w1GroupD')
    await desk.waitForTimeout(200)
    const deskHover = await desk.evaluate(() => {
      const btn = document.getElementById('w1HoverBtnD')
      const del = document.getElementById('w1DelBtnD')
      return {
        hoverOpacity: btn ? getComputedStyle(btn).opacity : null,
        delOpacity: del ? getComputedStyle(del).opacity : null,
      }
    })
    note(deskHover.hoverOpacity === '1', 'desktop: hover reveals group action', { detail: deskHover.hoverOpacity })
    note(deskHover.delOpacity === '1', 'desktop: hover reveals chat delete', { detail: deskHover.delOpacity })

    const deskShot = join(outDir, 'wave1-desktop-1280.png')
    await desk.screenshot({ path: deskShot, fullPage: false })

    for (const name of ['wave1-phone-390.png', 'wave1-desktop-1280.png']) {
      const buf = readFileSync(join(outDir, name))
      note(true, `screenshot ${name}`, { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
    }
  } finally {
    await browser.close()
  }

  const failed = results.filter((r) => !r.ok)
  const summary = { scope: 'engineering_smoke_wave1_touch', base, passed: results.filter((r) => r.ok).length, failed: failed.length, results }
  writeFileSync(join(outDir, 'wave1-smoke-results.json'), JSON.stringify(summary, null, 2))
  console.log(`\nSummary: ${summary.passed} passed, ${summary.failed} failed`)
  process.exit(failed.length ? 1 : 0)
}

await main()
