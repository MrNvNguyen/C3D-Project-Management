/**
 * Local product QA — D1 local only (http://127.0.0.1:8788).
 * Deletes every project, creates 3 fixtures, exercises main flows.
 * Does not print tokens.
 */
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8788'
const findings = []
const steps = []

function note(severity, area, message, extra) {
  findings.push({ severity, area, message, extra: extra ?? null })
}

async function call(token, method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  const text = await res.text()
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text.slice(0, 300) } }
  return { status: res.status, json }
}

function expect(name, ok, detail) {
  steps.push({ name, ok: !!ok, detail: detail ?? null })
  if (!ok) note('fail', name, detail || 'assertion failed')
}

async function login(username, password) {
  const r = await call(null, 'POST', '/api/auth/login', { username, password })
  if (r.status !== 200 || !r.json?.token) {
    throw new Error(`login ${username} HTTP ${r.status} ${r.json?.error || ''}`)
  }
  return { token: r.json.token, user: r.json.user }
}

async function main() {
  const status = await call(null, 'GET', '/api/preview/status')
  expect('preview status local', status.status === 200 && status.json?.d1_ok === true && status.json?.host === '127.0.0.1',
    JSON.stringify({ status: status.status, host: status.json?.host, d1_ok: status.json?.d1_ok }))
  if (status.json?.host && status.json.host !== '127.0.0.1' && status.json.host !== 'localhost') {
    throw new Error('Refusing to run: host is not local')
  }

  const admin = await login('admin', 'Admin@123456')
  const users = await call(admin.token, 'GET', '/api/users')
  const list = Array.isArray(users.json) ? users.json : users.json?.users || users.json?.data || []
  expect('GET /api/users', users.status === 200 && list.length >= 1, `HTTP ${users.status} n=${list.length}`)
  const byName = Object.fromEntries(list.map(u => [u.username, u]))

  async function ensureUser(username, role, fullName) {
    let row = byName[username]
    if (!row) {
      const createdUser = await call(admin.token, 'POST', '/api/users', {
        username, password: 'Bim@2024', full_name: fullName, role, department: 'QA',
      })
      if (createdUser.status !== 201) throw new Error(`create ${username} HTTP ${createdUser.status} ${createdUser.json?.error || ''}`)
      row = { id: createdUser.json.id, username, role }
      byName[username] = row
    } else {
      await call(admin.token, 'POST', `/api/users/${row.id}/reset-password`, { password: 'Bim@2024' })
    }
    return login(username, 'Bim@2024')
  }

  const memberA = await ensureUser('nguyen.van.a', 'member', 'Nguyễn Văn A')
  const memberB = await ensureUser('tran.thi.b', 'member', 'Trần Thị B')
  const leader = await ensureUser('le.van.c', 'project_leader', 'Lê Văn C')
  const pAdmin = await ensureUser('pham.thi.d', 'project_admin', 'Phạm Thị D')
  expect('logins', true, `admin=${admin.user.role} member=${memberA.user.role} leader=${leader.user.role} padmin=${pAdmin.user.role}`)

  const before = await call(admin.token, 'GET', '/api/projects')
  const projects = Array.isArray(before.json) ? before.json : before.json?.projects || []
  expect('list projects before delete', before.status === 200, `HTTP ${before.status} n=${projects.length}`)

  const deleteFails = []
  for (const p of projects) {
    const d = await call(admin.token, 'DELETE', `/api/projects/${p.id}`)
    if (d.status !== 200) deleteFails.push({ id: p.id, code: p.code, status: d.status, error: d.json?.error })
  }
  expect('delete all projects', deleteFails.length === 0, deleteFails.length ? JSON.stringify(deleteFails.slice(0, 5)) : `deleted ${projects.length}`)

  const after = await call(admin.token, 'GET', '/api/projects')
  const left = Array.isArray(after.json) ? after.json : []
  expect('projects empty', after.status === 200 && left.length === 0, `left=${left.length}`)

  const memberCreate = await call(memberA.token, 'POST', '/api/projects', { code: 'QA-NOPE', name: 'Member cannot create' })
  expect('member cannot create project', memberCreate.status === 403, `HTTP ${memberCreate.status}`)

  const specs = [
    { code: 'QA-TWR', name: 'QA Tòa OneCad', project_type: 'building', status: 'active', client: 'QA Client', start_date: '2026-09-01', end_date: '2026-12-31', contract_value: 5000000000, management_fee_pct: 10, location: 'Hà Nội', admin_id: byName['pham.thi.d']?.id, leader_id: byName['le.van.c']?.id },
    { code: 'QA-BRG', name: 'QA Cầu QL1A', project_type: 'transportation', status: 'active', client: 'QA GTVT', start_date: '2026-09-01', end_date: '2027-06-30', contract_value: 12000000000, management_fee_pct: 5, location: 'Quốc lộ 1A', admin_id: byName['pham.thi.d']?.id, leader_id: byName['le.van.c']?.id },
    { code: 'QA-ECO', name: 'QA Eco City', project_type: 'building', status: 'planning', client: 'QA Eco', start_date: '2026-10-01', end_date: '2027-12-31', contract_value: 8000000000, management_fee_pct: 0, location: 'Hưng Yên' },
  ]
  const created = []
  for (const s of specs) {
    const r = await call(admin.token, 'POST', '/api/projects', s)
    expect(`create ${s.code}`, r.status === 201 && r.json?.id, `HTTP ${r.status} ${r.json?.error || r.json?.id}`)
    if (r.json?.id) created.push({ ...s, id: r.json.id })
  }
  const dup = await call(admin.token, 'POST', '/api/projects', { code: 'QA-TWR', name: 'Dup' })
  expect('duplicate code 409', dup.status === 409, `HTTP ${dup.status} ${dup.json?.error || ''}`)

  if (created.length < 3) throw new Error('Could not create 3 projects')
  const [twr, brg, eco] = created

  for (const uid of [byName['nguyen.van.a']?.id, byName['tran.thi.b']?.id].filter(Boolean)) {
    const m = await call(admin.token, 'POST', `/api/projects/${twr.id}/members`, { user_id: uid, role: 'member' })
    expect(`add member ${uid} to TWR`, m.status === 200 || m.status === 201, `HTTP ${m.status} ${m.json?.error || ''}`)
  }
  if (byName['le.van.c']?.id) {
    await call(admin.token, 'POST', `/api/projects/${brg.id}/members`, { user_id: byName['le.van.c'].id, role: 'project_leader' })
  }

  const detail = await call(admin.token, 'GET', `/api/projects/${twr.id}`)
  const expectedBudget = Math.round(5000000000 * (1 - 10 / 100))
  expect('TWR project_budget 4.5 tỷ', detail.status === 200 && Number(detail.json?.project_budget) === expectedBudget,
    `HTTP ${detail.status} budget=${detail.json?.project_budget} expected=${expectedBudget}`)

  const cross = await call(memberA.token, 'GET', `/api/projects/${brg.id}`)
  expect('member A cannot read project B', cross.status === 403, `HTTP ${cross.status}`)

  const cat = await call(admin.token, 'POST', '/api/categories', { project_id: twr.id, name: 'Kiến trúc', code: 'CAT-AA', discipline_code: 'AA' })
  expect('create category', cat.status === 201, `HTTP ${cat.status} ${cat.json?.error || ''}`)
  const task = await call(admin.token, 'POST', '/api/tasks', {
    project_id: twr.id, category_id: cat.json?.id, title: 'QA mặt bằng tầng 1', discipline_code: 'AA',
    priority: 'high', status: 'todo', assigned_to: byName['nguyen.van.a']?.id,
    start_date: '2026-09-28', due_date: '2026-10-15', estimated_hours: 16,
  })
  expect('create task', task.status === 201, `HTTP ${task.status} ${task.json?.error || ''}`)
  const task2 = await call(leader.token, 'POST', '/api/tasks', {
    project_id: brg.id, title: 'QA khảo sát cầu', discipline_code: 'CT', priority: 'medium', status: 'in_progress',
    assigned_to: byName['le.van.c']?.id, start_date: '2026-09-28', due_date: '2026-10-20', estimated_hours: 8,
  })
  expect('leader creates task on BRG', task2.status === 201, `HTTP ${task2.status} ${task2.json?.error || ''}`)

  const outsiderTask = await call(memberA.token, 'POST', '/api/tasks', { project_id: brg.id, title: 'Should fail' })
  expect('member A cannot create task on BRG', outsiderTask.status === 403, `HTTP ${outsiderTask.status}`)

  const workDate = '2026-09-28'
  const ts1 = await call(memberA.token, 'POST', '/api/timesheets', {
    project_id: twr.id, task_id: task.json?.id, work_date: workDate, regular_hours: 4, overtime_hours: 0, description: 'QA tower',
  })
  const ts2 = await call(memberA.token, 'POST', '/api/timesheets', {
    project_id: brg.id, work_date: workDate, regular_hours: 4, overtime_hours: 0, description: 'QA bridge',
  })
  expect('timesheet two projects same day', (ts1.status === 201 || ts1.status === 200) && (ts2.status === 201 || ts2.status === 200),
    `ts1=${ts1.status} ${ts1.json?.error || ts1.json?.action} ts2=${ts2.status} ${ts2.json?.error || ts2.json?.action}`)
  if ((ts1.status === 201 || ts1.status === 200) && (ts2.status === 201 || ts2.status === 200) && ts1.json?.id && ts2.json?.id && ts1.json.id === ts2.json.id) {
    note('fail', 'timesheet', 'Hai dự án cùng ngày ghi đè cùng một id', { id: ts1.json.id })
  }

  const over = await call(memberA.token, 'POST', '/api/timesheets', {
    project_id: eco.id, work_date: workDate, regular_hours: 8, overtime_hours: 0, description: 'over cap',
  })
  expect('timesheet over daily cap rejected', over.status === 422, `HTTP ${over.status} ${over.json?.error || ''}`)

  const memberDel = await call(memberA.token, 'DELETE', `/api/projects/${eco.id}`)
  expect('member cannot delete project', memberDel.status === 403, `HTTP ${memberDel.status}`)

  const costDeny = await call(memberA.token, 'POST', '/api/costs', {
    project_id: twr.id, cost_type: 'other', description: 'QA chi phí', amount: 1000000, cost_date: '2026-09-28',
  })
  expect('member cannot add cost', costDeny.status === 403, `HTTP ${costDeny.status}`)

  const cost = await call(admin.token, 'POST', '/api/costs', {
    project_id: twr.id, cost_type: 'other', description: 'QA chi phí vật tư', amount: 25000000, cost_date: '2026-09-28', vendor: 'QA Vendor',
  })
  expect('admin add cost', cost.status === 201, `HTTP ${cost.status} ${cost.json?.error || ''}`)

  const legal = await call(admin.token, 'POST', `/api/legal/init/${twr.id}`)
  expect('legal init', legal.status === 200, `HTTP ${legal.status} ${legal.json?.error || JSON.stringify(legal.json)?.slice(0, 180)}`)
  const overview = await call(admin.token, 'GET', `/api/legal/${twr.id}/overview`)
  const ovBudget = overview.json?.project?.project_budget ?? overview.json?.project_budget
  expect('legal overview', overview.status === 200, `HTTP ${overview.status} budget=${ovBudget}`)
  if (overview.status === 200 && ovBudget != null && Number(ovBudget) !== expectedBudget) {
    note('fail', 'legal budget', `overview project_budget ${ovBudget} ≠ ${expectedBudget}`)
  }

  const pay = await call(admin.token, 'POST', `/api/legal/${twr.id}/payments`, {
    description: 'QA đợt 1', request_number: 'QA-TT-01', request_date: '2026-09-28',
    amount: 100000000, vat_pct: 10, status: 'paid', paid_amount: 110000000, paid_date: '2026-09-28',
  })
  expect('create payment', pay.status === 200 || pay.status === 201, `HTTP ${pay.status} ${pay.json?.error || ''}`)

  const fin = await call(admin.token, 'GET', `/api/finance/project/${twr.id}`)
  const crs = await call(admin.token, 'GET', `/api/projects/${twr.id}/costs-revenue-summary`)
  const eva = await call(admin.token, 'GET', `/api/projects/${twr.id}/estimate-vs-actual`)
  expect('finance endpoints 200', fin.status === 200 && crs.status === 200 && eva.status === 200,
    `fin=${fin.status} crs=${crs.status} eva=${eva.status} ${fin.json?.error || crs.json?.error || ''}`)

  function pickMoney(obj) {
    if (!obj || typeof obj !== 'object') return null
    const keys = ['booked_revenue', 'cash_collected', 'acceptance_amount', 'bookedRevenue', 'cashCollected']
    const out = {}
    for (const k of keys) if (obj[k] != null) out[k] = obj[k]
    return out
  }
  const money = {
    finance: pickMoney(fin.json) || pickMoney(fin.json?.summary) || pickMoney(fin.json?.project),
    crs: pickMoney(crs.json) || pickMoney(crs.json?.summary),
  }
  steps.push({ name: 'money snapshot', ok: true, detail: JSON.stringify(money) })

  const leave = await call(memberA.token, 'POST', '/api/leave-requests', {
    leave_type: 'annual_leave', start_date: '2026-10-05', end_date: '2026-10-06', reason: 'QA nghỉ phép',
  })
  expect('leave request', leave.status === 200 || leave.status === 201, `HTTP ${leave.status} ${leave.json?.error || ''}`)
  if (leave.json?.id) {
    const rev = await call(admin.token, 'POST', `/api/leave-requests/${leave.json.id}/review`, { action: 'approve', note: 'QA' })
    expect('leave approve', rev.status === 200, `HTTP ${rev.status} ${rev.json?.error || ''}`)
  }

  const plan = await call(admin.token, 'POST', `/api/projects/${twr.id}/weekly-plans`, {
    week_date: '2026-09-28', title: 'QA tuần 40', overall_goal: 'Hoàn thành mặt bằng',
    items: [{ description: 'Vẽ mặt bằng', priority: 'high', assignee_ids: [byName['nguyen.van.a']?.id].filter(Boolean) }],
  })
  expect('weekly plan', plan.status === 200 || plan.status === 201, `HTTP ${plan.status} ${plan.json?.error || ''}`)

  const dash = await call(admin.token, 'GET', '/api/dashboard/stats')
  expect('dashboard stats', dash.status === 200, `HTTP ${dash.status} ${dash.json?.error || ''}`)
  const exec = await call(admin.token, 'GET', '/api/executive/projects')
  const execList = Array.isArray(exec.json) ? exec.json : exec.json?.projects
  expect('executive projects', exec.status === 200 && Array.isArray(execList) && execList.length >= 3, `HTTP ${exec.status} n=${execList?.length}`)
  const memberExec = await call(memberA.token, 'GET', '/api/executive/projects')
  expect('member executive denied or scoped', memberExec.status === 403 || memberExec.status === 200, `HTTP ${memberExec.status}`)
  if (memberExec.status === 200) {
    const ml = Array.isArray(memberExec.json) ? memberExec.json : memberExec.json?.projects || []
    const seesBridge = ml.some(p => p.code === 'QA-BRG' || p.id === brg.id)
    if (seesBridge) note('fail', 'rbac executive', 'Member A thấy dự án QA-BRG dù không phải thành viên')
    else steps.push({ name: 'member executive scoped', ok: true, detail: `n=${ml.length}` })
  }

  const notif = await call(memberA.token, 'GET', '/api/notifications/summary')
  expect('notification summary', notif.status === 200, `HTTP ${notif.status}`)
  const disciplines = await call(admin.token, 'GET', '/api/disciplines')
  const dlist = Array.isArray(disciplines.json) ? disciplines.json : disciplines.json?.disciplines
  expect('disciplines', disciplines.status === 200 && Array.isArray(dlist) && dlist.length > 0, `HTTP ${disciplines.status} n=${dlist?.length}`)

  const tasks = await call(admin.token, 'GET', `/api/tasks?project_id=${twr.id}&limit=50`)
  const tlist = Array.isArray(tasks.json) ? tasks.json : tasks.json?.tasks || tasks.json?.data
  expect('list tasks', tasks.status === 200 && Array.isArray(tlist) && tlist.length >= 1, `HTTP ${tasks.status}`)
  if (Array.isArray(tlist) && tlist.some(t => t.attachments && String(t.attachments).length > 20)) {
    note('fail', 'tasks payload', 'GET /api/tasks trả attachments lớn')
  }

  const slim = await call(admin.token, 'GET', '/api/projects?fields=slim')
  expect('projects slim', slim.status === 200, `HTTP ${slim.status}`)

  const renamed = await call(admin.token, 'PUT', `/api/projects/${eco.id}`, { status: 'active', name: 'QA Eco City (active)' })
  expect('update project status', renamed.status === 200, `HTTP ${renamed.status} ${renamed.json?.error || ''}`)

  const delEco = await call(admin.token, 'DELETE', `/api/projects/${eco.id}`)
  expect('delete ECO cascade', delEco.status === 200, `HTTP ${delEco.status} ${delEco.json?.error || ''}`)
  const gone = await call(admin.token, 'GET', `/api/projects/${eco.id}`)
  expect('deleted project 404', gone.status === 404, `HTTP ${gone.status}`)

  const finalList = await call(admin.token, 'GET', '/api/projects')
  const finals = Array.isArray(finalList.json) ? finalList.json : []
  const codes = finals.map(p => p.code).sort()
  expect('remaining QA-TWR + QA-BRG', codes.includes('QA-TWR') && codes.includes('QA-BRG') && !codes.includes('QA-ECO'), codes.join(','))

  const fails = steps.filter(s => !s.ok)
  const summary = {
    base: BASE,
    host: status.json?.host,
    deleted_before: projects.length,
    created: created.map(p => ({ id: p.id, code: p.code })),
    remaining: codes,
    steps_pass: steps.filter(s => s.ok).length,
    steps_fail: fails.length,
    findings,
    steps,
  }
  console.log(JSON.stringify(summary, null, 2))
  if (fails.length) process.exitCode = 2
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
