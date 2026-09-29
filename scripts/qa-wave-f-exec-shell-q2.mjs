/**
 * Q2 — Wave F exec shell (legal checklist face on Executive PMO)
 * Usage: node scripts/qa-wave-f-exec-shell-q2.mjs [baseUrl] [outJson]
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const BASE = process.argv[2] || 'http://127.0.0.1:8791'
const DATE = '2026-09-26'
const GIT_HEAD = '3da083b'
const EVID_DIR = join('docs', 'evidence', 'ui-theme')
const OUT =
  process.argv[3] || join(EVID_DIR, `wave-f-exec-shell-q2-product-${DATE}.json`)
const CACHE_BUST = `wavef=exec-shell-q2-${DATE}&t=${Date.now()}`
const JS_BUST = `v=wave-f-exec-shell-q2-${Date.now()}`

mkdirSync(EVID_DIR, { recursive: true })

const out = {
  directive_id: 'THEME-LEGAL-EXCEL-F-EXEC-SHELL',
  wave_id: 'F-exec-shell',
  attempt: '1/3',
  qa_tier: 'Q2',
  q2_class: 'PRODUCT_SPOT',
  measured_at: new Date().toISOString(),
  runtime: { base: BASE, git_head: GIT_HEAD, cache_bust: CACHE_BUST },
  checks: {},
  table: [],
  failures: [],
  not_measured: [],
  screenshots: [],
  served_js: {},
  verdict: 'PENDING',
}

function row(check, result, detail = {}) {
  out.table.push({ check, result, ...detail })
  return result
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
    json = { raw: text.slice(0, 400) }
  }
  return { status: res.status, json }
}

function diffIsolation() {
  try {
    const allChanged = execSync(`git diff ${GIT_HEAD} --name-only`, { encoding: 'utf8', cwd: process.cwd() })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
    const productFiles = execSync(`git diff ${GIT_HEAD} --name-only -- public/`, {
      encoding: 'utf8',
      cwd: process.cwd(),
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
    const forbidden = execSync(
      `git diff ${GIT_HEAD} --name-only -- src/finance.ts src/index.tsx public/static/app.js`,
      { encoding: 'utf8', cwd: process.cwd() },
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
    const allowed = new Set(['public/static/executive-dashboard.js', 'public/index.html'])
    const badProduct = productFiles.filter((n) => !allowed.has(n))
    const ok =
      forbidden.length === 0 &&
      badProduct.length === 0 &&
      productFiles.includes('public/static/executive-dashboard.js')
    return {
      all_changed: allChanged,
      f_product_files: productFiles,
      unrelated_dirty: allChanged.filter((n) => !n.startsWith('public/')),
      bad_product: badProduct,
      forbidden,
      result: ok ? 'PASS' : 'FAIL',
    }
  } catch (e) {
    return { result: 'FAIL', error: String(e.message || e) }
  }
}

async function probeServedJs() {
  const url = `${BASE}/static/executive-dashboard.js?${JS_BUST}`
  const res = await fetch(url)
  const text = await res.text()
  const sha = createHash('sha256').update(text).digest('hex')
  const hasChecklistRow = text.includes('function exec_legal_checklistRow')
  const stageFnMatch = text.match(/function exec_legal_stageTable[\s\S]*?(?=\nfunction exec_)/)
  const stageBody = stageFnMatch ? stageFnMatch[0] : ''
  const stageHasTable = /<table/i.test(stageBody)
  let publicHash = null
  try {
    const pub = readFileSync(join('public', 'static', 'executive-dashboard.js'))
    publicHash = createHash('sha256').update(pub).digest('hex')
  } catch {
    /* ignore */
  }
  return {
    url,
    status: res.status,
    bytes: text.length,
    sha256: sha,
    matches_public_sha256: publicHash ? sha === publicHash : null,
    has_exec_legal_checklistRow: hasChecklistRow,
    exec_legal_stageTable_has_table_tag: stageHasTable,
    result:
      res.ok && hasChecklistRow && !stageHasTable && (publicHash ? sha === publicHash : true)
        ? 'PASS'
        : 'FAIL',
  }
}

