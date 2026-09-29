/**
 * Quick product checks for theme/legal residual items on local 8794.
 * Run: node docs/evidence/ui-theme/verify-residual-wave-h.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8794'
const results = []

function ok(name, detail) {
  results.push({ name, pass: true, detail })
}
function fail(name, detail) {
  results.push({ name, pass: false, detail })
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
try {
  await page.goto(`${BASE}/?v=20260927c`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.fill('#loginUsername', 'admin')
  await page.fill('#loginPassword', 'Admin@123456')
  await page.click('button[type="submit"]')
  await page.waitForTimeout(2000)

  await page.evaluate(() => {
    localStorage.setItem('bim_theme', 'dark')
    document.documentElement.setAttribute('data-theme', 'dark')
  })

  await page.evaluate(async () => {
    if (typeof showPage === 'function') showPage('tasks')
    if (typeof loadTasks === 'function') await loadTasks()
  })
  await page.waitForTimeout(2500)

  const appSrc = await page.evaluate(() => {
    const s = document.querySelector('script[src*="app.js"]')
    return s?.getAttribute('src') || ''
  })
  if (appSrc.includes('20260927c')) ok('cache_buster', appSrc)
  else fail('cache_buster', appSrc)

  const cbBg = await page.evaluate(() => {
    const wrap = document.getElementById('taskProjectCombobox_wrap')
    const trigger = wrap?.querySelector('[data-cb-trigger]')
    if (!trigger) return null
    return getComputedStyle(trigger).backgroundColor
  })
  if (cbBg && cbBg !== 'rgb(255, 255, 255)') ok('combobox_dark_bg', cbBg)
  else fail('combobox_dark_bg', String(cbBg))

  const headers = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#page-tasks thead th')).map(th => th.textContent.trim())
  )
  const need = ['Loại', 'Filename', 'Giờ DK', 'HSTK', 'CDE']
  const missing = need.filter(n => !headers.some(h => h.includes(n)))
  if (!missing.length) ok('task_grid_headers', headers.join('|'))
  else fail('task_grid_headers', `missing ${missing.join(',')} in ${headers.join('|')}`)

  const focusCount = await page.evaluate(() => {
    const row = document.querySelector('.task-grid-row.is-new[data-grid-context="global"]')
    if (!row) return -1
    let n = 0
    row.querySelectorAll('.task-grid-cell').forEach(cell => {
      if (cell.classList.contains('task-grid-filename-skip')) return
      if (cell.querySelector('[data-cb-trigger], [data-tfield]:not([disabled])')) n++
    })
    return n
  })
  if (focusCount >= 14) ok('task_tab_fields', String(focusCount))
  else fail('task_tab_fields', String(focusCount))

  await page.evaluate(async () => {
    if (typeof showPage === 'function') showPage('timesheet')
    if (typeof loadTimesheets === 'function') await loadTimesheets()
  })
  await page.waitForTimeout(2000)
  const tsColors = await page.evaluate(() => {
    const sat = document.querySelector('tr.ts-sat td.ts-project-code')
    const normal = document.querySelector('tr.table-row:not(.ts-sat):not(.ts-sun) td.ts-project-code')
    return {
      sat: sat ? getComputedStyle(sat).color : null,
      normal: normal ? getComputedStyle(normal).color : null,
    }
  })
  if (tsColors.normal && tsColors.normal !== 'rgb(168, 184, 204)') ok('timesheet_normal_project_code', tsColors.normal)
  else fail('timesheet_normal_project_code', JSON.stringify(tsColors))
  if (!tsColors.sat || tsColors.sat === 'rgb(26, 26, 26)') ok('timesheet_sat_project_code', tsColors.sat || 'no_sat_in_range')
  else fail('timesheet_sat_project_code', tsColors.sat)

  await page.evaluate(async () => {
    if (typeof showPage === 'function') showPage('legal')
    if (typeof loadLegal === 'function') await loadLegal()
  })
  await page.waitForTimeout(2000)
  await page.evaluate(() => {
    const btn = document.querySelector('.legal-project-item, [data-legal-project-id]')
    btn?.click()
  })
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const tab = document.querySelector('#legalTabs button[onclick*="stages"], #legalTabs .tab-btn')
    if (tab) tab.click()
  })
  await page.waitForTimeout(1000)
  const legalAdd = await page.$('.legal-checklist-inline-add')
  if (legalAdd) ok('legal_inline_add', 'present')
  else fail('legal_inline_add', 'missing')

  console.log(JSON.stringify({ results }, null, 2))
  const failed = results.filter(r => !r.pass)
  process.exit(failed.length ? 1 : 0)
} catch (e) {
  console.error(e)
  process.exit(2)
} finally {
  await browser.close()
}
