/**
 * Q2 Layer B — THEME-LEGAL-EXCEL-A-SYNC-GATE (local only)
 * Usage: node scripts/qa-wave-a-sync-gate-q2.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8789'
const PROJECT_ID = 5 // management_fee_pct = 30
const FIXTURE = {
  description: 'QA Wave A sync gate fixture',
  request_date: '2026-09-15',
  amount: 1_100_000,
  vat_pct: 10,
  paid_amount: 0,
  currency: 'VND',
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
    json = { raw: text }
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`)
  return json
}

const out = {
  base: BASE,
  project_id: PROJECT_ID,
  fixture: FIXTURE,
  steps: {},
  pass: false,
  failures: [],
}

try {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Admin@123456' },
  })
  const token = login.token
  out.steps.login = { role: login.user?.role, user_id: login.user?.id }

  out.steps.revenue_audit_pre = await api('/api/finance/revenue-audit', { token })

  const resyncPre = await api('/api/legal/resync-revenues-all', { method: 'POST', token })
  out.steps.resync_all = resyncPre

  out.steps.revenue_audit_post = await api('/api/finance/revenue-audit', { token })

  const pendingBody = {
    ...FIXTURE,
    status: 'pending',
  }
  const created = await api(`/api/legal/${PROJECT_ID}/payments`, {
    method: 'POST',
    token,
    body: pendingBody,
  })
  out.steps.create_pending = created

  const payList = await api(`/api/legal/${PROJECT_ID}/payments`, { token })
  const row = (payList.payments || []).find((p) => p.id === created.id)
  out.steps.pending_row = row
    ? {
        id: row.id,
        status: row.status,
        revenue_id: row.revenue_id,
        booked_revenue: row.booked_revenue,
      }
    : null

  if (row?.revenue_id != null) {
    out.failures.push('pending: revenue_id should be null')
  }

  const processingBody = {
    ...pendingBody,
    status: 'processing',
  }
  await api(`/api/legal/payments/${created.id}`, {
    method: 'PUT',
    token,
    body: processingBody,
  })

  const payList2 = await api(`/api/legal/${PROJECT_ID}/payments`, { token })
  const row2 = (payList2.payments || []).find((p) => p.id === created.id)
  out.steps.processing_row = row2
    ? {
        id: row2.id,
        status: row2.status,
        revenue_id: row2.revenue_id,
        booked_revenue: row2.booked_revenue,
        request_date: row2.request_date,
      }
    : null

  if (row2?.booked_revenue !== 700_000) {
    out.failures.push(`processing booked_revenue expected 700000 got ${row2?.booked_revenue}`)
  }
  if (!row2?.revenue_id) {
    out.failures.push('processing: revenue_id missing')
  }

  if (row2?.revenue_id) {
    const revRows = await api(`/api/projects/${PROJECT_ID}/revenues`, { token }).catch(() => null)
    const rev = revRows?.revenues?.find((r) => r.id === row2.revenue_id)
    out.steps.revenue_row = rev
      ? {
          id: rev.id,
          amount: rev.amount,
          revenue_date: rev.revenue_date,
          payment_status: rev.payment_status,
        }
      : { note: 'revenues list unavailable or row not found', revRowsKeys: revRows ? Object.keys(revRows) : null }

    if (rev?.amount !== 700_000) {
      out.failures.push(`project_revenues.amount expected 700000 got ${rev?.amount}`)
    }
    if (rev?.revenue_date !== FIXTURE.request_date) {
      out.failures.push(
        `revenue_date expected ${FIXTURE.request_date} got ${rev?.revenue_date}`
      )
    }
  }

  out.pass = out.failures.length === 0
} catch (e) {
  out.error = String(e.message || e)
  out.failures.push(out.error)
}

console.log(JSON.stringify(out, null, 2))
process.exit(out.pass ? 0 : 1)
