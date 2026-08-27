/**
 * Pre-deploy smoke runner — Layer B spot checks against local Worker + D1.
 * Redacts tokens in UI; never logs Bearer to console.
 */
(function () {
  const $ = (id) => document.getElementById(id)
  const resultsEl = $('results')
  const summaryEl = $('summary')
  let token = null

  function icon(status) {
    if (status === 'pass') return '<i class="fas fa-check-circle check-pass"></i>'
    if (status === 'fail') return '<i class="fas fa-times-circle check-fail"></i>'
    if (status === 'warn') return '<i class="fas fa-exclamation-circle check-warn"></i>'
    return '<i class="fas fa-circle-notch fa-spin check-pending"></i>'
  }

  function row(id, label, status, detail) {
    return `<div class="result-row px-5 py-3 flex gap-3 items-start" data-id="${id}">
      <span class="mt-0.5 w-5">${icon(status)}</span>
      <div class="flex-1 min-w-0">
        <div class="font-medium text-gray-800">${label}</div>
        ${detail ? `<div class="text-gray-500 text-xs mt-0.5 break-all">${detail}</div>` : ''}
      </div>
    </div>`
  }

  function setRow(id, status, detail) {
    const el = resultsEl.querySelector(`[data-id="${id}"]`)
    if (!el) return
    el.querySelector('span').innerHTML = icon(status)
    const detailEl = el.querySelector('.text-gray-500')
    if (detailEl) detailEl.textContent = detail || ''
    else if (detail) {
      const d = document.createElement('div')
      d.className = 'text-gray-500 text-xs mt-0.5 break-all'
      d.textContent = detail
      el.querySelector('.flex-1').appendChild(d)
    }
  }

  async function fetchJson(path, opts = {}) {
    const res = await fetch(path, opts)
    let body = null
    try { body = await res.json() } catch { body = null }
    return { ok: res.ok, status: res.status, body }
  }

  async function loadFingerprint() {
    $('fp-url').textContent = window.location.origin
    $('fp-time').textContent = new Date().toLocaleString('vi-VN')
    $('preview-url').textContent = window.location.origin + '/preview'

    const host = window.location.hostname
    const isLocal = host === 'localhost' || host === '127.0.0.1'
    $('env-badge').textContent = isLocal ? 'LOCAL' : host

    const { ok, body } = await fetchJson('/api/preview/status')
    if (!ok) {
      $('fp-d1').innerHTML = '<span class="check-warn">Không đọc được /api/preview/status</span>'
      $('fp-r2').textContent = '—'
      return
    }
    $('fp-d1').innerHTML = body.d1_ok
      ? '<span class="check-pass">Bound + query OK</span>'
      : body.d1_bound
        ? '<span class="check-warn">Bound nhưng query lỗi</span>'
        : '<span class="check-fail">Chưa bind D1</span>'
    $('fp-r2').innerHTML = body.r2_bound
      ? '<span class="check-pass">Bound</span>'
      : '<span class="check-warn">Không bind (OK cho smoke cơ bản)</span>'
  }

  async function runHealth() {
    setRow('health', 'pending', '')
    const { ok, status, body } = await fetchJson('/health')
    if (ok && body?.status === 'ok') {
      setRow('health', 'pass', `HTTP ${status} — version ${body.version || '?'}`)
      return true
    }
    setRow('health', 'fail', `HTTP ${status} — Worker không phản hồi đúng`)
    return false
  }

  async function runLogin() {
    setRow('login', 'pending', '')
    const username = $('login-user').value.trim()
    const password = $('login-pass').value
    const { ok, status, body } = await fetchJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!ok) {
      setRow('login', 'fail', `HTTP ${status} — ${body?.error || 'Đăng nhập thất bại'}. Chạy db:seed hoặc tạo user admin local.`)
      token = null
      return false
    }
    token = body.token
    setRow('login', 'pass', `Đăng nhập ${body.user?.username} (${body.user?.role}) — token nhận được`)
    return true
  }

  async function runAuthMe() {
    setRow('me', 'pending', '')
    if (!token) { setRow('me', 'warn', 'Bỏ qua — chưa có token'); return false }
    const { ok, status, body } = await fetchJson('/api/auth/me', {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (ok && body?.username) {
      setRow('me', 'pass', `${body.full_name} — ${body.role}`)
      return true
    }
    setRow('me', 'fail', `HTTP ${status}`)
    return false
  }

  async function runProjects() {
    setRow('projects', 'pending', '')
    if (!token) { setRow('projects', 'warn', 'Bỏ qua'); return false }
    const { ok, status, body } = await fetchJson('/api/projects', {
      headers: { Authorization: 'Bearer ' + token },
    })
    const list = Array.isArray(body) ? body : body?.projects || body?.data
    if (ok && Array.isArray(list)) {
      setRow('projects', 'pass', `${list.length} dự án — JOIN pre-agg route OK`)
      return list.length > 0 ? list[0].id : null
    }
    setRow('projects', 'fail', `HTTP ${status} — ${body?.error || 'response không phải mảng'}`)
    return null
  }

  async function runExecutive() {
    setRow('executive', 'pending', '')
    if (!token) { setRow('executive', 'warn', 'Bỏ qua'); return false }
    const { ok, status, body } = await fetchJson('/api/executive/projects', {
      headers: { Authorization: 'Bearer ' + token },
    })
    const list = Array.isArray(body) ? body : body?.projects
    if (ok && Array.isArray(list)) {
      setRow('executive', 'pass', `${list.length} dự án executive`)
      return true
    }
    if (status === 403) {
      setRow('executive', 'warn', '403 — cần system_admin hoặc project_admin')
      return null
    }
    setRow('executive', 'fail', `HTTP ${status}`)
    return false
  }

  async function runFinanceSpot(projectId) {
    setRow('finance', 'pending', '')
    if (!token || !projectId) {
      setRow('finance', 'warn', 'Bỏ qua — không có project_id')
      return null
    }
    const { ok, status, body } = await fetchJson(`/api/finance/project/${projectId}`, {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (ok && body) {
      const br = body.booked_revenue ?? body.bookedRevenue
      setRow('finance', 'pass', `project ${projectId} — booked_revenue=${br ?? 'n/a'}`)
      return true
    }
    setRow('finance', status === 403 ? 'warn' : 'fail', `HTTP ${status} — ${body?.error || ''}`)
    return false
  }

  async function runLaborGate(projectId) {
    setRow('labor', 'pending', '')
    if (!token || !projectId) {
      setRow('labor', 'warn', 'Bỏ qua')
      return
    }
    const endpoints = [
      [`estimate`, `/api/projects/${projectId}/estimate-vs-actual`],
      [`crs`, `/api/projects/${projectId}/costs-revenue-summary`],
      [`finance`, `/api/finance/project/${projectId}`],
    ]
    const parts = []
    let allOk = true
    for (const [label, url] of endpoints) {
      const { ok, status } = await fetchJson(url, {
        headers: { Authorization: 'Bearer ' + token },
      })
      parts.push(`${label}:${status}`)
      if (!ok && status !== 403) allOk = false
    }
    setRow('labor', allOk ? 'pass' : 'warn', `Gate 0 spot — ${parts.join(', ')} (so sánh đồng thủ công trước deploy)`)
  }

  function initResults() {
    resultsEl.innerHTML = [
      row('health', 'Worker /health', 'pending', ''),
      row('login', 'POST /api/auth/login', 'pending', ''),
      row('me', 'GET /api/auth/me', 'pending', ''),
      row('projects', 'GET /api/projects', 'pending', ''),
      row('executive', 'GET /api/executive/projects', 'pending', ''),
      row('finance', 'GET /api/finance/project/:id', 'pending', ''),
      row('labor', 'Gate 0 labor endpoints (3)', 'pending', ''),
    ].join('')
  }

  async function runAll() {
    $('btn-run-all').disabled = true
    summaryEl.textContent = 'Đang chạy…'
    initResults()

    let pass = 0, fail = 0, warn = 0

    const healthOk = await runHealth()
    healthOk ? pass++ : fail++

    const loginOk = await runLogin()
    loginOk ? pass++ : fail++

    const meOk = await runAuthMe()
    meOk ? pass++ : loginOk ? fail++ : warn++

    const projectId = await runProjects()
    projectId !== false && projectId !== null ? pass++ : loginOk ? fail++ : warn++

    const exec = await runExecutive()
    if (exec === true) pass++
    else if (exec === false) fail++
    else warn++

    const fin = await runFinanceSpot(projectId)
    if (fin === true) pass++
    else if (fin === false) fail++
    else warn++

    await runLaborGate(projectId)
    pass++ // labor row is informational

    const verdict = fail === 0 ? 'PASS' : 'FAIL'
    summaryEl.innerHTML = fail === 0
      ? `<span class="check-pass">${pass} pass, ${warn} warn — sẵn sàng kiểm UI</span>`
      : `<span class="check-fail">${fail} fail, ${pass} pass — sửa trước khi deploy</span>`

    $('btn-run-all').disabled = false
  }

  $('btn-run-all').addEventListener('click', runAll)
  loadFingerprint()
})()
