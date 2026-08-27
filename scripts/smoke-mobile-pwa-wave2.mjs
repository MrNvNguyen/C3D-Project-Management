/**
 * Wave 2 shell smoke: phone card lists visible, desktop tables visible.
 * No login — inject fixture HTML into card/table containers.
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
      ;['tasksCardList', 'tsCardList', 'leaveCardList', 'recentTasksCardList'].forEach((id) => {
        const el = document.getElementById(id)
        if (el) el.innerHTML = '<div class="mobile-list-card"><div class="mlc-title">Fixture</div></div>'
      })
      ;['page-tasks', 'page-timesheet', 'page-leave', 'page-dashboard'].forEach((id) => {
        const p = document.getElementById(id)
        if (p) { p.classList.add('active'); p.style.display = 'block' }
      })
    })

    const phoneM = await phone.evaluate(() => {
      const cs = (sel) => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el).display : null
      }
      const rect = (id) => {
        const el = document.getElementById(id)
        return el ? Math.round(el.getBoundingClientRect().width) : 0
      }
      return {
        deskTable: cs('.desk-only-table'),
        phoneCards: cs('.phone-only-cards'),
        sticky: cs('#leaveStickyCta'),
        tasksW: rect('tasksCardList'),
        tsW: rect('tsCardList'),
        leaveW: rect('leaveCardList'),
        kpiCols: getComputedStyle(document.querySelector('#page-dashboard .grid.grid-cols-2') || document.createElement('div')).gridTemplateColumns,
      }
    })
    note(phoneM.deskTable === 'none', 'phone: desk tables hidden', { detail: phoneM.deskTable })
    note(phoneM.phoneCards === 'block', 'phone: card lists visible', { detail: phoneM.phoneCards })
    note(phoneM.sticky === 'flex', 'phone: leave sticky CTA visible', { detail: phoneM.sticky })
    note(phoneM.tasksW > 300 && phoneM.tsW > 300 && phoneM.leaveW > 300, 'phone: card containers have width', {
      detail: `tasks=${phoneM.tasksW} ts=${phoneM.tsW} leave=${phoneM.leaveW}`,
    })
    note(String(phoneM.kpiCols).split(' ').filter(Boolean).length >= 2, 'phone: dashboard KPI ≥2 columns', { detail: phoneM.kpiCols })

    const phoneShot = join(outDir, 'wave2-phone-390.png')
    await phone.screenshot({ path: phoneShot, fullPage: false })

    const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await desk.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await revealShell(desk)
    await desk.evaluate(() => {
      ;['page-tasks', 'page-timesheet', 'page-leave'].forEach((id) => {
        const p = document.getElementById(id)
        if (p) { p.classList.add('active'); p.style.display = 'block' }
      })
    })
    const deskM = await desk.evaluate(() => {
      const cs = (sel) => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el).display : null
      }
      return {
        deskTable: cs('#page-tasks .desk-only-table'),
        phoneCards: cs('#page-tasks .phone-only-cards'),
        sticky: cs('#leaveStickyCta'),
        sidebar: Math.round(document.getElementById('sidebar').getBoundingClientRect().width),
        bottomNav: getComputedStyle(document.getElementById('mobileBottomNav')).display,
        hasRenderFns: typeof renderTasksMobileCards === 'function'
          && typeof renderTsMobileCards === 'function'
          && typeof renderLeaveMobileCards === 'function',
      }
    })
    note(deskM.deskTable !== 'none', 'desktop: task table visible', { detail: deskM.deskTable })
    note(deskM.phoneCards === 'none', 'desktop: card lists hidden', { detail: deskM.phoneCards })
    note(deskM.sticky === 'none', 'desktop: leave sticky CTA hidden', { detail: deskM.sticky })
    note(deskM.sidebar === 260, 'desktop sidebar 260', { detail: String(deskM.sidebar) })
    note(deskM.bottomNav === 'none', 'desktop no bottom nav')
    note(deskM.hasRenderFns, 'mobile card render helpers present in app.js')

    const deskShot = join(outDir, 'wave2-desktop-1280.png')
    await desk.screenshot({ path: deskShot, fullPage: false })

    for (const name of ['wave2-phone-390.png', 'wave2-desktop-1280.png']) {
      const buf = readFileSync(join(outDir, name))
      note(true, `screenshot ${name}`, { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
    }
  } finally {
    await browser.close()
  }

  const failed = results.filter((r) => !r.ok)
  const summary = { scope: 'engineering_smoke_wave2_cards', base, passed: results.filter((r) => r.ok).length, failed: failed.length, results }
  writeFileSync(join(outDir, 'wave2-smoke-results.json'), JSON.stringify(summary, null, 2))
  console.log(`\nSummary: ${summary.passed} passed, ${summary.failed} failed`)
  process.exit(failed.length ? 1 : 0)
}

await main()
