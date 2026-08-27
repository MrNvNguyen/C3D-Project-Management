/**
 * Wave 3 shell smoke: legal tabs scroll, chat/gantt CSS, desktop heights preserved.
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
  const browser = await chromium.launch({ headless: true })
  try {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await phone.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await revealShell(phone)
    await phone.evaluate(() => {
      const legal = document.getElementById('page-legal')
      if (legal) { legal.classList.add('active'); legal.style.display = 'block' }
      const tabs = document.getElementById('legalTabs')
      if (tabs) tabs.style.display = 'flex'
      const gantt = document.getElementById('page-gantt')
      if (gantt) { gantt.classList.add('active'); gantt.style.display = 'block' }
      const gc = document.getElementById('ganttContainer')
      if (gc) {
        gc.innerHTML = `
          <div class="gantt-hint">hint</div>
          <div class="gantt-scroll overflow-x-auto">
            <div class="gantt-row flex items-center gap-3">
              <div class="gantt-label">Task A</div>
              <div style="min-width:400px;height:20px;background:#ccc"></div>
            </div>
          </div>`
      }
      const chat = document.createElement('div')
      chat.className = 'chat-project-panel'
      chat.id = 'w3ChatFixture'
      document.body.appendChild(chat)
    })

    const phoneM = await phone.evaluate(() => {
      const tabs = document.getElementById('legalTabs')
      const label = document.querySelector('.gantt-label')
      const hint = document.querySelector('.gantt-hint')
      const chat = document.getElementById('w3ChatFixture')
      const tabOverflow = tabs ? getComputedStyle(tabs).overflowX : null
      const tabWrap = tabs ? getComputedStyle(tabs).flexWrap : null
      const labelPos = label ? getComputedStyle(label).position : null
      const hintDisp = hint ? getComputedStyle(hint).display : null
      const chatH = chat ? getComputedStyle(chat).height : null
      const btnCount = tabs ? tabs.querySelectorAll('.tab-btn').length : 0
      const scrollW = tabs ? tabs.scrollWidth : 0
      const clientW = tabs ? tabs.clientWidth : 0
      return { tabOverflow, tabWrap, labelPos, hintDisp, chatH, btnCount, scrollW, clientW }
    })
    note(phoneM.tabOverflow === 'auto' || phoneM.tabOverflow === 'scroll', 'phone: legal tabs overflow-x', { detail: phoneM.tabOverflow })
    note(phoneM.tabWrap === 'nowrap', 'phone: legal tabs nowrap', { detail: phoneM.tabWrap })
    note(phoneM.btnCount === 6, 'phone: 6 legal tabs present', { detail: String(phoneM.btnCount) })
    note(phoneM.scrollW >= phoneM.clientW, 'phone: legal tabs can scroll if needed', { detail: `${phoneM.scrollW}/${phoneM.clientW}` })
    note(phoneM.labelPos === 'sticky', 'phone: gantt label sticky', { detail: phoneM.labelPos })
    note(phoneM.hintDisp === 'block', 'phone: gantt swipe hint visible', { detail: phoneM.hintDisp })
    note(!!phoneM.chatH && phoneM.chatH !== '520px', 'phone: chat panel uses dvh (not fixed 520)', { detail: phoneM.chatH })

    const phoneShot = join(outDir, 'wave3-phone-390.png')
    await phone.screenshot({ path: phoneShot, fullPage: false })

    const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await desk.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await revealShell(desk)
    await desk.evaluate(() => {
      const gantt = document.getElementById('page-gantt')
      if (gantt) { gantt.classList.add('active'); gantt.style.display = 'block' }
      const gc = document.getElementById('ganttContainer')
      if (gc) {
        gc.innerHTML = `
          <div class="gantt-hint">hint</div>
          <div class="gantt-scroll"><div class="gantt-row"><div class="gantt-label">Task</div></div></div>`
      }
      const chat = document.createElement('div')
      chat.className = 'chat-project-panel'
      chat.id = 'w3ChatDesk'
      document.body.appendChild(chat)
      // Fixture work-summary min-width 980
      const wrap = document.createElement('div')
      wrap.id = 'wsSummaryTable_test'
      wrap.innerHTML = '<table style="min-width:980px"><tr><th>Name</th><th>X</th></tr></table>'
      document.body.appendChild(wrap)
    })

    const deskM = await desk.evaluate(() => {
      const hint = document.querySelector('.gantt-hint')
      const label = document.querySelector('.gantt-label')
      const chat = document.getElementById('w3ChatDesk')
      const table = document.querySelector('#wsSummaryTable_test table')
      return {
        hintDisp: hint ? getComputedStyle(hint).display : null,
        labelPos: label ? getComputedStyle(label).position : null,
        chatH: chat ? getComputedStyle(chat).height : null,
        tableMin: table ? getComputedStyle(table).minWidth : null,
        sidebar: Math.round(document.getElementById('sidebar').getBoundingClientRect().width),
        bottomNav: getComputedStyle(document.getElementById('mobileBottomNav')).display,
        chatCss500: getComputedStyle(document.querySelector('.chat-wrap') || document.createElement('div')).height,
      }
    })
    // Inject a .chat-wrap to measure desktop height from stylesheet
    const deskChatWrap = await desk.evaluate(() => {
      const el = document.createElement('div')
      el.className = 'chat-wrap'
      document.body.appendChild(el)
      return getComputedStyle(el).height
    })
    note(deskM.hintDisp === 'none', 'desktop: gantt hint hidden', { detail: deskM.hintDisp })
    note(deskM.labelPos === 'static', 'desktop: gantt label not sticky', { detail: deskM.labelPos })
    note(deskM.chatH === '520px', 'desktop: project chat panel 520px', { detail: deskM.chatH })
    note(deskChatWrap === '500px', 'desktop: .chat-wrap height 500px', { detail: deskChatWrap })
    note(deskM.tableMin === '980px', 'desktop: work-summary min-width 980 preserved', { detail: deskM.tableMin })
    note(deskM.sidebar === 260, 'desktop sidebar 260')
    note(deskM.bottomNav === 'none', 'desktop no bottom nav')

    const deskShot = join(outDir, 'wave3-desktop-1280.png')
    await desk.screenshot({ path: deskShot, fullPage: false })

    for (const name of ['wave3-phone-390.png', 'wave3-desktop-1280.png']) {
      const buf = readFileSync(join(outDir, name))
      note(true, `screenshot ${name}`, { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
    }
  } finally {
    await browser.close()
  }

  const failed = results.filter((r) => !r.ok)
  const summary = { scope: 'engineering_smoke_wave3_legal_chat_gantt', base, passed: results.filter((r) => r.ok).length, failed: failed.length, results }
  writeFileSync(join(outDir, 'wave3-smoke-results.json'), JSON.stringify(summary, null, 2))
  console.log(`\nSummary: ${summary.passed} passed, ${summary.failed} failed`)
  process.exit(failed.length ? 1 : 0)
}

await main()
