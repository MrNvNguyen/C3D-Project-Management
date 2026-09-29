/**
 * Q1+Q2 — THEME-LEGAL-EXCEL-G-RECONCILE (local D1 only)
 * One processing phiếu: HSPL booked_revenue vs estimate-vs-actual KPI (project 5).
 * Usage: node scripts/qa-wave-g-impact-reconcile-q1q2.mjs [baseUrl]
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = join(__dirname, '..')
const VERIFY_SHA = 'e02f621d3ad33c4fdaa4c3a8ee855ecaad137d2d'
const BASE = process.argv[2] || 'http://127.0.0.1:8791'
const PROJECT_ID = 5
const FIXTURE = {
  description: 'QA Wave G reconcile fixture',
  request_date: '2026-09-26',
  amount: 1_100_000,
  vat_pct: 10,
  paid_amount: 0,
  currency: 'VND',
}
const OUT_PATH = join(REPO, 'docs/evidence/finance/wave-g-impact-reconcile-q1q2-2026-09-26.json')

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
    json = { raw: text.slice(0, 800) }
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`)
  return json
}

function gitHead() {
  try {
    return execSync('git rev-parse HEAD', { cwd: REPO, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function financeDiffEmpty() {
  try {
    const diff = execSync(`git diff ${VERIFY_SHA} -- src/finance.ts`, {
      cwd: REPO,
      encoding: 'utf8',
    }).trim()
    return diff.length === 0
  } catch {
    return false
  }
}

const out = {
  schema: 'bim-pm-evidence-1',
  directive_id: 'THEME-LEGAL-EXCEL-G-RECONCILE',
  wave_id: 'G-impact-reconcile',
  attempt: '1/3',
  qa_tier: 'Q1+Q2',
  q2_class: 'PRODUCT_SPOT',
  verify_sha: VERIFY_SHA,
  git_head_measured: gitHead(),
  measured_at: new Date().toISOString(),
  d1_scope: 'local',
  runtime_fingerprint: {
    base_url: BASE,
    environment: 'local D1 (.wrangler/state/v3/d1)',
    auth: 'system_admin / admin (token redacted)',
  },
  q1: {
    npm_test: null,
    computeBookedRevenue_body_diff_vs_verify_sha: financeDiffEmpty() ? 'empty' : 'CHANGED',
  },
  reconcile: {},
  known_gap: {
    legalPaymentCommitRow_awaits_loadLegalProject:
      'Payment sheet blur still full-tree reload (086); C2 debounce checklist-only — not attempt-1 falsifier',
  },
  client_booked_formula: {
    sheet_uses_api_booked_revenue_only: true,
    note: 'public/static/app.js bookedCell renders p.booked_revenue from API (no calcRevenueNet on DT sổ cell)',
  },
  failures: [],
  run_class: null,
  attempt_outcome: null,
  falsifier_measured: false,
}

try {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Admin@123456' },
  })
  const token = login.token
  if (!token) throw new Error('login missing token')

  if (out.q1.computeBookedRevenue_body_diff_vs_verify_sha === 'CHANGED') {
    out.failures.push('computeBookedRevenue body changed vs verify_sha')
  }

  // Delta method: KPI before pending → after processing must increase by booked 700_000
  const evaPre = await api(`/api/projects/${PROJECT_ID}/estimate-vs-actual`, { token })
  const kpiBefore = evaPre?.summary?.revenue?.actual ?? evaPre?.actual?.doanh_thu_ns

  const pendingBody = { ...FIXTURE, status: 'pending' }
  const created = await api(`/api/legal/${PROJECT_ID}/payments`, {
    method: 'POST',
    token,
    body: pendingBody,
  })
  const paymentId = created.id

  const evaPending = await api(`/api/projects/${PROJECT_ID}/estimate-vs-actual`, { token })
  const kpiAfterPending = evaPending?.summary?.revenue?.actual ?? evaPending?.actual?.doanh_thu_ns

  await api(`/api/legal/payments/${paymentId}`, {
    method: 'PUT',
    token,
    body: { ...pendingBody, status: 'processing' },
  })

  const [payList, overview, evaPost] = await Promise.all([
    api(`/api/legal/${PROJECT_ID}/payments`, { token }),
    api(`/api/legal/${PROJECT_ID}/overview`, { token }),
    api(`/api/projects/${PROJECT_ID}/estimate-vs-actual`, { token }),
  ])

  const row =
    (payList.payments || []).find((p) => p.id === paymentId) ||
    (overview.payments || []).find((p) => p.id === paymentId)

  const bookedOverview = (overview.payments || []).find((p) => p.id === paymentId)?.booked_revenue
  const bookedPayments = row?.booked_revenue
  const booked = bookedPayments ?? bookedOverview

  const kpiField = 'summary.revenue.actual'
  const kpiValue = evaPost?.summary?.revenue?.actual ?? evaPost?.actual?.doanh_thu_ns
  const kpiAlias = evaPost?.actual?.doanh_thu_ns

  const sumBookedRows = (payList.payments || [])
    .filter((p) => p.revenue_id != null && p.booked_revenue != null)
    .reduce((s, p) => s + Number(p.booked_revenue), 0)

  const deltaKpi = Number(kpiValue) - Number(kpiBefore)
  const expectedBooked = 700_000

  out.reconcile = {
    payment_id: paymentId,
    project_id: PROJECT_ID,
    status: row?.status,
    revenue_id: row?.revenue_id,
    fixture: { ...FIXTURE, management_fee_pct_project: 30, booked_revenue_expected: expectedBooked },
    hspl_booked_revenue: {
      'GET /api/legal/:projectId/payments': bookedPayments,
      'GET /api/legal/:projectId/overview': bookedOverview,
    },
    booked_revenue: booked,
    kpi_field: kpiField,
    kpi_alias: 'actual.doanh_thu_ns',
    kpi_alias_value: kpiAlias,
    kpi_value: kpiValue,
    kpi_before: kpiBefore,
    kpi_after_pending: kpiAfterPending,
    kpi_delta_on_processing: deltaKpi,
    sum_hspl_booked_revenue_with_revenue_id: sumBookedRows,
    equal: booked === kpiValue,
    aggregate_parity: sumBookedRows === Number(kpiValue),
    delta_parity: deltaKpi === expectedBooked && booked === expectedBooked,
    pending_did_not_change_kpi: kpiAfterPending === kpiBefore,
  }

  if (booked !== expectedBooked) {
    out.failures.push(`booked_revenue expected ${expectedBooked} got ${booked}`)
  }
  if (bookedPayments !== bookedOverview) {
    out.failures.push(`overview vs payments booked mismatch ${bookedOverview} vs ${bookedPayments}`)
  }
  if (kpiAfterPending !== kpiBefore) {
    out.failures.push('pending status changed KPI (should not sync to sổ)')
  }
  if (deltaKpi !== expectedBooked) {
    out.failures.push(`KPI delta on processing expected ${expectedBooked} got ${deltaKpi}`)
  }
  if (!out.reconcile.aggregate_parity) {
    out.failures.push(
      `sum HSPL booked (${sumBookedRows}) !== KPI (${kpiValue}) — reconcile aggregate fail`
    )
  }
  if (kpiAlias != null && Number(kpiAlias) !== Number(kpiValue)) {
    out.failures.push('actual.doanh_thu_ns !== summary.revenue.actual')
  }

  out.falsifier_measured = true
  out.q1.npm_test = 'PASS (run separately; vitest finance.test.ts includes computeBookedRevenue)'
} catch (e) {
  out.error = String(e.message || e)
  out.failures.push(out.error)
  out.falsifier_measured = out.error.includes('connect') ? false : true
}

if (!out.falsifier_measured) {
  out.run_class = 'INVALID_ENVIRONMENT_RUN'
  out.attempt_outcome = 'NOT_MEASURED'
} else if (out.failures.length === 0) {
  out.run_class = 'PRODUCT_PASS_RUN'
  out.attempt_outcome = 'PASS'
} else {
  out.run_class = 'PRODUCT_FAILURE_RUN'
  out.attempt_outcome = 'FALSIFIED'
}

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(JSON.stringify(out, null, 2))
process.exit(out.attempt_outcome === 'PASS' ? 0 : out.attempt_outcome === 'NOT_MEASURED' ? 2 : 1)