async function findProjectWithLegalItems(token) {
  const projectsRes = await api('/api/executive/projects?status=all&search=', { token })
  const projects = projectsRes.json || []
  for (const p of projects) {
    const ov = await api(`/api/legal/${p.id}/overview`, { token })
    if (ov.status !== 200) continue
    const packages = ov.json?.packages || []
    let itemCount = 0
    for (const pkg of packages) {
      for (const st of pkg.stages || []) {
        itemCount += (st.items || []).length
        for (const it of st.items || []) itemCount += (it.children || []).length
      }
    }
    if (itemCount > 0) {
      return { project_id: p.id, project_code: p.code, item_count: itemCount, packages: packages.length }
    }
  }
  return null
}

async function loginPage(page) {
  await page.goto(`${BASE}/?${CACHE_BUST}#/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#loginUsername', 'admin')
  await page.fill('#loginPassword', 'Admin@123456')
  await page.click('#loginForm button[type=submit]')
  await page.waitForFunction(() => document.getElementById('loginPage')?.style.display === 'none', null, {
    timeout: 25000,
  })
}

async function openExecLegalTab(page, projectId) {
  await page.goto(`${BASE}/?${CACHE_BUST}#/executive-dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof window.ensureExecutiveDashboard === 'function', null, {
    timeout: 30000,
  })
  await page.evaluate(async () => {
    await window.ensureExecutiveDashboard()
    if (typeof navigate === 'function') navigate('executive-dashboard', { fromHash: true })
    if (typeof initExecutiveDashboard === 'function') await initExecutiveDashboard()
  })
  await page.waitForSelector('#exec-left-list', { timeout: 30000 })
  await page.waitForFunction(
    () => typeof exec_selectProject === 'function' && typeof exec_switchTab === 'function',
    null,
    { timeout: 30000 },
  )
  await page.evaluate((pid) => {
    exec_selectProject(pid)
  }, projectId)
  await page.waitForSelector('#exec-tab-btn-overview', { timeout: 25000 })
  await page.waitForFunction(
    () => {
      const body = document.getElementById('exec-tab-body')
      return body && !body.innerText.includes('Đang tải dữ liệu')
    },
    null,
    { timeout: 30000 },
  )
  await page.click('#exec-tab-btn-legal')
  await page.waitForFunction(
    () => {
      const panel = document.getElementById('exec-legal-panel-items')
      return panel && panel.querySelector('.legal-checklist-row')
    },
    null,
    { timeout: 45000 },
  )
}

