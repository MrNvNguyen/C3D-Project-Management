const BASE = 'http://127.0.0.1:8788'
async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text.slice(0, 240) } }
  return { status: res.status, json }
}
const admin = (await call(null, 'POST', '/api/auth/login', { username: 'admin', password: 'Admin@123456' })).json
const AT = admin.token
const projects = (await call(AT, 'GET', '/api/projects')).json
const twr = projects.find(p => p.code === 'QA-TWR')
const fin = await call(AT, 'GET', `/api/finance/project/${twr.id}`)
const crs = await call(AT, 'GET', `/api/projects/${twr.id}/costs-revenue-summary`)
const leaves = await call(AT, 'GET', '/api/leave-requests?status=pending')
const pending = leaves.json?.data?.[0]
let leaveApprove = null
if (pending) {
  leaveApprove = await call(AT, 'POST', `/api/leave-requests/${pending.id}/review`, { status: 'approved', review_note: 'QA' })
}
const plans = await call(AT, 'GET', `/api/projects/${twr.id}/weekly-plans`)
const tmp = await call(AT, 'POST', '/api/projects', { code: 'QA-DEL', name: 'QA xóa cascade', contract_value: 1000, management_fee_pct: 0 })
let cascade = null
if (tmp.json?.id) {
  const pay = await call(AT, 'POST', `/api/legal/${tmp.json.id}/payments`, { description: 'QA xóa', amount: 1000, vat_pct: 0, status: 'pending' })
  const plan = await call(AT, 'POST', `/api/projects/${tmp.json.id}/weekly-plans`, { week_date: '2026-09-28', items: [{ description: 'mục xóa' }] })
  const del = await call(AT, 'DELETE', `/api/projects/${tmp.json.id}`)
  const payAfter = await call(AT, 'GET', `/api/legal/${tmp.json.id}/payments`)
  cascade = {
    create: tmp.status, pay: pay.status, plan: plan.status, del: { status: del.status, error: del.json?.error },
    paymentsAfter: { status: payAfter.status, n: Array.isArray(payAfter.json) ? payAfter.json.length : payAfter.json?.payments?.length ?? payAfter.json?.data?.length ?? null, error: payAfter.json?.error },
  }
}
console.log(JSON.stringify({
  finance_total_revenue: fin.json?.summary?.total_revenue,
  finance_pending: fin.json?.summary?.pending_revenue,
  crs_revenue: crs.json?.financial?.revenue,
  leavePending: pending ? { id: pending.id, status: pending.status } : null,
  leaveApprove: leaveApprove ? { status: leaveApprove.status, error: leaveApprove.json?.error, auto: leaveApprove.json?.auto_created_timesheets } : 'no pending',
  weeklyPlans: { status: plans.status, sample: Array.isArray(plans.json) ? plans.json[0] : plans.json?.plans?.[0] || plans.json },
  cascade,
}, null, 2))
