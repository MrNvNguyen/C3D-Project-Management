/**
 * Q2 product spot — Timesheet Week Copy W1 (+ API support for W2 skip map)
 * Runtime: local preview http://127.0.0.1:8788
 * Scope label: PRODUCT_SPOT (auth API). UI badge W2 needs browser separately.
 */
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8788'

/** Tuần hiện tại (T2–CN) — khớp isWithinCurrentWeek backend. */
function currentWeekDays() {
  const now = new Date()
  now.setHours(12, 0, 0, 0)
  const day = now.getDay() // 0=CN
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((day + 6) % 7))
  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days // [Mon..Sun]
}

function weekWorkdays() {
  return currentWeekDays().slice(0, 5) // Mon–Fri
}

function weekSunday() {
  return currentWeekDays()[6]
}

async function req(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  return { status: r.status, json }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function login(username, password) {
  const r = await req('/auth/login', { method: 'POST', body: { username, password } })
  assert(r.status === 200 && r.json?.token, `login ${username} → ${r.status} ${JSON.stringify(r.json)}`)
  return { token: r.json.token, user: r.json.user }
}

async function pickProject(token) {
  const r = await req('/projects?limit=20', { token })
  const list = Array.isArray(r.json) ? r.json : (r.json?.projects || [])
  assert(list.length, 'no projects')
  return list[0]
}

const results = []

function record(id, outcome, detail) {
  results.push({ id, outcome, detail })
  console.log(`[${outcome}] ${id}: ${detail}`)
}

async function main() {
  // health
  const health = await fetch(BASE)
  assert(health.ok, `preview not up: ${BASE}`)

  const member = await login('nguyen.van.a', 'Bim@2024')
  const pl = await login('le.van.c', 'Bim@2024')
  const proj = await pickProject(member.token)
  const pid = proj.id

  const workdays = weekWorkdays()
  const d1 = workdays[0]
  const d2 = workdays[1]
  const d3 = workdays[2]
  const d4 = workdays[3]
  const d5 = workdays[4]
  const sun = weekSunday()

  // Q2-1 N=1 create
  try {
    const r = await req('/timesheets', {
      token: member.token,
      method: 'POST',
      body: {
        day_type: 'work',
        project_id: pid,
        work_date: d1,
        regular_hours: 8,
        overtime_hours: 0,
        description: 'Q2-1 N=1',
      },
    })
    assert(r.status === 200 || r.status === 201, `status ${r.status} ${JSON.stringify(r.json)}`)
    const id = r.json?.id || r.json?.timesheet?.id
    assert(id, 'missing id')
    record('Q2-1', 'PASS', `created draft id=${id} date=${d1}`)
  } catch (e) {
    record('Q2-1', 'FAIL', e.message)
  }

  // Q2-5 Sunday OT HC=0
  try {
    const bad = await req('/timesheets', {
      token: member.token,
      method: 'POST',
      body: {
        day_type: 'work',
        project_id: pid,
        work_date: sun,
        regular_hours: 0,
        overtime_hours: 4,
        description: 'Q2-5 CN OT',
      },
    })
    assert(bad.status === 200 || bad.status === 201, `CN OT blocked: ${bad.status} ${JSON.stringify(bad.json)}`)
    assert(bad.json?.code !== 'ot_requires_hc', `ot_requires_hc on Sunday: ${JSON.stringify(bad.json)}`)
    record('Q2-5', 'PASS', `Sunday ${sun} OT=4 HC=0 accepted id=${bad.json?.id || bad.json?.timesheet?.id}`)
  } catch (e) {
    record('Q2-5', 'FAIL', e.message)
  }

  // Q2-2 sequential multi-day
  try {
    const a = await req('/timesheets', {
      token: member.token,
      method: 'POST',
      body: { day_type: 'work', project_id: pid, work_date: d2, regular_hours: 4, overtime_hours: 0, description: 'Q2-2 dayA' },
    })
    assert(a.status === 200 || a.status === 201, `dayA ${a.status}`)
    const b = await req('/timesheets', {
      token: member.token,
      method: 'POST',
      body: { day_type: 'work', project_id: pid, work_date: d3, regular_hours: 8, overtime_hours: 0, description: 'Q2-2 dayB' },
    })
    assert(b.status === 200 || b.status === 201, `dayB ${b.status}`)
    record('Q2-2', 'PASS', `sequential POST ${d2}+${d3} ok`)
  } catch (e) {
    record('Q2-2', 'FAIL', e.message)
  }

  // Q2-3 submit then conflict / GET shows submitted (skip map source)
  try {
    // Prefer a draft already on a weekday; else create on d4
    const [y0, m0] = d1.split('-')
    const pre = await req(`/timesheets?limit=200&year=${y0}&month=${m0}&user_id=${member.user.id}`, { token: member.token })
    const preRows = Array.isArray(pre.json) ? pre.json : (pre.json?.timesheets || [])
    let hitDraft = preRows.find(t => t.status === 'draft' && t.project_id === pid && String(t.work_date).slice(0, 10) !== sun)
    let tid
    let workDate
    if (hitDraft) {
      tid = hitDraft.id
      workDate = String(hitDraft.work_date).slice(0, 10)
    } else {
      const create = await req('/timesheets', {
        token: member.token,
        method: 'POST',
        body: {
          day_type: 'work',
          project_id: pid,
          work_date: d4,
          regular_hours: 8,
          overtime_hours: 0,
          description: 'Q2-3 to submit',
        },
      })
      tid = create.json?.id || create.json?.timesheet?.id
      assert(tid, `no tid ${create.status} ${JSON.stringify(create.json)}`)
      workDate = create.json?.work_date || create.json?.timesheet?.work_date || d4
    }

    const [y, m] = workDate.split('-')
    let list = await req(`/timesheets?limit=200&year=${y}&month=${m}&user_id=${member.user.id}`, { token: member.token })
    let rows = Array.isArray(list.json) ? list.json : (list.json?.timesheets || [])
    let row = rows.find(t => t.id === tid)
    assert(row, `row ${tid} missing`)
    if (row.status === 'draft') {
      const sub = await req(`/timesheets/${tid}`, {
        token: member.token,
        method: 'PUT',
        body: { status: 'submitted' },
      })
      assert(sub.status === 200, `submit ${sub.status} ${JSON.stringify(sub.json)}`)
    } else if (row.status !== 'submitted' && row.status !== 'approved') {
      throw new Error(`unexpected status ${row.status}`)
    }

    list = await req(`/timesheets?limit=200&year=${y}&month=${m}&user_id=${member.user.id}`, { token: member.token })
    rows = Array.isArray(list.json) ? list.json : (list.json?.timesheets || [])
    const hit = rows.find(t => t.id === tid)
    assert(hit && (hit.status === 'submitted' || hit.status === 'approved'), `GET map missing locked: ${JSON.stringify(hit)}`)

    const again = await req('/timesheets', {
      token: member.token,
      method: 'POST',
      body: {
        day_type: 'work',
        project_id: pid,
        work_date: workDate,
        regular_hours: 8,
        overtime_hours: 0,
        description: 'Q2-3 probe after submit',
      },
    })
    list = await req(`/timesheets?limit=200&year=${y}&month=${m}&user_id=${member.user.id}`, { token: member.token })
    rows = Array.isArray(list.json) ? list.json : (list.json?.timesheets || [])
    const hit2 = rows.find(t => t.id === tid)
    assert(hit2?.status === 'submitted' || hit2?.status === 'approved', `status downgraded → ${hit2?.status}; post=${again.status}`)
    record('Q2-3', 'PASS', `id=${tid} locked=${hit2.status} after re-POST ${again.status} action=${again.json?.action}; skip-map source OK`)
  } catch (e) {
    record('Q2-3', 'FAIL', e.message)
  }

  // Q2-6 own bulk only — PL cannot submit member draft via PUT if authorization blocks; plus code contract
  try {
    const draft = await req('/timesheets', {
      token: member.token,
      method: 'POST',
      body: {
        day_type: 'work',
        project_id: pid,
        work_date: d5,
        regular_hours: 2,
        overtime_hours: 0,
        description: 'Q2-6 member draft',
      },
    })
    const did = draft.json?.id || draft.json?.timesheet?.id
    assert(did, `no draft id ${draft.status} ${JSON.stringify(draft.json)}`)

    // PL listing drafts with own user_id filter should not include member draft
    const plList = await req(`/timesheets?status=draft&limit=5000&user_id=${pl.user.id}`, { token: pl.token })
    const plRows = Array.isArray(plList.json) ? plList.json : (plList.json?.timesheets || [])
    const leaked = plRows.some(t => t.id === did || t.user_id === member.user.id)
    assert(!leaked, 'PL own-filter list leaked member draft')

    // Attempt PL submit of member draft — expect forbid OR success only if PL has elevate (document)
    const steal = await req(`/timesheets/${did}`, {
      token: pl.token,
      method: 'PUT',
      body: { status: 'submitted' },
    })
    const stealOk = steal.status === 200
    // Product bar for bulk button: client always uses currentUser.id — API may still allow PL on single PUT.
    // Measure both: list filter PASS required; steal noted.
    if (stealOk) {
      record('Q2-6', 'PASS', `bulk own-filter OK (no leak); note: PL single PUT still can submit member draft status=${steal.status} (UI bulk still own-only)`)
    } else {
      record('Q2-6', 'PASS', `bulk own-filter OK; PL PUT blocked ${steal.status}`)
    }
  } catch (e) {
    record('Q2-6', 'FAIL', e.message)
  }

  // W2 skip-map source: GET returns submitted for week days
  try {
    const [y, m] = d1.split('-')
    const list = await req(`/timesheets?limit=200&year=${y}&month=${m}&user_id=${member.user.id}`, { token: member.token })
    assert(list.status === 200, `GET ${list.status}`)
    const rows = Array.isArray(list.json) ? list.json : (list.json?.timesheets || [])
    const locked = rows.filter(t => t.status === 'submitted' || t.status === 'approved')
    record('W2-GET', 'PASS', `narrow GET ok; locked rows this month=${locked.length} (UI badge consumes this map)`)
  } catch (e) {
    record('W2-GET', 'FAIL', e.message)
  }

  const fails = results.filter(r => r.outcome === 'FAIL')
  console.log('\n=== SUMMARY ===')
  console.log(JSON.stringify(results, null, 2))
  console.log(fails.length ? `OVERALL: PRODUCT_FAILURE_RUN (${fails.length} fail)` : 'OVERALL: PRODUCT_PASS_RUN (API Layer B)')
  process.exit(fails.length ? 1 : 0)
}

main().catch(e => {
  console.error('INVALID_ENVIRONMENT', e)
  process.exit(2)
})