async function main() {
  out.checks.diff_isolation = diffIsolation()
  row('diff_isolation', out.checks.diff_isolation.result, {
    files: out.checks.diff_isolation.all_changed,
  })
  if (out.checks.diff_isolation.result === 'FAIL') {
    out.failures.push('F lever diff vs 3da083b includes forbidden or extra public files')
  }

  out.served_js = await probeServedJs()
  out.checks.served_executive_js = out.served_js
  row('served_executive_js', out.served_js.result)
  if (out.served_js.result === 'FAIL') out.failures.push('Served executive-dashboard.js stale or wrong shape')

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Admin@123456' },
  })
  const token = login.json?.token
  if (!token) {
    out.verdict = 'FAIL'
    out.failures.push('admin login API failed')
    writeFileSync(OUT, JSON.stringify(out, null, 2))
    console.log(JSON.stringify({ verdict: out.verdict, out: OUT, failures: out.failures }, null, 2))
    process.exit(1)
  }

  const fixture = await findProjectWithLegalItems(token)
  out.fixture = fixture
  if (!fixture) {
    out.verdict = 'FAIL'
    out.failures.push('No executive project with legal items')
    writeFileSync(OUT, JSON.stringify(out, null, 2))
    process.exit(1)
  }

  let browser
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' })
  } catch (e) {
    try {
      browser = await chromium.launch({ headless: true })
    } catch (e2) {
      out.verdict = 'FAIL'
      out.failures.push(`playwright: ${e2.message || e2}`)
      writeFileSync(OUT, JSON.stringify(out, null, 2))
      process.exit(2)
    }
  }

  const page = await browser.newPage()
  try {
    await loginPage(page)
    await openExecLegalTab(page, fixture.project_id)

    const shell = await page.evaluate(() => {
      const left = document.getElementById('exec-left-list')
      const right = document.getElementById('exec-right-panel')
      const tabs = ['overview', 'legal', 'finance', 'directives'].map((id) => {
        const btn = document.getElementById(`exec-tab-btn-${id}`)
        return { id, present: !!btn, label: btn?.innerText?.trim()?.slice(0, 40) || '' }
      })
      const kpiTiles = document.querySelectorAll('#exec-right-panel .grid.grid-cols-4 > div')
      const itemsPanel = document.getElementById('exec-legal-panel-items')
      const tablesInItems = itemsPanel ? itemsPanel.querySelectorAll('table').length : -1
      const checklistRows = itemsPanel ? itemsPanel.querySelectorAll('.legal-checklist-row').length : 0
      const rings = itemsPanel ? itemsPanel.querySelectorAll('.legal-checklist-status-ring').length : 0
      return {
        left_panel: !!left,
        right_panel: !!right,
        tabs,
        four_main_tabs: tabs.filter((t) => t.present).length,
        money_kpi_tile_count: kpiTiles.length,
        items_panel_tables: tablesInItems,
        checklist_rows: checklistRows,
        status_rings: rings,
      }
    })

    out.checks.exec_shell_layout = {
      ...shell,
      result:
        shell.left_panel &&
        shell.right_panel &&
        shell.four_main_tabs === 4 &&
        shell.money_kpi_tile_count === 8
          ? 'PASS'
          : 'FAIL',
    }
    row('exec_shell_layout', out.checks.exec_shell_layout.result)
    if (out.checks.exec_shell_layout.result === 'FAIL') out.failures.push('Layout/tabs/KPI count')

    out.checks.exec_legal_items_face = {
      items_panel_tables: shell.items_panel_tables,
      checklist_rows: shell.checklist_rows,
      status_rings: shell.status_rings,
      result:
        shell.items_panel_tables === 0 && shell.checklist_rows >= 1 && shell.status_rings >= 1
          ? 'PASS'
          : 'FAIL',
    }
    row('exec_legal_items_face', out.checks.exec_legal_items_face.result)
    if (out.checks.exec_legal_items_face.result === 'FAIL') {
      out.failures.push('Legal items face: table or missing checklist ring rows')
    }

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
    await page.waitForTimeout(400)
    const shotLight = join(EVID_DIR, `wave-f-exec-shell-q2-light-${DATE}.png`)
    await page.locator('#exec-right-panel').screenshot({ path: shotLight })
    out.screenshots.push(shotLight)

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.waitForTimeout(400)
    const shotDark = join(EVID_DIR, `wave-f-exec-shell-q2-dark-${DATE}.png`)
    await page.locator('#exec-right-panel').screenshot({ path: shotDark })
    out.screenshots.push(shotDark)

    out.checks.theme_screenshots = { light: shotLight, dark: shotDark, result: 'PASS' }
    row('theme_screenshots', 'PASS')
  } finally {
    await browser.close()
  }

  out.verdict = out.failures.length === 0 ? 'PASS' : 'FAIL'
  out.run_class = out.verdict === 'PASS' ? 'PRODUCT_PASS_RUN' : 'PRODUCT_FAIL_RUN'
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  writeFileSync(
    join(EVID_DIR, `wave-f-exec-shell-q2-run-${DATE}.json`),
    JSON.stringify(
      {
        script: 'scripts/qa-wave-f-exec-shell-q2.mjs',
        regenerate: `node scripts/qa-wave-f-exec-shell-q2.mjs ${BASE}`,
        verdict: out.verdict,
        out: OUT,
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ verdict: out.verdict, out: OUT, failures: out.failures, table: out.table }, null, 2))
  process.exit(out.verdict === 'PASS' ? 0 : 1)
}

main().catch((e) => {
  out.verdict = 'FAIL'
  out.failures.push(String(e.message || e))
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.error(e)
  process.exit(1)
})
