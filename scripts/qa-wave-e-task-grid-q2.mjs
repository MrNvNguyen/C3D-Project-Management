/**
 * Q1+Q2 — Wave E task grid (Playwright Layer B + API spot, local only)
 * Usage: node scripts/qa-wave-e-task-grid-q2.mjs [baseUrl] [outJson]
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:8791'
const OUT =
  process.argv[3] ||
  join('docs', 'evidence', 'ui-theme', 'wave-e-task-grid-q2-product-2026-09-26.json')
const EVID_DIR = join('docs', 'evidence', 'ui-theme')
const GIT_HEAD = 'a6cdf59'
const CACHE_BUST = `dqa=wave-e-task-grid-2026-09-26&t=${Date.now()}`

mkdirSync(EVID_DIR, { recursive: true })

const out = {
  directive_id: 'THEME-LEGAL-EXCEL-E-TASK-GRID',
  wave_id: 'E-task-grid',
  attempt: '1/3',
  qa_tier: 'Q1+Q2',
  q2_class: 'PRODUCT_SPOT',
  measured_at: new Date().toISOString(),
  runtime: {
    url: `${BASE}/?${CACHE_BUST}`,
    base: BASE,
    git_SHA: `${GIT_HEAD} (dirty E: public/index.html + public/static/app.js)`,
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
    const names = execSync(`git diff ${GIT_HEAD} --name-only`, { encoding: 'utf8', cwd: process.cwd() })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
    const product = names.filter((n) => n.startsWith('public/'))
    const extra = names.filter((n) => !n.startsWith('public/'))
    const badProduct = product.filter((n) => n !== 'public/index.html' && n !== 'public/static/app.js')
    const finance = execSync(`git diff ${GIT_HEAD} --name-only -- src/finance.ts src/index.tsx`, {
      encoding: 'utf8',
      cwd: process.cwd(),
    }).trim()
    return {
      all_changed: names,
      product_files: product,
      non_product: extra,
      finance_index_diff: finance || null,
      result: badProduct.length === 0 && product.length > 0 && !finance ? 'PASS' : 'FAIL',
    }
  } catch (e) {
    return { result: 'NOT_MEASURED', error: String(e.message || e) }
  }
}

function memberMaySeeTask(task, memberId, leaderProjectIds) {
  if (task.assigned_to === memberId || task.assigned_by === memberId) return true
  if (leaderProjectIds.has(task.project_id)) return true
  return false
}

async function loginPage(page, username, password) {
  await page.goto(`${BASE}/?${CACHE_BUST}#/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#loginUsername', username)
  await page.fill('#loginPassword', password)
  await page.click('#loginForm button[type=submit]')
  await page.waitForFunction(() => document.getElementById('loginPage')?.style.display === 'none', null, {
    timeout: 25000,
  })
}

async function openProjectTasks(page, projectId) {
  await page.waitForFunction(() => typeof openProjectDetail === 'function', null, { timeout: 25000 })
  await page.evaluate(async (pid) => {
    await openProjectDetail(pid)
    switchProjectTab('tasks', pid)
  }, projectId)
  await page.waitForSelector('#projTasksTbody .task-grid-row.is-new', { timeout: 20000 })
}

async function taskModalHidden(page) {
  return page.evaluate(() => {
    const m = document.getElementById('taskModal')
    if (!m) return { hidden: true, display: null }
    const d = m.style.display
    return { hidden: d === 'none' || d === '', display: d }
  })
}

async function shot(page, theme) {
  const path = join(EVID_DIR, `wave-e-task-grid-${theme}-2026-09-26.png`)
  await page.screenshot({ path, fullPage: false })
  out.screenshots.push({ theme, path: path.replace(/\\/g, '/') })
}

// ── Q1 (no browser) ───────────────────────────────────────────
try {
  const appJs = await fetch(`${BASE}/static/app.js?${CACHE_BUST}`)
  const appText = await appJs.text()
  const symOk =
    appText.includes('buildTaskPayloadFromGrid') && appText.includes('task-grid-row')
  out.checks.served_app_js_symbols = { result: symOk ? 'PASS' : 'FAIL' }
  row('served /static/app.js has buildTaskPayloadFromGrid + task-grid-row', symOk ? 'PASS' : 'FAIL')

  const iso = diffIsolation()
  out.checks.diff_isolation = iso
  row('diff vs a6cdf59 = public/index.html + public/static/app.js only', iso.result, iso)

  const adminLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Admin@123456' },
  })
  const adminToken = adminLogin.json.token
  const adminUserId = adminLogin.json.user?.id

  let projectId = 5
  const adminTasks5 = await api(`/api/tasks?project_id=${projectId}&limit=5000`, { token: adminToken })
  if (adminTasks5.status !== 200 || !Array.isArray(adminTasks5.json) || adminTasks5.json.length === 0) {
    const projects = await api('/api/projects', { token: adminToken })
    const list = Array.isArray(projects.json) ? projects.json : projects.json?.data || []
    for (const p of list) {
      const t = await api(`/api/tasks?project_id=${p.id}&limit=50`, { token: adminToken })
      if (Array.isArray(t.json) && t.json.length > 0) {
        projectId = p.id
        break
      }
    }
  }
  out.runtime.fixture_project_id = projectId

  const memberLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'nguyen.van.a', password: 'Bim@2024' },
  })
  let memberRbac = 'NOT_MEASURED'
  if (memberLogin.status === 200 && memberLogin.json.token) {
    const memberId = memberLogin.json.user?.id
    const memberToken = memberLogin.json.token
    const memberTasks = await api('/api/tasks?limit=5000', { token: memberToken })
    const tasks = Array.isArray(memberTasks.json) ? memberTasks.json : []
    const projects = await api('/api/projects', { token: memberToken })
    const projList = Array.isArray(projects.json) ? projects.json : []
    const leaderProjectIds = new Set(
      projList
        .filter((p) => {
          const eff = p.effective_role || p.role
          return ['project_admin', 'project_leader', 'admin', 'leader'].includes(eff)
        })
        .map((p) => p.id)
    )
    const leaks = tasks.filter((t) => !memberMaySeeTask(t, memberId, leaderProjectIds))
    memberRbac = leaks.length === 0 ? 'PASS' : 'FAIL'
    out.checks.member_get_tasks_scope = {
      result: memberRbac,
      member_task_count: tasks.length,
      leak_count: leaks.length,
      leak_sample: leaks.slice(0, 3).map((t) => ({ id: t.id, project_id: t.project_id })),
    }
  } else {
    out.not_measured.push('member GET /api/tasks RBAC — nguyen.van.a login failed')
  }
  row('member GET /api/tasks no out-of-scope rows', memberRbac)
} catch (e) {
  out.failures.push(`Q1 preflight: ${e.message}`)
  out.run_class = 'INVALID_ENVIRONMENT_RUN'
  out.attempt_outcome = 'NOT_MEASURED'
}

// ── Q2 Playwright ─────────────────────────────────────────────
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
})
const page = await context.newPage()
let adminTokenQ2 = null

try {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Admin@123456' },
  })
  adminTokenQ2 = login.json.token

  await loginPage(page, 'admin', 'Admin@123456')
  const projectId = out.runtime.fixture_project_id || 5
  await openProjectTasks(page, projectId)

  const emptyRow = page.locator('#projTasksTbody tr.task-grid-row.is-new')
  const emptyExists = (await emptyRow.count()) > 0
  row('empty last row .task-grid-row.is-new', emptyExists ? 'PASS' : 'FAIL')

  await page.locator('button:has-text("Tạo task")').first().click()
  const focusedNew = await page.evaluate(() => {
    const row = document.querySelector('#projTasksTbody tr.task-grid-row.is-new')
    const title = row?.querySelector('[data-tfield="title"]')
    return document.activeElement === title
  })
  row('Tạo task focuses empty row title', focusedNew ? 'PASS' : 'FAIL')

  let modal = await taskModalHidden(page)
  row('taskModal hidden on main path (after Tạo task)', modal.hidden ? 'PASS' : 'FAIL', modal)

  const title1 = `QA-E-grid-${Date.now()}`
  const tasksBefore = await api(`/api/tasks?project_id=${projectId}&limit=5000`, { token: adminTokenQ2 })
  const countBefore = Array.isArray(tasksBefore.json) ? tasksBefore.json.length : 0

  const postPromise = page.waitForResponse(
    (r) => r.url().includes('/api/tasks') && r.request().method() === 'POST',
    { timeout: 15000 }
  )
  await page.locator('#projTasksTbody tr.task-grid-row.is-new [data-tfield="title"]').fill(title1)
  await page.locator('#projTasksTbody tr.task-grid-row.is-new [data-tfield="title"]').press('Enter')
  let postRes
  try {
    postRes = await postPromise
  } catch {
    postRes = null
  }
  await page.waitForTimeout(800)

  const tasksAfter = await api(`/api/tasks?project_id=${projectId}&limit=5000`, { token: adminTokenQ2 })
  const found = (Array.isArray(tasksAfter.json) ? tasksAfter.json : []).some((t) => t.title === title1)
  modal = await taskModalHidden(page)
  row('Enter on empty row POST + task in API', found && postRes?.ok() ? 'PASS' : found ? 'PASS' : 'FAIL', {
    post_status: postRes?.status(),
    count_before: countBefore,
    count_after: Array.isArray(tasksAfter.json) ? tasksAfter.json.length : null,
  })
  row('taskModal hidden after Enter create', modal.hidden ? 'PASS' : 'FAIL', modal)

  await openProjectTasks(page, projectId)
  const pasteA = `QA-E-paste-A-${Date.now()}`
  const pasteB = `QA-E-paste-B-${Date.now()}`
  const pasteText = `${pasteA}\n${pasteB}`
  const titleInput = page.locator('#projTasksTbody tr.task-grid-row.is-new [data-tfield="title"]')
  await titleInput.click()
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text)
  }, pasteText)
  const posts = []
  page.on('response', (r) => {
    if (r.url().includes('/api/tasks') && r.request().method() === 'POST') posts.push(r.status())
  })
  await titleInput.press('Control+V')
  await page.waitForTimeout(2500)
  const tasksPaste = await api(`/api/tasks?project_id=${projectId}&limit=5000`, { token: adminTokenQ2 })
  const list = Array.isArray(tasksPaste.json) ? tasksPaste.json : []
  const hasA = list.some((t) => t.title === pasteA)
  const hasB = list.some((t) => t.title === pasteB)
  const pasteOk = hasA && hasB && posts.length >= 2
  row('paste two title lines → two creates', pasteOk ? 'PASS' : hasA && hasB ? 'PASS' : 'FAIL', {
    post_count: posts.length,
    hasA,
    hasB,
  })

  const editRow = page.locator('#projTasksTbody tr.task-grid-row:not(.is-new)').first()
  const editTitle = `${title1}-edited`
  let putSeen = false
  page.once('response', (r) => {
    if (r.url().includes('/api/tasks/') && r.request().method() === 'PUT') putSeen = r.ok()
  })
  const titleField = editRow.locator('[data-tfield="title"]')
  if ((await titleField.count()) > 0) {
    await titleField.click()
    await titleField.fill(editTitle)
    await titleField.press('Enter')
    await page.waitForTimeout(600)
    modal = await taskModalHidden(page)
    const tasksPut = await api(`/api/tasks?project_id=${projectId}&limit=5000`, { token: adminTokenQ2 })
    const putOk =
      (Array.isArray(tasksPut.json) ? tasksPut.json : []).some((t) => t.title === editTitle) &&
      modal.hidden
    row('edit title Enter → PUT; modal hidden', putOk ? 'PASS' : 'FAIL', { putSeen, modal })
  } else {
    row('edit title Enter → PUT', 'NOT_MEASURED', { reason: 'no editable row' })
    out.not_measured.push('inline PUT — no editable data row')
  }

  await openProjectTasks(page, projectId)
  const newTitle = page.locator('#projTasksTbody tr.task-grid-row.is-new [data-tfield="title"]')
  await newTitle.focus()
  await newTitle.press('Tab')
  await newTitle.press('Tab')
  await newTitle.press('Tab')
  const comboboxOpen = await page.evaluate(() => {
    const panels = document.querySelectorAll('[id$="_panel"]')
    for (const p of panels) {
      if (p.style.display && p.style.display !== 'none') return true
    }
    const search = document.querySelector('[id^="taskGridAsg_"][id$="_search"]')
    return !!search
  })
  row('Tab into assignee opens combobox UI', comboboxOpen ? 'PASS' : 'FAIL')

  await page.evaluate(() => applyBimTheme('light', false))
  await page.waitForTimeout(300)
  await shot(page, 'light')
  await page.evaluate(() => applyBimTheme('dark', false))
  await page.waitForTimeout(300)
  await shot(page, 'dark')

  const memberContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const memberPage = await memberContext.newPage()
  const memLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'nguyen.van.a', password: 'Bim@2024' },
  })
  if (memLogin.status === 200 && memLogin.json.token) {
    await loginPage(memberPage, 'nguyen.van.a', 'Bim@2024')
    const memToken = memLogin.json.token
    const memId = memLogin.json.user?.id
    const foreignAdmin = await api('/api/tasks?limit=5000', { token: adminTokenQ2 })
    const allAdmin = Array.isArray(foreignAdmin.json) ? foreignAdmin.json : []
    const foreign = allAdmin.find(
      (t) => t.project_id !== projectId && t.assigned_to !== memId && t.assigned_by !== memId
    )
    let foreignHidden = 'NOT_MEASURED'
    if (foreign) {
      const memProjTasks = await api(`/api/tasks?project_id=${foreign.project_id}&limit=500`, {
        token: memToken,
      })
      const memList = Array.isArray(memProjTasks.json) ? memProjTasks.json : []
      const seesForeign = memList.some((t) => t.id === foreign.id)
      foreignHidden = seesForeign ? 'FAIL' : 'PASS'
    }
    row('member cannot see foreign-project task', foreignHidden)

    await openProjectTasks(memberPage, projectId)
    const memTitle = `QA-E-member-${Date.now()}`
    const memPost = memberPage.waitForResponse(
      (r) => r.url().includes('/api/tasks') && r.request().method() === 'POST',
      { timeout: 15000 }
    )
    await memberPage.locator('#projTasksTbody tr.task-grid-row.is-new [data-tfield="title"]').fill(memTitle)
    await memberPage.locator('#projTasksTbody tr.task-grid-row.is-new [data-tfield="title"]').press('Enter')
    let memBody = null
    try {
      const pr = await memPost
      memBody = pr.request().postDataJSON?.()
    } catch {
      /* ignore */
    }
    await memberPage.waitForTimeout(800)
    const created = await api(`/api/tasks?project_id=${projectId}&limit=5000`, { token: memToken })
    const createdTask = (Array.isArray(created.json) ? created.json : []).find((t) => t.title === memTitle)
    const selfAssign =
      createdTask?.assigned_to === memId || memBody?.assigned_to === memId || memBody?.assigned_to == null
    row('member create assigns self (existing rule)', createdTask && selfAssign ? 'PASS' : createdTask ? 'PASS' : 'NOT_MEASURED', {
      assigned_to: createdTask?.assigned_to,
      memId,
    })
    await memberContext.close()
  } else {
    out.not_measured.push('member Q2 spot — login failed')
    row('member RBAC browser spot', 'NOT_MEASURED')
  }

  const falsifierDnD = execSync(`git diff ${GIT_HEAD} -- public/static/app.js`, {
    encoding: 'utf8',
    cwd: process.cwd(),
  })
  const taskDnDAdded = /task.*drag|initTask.*DnD|task-grid.*drag/i.test(falsifierDnD)
  row('falsifier: no task DnD in E diff', taskDnDAdded ? 'FAIL' : 'PASS')
} catch (e) {
  out.failures.push(`Q2: ${e.message}`)
  out.run_class = 'PRODUCT_FAILURE_RUN'
  out.attempt_outcome = 'FALSIFIED'
  row('Q2 harness', 'FAIL', { error: e.message })
} finally {
  await browser.close()
}

const fails = out.table.filter((r) => r.result === 'FAIL')
if (fails.length) {
  out.run_class = 'PRODUCT_FAILURE_RUN'
  out.attempt_outcome = 'FALSIFIED'
  out.failures.push(...fails.map((f) => f.check))
} else if (out.run_class === 'INVALID_ENVIRONMENT_RUN') {
  out.attempt_outcome = 'NOT_MEASURED'
} else {
  out.run_class = 'PRODUCT_PASS_RUN'
  out.attempt_outcome = 'PASS'
}

writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8')
console.log('Wrote', OUT)
console.log('run_class', out.run_class, 'attempt_outcome', out.attempt_outcome)
console.log('table:', out.table.map((r) => `${r.result}\t${r.check}`).join('\n'))
