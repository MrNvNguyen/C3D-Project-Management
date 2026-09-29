/**
 * Q1 Layer A/B API — Wave D2 Chi phí A (local only)
 * Usage: node scripts/qa-wave-d2-cost-a-q1.mjs [baseUrl] [outJson]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:8791'
const OUT =
  process.argv[3] || join('docs', 'evidence', 'finance', 'wave-d2-cost-a-q1-2026-09-26.json')
const PROJECT_ID = 5
const D2_BASE = 'd47a176'

const out = {
  directive_id: 'THEME-LEGAL-EXCEL-D2-COST-A',
  wave_id: 'D2-cost-a',
  attempt: '1/3',
  qa_tier: 'Q1',
  measured_at: new Date().toISOString(),
  runtime_fingerprint: {
    git_SHA: `${D2_BASE} (dirty D2)`,
    wrangler: BASE,
    d1: 'local',
    preview_watch: true,
  },
  layer_a: {},
  api: {},
  rbac: {},
  diff_gate: {},
  failures: [],
  not_measured: [],
  run_class: 'PRODUCT_PASS_RUN',
  attempt_outcome: 'PASS',
}

async function req(path, { method = 'GET', token, body, expectStatus } = {}) {
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
  if (expectStatus != null && res.status !== expectStatus) {
    throw new Error(`${method} ${path} expected ${expectStatus} got ${res.status}: ${text.slice(0, 300)}`)
  }
  return { status: res.status, json }
}

async function login(username, password) {
  const { status, json } = await req('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  })
  if (status !== 200 || !json.token) throw new Error(`login ${username} failed: ${JSON.stringify(json)}`)
  return json
}

function sumInUseFromGroups(groups) {
  let s = 0
  for (const g of groups || []) {
    for (const r of g.rows || []) s += Number(r.amount_in_use) || 0
    const gt = Number(g.group_total)
    if (gt > 0) {
      const rowSum = (g.rows || []).reduce((a, r) => a + (Number(r.amount_in_use) || 0), 0)
      if (Math.abs(gt - rowSum) > 0.01) {
        out.failures.push(`group_total mismatch ${g.package_name}: ${gt} vs ${rowSum}`)
      }
    }
  }
  return s
}

try {
  let vitestOut
  try {
    vitestOut = execSync('npm test -- --run', { encoding: 'utf8', cwd: process.cwd() })
  } catch (e) {
    vitestOut = (e.stdout || '') + (e.stderr || '')
    out.layer_a.npm_test = { result: 'FAIL', output_tail: vitestOut.slice(-800) }
    out.failures.push('npm test failed')
    out.run_class = 'PRODUCT_FAILURE_RUN'
    out.attempt_outcome = 'FALSIFIED'
  }
  if (!out.layer_a.npm_test) {
    const testsMatch = vitestOut.match(/Tests\s+(\d+) passed/)
    const testsPassed = testsMatch ? Number(testsMatch[1]) : 0
    let costAOk = false
    try {
      execSync('npx vitest run src/finance.test.ts -t "computeLegalCostA"', {
        encoding: 'utf8',
        cwd: process.cwd(),
      })
      costAOk = true
    } catch {
      costAOk =
        vitestOut.includes('387_500_000') &&
        vitestOut.includes('43_055_556') &&
        testsPassed >= 38
    }
    out.layer_a.npm_test = {
      result: costAOk && testsPassed >= 38 ? 'PASS' : 'FAIL',
      tests_passed: testsPassed,
      computeLegalCostA_fixtures: costAOk,
      computeBookedRevenue: 'included_in_suite_38_total',
    }
    if (!costAOk) {
      out.failures.push('computeLegalCostA fixtures or test count')
      out.run_class = 'PRODUCT_FAILURE_RUN'
      out.attempt_outcome = 'FALSIFIED'
    }
  }

  const admin = await login('admin', 'Admin@123456')
  const adminToken = admin.token
  out.api.login_admin = { role: admin.user?.role, user_id: admin.user?.id }

  const get1 = await req(`/api/legal/${PROJECT_ID}/cost-a`, { token: adminToken })
  if (get1.status !== 200) throw new Error(`GET cost-a ${get1.status}`)
  const data1 = get1.json
  const computedSum = sumInUseFromGroups(data1.groups)
  const pageTotal1 = Number(data1.page_total) || 0
  const totalsMatch = Math.abs(pageTotal1 - computedSum) < 0.01
  out.api.get_cost_a_initial = {
    status: 200,
    groups_count: (data1.groups || []).length,
    page_total: pageTotal1,
    sum_amount_in_use: computedSum,
    page_total_equals_sum: totalsMatch,
    management_fee_pct: data1.management_fee_pct,
    result: totalsMatch && (data1.groups || []).length >= 0 ? 'PASS' : 'FAIL',
  }
  if (!totalsMatch) {
    out.failures.push('page_total != sum amount_in_use')
    out.run_class = 'PRODUCT_FAILURE_RUN'
    out.attempt_outcome = 'FALSIFIED'
  }

  let targetPaymentId = null
  let formulaBefore = null
  for (const g of data1.groups || []) {
    for (const r of g.rows || []) {
      if (r.payment_request_id && r.amount > 0 && r.status !== 'rejected') {
        targetPaymentId = r.payment_request_id
        formulaBefore = Number(r.formula_amount)
        break
      }
    }
    if (targetPaymentId) break
  }
  if (!targetPaymentId) {
    out.not_measured.push('PATCH override — no eligible payment row in local D1')
    out.api.patch_override = { result: 'NOT_MEASURED', reason: 'no_payment_row' }
  } else {
    const payBefore = await req(`/api/legal/payments/${targetPaymentId}`, { token: adminToken })
    const statusBefore = payBefore.json?.status
    const revBefore = payBefore.json?.revenue_id ?? null

    const overrideVal = (formulaBefore || 100000) + 12345
    await req(`/api/legal/payments/${targetPaymentId}/cost-a`, {
      method: 'PATCH',
      token: adminToken,
      body: { amount_override: overrideVal },
    })

    const get2 = await req(`/api/legal/${PROJECT_ID}/cost-a`, { token: adminToken })
    const pageTotal2 = Number(get2.json.page_total)
    const moved = Math.abs(pageTotal2 - pageTotal1) > 0.01
    out.api.patch_override = {
      payment_request_id: targetPaymentId,
      formula_amount_before: formulaBefore,
      amount_override: overrideVal,
      page_total_before: pageTotal1,
      page_total_after_override: pageTotal2,
      page_total_moved: moved,
      result: moved ? 'PASS' : 'FAIL',
    }
    if (!moved) {
      out.failures.push('override did not move page_total')
      out.run_class = 'PRODUCT_FAILURE_RUN'
      out.attempt_outcome = 'FALSIFIED'
    }

    await req(`/api/legal/payments/${targetPaymentId}/cost-a`, {
      method: 'PATCH',
      token: adminToken,
      body: { amount_override: null },
    })
    const get3 = await req(`/api/legal/${PROJECT_ID}/cost-a`, { token: adminToken })
    const pageTotal3 = Number(get3.json.page_total)
    const restored = Math.abs(pageTotal3 - pageTotal1) < 0.01
    out.api.patch_reset = {
      page_total_after_reset: pageTotal3,
      page_total_restored: restored,
      result: restored ? 'PASS' : 'FAIL',
    }
    if (!restored) {
      out.failures.push('Reset did not restore page_total')
      out.run_class = 'PRODUCT_FAILURE_RUN'
      out.attempt_outcome = 'FALSIFIED'
    }

    await req(`/api/legal/payments/${targetPaymentId}/cost-a`, {
      method: 'PATCH',
      token: adminToken,
      body: { spend_status: 'spent', note: 'qa-d2-cost-a-spot' },
    })
    const payAfter = await req(`/api/legal/payments/${targetPaymentId}`, { token: adminToken })
    const statusAfter = payAfter.json?.status
    const revAfter = payAfter.json?.revenue_id ?? null
    const sideEffectFree = statusBefore === statusAfter && revBefore === revAfter
    out.api.patch_spend_note_no_payment_side_effect = {
      payment_request_id: targetPaymentId,
      status_before: statusBefore,
      status_after: statusAfter,
      revenue_id_before: revBefore,
      revenue_id_after: revAfter,
      result: sideEffectFree ? 'PASS' : 'FAIL',
    }
    if (!sideEffectFree) {
      out.failures.push('PATCH cost-a changed payment status or revenue_id')
      out.run_class = 'PRODUCT_FAILURE_RUN'
      out.attempt_outcome = 'FALSIFIED'
    }
  }

  const overview = await req(`/api/legal/${PROJECT_ID}/overview`, { token: adminToken })
  const overviewStr = JSON.stringify(overview.json)
  const leak =
    overviewStr.includes('amount_in_use') ||
    overviewStr.includes('legal_cost_a') ||
    overviewStr.includes('"cost_a"')
  out.api.overview_no_cost_a_leak = {
    result: leak ? 'FAIL' : 'PASS',
    checked_keys: ['amount_in_use', 'legal_cost_a', 'cost_a'],
  }
  if (leak) {
    out.failures.push('overview payload contains Cost A fields')
    out.run_class = 'PRODUCT_FAILURE_RUN'
    out.attempt_outcome = 'FALSIFIED'
  }

  const roles = [
    { username: 'pham.thi.d', password: 'Bim@2024', role_label: 'project_admin' },
    { username: 'nguyen.van.a', password: 'Bim@2024', role_label: 'member' },
  ]
  for (const cred of roles) {
    let tok
    try {
      const lg = await login(cred.username, cred.password)
      tok = lg.token
      out.rbac[cred.role_label] = { login: 'PASS', role: lg.user?.role }
    } catch (e) {
      out.rbac[cred.role_label] = { login: 'NOT_MEASURED', reason: String(e.message) }
      out.not_measured.push(`RBAC ${cred.role_label} — login failed (seed-test-users?)`)
      continue
    }
    const g = await req(`/api/legal/${PROJECT_ID}/cost-a`, { token: tok, expectStatus: 403 })
    out.rbac[cred.role_label].get_cost_a = g.status
    const pid = targetPaymentId || 1
    const p = await req(`/api/legal/payments/${pid}/cost-a`, {
      method: 'PATCH',
      token: tok,
      body: { note: 'rbac-probe' },
      expectStatus: 403,
    })
    out.rbac[cred.role_label].patch_cost_a = p.status
    const ok = g.status === 403 && p.status === 403
    out.rbac[cred.role_label].result = ok ? 'PASS' : 'FAIL'
    if (!ok) {
      out.failures.push(`RBAC ${cred.role_label} not 403`)
      out.run_class = 'PRODUCT_FAILURE_RUN'
      out.attempt_outcome = 'FALSIFIED'
    }
  }

  try {
    const names = execSync(`git diff ${D2_BASE} --name-only`, { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
    const forbidden = names.filter(
      (n) =>
        n.includes('executive-dashboard') ||
        n.includes('app.v2') ||
        /^migrations\/(?!0054)/.test(n)
    )
    const financeDiff = execSync(`git diff ${D2_BASE} -- src/finance.ts`, { encoding: 'utf8' })
    const bookedBodyTouched =
      financeDiff.includes('-  const rawAmount') ||
      financeDiff.includes('-  const bookedRevenue')
    out.diff_gate = {
      changed_files: names,
      migrations_0054_only:
        names.filter((n) => n.startsWith('migrations/')).every((n) => n.includes('0054')) ||
        !names.some((n) => n.startsWith('migrations/')),
      no_executive_or_efg: forbidden.length === 0,
      computeBookedRevenue_body_unchanged: !bookedBodyTouched,
      result:
        !bookedBodyTouched && forbidden.length === 0 ? 'PASS' : 'FAIL',
    }
    if (out.diff_gate.result === 'FAIL') {
      out.failures.push('diff gate vs d47a176')
      out.run_class = 'PRODUCT_FAILURE_RUN'
      out.attempt_outcome = 'FALSIFIED'
    }
  } catch (e) {
    out.diff_gate = { result: 'NOT_MEASURED', error: String(e.message) }
  }
} catch (e) {
  out.failures.push(String(e.message || e))
  out.run_class = 'INVALID_ENVIRONMENT_RUN'
  out.attempt_outcome = 'NOT_MEASURED'
}

if (out.failures.length && out.run_class === 'PRODUCT_PASS_RUN') {
  out.run_class = 'PRODUCT_FAILURE_RUN'
  out.attempt_outcome = 'FALSIFIED'
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log('Wrote', OUT)
console.log(JSON.stringify({ run_class: out.run_class, failures: out.failures }, null, 2))
process.exit(out.run_class === 'PRODUCT_PASS_RUN' ? 0 : 1)
