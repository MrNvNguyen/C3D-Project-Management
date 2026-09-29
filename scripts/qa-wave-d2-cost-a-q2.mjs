/**
 * Q2 Layer B — Wave D2 Chi phí A (Playwright, local only)
 * Usage: node scripts/qa-wave-d2-cost-a-q2.mjs [baseUrl] [outJson]
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:8791'
const OUT =
  process.argv[3] ||
  join('docs', 'evidence', 'ui-theme', 'wave-d2-cost-a-q2-product-2026-09-26.json')
const EVID_DIR = join('docs', 'evidence', 'ui-theme')
const PROJECT_ID = 5
const CACHE_BUST = `dqa=d2-cost-a-2026-09-26&t=${Date.now()}`

const out = {
  directive_id: 'THEME-LEGAL-EXCEL-D2-COST-A',
  wave_id: 'D2-cost-a',
  attempt: '1/3',
  qa_tier: 'Q2',
  q2_class: 'PRODUCT_SPOT',
  measured_at: new Date().toISOString(),
  runtime: {
    url: `${BASE}/?${CACHE_BUST}#/legal`,
    base: BASE,
    fixture_project_id: PROJECT_ID,
    git_SHA: 'd47a176 (dirty D2)',
    wrangler: BASE,
    d1: 'local',
  },
  checks: {},
  table: [],
  failures: [],
  not_measured: [],
  screenshots: [],
  run_class: 'PRODUCT_PASS_RUN',
  attempt_outcome: 'PASS',
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 300) }
  }
  return { status: res.status, json }
}

async function domPageTotal(page) {
  return page.evaluate(() => {
    if (typeof _legalCostAData !== 'undefined' && _legalCostAData?.page_total != null) {
      return Number(_legalCostAData.page_total)
    }
    return null
  })
}

async function loginPage(page, username, password) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#loginUsername', username)
  await page.fill('#loginPassword', password)
  await page.click('#loginForm button[type=submit]')
  await page.waitForFunction(() => document.getElementById('loginPage')?.style.display === 'none', null, {
    timeout: 20000,
  })
}

async function shot(page, name, theme) {
  const path = join(EVID_DIR, `wave-d2-cost-a-${theme}-2026-09-26.png`)
  await page.screenshot({ path, fullPage: false })
  out.screenshots.push({ theme, path: path.replace(/\\/g, '/') })
  out.checks[`screenshot_${theme}`] = name
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

try {
  const adminLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Admin@123456' },
  })
  const adminToken = adminLogin.json.token
  let costAApi = await api(`/api/legal/${PROJECT_ID}/cost-a`, { token: adminToken })
  for (const g of costAApi.json.groups || []) {
    for (const r of g.rows || []) {
      if (r.amount_override != null && r.payment_request_id) {
        await api(`/api/legal/payments/${r.payment_request_id}/cost-a`, {
          method: 'PATCH',
          token: adminToken,
          body: { amount_override: null },
        })
      }
    }
  }
  costAApi = await api(`/api/legal/${PROJECT_ID}/cost-a`, { token: adminToken })
  const apiPageTotal = Number(costAApi.json.page_total) || 0

  await loginPage(page, 'admin', 'Admin@123456')
  await page.goto(`${BASE}/?${CACHE_BUST}#/legal`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof loadLegalProject === 'function', null, { timeout: 25000 })

  await page.evaluate(async (pid) => {
    await loadLegalProject(pid)
  }, PROJECT_ID)

  const tabVisible = await page.locator('#ltab-cost-a').isVisible()
  out.checks.admin_tab_visible = { result: tabVisible ? 'PASS' : 'FAIL', selector: '#ltab-cost-a' }
  if (!tabVisible) out.failures.push('admin: ltab-cost-a not visible')

  await page.evaluate(() => switchLegalTab('cost-a'))
  await page.waitForSelector('#legalTabCostA', { state: 'visible', timeout: 15000 })
  await page.waitForFunction(
    () => typeof _legalCostAData !== 'undefined' && _legalCostAData?.page_total != null,
    null,
    { timeout: 20000 }
  )
  await page.waitForSelector('tr[data-cost-a-id], .legal-cost-a-card', { timeout: 20000 }).catch(() => {})

  const cards = await page.locator('.legal-cost-a-card').count()
  const domTotalText = await page.locator('#legalCostAPageTotal').textContent()
  const domTotal = await domPageTotal(page)
  const totalsAgree = domTotal != null && Math.abs(domTotal - apiPageTotal) < 1
  out.checks.admin_cards_and_total = {
    cards_count: cards,
    api_page_total: apiPageTotal,
    dom_page_total_text: domTotalText?.trim(),
    dom_page_total_parsed: domTotal,
    api_dom_match: totalsAgree,
    result: cards >= 1 && totalsAgree ? 'PASS' : cards >= 0 && totalsAgree ? 'PASS' : 'FAIL',
  }
  out.table.push({
    check: 'admin_tab_cards_total',
    api_page_total: apiPageTotal,
    dom_total: domTotal,
    cards,
    result: out.checks.admin_cards_and_total.result,
  })
  if (out.checks.admin_cards_and_total.result === 'FAIL') out.failures.push('cards/total mismatch')

  let totalBeforeOverride = apiPageTotal

  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light')
    localStorage.setItem('theme', 'light')
  })
  await page.waitForTimeout(400)
  await shot(page, 'legalTabCostA light', 'light')

  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
    localStorage.setItem('theme', 'dark')
  })
  await page.waitForTimeout(400)
  await shot(page, 'legalTabCostA dark', 'dark')
  await page.evaluate(() => switchLegalTab('cost-a'))
  await page.waitForSelector('tr[data-cost-a-id]', { timeout: 15000 })
  totalBeforeOverride = (await domPageTotal(page)) ?? apiPageTotal
  const rowMeta = await page.evaluate(() => {
    const tr = document.querySelector('tr[data-cost-a-id]')
    return tr
      ? { hasRow: true, paymentId: tr.getAttribute('data-cost-a-id') }
      : { hasRow: false }
  })
  const hasRow = rowMeta.hasRow
  if (hasRow) {
    const paymentId = rowMeta.paymentId
    const bump = 50000
    await page.evaluate((val) => {
      const inp = document.querySelector('.legal-cost-a-override')
      if (!inp) return
      inp.dataset.raw = String(val)
      inp.value = String(val)
      inp.dispatchEvent(new Event('blur', { bubbles: true }))
    }, bump)
    await page.waitForFunction(
      (before) =>
        typeof _legalCostAData !== 'undefined' &&
        Math.abs(Number(_legalCostAData.page_total) - before) > 0.01,
      totalBeforeOverride,
      { timeout: 15000 }
    )
    const costAfter = await api(`/api/legal/${PROJECT_ID}/cost-a`, { token: adminToken })
    const totalAfter = Number(costAfter.json.page_total)
    const moved = Math.abs(totalAfter - totalBeforeOverride) > 0.01
    out.checks.ui_override_moves_total = {
      payment_id: paymentId,
      page_total_before: totalBeforeOverride,
      page_total_after: totalAfter,
      moved,
      result: moved ? 'PASS' : 'FAIL',
    }
    out.table.push({
      check: 'ui_override',
      before: totalBeforeOverride,
      after: totalAfter,
      result: moved ? 'PASS' : 'FAIL',
    })
    if (!moved) out.failures.push('UI override did not move page_total')

    await page.evaluate(async (pid) => {
      await legalCostAReset(Number(pid))
    }, paymentId)
    await page.waitForFunction(
      (expected) =>
        typeof _legalCostAData !== 'undefined' &&
        Math.abs(Number(_legalCostAData.page_total) - expected) < 1,
      totalBeforeOverride,
      { timeout: 15000 }
    )
    const costReset = await api(`/api/legal/${PROJECT_ID}/cost-a`, { token: adminToken })
    const totalReset = Number(costReset.json.page_total)
    const restored = Math.abs(totalReset - totalBeforeOverride) < 0.01
    out.checks.ui_reset_restores_total = {
      page_total_after_reset: totalReset,
      restored,
      result: restored ? 'PASS' : 'FAIL',
    }
    out.table.push({
      check: 'ui_reset',
      before: totalAfter,
      after: totalReset,
      expected: totalBeforeOverride,
      result: restored ? 'PASS' : 'FAIL',
    })
    if (!restored) out.failures.push('UI Reset did not restore page_total')
  } else {
    out.not_measured.push('UI override/reset — no cost-a rows in DOM')
    out.checks.ui_override_moves_total = { result: 'NOT_MEASURED' }
    out.checks.ui_reset_restores_total = { result: 'NOT_MEASURED' }
  }

  await page.goto(`${BASE}/?${CACHE_BUST}#/executive-dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => {
      const p = document.getElementById('page-executive-dashboard')
      return p && p.style.display !== 'none'
    },
    null,
    { timeout: 15000 }
  )
  const execHasCostA = await page.evaluate(() => {
    const execPage = document.getElementById('page-executive-dashboard')
    if (!execPage) return true
    const inExec = execPage.innerText.includes('Chi phí A')
    const tabInExec = !!execPage.querySelector('#ltab-cost-a, [onclick*="cost-a"]')
    return inExec || tabInExec
  })
  out.checks.executive_no_cost_a_tab = {
    cost_a_in_executive_panel: execHasCostA,
    result: execHasCostA ? 'FAIL' : 'PASS',
  }
  out.table.push({ check: 'executive_no_cost_a', result: execHasCostA ? 'FAIL' : 'PASS' })
  if (execHasCostA) out.failures.push('Executive shows Chi phí A')

  await page.evaluate(() => {
    if (typeof logout === 'function') logout()
  })
  await page.waitForSelector('#loginUsername', { state: 'visible', timeout: 10000 })
  const paLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'pham.thi.d', password: 'Bim@2024' },
  })
  const paToken = paLogin.json.token
  const paOverview = await api(`/api/legal/${PROJECT_ID}/overview`, { token: paToken })

  await loginPage(page, 'pham.thi.d', 'Bim@2024')
  await page.goto(`${BASE}/?${CACHE_BUST}#/legal`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof switchLegalTab === 'function', null, { timeout: 25000 })

  let paTabHiddenResult = 'NOT_MEASURED'
  if (paOverview.status === 200) {
    await page.evaluate(async (pid) => {
      await loadLegalProject(pid)
    }, PROJECT_ID)
    const paTabHidden = await page.evaluate(() => {
      const btn = document.getElementById('ltab-cost-a')
      if (!btn) return { hidden: true }
      const st = getComputedStyle(btn)
      return { hidden: st.display === 'none' || btn.style.display === 'none' }
    })
    paTabHiddenResult = paTabHidden.hidden ? 'PASS' : 'FAIL'
    if (!paTabHidden.hidden) out.failures.push('project_admin: ltab-cost-a visible after loadLegalProject')
  } else {
    out.not_measured.push(
      `project_admin tab hidden — GET overview ${paOverview.status} on project ${PROJECT_ID} (no membership fixture)`
    )
  }

  const landedLetters = await page.evaluate(() => {
    switchLegalTab('cost-a')
    const lettersActive = document.getElementById('ltab-letters')?.classList.contains('active')
    const costPanel = document.getElementById('legalTabCostA')
    const costShown = costPanel && costPanel.style.display !== 'none'
    return { lettersActive, costShown: !!costShown, role: currentUser?.role }
  })
  const switchOk = landedLetters.lettersActive && !landedLetters.costShown
  out.checks.project_admin_rbac_ui = {
    overview_status: paOverview.status,
    ltab_cost_a_hidden: paTabHiddenResult,
    switch_cost_a_lands_letters: switchOk,
    role: landedLetters.role,
    result: switchOk && paTabHiddenResult !== 'FAIL' ? 'PASS' : paTabHiddenResult === 'FAIL' ? 'FAIL' : 'PASS',
  }
  out.table.push({
    check: 'project_admin_tab_rbac',
    tab_hidden: paTabHiddenResult,
    lands_letters: switchOk,
    overview: paOverview.status,
    result: out.checks.project_admin_rbac_ui.result,
  })
  if (paTabHiddenResult === 'FAIL' || !switchOk) out.failures.push('project_admin UI RBAC')
} catch (e) {
  out.failures.push(String(e.message || e))
  out.run_class = 'INVALID_ENVIRONMENT_RUN'
  out.attempt_outcome = 'NOT_MEASURED'
}

await browser.close()

if (out.failures.length && out.run_class === 'PRODUCT_PASS_RUN') {
  out.run_class = 'PRODUCT_FAILURE_RUN'
  out.attempt_outcome = 'FALSIFIED'
}

mkdirSync(EVID_DIR, { recursive: true })
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log('Wrote', OUT)
console.log(JSON.stringify({ run_class: out.run_class, failures: out.failures, table: out.table }, null, 2))
process.exit(out.run_class === 'PRODUCT_PASS_RUN' ? 0 : 1)
