/** Follow-up after main QA: timesheet 2 projects, leave approve, money fields, recreate ECO. */
const BASE = 'http://127.0.0.1:8788'
async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text.slice(0, 200) } }
  return { status: res.status, json }
}
const admin = await call(null, 'POST', '/api/auth/login', { username: 'admin', password: 'Admin@123456' })
const member = await call(null, 'POST', '/api/auth/login', { username: 'nguyen.van.a', password: 'Bim@2024' })
const AT = admin.json.token
const MT = member.json.token
const projects = await call(AT, 'GET', '/api/projects')
const byCode = Object.fromEntries(projects.json.map(p => [p.code, p]))
const users = await call(AT, 'GET', '/api/users')
const memberId = users.json.find(u => u.username === 'nguyen.van.a').id
const out = {}

if (!byCode['QA-ECO']) {
  const eco = await call(AT, 'POST', '/api/projects', {
    code: 'QA-ECO', name: 'QA Eco City', project_type: 'building', status: 'planning',
    client: 'QA Eco', start_date: '2026-10-01', end_date: '2027-12-31',
    contract_value: 8000000000, management_fee_pct: 0, location: 'Hưng Yên',
  })
  out.recreateEco = { status: eco.status, id: eco.json?.id, error: eco.json?.error }
  if (eco.json?.id) byCode['QA-ECO'] = { id: eco.json.id, code: 'QA-ECO' }
}

for (const code of ['QA-BRG', 'QA-ECO']) {
  const add = await call(AT, 'POST', `/api/projects/${byCode[code].id}/members`, { user_id: memberId, role: 'member' })
  out['member_' + code] = add.status
}

const workDate = '2026-09-28'
const ts1 = await call(MT, 'POST', '/api/timesheets', { project_id: byCode['QA-TWR'].id, work_date: workDate, regular_hours: 4, overtime_hours: 0, description: 'QA tower' })
const ts2 = await call(MT, 'POST', '/api/timesheets', { project_id: byCode['QA-BRG'].id, work_date: workDate, regular_hours: 4, overtime_hours: 0, description: 'QA bridge' })
out.timesheets = {
  ts1: { status: ts1.status, id: ts1.json?.id, action: ts1.json?.action, error: ts1.json?.error },
  ts2: { status: ts2.status, id: ts2.json?.id, action: ts2.json?.action, error: ts2.json?.error },
  sameId: ts1.json?.id && ts1.json.id === ts2.json?.id,
}
const list = await call(AT, 'GET', `/api/timesheets?user_id=${memberId}&from=${workDate}&to=${workDate}`)
const rows = Array.isArray(list.json) ? list.json : list.json?.timesheets || list.json?.data || []
out.timesheetList = { status: list.status, n: Array.isArray(rows) ? rows.length : null, keys: list.json && !Array.isArray(list.json) ? Object.keys(list.json).slice(0, 12) : null }
const over = await call(MT, 'POST', '/api/timesheets', { project_id: byCode['QA-ECO'].id, work_date: workDate, regular_hours: 8, overtime_hours: 0, description: 'over' })
out.overCap = { status: over.status, error: over.json?.error }

const leaves = await call(AT, 'GET', '/api/leave-requests')
const pending = (Array.isArray(leaves.json) ? leaves.json : leaves.json?.requests || []).find(l => l.status === 'pending')
out.leaveList = { status: leaves.status, pendingId: pending?.id || null }
if (pending) {
  const rev = await call(AT, 'POST', `/api/leave-requests/${pending.id}/review`, { status: 'approved', review_note: 'QA' })
  out.leaveApprove = { status: rev.status, error: rev.json?.error, auto: rev.json?.auto_created_timesheets }
}

function dig(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return {}
  const hit = {}
  for (const k of Object.keys(obj)) {
    if (keys.includes(k)) hit[k] = obj[k]
    else if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) Object.assign(hit, dig(obj[k], keys, depth + 1))
  }
  return hit
}
const moneyKeys = ['booked_revenue', 'cash_collected', 'acceptance_amount', 'revenue', 'paid_amount', 'project_budget']
const fin = await call(AT, 'GET', `/api/finance/project/${byCode['QA-TWR'].id}`)
const crs = await call(AT, 'GET', `/api/projects/${byCode['QA-TWR'].id}/costs-revenue-summary`)
out.money = {
  finStatus: fin.status,
  finTop: fin.json ? Object.keys(fin.json).slice(0, 20) : null,
  finMoney: dig(fin.json, moneyKeys),
  crsStatus: crs.status,
  crsTop: crs.json ? Object.keys(crs.json).slice(0, 20) : null,
  crsMoney: dig(crs.json, moneyKeys),
}
const final = await call(AT, 'GET', '/api/projects')
out.projects = final.json.map(p => ({ id: p.id, code: p.code, name: p.name, status: p.status, contract_value: p.contract_value }))
console.log(JSON.stringify(out, null, 2))
