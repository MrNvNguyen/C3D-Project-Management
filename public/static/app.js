// ================================================================
// OneCad BIM Management System - Frontend Application
// ================================================================

const API_BASE = ''
let currentUser = null
let authToken = null
let allProjects = []
let _projectViewMode = 'card'    // 'card' | 'list'
let _allCategoriesForFilter = [] // unused legacy – kept for safety
let allTasks = []
let allUsers = []
let allTimesheets = []
let allAssets = []
let _assetPage = 1
const ASSET_PAGE_SIZE = 20
let allCosts = []
let allRevenues = []
let _costPage = 1
let _costTypeFilter = ''
const COST_PAGE_SIZE = 20
let allDisciplines = []
let currentCostTab = 'costs'
let charts = {}

// ── Chart.js global safety wrapper ──────────────────────────────────────────
// Intercept every new Chart() call to auto-destroy existing instance on same canvas
// This prevents "Canvas is already in use" errors when re-rendering charts
;(function patchChartJs() {
  if (typeof Chart === 'undefined') return  // Chart.js not loaded yet
  const OriginalChart = Chart
  window._safeCreateChart = function(ctx, config) {
    if (!ctx) return null
    // Destroy any existing chart on this canvas element
    const canvasEl = (ctx instanceof HTMLCanvasElement) ? ctx : ctx.canvas
    if (canvasEl) {
      const existing = OriginalChart.getChart(canvasEl)
      if (existing) { try { existing.destroy() } catch(e){} }
    }
    return new OriginalChart(ctx, config)
  }
})()

// Safe chart creator — always destroy existing chart on canvas before creating new one
function safeChart(ctx, config) {
  if (!ctx) return null
  try {
    const canvasEl = (ctx instanceof HTMLCanvasElement) ? ctx : (ctx.canvas || document.getElementById(ctx))
    if (canvasEl) {
      const existing = Chart.getChart(canvasEl)
      if (existing) { try { existing.destroy() } catch(e){} }
    }
    return new Chart(ctx, config)
  } catch(e) {
    console.error('safeChart error:', e)
    return null
  }
}


let _costDashboardLoading = false      // prevent concurrent loadCostDashboard calls
let _costDashboardPending = false      // track if a reload was requested while loading
let _costAnalysisLoading = false       // prevent concurrent loadCostAnalysis calls
let _costAnalysisPending = false       // track if a reload was requested while loading
let _costAnalysisLoaded = false        // track if analysis was already rendered for current selection
let _costAnalysisDebounceTimer = null  // debounce timer for filter changes
let _lastAnalysisKey = ''              // cache key: projId+periodType+month+year to avoid re-fetch

// ================================================================
// UTILITY FUNCTIONS
// ================================================================
const $ = id => document.getElementById(id)
const fmt = (n) => new Intl.NumberFormat('vi-VN').format(n || 0)
const fmtMoney = (n) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', notation: 'compact', minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n || 0)

// ── Money Input Helpers ──────────────────────────────────────────────────────
// Format khi user gõ: 5240400000 → 5.240.400.000
function moneyInputFmt(el) {
  const raw = el.value.replace(/[^\d]/g, '')
  el.value = raw ? new Intl.NumberFormat('vi-VN').format(raw) : ''
  el.dataset.rawVal = raw
}
// Lấy giá trị số thực từ money input (đã format hoặc chưa)
function parseMoneyVal(idOrEl) {
  const el = typeof idOrEl === 'string' ? $(idOrEl) : idOrEl
  if (!el) return 0
  const raw = el.dataset.rawVal || el.value.replace(/[^\d]/g, '')
  return raw ? parseInt(raw, 10) : 0
}
// Set giá trị vào money input (tự format + lưu dataset)
function setMoneyInput(idOrEl, val) {
  const el = typeof idOrEl === 'string' ? $(idOrEl) : idOrEl
  if (!el) return
  const n = parseInt(val, 10) || 0
  el.dataset.rawVal = n > 0 ? String(n) : ''
  el.value = n > 0 ? new Intl.NumberFormat('vi-VN').format(n) : ''
}
// ─────────────────────────────────────────────────────────────────────────────

// Chuẩn hóa timestamp từ DB (SQLite CURRENT_TIMESTAMP = UTC, không có 'Z')
// Thêm 'Z' để dayjs hiểu là UTC → tự chuyển sang giờ local (VN +07:00)
const toLocalDayjs = (d) => {
  if (!d) return null
  // Nếu đã có timezone info (chứa 'Z', '+', hoặc 'T...+') thì parse thẳng
  if (/Z$|[+-]\d{2}:\d{2}$/.test(d)) return dayjs(d)
  // SQLite format: '2026-03-26 14:32:00' → thêm Z để coi là UTC
  return dayjs(d.replace(' ', 'T') + 'Z')
}
const fmtDate = (d) => d ? toLocalDayjs(d).format('DD/MM/YYYY') : '-'
const today = () => new Date().toISOString().split('T')[0]

function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`
  return axios({
    url: `${API_BASE}/api${endpoint}`,
    headers,
    ...options
  }).then(r => r.data)
}

function toast(message, type = 'success', duration = 3000) {
  const colors = { success: '#00A651', error: '#EF4444', warning: '#FF6B00', info: '#0066CC' }
  const icons = { success: 'check-circle', error: 'times-circle', warning: 'exclamation-triangle', info: 'info-circle' }
  const t = document.createElement('div')
  t.className = 'toast'
  t.style.background = colors[type] || colors.success
  t.innerHTML = `<div class="flex items-center gap-2 text-white">
    <i class="fas fa-${icons[type]}"></i>
    <span class="font-medium">${message}</span>
    <button onclick="this.parentElement.parentElement.remove()" class="ml-auto opacity-70 hover:opacity-100"><i class="fas fa-times"></i></button>
  </div>`
  document.body.appendChild(t)
  setTimeout(() => { t.style.animation = 'fadeOut 0.3s forwards'; setTimeout(() => t.remove(), 300) }, duration)
}

// ================================================================
// WEB PUSH NOTIFICATIONS — Service Worker + Web Push API
// ================================================================

// ── Đăng ký Service Worker và lấy push subscription ─────────────
async function _registerSWAndSubscribe() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready

    // Lấy VAPID public key từ server
    const res = await fetch('/api/push/vapid-public-key', {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('bim_token') }
    })
    if (!res.ok) return null
    const { publicKey } = await res.json()
    if (!publicKey) return null

    // Chuyển base64url → Uint8Array
    const b64 = publicKey.replace(/-/g, '+').replace(/_/g, '/')
    const raw = Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0))

    // Đăng ký push subscription (tái sử dụng nếu đã có)
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw })
    }
    return sub
  } catch(e) {
    console.warn('[Push] SW/subscribe error:', e)
    return null
  }
}

// ── Gửi subscription lên server ─────────────────────────────────
async function _savePushSubscription(sub) {
  if (!sub) return
  try {
    const key  = sub.getKey('p256dh')
    const auth = sub.getKey('auth')
    const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('bim_token')
      },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        keys: { p256dh: toB64(key), auth: toB64(auth) }
      })
    })
  } catch(e) {
    console.warn('[Push] Save subscription error:', e)
  }
}

// ── Khởi tạo: đăng ký SW, subscribe push, hiển thị banner ───────
async function initPushNotifications() {
  if (!('Notification' in window)) return

  const perm = Notification.permission
  if (perm === 'granted') {
    // Đã có quyền → đăng ký SW + lưu subscription (idempotent)
    const sub = await _registerSWAndSubscribe()
    await _savePushSubscription(sub)
  } else if (perm === 'default') {
    // Chưa hỏi → hiện banner sau 2s
    setTimeout(showPermissionBanner, 2000)
  }
  renderPushButton()
}

// ── Xin quyền và đăng ký push ───────────────────────────────────
async function requestPushPermission() {
  if (!('Notification' in window)) { toast('Trình duyệt không hỗ trợ thông báo', 'error'); return }

  localStorage.removeItem('bim_notif_disabled')

  const permission = await Notification.requestPermission()
  hidePushBanner()

  if (permission === 'granted') {
    // Đăng ký Service Worker + push subscription
    const sub = await _registerSWAndSubscribe()
    await _savePushSubscription(sub)

    if (sub) {
      toast('✅ Đã bật thông báo! Bạn sẽ nhận thông báo kể cả khi ẩn tab.', 'success', 4000)
    } else {
      toast('✅ Đã bật thông báo (chế độ cơ bản — tab cần mở).', 'success', 4000)
    }
  } else if (permission === 'denied') {
    toast('Thông báo bị chặn. Vào cài đặt trình duyệt → Site Settings → Notifications để bật lại.', 'warning', 6000)
  }
  renderPushButton()
}

// ── Tắt thông báo + hủy push subscription ───────────────────────
async function unsubscribePush() {
  try {
    // Hủy push subscription trên browser
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      if (reg) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          // Xóa subscription khỏi server trước
          await fetch('/api/push/unsubscribe', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + localStorage.getItem('bim_token')
            },
            body: JSON.stringify({ endpoint: sub.endpoint })
          }).catch(() => {})
          // Hủy subscription trên browser
          await sub.unsubscribe()
        }
      }
    }
  } catch(e) {
    console.warn('[Push] Unsubscribe error:', e)
  }
  localStorage.setItem('bim_notif_disabled', '1')
  renderPushButton()
  toast('Đã tắt thông báo', 'info')
}

// ── Hiển thị banner nhắc bật thông báo ──────────────────────────
function showPermissionBanner() {
  if ($('pushPermBanner')) return  // already shown
  if (Notification.permission !== 'default') return
  if (localStorage.getItem('bim_notif_dismissed')) return

  const banner = document.createElement('div')
  banner.id = 'pushPermBanner'
  banner.style.cssText = `
    position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
    background:#1e293b; color:#fff; padding:14px 20px; border-radius:12px;
    box-shadow:0 8px 32px rgba(0,0,0,0.3); z-index:9998;
    display:flex; align-items:center; gap:12px; max-width:480px; width:calc(100% - 40px);
    animation:slideUp 0.3s ease;
  `
  banner.innerHTML = `
    <i class="fas fa-bell text-yellow-400 text-xl flex-shrink-0"></i>
    <div class="flex-1">
      <p class="font-semibold text-sm">Bật thông báo để không bỏ lỡ tin nhắn</p>
      <p class="text-xs text-gray-400 mt-0.5">Nhận thông báo khi có tin nhắn chat, task được giao, @mention</p>
    </div>
    <button onclick="requestPushPermission()" style="background:#3b82f6;border:none;color:#fff;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;">Bật ngay</button>
    <button onclick="hidePushBanner(true)" style="background:transparent;border:none;color:#9ca3af;cursor:pointer;font-size:18px;padding:0 4px;line-height:1;">×</button>
  `
  document.body.appendChild(banner)

  // Tự ẩn sau 15s
  setTimeout(() => hidePushBanner(), 15000)
}

function hidePushBanner(dismiss = false) {
  const b = $('pushPermBanner')
  if (b) b.remove()
  if (dismiss) localStorage.setItem('bim_notif_dismissed', '1')
}

// ── Render trạng thái trong trang Profile ────────────────────────
function renderPushButton() {
  const container = $('pushNotifContainer')
  if (!container) return

  if (!('Notification' in window)) {
    container.innerHTML = `<p class="text-xs text-gray-400"><i class="fas fa-ban mr-1"></i>Trình duyệt không hỗ trợ thông báo</p>`
    return
  }

  const permission = Notification.permission
  const disabled = localStorage.getItem('bim_notif_disabled') === '1'

  let btnHtml = ''
  if (permission === 'denied') {
    btnHtml = `
      <div class="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-200">
        <i class="fas fa-bell-slash text-red-500 text-lg"></i>
        <div class="flex-1">
          <p class="text-sm font-semibold text-red-700">Thông báo bị chặn bởi trình duyệt</p>
          <p class="text-xs text-red-500">Vào Settings → Site Settings → Notifications → Cho phép trang này</p>
        </div>
      </div>`
  } else if (permission === 'granted' && !disabled) {
    const hasSW = ('serviceWorker' in navigator) && ('PushManager' in window)
    btnHtml = `
      <div class="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
        <i class="fas fa-bell text-green-600 text-lg"></i>
        <div class="flex-1">
          <p class="text-sm font-semibold text-green-700">✅ Thông báo đang hoạt động</p>
          <p class="text-xs text-gray-500">${hasSW ? 'Nhận thông báo kể cả khi ẩn tab (Web Push)' : 'Nhận thông báo khi tab đang mở'}</p>
        </div>
        <button onclick="unsubscribePush()" class="text-xs text-red-500 hover:text-red-700 underline whitespace-nowrap">Tắt</button>
      </div>`
  } else {
    btnHtml = `
      <div class="flex items-center gap-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
        <i class="fas fa-bell text-amber-500 text-lg"></i>
        <div class="flex-1">
          <p class="text-sm font-semibold text-amber-700">Thông báo chưa được bật</p>
          <p class="text-xs text-gray-500">Cho phép để nhận thông báo tin nhắn, task, @mention</p>
        </div>
        <button onclick="requestPushPermission()" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg whitespace-nowrap">Bật ngay</button>
      </div>`
  }
  container.innerHTML = btnHtml
}

// ── Smart polling: 5s active, paused when hidden ──────────────────
let _notifPollInterval = null
function startSmartNotifPoll() {
  if (_notifPollInterval) clearInterval(_notifPollInterval)
  _notifPollInterval = setInterval(() => {
    if (!document.hidden) loadNotifications()
  }, 5000)

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadNotifications()  // Reload immediately on tab focus
  }, { passive: true })
}

// ================================================================
// END BROWSER NOTIFICATIONS
// ================================================================

function closeModal(id) {
  $(id).style.display = 'none'
  // Close & return any teleported combobox panels to their wraps
  Object.keys(_cbState).forEach(cbId => {
    const st = _cbState[cbId]
    if (!st?.teleport) return
    const panel = document.getElementById(cbId + '_panel')
    if (panel && panel.parentElement === document.body) {
      panel.style.display = 'none'
      const wrap = document.getElementById(cbId + '_wrap')
      if (wrap) wrap.appendChild(panel)
      const arrow = document.getElementById(cbId + '_arrow')
      if (arrow) arrow.style.transform = ''
    }
  })
  _cbHideBackdrop()
  // Stop chat polling when task detail modal is closed
  if (id === 'taskDetailModal') {
    const chatDiv = $('taskDetailChat')
    if (chatDiv?._chatContext) {
      const { type, id: ctxId } = chatDiv._chatContext
      const pollKey = `_chatPoll_${type}_${ctxId}`
      if (window[pollKey]) { clearInterval(window[pollKey]); delete window[pollKey] }
    }
  }
}
function openModal(id) { $(id).style.display = 'flex' }

function getRoleBadge(role) {
  const map = {
    system_admin: '<span class="badge" style="background:#fce7f3;color:#be185d">System Admin</span>',
    project_admin: '<span class="badge" style="background:#ede9fe;color:#5b21b6">Project Admin</span>',
    project_leader: '<span class="badge" style="background:#dbeafe;color:#1d4ed8">Project Leader</span>',
    member: '<span class="badge" style="background:#f3f4f6;color:#374151">Member</span>'
  }
  return map[role] || role
}

// ─── Project-level role helpers ───────────────────────────────────────────────
// Cache: projectId → { role } for currentUser
const _projectRoleCache = {}

// Lấy effective role của currentUser trong một dự án cụ thể
// Kết hợp global role + project-member role
function getEffectiveRoleForProject(projectId) {
  const rolePriority = { system_admin: 4, project_admin: 3, project_leader: 2, member: 1 }
  const globalLevel = rolePriority[currentUser?.role] || 1
  const projRole = _projectRoleCache[projectId]
  const projLevel = rolePriority[projRole] || 0
  return (projLevel > globalLevel) ? projRole : (currentUser?.role || 'member')
}

// Lấy role cao nhất của currentUser trên tất cả project (dùng cho danh sách task toàn cục)
function getEffectiveGlobalRole() {
  if (!currentUser) return 'member'
  const rolePriority = { system_admin: 4, project_admin: 3, project_leader: 2, member: 1 }
  let best = currentUser.role
  let bestLevel = rolePriority[best] || 1
  for (const role of Object.values(_projectRoleCache)) {
    const lvl = rolePriority[role] || 0
    if (lvl > bestLevel) { best = role; bestLevel = lvl }
  }
  return best
}

// Gọi sau khi load allProjects để điền cache role theo project
// Dùng my_project_role (trả về từ /api/projects) hoặc members nếu có
function refreshProjectRoleCache() {
  for (const p of (allProjects || [])) {
    // Ưu tiên my_project_role được trả về từ API (hiệu quả hơn)
    if (p.my_project_role) {
      _projectRoleCache[p.id] = p.my_project_role
      continue
    }
    // Fallback: dùng members nếu có (khi load project detail)
    if (p.members) {
      const m = p.members.find(m => m.user_id === currentUser?.id)
      if (m?.role) _projectRoleCache[p.id] = m.role
    }
  }
}

// Kiểm tra user có quyền leader/admin trong bất kỳ dự án nào không
function isAnyProjectLeaderOrAdmin() {
  const eff = getEffectiveGlobalRole()
  return ['system_admin','project_admin','project_leader'].includes(eff)
}

// Chỉ project_admin trở lên mới được DUYỆT timesheet (không bao gồm project_leader)
function canApproveTimesheet() {
  if (!currentUser) return false
  const role = currentUser.role
  if (role === 'system_admin' || role === 'project_admin') return true
  // Kiểm tra effective role từ project_members (nếu user là admin của 1 dự án cụ thể)
  const eff = getEffectiveGlobalRole()
  return ['system_admin', 'project_admin'].includes(eff)
}

function getRoleLabel(role) {
  const map = { system_admin: 'System Admin', project_admin: 'Project Admin', project_leader: 'Project Leader', member: 'Member' }
  return map[role] || role
}

function getStatusBadge(status) {
  const labels = { todo: 'Chờ làm', in_progress: 'Đang làm', review: 'Đang duyệt', completed: 'Hoàn thành', done: 'Hoàn thành', cancelled: 'Đã hủy', active: 'Hoạt động', planning: 'Lập kế hoạch', on_hold: 'Tạm dừng' }
  // Normalise legacy 'done' → display as 'completed' badge class
  const badgeClass = status === 'done' ? 'completed' : status
  const icons = { active: '●', completed: '✓', planning: '◷', on_hold: '⏸', cancelled: '✕' }
  const icon = icons[badgeClass] ? `<span style="margin-right:3px;font-size:10px">${icons[badgeClass]}</span>` : ''
  return `<span class="badge badge-${badgeClass}">${icon}${labels[status] || status}</span>`
}

function getPriorityBadge(p) {
  const labels = { low: 'Thấp', medium: 'TB', high: 'Cao', urgent: 'Khẩn' }
  return `<span class="badge badge-${p}">${labels[p] || p}</span>`
}

function getPhaseName(p) {
  const m = { basic_design: 'TKCS', technical_design: 'TKKT', construction_design: 'TKTC', as_built: 'Hoàn công' }
  return m[p] || p
}

function getAssetCategoryName(c) {
  const m = { computer: 'Máy tính', laptop: 'Laptop', software: 'Phần mềm', equipment: 'Thiết bị', furniture: 'Nội thất', vehicle: 'Phương tiện', other: 'Khác' }
  return m[c] || c
}

function getCostTypeName(t) {
  const m = {
    salary:       'Chi phí lương',
    equipment:    'Chi phí thiết bị',
    material:     'Chi phí vật liệu',
    travel:       'Chi phí đi lại',
    office:       'Chi phí văn phòng',
    transport:    'Chi phí vận chuyển',
    depreciation: 'Chi phí khấu hao',
    other:        'Chi phí khác',
    manmonth:     'Chi phí tháng',
    department:   'Chi phí phòng',
    shared:       'Chi phí chung (phân bổ)'
  }
  return m[t] || t
}

function isOverdue(task) {
  return task.due_date && task.due_date < today() && !['completed','review','cancelled'].includes(task.status)
}

function getProjectTypeName(t) {
  const m = { building: 'Công trình', infrastructure: 'Hạ tầng', transport: 'Giao thông', energy: 'Năng lượng', hydraulic: 'Thủy lợi' }
  return m[t] || t
}

function initDatetimeClock() {
  function update() {
    const now = new Date()
    const dateEl = $('currentDate')
    const timeEl = $('currentTime')
    if (dateEl) dateEl.textContent = now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
    if (timeEl) timeEl.textContent = now.toLocaleTimeString('vi-VN')
  }
  update()
  setInterval(update, 1000)
}

// ================================================================
// AUTH
// ================================================================
function togglePassword() {
  const inp = $('loginPassword'), icon = $('eyeIcon')
  inp.type = inp.type === 'password' ? 'text' : 'password'
  icon.className = inp.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash'
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const username = $('loginUsername').value.trim()
  const password = $('loginPassword').value
  try {
    const res = await api('/auth/login', { method: 'post', data: { username, password } })
    authToken = res.token
    currentUser = res.user
    localStorage.setItem('bim_token', authToken)
    localStorage.setItem('bim_user', JSON.stringify(currentUser))
    // Load thêm avatar từ /auth/me (login chưa trả về avatar)
    try {
      const meData = await api('/auth/me')
      currentUser = { ...currentUser, ...meData }
      localStorage.setItem('bim_user', JSON.stringify(currentUser))
    } catch (_) {}
    initApp()
  } catch (err) {
    toast(err.response?.data?.error || 'Sai tên đăng nhập hoặc mật khẩu', 'error')
  }
})

function logout() {
  authToken = null
  currentUser = null
  localStorage.removeItem('bim_token')
  localStorage.removeItem('bim_user')
  $('mainApp').style.display = 'none'
  $('loginPage').style.display = 'flex'
  toast('Đã đăng xuất thành công', 'info')
}

// ================================================================
// NAVIGATION
// ================================================================
function navigate(page) {
  // Stop project chat polling when leaving project-detail
  if (window._currentProjectDetailId && page !== 'project-detail') {
    const pid = window._currentProjectDetailId
    const pollKey = `_chatPoll_project_${pid}`
    if (window[pollKey]) { clearInterval(window[pollKey]); delete window[pollKey] }
    window._currentProjectDetailId = null
  }

  // Reset timesheet page state when leaving timesheet
  if (typeof _tsDropdownsInitialised !== 'undefined') {
    const currentPage = document.querySelector('.page.active')?.id?.replace('page-', '')
    if (currentPage === 'timesheet' && page !== 'timesheet') resetTsPageState()
  }

  // Reset legal tab user-selection flag khi rời trang legal
  if (page !== 'legal') {
    _legalTabSetByUser = false
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))

  const pageEl = $(`page-${page}`)
  if (pageEl) pageEl.classList.add('active')

  const navEl = document.querySelector(`[onclick="navigate('${page}')"]`)
  if (navEl) navEl.classList.add('active')

  const breadcrumbs = {
    dashboard: 'Dashboard', projects: 'Dự án', 'project-detail': 'Chi tiết dự án',
    tasks: 'Công việc', timesheet: 'Timesheet', gantt: 'Tiến độ Gantt',
    costs: 'Chi phí & Doanh thu', assets: 'Tài sản', depreciation: 'Khấu hao tài sản',
    users: 'Nhân sự', profile: 'Hồ sơ', 'email-admin': 'Email Thông báo',
    productivity: 'Năng suất nhân sự', 'finance-project': 'Tài chính dự án',
    'labor-cost': 'Chi phí lương', 'cost-types': 'Loại chi phí',
    'system-config': 'Cấu hình hệ thống', analytics: 'Báo cáo & Phân tích',
    legal: 'Hồ Sơ Pháp Lý Dự Án'
  }
  $('breadcrumb').textContent = breadcrumbs[page] || page

  if (page === 'dashboard') loadDashboard()
  else if (page === 'projects') loadProjects()
  else if (page === 'tasks') loadTasks()
  else if (page === 'timesheet') loadTimesheets()
  else if (page === 'gantt') loadGantt()
  else if (page === 'costs') loadCostDashboard()
  else if (page === 'assets') loadAssets()
  else if (page === 'email-admin') loadEmailAdmin()
  else if (page === 'depreciation') loadDepreciation()
  else if (page === 'users') loadUsers()
  else if (page === 'profile') loadProfile()
  else if (page === 'productivity') loadProductivity()
  else if (page === 'finance-project') { loadFinanceProjectPage() }
  else if (page === 'labor-cost') loadLaborCost()
  else if (page === 'cost-types') loadCostTypes()
  else if (page === 'system-config') loadSystemConfig()
  else if (page === 'analytics') loadAnalytics()
  else if (page === 'legal') loadLegal()

  closeAllDropdowns()
}

function toggleSidebar() {
  const sidebar = $('sidebar')
  const mainContent = $('mainContent')
  // Nếu đang mini → mở full trước
  if (sidebar.classList.contains('mini')) {
    sidebar.classList.remove('mini')
    mainContent.classList.remove('mini-sidebar')
    localStorage.setItem('sidebar_state', 'full')
    return
  }
  sidebar.classList.toggle('collapsed')
  mainContent.classList.toggle('expanded')
  localStorage.setItem('sidebar_state', sidebar.classList.contains('collapsed') ? 'collapsed' : 'full')
}

function toggleSidebarMini() {
  const sidebar = $('sidebar')
  const mainContent = $('mainContent')
  const isMini = sidebar.classList.contains('mini')
  const btn = $('sidebarToggleBtn')

  if (isMini) {
    // Mở rộng lại
    sidebar.classList.remove('mini')
    mainContent.classList.remove('mini-sidebar')
    if (btn) btn.title = 'Thu gọn sidebar'
    localStorage.setItem('sidebar_state', 'full')
  } else {
    // Thu gọn sang mini
    sidebar.classList.remove('collapsed')
    mainContent.classList.remove('expanded')
    sidebar.classList.add('mini')
    mainContent.classList.add('mini-sidebar')
    if (btn) btn.title = 'Mở rộng sidebar'
    localStorage.setItem('sidebar_state', 'mini')
  }
  // Sync avatar mini
  const avatarMini = $('sidebarAvatarMini')
  const avatar = $('sidebarAvatar')
  if (avatarMini && avatar) avatarMini.textContent = avatar.textContent
}

// Khôi phục trạng thái sidebar khi load
function restoreSidebarState() {
  // Tablet (768-1023px): CSS tự handle mini — không cần JS thêm class
  if (window.innerWidth >= 768 && window.innerWidth < 1024) return

  const state = localStorage.getItem('sidebar_state')
  if (state === 'mini') {
    $('sidebar').classList.add('mini')
    $('mainContent').classList.add('mini-sidebar')
    const btn = $('sidebarToggleBtn')
    if (btn) btn.title = 'Mở rộng sidebar'
  } else if (state === 'collapsed') {
    $('sidebar').classList.add('collapsed')
    $('mainContent').classList.add('expanded')
  }
}

// Handle resize: sync sidebar khi resize từ desktop xuống tablet hoặc ngược lại
window.addEventListener('resize', () => {
  const sidebar = $('sidebar')
  const mainContent = $('mainContent')
  if (!sidebar || !mainContent) return
  if (window.innerWidth >= 768 && window.innerWidth < 1024) {
    // Tablet: CSS media query đã handle, bỏ JS-added classes để tránh conflict
    sidebar.classList.remove('mini', 'collapsed')
    mainContent.classList.remove('mini-sidebar', 'expanded')
  }
})

function toggleNotifications() {
  const d = $('notifDropdown')
  d.style.display = d.style.display === 'none' ? 'block' : 'none'
  if (d.style.display === 'block') loadNotifications()
}

function toggleUserMenu() {
  const d = $('userMenu')
  d.style.display = d.style.display === 'none' ? 'block' : 'none'
}

function closeUserMenu() { $('userMenu').style.display = 'none' }

function closeAllDropdowns() {
  $('notifDropdown').style.display = 'none'
  $('userMenu').style.display = 'none'
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('[onclick="toggleNotifications()"]') && !e.target.closest('#notifDropdown')) {
    const d = $('notifDropdown')
    if (d) d.style.display = 'none'
  }
  if (!e.target.closest('[onclick="toggleUserMenu()"]') && !e.target.closest('#userMenu')) {
    const d = $('userMenu')
    if (d) d.style.display = 'none'
  }
})

// ================================================================
// INIT APP
// ================================================================
async function initApp() {
  $('loginPage').style.display = 'none'
  $('mainApp').style.display = 'block'

  // Update UI with user info
  const initials = currentUser.full_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'U'
  $('sidebarAvatar').textContent = initials
  $('sidebarName').textContent = currentUser.full_name
  $('sidebarRole').textContent = getRoleLabel(currentUser.role)
  $('topbarAvatar').textContent = initials
  $('topbarName').textContent = currentUser.full_name
  $('topbarRole').textContent = getRoleLabel(currentUser.role)
  // Sync mini avatar
  const avatarMini = $('sidebarAvatarMini')
  if (avatarMini) avatarMini.textContent = initials

  // Hiển thị avatar ảnh nếu có
  if (currentUser.avatar && currentUser.avatar.startsWith('data:image/')) {
    _applyAvatarToTopbar(currentUser.avatar)
  }

  // Khôi phục trạng thái sidebar đã lưu
  restoreSidebarState()

  // Chỉ system_admin mới được tạo dự án mới
  if (currentUser.role === 'system_admin') {
    $('adminNav').style.display = 'block'
    $('btnNewProject').classList.remove('hidden')
    // Hiện tất cả menu admin-only
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex')
  } else if (currentUser.role === 'project_admin') {
    // project_admin: không tạo được dự án, chỉ quản lý dự án được phân công
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none')
  } else {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none')
  }

  // Initialize DB
  try {
    await api('/system/init', { method: 'post' })
  } catch (e) {
    // Already initialized
  }

  // Load disciplines
  try {
    allDisciplines = await api('/disciplines')
  } catch (e) { allDisciplines = [] }

  // Load fiscal year settings để dùng khi tính NTC cho chi phí chung
  try {
    const sysConf = await api('/system/config')
    window._fiscalStartMonth = sysConf.fiscal_year_start_month || 2
  } catch (e) { window._fiscalStartMonth = 2 }

  // Preload allProjects để populate _projectRoleCache sớm nhất có thể
  // (quan trọng: giúp task/timesheet pages biết effective role của user)
  try {
    allProjects = await api('/projects')
    refreshProjectRoleCache()
  } catch (e) { /* ignore */ }

  initDatetimeClock()
  loadDashboard()
  loadNotifications()
  startSmartNotifPoll()          // Smart polling: 5s when active, pause when hidden
  initPushNotifications()        // Register SW + subscribe if permission already granted
}

// ================================================================
// DASHBOARD
// ================================================================
async function loadDashboard() {
  try {
    const data = await api('/dashboard/stats')
    const { stats, monthly_hours, project_progress, discipline_breakdown, member_productivity,
            task_status_breakdown, projects_near_deadline } = data

    // KPI row – tất cả role hiển thị giống nhau (layout member)
    $('kpiProjects').textContent = stats.total_projects
    $('kpiActiveProjects').textContent = stats.active_projects
    $('kpiTasks').textContent = stats.total_tasks
    $('kpiCompleted').textContent = stats.completed_tasks
    $('kpiOverdue').textContent = stats.overdue_tasks
    $('kpiRate').textContent = stats.completion_rate + '%'

    // KPI card 5 & 6: luôn dùng layout personal task (ẩn admin view)
    if ($('kpiCard5Admin'))  $('kpiCard5Admin').style.display  = 'none'
    if ($('kpiCard5Member')) $('kpiCard5Member').style.display = ''
    if ($('kpiCard6Admin'))  $('kpiCard6Admin').style.display  = 'none'
    if ($('kpiCard6Member')) $('kpiCard6Member').style.display = ''
    if ($('kpiCard5Icon'))   $('kpiCard5Icon').className = 'fas fa-user-check text-emerald-600'
    if ($('kpiCard6Icon'))   $('kpiCard6Icon').className = 'fas fa-calendar-check text-amber-600'
    if ($('kpiMyTasksDone'))    $('kpiMyTasksDone').textContent    = stats.my_tasks_completed || 0
    if ($('kpiMyTasksDueSoon')) $('kpiMyTasksDueSoon').textContent = stats.my_tasks_due_soon || 0

    // Overall progress bar
    const totalT = stats.total_tasks || 0
    const doneT = stats.completed_tasks || 0
    const rate = totalT > 0 ? Math.round((doneT / totalT) * 100) : 0
    if ($('dashOverallPct')) $('dashOverallPct').textContent = rate + '%'
    if ($('dashOverallBar')) $('dashOverallBar').style.width = rate + '%'
    if ($('dashTasksSummary')) $('dashTasksSummary').textContent = doneT + ' / ' + totalT + ' task hoàn thành'
    if ($('dashOverdueSummary')) {
      const ov = stats.overdue_tasks || 0
      $('dashOverdueSummary').textContent = ov > 0 ? ov + ' task trễ hạn' : ''
    }

    // Widget 1: Phân bổ task theo trạng thái
    renderTaskStatusBars(task_status_breakdown, totalT)

    // Widget 2: Nhân sự hoạt động tháng này
    if ($('kpiActiveUsersMonth')) $('kpiActiveUsersMonth').textContent = stats.active_users_month || 0
    if ($('kpiTotalUsersAll'))    $('kpiTotalUsersAll').textContent    = stats.total_users || 0
    if ($('kpiTopContributor'))   $('kpiTopContributor').textContent   = stats.top_contributor_name || 'Chưa có dữ liệu'
    if ($('kpiTopContributorHours')) {
      $('kpiTopContributorHours').textContent = stats.top_contributor_hours
        ? `${stats.top_contributor_hours} giờ trong tháng` : ''
    }

    // Widget 3: Dự án sắp đến hạn
    renderProjectDeadlineList(projects_near_deadline)

    // Widget 4: Task của tôi – luôn dùng layout member, ẩn admin widget
    const w4Admin = $('dashWidget4Admin')
    const w4Member = $('dashWidget4Member')
    if (w4Admin)  w4Admin.style.display  = 'none'
    if (w4Member) w4Member.style.display = ''
    if ($('myTaskTotal'))      $('myTaskTotal').textContent      = stats.my_tasks_total     || 0
    if ($('myTaskCompleted'))  $('myTaskCompleted').textContent  = stats.my_tasks_completed || 0
    if ($('myTaskOverdue'))    $('myTaskOverdue').textContent    = stats.my_tasks_overdue   || 0
    if ($('myTaskInProgress')) $('myTaskInProgress').textContent = stats.my_tasks_inprogress|| 0
    if ($('myTaskDueSoon'))    $('myTaskDueSoon').textContent    = stats.my_tasks_due_soon  || 0

    renderProductivityChart(member_productivity)
    renderDisciplineChart(discipline_breakdown)
    renderHoursChart(monthly_hours)
    renderProjectProgressList(project_progress)
    renderRecentTasksTable(project_progress)
  } catch (e) {
    console.error('Dashboard error:', e)
  }
}

// Render horizontal stacked bars for task status breakdown
function renderTaskStatusBars(breakdown, total) {
  const el = $('taskStatusBars')
  const legendEl = $('taskStatusLegend')
  if (!el) return
  const statusCfg = {
    todo:        { label: 'Chờ xử lý',  color: '#94A3B8', bg: 'bg-slate-400' },
    in_progress: { label: 'Đang làm',   color: '#3B82F6', bg: 'bg-blue-500' },
    review:      { label: 'Đang duyệt', color: '#F59E0B', bg: 'bg-amber-400' },
    completed:   { label: 'Hoàn thành', color: '#10B981', bg: 'bg-emerald-500' },
    on_hold:     { label: 'Tạm dừng',   color: '#6B7280', bg: 'bg-gray-500' },
  }
  if (!breakdown?.length || !total) {
    el.innerHTML = '<div class="text-xs text-gray-400 text-center py-2">Chưa có task</div>'
    if (legendEl) legendEl.innerHTML = ''
    return
  }
  const map = {}
  breakdown.forEach(b => { map[b.status] = b.count })

  el.innerHTML = Object.entries(statusCfg).map(([key, cfg]) => {
    const cnt = map[key] || 0
    const pct = total > 0 ? Math.round((cnt / total) * 100) : 0
    return `<div>
      <div class="flex justify-between text-xs mb-0.5">
        <span class="text-gray-600 font-medium">${cfg.label}</span>
        <span class="text-gray-500">${cnt} <span class="text-gray-400">(${pct}%)</span></span>
      </div>
      <div class="w-full bg-gray-100 rounded-full h-2">
        <div class="h-2 rounded-full transition-all" style="width:${pct}%;background:${cfg.color}"></div>
      </div>
    </div>`
  }).join('')

  if (legendEl) {
    legendEl.innerHTML = Object.entries(statusCfg).map(([key, cfg]) => {
      const cnt = map[key] || 0
      return `<span class="flex items-center gap-1 text-xs text-gray-500">
        <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${cfg.color}"></span>
        ${cfg.label}: <b class="text-gray-700">${cnt}</b>
      </span>`
    }).join('')
  }
}

// Render list of projects nearing deadline
function renderProjectDeadlineList(projects) {
  const el = $('projectDeadlineList')
  if (!el) return
  if (!projects?.length) {
    el.innerHTML = '<div class="text-xs text-green-600 text-center py-3"><i class="fas fa-check-circle mr-1"></i>Không có dự án sắp đến hạn</div>'
    return
  }
  // So sánh theo ngày UTC để tránh lệch múi giờ gây NaN
  const todayStr = new Date().toISOString().slice(0, 10) // "YYYY-MM-DD"
  const todayUTC = new Date(todayStr + 'T00:00:00Z')

  el.innerHTML = projects.map(p => {
    if (!p.end_date) return ''
    const dateStr = String(p.end_date).slice(0, 10) // lấy "YYYY-MM-DD"
    const endUTC = new Date(dateStr + 'T00:00:00Z')
    if (isNaN(endUTC.getTime())) return '' // bỏ qua nếu date không hợp lệ

    const daysLeft = Math.round((endUTC - todayUTC) / (1000 * 60 * 60 * 24))
    const isPast   = daysLeft < 0
    const isUrgent = daysLeft >= 0 && daysLeft <= 7
    const bgBadge  = isPast   ? 'bg-red-100 text-red-600'
                   : isUrgent ? 'bg-orange-100 text-orange-600'
                   :            'bg-amber-100 text-amber-600'
    const label    = isPast           ? `${Math.abs(daysLeft)}d trễ`
                   : daysLeft === 0   ? 'Hôm nay'
                   :                   `${daysLeft}d còn`
    const overdueIcon = p.overdue_tasks > 0 ? `<span class="text-red-500 ml-1">⚠ ${p.overdue_tasks} trễ</span>` : ''
    return `<div class="flex items-center justify-between gap-2 py-1 border-b border-gray-50 last:border-0">
      <div class="flex-1 min-w-0">
        <p class="text-xs font-semibold text-gray-700 truncate">${p.code} – ${p.name}</p>
        <p class="text-xs text-gray-400">${p.open_tasks || 0} task còn lại${overdueIcon}</p>
      </div>
      <span class="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${bgBadge}">${label}</span>
    </div>`
  }).filter(Boolean).join('') || '<div class="text-xs text-green-600 text-center py-3"><i class="fas fa-check-circle mr-1"></i>Không có dự án sắp đến hạn</div>'
}

function destroyChart(id) {
  if (charts[id]) { try { charts[id].destroy() } catch(e){} delete charts[id] }
  // Chart.js v3+ guard: destroy by canvas element directly to prevent "canvas already in use"
  // Map chart key → canvas element ID
  const canvasMap = {
    costProject: 'costProjectChart',
    costMonthly: 'costMonthlyChart',
    productivity: 'productivityChart',
    discipline: 'disciplineChart',
    hours: 'hoursChart',
    anaDoughnut: 'anaDoughnutChart',
    prodBar: 'prodBarChart',
    prodPie: 'prodPieChart',
    finCostPie: 'finCostPieChart',
    finTimeline: 'finTimelineChart',
    labor: 'laborChart',
    laborPie: 'laborPieChart',
  }
  const canvasId = canvasMap[id] || (id + 'Chart')
  const el = document.getElementById(canvasId)
  if (el) { const existing = Chart.getChart(el); if (existing) { try { existing.destroy() } catch(e){} } }
}

function renderProductivityChart(data) {
  destroyChart('productivity')
  const ctx = $('productivityChart')
  if (!ctx || !data?.length) return

  // Lọc nhân viên có ít nhất 1 task được giao, sắp xếp theo Điểm giảm dần, lấy top 10
  const withTasks = data.filter(u => (u.total_tasks || 0) > 0)
  const sorted = withTasks.slice().sort((a, b) => (b.score || 0) - (a.score || 0))
  const top10 = sorted.slice(0, 10)

  // Nếu không có ai có task, hiển thị tất cả (tối đa 10)
  const display = top10.length ? top10 : data.slice(0, 10)

  // Tên ngắn: lấy tên (từ cuối) để label gọn
  const labels = display.map(u => u.full_name?.split(' ').pop() || u.full_name)

  charts['productivity'] = safeChart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '% Hoàn Thành',  data: display.map(u => u.completion_rate || 0), backgroundColor: '#00A651', borderRadius: 4 },
        { label: 'Chính xác (%)', data: display.map(u => u.ontime_rate     || 0), backgroundColor: '#0066CC', borderRadius: 4 },
        { label: 'Năng suất (%)', data: display.map(u => u.productivity    || 0), backgroundColor: '#F59E0B', borderRadius: 4 },
        { label: 'Điểm',          data: display.map(u => u.score           || 0), backgroundColor: '#8B5CF6', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const u = display[ctx.dataIndex]
              if (!u) return ''
              if (ctx.datasetIndex === 0) return ` % Hoàn Thành: ${u.completion_rate || 0}% (${u.completed_tasks || 0}/${u.total_tasks || 0} task)`
              if (ctx.datasetIndex === 1) return ` Chính xác: ${u.ontime_rate || 0}%`
              if (ctx.datasetIndex === 2) return ` Năng suất: ${u.productivity || 0}%`
              if (ctx.datasetIndex === 3) return ` Điểm: ${u.score || 0}`
              return ''
            }
          }
        }
      },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } }
      }
    }
  })
}

function renderDisciplineChart(data) {
  destroyChart('discipline')
  const ctx = $('disciplineChart')
  if (!ctx || !data?.length) return
  const top8 = data.slice(0, 8)
  const colors = ['#00A651','#0066CC','#FF6B00','#8B5CF6','#F59E0B','#EF4444','#10B981','#3B82F6']
  charts['discipline'] = safeChart(ctx, {
    type: 'doughnut',
    data: {
      labels: top8.map(d => `${d.discipline_code} - ${d.count} task`),
      datasets: [{ data: top8.map(d => d.count), backgroundColor: colors, borderWidth: 2 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.parsed}` } }
      }
    }
  })
}

function renderHoursChart(data) {
  destroyChart('hours')
  const ctx = $('hoursChart')
  if (!ctx) return

  // Build a full 12-month label list (last 12 months up to current)
  const full12 = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    full12.push(`${y}-${m}`)
  }

  // Index existing data by month key
  const dataMap = {}
  ;(data || []).forEach(d => { dataMap[d.month] = d })

  // Fill missing months with zeros
  const labels   = full12
  const regular  = full12.map(m => dataMap[m]?.regular  || 0)
  const overtime = full12.map(m => dataMap[m]?.overtime || 0)

  charts['hours'] = safeChart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Giờ hành chính', data: regular,  borderColor: '#00A651', backgroundColor: 'rgba(0,166,81,0.1)',   fill: true, tension: 0.4, pointRadius: 3 },
        { label: 'Tăng ca',        data: overtime, borderColor: '#FF6B00', backgroundColor: 'rgba(255,107,0,0.1)', fill: true, tension: 0.4, pointRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
      scales: {
        x: { ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { font: { size: 11 } } }
      }
    }
  })
}

function renderProjectProgressList(data) {
  const el = $('projectProgressList')
  if (!el) return
  el.innerHTML = data?.slice(0, 5).map(p => {
    const total = p.total_tasks || 0
    const done = p.completed_tasks || 0
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    const hasOverdue = p.overdue_tasks > 0
    return `<div class="space-y-1">
      <div class="flex justify-between text-xs">
        <span class="font-medium text-gray-700 truncate max-w-32" title="${p.name}">${p.code}</span>
        <span class="${hasOverdue ? 'text-red-600 font-bold' : 'text-gray-500'}">${pct}%</span>
      </div>
      <div class="progress-bar"><div class="progress-fill ${hasOverdue ? 'danger' : ''}" style="width:${pct}%"></div></div>
      <div class="text-xs text-gray-400">${done}/${total} task${hasOverdue ? ` • <span class="text-red-500">${p.overdue_tasks} trễ</span>` : ''}</div>
    </div>`
  }).join('') || '<p class="text-gray-400 text-sm text-center">Chưa có dữ liệu</p>'
}

async function renderRecentTasksTable(projectData) {
  try {
    const tasks = await api('/tasks?overdue=1')
    const tbody = $('recentTasksTable')
    if (!tbody) return
    const displayTasks = tasks.slice(0, 8)
    tbody.innerHTML = displayTasks.map(t => {
      const overdue = isOverdue(t)
      return `<tr class="table-row ${overdue ? 'overdue-row' : ''}">
        <td class="py-2 pr-3">
          <div class="font-medium text-gray-800 text-xs">${t.title}</div>
          ${overdue ? '<span class="badge badge-overdue text-xs">Trễ hạn</span>' : ''}
        </td>
        <td class="py-2 pr-3 text-xs text-gray-600">${t.project_code || '-'}</td>
        <td class="py-2 pr-3 text-xs">${t.assigned_to_name || '<span class="text-gray-400">Chưa giao</span>'}</td>
        <td class="py-2 pr-3 text-xs ${overdue ? 'text-red-600 font-bold' : 'text-gray-600'}">${fmtDate(t.due_date)}</td>
        <td class="py-2 pr-3">${getStatusBadge(t.status)}</td>
        <td class="py-2">
          <div class="flex items-center gap-2">
            <div class="progress-bar flex-1" style="min-width:60px"><div class="progress-fill ${overdue ? 'danger' : ''}" style="width:${t.progress||0}%"></div></div>
            <span class="text-xs text-gray-500">${t.progress||0}%</span>
          </div>
        </td>
      </tr>`
    }).join('') || '<tr><td colspan="6" class="text-center py-6 text-gray-400">Không có task trễ hạn</td></tr>'
  } catch (e) { console.error(e) }
}

// ================================================================
// NOTIFICATIONS
// ================================================================
// Global unread chat map: { 'task_3': 2, 'project_5': 1 }
let _chatUnreadMap = {}
let _lastSeenNotifId = 0   // Track highest notif id seen — detect new arrivals

async function loadNotifications() {
  try {
    const [notifs, unreadChat] = await Promise.all([
      api('/notifications'),
      api('/messages/unread').catch(() => [])
    ])

    // ── Detect new notifications & fire browser Notification ──────
    const _notifEnabled = Notification.permission === 'granted' && localStorage.getItem('bim_notif_disabled') !== '1'
    if (_lastSeenNotifId > 0 && _notifEnabled) {
      const newNotifs = notifs.filter(n => n.id > _lastSeenNotifId && !n.is_read)
      for (const n of newNotifs) {
        try {
          const notif = new Notification(n.title, {
            body: n.message,
            icon: '/icon-192.png',
            badge: '/badge-72.png',
            tag: `bim-${n.id}`,
            requireInteraction: false,
          })
          notif.onclick = () => {
            window.focus()
            notif.close()
            handleNotifClick(n.id, n.type, n.related_type, n.related_id)
          }
        } catch (e) { /* silent */ }
      }
    }
    // Update highest seen id
    if (notifs.length > 0) {
      const maxId = Math.max(...notifs.map(n => n.id))
      if (maxId > _lastSeenNotifId) _lastSeenNotifId = maxId
    }
    // ── End browser notification trigger ──────────────────────────

    // Build unread chat map
    _chatUnreadMap = {}
    ;(unreadChat || []).forEach(r => {
      _chatUnreadMap[`${r.context_type}_${r.context_id}`] = r.count
    })

    const unread = notifs.filter(n => !n.is_read).length
    const badge = $('notifBadge')
    if (badge) {
      badge.textContent = unread
      badge.style.display = unread > 0 ? 'flex' : 'none'
    }
    const list = $('notifList')
    if (list) {
      list.innerHTML = notifs.slice(0, 20).map(n => {
        const isChatMention = n.type === 'chat_mention'
        const isChatMsg = n.type === 'chat_message'
        const icon = isChatMention ? '💬' : isChatMsg ? '📨' : '🔔'
        const bgColor = !n.is_read ? (isChatMention ? 'bg-blue-50' : 'bg-green-50') : ''
        const dotColor = !n.is_read ? (isChatMention ? 'bg-blue-500' : 'bg-green-500') : 'bg-gray-300'
        return `
        <div class="p-3 hover:bg-gray-50 cursor-pointer ${bgColor}" onclick="handleNotifClick(${n.id},'${n.type}','${n.related_type || ''}',${n.related_id || 0})">
          <div class="flex gap-2">
            <div class="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${dotColor}"></div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800">${icon} ${n.title}</p>
              <p class="text-xs text-gray-500 truncate">${n.message}</p>
              <p class="text-xs text-gray-400 mt-1">${toLocalDayjs(n.created_at).format('DD/MM HH:mm')}</p>
            </div>
          </div>
        </div>`
      }).join('') || '<div class="p-4 text-center text-gray-400 text-sm">Không có thông báo</div>'
    }

    // Update chat unread badges on task rows
    updateChatUnreadBadges()
  } catch (e) { /* silent */ }
}

// Handle notification click — navigate to correct chat tab
async function handleNotifClick(notifId, type, relatedType, relatedId) {
  // Mark as read
  await api(`/notifications/${notifId}/read`, { method: 'patch' })
  $('notifDropdown').style.display = 'none'
  loadNotifications()

  if (!relatedId) return

  if (relatedType === 'task') {
    // Open task detail and switch to Chat tab
    await openTaskDetail(relatedId, true)
  } else if (relatedType === 'project') {
    // Open project detail and switch to Chat tab
    await openProjectDetail(relatedId, true)
  }
}

// Update chat unread badges on visible task rows
function updateChatUnreadBadges() {
  // Update task row chat badges
  document.querySelectorAll('tr.task-main-row[data-task-id]').forEach(row => {
    const taskId = row.getAttribute('data-task-id')
    const key = `task_${taskId}`
    const count = _chatUnreadMap[key] || 0
    const wrap = row.querySelector('.task-name-wrap')
    if (!wrap) return
    let badge = wrap.querySelector('.chat-unread-badge')
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span')
        badge.className = 'chat-unread-badge'
        wrap.appendChild(badge)
      }
      badge.textContent = count
    } else if (badge) {
      badge.remove()
    }
  })

  // Update project chat tab badge if on project detail page
  const projId = window._currentProjectDetailId
  if (projId) updateProjectChatTabBadge(projId)

  // Update project card badges in the projects grid
  document.querySelectorAll('[data-project-id]').forEach(card => {
    const pid = card.getAttribute('data-project-id')
    const count = _chatUnreadMap[`project_${pid}`] || 0
    let dot = card.querySelector('.proj-chat-badge')
    if (count > 0) {
      if (!dot) {
        dot = document.createElement('span')
        dot.className = 'proj-chat-badge'
        dot.title = `${count} tin nhắn chưa đọc trong Chat nhóm`
        card.style.position = 'relative'
        card.appendChild(dot)
      }
      dot.textContent = count
    } else if (dot) {
      dot.remove()
    }
  })
}

async function markAllRead() {
  await api('/notifications/read-all', { method: 'patch' })
  loadNotifications()
  $('notifDropdown').style.display = 'none'
}

// Mark all chat notifications as read for a given context
async function markChatNotifsRead(contextType, contextId) {
  try {
    // Remove from local unread map immediately for instant UI update
    delete _chatUnreadMap[`${contextType}_${contextId}`]
    updateChatUnreadBadges()
    // Mark on server via read-all for this context (batch via notifications list)
    const notifs = await api('/notifications')
    const toRead = notifs.filter(n =>
      !n.is_read &&
      (n.type === 'chat_message' || n.type === 'chat_mention') &&
      n.related_type === contextType &&
      String(n.related_id) === String(contextId)
    )
    if (toRead.length > 0) {
      await Promise.all(toRead.map(n => api(`/notifications/${n.id}/read`, { method: 'patch' })))
      loadNotifications()
    }
  } catch (e) { /* silent */ }
}

// ================================================================
// PROJECTS
// ================================================================
async function loadProjects() {
  try {
    allProjects = await api('/projects')
    allUsers = await api('/users')
    // Cập nhật cache role ngay sau khi load (my_project_role từ API)
    refreshProjectRoleCache()

    // Luôn reset về card view khi vào trang
    _projectViewMode = 'card'
    const btnCard = $('btnViewCard')
    const btnList = $('btnViewList')
    if (btnCard) btnCard.classList.add('active')
    if (btnList) btnList.classList.remove('active')

    renderProjectsGrid(allProjects)

    // Fill project filter dropdowns across pages (plain selects: tsProject, costProject)
    const selects = ['tsProject', 'costProject']
    selects.forEach(id => {
      const el = $(id)
      if (el) {
        if (!el.querySelector('option[value=""]')) el.innerHTML = '<option value="">-- Chọn dự án --</option>'
        else el.innerHTML = el.querySelector('option[value=""]').outerHTML
        allProjects.forEach(p => {
          const opt = document.createElement('option')
          opt.value = p.id; opt.textContent = `${p.code} - ${p.name}`
          el.appendChild(opt)
        })
      }
    })

    // Build searchable comboboxes for project filters
    const projItems = allProjects.map(p => ({ value: String(p.id), label: `${p.code} – ${p.name}` }))

    // Timesheet project filter
    createCombobox('tsProjectFilterCombobox', {
      placeholder: 'Tất cả dự án',
      items: projItems,
      value: '',
      fullWidth: true,
      onchange: () => loadTimesheets()
    })

    // Cost/Revenue project filter
    createCombobox('costProjectFilterCombobox', {
      placeholder: 'Tất cả dự án',
      items: projItems,
      value: '',
      fullWidth: true,
      onchange: () => loadCostDashboard()
    })

    // Finance-by-project selector
    createCombobox('finProjSelectCombobox', {
      placeholder: '-- Chọn dự án --',
      items: projItems,
      value: '',
      fullWidth: true,
      onchange: (val) => { if (val) loadFinanceProject() }
    })

    // Client filter combobox (unique clients from allProjects, sorted A-Z)
    const uniqueClients = [...new Set(
      allProjects.map(p => p.client).filter(c => c && c.trim())
    )].sort((a, b) => a.localeCompare(b, 'vi'))
    const clientItems = uniqueClients.map(c => ({ value: c, label: c }))
    createCombobox('projectClientCombobox', {
      placeholder: '🏢 Tất cả chủ đầu tư',
      items: clientItems,
      value: '',
      fullWidth: true,
      onchange: () => filterProjects()
    })

  } catch (e) { toast('Lỗi tải dự án: ' + e.message, 'error') }
}

// ── Project list pagination state ────────────────────────────────────────
const PROJ_PAGE_SIZE = 18   // 3-col grid: 18 = 6 hàng × 3 cột; list view cũng dùng chung
let _projCurrentPage = 1
let _projAllData     = []   // full sorted+filtered dataset

function projPaginatedData() {
  const start = (_projCurrentPage - 1) * PROJ_PAGE_SIZE
  return _projAllData.slice(start, start + PROJ_PAGE_SIZE)
}

function renderProjectPagination() {
  const container = $('projectPagination')
  if (!container) return
  const total = _projAllData.length
  const totalPages = Math.max(1, Math.ceil(total / PROJ_PAGE_SIZE))
  if (totalPages <= 1) { container.innerHTML = ''; return }

  const p = _projCurrentPage
  let pages = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages = [1]
    if (p > 3) pages.push('...')
    for (let i = Math.max(2, p - 1); i <= Math.min(totalPages - 1, p + 1); i++) pages.push(i)
    if (p < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  const btn = (label, page, disabled = false, active = false) =>
    `<button onclick="projGoPage(${page})" ${disabled ? 'disabled' : ''}
      class="min-w-[32px] h-8 px-2 rounded-lg text-xs font-medium border transition-colors
      ${active ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary'}
      ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}">${label}</button>`

  const from = total === 0 ? 0 : (p - 1) * PROJ_PAGE_SIZE + 1
  const to   = Math.min(p * PROJ_PAGE_SIZE, total)

  container.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-3 pt-4 border-t border-gray-100 mt-4">
      <p class="text-xs text-gray-500">Hiển thị <strong>${from}–${to}</strong> / <strong>${total}</strong> dự án</p>
      <div class="flex items-center gap-1">
        ${btn('<i class="fas fa-chevron-left"></i>', p - 1, p === 1)}
        ${pages.map(pg => pg === '...'
            ? `<span class="px-1 text-gray-400 text-xs">…</span>`
            : btn(pg, pg, false, pg === p)
          ).join('')}
        ${btn('<i class="fas fa-chevron-right"></i>', p + 1, p === totalPages)}
      </div>
    </div>`
}

function projGoPage(page) {
  const totalPages = Math.max(1, Math.ceil(_projAllData.length / PROJ_PAGE_SIZE))
  _projCurrentPage = Math.max(1, Math.min(page, totalPages))
  renderProjectRows()
  renderProjectPagination()
  const grid = $('projectsGrid')
  if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function renderProjectsGrid(projects) {
  // Thứ tự ưu tiên trạng thái: active → planning → on_hold → completed → cancelled
  const STATUS_PRIORITY = { active: 0, planning: 1, on_hold: 2, completed: 3, cancelled: 4 }
  _projAllData = [...projects].sort((a, b) => {
    const sa = STATUS_PRIORITY[a.status] ?? 9
    const sb = STATUS_PRIORITY[b.status] ?? 9
    if (sa !== sb) return sa - sb
    return (a.code || '').localeCompare(b.code || '', 'vi')
  })
  _projCurrentPage = 1
  renderProjectRows()
  renderProjectPagination()
}

function renderProjectRows() {
  const grid = $('projectsGrid')
  if (!grid) return

  // Sắp xếp A-Z theo mã dự án (cả hai view)
  const sorted = projPaginatedData()

  const typeColors = {
    building:       '#0066CC',
    infrastructure: '#F59E0B',
    transport:      '#8B5CF6',
    energy:         '#EF4444',
    hydraulic:      '#06B6D4'
  }

  /* ── CARD VIEW (style cũ, sort A-Z theo mã) ──────── */
  if (_projectViewMode === 'card') {
    grid.className = 'card-view'
    if (_projAllData.length === 0) {
      grid.innerHTML = `<div class="col-span-3 text-center py-12 text-gray-400">
        <i class="fas fa-project-diagram text-5xl mb-3"></i><p>Chưa có dự án nào</p>
      </div>`
      return
    }
    grid.innerHTML = sorted.map(p => {
      const total = p.total_tasks || 0
      const done  = p.completed_tasks || 0
      const pct   = total > 0 ? Math.round((done / total) * 100) : (p.progress || 0)
      const hasOverdue = p.overdue_tasks > 0
      return `<div class="card hover:shadow-md transition-shadow cursor-pointer" data-project-id="${p.id}" onclick="openProjectDetail(${p.id})" style="position:relative">
        <div class="flex justify-between items-start mb-3">
          <div class="flex items-center gap-2">
            <div class="w-10 h-10 rounded-lg flex items-center justify-center text-white text-xs font-bold" style="background:${typeColors[p.project_type]||'#0066CC'}">
              ${p.code?.substring(0, 3)}
            </div>
            <div>
              <h3 class="font-bold text-gray-800 text-sm leading-tight">${p.name}</h3>
              <span class="text-xs text-gray-400">${p.code} • ${getProjectTypeName(p.project_type)}</span>
            </div>
          </div>
          ${getStatusBadge(p.status)}
        </div>
        ${p.client ? `<p class="text-xs text-gray-500 mb-2"><i class="fas fa-building mr-1"></i>${p.client}</p>` : ''}
        <div class="space-y-2 mb-3">
          <div class="flex justify-between text-xs text-gray-500">
            <span><i class="fas fa-calendar mr-1"></i>${fmtDate(p.start_date)} → ${fmtDate(p.end_date)}</span>
            <span class="font-medium ${hasOverdue ? 'text-red-600' : 'text-primary'}">${pct}%</span>
          </div>
          <div class="progress-bar"><div class="progress-fill ${hasOverdue ? 'danger' : ''}" style="width:${pct}%"></div></div>
        </div>
        <div class="flex items-center justify-between text-xs text-gray-500">
          <div class="flex gap-3">
            <span><i class="fas fa-tasks mr-1"></i>${done}/${total} task</span>
            ${hasOverdue ? `<span class="text-red-500 font-bold"><i class="fas fa-exclamation-triangle mr-1"></i>${p.overdue_tasks} trễ</span>` : ''}
          </div>
          <div class="flex gap-2">
            <span><i class="fas fa-users mr-1"></i>${p.member_count||0}</span>
            ${p.contract_value != null && currentUser?.role === 'system_admin' ? `<span class="text-primary font-medium">${fmtMoney(p.contract_value)}</span>` : ''}
          </div>
        </div>
      </div>`
    }).join('')

  /* ── LIST / DETAIL VIEW (bảng cột, sort A-Z theo mã) */
  } else {
    grid.className = 'list-view'
    if (_projAllData.length === 0) {
      grid.innerHTML = `<div class="text-center py-16 text-gray-400">
        <i class="fas fa-project-diagram text-5xl mb-3 block"></i><p>Chưa có dự án nào</p>
      </div>`
      return
    }
    const showMoney = currentUser?.role === 'system_admin'
    const rows = sorted.map(p => {
      const total = p.total_tasks || 0
      const done  = p.completed_tasks || 0
      const pct   = total > 0 ? Math.round((done / total) * 100) : (p.progress || 0)
      const hasOverdue = p.overdue_tasks > 0
      const color = typeColors[p.project_type] || '#0066CC'
      return `
      <tr onclick="openProjectDetail(${p.id})">
        <td>
          <div style="display:flex;align-items:center;gap:9px">
            <div class="proj-tbl-icon" style="background:${color}">${p.code?.substring(0,3)}</div>
            <div>
              <div class="proj-tbl-name">${p.name}</div>
              <div class="proj-tbl-sub">${p.code}</div>
            </div>
          </div>
        </td>
        <td style="white-space:nowrap;color:#6b7280">${getProjectTypeName(p.project_type)}</td>
        <td style="color:#6b7280;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.client || '—'}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="proj-tbl-progress-bar" style="flex:1">
              <div class="proj-tbl-progress-fill${hasOverdue ? ' danger' : ''}" style="width:${pct}%"></div>
            </div>
            <span class="proj-tbl-pct" style="color:${hasOverdue ? '#ef4444' : '#00A651'}">${pct}%</span>
          </div>
        </td>
        <td style="white-space:nowrap;text-align:center">
          <span style="font-size:12px;color:#374151">${done}/${total}</span>
          ${hasOverdue ? `<span style="color:#ef4444;font-size:11px;display:block;font-weight:600"><i class="fas fa-exclamation-triangle mr-1"></i>${p.overdue_tasks} trễ</span>` : ''}
        </td>
        <td style="white-space:nowrap;color:#6b7280;font-size:12px">${fmtDate(p.start_date)}</td>
        <td style="white-space:nowrap;color:#6b7280;font-size:12px">${fmtDate(p.end_date)}</td>
        <td style="text-align:center;color:#6b7280;font-size:12px"><i class="fas fa-users mr-1"></i>${p.member_count||0}</td>
        ${showMoney ? `<td style="white-space:nowrap;color:#00A651;font-weight:600;font-size:12px">${p.contract_value != null ? fmtMoney(p.contract_value) : '—'}</td>` : ''}
        <td>${getStatusBadge(p.status)}</td>
      </tr>`
    }).join('')

    grid.innerHTML = `
    <div class="proj-table-wrap">
      <table class="proj-table">
        <thead>
          <tr>
            <th>Tên dự án</th>
            <th>Loại</th>
            <th>Khách hàng</th>
            <th style="min-width:140px">Tiến độ</th>
            <th style="text-align:center">Tasks</th>
            <th>Ngày bắt đầu</th>
            <th>Ngày kết thúc</th>
            <th style="text-align:center">Thành viên</th>
            ${showMoney ? '<th>Giá trị HĐ</th>' : ''}
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
  }
}

function setProjectView(mode) {
  _projectViewMode = mode
  const btnCard = $('btnViewCard')
  const btnList = $('btnViewList')
  if (btnCard) { btnCard.classList.toggle('active', mode === 'card') }
  if (btnList) { btnList.classList.toggle('active', mode === 'list') }
  filterProjects()
}

function filterProjects() {
  const search = $('projectSearch').value.toLowerCase()
  const status = $('projectStatusFilter').value
  const type = $('projectTypeFilter').value
  const client = _cbGetValue('projectClientCombobox')
  const filtered = allProjects.filter(p =>
    (!search || p.name.toLowerCase().includes(search) || p.code.toLowerCase().includes(search) || (p.client||'').toLowerCase().includes(search)) &&
    (!status || p.status === status) &&
    (!type || p.project_type === type) &&
    (!client || (p.client || '') === client)
  )
  renderProjectsGrid(filtered)
}

// ── Project detail task pagination ──────────────────────────────
const PROJ_TASK_PAGE_SIZE = 20
let _projTaskPage = 1
let _projTaskAllData = []

function projTaskPaginatedData() {
  const start = (_projTaskPage - 1) * PROJ_TASK_PAGE_SIZE
  return _projTaskAllData.slice(start, start + PROJ_TASK_PAGE_SIZE)
}

function renderProjTaskRows() {
  const tbody = document.getElementById('projTasksTbody')
  if (!tbody) return
  const data = projTaskPaginatedData()
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-gray-400 text-sm">Chưa có task nào trong dự án này</td></tr>`
    return
  }
  tbody.innerHTML = data.map(t => `
    <tr class="${isOverdue(t) ? 'overdue-row' : 'table-row'}" onclick="openTaskDetail(${t.id})" style="cursor:pointer">
      <td class="py-1.5 pr-3 font-medium text-gray-800">${t.title}</td>
      <td class="py-1.5 pr-3"><span class="badge" style="background:#e0f2fe;color:#0369a1">${t.discipline_code||'-'}</span></td>
      <td class="py-1.5 pr-3">${getPriorityBadge(t.priority)}</td>
      <td class="py-1.5 pr-3 text-gray-600">${t.assigned_to_name||'<span class="text-gray-300">Chưa giao</span>'}</td>
      <td class="py-1.5 pr-3 ${isOverdue(t) ? 'text-red-600 font-bold' : 'text-gray-500'}">${fmtDate(t.due_date)}</td>
      <td class="py-1.5 pr-3">
        <div class="flex items-center gap-1.5">
          <div class="progress-bar" style="width:60px"><div class="progress-fill ${isOverdue(t)?'danger':''}" style="width:${t.progress||0}%"></div></div>
          <span>${t.progress||0}%</span>
        </div>
      </td>
      <td class="py-1.5">${getStatusBadge(t.status)}</td>
    </tr>`).join('')
}

function renderProjTaskPagination() {
  const container = document.getElementById('projTasksPagination')
  if (!container) return
  const total = _projTaskAllData.length
  const totalPages = Math.ceil(total / PROJ_TASK_PAGE_SIZE)
  if (totalPages <= 1) { container.innerHTML = ''; return }
  const p = _projTaskPage
  const start = (p - 1) * PROJ_TASK_PAGE_SIZE + 1
  const end = Math.min(p * PROJ_TASK_PAGE_SIZE, total)
  const btn = (pg, label, disabled, active) =>
    `<button onclick="projTaskGoPage(${pg})" class="px-3 py-1 rounded text-xs border ${active ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}" ${disabled ? 'disabled' : ''}>${label}</button>`
  let pages = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(btn(i, i, false, i === p))
  } else {
    pages.push(btn(1, 1, false, p === 1))
    if (p > 3) pages.push('<span class="px-1 text-gray-400">…</span>')
    for (let i = Math.max(2, p - 1); i <= Math.min(totalPages - 1, p + 1); i++) pages.push(btn(i, i, false, i === p))
    if (p < totalPages - 2) pages.push('<span class="px-1 text-gray-400">…</span>')
    pages.push(btn(totalPages, totalPages, false, p === totalPages))
  }
  container.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-2">
      <span class="text-xs text-gray-500">Hiển thị ${start}–${end} / ${total} task</span>
      <div class="flex items-center gap-1">
        ${btn(p - 1, '‹ Trước', p <= 1, false)}
        ${pages.join('')}
        ${btn(p + 1, 'Tiếp ›', p >= totalPages, false)}
      </div>
    </div>`
}

function projTaskGoPage(page) {
  const totalPages = Math.ceil(_projTaskAllData.length / PROJ_TASK_PAGE_SIZE)
  if (page < 1 || page > totalPages) return
  _projTaskPage = page
  renderProjTaskRows()
  renderProjTaskPagination()
  const el = document.getElementById('projTasksTbody')
  if (el) el.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function openProjectDetail(id, openChatTab = false) {
  try {
    const project = await api(`/projects/${id}`)
    const categories = await api(`/projects/${id}/categories`)
    const tasks = await api(`/tasks?project_id=${id}`)

    $('projectDetailName').textContent = project.name
    $('projectDetailCode').textContent = `${project.code} • ${getProjectTypeName(project.project_type)}`
    $('projectDetailStatus').innerHTML = getStatusBadge(project.status)

    // Kiểm tra project-level role của user hiện tại trong dự án này
    const myMember = project.members?.find(m => m.user_id === currentUser.id)
    const myProjectRole = myMember?.role || null
    // Effective role: ưu tiên role cao hơn giữa global và project-level
    const rolePriority = { system_admin: 4, project_admin: 3, project_leader: 2, member: 1 }
    const globalRoleLevel = rolePriority[currentUser.role] || 1
    let projectRoleLevel = rolePriority[myProjectRole] || 0
    // Bổ sung: kiểm tra user có phải admin_id / leader_id của project
    if (project.admin_id === currentUser.id) projectRoleLevel = Math.max(projectRoleLevel, rolePriority['project_admin'])
    if (project.leader_id === currentUser.id) projectRoleLevel = Math.max(projectRoleLevel, rolePriority['project_leader'])
    const effectiveRole = projectRoleLevel > globalRoleLevel
      ? (projectRoleLevel >= rolePriority['project_admin'] ? 'project_admin' : 'project_leader')
      : currentUser.role

    // Cập nhật cache để các hàm khác dùng đúng role trong project này
    _projectRoleCache[id] = effectiveRole

    // Project Leader không được sửa thông tin dự án, chỉ system_admin và project_admin
    const canEdit = ['system_admin', 'project_admin'].includes(effectiveRole)
    const canDelete = currentUser.role === 'system_admin'
    const canManageMembers = ['system_admin', 'project_admin'].includes(currentUser.role) ||
      ['project_admin', 'project_leader'].includes(myProjectRole)

    // Show edit/delete in project detail header
    let projActions = document.getElementById('projDetailActions')
    if (!projActions) {
      projActions = document.createElement('div')
      projActions.id = 'projDetailActions'
      projActions.className = 'flex gap-2 ml-4'
      const statusEl = $('projectDetailStatus')
      if (statusEl?.parentElement) statusEl.parentElement.insertBefore(projActions, statusEl.nextSibling)
    }
    projActions.innerHTML = `
      ${canEdit ? `<button onclick="openProjectModal(${JSON.stringify(project).replace(/"/g,'&quot;')})" class="btn-secondary text-xs px-3 py-1.5"><i class="fas fa-edit mr-1"></i>Sửa</button>` : ''}
      ${canDelete ? `<button onclick="confirmDeleteProject(${project.id}, '${project.name.replace(/'/g,"\\'")}' )" class="btn-danger text-xs px-3 py-1.5"><i class="fas fa-trash mr-1"></i>Xóa</button>` : ''}
    `

    // Nếu user là project_leader/admin theo project, show badge thông báo
    if (myProjectRole && myProjectRole !== 'member' && currentUser.role === 'member') {
      const roleNames = { project_leader: 'Trưởng dự án', project_admin: 'Quản lý dự án' }
      const banner = document.createElement('div')
      banner.className = 'mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 flex items-center gap-2'
      banner.innerHTML = `<i class="fas fa-shield-alt"></i> Bạn là <strong>${roleNames[myProjectRole] || myProjectRole}</strong> của dự án này – có quyền xem và quản lý toàn bộ công việc.`
      const detailContent = $('projectDetailContent')
      if (detailContent) detailContent.insertAdjacentElement('beforebegin', banner)
    }

    // Dùng task_stats từ server (không bị lọc RBAC) cho tiến độ tổng & số trễ hạn
    const ts     = project.task_stats || {}
    const total  = ts.total_tasks  || tasks.length
    const done   = ts.done_tasks   ?? tasks.filter(t => t.status === 'completed' || t.status === 'review').length
    const overdue = ts.overdue_tasks ?? tasks.filter(t => isOverdue(t)).length
    const pct    = total > 0 ? Math.round((done / total) * 100) : 0

    $('projectDetailContent').innerHTML = `
      <div class="grid grid-cols-1 ${currentUser.role === 'system_admin' ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-4 mb-6">
        <div class="card">
          <p class="text-xs text-gray-500 mb-1">Chủ đầu tư</p>
          <p class="font-bold text-gray-800">${project.client || '-'}</p>
        </div>
        ${currentUser.role === 'system_admin' ? `
        <div class="card">
          <p class="text-xs text-gray-500 mb-1">Giá trị HĐ</p>
          <p class="font-bold text-green-600">${fmt(project.contract_value)} VNĐ</p>
        </div>` : ''}
        <div class="card">
          <p class="text-xs text-gray-500 mb-1">Tiến độ tổng</p>
          <div class="flex items-center gap-2">
            <div class="progress-bar flex-1"><div class="progress-fill ${overdue > 0 ? 'danger' : ''}" style="width:${pct}%"></div></div>
            <span class="font-bold text-sm">${pct}%</span>
          </div>
          <p class="text-xs text-gray-400 mt-1">${done}/${total} task • <span class="${overdue > 0 ? 'text-red-500' : 'text-gray-400'}">${overdue} trễ hạn</span></p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <!-- Team Members -->
        <div class="card">
          <div class="flex justify-between items-center mb-4">
            <h3 class="font-bold text-gray-800"><i class="fas fa-users text-primary mr-2"></i>Thành viên (${project.members?.length || 0})</h3>
            ${canManageMembers ? `<button onclick="openAddMemberModal(${project.id})" class="btn-primary text-xs px-3 py-1.5"><i class="fas fa-plus mr-1"></i>Thêm</button>` : ''}
          </div>
          <div class="space-y-2 max-h-48 overflow-y-auto">
            ${project.members?.map(m => `
              <div class="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg">
                <div class="flex items-center gap-2">
                  <div class="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">${m.full_name?.split(' ').pop()?.charAt(0) || 'U'}</div>
                  <div>
                    <div class="text-sm font-medium text-gray-800">${m.full_name}${m.user_id === currentUser.id ? ' <span class="text-xs text-blue-500">(bạn)</span>' : ''}</div>
                    <div class="text-xs text-gray-400">${m.department || ''}</div>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  ${canManageMembers ? `
                    <select class="text-xs border rounded px-1 py-0.5 bg-white" style="max-width:130px"
                      onchange="updateMemberRole(${project.id}, ${m.user_id}, this.value)">
                      <option value="member" ${m.role==='member'?'selected':''}>Thành viên</option>
                      <option value="project_leader" ${m.role==='project_leader'?'selected':''}>Trưởng DA</option>
                      <option value="project_admin" ${m.role==='project_admin'?'selected':''}>Quản lý DA</option>
                    </select>
                  ` : `${getProjectRoleBadge(m.role)}`}
                  ${canManageMembers ? `<button onclick="removeMember(${project.id}, ${m.user_id})" class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-times"></i></button>` : ''}
                </div>
              </div>
            `).join('') || '<p class="text-gray-400 text-sm text-center">Chưa có thành viên</p>'}
          </div>
        </div>

        <!-- Categories -->
        <div class="card">
          <div class="flex justify-between items-center mb-4">
            <h3 class="font-bold text-gray-800"><i class="fas fa-list text-accent mr-2"></i>Hạng mục (${categories.length})</h3>
            ${canEdit ? `<button onclick="openCategoryModal(${project.id})" class="btn-primary text-xs px-3 py-1.5"><i class="fas fa-plus mr-1"></i>Thêm</button>` : ''}
          </div>
          <div class="space-y-2 max-h-48 overflow-y-auto">
            ${categories.map(cat => `
              <div class="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg">
                <div>
                  <span class="text-xs font-medium text-gray-800">${cat.name}</span>
                  ${cat.code ? `<span class="badge ml-1 text-xs" style="background:#f3f4f6;color:#6b7280">${cat.code}</span>` : ''}
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-400">${cat.completed_tasks||0}/${cat.task_count||0}</span>
                  ${canEdit ? `<button onclick="openCategoryModal(${project.id}, ${JSON.stringify(cat).replace(/"/g,'&quot;')})" class="text-blue-400 hover:text-blue-600 text-xs mr-1"><i class="fas fa-edit"></i></button>` : ''}
              ${canEdit ? `<button onclick="confirmDeleteCategory(${cat.id}, '${cat.name.replace(/'/g,"\\'")}', ${cat.task_count||0})" class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash"></i></button>` : ''}
                </div>
              </div>
            `).join('') || '<p class="text-gray-400 text-sm text-center">Chưa có hạng mục</p>'}
          </div>
        </div>
      </div>

      <!-- Project Tabs: Tasks / Chat -->
      <div class="card p-0 overflow-hidden">
        <!-- Tab bar -->
        <div class="flex border-b bg-gray-50 px-4 pt-2">
          <button id="projTab-tasks" onclick="switchProjectTab('tasks',${project.id})"
            class="tab-btn active text-xs py-2 px-4 mr-1">
            <i class="fas fa-tasks mr-1"></i>Danh sách Task (${tasks.length})
          </button>
          <button id="projTab-chat" onclick="switchProjectTab('chat',${project.id})"
            class="tab-btn text-xs py-2 px-4">
            <i class="fas fa-comments mr-1"></i>Chat nhóm
          </button>
        </div>

        <!-- Tasks panel -->
        <div id="projPanel-tasks" class="p-4">
          <div class="flex justify-between items-center mb-3">
            <span class="text-xs text-gray-500">Tổng ${tasks.length} task • ${done} hoàn thành • ${overdue > 0 ? `<span class="text-red-500">${overdue} trễ hạn</span>` : '0 trễ hạn'}</span>
            <button onclick="openTaskModal(null, ${project.id})" class="btn-primary text-xs px-3 py-1.5"><i class="fas fa-plus mr-1"></i>Tạo task</button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead><tr class="text-left text-gray-400 border-b">
                <th class="pb-2 pr-3">Tên task</th>
                <th class="pb-2 pr-3">Bộ môn</th>
                <th class="pb-2 pr-3">Ưu tiên</th>
                <th class="pb-2 pr-3">Phụ trách</th>
                <th class="pb-2 pr-3">Hạn</th>
                <th class="pb-2 pr-3">Tiến độ</th>
                <th class="pb-2">TT</th>
              </tr></thead>
              <tbody id="projTasksTbody" class="divide-y"></tbody>
            </table>
          </div>
          <div id="projTasksPagination" class="mt-3"></div>
        </div>

        <!-- Chat panel (lazy-loaded) -->
        <div id="projPanel-chat" class="hidden" style="height:520px">
          <div id="projectChatPanel_${project.id}" style="height:100%"></div>
        </div>
      </div>
    `

    // Store current project id for chat tab switching
    window._currentProjectDetailId = project.id

    navigate('project-detail')

    // Render paginated task list (after DOM is ready)
    setTimeout(() => {
      _projTaskAllData = tasks
      _projTaskPage = 1
      renderProjTaskRows()
      renderProjTaskPagination()
    }, 0)

    // Always show unread badge on the chat tab button immediately
    setTimeout(() => updateProjectChatTabBadge(project.id), 50)

    // If opened from notification, auto-switch to chat tab
    if (openChatTab) {
      setTimeout(() => {
        switchProjectTab('chat', project.id)
        markChatNotifsRead('project', project.id)
      }, 100)
    }
  } catch (e) { toast('Lỗi tải dự án: ' + e.message, 'error') }
}

function confirmDeleteProject(id, name) {
  showConfirmDelete(
    'Xóa Dự án',
    `<p>Bạn có chắc muốn xóa dự án <strong>"${name}"</strong>?</p><p class="text-red-600 mt-1 text-xs font-bold">⚠️ Tất cả task, hạng mục, timesheet, chi phí và doanh thu của dự án sẽ bị xóa vĩnh viễn!</p>`,
    async () => {
      await api(`/projects/${id}`, { method: 'delete' })
      toast('Đã xóa dự án và tất cả dữ liệu liên quan')
      navigate('projects')
    }
  )
}

function openProjectModal(project = null) {
  // Chỉ system_admin mới được tạo dự án mới
  if (!project && currentUser?.role !== 'system_admin') {
    toast('Chỉ System Admin mới có quyền tạo dự án mới.', 'error')
    return
  }
  $('projectModalTitle').textContent = project ? 'Chỉnh sửa dự án' : 'Tạo dự án mới'
  $('projectId').value = project?.id || ''
  $('projectCode').value = project?.code || ''
  // Chỉ system_admin mới được đổi mã dự án
  const codeField = $('projectCode')
  const isAdmin = currentUser?.role === 'system_admin'
  codeField.readOnly = project ? !isAdmin : false
  codeField.style.background = (project && !isAdmin) ? '#f3f4f6' : ''
  codeField.style.cursor    = (project && !isAdmin) ? 'not-allowed' : ''
  codeField.title = (project && !isAdmin) ? 'Chỉ System Admin mới có thể thay đổi mã dự án' : ''
  $('projectName').value = project?.name || ''
  $('projectCodeLetter').value = project?.project_code_letter || ''
  // Update preview sample
  const updateLetterPreview = () => {
    const cl = $('projectCodeLetter').value.trim() || $('projectCode').value.trim() || 'MÃ-DỰ-ÁN'
    $('letterPreviewSample').textContent = `01-CV/OneCAD-BIM(${cl})`
  }
  updateLetterPreview()
  $('projectCodeLetter').oninput = updateLetterPreview
  $('projectCode').addEventListener('input', updateLetterPreview)
  $('projectDesc').value = project?.description || ''
  $('projectClient').value = project?.client || ''
  $('projectType').value = project?.project_type || 'building'
  $('projectStartDate').value = project?.start_date || ''
  $('projectEndDate').value = project?.end_date || ''
  setMoneyInput('projectContractValue', project?.contract_value || 0)
  // Show/hide contract value field based on role
  const contractRow = document.getElementById('contractValueRow')
  if (contractRow) contractRow.style.display = isAdmin ? '' : 'none'
  $('projectStatus').value = project?.status || 'planning'
  $('projectLocation').value = project?.location || ''

  const admins = allUsers.filter(u => ['system_admin','project_admin','project_leader'].includes(u.role))
  $('projectAdmin').innerHTML = admins.map(u => `<option value="${u.id}" ${project?.admin_id===u.id?'selected':''}>${u.full_name}</option>`).join('')
  $('projectLeader').innerHTML = '<option value="">-- Chọn leader --</option>' + allUsers.map(u => `<option value="${u.id}" ${project?.leader_id===u.id?'selected':''}>${u.full_name}</option>`).join('')

  openModal('projectModal')
}

$('projectForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('projectId').value
  const data = {
    code: $('projectCode').value, name: $('projectName').value,
    project_code_letter: $('projectCodeLetter').value.trim() || $('projectCode').value.trim(),
    description: $('projectDesc').value, client: $('projectClient').value,
    project_type: $('projectType').value, status: $('projectStatus').value,
    start_date: $('projectStartDate').value, end_date: $('projectEndDate').value,
    contract_value: currentUser?.role === 'system_admin' ? (parseMoneyVal('projectContractValue') || 0) : undefined,
    location: $('projectLocation').value,
    admin_id: parseInt($('projectAdmin').value) || null,
    leader_id: parseInt($('projectLeader').value) || null
  }
  try {
    if (id) await api(`/projects/${id}`, { method: 'put', data })
    else await api('/projects', { method: 'post', data })
    closeModal('projectModal')
    toast(id ? 'Cập nhật dự án thành công' : 'Tạo dự án thành công')
    loadProjects()
    // Nếu đang xem chi tiết dự án vừa sửa → refresh lại để hiện thông tin mới
    if (id && $('page-project-detail')?.classList.contains('active')) {
      openProjectDetail(parseInt(id))
    }
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
})

// Members
async function openAddMemberModal(projectId) {
  $('memberProjectId').value = projectId

  // Ensure allUsers is loaded
  if (!allUsers.length) {
    try { allUsers = await api('/users') } catch(e) { toast('Lỗi tải danh sách nhân sự', 'error'); return }
  }

  // Build member list
  const items = allUsers.map(u => ({ value: String(u.id), label: u.full_name + ' (' + getRoleLabel(u.role) + ')' }))

  // Destroy old combobox instance and rebuild
  const container = $('memberUserCombobox')
  if (container) container.innerHTML = ''
  if (_cbState['memberUserCombobox']) delete _cbState['memberUserCombobox']

  createCombobox('memberUserCombobox', {
    placeholder: '-- Chọn nhân viên --',
    items,
    fullWidth: true,
    teleport: true,
    panelMaxWidth: '480px',
    dropdownMaxHeight: '320px',
    onchange: (val) => { $('memberUserId').value = val || '' }
  })
  $('memberUserId').value = ''

  openModal('addMemberModal')
}

async function addMemberToProject() {
  const projectId = $('memberProjectId').value
  const userId = _cbGetValue('memberUserCombobox') || $('memberUserId').value
  const role = $('memberRole').value
  if (!userId) { toast('Chọn nhân viên', 'warning'); return }
  try {
    await api(`/projects/${projectId}/members`, { method: 'post', data: { user_id: parseInt(userId), role } })
    closeModal('addMemberModal')
    toast('Thêm thành viên thành công')
    openProjectDetail(parseInt(projectId))
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
}

async function removeMember(projectId, userId) {
  if (!confirm('Xóa thành viên này khỏi dự án?')) return
  try {
    await api(`/projects/${projectId}/members/${userId}`, { method: 'delete' })
    toast('Đã xóa thành viên')
    openProjectDetail(projectId)
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

// Cập nhật vai trò của thành viên trong dự án
async function updateMemberRole(projectId, userId, newRole) {
  try {
    await api(`/projects/${projectId}/members/${userId}`, { method: 'put', data: { role: newRole } })
    const roleNames = { member: 'Thành viên', project_leader: 'Trưởng dự án', project_admin: 'Quản lý dự án' }
    toast(`Đã cập nhật vai trò thành "${roleNames[newRole] || newRole}"`)
    // Không cần reload toàn trang, dropdown đã hiển thị giá trị mới
  } catch (e) {
    toast('Lỗi cập nhật vai trò: ' + (e.response?.data?.error || e.message), 'error')
    // Reload lại để reset dropdown về giá trị cũ
    openProjectDetail(projectId)
  }
}

// Badge hiển thị vai trò trong dự án (project-level role)
function getProjectRoleBadge(role) {
  const badges = {
    project_admin: '<span class="badge text-xs" style="background:#ede9fe;color:#5b21b6"><i class="fas fa-crown mr-1"></i>Quản lý DA</span>',
    project_leader: '<span class="badge text-xs" style="background:#dbeafe;color:#1d4ed8"><i class="fas fa-star mr-1"></i>Trưởng DA</span>',
    member: '<span class="badge text-xs" style="background:#f3f4f6;color:#6b7280">Thành viên</span>'
  }
  return badges[role] || badges.member
}

// Categories
function openCategoryModal(projectId, cat = null) {
  $('catProjectId').value = projectId
  $('catId').value = cat?.id || ''
  $('catModalTitle').textContent = cat ? 'Chỉnh sửa hạng mục' : 'Thêm hạng mục'
  $('catName').value = cat?.name || ''
  $('catCode').value = cat?.code || ''
  $('catStartDate').value = cat?.start_date || ''
  $('catEndDate').value = cat?.end_date || ''
  $('catDescription').value = cat?.description || ''

  // Tab bar: ẩn khi edit, hiện khi tạo mới
  const tabBar = document.getElementById('catTabBar')
  if (cat) {
    if (tabBar) tabBar.style.display = 'none'
    switchCatTab('single')
  } else {
    if (tabBar) tabBar.style.display = ''
    const tab = _catActiveTab || 'single'
    switchCatTab(tab)
    if (tab === 'bulk' && document.querySelectorAll('#catBulkBody tr').length === 0) catBulkReset(5)
    if (tab === 'import') catClearImport()
  }
  openModal('categoryModal')
}

$('categoryForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('catId').value
  const data = {
    project_id: parseInt($('catProjectId').value),
    name: $('catName').value, code: $('catCode').value,
    start_date: $('catStartDate').value, end_date: $('catEndDate').value,
    description: $('catDescription').value
  }
  try {
    if (id) await api(`/categories/${id}`, { method: 'put', data })
    else await api('/categories', { method: 'post', data })
    closeModal('categoryModal')
    toast('Lưu hạng mục thành công')
    openProjectDetail(data.project_id)
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
})

function confirmDeleteCategory(id, name, taskCount) {
  if (taskCount > 0) {
    toast(`Không thể xóa: hạng mục có ${taskCount} task đang dùng`, 'error')
    return
  }
  showConfirmDelete('Xóa Hạng mục', `Xóa hạng mục "<strong>${name}</strong>"?`,
    async () => {
      await api(`/categories/${id}`, { method: 'delete' })
      toast('Đã xóa hạng mục')
    }
  )
}

async function deleteCategory(id) {
  if (!confirm('Xóa hạng mục này?')) return
  try {
    await api(`/categories/${id}`, { method: 'delete' })
    toast('Đã xóa hạng mục')
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

// ================================================================
// CATEGORY MODAL — TAB SWITCHING / BULK / IMPORT
// ================================================================

// Ghi nhớ tab hiện tại
let _catActiveTab = 'single'

function switchCatTab(tab) {
  _catActiveTab = tab
  ;['single','bulk','import'].forEach(t => {
    const btn  = document.getElementById(`catTab-${t}`)
    const pane = document.getElementById(`catPane-${t}`)
    if (!btn || !pane) return
    const active = t === tab
    pane.style.display = active ? '' : 'none'
    btn.style.borderColor   = active ? '#00A651' : 'transparent'
    btn.style.color         = active ? '#00A651'  : '#6b7280'
    btn.style.fontWeight    = active ? '600'       : '400'
  })
}

// ── BULK ADD ──────────────────────────────────────────────────────
let _catBulkRows = 0

function catBulkReset(n = 5) {
  const tbody = document.getElementById('catBulkBody')
  if (!tbody) return
  tbody.innerHTML = ''
  _catBulkRows = 0
  for (let i = 0; i < n; i++) catBulkAddRow()
}

function catBulkAddRow() {
  _catBulkRows++
  const n = _catBulkRows
  const tbody = document.getElementById('catBulkBody')
  if (!tbody) return
  const tr = document.createElement('tr')
  tr.id = `catBulkRow-${n}`
  tr.className = 'border-b border-gray-100 hover:bg-gray-50'
  tr.innerHTML = `
    <td class="py-1 px-2 text-gray-400 text-xs">${n}</td>
    <td class="py-1 px-2">
      <input type="text" class="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
        placeholder="Tên hạng mục *" id="catBulkName-${n}">
    </td>
    <td class="py-1 px-2">
      <input type="text" class="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
        placeholder="Mã (tuỳ chọn)" id="catBulkCode-${n}" style="max-width:110px">
    </td>
    <td class="py-1 px-2">
      <input type="text" class="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
        placeholder="Mô tả" id="catBulkDesc-${n}">
    </td>
    <td class="py-1 px-2 text-center">
      <button onclick="catBulkRemoveRow(${n})" class="text-red-400 hover:text-red-600 text-xs">
        <i class="fas fa-times"></i>
      </button>
    </td>
  `
  tbody.appendChild(tr)
  catBulkUpdateCount()
  // Focus vào dòng mới thêm
  const inp = document.getElementById(`catBulkName-${n}`)
  if (inp) setTimeout(() => inp.focus(), 50)
}

function catBulkRemoveRow(n) {
  const tr = document.getElementById(`catBulkRow-${n}`)
  if (tr) tr.remove()
  catBulkUpdateCount()
}

function catBulkUpdateCount() {
  const rows = document.querySelectorAll('#catBulkBody tr')
  const el = document.getElementById('catBulkCount')
  if (el) el.textContent = `${rows.length} dòng`
}

async function submitCatBulk() {
  const projectId = parseInt($('catProjectId').value)
  const rows = document.querySelectorAll('#catBulkBody tr')
  const categories = []
  rows.forEach(tr => {
    const id   = tr.id.replace('catBulkRow-', '')
    const name = document.getElementById(`catBulkName-${id}`)?.value?.trim()
    const code = document.getElementById(`catBulkCode-${id}`)?.value?.trim()
    const desc = document.getElementById(`catBulkDesc-${id}`)?.value?.trim()
    if (name) categories.push({ name, code: code || null, description: desc || null })
  })
  if (categories.length === 0) { toast('Nhập ít nhất 1 tên hạng mục', 'warning'); return }

  const btn = document.querySelector('#catPane-bulk .btn-primary')
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Đang lưu...' }
  try {
    const res = await api('/categories/bulk', { method: 'post', data: { project_id: projectId, categories } })
    closeModal('categoryModal')
    const msg = res.failed > 0
      ? `Đã tạo ${res.created} hạng mục (${res.failed} lỗi)`
      : `Đã tạo ${res.created} hạng mục thành công`
    toast(msg, res.failed > 0 ? 'warning' : 'success')
    openProjectDetail(projectId)
  } catch (e) {
    toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i>Lưu tất cả' }
  }
}

// ── IMPORT EXCEL ──────────────────────────────────────────────────
let _catBulkImportData = []   // [{code, name}] parsed từ file

function catHandleDrop(e) {
  e.preventDefault()
  document.getElementById('catImportDropzone').style.borderColor = ''
  const file = e.dataTransfer?.files?.[0]
  if (file) catHandleFile(file)
}

function catHandleFile(file) {
  if (!file) return
  if (!file.name.match(/\.xlsx?$/i)) { toast('Chỉ hỗ trợ file .xlsx, .xls', 'error'); return }
  const reader = new FileReader()
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

      // Tự động detect header row
      let dataStart = 0
      if (rows.length > 0) {
        const first = rows[0].map(v => String(v).toLowerCase().trim())
        if (first.some(v => v.includes('mã') || v.includes('tên') || v.includes('code') || v.includes('name'))) {
          dataStart = 1
        }
      }

      _catBulkImportData = []
      for (let i = dataStart; i < rows.length; i++) {
        const row = rows[i]
        // Cột A = mã, cột B = tên (theo template)
        const code = String(row[0] ?? '').trim()
        const name = String(row[1] ?? '').trim()
        if (!name && !code) continue
        _catBulkImportData.push({ code: code || null, name: name || code })
      }

      catRenderImportPreview()
    } catch (err) {
      toast('Lỗi đọc file: ' + err.message, 'error')
    }
  }
  reader.readAsArrayBuffer(file)
  // Reset file input để có thể chọn lại cùng file
  document.getElementById('catImportFile').value = ''
}

function catRenderImportPreview() {
  const preview = document.getElementById('catImportPreview')
  const body    = document.getElementById('catImportBody')
  const count   = document.getElementById('catImportCount')
  const summary = document.getElementById('catImportSummary')
  if (!preview || !body) return

  if (_catBulkImportData.length === 0) {
    preview.style.display = 'none'
    return
  }

  body.innerHTML = _catBulkImportData.map((r, i) => {
    const valid = r.name && r.name.trim()
    const rowCls = valid ? '' : 'bg-red-50'
    const icon = valid
      ? '<span class="text-green-500"><i class="fas fa-check-circle"></i></span>'
      : '<span class="text-red-400"><i class="fas fa-exclamation-circle" title="Thiếu tên"></i></span>'
    return `<tr class="border-b border-gray-100 ${rowCls}">
      <td class="py-1.5 px-3 text-gray-400">${i + 1}</td>
      <td class="py-1.5 px-3 font-mono text-xs text-blue-600">${r.code || '<span class="text-gray-300">—</span>'}</td>
      <td class="py-1.5 px-3 text-gray-800">${r.name || '<span class="text-red-400 italic">Trống</span>'}</td>
      <td class="py-1.5 px-3 text-center">${icon}</td>
    </tr>`
  }).join('')

  const valid = _catBulkImportData.filter(r => r.name?.trim()).length
  const invalid = _catBulkImportData.length - valid
  count.textContent = `${_catBulkImportData.length} dòng`
  summary.innerHTML = `<span class="text-green-600"><i class="fas fa-check-circle mr-1"></i>${valid} hợp lệ</span>${invalid > 0 ? ` &nbsp;<span class="text-red-500"><i class="fas fa-exclamation-circle mr-1"></i>${invalid} bỏ qua (thiếu tên)</span>` : ''}`

  const submitBtn = document.getElementById('catImportSubmitBtn')
  if (submitBtn) {
    submitBtn.disabled = valid === 0
    submitBtn.innerHTML = `<i class="fas fa-file-import mr-1"></i>Import ${valid} hạng mục`
  }
  preview.style.display = ''
}

function catClearImport() {
  _catBulkImportData = []
  const preview = document.getElementById('catImportPreview')
  if (preview) preview.style.display = 'none'
  const fi = document.getElementById('catImportFile')
  if (fi) fi.value = ''
}

async function submitCatImport() {
  const projectId = parseInt($('catProjectId').value)
  const categories = _catBulkImportData.filter(r => r.name?.trim())
  if (categories.length === 0) { toast('Không có dữ liệu hợp lệ để import', 'warning'); return }

  const btn = document.getElementById('catImportSubmitBtn')
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Đang import...' }
  try {
    const res = await api('/categories/bulk', { method: 'post', data: { project_id: projectId, categories } })
    closeModal('categoryModal')
    const msg = res.failed > 0
      ? `Đã import ${res.created}/${categories.length} hạng mục (${res.failed} lỗi)`
      : `✅ Đã import ${res.created} hạng mục thành công`
    toast(msg, res.failed > 0 ? 'warning' : 'success')
    openProjectDetail(projectId)
  } catch (e) {
    toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error')
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fas fa-file-import mr-1"></i>Import ${categories.length} hạng mục` }
  }
}

// Tải template Excel cho user
function downloadCatTemplate() {
  if (typeof XLSX === 'undefined') { toast('Thư viện Excel chưa tải xong, thử lại sau', 'warning'); return }
  const wb = XLSX.utils.book_new()
  const data = [
    ['Mã hạng mục', 'Tên hạng mục'],
    ['ZZ', 'Tổng thể'],
    ['AA', 'Kiến trúc'],
    ['ES', 'Kết cấu'],
    ['MEP', 'Hệ thống MEP'],
    ['CT', 'Hạ tầng'],
    ['', '(Thêm các dòng bên dưới...)']
  ]
  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = [{ wch: 16 }, { wch: 36 }]
  // Style header row
  ;['A1','B1'].forEach(cell => {
    if (ws[cell]) ws[cell].s = { font: { bold: true }, fill: { fgColor: { rgb: '00A651' } } }
  })
  XLSX.utils.book_append_sheet(wb, ws, 'Hang muc')
  XLSX.writeFile(wb, 'Template_HangMuc.xlsx')
}

// Khởi tạo bulk table khi switch sang tab bulk lần đầu
document.addEventListener('DOMContentLoaded', () => {
  const bulkBtn = document.getElementById('catTab-bulk')
  if (bulkBtn) {
    const origClick = bulkBtn.onclick
    bulkBtn.addEventListener('click', () => {
      if (document.querySelectorAll('#catBulkBody tr').length === 0) catBulkReset(5)
    })
  }
})
async function loadTasks() {
  try {
    if (!allProjects.length) allProjects = await api('/projects')
    if (!allUsers.length) allUsers = await api('/users')
    allTasks = await api('/tasks')

    // Populate project role cache for current user
    refreshProjectRoleCache()

    // Hiện nút Tạo task cho tất cả user (kể cả member)
    const btnNewTask = $('btnNewTask')
    if (btnNewTask) {
      btnNewTask.style.display = ''
      btnNewTask.innerHTML = '<i class="fas fa-plus"></i>Tạo task mới'
      btnNewTask.title = ''
    }

    // Lưu lại giá trị filter đang chọn trước khi rebuild combobox
    const prevProjectFilter = _cbGetValue('taskProjectCombobox') || ''

    // Build project combobox (restore giá trị cũ để không mất filter)
    createCombobox('taskProjectCombobox', {
      placeholder: 'Tất cả dự án',
      items: allProjects.map(p => ({ value: String(p.id), label: `${p.code} – ${p.name}` })),
      value: prevProjectFilter,
      fullWidth: true,
      onchange: (val) => onTaskProjectFilterChange(val)
    })

    // Fill discipline filter combobox
    const dfContainer = $('taskDisciplineFilterCombobox')
    if (dfContainer && allDisciplines.length) {
      const discItems = allDisciplines.map(d => ({ value: d.code, label: `${d.code} - ${d.name}` }))
      if (_cbState['taskDisciplineFilterCombobox']) {
        _cbSetItems('taskDisciplineFilterCombobox', discItems, true)
      } else {
        createCombobox('taskDisciplineFilterCombobox', {
          placeholder: 'Tất cả bộ môn',
          items: discItems,
          fullWidth: true,
          teleport: true,
          dropdownMaxHeight: '280px',
          onchange: () => filterTasks()
        })
      }
    }

    // Build category combobox (all categories from loaded tasks)
    updateTaskCategoryFilter()

    // Áp lại filter hiện tại thay vì render toàn bộ
    filterTasks()
  } catch (e) { toast('Lỗi tải task: ' + e.message, 'error') }
}

// ================================================================
// COMBOBOX ENGINE
// ================================================================
// Combobox state registry: id → { value, label, items, onchange }
const _cbState = {}

/**
 * createCombobox(containerId, options)
 *   containerId : ID of the placeholder <div> in HTML
 *   options.placeholder : text shown when nothing selected (e.g. "Tất cả dự án")
 *   options.items       : [{value, label}]
 *   options.value       : initially selected value ('' = placeholder)
 *   options.onchange    : function(value) called when selection changes
 *   options.minWidth    : CSS min-width string (default '160px')
 */
function createCombobox(containerId, options = {}) {
  const container = $(containerId)
  if (!container) return

  const id = containerId
  const placeholder = options.placeholder || 'Chọn...'
  const items = options.items || []
  const initVal = options.value !== undefined ? String(options.value) : ''
  const minWidth = options.minWidth || '160px'
  const fullWidth = options.fullWidth || false
  // Optional overrides for panel width and dropdown height
  const panelMaxWidth   = options.panelMaxWidth   || '360px'
  const dropdownMaxHeight = options.dropdownMaxHeight || '220px'

  // teleport: true → panel is moved to document.body on open (escapes overflow:hidden/auto ancestors)
  const teleport = options.teleport || false

  _cbState[id] = {
    value: initVal,
    label: _cbLabelFor(items, initVal, placeholder),
    items,
    placeholder,
    onchange: options.onchange || null,
    teleport,
    panelMaxWidth,
    dropdownMaxHeight
  }

  container.innerHTML = _cbHTML(id, placeholder, minWidth, fullWidth, panelMaxWidth, dropdownMaxHeight)
  _cbRenderOptions(id, '')
  _cbUpdateTrigger(id)
}

function _cbLabelFor(items, value, placeholder) {
  if (!value) return placeholder
  const found = items.find(i => String(i.value) === String(value))
  return found ? found.label : placeholder
}

// Helper: set combobox value by id (auto-resolves label from state.items)
function _cbSetValue(id, value) {
  const state = _cbState[id]
  if (!state) return
  const label = value ? _cbLabelFor(state.items || [], value, state.placeholder) : state.placeholder
  _cbSelect(id, value, label)
}

function _cbHTML(id, placeholder, minWidth, fullWidth, panelMaxWidth, dropdownMaxHeight) {
  panelMaxWidth     = panelMaxWidth     || '360px'
  dropdownMaxHeight = dropdownMaxHeight || '220px'
  const triggerStyle = 'display:flex;align-items:center;justify-content:space-between;gap:6px;border:1px solid #d1d5db;border-radius:8px;padding:6px 10px;background:#fff;cursor:pointer;font-size:13px;color:#374151;min-height:36px;user-select:none;box-sizing:border-box;width:100%'
  const panelStyle = 'display:none;position:absolute;top:calc(100% + 4px);left:0;min-width:100%;width:max-content;max-width:' + panelMaxWidth + ';background:#fff;border:1px solid #d1d5db;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;overflow:hidden'
  const searchStyle = 'width:100%;border:1px solid #e5e7eb;border-radius:6px;padding:7px 10px 7px 30px;font-size:13px;outline:none;color:#374151;background:#f9fafb;box-sizing:border-box;transition:border-color .15s'
  const optsStyle = 'max-height:' + dropdownMaxHeight + ';overflow-y:auto;padding:4px 0'
  const wrapStyle = fullWidth ? 'position:relative;width:100%;display:block' : ('position:relative;min-width:' + minWidth + ';display:inline-block')
  return '<div id="' + id + '_wrap" style="' + wrapStyle + '">'
    + '<div style="' + triggerStyle + '" onclick="_cbToggle(\'' + id + '\')">'
    + '<span id="' + id + '_label" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9ca3af">' + placeholder + '</span>'
    + '<span id="' + id + '_arrow" style="flex-shrink:0;font-size:10px;color:#9ca3af">&#9660;</span>'
    + '</div>'
    + '<div id="' + id + '_panel" style="' + panelStyle + '">'
    + '<div style="padding:8px 10px 7px;border-bottom:1px solid #e5e7eb;position:relative">'
    + '<span style="position:absolute;left:18px;top:50%;transform:translateY(-50%);font-size:13px;pointer-events:none">🔍</span>'
    + '<input id="' + id + '_search" type="text" placeholder="T\u00ecm ki\u1EBFm..." style="' + searchStyle + '" oninput="_cbFilter(\'' + id + '\',this.value)" onclick="event.stopPropagation()" autocomplete="off">'
    + '</div>'
    + '<div id="' + id + '_opts" style="' + optsStyle + '"></div>'
    + '</div></div>'
}

function _cbRenderOptions(id, query) {
  const state = _cbState[id]
  if (!state) return
  const opts = $(id + '_opts')
  if (!opts) return
  const q = query.trim().toLowerCase()
  const allItems = [{ value: '', label: state.placeholder }, ...state.items]
  const filtered = allItems.filter(i => !q || i.label.toLowerCase().includes(q))
  // Use larger font/padding for teleported panels (they have more space)
  const isTeleport = !!state.teleport
  const itemPad = isTeleport ? '9px 14px' : '7px 12px'
  const itemFs  = isTeleport ? '13px' : '13px'
  if (!filtered.length) {
    opts.innerHTML = '<div style="padding:12px 14px;font-size:13px;color:#9ca3af;font-style:italic">Kh\u00f4ng t\u00ecm th\u1EA5y k\u1EBFt qu\u1EA3</div>'
    return
  }
  opts.innerHTML = filtered.map(i => {
    const isSel = String(i.value) === String(state.value)
    const bg = isSel ? '#f0fdf4' : 'transparent'
    const col = isSel ? '#00A651' : '#374151'
    const fw = isSel ? '600' : '400'
    const sv = String(i.value).replace(/'/g, '&#39;')
    const sl = i.label.replace(/'/g, '&#39;')
    return '<div style="padding:' + itemPad + ';font-size:' + itemFs + ';cursor:pointer;display:flex;align-items:center;gap:6px;background:' + bg + ';color:' + col + ';font-weight:' + fw + ';line-height:1.4"'
      + ' onmouseenter="this.style.background=\'#eff6ff\';this.style.color=\'#1d4ed8\'"'
      + ' onmouseleave="this.style.background=\'' + bg + '\';this.style.color=\'' + col + '\'"'
      + ' onclick="_cbSelect(\'' + id + '\',\'' + sv + '\',\'' + sl + '\')">'
      + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + i.label + '</span>'
      + (isSel ? '<span style="flex-shrink:0;color:#00A651;font-size:12px">&#10003;</span>' : '')
      + '</div>'
  }).join('')
}

function _cbUpdateTrigger(id) {
  const state = _cbState[id]
  if (!state) return
  const lbl = $(id + '_label')
  if (!lbl) return
  const trigger = lbl.parentElement
  if (!state.value) {
    lbl.textContent = state.placeholder
    lbl.style.color = '#9ca3af'
    if (trigger) { trigger.style.borderColor = '#d1d5db'; trigger.style.boxShadow = '' }
  } else {
    lbl.textContent = state.label
    lbl.style.color = '#374151'
    if (trigger) { trigger.style.borderColor = '#00A651'; trigger.style.boxShadow = '0 0 0 2px rgba(0,166,81,0.10)' }
  }
}

// ── Backdrop for teleported combobox ────────────────────────────
function _cbGetBackdrop() {
  let bd = document.getElementById('_cbBackdrop')
  if (!bd) {
    bd = document.createElement('div')
    bd.id = '_cbBackdrop'
    bd.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.25)'
    bd.addEventListener('click', () => _cbCloseAll())
    document.body.appendChild(bd)
  }
  return bd
}
function _cbShowBackdrop() {
  const bd = _cbGetBackdrop()
  bd.style.display = 'block'
}
function _cbHideBackdrop() {
  const bd = document.getElementById('_cbBackdrop')
  if (bd) bd.style.display = 'none'
}
function _cbCloseAll() {
  document.querySelectorAll('[id$="_panel"]').forEach(p => {
    if (p.style && p.style.display !== 'none') {
      p.style.display = 'none'
      const pid = p.id.replace('_panel', '')
      const a = document.getElementById(p.id.replace('_panel', '_arrow'))
      if (a) a.style.transform = ''
      const pState = _cbState[pid]
      if (pState?.teleport && p.parentElement === document.body) {
        const wrap = document.getElementById(pid + '_wrap')
        if (wrap) wrap.appendChild(p)
      }
    }
  })
  _cbHideBackdrop()
}

function _cbToggle(id) {
  const panel = $(id + '_panel')
  const arrow = $(id + '_arrow')
  if (!panel) return
  const isOpen = panel.style.display !== 'none'
  // Close all other panels first
  document.querySelectorAll('[id$="_panel"]').forEach(p => {
    if (p !== panel && p.style && p.style.display !== 'none') {
      p.style.display = 'none'
      const pid = p.id.replace('_panel', '')
      const a = document.getElementById(p.id.replace('_panel', '_arrow'))
      if (a) a.style.transform = ''
      const pState = _cbState[pid]
      if (pState?.teleport && p.parentElement === document.body) {
        const wrap = document.getElementById(pid + '_wrap')
        if (wrap) wrap.appendChild(p)
      }
    }
  })
  if (isOpen) {
    panel.style.display = 'none'
    if (arrow) arrow.style.transform = ''
    const state = _cbState[id]
    if (state?.teleport && panel.parentElement === document.body) {
      const wrap = $(id + '_wrap')
      if (wrap) wrap.appendChild(panel)
    }
    _cbHideBackdrop()
  } else {
    const state = _cbState[id]
    if (state?.teleport) {
      // Teleport panel to body as fixed overlay (escapes all overflow clipping)
      const wrap = $(id + '_wrap')
      const trigger = wrap?.querySelector('[onclick*="_cbToggle"]') || wrap?.firstElementChild
      if (trigger) {
        const rect = trigger.getBoundingClientRect()
        const maxWNum = parseInt(state.panelMaxWidth || '520')
        const maxH    = state.dropdownMaxHeight || '320px'

        // Smart width: at least trigger width, at most maxW, bounded by viewport
        const panelW  = Math.min(Math.max(rect.width, maxWNum), window.innerWidth - 32)

        // Smart horizontal position: prefer align-left, shift left if it would go off-screen
        let leftPos = rect.left
        if (leftPos + panelW > window.innerWidth - 12) {
          leftPos = Math.max(8, window.innerWidth - panelW - 12)
        }

        // Smart vertical: open down if enough space, else open up
        const spaceBelow = window.innerHeight - rect.bottom - 8
        const spaceAbove = rect.top - 8
        const openDown   = spaceBelow >= 200 || spaceBelow >= spaceAbove

        panel.style.cssText = [
          'display:block',
          'position:fixed',
          openDown ? `top:${rect.bottom + 6}px` : `bottom:${window.innerHeight - rect.top + 6}px`,
          `left:${leftPos}px`,
          `width:${panelW}px`,
          `z-index:99999`,
          'background:#fff',
          'border:1px solid #c7d2fe',
          'border-radius:12px',
          'box-shadow:0 20px 60px rgba(0,0,0,.25)',
          'overflow:hidden',
          'animation:cbFadeIn .12s ease'
        ].join(';')
        // Set opts max-height
        const optsEl = document.getElementById(id + '_opts')
        if (optsEl) optsEl.style.maxHeight = maxH
        // Update search input style for better visibility
        const srEl = document.getElementById(id + '_search')
        if (srEl) {
          srEl.style.cssText = 'width:100%;border:1.5px solid #a5b4fc;border-radius:8px;padding:8px 10px 8px 32px;font-size:14px;outline:none;color:#374151;background:#f8faff;box-sizing:border-box'
        }
        document.body.appendChild(panel)
        _cbShowBackdrop()
      }
    } else {
      panel.style.display = 'block'
    }
    if (arrow) arrow.style.transform = 'rotate(180deg)'
    const search = $(id + '_search')
    if (search) { search.value = ''; setTimeout(() => { search.focus(); search.select() }, 30) }
    _cbRenderOptions(id, '')
  }
}

function _cbFilter(id, query) {
  _cbRenderOptions(id, query)
}

function _cbSelect(id, value, label) {
  const state = _cbState[id]
  if (!state) return
  state.value = value
  state.label = value ? label : state.placeholder
  _cbUpdateTrigger(id)
  // Close panel
  const panel = $(id + '_panel')
  const arrow = $(id + '_arrow')
  if (panel) {
    panel.style.display = 'none'
    // Move teleported panel back to its wrap
    if (state.teleport && panel.parentElement === document.body) {
      const wrap = $(id + '_wrap')
      if (wrap) wrap.appendChild(panel)
      _cbHideBackdrop()
    }
  }
  if (arrow) arrow.style.transform = ''
  // Trigger callback
  if (state.onchange) state.onchange(value)
}

function _cbSetItems(id, items, keepValue = false) {
  const state = _cbState[id]
  if (!state) return
  state.items = items
  if (!keepValue || !items.find(i => String(i.value) === String(state.value))) {
    state.value = ''
    state.label = state.placeholder
    _cbUpdateTrigger(id)
  }
  _cbRenderOptions(id, '')
}

function _cbGetValue(id) {
  return _cbState[id]?.value || ''
}

// Close comboboxes when clicking outside
document.addEventListener('click', function(e) {
  // Allow clicks inside any _wrap or teleported _panel
  if (e.target.closest('[id$="_wrap"]') || e.target.closest('[id$="_panel"]')) return
  _cbCloseAll()
})


// ================================================================
// TASK FILTERS - combobox-powered
// ================================================================

// Called when project combobox selection changes
function onTaskProjectFilterChange(projectId) {
  updateTaskCategoryFilter(projectId)
  filterTasks()
}

// Rebuild category combobox items based on selected project.
// - No project selected → hide the category combobox entirely
// - Project selected    → show combobox with only that project's categories
function updateTaskCategoryFilter(selectedProjectId = '') {
  const wrapper = $('taskCategoryCombobox')
  if (!wrapper) return

  // ── No project selected: hide category filter ──────────────
  if (!selectedProjectId) {
    wrapper.style.display = 'none'
    // Reset value so it doesn't silently filter
    if (_cbState['taskCategoryCombobox']) {
      _cbState['taskCategoryCombobox'].value = ''
      _cbState['taskCategoryCombobox'].label = 'Tất cả hạng mục'
      _cbUpdateTrigger('taskCategoryCombobox')
    }
    return
  }

  // ── Project selected: collect its categories ────────────────
  const tasksForProject = allTasks.filter(t => String(t.project_id) === String(selectedProjectId))
  const catMap = {}
  tasksForProject.forEach(t => {
    if (t.category_id && t.category_name) catMap[t.category_id] = t.category_name
  })
  const items = Object.entries(catMap).map(([id, name]) => ({ value: id, label: name }))

  // Keep previous category only if it still belongs to this project
  const prevVal = _cbGetValue('taskCategoryCombobox')
  const keepValue = !!catMap[prevVal]

  if (wrapper.querySelector('[id$="_wrap"]')) {
    // Combobox already rendered – just refresh items
    _cbSetItems('taskCategoryCombobox', items, keepValue)
  } else {
    createCombobox('taskCategoryCombobox', {
      placeholder: 'Tất cả hạng mục',
      items,
      value: keepValue ? prevVal : '',
      fullWidth: true,
      onchange: () => filterTasks()
    })
  }

  // Show the wrapper
  wrapper.style.display = ''
}


// ── Task list pagination state ────────────────────────────────────────────
const TASK_PAGE_SIZE = 20
let _taskCurrentPage = 1
let _taskAllData     = []   // full filtered dataset

// ── Task sort state ───────────────────────────────────────────────────────
// Default: status order (pending→in_progress→review→approved→completed→cancelled)
// then due_date asc, then title asc
const STATUS_ORDER = { pending: 0, in_progress: 1, review: 2, approved: 3, completed: 4, cancelled: 5 }
let _taskSortField = 'default'   // 'default'|'title'|'project'|'due_date'|'first_review_date'|'progress'|'status'|'priority'
let _taskSortDir   = 'asc'       // 'asc' | 'desc'

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }

function _taskSortCompare(a, b) {
  if (_taskSortField === 'default') {
    // Primary: status order (active tasks first)
    const sd = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
    if (sd !== 0) return sd
    // Secondary: due_date ascending (soonest first), null last
    const da = a.due_date ? new Date(a.due_date) : new Date('9999-12-31')
    const db2 = b.due_date ? new Date(b.due_date) : new Date('9999-12-31')
    const dd = da - db2
    if (dd !== 0) return dd
    // Tertiary: title
    return (a.title || '').localeCompare(b.title || '', 'vi')
  }

  let va, vb
  switch (_taskSortField) {
    case 'title':
      va = (a.title || '').toLowerCase()
      vb = (b.title || '').toLowerCase()
      break
    case 'project':
      va = (a.project_code || '').toLowerCase()
      vb = (b.project_code || '').toLowerCase()
      break
    case 'due_date':
      va = a.due_date ? new Date(a.due_date) : (_taskSortDir === 'asc' ? new Date('9999-12-31') : new Date('0000-01-01'))
      vb = b.due_date ? new Date(b.due_date) : (_taskSortDir === 'asc' ? new Date('9999-12-31') : new Date('0000-01-01'))
      break
    case 'first_review_date':
      va = a.first_review_date ? new Date(a.first_review_date) : (_taskSortDir === 'asc' ? new Date('9999-12-31') : new Date('0000-01-01'))
      vb = b.first_review_date ? new Date(b.first_review_date) : (_taskSortDir === 'asc' ? new Date('9999-12-31') : new Date('0000-01-01'))
      break
    case 'progress':
      va = a.progress || 0
      vb = b.progress || 0
      break
    case 'status':
      va = STATUS_ORDER[a.status] ?? 9
      vb = STATUS_ORDER[b.status] ?? 9
      break
    case 'priority':
      va = PRIORITY_ORDER[a.priority] ?? 9
      vb = PRIORITY_ORDER[b.priority] ?? 9
      break
    default:
      va = ''; vb = ''
  }

  let cmp = 0
  if (va < vb) cmp = -1
  else if (va > vb) cmp = 1

  // If equal, fall back to due_date asc then title
  if (cmp === 0) {
    const da = a.due_date ? new Date(a.due_date) : new Date('9999-12-31')
    const db2 = b.due_date ? new Date(b.due_date) : new Date('9999-12-31')
    cmp = da - db2
  }
  if (cmp === 0) cmp = (a.title || '').localeCompare(b.title || '', 'vi')

  return _taskSortDir === 'asc' ? cmp : -cmp
}

function _taskApplySort(tasks) {
  return [...tasks].sort(_taskSortCompare)
}

function _taskSetSort(field) {
  if (_taskSortField === field && field !== 'default') {
    // Toggle direction
    _taskSortDir = _taskSortDir === 'asc' ? 'desc' : 'asc'
  } else {
    _taskSortField = field
    _taskSortDir = 'asc'
  }
  // Re-render with current data
  _taskAllData = _taskApplySort(_taskAllData)
  _taskCurrentPage = 1
  renderTaskRows()
  renderTaskPagination()
  _updateTaskSortHeaders()
}

function _updateTaskSortHeaders() {
  document.querySelectorAll('th[data-sort-field]').forEach(th => {
    const f = th.dataset.sortField
    const icon = th.querySelector('.sort-icon')
    if (!icon) return
    const isActive = f === _taskSortField
    if (isActive) {
      icon.className = `sort-icon fas ${_taskSortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down'} ml-1 text-indigo-500`
      th.classList.add('text-indigo-600')
    } else {
      icon.className = 'sort-icon fas fa-sort ml-1 text-gray-300'
      th.classList.remove('text-indigo-600')
    }
  })
  // Highlight reset button when in default sort
  const resetBtn = $('taskSortResetBtn')
  if (resetBtn) {
    if (_taskSortField === 'default') {
      resetBtn.classList.add('text-indigo-600', 'border-indigo-300', 'bg-indigo-50')
      resetBtn.classList.remove('text-gray-500', 'border-gray-200')
    } else {
      resetBtn.classList.remove('text-indigo-600', 'border-indigo-300', 'bg-indigo-50')
      resetBtn.classList.add('text-gray-500', 'border-gray-200')
    }
  }
}

function taskPaginatedData() {
  const start = (_taskCurrentPage - 1) * TASK_PAGE_SIZE
  return _taskAllData.slice(start, start + TASK_PAGE_SIZE)
}

function renderTaskPagination() {
  const container = $('taskPagination')
  if (!container) return
  const total = _taskAllData.length
  const totalPages = Math.max(1, Math.ceil(total / TASK_PAGE_SIZE))
  if (totalPages <= 1) { container.innerHTML = ''; return }

  const p = _taskCurrentPage
  let pages = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages = [1]
    if (p > 3) pages.push('...')
    for (let i = Math.max(2, p - 1); i <= Math.min(totalPages - 1, p + 1); i++) pages.push(i)
    if (p < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  const btn = (label, page, disabled = false, active = false) =>
    `<button onclick="taskGoPage(${page})" ${disabled ? 'disabled' : ''}
      class="min-w-[32px] h-8 px-2 rounded-lg text-xs font-medium border transition-colors
      ${active ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary'}
      ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}">${label}</button>`

  const from = total === 0 ? 0 : (p - 1) * TASK_PAGE_SIZE + 1
  const to   = Math.min(p * TASK_PAGE_SIZE, total)

  container.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-gray-100 mt-3">
      <p class="text-xs text-gray-500">Hiển thị <strong>${from}–${to}</strong> / <strong>${total}</strong> công việc</p>
      <div class="flex items-center gap-1">
        ${btn('<i class="fas fa-chevron-left"></i>', p - 1, p === 1)}
        ${pages.map(pg => pg === '...'
            ? `<span class="px-1 text-gray-400 text-xs">…</span>`
            : btn(pg, pg, false, pg === p)
          ).join('')}
        ${btn('<i class="fas fa-chevron-right"></i>', p + 1, p === totalPages)}
      </div>
    </div>`
}

function taskGoPage(page) {
  const totalPages = Math.max(1, Math.ceil(_taskAllData.length / TASK_PAGE_SIZE))
  _taskCurrentPage = Math.max(1, Math.min(page, totalPages))
  renderTaskRows()
  renderTaskPagination()
  const table = $('tasksTable')
  if (table) table.closest('.overflow-x-auto')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function renderTasksTable(tasks) {
  const tbody = $('tasksTable')
  if (!tbody) return

  // Apply current sort, save full dataset, reset to page 1
  _taskAllData     = _taskApplySort(tasks)
  _taskCurrentPage = 1

  renderTaskRows()
  renderTaskPagination()
  _updateTaskSortHeaders()
}

function renderTaskRows() {
  const tbody = $('tasksTable')
  if (!tbody) return
  const effGlobal = getEffectiveGlobalRole()

  if (_taskAllData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="text-center py-8 text-gray-400">Không có task nào</td></tr>'
    return
  }

  const tasks = taskPaginatedData()
  tbody.innerHTML = tasks.map(t => {
    const isAssigned = t.assigned_to === currentUser?.id
    const isCreatedByMe = t.assigned_by === currentUser?.id
    const effForTask = getEffectiveRoleForProject(t.project_id)
    const isAdminOrLeader = ['system_admin','project_admin','project_leader'].includes(effForTask)
    const canEditThisTask = isAdminOrLeader || isAssigned || isCreatedByMe
    const canDeleteThisTask = ['system_admin','project_admin'].includes(currentUser?.role) || effForTask === 'project_admin'
    const subCount = t.subtask_count || 0
    const subDone  = t.subtask_done_count || 0
    const hasSubtasks = subCount > 0

    // Subtask badge color
    const subBadgeColor = subCount === 0 ? '#e5e7eb' : subDone === subCount ? '#dcfce7' : '#fef9c3'
    const subTextColor  = subCount === 0 ? '#9ca3af' : subDone === subCount ? '#16a34a' : '#92400e'

    // Phase badge
    const phaseColors = {
      basic_design:        { bg:'#f0f9ff', text:'#0369a1' },
      technical_design:    { bg:'#fdf4ff', text:'#7e22ce' },
      construction_design: { bg:'#fff7ed', text:'#c2410c' },
      as_built:            { bg:'#f0fdf4', text:'#15803d' }
    }
    const pc = phaseColors[t.phase] || { bg:'#f3f4f6', text:'#6b7280' }

    return `
    <tr class="task-main-row table-row ${isOverdue(t) ? 'overdue-row' : ''}" data-task-id="${t.id}">
      <td class="py-2 pl-2 pr-1" style="width:32px">
        ${hasSubtasks
          ? `<button onclick="toggleSubtasks(${t.id}, this)" class="subtask-toggle w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 transition-transform" title="Mở rộng/thu gọn subtask">
               <i class="fas fa-chevron-right text-xs"></i>
             </button>`
          : `<button onclick="openSubtaskModal(${t.id})" class="w-6 h-6 flex items-center justify-center rounded hover:bg-indigo-50 text-gray-300 hover:text-indigo-400 transition-colors" title="Thêm subtask">
               <i class="fas fa-plus text-xs"></i>
             </button>`}
      </td>
      <td class="py-2 pr-3">
        <div class="task-name-wrap flex items-center gap-1.5 flex-wrap">
          <span class="font-medium text-gray-800 text-sm cursor-pointer hover:text-primary" onclick="openTaskDetail(${t.id})">${t.title}</span>
          ${(_chatUnreadMap[`task_${t.id}`] || 0) > 0 ? `<span class="chat-unread-badge">${_chatUnreadMap[`task_${t.id}`]}</span>` : ''}
        </div>
        ${isOverdue(t) ? '<span class="badge badge-overdue text-xs">Trễ hạn!</span>' : ''}
        ${hasSubtasks ? `<span class="subtask-badge inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full mt-0.5" style="background:${subBadgeColor};color:${subTextColor}">
          <i class="fas fa-list-check" style="font-size:9px"></i>${subDone}/${subCount}
        </span>` : ''}
      </td>
      <td class="py-2 pr-3 text-sm text-gray-600">${t.project_code || '-'}</td>
      <td class="py-2 pr-3">
        ${t.category_name
          ? `<span class="text-xs text-gray-700 font-medium bg-slate-100 px-2 py-0.5 rounded max-w-32 truncate block" title="${t.category_name}">${t.category_name}</span>`
          : '<span class="text-xs text-gray-300">—</span>'}
      </td>
      <td class="py-2 pr-3">
        ${t.phase
          ? `<span class="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap" style="background:${pc.bg};color:${pc.text}">${getPhaseName(t.phase)}</span>`
          : '<span class="text-xs text-gray-300">—</span>'}
      </td>
      <td class="py-2 pr-3"><span class="badge text-xs" style="background:#e0f2fe;color:#0369a1">${t.discipline_code||'-'}</span></td>
      <td class="py-2 pr-3">${getPriorityBadge(t.priority)}</td>
      <td class="py-2 pr-3 text-sm text-gray-600">${t.assigned_to_name || '<span class="text-gray-300 text-xs">Chưa giao</span>'}</td>
      <td class="py-2 pr-3 text-sm ${isOverdue(t) ? 'text-red-600 font-bold' : 'text-gray-500'}">${fmtDate(t.due_date)}</td>
      <td class="py-2 pr-3 text-xs whitespace-nowrap">${(() => {
        const d = t.first_review_date
        if (!d) return '<span class="text-gray-300">—</span>'
        const isOnTime = d <= (t.due_date || '9999')
        const isLate   = d >  (t.due_date || '9999')
        const color    = isOnTime ? '#16a34a' : '#dc2626'
        const icon     = isOnTime ? 'fa-check-circle' : 'fa-clock'
        const title    = isOnTime ? 'Hoàn thành đúng hạn' : 'Hoàn thành trễ hạn'
        return `<span style="color:${color};font-weight:600" title="${title}"><i class="fas ${icon} mr-1"></i>${fmtDate(d)}</span>`
      })()}</td>
      <td class="py-2 pr-3">
        <div class="flex items-center gap-2 min-w-20">
          <div class="progress-bar flex-1"><div class="progress-fill ${isOverdue(t)?'danger':''}" style="width:${t.progress||0}%"></div></div>
          <span class="text-xs text-gray-500">${t.progress||0}%</span>
        </div>
      </td>
      <td class="py-2 pr-3">${getStatusBadge(t.status)}</td>
      <td class="py-2">
        <div class="flex gap-1">
          ${canEditThisTask ? `<button onclick="openTaskModal(${t.id})" class="btn-secondary text-xs px-2 py-1" title="Sửa"><i class="fas fa-edit"></i></button>` : ''}
          ${canDeleteThisTask ? `<button onclick="confirmDeleteTask(${t.id}, '${t.title.replace(/'/g,"\\'")}' )" class="text-red-400 hover:text-red-600 px-2 py-1 text-sm" title="Xóa"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </td>
    </tr>
    <tr id="subtask-rows-${t.id}" class="subtask-container-row" style="display:none">
      <td colspan="13" class="p-0">
        <div id="subtask-panel-${t.id}" class="subtask-panel"></div>
      </td>
    </tr>`
  }).join('')
}

// ── Expand / collapse subtasks inline ─────────────────────────────────────
async function toggleSubtasks(taskId, btn) {
  const containerRow = document.getElementById(`subtask-rows-${taskId}`)
  const panel = document.getElementById(`subtask-panel-${taskId}`)
  const icon = btn.querySelector('i')

  const isOpen = containerRow.style.display !== 'none'

  if (isOpen) {
    // Collapse
    containerRow.style.display = 'none'
    icon.style.transform = 'rotate(0deg)'
    btn.classList.remove('text-indigo-500')
    btn.classList.add('text-gray-400')
    return
  }

  // Expand — load subtasks if not already loaded
  icon.style.transform = 'rotate(90deg)'
  btn.classList.remove('text-gray-400')
  btn.classList.add('text-indigo-500')
  containerRow.style.display = ''

  if (panel.dataset.loaded === '1') return  // already loaded

  panel.innerHTML = `<div class="flex items-center justify-center py-3 text-gray-400 text-sm">
    <i class="fas fa-spinner fa-spin mr-2"></i>Đang tải subtask...
  </div>`

  try {
    const subtasks = await api(`/tasks/${taskId}/subtasks`)
    panel.dataset.loaded = '1'

    // Find parent task info for "add subtask" button permission
    const task = allTasks.find(t => t.id === taskId) || {}
    const effForTask = getEffectiveRoleForProject(task.project_id)
    const isAssigned = task.assigned_to === currentUser?.id
    const canAddSubtask = ['system_admin','project_admin','project_leader'].includes(effForTask) || isAssigned

    renderSubtaskPanel(taskId, subtasks, canAddSubtask, isAssigned)
  } catch(e) {
    panel.innerHTML = `<div class="py-3 px-4 text-red-400 text-sm">Lỗi tải subtask: ${e.message}</div>`
  }
}

// ── Render subtask rows inside the panel ──────────────────────────────────
function renderSubtaskPanel(taskId, subtasks, canAddSubtask, isTaskAssignee = false) {
  const panel = document.getElementById(`subtask-panel-${taskId}`)
  if (!panel) return

  const priorityIcon = { urgent:'🔴', high:'🟠', medium:'🟡', low:'🟢' }
  const statusColors = {
    todo:        { bg:'#f3f4f6', text:'#6b7280', label:'Chờ làm'  },
    in_progress: { bg:'#dbeafe', text:'#1d4ed8', label:'Đang làm' },
    review:      { bg:'#fef3c7', text:'#92400e', label:'Đang duyệt'},
    done:        { bg:'#dcfce7', text:'#16a34a', label:'Hoàn thành'}
  }

  const rows = subtasks.map(s => {
    const sc = statusColors[s.status] || statusColors.todo
    const isDone = s.status === 'done'
    // canEdit: có thể sửa toàn bộ subtask (admin/leader/creator)
    const canEdit = canAddSubtask || s.created_by === currentUser?.id
    // canToggle: có thể tick checkbox done/todo (thêm: task assignee hoặc subtask assignee)
    const canToggle = canEdit || isTaskAssignee || s.assigned_to === currentUser?.id
    const isChecked = isDone ? 'checked' : ''
    return `
    <div class="subtask-row flex items-center gap-3 px-4 py-2 hover:bg-indigo-50/40 border-b border-indigo-50 group" id="str-${s.id}">
      <!-- indent line -->
      <div class="flex-shrink-0 flex items-center" style="width:24px">
        <div class="w-px h-full bg-indigo-200 mx-auto" style="height:20px"></div>
      </div>
      <div class="flex-shrink-0 w-4 h-4 flex items-center justify-center">
        <span class="text-xs">${priorityIcon[s.priority] || '🟡'}</span>
      </div>
      <!-- checkbox toggle done -->
      <input type="checkbox" ${isChecked}
        ${canToggle ? `onchange="toggleSubtaskDone(${s.id}, ${taskId}, this)"` : 'disabled title="Bạn không có quyền cập nhật subtask này"'}
        class="w-4 h-4 rounded border-gray-300 text-indigo-500 ${canToggle ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'} flex-shrink-0"
        title="${canToggle ? 'Đánh dấu hoàn thành' : 'Bạn không có quyền cập nhật subtask này'}">
      <div class="flex-1 min-w-0">
        <span class="text-sm ${isDone ? 'line-through text-gray-400' : 'text-gray-700'}">${s.title}</span>
        <div class="flex flex-wrap items-center gap-2 mt-0.5">
          <span class="text-xs px-1.5 py-0.5 rounded-full font-medium" style="background:${sc.bg};color:${sc.text}">${sc.label}</span>
          ${s.assigned_to_name ? `<span class="text-xs text-gray-400"><i class="fas fa-user text-gray-300 mr-1"></i>${s.assigned_to_name}</span>` : ''}
          ${s.due_date ? `<span class="text-xs text-gray-400"><i class="fas fa-calendar-alt text-gray-300 mr-1"></i>${fmtDate(s.due_date)}</span>` : ''}
          ${s.estimated_hours ? `<span class="text-xs text-gray-400"><i class="fas fa-clock text-gray-300 mr-1"></i>${s.estimated_hours}h</span>` : ''}
          ${s.notes ? `<span class="text-xs text-gray-400 italic truncate max-w-xs" title="${s.notes.replace(/"/g,'&quot;')}"><i class="fas fa-sticky-note text-gray-300 mr-1"></i>${s.notes.substring(0,40)}${s.notes.length>40?'…':''}</span>` : ''}
        </div>
      </div>
      ${canEdit ? `<div class="flex-shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onclick="openSubtaskModal(${taskId}, ${JSON.stringify(s).replace(/"/g,'&quot;')})" class="w-7 h-7 flex items-center justify-center rounded hover:bg-indigo-100 text-gray-400 hover:text-indigo-600 transition-colors" title="Sửa">
          <i class="fas fa-pen text-xs"></i>
        </button>
        <button onclick="deleteSubtaskInline(${s.id}, ${taskId})" class="w-7 h-7 flex items-center justify-center rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="Xóa">
          <i class="fas fa-trash text-xs"></i>
        </button>
      </div>` : ''}
    </div>`
  }).join('')

  panel.innerHTML = `
  <div class="bg-indigo-50/30 border-t border-indigo-100">
    ${rows || `<div class="px-12 py-2 text-xs text-gray-400 italic">Chưa có subtask</div>`}
    ${canAddSubtask ? `
    <div class="px-4 py-2 border-t border-indigo-100">
      <button onclick="openSubtaskModal(${taskId})" class="inline-flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-700 font-medium hover:bg-indigo-50 px-2 py-1 rounded transition-colors">
        <i class="fas fa-plus"></i> Thêm subtask
      </button>
    </div>` : ''}
  </div>`
}

// ── Toggle subtask done/todo inline ───────────────────────────────────────
async function toggleSubtaskDone(subId, taskId, checkbox) {
  const newStatus = checkbox.checked ? 'done' : 'todo'
  try {
    await api(`/subtasks/${subId}`, { method: 'put', data: { status: newStatus } })
    // Reload panel
    const subtasks = await api(`/tasks/${taskId}/subtasks`)
    const task = allTasks.find(t => t.id === taskId) || {}
    const effForTask = getEffectiveRoleForProject(task.project_id)
    const isAssigned = task.assigned_to === currentUser?.id
    const canAddSubtask = ['system_admin','project_admin','project_leader'].includes(effForTask) || isAssigned
    renderSubtaskPanel(taskId, subtasks, canAddSubtask, isAssigned)
    // Update badge in parent row
    refreshSubtaskBadge(taskId, subtasks)
  } catch(e) {
    toast('Lỗi cập nhật: ' + e.message, 'error')
    checkbox.checked = !checkbox.checked  // revert
  }
}

// ── Delete subtask from inline panel ──────────────────────────────────────
async function deleteSubtaskInline(subId, taskId) {
  showConfirmDelete('Xóa Subtask', 'Bạn có chắc muốn xóa subtask này?', async () => {
    await api(`/subtasks/${subId}`, { method: 'delete' })
    toast('Đã xóa subtask')
    const subtasks = await api(`/tasks/${taskId}/subtasks`)
    const task = allTasks.find(t => t.id === taskId) || {}
    const effForTask = getEffectiveRoleForProject(task.project_id)
    const isAssigned = task.assigned_to === currentUser?.id
    const canAddSubtask = ['system_admin','project_admin','project_leader'].includes(effForTask) || isAssigned
    renderSubtaskPanel(taskId, subtasks, canAddSubtask, isAssigned)
    refreshSubtaskBadge(taskId, subtasks)
  })
}

// ── Refresh the subtask done/total badge in the parent task row ───────────
function refreshSubtaskBadge(taskId, subtasks) {
  const subCount = subtasks.length
  const subDone = subtasks.filter(s => s.status === 'done').length
  // Update in allTasks cache
  const t = allTasks.find(x => x.id === taskId)
  if (t) { t.subtask_count = subCount; t.subtask_done_count = subDone }
  // Re-render the badge in the DOM row (without full re-render)
  const mainRow = document.querySelector(`tr.task-main-row[data-task-id="${taskId}"]`)
  if (!mainRow) return
  const badgeEl = mainRow.querySelector('.subtask-badge')
  if (!badgeEl) return
  const subBadgeColor = subDone === subCount ? '#dcfce7' : '#fef9c3'
  const subTextColor  = subDone === subCount ? '#16a34a' : '#92400e'
  badgeEl.style.background = subBadgeColor
  badgeEl.style.color = subTextColor
  badgeEl.innerHTML = `<i class="fas fa-list-check" style="font-size:9px"></i>${subDone}/${subCount}`
}

function filterTasks() {
  const search   = $('taskSearch').value.toLowerCase()
  const status   = $('taskStatusFilter').value
  const priority = $('taskPriorityFilter').value
  const project  = _cbGetValue('taskProjectCombobox')
  const category = _cbGetValue('taskCategoryCombobox')
  const phase    = $('taskPhaseFilter')?.value || ''
  const discipline = _cbGetValue('taskDisciplineFilterCombobox') || ''
  const onlyOverdue = $('taskOverdueFilter').checked

  const filtered = allTasks.filter(t =>
    (!search   || t.title.toLowerCase().includes(search) || (t.assigned_to_name||'').toLowerCase().includes(search) || (t.category_name||'').toLowerCase().includes(search)) &&
    (!status   || t.status === status) &&
    (!priority || t.priority === priority) &&
    (!project  || String(t.project_id) === project) &&
    (!category || String(t.category_id) === category) &&
    (!phase    || t.phase === phase) &&
    (!discipline || t.discipline_code === discipline) &&
    (!onlyOverdue || isOverdue(t))
  )
  renderTasksTable(filtered)
}

// Cập nhật dropdown "Phụ trách" theo thành viên của dự án được chọn.
// Nếu chưa chọn dự án → hiển thị tất cả user active.
// Gọi khi: mở modal (openTaskModal) + khi người dùng đổi dự án (onchange taskProject).
async function updateTaskAssigneeByProject(projectId = null, preserveValue = null) {
  const selProjId = projectId || $('taskProject')?.value || ''
  const assigneeSelect = $('taskAssignee')
  if (!assigneeSelect) return

  let members = []

  if (selProjId) {
    try {
      const proj = await api(`/projects/${selProjId}`)
      const memberIds = new Set()

      // 1. Lấy từ project_members (thành viên được add vào dự án)
      if (proj.members && proj.members.length > 0) {
        for (const m of proj.members) {
          if (m.is_active === 0) continue
          if (!memberIds.has(m.user_id)) {
            memberIds.add(m.user_id)
            members.push({ id: m.user_id, full_name: m.full_name })
          }
        }
      }

      // 2. Thêm admin_id của dự án nếu chưa có
      if (proj.admin_id && !memberIds.has(proj.admin_id)) {
        const u = (allUsers || []).find(u => u.id === proj.admin_id)
        if (u && u.is_active !== 0) {
          memberIds.add(u.id)
          members.push({ id: u.id, full_name: u.full_name })
        }
      }

      // 3. Thêm leader_id của dự án nếu chưa có
      if (proj.leader_id && !memberIds.has(proj.leader_id)) {
        const u = (allUsers || []).find(u => u.id === proj.leader_id)
        if (u && u.is_active !== 0) {
          memberIds.add(u.id)
          members.push({ id: u.id, full_name: u.full_name })
        }
      }
    } catch (e) { /* fallback bên dưới */ }
  }

  // Fallback: nếu không lấy được members → hiển thị tất cả user active
  if (!members.length) {
    members = (allUsers || []).filter(u => u.is_active !== 0).map(u => ({ id: u.id, full_name: u.full_name }))
  }

  // Sắp xếp theo tên
  members.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'vi'))

  // Nếu là member đang tạo task mới → chỉ hiện chính mình và auto-select
  const _taskIdVal = $('taskId')?.value
  const _effRole = getEffectiveGlobalRole()
  const _isMemberCreating = !['system_admin','project_admin','project_leader'].includes(_effRole) && !_taskIdVal
  if (_isMemberCreating) {
    const me = currentUser
    assigneeSelect.innerHTML = `<option value="${me?.id}" selected>${me?.full_name}</option>`
    return
  }

  assigneeSelect.innerHTML = '<option value="">-- Chọn người phụ trách --</option>' +
    members.map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')

  // Khôi phục giá trị đã chọn trước đó (khi edit task)
  if (preserveValue != null && preserveValue !== '') {
    assigneeSelect.value = String(preserveValue)
    // Nếu vẫn không match (user không có trong list) → thêm option ẩn để giữ giá trị
    if (assigneeSelect.value !== String(preserveValue)) {
      const u = (allUsers || []).find(u => u.id == preserveValue)
      if (u) {
        const opt = document.createElement('option')
        opt.value = String(u.id)
        opt.textContent = u.full_name
        assigneeSelect.appendChild(opt)
        assigneeSelect.value = String(preserveValue)
      }
    }
  }
}

async function openTaskModal(taskId = null, projectId = null) {
  if (!allProjects.length) { allProjects = await api('/projects'); refreshProjectRoleCache() }
  if (!allUsers.length) allUsers = await api('/users')

  $('taskModalTitle').textContent = taskId ? 'Chỉnh sửa Task' : 'Tạo Task mới'
  $('taskId').value = taskId || ''

  const effRoleForModal = projectId
    ? getEffectiveRoleForProject(projectId)
    : (taskId ? getEffectiveRoleForProject(null) : getEffectiveGlobalRole())
  const isMember = !['system_admin','project_admin','project_leader'].includes(effRoleForModal)
  // Fill disciplines combobox
  const discItems = allDisciplines.map(d => ({ value: d.code, label: `${d.code} - ${d.name}` }))
  const discContainer = $('taskDisciplineCombobox')
  if (discContainer) {
    discContainer.innerHTML = ''
    if (_cbState['taskDisciplineCombobox']) delete _cbState['taskDisciplineCombobox']
    createCombobox('taskDisciplineCombobox', {
      placeholder: '-- Chọn bộ môn --',
      items: discItems,
      fullWidth: true,
      teleport: true,
      dropdownMaxHeight: '280px',
      onchange: (val) => { $('taskDiscipline').value = val || '' }
    })
  }

  // Fill assignees: member tạo task mới → chỉ hiện chính mình và auto-select
  if (isMember && !taskId) {
    const me = currentUser
    $('taskAssignee').innerHTML = `<option value="${me.id}" selected>${me.full_name}</option>`
  } else {
    $('taskAssignee').innerHTML = '<option value="">-- Chọn người phụ trách --</option>' +
      (allUsers || []).filter(u => u.is_active !== 0).map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')
  }

  // Khởi tạo combobox Dự án
  const projItems = allProjects.map(p => ({ value: String(p.id), label: `${p.code} - ${p.name}` }))
  _initTaskProjectCombobox(projItems, false)

  // Khởi tạo combobox Hạng mục (rỗng, load sau khi chọn dự án)
  _initTaskCategoryCombobox([], false, null)

  // Tất cả fields đều được chỉnh sửa mặc định - sẽ điều chỉnh sau khi biết task
  const allFields = ['taskTitle','taskDesc','taskDiscipline','taskPhase','taskPriority','taskAssignee','taskStartDate','taskDueDate','taskEstHours']
  allFields.forEach(id => { const el = $(id); if(el) { el.disabled = false; el.style.opacity = '' } })
  // Ẩn banner nếu còn tồn tại từ trước
  const memberBanner = $('taskMemberBanner')
  if (memberBanner) memberBanner.style.display = 'none'

  if (taskId) {
    try {
      const task = await api(`/tasks/${taskId}`)
      $('taskTitle').value = task.title || ''
      $('taskDesc').value = task.description || ''
      $('taskDiscipline').value = task.discipline_code || ''
      _cbSetValue('taskDisciplineCombobox', task.discipline_code || '')
      $('taskPhase').value = task.phase || 'basic_design'
      $('taskPriority').value = task.priority || 'medium'
      $('taskStatus').value = task.status || 'todo'
      $('taskStartDate').value = task.start_date || ''
      $('taskDueDate').value = task.due_date || ''
      $('taskEstHours').value = task.estimated_hours || 0
      $('taskProgress').value = task.progress || 0
      $('taskProgressLabel').textContent = task.progress || 0

      // Kiểm tra quyền chỉnh sửa full hay chỉ status/progress
      // - Admin/project admin/leader: full quyền
      // - Member tự tạo task (assigned_by = currentUser.id): full quyền
      // - Member được giao nhưng không phải người tạo: chỉ sửa status/progress
      const isOwnTask = task.assigned_by === currentUser?.id
      const isLimitedEdit = isMember && !isOwnTask

      if (isLimitedEdit) {
        // Disable các fields admin-only; giữ taskEstHours để member tự lên kế hoạch giờ
        const limitedFields = ['taskTitle','taskDesc','taskDiscipline','taskPhase','taskPriority','taskAssignee','taskStartDate','taskDueDate']
        limitedFields.forEach(fid => { const el = $(fid); if(el) { el.disabled = true; el.style.opacity = '0.5' } })
        // Disable project combobox
        const projInput = document.getElementById('taskProjectComboboxModalInput')
        if (projInput) { projInput.disabled = true; projInput.style.opacity = '0.5' }
        // Hiển thị trường giờ dự kiến với style nổi bật để member biết có thể chỉnh
        const estEl = $('taskEstHours')
        if (estEl) { estEl.disabled = false; estEl.style.opacity = ''; estEl.style.borderColor = '#059669' }
        // Hiện banner thông báo cập nhật
        if (memberBanner) {
          memberBanner.style.display = ''
          memberBanner.className = 'mb-4 p-3 rounded-lg text-sm bg-blue-50 border border-blue-200 text-blue-800'
          memberBanner.innerHTML = '<i class="fas fa-info-circle mr-2 text-blue-500"></i>Task này do quản lý tạo. Bạn có thể cập nhật <strong>Trạng thái</strong>, <strong>% tiến độ</strong> và <strong>Giờ dự kiến</strong>.'
        }
        $('taskModalTitle').textContent = 'Cập nhật tiến độ Task'
      }

      // Set dự án trên combobox - set flag trước để onchange giữ nguyên assignee
      if (task.project_id) {
        const proj = allProjects.find(p => p.id === task.project_id)
        _taskModalPreserveAssignee = task.assigned_to || null  // set flag trước khi trigger onchange
        if (proj) _cbSelect('taskProjectComboboxModal', String(proj.id), `${proj.code} - ${proj.name}`)
        $('taskProject').value = task.project_id
      }

      // Load hạng mục và assignee sau khi set project
      // Không dùng Promise.all vì _cbSelect đã trigger onchange async
      // Gọi trực tiếp để đảm bảo await đầy đủ
      await _loadAndInitTaskCategoryCombobox(task.project_id, task.category_id, isLimitedEdit)
      await updateTaskAssigneeByProject(task.project_id, task.assigned_to)
      _taskModalPreserveAssignee = null  // Xóa flag sau khi đã load xong
    } catch (e) { toast('Lỗi tải task', 'error'); return }
  } else {
    $('taskTitle').value = ''
    $('taskDesc').value = ''
    $('taskDiscipline').value = ''
    _cbSetValue('taskDisciplineCombobox', '')
    $('taskPhase').value = 'basic_design'
    $('taskPriority').value = 'medium'
    $('taskStatus').value = 'todo'
    $('taskAssignee').value = ''
    $('taskStartDate').value = today()
    $('taskDueDate').value = ''
    $('taskEstHours').value = ''
    $('taskProgress').value = 0
    $('taskProgressLabel').textContent = 0

    if (projectId) {
      const proj = allProjects.find(p => p.id === projectId)
      if (proj) _cbSelect('taskProjectComboboxModal', String(proj.id), `${proj.code} - ${proj.name}`)
      $('taskProject').value = projectId
      await Promise.all([
        _loadAndInitTaskCategoryCombobox(projectId, null, isMember),
        updateTaskAssigneeByProject(projectId)
      ])
    }
  }

  openModal('taskModal')
}

// ── Helpers cho combobox Dự án trong Task Modal ──────────────────
let _taskModalPreserveAssignee = null  // Giữ assigned_to khi đang load edit mode

function _initTaskProjectCombobox(items, locked) {
  createCombobox('taskProjectComboboxModal', {
    placeholder: '-- Chọn dự án --',
    items,
    fullWidth: true,
    onchange: async (val) => {
      $('taskProject').value = val || ''
      // Nếu flag đang được set (đang init edit mode) → bỏ qua onchange, để openTaskModal tự handle
      if (_taskModalPreserveAssignee !== null) return
      // Reset category combobox với loading spinner
      const catDiv = document.getElementById('taskCategoryComboboxModal')
      if (catDiv) catDiv.innerHTML = `<div style="padding:6px 10px;font-size:12px;color:#9ca3af"><i class="fas fa-spinner fa-spin mr-1"></i>Đang tải...</div>`
      $('taskCategory').value = ''
      if (val) {
        await _loadAndInitTaskCategoryCombobox(parseInt(val), null, locked)
        await updateTaskAssigneeByProject(parseInt(val))
      } else {
        _initTaskCategoryCombobox([], locked, null)
      }
    }
  })
  if (locked) _applyComboboxLock('taskProjectComboboxModal')
}

function _initTaskCategoryCombobox(items, locked, selectedId) {
  createCombobox('taskCategoryComboboxModal', {
    placeholder: '-- Chọn hạng mục --',
    items,
    value: selectedId ? String(selectedId) : '',
    fullWidth: true,
    onchange: (val) => { $('taskCategory').value = val || '' }
  })
  if (selectedId) $('taskCategory').value = String(selectedId)
  if (locked) _applyComboboxLock('taskCategoryComboboxModal')
}

async function _loadAndInitTaskCategoryCombobox(projectId, selectedCategoryId, locked) {
  try {
    const cats = await api(`/projects/${projectId}/categories`)
    const items = cats.map(c => ({ value: String(c.id), label: c.name }))
    _initTaskCategoryCombobox(items, locked, selectedCategoryId)
  } catch (e) {
    _initTaskCategoryCombobox([], locked, null)
  }
}

function _applyComboboxLock(containerId) {
  const el = document.getElementById(containerId)
  if (!el) return
  // Sau khi createCombobox render xong, áp style lock
  setTimeout(() => {
    const trigger = el.querySelector('[data-cb-trigger]') || el.firstElementChild
    if (trigger) {
      trigger.style.pointerEvents = 'none'
      trigger.style.opacity = '0.6'
      trigger.style.background = '#f9fafb'
      trigger.style.cursor = 'not-allowed'
    }
  }, 30)
}

// legacy shim — giữ để không break code cũ gọi loadTaskCategories()
async function loadTaskCategories(projectId = null, selectedCategoryId = null) {
  const projId = projectId || $('taskProject')?.value || ''
  if (projId) await _loadAndInitTaskCategoryCombobox(parseInt(projId), selectedCategoryId, false)
}


$('taskForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('taskId').value

  // Đọc từ combobox (ưu tiên), fallback sang hidden input
  const projVal = _cbGetValue('taskProjectComboboxModal') || $('taskProject').value
  const catVal  = _cbGetValue('taskCategoryComboboxModal') || $('taskCategory').value

  if (!projVal) { toast('Vui lòng chọn dự án', 'warning'); return }

  const data = {
    project_id:       parseInt(projVal),
    category_id:      parseInt(catVal) || null,
    title:            $('taskTitle').value,
    description:      $('taskDesc').value,
    discipline_code:  $('taskDiscipline').value || null,
    phase:            $('taskPhase').value,
    priority:         $('taskPriority').value,
    status:           $('taskStatus').value,
    assigned_to:      parseInt($('taskAssignee').value) || null,
    start_date:       $('taskStartDate').value || null,
    due_date:         $('taskDueDate').value || null,
    estimated_hours:  parseFloat($('taskEstHours').value) || 0,
    progress:         parseInt($('taskProgress').value) || 0
  }
  try {
    if (id) await api(`/tasks/${id}`, { method: 'put', data })
    else await api('/tasks', { method: 'post', data })
    closeModal('taskModal')
    toast(id ? 'Cập nhật task thành công' : 'Tạo task thành công')

    // Nếu đang xem chi tiết dự án → reload lại để cập nhật realtime
    if ($('page-project-detail')?.classList.contains('active') && window._currentProjectDetailId) {
      await openProjectDetail(window._currentProjectDetailId)
    } else {
      loadTasks()
    }
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
})

function confirmDeleteTask(id, title) {
  showConfirmDelete(
    'Xóa Task',
    `Bạn có chắc muốn xóa task "<strong>${title}</strong>"? Hành động này không thể hoàn tác.`,
    async () => {
      await api(`/tasks/${id}`, { method: 'delete' })
      toast('Đã xóa task')
      if ($('page-project-detail')?.classList.contains('active') && window._currentProjectDetailId) {
        await openProjectDetail(window._currentProjectDetailId)
      } else {
        loadTasks()
      }
    }
  )
}

async function deleteTask(id) {
  if (!confirm('Xóa task này?')) return
  try {
    await api(`/tasks/${id}`, { method: 'delete' })
    toast('Đã xóa task')
    if ($('page-project-detail')?.classList.contains('active') && window._currentProjectDetailId) {
      await openProjectDetail(window._currentProjectDetailId)
    } else {
      loadTasks()
    }
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

async function openTaskDetail(id, openChatTab = false) {
  try {
    const task = await api(`/tasks/${id}`)
    const subtasks = await api(`/tasks/${id}/subtasks`).catch(() => [])
    $('taskDetailTitle').textContent = task.title
    const overdue = isOverdue(task)
    const effD = getEffectiveRoleForProject(task.project_id)
    const canEditTask = ['system_admin','project_admin','project_leader'].includes(effD) || task.assigned_to === currentUser?.id || task.assigned_by === currentUser?.id
    const isAdminOrLeader = ['system_admin','project_admin','project_leader'].includes(effD)

    // Subtask stats
    const totalSub = subtasks.length
    const doneSub = subtasks.filter(s => s.status === 'done').length
    const subPct = totalSub > 0 ? Math.round(doneSub / totalSub * 100) : 0

    const getSubStatusBadge = (s) => {
      const map = {
        todo: '<span class="badge text-xs" style="background:#f3f4f6;color:#374151"><i class="fas fa-circle mr-1"></i>Chờ</span>',
        in_progress: '<span class="badge text-xs" style="background:#dbeafe;color:#1d4ed8"><i class="fas fa-spinner mr-1"></i>Đang làm</span>',
        done: '<span class="badge text-xs" style="background:#dcfce7;color:#15803d"><i class="fas fa-check mr-1"></i>Xong</span>'
      }
      return map[s] || s
    }
    const getSubPriorityIcon = (p) => {
      const map = { low: 'text-gray-400', medium: 'text-yellow-500', high: 'text-red-500' }
      return `<i class="fas fa-flag text-xs ${map[p]||'text-gray-400'}" title="${p}"></i>`
    }

    // ── TAB: INFO ────────────────────────────────────────────────────────
    $('taskDetailContent').innerHTML = `
      <div class="space-y-4">
        <div class="flex flex-wrap gap-2">
          ${getStatusBadge(task.status)} ${getPriorityBadge(task.priority)}
          ${task.discipline_code ? `<span class="badge" style="background:#e0f2fe;color:#0369a1">${task.discipline_code}</span>` : ''}
          ${task.phase ? `<span class="badge" style="background:#f0fdf4;color:#15803d">${getPhaseName(task.phase)}</span>` : ''}
          ${overdue ? '<span class="badge badge-overdue">Trễ hạn!</span>' : ''}
        </div>
        ${task.description ? `<p class="text-gray-600 text-sm">${task.description}</p>` : ''}
        <div class="grid grid-cols-2 gap-3 text-sm bg-gray-50 rounded-lg p-3">
          <div><span class="text-gray-500">Dự án:</span> <span class="font-medium">${task.project_name||'-'}</span></div>
          <div><span class="text-gray-500">Hạng mục:</span> <span class="font-medium">${task.category_name||'-'}</span></div>
          <div><span class="text-gray-500">Phụ trách:</span> <span class="font-medium">${task.assigned_to_name||'-'}</span></div>
          <div><span class="text-gray-500">Bắt đầu:</span> <span class="font-medium">${fmtDate(task.start_date)}</span></div>
          <div><span class="text-gray-500 ${overdue?'text-red-500':''}">Hạn:</span> <span class="font-medium ${overdue?'text-red-600':''}">${fmtDate(task.due_date)}</span></div>
          <div><span class="text-gray-500">Giờ dự kiến:</span> <span class="font-medium">${task.estimated_hours||0}h</span></div>
          <div><span class="text-gray-500">Giờ thực tế:</span> <span class="font-medium">${task.actual_hours||0}h</span></div>
        </div>
        <div>
          <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-500 font-medium">Tiến độ Task</span>
            <span class="font-bold">${task.progress||0}%</span>
          </div>
          <div class="progress-bar"><div class="progress-fill ${overdue?'danger':''}" style="width:${task.progress||0}%"></div></div>
        </div>
        ${task.history?.length > 0 ? `
        <div>
          <h4 class="font-bold text-gray-700 mb-2 text-sm"><i class="fas fa-history mr-2 text-gray-400"></i>Lịch sử thay đổi</h4>
          <div class="space-y-1 max-h-32 overflow-y-auto">
            ${task.history.map(h => `
              <div class="flex gap-2 text-xs text-gray-500 py-1 border-b">
                <span class="text-gray-400 flex-shrink-0">${toLocalDayjs(h.created_at).format('DD/MM HH:mm')}</span>
                <span class="font-medium text-gray-700 flex-shrink-0">${h.changed_by_name}</span>
                <span class="truncate">→ ${h.field_changed}: ${h.new_value || '-'}</span>
              </div>
            `).join('')}
          </div>
        </div>` : ''}
        <div class="flex justify-end gap-2 pt-2 border-t">
          <button onclick="closeModal('taskDetailModal')" class="btn-secondary text-sm">Đóng</button>
          ${canEditTask ? `<button onclick="closeModal('taskDetailModal'); openTaskModal(${task.id})" class="btn-primary text-sm"><i class="fas fa-edit mr-1"></i>Chỉnh sửa Task</button>` : ''}
        </div>
      </div>
    `

    // ── TAB: SUBTASKS ──────────────────────────────────────────────────
    $('taskDetailSubtasks').innerHTML = `
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-gray-700 text-sm">Subtasks</span>
            <span class="badge text-xs" style="background:#e0f2fe;color:#0369a1">${doneSub}/${totalSub}</span>
            ${totalSub > 0 ? `<div class="flex items-center gap-1">
              <div class="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div class="h-full bg-primary rounded-full" style="width:${subPct}%"></div>
              </div>
              <span class="text-xs text-gray-400">${subPct}%</span>
            </div>` : ''}
          </div>
          <button onclick="openSubtaskModal(${task.id})" class="btn-primary text-xs px-3 py-1.5">
            <i class="fas fa-plus mr-1"></i>Thêm subtask
          </button>
        </div>
        <div id="subtaskList_${task.id}" class="border rounded-lg overflow-hidden divide-y">
          ${totalSub === 0 ? `
            <div class="py-8 text-center text-gray-400 text-sm">
              <i class="fas fa-clipboard-list text-2xl mb-2 block opacity-30"></i>
              Chưa có subtask. Nhấn <strong>+ Thêm subtask</strong> để tạo công việc con.
            </div>` :
            subtasks.map(s => {
              const canEditSub = isAdminOrLeader || s.created_by === currentUser?.id || s.assigned_to === currentUser?.id
              const canDeleteSub = isAdminOrLeader || s.created_by === currentUser?.id
              const isOverdueSub = s.due_date && s.status !== 'done' && new Date(s.due_date) < new Date()
              return `
              <div class="flex items-start gap-2 px-3 py-2.5 hover:bg-gray-50 group" id="subtaskRow_${s.id}">
                <button onclick="toggleSubtaskDoneDetail(${s.id}, '${s.status}', ${task.id})"
                  class="mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                  ${s.status==='done' ? 'bg-primary border-primary' : 'border-gray-300 hover:border-primary'}">
                  ${s.status==='done' ? '<i class="fas fa-check text-white" style="font-size:8px"></i>' : ''}
                </button>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    ${getSubPriorityIcon(s.priority)}
                    <span class="text-sm ${s.status==='done' ? 'line-through text-gray-400' : 'text-gray-800'} font-medium">${s.title}</span>
                    ${getSubStatusBadge(s.status)}
                    ${isOverdueSub ? '<span class="badge badge-overdue text-xs">Trễ!</span>' : ''}
                  </div>
                  ${s.notes ? `<p class="text-xs text-gray-500 mt-0.5 truncate">${s.notes}</p>` : ''}
                  <div class="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                    ${s.assigned_to_name ? `<span><i class="fas fa-user mr-1"></i>${s.assigned_to_name}</span>` : ''}
                    ${s.due_date ? `<span class="${isOverdueSub?'text-red-500 font-medium':''}"><i class="fas fa-calendar mr-1"></i>${fmtDate(s.due_date)}</span>` : ''}
                    ${s.estimated_hours > 0 ? `<span><i class="fas fa-clock mr-1"></i>${s.estimated_hours}h</span>` : ''}
                  </div>
                </div>
                <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  ${canEditSub ? `<button onclick="openSubtaskModal(${task.id}, ${JSON.stringify(s).replace(/"/g,'&quot;')})" class="text-blue-400 hover:text-blue-600 p-1" title="Sửa"><i class="fas fa-edit text-xs"></i></button>` : ''}
                  ${canDeleteSub ? `<button onclick="deleteSubtask(${s.id}, ${task.id})" class="text-red-400 hover:text-red-600 p-1" title="Xóa"><i class="fas fa-trash text-xs"></i></button>` : ''}
                </div>
              </div>`
            }).join('')
          }
        </div>
      </div>
    `

    // ── TAB: CHAT (lazy load) ─────────────────────────────────────────
    const chatDiv = $('taskDetailChat')
    chatDiv.innerHTML = ''
    chatDiv.style.display = 'none'
    chatDiv._chatContext = { type: 'task', id: task.id }
    chatDiv._initialized = false  // Reset so new task loads fresh chat

    // Switch to correct tab (chat if triggered from notification)
    switchTaskDetailTab(openChatTab ? 'chat' : 'info')

    openModal('taskDetailModal')

    // Mark chat notifications as read for this task
    if (openChatTab) markChatNotifsRead('task', task.id)
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

// ── Tab switcher for Task Detail ─────────────────────────────────────────
function switchTaskDetailTab(tab) {
  const tabs = { info: 'taskDetailContent', subtasks: 'taskDetailSubtasks', chat: 'taskDetailChat' }
  Object.entries(tabs).forEach(([key, elId]) => {
    const el = $(elId)
    if (el) el.style.display = key === tab ? (key === 'chat' ? 'flex' : 'block') : 'none'
    const btn = $(`tdTab-${key}`)
    if (btn) btn.className = `tab-btn text-xs py-2 px-4${key === tab ? ' active' : ''}`
  })
  // When chat tab is active: outer body should not overflow so chat fills height
  const body = $('taskDetailBody')
  if (body) body.style.overflowY = tab === 'chat' ? 'hidden' : 'auto'

  if (tab === 'chat') {
    const chatDiv = $('taskDetailChat')
    if (chatDiv && chatDiv._chatContext) {
      if (!chatDiv._initialized) {
        chatDiv._initialized = true
        initChatPanel(chatDiv, chatDiv._chatContext.type, chatDiv._chatContext.id, 500)
      }
      // Mark notifications read when user opens chat tab
      markChatNotifsRead(chatDiv._chatContext.type, chatDiv._chatContext.id)
    }
  }
}

// ── Subtask functions ─────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
//  CHAT ENGINE — shared for task chat and project chat
// ═══════════════════════════════════════════════════════════════════════════
let _chatMembersCache = {}  // projectId → members list for @mention

// Build and inject chat panel into `container` element
async function initChatPanel(container, contextType, contextId, heightPx = 500) {
  container.style.display = 'flex'
  container.style.flexDirection = 'column'
  // For task chat: use flex:1 to fill the modal; for project: use fixed height
  if (contextType === 'task') {
    container.style.flex = '1'
    container.style.minHeight = '420px'
  } else {
    container.style.height = heightPx + 'px'
  }

  container.innerHTML = `
    <div class="chat-messages flex-1 overflow-y-auto bg-gray-50 p-4" id="chatMsgs_${contextType}_${contextId}">
      <div class="text-center text-gray-400 text-sm py-6"><i class="fas fa-spinner fa-spin mr-2"></i>Đang tải...</div>
    </div>
    <div class="chat-input-bar flex-shrink-0" id="chatInputBar_${contextType}_${contextId}" style="position:relative">
      <!-- @mention dropdown — positioned above the input bar, not inside overflow:hidden -->
      <div id="mentionDropdown_${contextType}_${contextId}" class="mention-dropdown hidden"
        style="position:absolute;bottom:100%;left:14px;right:14px;max-width:320px;margin-bottom:4px;z-index:9999"></div>
      <!-- Attachment preview -->
      <div class="chat-att-preview" id="chatAttPreview_${contextType}_${contextId}"></div>
      <!-- Input area -->
      <div class="chat-input-area" id="chatInputArea_${contextType}_${contextId}">
        <textarea id="chatTextarea_${contextType}_${contextId}"
          class="chat-textarea"
          placeholder="Nhắn tin... Dùng @ để đề cập thành viên"
          rows="1"
          onkeydown="chatKeydown(event,'${contextType}',${contextId})"
          oninput="chatInput(this,'${contextType}',${contextId})"
          onpaste="chatPaste(event,'${contextType}',${contextId})"></textarea>
      </div>
      <!-- Action bar -->
      <div class="flex items-center justify-between px-2 pt-1.5 pb-1">
        <div class="flex gap-1">
          <button onclick="triggerFileAttach('${contextType}',${contextId})" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="Đính kèm file">
            <i class="fas fa-paperclip text-sm"></i>
          </button>
          <button onclick="triggerImageAttach('${contextType}',${contextId})" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-indigo-500 transition-colors" title="Đính kèm ảnh">
            <i class="fas fa-image text-sm"></i>
          </button>
          <input type="file" id="fileInput_${contextType}_${contextId}" style="display:none" multiple onchange="onFileSelected(this,'${contextType}',${contextId})">
          <input type="file" id="imgInput_${contextType}_${contextId}" style="display:none" accept="image/*" multiple onchange="onFileSelected(this,'${contextType}',${contextId})">
        </div>
        <button onclick="sendChatMessage('${contextType}',${contextId})"
          class="flex items-center gap-1.5 bg-primary text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-green-600 transition-colors"
          title="Gửi (Enter)">
          <i class="fas fa-paper-plane text-xs"></i> Gửi
        </button>
      </div>
    </div>
  `
  // Load messages
  await loadChatMessages(contextType, contextId)

  // Start auto-refresh polling every 15 seconds
  const pollKey = `_chatPoll_${contextType}_${contextId}`
  if (window[pollKey]) clearInterval(window[pollKey])
  window[pollKey] = setInterval(async () => {
    // Stop polling if container is removed from DOM
    if (!document.body.contains(container)) {
      clearInterval(window[pollKey])
      delete window[pollKey]
      return
    }

    // Determine if chat panel is currently visible to the user
    let isVisible = false
    if (contextType === 'project') {
      const outerPanel = $('projPanel-chat')
      isVisible = outerPanel ? (outerPanel.style.display === 'block' && !outerPanel.classList.contains('hidden')) : false
    } else {
      // Task chat: check if the container is shown (flex) and modal is open
      isVisible = container.style.display === 'flex' && container.offsetParent !== null
    }

    if (isVisible) {
      // Chat is open — refresh messages and scroll if near bottom
      const msgsEl = $(`chatMsgs_${contextType}_${contextId}`)
      if (msgsEl) {
        const nearBottom = msgsEl.scrollTop + msgsEl.clientHeight >= msgsEl.scrollHeight - 80
        const msgs = await api(`/messages?context_type=${contextType}&context_id=${contextId}`).catch(() => null)
        if (msgs) {
          renderChatMessages(msgsEl, msgs, contextType, contextId)
          if (nearBottom) scrollChatToBottom(contextType, contextId)
        }
      }
    }
    // Always refresh notifications to update badges (both when visible and hidden)
    loadNotifications()
  }, 15000)
}

// ── Load & render messages ────────────────────────────────────────────────
async function loadChatMessages(contextType, contextId) {
  const msgsEl = $(`chatMsgs_${contextType}_${contextId}`)
  if (!msgsEl) return
  try {
    const msgs = await api(`/messages?context_type=${contextType}&context_id=${contextId}`)
    renderChatMessages(msgsEl, msgs, contextType, contextId)
    scrollChatToBottom(contextType, contextId)
  } catch(e) {
    msgsEl.innerHTML = `<div class="text-center text-red-400 text-sm py-6">Lỗi tải chat: ${e.message}</div>`
  }
}

function renderChatMessages(container, msgs, contextType, contextId) {
  if (!msgs.length) {
    container.innerHTML = `<div class="text-center py-10 text-gray-400">
      <i class="fas fa-comments text-3xl mb-2 block opacity-20"></i>
      <p class="text-sm">Chưa có tin nhắn nào. Hãy bắt đầu cuộc trò chuyện!</p>
    </div>`
    return
  }

  // Group messages by date
  let lastDate = ''
  container.innerHTML = msgs.map(msg => {
    const isMe = msg.sender_id === currentUser?.id
    const dt = toLocalDayjs(msg.created_at)
    const dateLabel = dt.format('DD/MM/YYYY')
    let dateSep = ''
    if (dateLabel !== lastDate) {
      lastDate = dateLabel
      dateSep = `<div class="flex items-center gap-2 my-3">
        <div class="flex-1 h-px bg-gray-200"></div>
        <span class="text-xs text-gray-400 font-medium">${dateLabel}</span>
        <div class="flex-1 h-px bg-gray-200"></div>
      </div>`
    }

    const timeStr = dt.format('HH:mm')
    const initials = msg.sender_name?.split(' ').pop()?.charAt(0) || '?'

    // Render content with @mention highlighting
    const contentHtml = renderChatContent(msg.content, msg.mentions || [])

    // Attachments
    const atts = (msg.attachments || []).map(a => renderAttachment(a)).join('')

    const canDelete = msg.sender_id === currentUser?.id || currentUser?.role === 'system_admin'

    return `${dateSep}
    <div class="chat-bubble ${isMe ? 'me' : 'other'}" data-msg-id="${msg.id}">
      ${!isMe ? `<div class="bubble-meta">
        <div class="mention-avatar" style="width:22px;height:22px;font-size:10px">${initials}</div>
        <span class="font-medium text-gray-600">${msg.sender_name}</span>
        <span>${timeStr}</span>
      </div>` : `<div class="bubble-meta"><span>${timeStr}</span></div>`}
      <div class="bubble-inner">
        ${contentHtml}
        ${atts ? `<div class="mt-2 space-y-1">${atts}</div>` : ''}
      </div>
      ${canDelete ? `<div class="flex ${isMe?'justify-end':'justify-start'} mt-0.5">
        <button class="msg-delete-btn" onclick="deleteChatMessage(${msg.id},'${contextType}',${contextId})" title="Xóa tin nhắn">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>` : ''}
    </div>`
  }).join('')
}

function renderChatContent(text, mentions) {
  // Escape HTML
  let html = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
  // Highlight @mentions
  if (mentions?.length) {
    mentions.forEach(m => {
      if (m.name) {
        html = html.replace(new RegExp('@' + m.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'g'),
          `<span class="chat-mention">@${m.name}</span>`)
      }
    })
  }
  return html
}

function renderAttachment(a) {
  const isImage = a.file_type?.startsWith('image/')
  if (isImage) {
    return `<div class="chat-att-thumb">
      <img src="${a.data}" alt="${a.file_name}" onclick="openImageViewer('${a.data}','${a.file_name}')" title="${a.file_name}">
    </div>`
  }
  const icon = a.file_type?.includes('pdf') ? 'fa-file-pdf text-red-500' :
               a.file_type?.includes('word') ? 'fa-file-word text-blue-500' :
               a.file_type?.includes('sheet') || a.file_type?.includes('excel') ? 'fa-file-excel text-green-500' :
               'fa-file text-gray-500'
  const size = a.file_size > 1024*1024 ? (a.file_size/1024/1024).toFixed(1)+'MB' : Math.round(a.file_size/1024)+'KB'
  return `<a href="${a.data}" download="${a.file_name}" class="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-2 text-sm transition-colors no-underline text-gray-700">
    <i class="fas ${icon} text-lg flex-shrink-0"></i>
    <div class="min-w-0"><div class="font-medium truncate max-w-xs">${a.file_name}</div><div class="text-xs text-gray-400">${size}</div></div>
    <i class="fas fa-download text-gray-400 ml-auto flex-shrink-0"></i>
  </a>`
}

function scrollChatToBottom(contextType, contextId) {
  const el = $(`chatMsgs_${contextType}_${contextId}`)
  if (el) setTimeout(() => el.scrollTop = el.scrollHeight, 50)
}

// ── Send message ──────────────────────────────────────────────────────────
async function sendChatMessage(contextType, contextId) {
  const ta = $(`chatTextarea_${contextType}_${contextId}`)
  const content = ta?.value?.trim()
  if (!content) return

  // Collect pending attachments
  const attKey = `chatAtts_${contextType}_${contextId}`
  const attachments = window[attKey] || []

  // Use pendingMentions (set when user picks from dropdown) — reliable even with Unicode names
  const mentionKey = `pendingMentions_${contextType}_${contextId}`
  const mentions = window[mentionKey] || []

  try {
    const btn = document.querySelector(`#chatInputBar_${contextType}_${contextId} button[onclick*="sendChatMessage"]`)
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin text-xs"></i>' }

    await api('/messages', { method: 'post', data: { context_type: contextType, context_id: parseInt(contextId), content, mentions, attachments } })

    ta.value = ''
    ta.style.height = 'auto'
    window[attKey] = []
    window[mentionKey] = []  // clear pending mentions after send
    const prev = $(`chatAttPreview_${contextType}_${contextId}`)
    if (prev) prev.innerHTML = ''

    await loadChatMessages(contextType, contextId)

    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane text-xs"></i> Gửi' }
  } catch(e) {
    toast('Lỗi gửi tin: ' + e.message, 'error')
    const btn = document.querySelector(`#chatInputBar_${contextType}_${contextId} button[onclick*="sendChatMessage"]`)
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane text-xs"></i> Gửi' }
  }
}

// ── Delete message ────────────────────────────────────────────────────────
async function deleteChatMessage(msgId, contextType, contextId) {
  showConfirmDelete('Xóa tin nhắn', 'Xóa tin nhắn này?', async () => {
    await api(`/messages/${msgId}`, { method: 'delete' })
    await loadChatMessages(contextType, contextId)
  })
}

// ── Keyboard handler ──────────────────────────────────────────────────────
function chatKeydown(e, contextType, contextId) {
  const dropKey = `mentionDropdownActive_${contextType}_${contextId}`
  if (window[dropKey]) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); navigateMentionDropdown(contextType, contextId, e.key === 'ArrowDown' ? 1 : -1); return }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectActiveMention(contextType, contextId); return }
    if (e.key === 'Escape') { closeMentionDropdown(contextType, contextId); return }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendChatMessage(contextType, contextId)
  }
}

// ── Auto-resize textarea + @mention trigger ───────────────────────────────
function chatInput(ta, contextType, contextId) {
  ta.style.height = 'auto'
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  checkMentionTrigger(ta, contextType, contextId)
}

// ── Paste handler — capture images from clipboard ─────────────────────────
async function chatPaste(e, contextType, contextId) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) await addAttachment(file, contextType, contextId)
    }
  }
}

// ── File / Image attach ───────────────────────────────────────────────────
function triggerFileAttach(contextType, contextId) { $(`fileInput_${contextType}_${contextId}`)?.click() }
function triggerImageAttach(contextType, contextId) { $(`imgInput_${contextType}_${contextId}`)?.click() }

async function onFileSelected(input, contextType, contextId) {
  for (const file of input.files) await addAttachment(file, contextType, contextId)
  input.value = ''
}

async function addAttachment(file, contextType, contextId) {
  const MAX = 5 * 1024 * 1024
  if (file.size > MAX) { toast(`File "${file.name}" quá lớn (tối đa 5MB)`, 'error'); return }
  const attKey = `chatAtts_${contextType}_${contextId}`
  if (!window[attKey]) window[attKey] = []

  const reader = new FileReader()
  reader.onload = (ev) => {
    const att = { file_name: file.name, file_type: file.type, file_size: file.size, data: ev.target.result }
    window[attKey].push(att)
    renderAttachmentPreview(contextType, contextId)
  }
  reader.readAsDataURL(file)
}

function renderAttachmentPreview(contextType, contextId) {
  const atts = window[`chatAtts_${contextType}_${contextId}`] || []
  const prev = $(`chatAttPreview_${contextType}_${contextId}`)
  if (!prev) return
  prev.innerHTML = atts.map((a, i) => {
    const isImage = a.file_type?.startsWith('image/')
    return `<div class="chat-att-chip">
      ${isImage ? `<img src="${a.data}" alt="${a.file_name}">` : `<i class="fas fa-file text-gray-400 text-lg"></i>`}
      <span class="truncate text-xs flex-1">${a.file_name}</span>
      <button class="att-remove" onclick="removeAttachment(${i},'${contextType}',${contextId})"><i class="fas fa-times text-xs"></i></button>
    </div>`
  }).join('')
}

function removeAttachment(idx, contextType, contextId) {
  const atts = window[`chatAtts_${contextType}_${contextId}`] || []
  atts.splice(idx, 1)
  renderAttachmentPreview(contextType, contextId)
}

// ── @mention system ───────────────────────────────────────────────────────
async function getProjectMembers(contextType, contextId) {
  // For task chat, we need the project_id — use allTasks cache
  let projectId = contextId
  if (contextType === 'task') {
    // Try allTasks cache first
    const t = allTasks.find(x => x.id == contextId)
    projectId = t?.project_id
    if (!projectId) {
      // Fetch task detail to get project_id
      try {
        const task = await api(`/tasks/${contextId}`)
        projectId = task?.project_id
      } catch { projectId = contextId }
    }
  }
  // Normalize allUsers to always have user_id field (allUsers objects only have id)
  const normalizeUsers = (users) => (users || []).map(u => ({ ...u, user_id: u.user_id || u.id }))
  if (!projectId) return normalizeUsers(allUsers)
  if (_chatMembersCache[projectId]) return _chatMembersCache[projectId]
  try {
    const proj = await api(`/projects/${projectId}`)
    // proj.members from API: each has user_id (actual user id) and id (project_members row id)
    // Normalize: ensure user_id is always the real user id
    const members = (proj.members || []).map(m => ({ ...m, user_id: m.user_id }))
    // Add admin + leader if not already in members list
    const memberIds = new Set(members.map(m => m.user_id))
    if (proj.admin_id && !memberIds.has(proj.admin_id)) {
      const admin = (allUsers || []).find(u => u.id === proj.admin_id)
      if (admin) members.push({ user_id: admin.id, full_name: admin.full_name, department: admin.department })
    }
    if (proj.leader_id && !memberIds.has(proj.leader_id)) {
      const leader = (allUsers || []).find(u => u.id === proj.leader_id)
      if (leader) members.push({ user_id: leader.id, full_name: leader.full_name, department: leader.department })
    }
    _chatMembersCache[projectId] = members
    return members
  } catch {
    // Fallback: return allUsers normalized
    return normalizeUsers(allUsers)
  }
}

function checkMentionTrigger(ta, contextType, contextId) {
  const val = ta.value
  const cursor = ta.selectionStart
  // Find the @ before cursor
  const before = val.slice(0, cursor)
  const atIdx = before.lastIndexOf('@')
  if (atIdx === -1 || (atIdx > 0 && /\S/.test(before[atIdx - 1]))) {
    closeMentionDropdown(contextType, contextId)
    return
  }
  const query = before.slice(atIdx + 1).toLowerCase()
  // Allow spaces in query for Vietnamese multi-word names
  // Close only if query ends with 2 consecutive spaces (user is done)
  if (query.endsWith('  ')) { closeMentionDropdown(contextType, contextId); return }
  showMentionDropdown(query, contextType, contextId, ta, atIdx)
}

async function showMentionDropdown(query, contextType, contextId, ta, atIdx) {
  const members = await getProjectMembers(contextType, contextId)
  // Support both full_name (project members) and name (allUsers)
  const filtered = members.filter(m => {
    const name = m.full_name || m.name || ''
    return name.toLowerCase().includes(query.trim().toLowerCase())
  }).slice(0, 8)
  const dd = $(`mentionDropdown_${contextType}_${contextId}`)
  if (!dd) return

  if (!filtered.length) { closeMentionDropdown(contextType, contextId); return }

  dd.innerHTML = filtered.map((m, i) => {
    const name = m.full_name || m.name || 'Unknown'
    const dept = m.department || ''
    const initials = name.split(' ').pop()?.charAt(0) || '?'
    // IMPORTANT: m.id = project_members row id (wrong), m.user_id = actual user id (correct)
    const uid = m.user_id || m.id || ''
    return `<div class="mention-item ${i===0?'active':''}" onclick="insertMention('${name.replace(/'/g,"\'")}','${contextType}',${contextId},${uid})" data-idx="${i}">
      <div class="mention-avatar">${initials}</div>
      <div>
        <div class="font-medium text-gray-800 text-xs">${name}</div>
        <div class="text-xs text-gray-400">${dept}</div>
      </div>
    </div>`
  }).join('')
  dd.classList.remove('hidden')
  window[`mentionDropdownActive_${contextType}_${contextId}`] = { members: filtered, activeIdx: 0, atIdx }
}

function closeMentionDropdown(contextType, contextId) {
  const dd = $(`mentionDropdown_${contextType}_${contextId}`)
  if (dd) dd.classList.add('hidden')
  delete window[`mentionDropdownActive_${contextType}_${contextId}`]
}

function navigateMentionDropdown(contextType, contextId, dir) {
  const state = window[`mentionDropdownActive_${contextType}_${contextId}`]
  if (!state) return
  state.activeIdx = Math.max(0, Math.min(state.members.length - 1, state.activeIdx + dir))
  const dd = $(`mentionDropdown_${contextType}_${contextId}`)
  if (!dd) return
  dd.querySelectorAll('.mention-item').forEach((el, i) => el.classList.toggle('active', i === state.activeIdx))
}

function selectActiveMention(contextType, contextId) {
  const state = window[`mentionDropdownActive_${contextType}_${contextId}`]
  if (!state) return
  const m = state.members[state.activeIdx]
  // Use m.user_id (actual user id), fallback m.id only if user_id absent (allUsers objects)
  insertMention(m.full_name || m.name || '', contextType, contextId, m.user_id || m.id)
}

function insertMention(fullName, contextType, contextId, userId) {
  const ta = $(`chatTextarea_${contextType}_${contextId}`)
  if (!ta) return
  const state = window[`mentionDropdownActive_${contextType}_${contextId}`]
  const cursor = ta.selectionStart
  const before = ta.value.slice(0, state?.atIdx ?? cursor)
  const after = ta.value.slice(cursor)
  ta.value = before + '@' + fullName + ' ' + after
  const newCursor = before.length + fullName.length + 2
  ta.setSelectionRange(newCursor, newCursor)
  ta.focus()

  // Store mention with userId so backend can lookup by id (avoids Unicode regex issues)
  if (userId) {
    const key = `pendingMentions_${contextType}_${contextId}`
    if (!window[key]) window[key] = []
    // Avoid duplicates
    if (!window[key].find(m => m.id === userId)) {
      window[key].push({ id: userId, name: fullName })
    }
  }

  closeMentionDropdown(contextType, contextId)
}

function extractMentions(content, contextType, contextId) {
  const matches = content.match(/@([\w\s\.]+?)(?=\s|$|@)/g) || []
  return matches.map(m => ({ name: m.slice(1).trim() }))
}

// ── Image viewer lightbox ─────────────────────────────────────────────────
function openImageViewer(src, name) {
  const existing = $('imageViewerOverlay')
  if (existing) existing.remove()
  const overlay = document.createElement('div')
  overlay.id = 'imageViewerOverlay'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out'
  overlay.onclick = () => overlay.remove()
  overlay.innerHTML = `
    <div style="position:relative;max-width:90vw;max-height:90vh">
      <img src="${src}" alt="${name}" style="max-width:90vw;max-height:90vh;border-radius:8px;object-fit:contain">
      <div style="position:absolute;bottom:-28px;left:0;right:0;text-align:center;color:rgba(255,255,255,.7);font-size:12px">${name}</div>
      <button onclick="event.stopPropagation();this.closest('a')?.click()" style="position:absolute;top:-10px;right:-10px;background:#fff;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center" onclick="event.stopPropagation();document.getElementById('imageViewerOverlay').remove()">✕</button>
    </div>`
  document.body.appendChild(overlay)
}

// ── Project Detail Tab Switcher ───────────────────────────────────────────
function switchProjectTab(tab, projectId) {
  const pid = projectId || window._currentProjectDetailId
  // Show/hide panels
  const taskPanel = $('projPanel-tasks')
  const chatPanel = $('projPanel-chat')
  if (taskPanel) taskPanel.style.display = tab === 'tasks' ? 'block' : 'none'
  if (chatPanel) {
    chatPanel.classList.remove('hidden')
    chatPanel.style.display = tab === 'chat' ? 'block' : 'none'
  }

  // Update tab buttons
  ;['tasks','chat'].forEach(key => {
    const btn = $(`projTab-${key}`)
    if (btn) btn.className = `tab-btn text-xs py-2 px-4 mr-1${key === tab ? ' active' : ''}`
  })

  if (tab === 'chat') {
    const container = $(`projectChatPanel_${pid}`)
    if (container && !container._initialized) {
      container._initialized = true
      initChatPanel(container, 'project', pid, 520)
    } else if (container && container._initialized) {
      // Refresh messages when switching back to chat tab
      loadChatMessages('project', pid)
    }
    // Mark project chat notifications as read & clear badge
    markChatNotifsRead('project', pid)
    updateProjectChatTabBadge(pid)
  }
}

// ── Project Chat (embedded in project detail) ─────────────────────────────
function openProjectChat(projectId) {
  switchProjectTab('chat', projectId)
}

// Update the "Chat nhóm" tab button badge for project
function updateProjectChatTabBadge(projectId) {
  const btn = $('projTab-chat')
  if (!btn) return
  const count = _chatUnreadMap[`project_${projectId}`] || 0
  const existing = btn.querySelector('.chat-unread-badge')
  if (count > 0) {
    if (!existing) {
      const b = document.createElement('span')
      b.className = 'chat-unread-badge ml-1'
      b.textContent = count
      btn.appendChild(b)
    } else {
      existing.textContent = count
    }
  } else if (existing) {
    existing.remove()
  }
}


function openSubtaskModal(taskId, sub = null) {
  $('subtaskTaskId').value = taskId
  $('subtaskId').value = sub?.id || ''
  $('subtaskModalTitle').textContent = sub ? 'Chỉnh sửa Subtask' : 'Thêm Subtask'
  $('subtaskTitle').value = sub?.title || ''
  $('subtaskStatus').value = sub?.status || 'todo'
  $('subtaskPriority').value = sub?.priority || 'medium'
  $('subtaskDueDate').value = sub?.due_date || ''
  $('subtaskEstHours').value = sub?.estimated_hours || ''
  $('subtaskNotes').value = sub?.notes || ''

  // Member chỉ được sửa status/actual_hours/notes nếu không phải creator/admin
  const effRole = getEffectiveGlobalRole()
  const isAdminOrLeader = ['system_admin','project_admin','project_leader'].includes(effRole)
  const isCreator = sub ? (sub.created_by === currentUser?.id) : true
  const canEditAll = isAdminOrLeader || isCreator || !sub

  ;['subtaskTitle','subtaskPriority','subtaskDueDate','subtaskEstHours'].forEach(id => {
    const el = $(id); if (el) el.disabled = !canEditAll
  })

  // Ẩn/hiện tab bar: chỉ show khi thêm mới, ẩn khi sửa
  const tabBar = $('subtaskTabBar')
  if (tabBar) tabBar.style.display = sub ? 'none' : 'flex'

  // Khi thêm mới: reset về tab single; khi sửa: ở lại tab single
  switchSubtaskTab('single')

  // Reset import state
  clearSubtaskImport()

  openModal('subtaskModal')
}

// ── Subtask Modal Tabs ──────────────────────────────────────────
function switchSubtaskTab(tab) {
  ;['single','bulk','import'].forEach(t => {
    const btn = $(`stab-${t}`)
    const panel = $(`stpanel-${t}`)
    if (!btn || !panel) return
    const active = t === tab
    btn.classList.toggle('border-primary', active)
    btn.classList.toggle('text-primary', active)
    btn.classList.toggle('border-transparent', !active)
    btn.classList.toggle('text-gray-500', !active)
    panel.style.display = active ? '' : 'none'
  })
  // Init bulk rows nếu chưa có
  if (tab === 'bulk') initBulkRows()
}

// ── Bulk subtask (thêm nhiều) ────────────────────────────────────
let _bulkSubtaskRows = []

function initBulkRows() {
  const container = $('bulkSubtaskRows')
  if (!container) return
  if (container.children.length === 0) {
    _bulkSubtaskRows = []
    addBulkSubtaskRow()
    addBulkSubtaskRow()
    addBulkSubtaskRow()
  }
}

function addBulkSubtaskRow(title = '', dueDate = '', priority = 'medium', estHours = '') {
  const container = $('bulkSubtaskRows')
  if (!container) return
  const idx = Date.now() + Math.random()
  const div = document.createElement('div')
  div.className = 'flex items-center gap-2'
  div.dataset.rowId = idx
  div.innerHTML = `
    <input type="text" placeholder="Tên subtask *" value="${title.replace(/"/g,'&quot;')}"
      class="input-field flex-1 text-sm py-1.5" oninput="updateBulkCount()">
    <input type="date" value="${dueDate}" class="input-field text-sm py-1.5" style="width:130px">
    <select class="select-field text-sm py-1.5" style="width:100px">
      <option value="low" ${priority==='low'?'selected':''}>Thấp</option>
      <option value="medium" ${priority==='medium'?'selected':''}>Trung bình</option>
      <option value="high" ${priority==='high'?'selected':''}>Cao</option>
    </select>
    <input type="number" placeholder="Giờ" value="${estHours}" min="0" step="0.5"
      class="input-field text-sm py-1.5" style="width:70px">
    <button type="button" onclick="removeBulkRow(this)" class="text-gray-300 hover:text-red-400 flex-shrink-0 w-6 h-6 flex items-center justify-center">
      <i class="fas fa-times text-sm"></i>
    </button>
  `
  container.appendChild(div)
  updateBulkCount()
  // Focus first input if it's the first row added manually
  if (title === '') div.querySelector('input[type=text]')?.focus()
}

function removeBulkRow(btn) {
  btn.closest('[data-row-id]')?.remove()
  updateBulkCount()
}

function updateBulkCount() {
  const container = $('bulkSubtaskRows')
  if (!container) return
  const filled = [...container.querySelectorAll('[data-row-id]')]
    .filter(row => row.querySelector('input[type=text]')?.value.trim()).length
  const el = $('bulkSubtaskCount')
  if (el) el.textContent = `${filled} subtask`
}

async function saveBulkSubtasks() {
  const taskId = parseInt($('subtaskTaskId').value)
  const container = $('bulkSubtaskRows')
  if (!container) return

  const rows = [...container.querySelectorAll('[data-row-id]')]
  const subtasks = rows.map(row => {
    const inputs = row.querySelectorAll('input')
    const sel = row.querySelector('select')
    return {
      title:           inputs[0]?.value.trim() || '',
      due_date:        inputs[1]?.value || null,
      priority:        sel?.value || 'medium',
      estimated_hours: parseFloat(inputs[2]?.value) || 0
    }
  }).filter(s => s.title)

  if (!subtasks.length) { toast('Vui lòng nhập ít nhất 1 tên subtask', 'warning'); return }

  try {
    const r = await api(`/tasks/${taskId}/subtasks/bulk`, { method: 'post', data: { subtasks } })
    toast(`Đã thêm ${r.created} subtask`)
    closeModal('subtaskModal')
    await _refreshSubtaskPanelAfterSave(taskId)
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
}

// ── Import Excel ─────────────────────────────────────────────────
let _importedSubtasks = []

function handleSubtaskFileDrop(e) {
  e.preventDefault()
  $('subtaskDropZone').classList.remove('border-primary','bg-primary/5')
  const file = e.dataTransfer.files[0]
  if (file) parseSubtaskExcel(file)
}

function handleSubtaskFileSelect(input) {
  const file = input.files[0]
  if (file) parseSubtaskExcel(file)
  input.value = ''  // reset để có thể chọn lại cùng file
}

function parseSubtaskExcel(file) {
  if (!window.XLSX) { toast('Thư viện đọc Excel chưa sẵn sàng, vui lòng thử lại', 'error'); return }
  const reader = new FileReader()
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

      // Dòng 0 = header (bỏ qua), từ dòng 1 trở đi là data
      const data = rows.slice(1).map(r => ({
        title:           String(r[0] || '').trim(),
        due_date:        parseDateCell(r[1]),
        priority:        normalizePriority(String(r[2] || '')),
        estimated_hours: parseFloat(r[3]) || 0,
        notes:           String(r[4] || '').trim() || null
      })).filter(s => s.title)

      if (!data.length) { toast('Không tìm thấy dữ liệu hợp lệ trong file', 'warning'); return }

      _importedSubtasks = data
      renderImportPreview(data)
    } catch (err) { toast('Lỗi đọc file: ' + err.message, 'error') }
  }
  reader.readAsArrayBuffer(file)
}

function parseDateCell(val) {
  if (!val) return null
  if (val instanceof Date) {
    const y = val.getFullYear(), m = String(val.getMonth()+1).padStart(2,'0'), d = String(val.getDate()).padStart(2,'0')
    return `${y}-${m}-${d}`
  }
  const s = String(val).trim()
  // DD/MM/YYYY
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

function normalizePriority(v) {
  const map = { low:'low', thấp:'low', medium:'medium', 'trung bình':'medium', high:'high', cao:'high' }
  return map[v.toLowerCase()] || 'medium'
}

function renderImportPreview(data) {
  const preview = $('subtaskImportPreview')
  const tbody = $('subtaskImportRows')
  const info = $('subtaskImportInfo')
  const count = $('subtaskImportCount')
  const btn = $('btnImportSubtasks')
  if (!preview || !tbody) return

  const priorityLabel = { low:'Thấp', medium:'Trung bình', high:'Cao' }
  tbody.innerHTML = data.map((s, i) => `
    <tr class="hover:bg-gray-50">
      <td class="px-3 py-1.5 text-gray-400">${i+1}</td>
      <td class="px-3 py-1.5 font-medium text-gray-800">${s.title}</td>
      <td class="px-3 py-1.5 text-gray-500">${s.due_date || '—'}</td>
      <td class="px-3 py-1.5">
        <span class="px-1.5 py-0.5 rounded text-xs font-medium ${
          s.priority==='high' ? 'bg-red-100 text-red-700' :
          s.priority==='low'  ? 'bg-gray-100 text-gray-600' :
                                'bg-yellow-100 text-yellow-700'
        }">${priorityLabel[s.priority]||'Trung bình'}</span>
      </td>
      <td class="px-3 py-1.5 text-gray-500">${s.estimated_hours||'—'}</td>
    </tr>
  `).join('')

  info.textContent = `${data.length} subtask từ file Excel`
  count.textContent = `Sẵn sàng import ${data.length} subtask`
  preview.style.display = ''
  btn.disabled = false

  // Ẩn drop zone
  $('subtaskDropZone').style.display = 'none'
}

function clearSubtaskImport() {
  _importedSubtasks = []
  const preview = $('subtaskImportPreview')
  const dz = $('subtaskDropZone')
  const btn = $('btnImportSubtasks')
  if (preview) preview.style.display = 'none'
  if (dz) dz.style.display = ''
  if (btn) btn.disabled = true
  const count = $('subtaskImportCount')
  if (count) count.textContent = ''
}

async function saveImportedSubtasks() {
  if (!_importedSubtasks.length) { toast('Chưa có dữ liệu để import', 'warning'); return }
  const taskId = parseInt($('subtaskTaskId').value)
  try {
    const r = await api(`/tasks/${taskId}/subtasks/bulk`, { method: 'post', data: { subtasks: _importedSubtasks } })
    toast(`Đã import ${r.created} subtask từ Excel`)
    closeModal('subtaskModal')
    await _refreshSubtaskPanelAfterSave(taskId)
  } catch (e) { toast('Lỗi import: ' + (e.response?.data?.error || e.message), 'error') }
}

// ── Helper: refresh panel sau khi lưu bulk/import ───────────────
async function _refreshSubtaskPanelAfterSave(taskId) {
  // Luôn fetch subtasks mới nhất 1 lần
  const subtasks = await api(`/tasks/${taskId}/subtasks`).catch(() => [])
  const task = allTasks.find(t => t.id === taskId) || {}
  const effForTask = getEffectiveRoleForProject(task.project_id)
  const isAssigned = task.assigned_to === currentUser?.id
  const isAdminOrLeader = ['system_admin','project_admin','project_leader'].includes(effForTask)

  // 1. Refresh inline panel trong task table (nếu đang mở)
  const panel = document.getElementById(`subtask-panel-${taskId}`)
  const containerRow = document.getElementById(`subtask-rows-${taskId}`)
  if (panel && containerRow && containerRow.style.display !== 'none') {
    panel.dataset.loaded = '1'
    renderSubtaskPanel(taskId, subtasks, isAdminOrLeader || isAssigned, isAssigned)
  }

  // 2. Refresh badge/toggle trên task row (dù panel đóng hay mở)
  refreshSubtaskBadge(taskId, subtasks)
  await refreshTaskRowSubtaskCount(taskId)

  // 3. Refresh task detail modal (nếu đang mở) — dùng openTaskDetail để re-render toàn bộ
  if ($('taskDetailModal')?.style.display !== 'none') {
    await openTaskDetail(taskId)
    // Giữ lại tab subtasks đang xem
    switchTaskDetailTab('subtasks')
  }
}

$('subtaskForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('subtaskId').value
  const taskId = parseInt($('subtaskTaskId').value)
  const data = {
    title: $('subtaskTitle').value.trim(),
    status: $('subtaskStatus').value,
    priority: $('subtaskPriority').value,
    due_date: $('subtaskDueDate').value || null,
    estimated_hours: parseFloat($('subtaskEstHours').value) || 0,
    notes: $('subtaskNotes').value.trim() || null
  }
  try {
    if (id) {
      await api(`/subtasks/${id}`, { method: 'put', data })
      toast('Đã cập nhật subtask')
    } else {
      await api(`/tasks/${taskId}/subtasks`, { method: 'post', data })
      toast('Đã thêm subtask')
    }
    closeModal('subtaskModal')
    await _refreshSubtaskPanelAfterSave(taskId)

    // Nếu panel chưa mở → refresh badge/toggle
    const containerRow = document.getElementById(`subtask-rows-${taskId}`)
    if (!containerRow || containerRow.style.display === 'none') {
      await refreshTaskRowSubtaskCount(taskId)
    }

    // Also refresh task detail if it's open
    const detailModal = $('taskDetailModal')
    if (detailModal && detailModal.style.display !== 'none') openTaskDetail(taskId)

    // Nếu đang xem chi tiết dự án → reload lại tiến độ / danh sách task
    if ($('page-project-detail')?.classList.contains('active') && window._currentProjectDetailId) {
      await openProjectDetail(window._currentProjectDetailId)
    }
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
})

// Refresh subtask count in a task row (after first subtask added)
async function refreshTaskRowSubtaskCount(taskId) {
  try {
    const subtasks = await api(`/tasks/${taskId}/subtasks`)
    const t = allTasks.find(x => x.id === taskId)
    if (t) {
      t.subtask_count = subtasks.length
      t.subtask_done_count = subtasks.filter(s => s.status === 'done').length
    }
    // Re-render just the toggle cell
    const mainRow = document.querySelector(`tr.task-main-row[data-task-id="${taskId}"]`)
    if (!mainRow) return
    const toggleCell = mainRow.querySelector('td:first-child')
    if (!toggleCell) return
    const subCount = subtasks.length
    if (subCount > 0) {
      toggleCell.innerHTML = `<button onclick="toggleSubtasks(${taskId}, this)" class="subtask-toggle w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 transition-transform" title="Mở rộng/thu gọn subtask">
        <i class="fas fa-chevron-right text-xs"></i>
      </button>`
    }
    // Update badge
    const subDone = subtasks.filter(s => s.status === 'done').length
    const titleCell = mainRow.querySelector('td:nth-child(2)')
    if (titleCell) {
      const subBadgeColor = subDone === subCount ? '#dcfce7' : '#fef9c3'
      const subTextColor  = subDone === subCount ? '#16a34a' : '#92400e'
      let badge = titleCell.querySelector('.subtask-badge')
      if (!badge && subCount > 0) {
        const badgeContainer = titleCell.querySelector('.flex.items-center.gap-2.mt-0\\.5')
        if (badgeContainer) {
          const span = document.createElement('span')
          span.className = 'subtask-badge inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full'
          span.style.background = subBadgeColor
          span.style.color = subTextColor
          span.innerHTML = `<i class="fas fa-list-check" style="font-size:9px"></i>${subDone}/${subCount}`
          badgeContainer.appendChild(span)
        }
      }
    }
  } catch(_) {}
}

// Keep old toggleSubtaskDone signature for task detail modal (uses string status)
async function toggleSubtaskDoneDetail(subId, currentStatus, taskId) {
  const newStatus = currentStatus === 'done' ? 'in_progress' : 'done'
  try {
    await api(`/subtasks/${subId}`, { method: 'put', data: { status: newStatus } })
    openTaskDetail(taskId)
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

async function deleteSubtask(subId, taskId) {
  showConfirmDelete('Xóa Subtask', 'Bạn có chắc muốn xóa subtask này?', async () => {
    await api(`/subtasks/${subId}`, { method: 'delete' })
    toast('Đã xóa subtask')
    openTaskDetail(taskId)
  })
}

// ================================================================
// TIMESHEET
// ================================================================
// ================================================================
// TIMESHEET FILTER STATE — preserved between loadTimesheets calls
// ================================================================
let _tsDropdownsInitialised = false   // run dropdown population only once per page visit
let _tsMembersCache = []              // cached result from /api/timesheets/members
let _tsProjectsCache = []             // cached result from /api/timesheets/projects

// ── Pagination state ──────────────────────────────────────────────
const TS_PAGE_SIZE = 20               // rows per page
let _tsCurrentPage = 1                // current page (1-based)
let _tsAllData     = []               // full dataset after filter (set by renderTimesheetTable)

function tsPaginatedData() {
  const start = (_tsCurrentPage - 1) * TS_PAGE_SIZE
  return _tsAllData.slice(start, start + TS_PAGE_SIZE)
}

function renderTsPagination() {
  const container = $('tsPagination')
  if (!container) return
  const total = _tsAllData.length
  const totalPages = Math.max(1, Math.ceil(total / TS_PAGE_SIZE))
  if (totalPages <= 1) { container.innerHTML = ''; return }

  const p = _tsCurrentPage
  // Build page buttons (show max 7 around current)
  let pages = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages = [1]
    if (p > 3) pages.push('...')
    for (let i = Math.max(2, p - 1); i <= Math.min(totalPages - 1, p + 1); i++) pages.push(i)
    if (p < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  const btn = (label, page, disabled = false, active = false) =>
    `<button onclick="tsGoPage(${page})" ${disabled ? 'disabled' : ''}
      class="min-w-[32px] h-8 px-2 rounded-lg text-xs font-medium border transition-colors
      ${active ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary'}
      ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}">${label}</button>`

  const from = total === 0 ? 0 : (p - 1) * TS_PAGE_SIZE + 1
  const to   = Math.min(p * TS_PAGE_SIZE, total)

  container.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-gray-100 mt-3">
      <p class="text-xs text-gray-500">Hiển thị <strong>${from}–${to}</strong> / <strong>${total}</strong> bản ghi</p>
      <div class="flex items-center gap-1">
        ${btn('<i class="fas fa-chevron-left"></i>', p - 1, p === 1)}
        ${pages.map(pg => pg === '...'
            ? `<span class="px-1 text-gray-400 text-xs">…</span>`
            : btn(pg, pg, false, pg === p)
          ).join('')}
        ${btn('<i class="fas fa-chevron-right"></i>', p + 1, p === totalPages)}
      </div>
    </div>`
}

function tsGoPage(page) {
  const totalPages = Math.max(1, Math.ceil(_tsAllData.length / TS_PAGE_SIZE))
  _tsCurrentPage = Math.max(1, Math.min(page, totalPages))
  renderTsRows()
  renderTsPagination()
  // Scroll to top of table
  const table = $('timesheetTable')
  if (table) table.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Initialise dropdowns ONCE using /api/timesheets/members & /api/timesheets/projects
async function initTsFilterDropdowns() {
  if (_tsDropdownsInitialised) return
  _tsDropdownsInitialised = true

  const isAdmin     = currentUser.role === 'system_admin'
  const isProjAdmin = currentUser.role === 'project_admin' || currentUser.role === 'project_leader' || isAnyProjectLeaderOrAdmin()
  const canSeeAll   = isAdmin || isProjAdmin

  // ------ Month ------
  const monthSel = $('tsMonthFilter')
  if (monthSel && monthSel.options.length <= 1) {
    const monthNames = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6',
                        'Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12']
    monthNames.forEach((name, i) => {
      const opt = document.createElement('option')
      opt.value = String(i + 1).padStart(2, '0')
      opt.textContent = name
      // Không auto-select tháng hiện tại — để "Tất cả" là default
      monthSel.appendChild(opt)
    })
  }

  // ------ Year ------
  const yearSel = $('tsYearFilter')
  if (yearSel && yearSel.options.length <= 1) {
    await initCalendarYearFilter(yearSel)
    // Sau khi initCalendarYearFilter, đảm bảo option "Tất cả" vẫn đứng đầu
    const allOpt = document.createElement('option')
    allOpt.value = ''; allOpt.textContent = 'Tất cả'
    yearSel.insertBefore(allOpt, yearSel.firstChild)
    // Mặc định chọn năm hiện tại (không phải "Tất cả")
    yearSel.value = String(new Date().getFullYear())
  }

  // ------ Project dropdown — from /api/timesheets/projects ------
  try {
    const savedVal = _cbGetValue('tsProjectFilterCombobox')
    const projects = await api('/timesheets/projects')
    _tsProjectsCache = projects
    if (!allProjects.length) {
      try { allProjects = await api('/projects'); refreshProjectRoleCache() } catch(__) { allProjects = projects }
    }
    const items = projects.map(p => ({ value: String(p.id), label: `${p.code} \u2013 ${p.name} (${p.total_hours || 0}h)` }))
    if ($('tsProjectFilterCombobox')?.querySelector('[id$="_wrap"]')) {
      _cbSetItems('tsProjectFilterCombobox', items, !!items.find(i => i.value === savedVal))
    } else {
      createCombobox('tsProjectFilterCombobox', {
        placeholder: 'T\u1ea5t c\u1ea3 d\u1ef1 \u00e1n',
        items,
        value: savedVal || '',
        fullWidth: true,
        onchange: () => loadTimesheets()
      })
    }
  } catch (_) {
    if (!allProjects.length) { try { allProjects = await api('/projects') } catch(__) {} }
    const cbEl = $('tsProjectFilterCombobox')
    if (cbEl && !cbEl.querySelector('[id$="_wrap"]')) {
      createCombobox('tsProjectFilterCombobox', {
        placeholder: 'T\u1ea5t c\u1ea3 d\u1ef1 \u00e1n',
        items: allProjects.map(p => ({ value: String(p.id), label: `${p.code} \u2013 ${p.name}` })),
        value: '',
        fullWidth: true,
        onchange: () => loadTimesheets()
      })
    }
  } // end catch

  // ------ Member dropdown — from /api/timesheets/members (admin/projAdmin only) ------
  const tsUserWrap = $('tsUserFilterWrap')
  const tsStatusW  = $('tsStatusFilterWrap')

  if (canSeeAll && tsUserWrap) {
    tsUserWrap.classList.remove('hidden'); tsUserWrap.classList.add('flex')
    try {
      const savedUserId = _cbGetValue('tsUserFilterCombobox')
      const members = await api('/timesheets/members')
      _tsMembersCache = members
      // Không backfill allUsers bằng /timesheets/members vì chỉ chứa user có timesheet
      // allUsers phải được fetch riêng từ /users khi cần (xem openTimesheetModal)
      const membersForFilter = isAdmin ? members : members.filter(m => m.role !== 'system_admin')
      const items = membersForFilter.map(m => ({
        value: String(m.id),
        label: `${m.full_name}${m.total_hours ? ' (' + m.total_hours + 'h)' : ''}`
      }))
      if ($('tsUserFilterCombobox')?.querySelector('[id$="_wrap"]')) {
        _cbSetItems('tsUserFilterCombobox', items, !!items.find(i => i.value === savedUserId))
      } else {
        createCombobox('tsUserFilterCombobox', {
          placeholder: '👤 Tất cả nhân viên',
          items,
          value: savedUserId || '',
          fullWidth: true,
          onchange: () => loadTimesheets()
        })
      }
    } catch (_) {
      if (!allUsers.length) { try { allUsers = await api('/users') } catch(__) {} }
      const usersForFilter = isAdmin ? allUsers : allUsers.filter(u => u.role !== 'system_admin')
      const items = usersForFilter.map(u => ({ value: String(u.id), label: u.full_name }))
      const cbEl = $('tsUserFilterCombobox')
      if (cbEl && !cbEl.querySelector('[id$="_wrap"]')) {
        createCombobox('tsUserFilterCombobox', {
          placeholder: '👤 Tất cả nhân viên',
          items,
          value: '',
          fullWidth: true,
          onchange: () => loadTimesheets()
        })
      }
    }
    if (tsStatusW) { tsStatusW.classList.remove('hidden'); tsStatusW.classList.add('flex') }
  } else {
    if (tsUserWrap) { tsUserWrap.classList.add('hidden'); tsUserWrap.classList.remove('flex') }
    if (tsStatusW)  { tsStatusW.classList.add('hidden');  tsStatusW.classList.remove('flex') }
  }
}

// ================================================================
// loadTimesheets — fetch data + render; does NOT rebuild dropdowns
// ================================================================
async function loadTimesheets() {
  try {
    const isAdmin     = currentUser.role === 'system_admin'
    const isProjAdmin = currentUser.role === 'project_admin' || currentUser.role === 'project_leader' || isAnyProjectLeaderOrAdmin()
    const canSeeAll   = isAdmin || isProjAdmin

    // Subtitle
    const subtitle = $('tsPageSubtitle')
    if (subtitle) {
      if (isAdmin)          subtitle.textContent = 'Xem toàn bộ timesheet tất cả thành viên, tất cả dự án'
      else if (isProjAdmin) subtitle.textContent = 'Xem & duyệt timesheet của các thành viên trong dự án bạn quản lý'
      else                  subtitle.textContent = 'Timesheet cá nhân của bạn'
    }

    // Show/hide cleanup button
    const cleanupBtn = $('tsCleanupBtn')
    if (cleanupBtn) cleanupBtn.classList.toggle('hidden', !isAdmin)

    // Show/hide bulk import button (chỉ system_admin)
    const bulkImportBtn = $('tsBulkImportBtn')
    if (bulkImportBtn) bulkImportBtn.classList.toggle('hidden', !isAdmin)

    // Populate dropdowns only on first load of this page
    await initTsFilterDropdowns()

    // ------ Read current filter values ------
    const month     = $('tsMonthFilter')?.value   || ''
    const year      = $('tsYearFilter')?.value    || ''
    const projectId = _cbGetValue('tsProjectFilterCombobox')
    const memberId  = canSeeAll ? (_cbGetValue('tsUserFilterCombobox') || '') : ''
    const status    = canSeeAll ? ($('tsStatusFilter')?.value || '') : ''

    // Build API URL
    let url = '/timesheets?'
    if (month)     url += `month=${month}&`
    if (year)      url += `year=${year}&`
    if (projectId) url += `project_id=${projectId}&`
    if (memberId)  url += `member_id=${memberId}&`
    if (status)    url += `status=${status}&`

    const resp = await api(url)
    allTimesheets = Array.isArray(resp) ? resp : (resp.timesheets || [])
    const apiSummary = (!Array.isArray(resp) && resp.summary) ? resp.summary : null

    renderTimesheetTable(allTimesheets, apiSummary)

    // ------ Summary KPI cards ------
    const pending  = allTimesheets.filter(t => t.status === 'submitted').length
    const approved = allTimesheets.filter(t => t.status === 'approved').length
    // Đếm ngày nghỉ: full leave = 1 ngày, half_day = 0.5 ngày
    const leaveDays = allTimesheets.reduce((sum, t) => {
      if (!t.day_type || t.day_type === 'work' || t.day_type === 'business_trip') return sum
      if (t.day_type === 'half_day_am' || t.day_type === 'half_day_pm') return sum + 0.5
      return sum + 1  // annual_leave, sick_leave, holiday, etc.
    }, 0)
    const totalReg = apiSummary ? (apiSummary.total_regular_hours || 0)
                                : allTimesheets.reduce((s, t) => s + (t.regular_hours  || 0), 0)
    const totalOT  = apiSummary ? (apiSummary.total_overtime_hours || 0)
                                : allTimesheets.reduce((s, t) => s + (t.overtime_hours || 0), 0)
    const totalH   = apiSummary ? (apiSummary.total_hours || 0) : totalReg + totalOT

    if ($('tsCardTotal'))       $('tsCardTotal').textContent       = allTimesheets.length
    if ($('tsCardLeave'))       $('tsCardLeave').textContent       = leaveDays
    if ($('tsCardPending'))     $('tsCardPending').textContent     = pending
    if ($('tsCardApproved'))    $('tsCardApproved').textContent    = approved
    if ($('tsCardHours'))       $('tsCardHours').textContent       = totalH + 'h'
    if ($('tsCardHoursDetail')) $('tsCardHoursDetail').textContent = `HC: ${totalReg}h | OT: ${totalOT}h`
    if ($('tsFilterCount'))     $('tsFilterCount').textContent     = allTimesheets.length

    // Bulk-approve button — chỉ hiện với system_admin và project_admin
    const bulkBtn = $('tsBulkApproveBtn')
    if (bulkBtn) {
      if (canApproveTimesheet() && pending > 0) {
        bulkBtn.classList.remove('hidden')
        bulkBtn.innerHTML = `<i class="fas fa-check-double mr-1"></i>Duyệt tất cả (${pending})`
      } else {
        bulkBtn.classList.add('hidden')
      }
    }

    // ------ Breakdown panel (admin / project_admin) ------
    const dashPanel = $('tsDashboardPanel')
    if (dashPanel) {
      if (canSeeAll) {
        dashPanel.classList.remove('hidden')

        // Aggregate from the already-filtered allTimesheets
        const memberMap = {}
        const projMap   = {}

        allTimesheets.forEach(t => {
          const mk = String(t.user_id)
          if (!memberMap[mk]) memberMap[mk] = {
            user_id: t.user_id,
            full_name: t.user_name || '?', department: t.department || '',
            regular_hours: 0, overtime_hours: 0, total_hours: 0
          }
          memberMap[mk].regular_hours  += (t.regular_hours  || 0)
          memberMap[mk].overtime_hours += (t.overtime_hours || 0)
          memberMap[mk].total_hours    += (t.regular_hours  || 0) + (t.overtime_hours || 0)

          const pk = String(t.project_id)
          // Skip orphaned timesheets (project has been deleted — no project_code/name)
          if (!t.project_code && !t.project_name) return
          if (!projMap[pk]) projMap[pk] = {
            project_id: t.project_id,
            code: t.project_code || '?', name: t.project_name || '?',
            total_hours: 0, member_ids: new Set()
          }
          projMap[pk].total_hours += (t.regular_hours || 0) + (t.overtime_hours || 0)
          projMap[pk].member_ids.add(t.user_id)
        })

        const byMember  = Object.values(memberMap).sort((a, b) => b.total_hours - a.total_hours)
        const byProject = Object.values(projMap)
          .sort((a, b) => b.total_hours - a.total_hours)
          .map(p => ({ ...p, member_count: p.member_ids.size }))

        // -- member breakdown --
        const memberDiv = $('tsMemberBreakdown')
        if (memberDiv) {
          const proj = allProjects.find(p => String(p.id) === projectId) ||
                       _tsProjectsCache.find(p => String(p.id) === projectId)
          const lbl  = proj ? `<p class="text-xs text-blue-500 mb-2">📋 Dự án: ${proj.code}</p>` : ''
          memberDiv.innerHTML = byMember.length
            ? lbl + byMember.map(m => `
              <div class="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 rounded px-1 cursor-pointer"
                   onclick="filterTsByMember('${m.user_id}')">
                <div class="flex items-center gap-2">
                  <div class="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">${(m.full_name||'?').split(' ').pop()?.charAt(0)}</div>
                  <div>
                    <span class="font-medium text-gray-700 text-xs">${m.full_name}</span>
                    <span class="text-gray-400 text-xs ml-1">${m.department}</span>
                  </div>
                </div>
                <div class="text-right text-xs">
                  <span class="font-bold text-primary">${m.total_hours}h</span>
                  <span class="text-gray-400 ml-1">(${m.regular_hours}h + OT:${m.overtime_hours}h)</span>
                </div>
              </div>`).join('')
            : '<p class="text-gray-400 text-center py-4 text-xs">Không có dữ liệu</p>'
        }

        // -- project breakdown --
        const projDiv = $('tsProjectBreakdown')
        if (projDiv) {
          const memUser = (_tsMembersCache.length ? _tsMembersCache : allUsers).find(u => String(u.id) === memberId)
          const lbl = memUser ? `<p class="text-xs text-blue-500 mb-2">👤 Nhân viên: ${memUser.full_name}</p>` : ''
          projDiv.innerHTML = byProject.length
            ? lbl + byProject.map(p => `
              <div style="padding:7px 4px;border-bottom:1px solid #f3f4f6;cursor:pointer"
                   class="hover:bg-gray-50 rounded last:border-0"
                   onclick="filterTsByProject('${p.project_id}')">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0">
                  <span class="font-semibold text-gray-800 text-xs whitespace-nowrap flex-shrink-0"
                        style="background:#f0fdf4;color:#166534;padding:1px 6px;border-radius:4px;font-family:monospace;letter-spacing:0.02em"
                        title="${p.code}">${p.code}</span>
                  <div class="text-right text-xs whitespace-nowrap flex-shrink-0">
                    <span class="font-bold text-accent">${p.total_hours}h</span>
                    <span class="text-gray-400 ml-1">${p.member_count} người</span>
                  </div>
                </div>
                <div class="text-gray-500 text-xs mt-0.5 truncate" title="${p.name}"
                     style="padding-left:2px;max-width:100%">${p.name}</div>
              </div>`).join('')
            : '<p class="text-gray-400 text-center py-4 text-xs">Không có dữ liệu</p>'
        }

        // Duplicate check (cheap — only when no filter active)
        if (!projectId && !memberId) {
          try {
            const dupCheck = await api('/timesheets/cleanup-duplicates')
            const dc = dupCheck.duplicate_groups || 0
            const dupWarn = $('tsDupWarning'); const dupTxt = $('tsDupWarningText')
            const dupSt   = $('tsDupStatus');  const dupStTxt = $('tsDupStatusText')
            if (dc > 0) {
              if (dupWarn) dupWarn.classList.remove('hidden')
              if (dupTxt)  dupTxt.textContent = `⚠️ Phát hiện ${dc} nhóm timesheet trùng lặp!`
              if (dupSt)   dupSt.classList.remove('hidden')
              if (dupStTxt) dupStTxt.textContent = `${dc} nhóm trùng lặp`
            } else {
              if (dupWarn) dupWarn.classList.add('hidden')
              if (dupSt)   dupSt.classList.add('hidden')
            }

            // Orphan check — timesheets with deleted project/user
            try {
              const orphanCheck = await api('/timesheets/cleanup-orphans')
              const orphanCount = orphanCheck.total_orphans || 0
              if (orphanCount > 0) {
                // Auto-cleanup silently
                const cleaned = await api('/timesheets/cleanup-orphans', { method: 'post', data: {} })
                if (cleaned.deleted > 0) {
                  loadTimesheets()  // reload after cleanup
                }
              }
            } catch (_) { /* silent */ }
          } catch (_) { /* silent */ }
        }
      } else {
        dashPanel.classList.add('hidden')
      }
    }

    // Empty state
    const emptyState = $('tsEmptyState')
    if (emptyState) emptyState.classList.toggle('hidden', allTimesheets.length > 0)

  } catch (e) { toast('Lỗi tải timesheet: ' + e.message, 'error') }
}

// Convenience: click a row in the breakdown to quick-filter by that member/project
function filterTsByMember(userId) {
  if (!_cbState['tsUserFilterCombobox']) return
  const item = _cbState['tsUserFilterCombobox'].items.find(i => String(i.value) === String(userId))
  if (item) { _cbSelect('tsUserFilterCombobox', item.value, item.label); loadTimesheets() }
}
function filterTsByProject(projectId) {
  const cbEl = $('tsProjectFilterCombobox')
  if (!cbEl) return
  if (_cbState['tsProjectFilterCombobox']) {
    const item = _cbState['tsProjectFilterCombobox'].items.find(i => String(i.value) === String(projectId))
    if (item) {
      _cbSelect('tsProjectFilterCombobox', String(projectId), item.label)
    }
  }
}

// When navigating away (page change), reset init flag so dropdowns reload
function resetTsPageState() {
  _tsDropdownsInitialised = false
  _tsMembersCache = []
  _tsProjectsCache = []
}

// Cleanup duplicate timesheets (admin only)
async function runTimesheetCleanup() {
  if (!confirm('Xác nhận xóa tất cả timesheet trùng lặp? (Giữ bản ghi mới nhất cho mỗi nhóm)')) return
  try {
    const result = await api('/timesheets/cleanup-duplicates', { method: 'POST' })
    if (result.rows_deleted > 0) {
      toast(`✅ Đã xóa ${result.rows_deleted} bản ghi trùng lặp. Còn lại: ${result.after_count} bản ghi.`, 'success')
    } else {
      toast('✅ Không có bản ghi trùng lặp. Dữ liệu sạch!', 'success')
    }
    const dupWarn = $('tsDupWarning'); if (dupWarn) dupWarn.classList.add('hidden')
    const dupStatus = $('tsDupStatus'); if (dupStatus) dupStatus.classList.add('hidden')
    loadTimesheets()
  } catch(e) { toast('Lỗi dọn dẹp: ' + e.message, 'error') }
}

function resetTimesheetFilters() {
  // Reset filter dropdowns to defaults
  const now = new Date()
  const m = $('tsMonthFilter'); if (m) m.value = String(now.getMonth() + 1).padStart(2, '0')
  const y = $('tsYearFilter');  if (y) y.value  = String(now.getFullYear())
  const p = $('tsProjectFilterCombobox'); if (p && _cbState['tsProjectFilterCombobox']) { _cbSelect('tsProjectFilterCombobox', '', 'Tất cả dự án') }
  if (_cbState['tsUserFilterCombobox']) _cbSelect('tsUserFilterCombobox', '', '👤 Tất cả nhân viên')
  const s = $('tsStatusFilter');  if (s) s.value = ''
  // Force re-populate dropdowns with latest data on next load
  _tsDropdownsInitialised = false
  loadTimesheets()
}

function exportTimesheetExcel() {
  if (!allTimesheets.length) { toast('Không có dữ liệu để xuất', 'warning'); return }
  const isAdmin     = currentUser.role === 'system_admin'
  const isProjAdmin = currentUser.role === 'project_admin' || currentUser.role === 'project_leader' || isAnyProjectLeaderOrAdmin()
  const canSeeAll   = isAdmin || isProjAdmin
  const statusLabels = { draft: 'Nháp', submitted: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' }

  // Build CSV rows
  const headers = ['Ngày', canSeeAll ? 'Nhân viên' : '', 'Dự án', 'Task', 'Hạng mục', 'Giờ HC', 'Tăng ca', 'Tổng giờ', 'Mô tả', 'Trạng thái'].filter(Boolean)
  const rows = allTimesheets.map(t => {
    const catLabel = t.category_name ? (t.category_code ? t.category_code + ' – ' + t.category_name : t.category_name) : ''
    const base = [t.work_date, t.project_code || '', t.task_title || '', catLabel, t.regular_hours, t.overtime_hours, (t.regular_hours + t.overtime_hours), (t.description || '').replace(/"/g, '""'), statusLabels[t.status] || t.status]
    return canSeeAll ? [t.work_date, t.user_name || '', t.project_code || '', t.task_title || '', catLabel, t.regular_hours, t.overtime_hours, (t.regular_hours + t.overtime_hours), (t.description || '').replace(/"/g, '""'), statusLabels[t.status] || t.status] : base
  })

  // Totals row
  let totalReg = 0, totalOT = 0
  allTimesheets.forEach(t => { totalReg += t.regular_hours || 0; totalOT += t.overtime_hours || 0 })
  const totalRow = canSeeAll
    ? ['TỔNG CỘNG', '', '', '', '', totalReg, totalOT, totalReg + totalOT, '', '']
    : ['TỔNG CỘNG', '', '', '', totalReg, totalOT, totalReg + totalOT, '', '']

  const csvLines = [headers, ...rows, totalRow].map(r => r.map(v => `"${v}"`).join(','))
  const csvContent = '\uFEFF' + csvLines.join('\n') // BOM for Excel UTF-8

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  const month = $('tsMonthFilter')?.value || ''
  const year  = $('tsYearFilter')?.value  || new Date().getFullYear()
  a.href = url; a.download = `timesheet_${year}_${month}.csv`
  a.click(); URL.revokeObjectURL(url)
  toast('Xuất Excel thành công', 'success')
}

function renderTimesheetTable(timesheets, apiSummary = null) {
  const tbody = $('timesheetTable')
  if (!tbody) return

  const isAdmin     = currentUser.role === 'system_admin'
  const isProjAdmin = currentUser.role === 'project_admin' || currentUser.role === 'project_leader' || isAnyProjectLeaderOrAdmin()
  const canSeeAll   = isAdmin || isProjAdmin
  const canApprove  = canApproveTimesheet()

  // Save full dataset for pagination, reset to page 1 on new data load
  _tsAllData     = timesheets
  _tsCurrentPage = 1

  // Use API summary if available (avoids JS re-sum from potentially stale allTimesheets)
  let totalReg, totalOT
  if (apiSummary) {
    totalReg = apiSummary.total_regular_hours || 0
    totalOT  = apiSummary.total_overtime_hours || 0
  } else {
    totalReg = 0; totalOT = 0
    timesheets.forEach(t => { totalReg += t.regular_hours || 0; totalOT += t.overtime_hours || 0 })
  }
  $('tsTotalRegular').textContent  = totalReg + 'h'
  $('tsTotalOvertime').textContent = totalOT + 'h'
  $('tsTotalHours').textContent    = (totalReg + totalOT) + 'h'
  // Update leave count in filter summary
  const filterLeaveEl = document.getElementById('tsFilterLeave')
  // Đếm ngày nghỉ: full leave = 1 ngày, half_day = 0.5 ngày
  if (filterLeaveEl) {
    const leaveCount = timesheets.reduce((sum, t) => {
      if (!t.day_type || t.day_type === 'work' || t.day_type === 'business_trip') return sum
      if (t.day_type === 'half_day_am' || t.day_type === 'half_day_pm') return sum + 0.5
      return sum + 1
    }, 0)
    filterLeaveEl.textContent = leaveCount
  }

  // Ẩn/hiện cột "Nhân viên"
  document.querySelectorAll('.ts-col-user').forEach(el => {
    el.style.display = canSeeAll ? '' : 'none'
  })

  // Render current page rows + pagination
  renderTsRows()
  renderTsPagination()
}

// ── Render chỉ rows của trang hiện tại ──────────────────────────────────────
function renderTsRows() {
  const tbody = $('timesheetTable')
  if (!tbody) return

  const isAdmin     = currentUser.role === 'system_admin'
  const isProjAdmin = currentUser.role === 'project_admin' || currentUser.role === 'project_leader' || isAnyProjectLeaderOrAdmin()
  const canSeeAll   = isAdmin || isProjAdmin
  const canApprove  = canApproveTimesheet()

  const statusColors  = { draft: 'badge-todo', submitted: 'badge-review', approved: 'badge-completed', rejected: 'badge-overdue' }
  const statusLabels  = { draft: 'Nháp', submitted: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' }
  const dayTypeInfo   = {
    work:         { label: 'Làm việc',      cls: 'bg-blue-50 text-blue-700',   icon: '🏢' },
    half_day_am:  { label: 'Nghỉ ½ sáng',  cls: 'bg-sky-50 text-sky-700',     icon: '🌅' },
    half_day_pm:  { label: 'Nghỉ ½ chiều', cls: 'bg-sky-50 text-sky-700',     icon: '🌆' },
    annual_leave: { label: 'Phép năm',      cls: 'bg-green-50 text-green-700', icon: '🌴' },
    unpaid_leave: { label: 'KLương',        cls: 'bg-red-50 text-red-700',     icon: '💸' },
    holiday:      { label: 'Nghỉ lễ',      cls: 'bg-purple-50 text-purple-700',icon: '🎉' },
    sick_leave:   { label: 'Nghỉ ốm',      cls: 'bg-orange-50 text-orange-700',icon: '🤒' },
    compensatory: { label: 'Nghỉ bù',      cls: 'bg-amber-50 text-amber-700',  icon: '🔄' },
    business_trip: { label: 'Đi công tác',  cls: 'bg-indigo-50 text-indigo-700', icon: '✈️' },
  }
  const emptyColspan  = canSeeAll ? 11 : 10

  const pageData = tsPaginatedData()

  if (_tsAllData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${emptyColspan}" class="text-center py-8 text-gray-400">
      <i class="fas fa-clock text-3xl mb-2 block"></i>
      ${canSeeAll ? 'Không có timesheet nào trong khoảng thời gian này' : 'Bạn chưa có timesheet nào. Nhấn "+ Thêm timesheet" để bắt đầu.'}
    </td></tr>`
    return
  }

  tbody.innerHTML = pageData.map(t => {
    const isOwner   = t.user_id === currentUser.id
    const isDraft   = t.status === 'draft'
    const isRejected = t.status === 'rejected'
    const isSubmitted = t.status === 'submitted'

    const canEdit      = isAdmin || isProjAdmin || (isOwner && (isDraft || isRejected))
    const canDelete    = isAdmin || isProjAdmin || (isOwner && (isDraft || isRejected))
    const canSubmit    = isOwner && (isDraft || isRejected)
    const canApproveBt = canApprove && isSubmitted
    const canRejectBt  = canApprove && isSubmitted

    const dt   = dayTypeInfo[t.day_type || 'work'] || dayTypeInfo.work
    // Full leave = no project/hours; half_day = has project/hours, just highlight differently
    const isFullLeaveRow = !['work','half_day_am','half_day_pm','business_trip'].includes(t.day_type || 'work')
    const isHalfDayRow   = t.day_type === 'half_day_am' || t.day_type === 'half_day_pm'
    const isLeaveRow     = isFullLeaveRow  // backward compat variable (row highlight)
    // Multi-task: task_entries array with > 0 items
    const hasMultiTask   = Array.isArray(t.task_entries) && t.task_entries.length > 0
    // Build task cell content
    let taskCellContent
    if (isFullLeaveRow) {
      taskCellContent = '<span class="text-gray-300">—</span>'
    } else if (hasMultiTask) {
      const taskNames = t.task_entries.map(e => e.task_title || `Task #${e.task_id || '?'}`).join(', ')
      taskCellContent = `<span class="text-indigo-600 font-medium text-xs" title="${taskNames}">📋 ${t.task_entries.length} task</span>`
    } else {
      taskCellContent = `<span class="max-w-28 truncate block" title="${t.task_title||''}">${t.task_title || '-'}</span>`
    }

    return `
    <tr class="table-row ${isFullLeaveRow ? 'bg-amber-50/40' : (isHalfDayRow ? 'bg-sky-50/30' : (isOwner && !canSeeAll ? 'bg-green-50/30' : ''))}">
      <td class="py-2 pr-3 text-sm font-medium">${fmtDate(t.work_date)}</td>
      <td class="py-2 pr-3 text-sm ts-col-user" style="display:${canSeeAll ? '' : 'none'}">
        <div class="flex items-center gap-1.5">
          <div class="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">${(t.user_name||'?').split(' ').pop()?.charAt(0)}</div>
          <span>${t.user_name || '-'}</span>
        </div>
      </td>
      <td class="py-2 pr-3">
        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${dt.cls}" title="${dt.label}">${dt.icon} ${dt.label}</span>
      </td>
      <td class="py-2 pr-3 text-sm text-gray-600">${isFullLeaveRow ? '<span class="text-gray-300">—</span>' : (t.project_code || '-')}</td>
      <td class="py-2 pr-3 text-xs text-gray-600">${(() => {
        if (isFullLeaveRow) return '<span class="text-gray-300">—</span>'
        // Multi-task: gom danh sách hạng mục duy nhất từ task_entries
        if (hasMultiTask && t.task_entries.length > 0) {
          const seen = new Set()
          const badges = []
          for (const e of t.task_entries) {
            if (!e.category_id || seen.has(e.category_id)) continue
            seen.add(e.category_id)
            const lbl = e.category_code ? `${e.category_code}` : (e.category_name || '')
            const title = e.category_code ? `${e.category_code} – ${e.category_name}` : (e.category_name || '')
            badges.push(`<span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap" title="${title}">${lbl}</span>`)
          }
          return badges.length ? `<div class="flex flex-wrap gap-0.5">${badges.join('')}</div>` : '<span class="text-gray-300">—</span>'
        }
        // Single-task: dùng category_name của timesheet
        if (!t.category_name) return '<span class="text-gray-300">—</span>'
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 max-w-36 truncate" title="${t.category_name}">${t.category_code ? t.category_code + ' – ' : ''}${t.category_name}</span>`
      })()}</td>
      <td class="py-2 pr-3 text-xs text-gray-500">${taskCellContent}</td>
      <td class="py-2 pr-3 text-center font-medium text-primary">${isFullLeaveRow ? '<span class="text-gray-400">0h</span>' : t.regular_hours + 'h'}</td>
      <td class="py-2 pr-3 text-center font-medium text-orange-500">${isFullLeaveRow ? '<span class="text-gray-300">—</span>' : (t.overtime_hours > 0 ? t.overtime_hours + 'h' : '-')}</td>
      <td class="py-2 pr-3 text-center font-bold text-gray-700">${isFullLeaveRow ? '<span class="text-gray-400">0h</span>' : (t.regular_hours + t.overtime_hours) + 'h'}</td>
      <td class="py-2 pr-3 text-xs text-gray-500 max-w-32 truncate" title="${t.description||''}">${t.description || '-'}</td>
      <td class="py-2 pr-3"><span class="badge ${statusColors[t.status] || 'badge-todo'}">${statusLabels[t.status] || t.status}</span></td>
      <td class="py-2">
        <div class="flex gap-1 flex-wrap">
          ${canSubmit    ? `<button onclick="submitTimesheet(${t.id})" class="btn-secondary text-xs px-2 py-1 text-blue-600 border-blue-300" title="Gửi duyệt"><i class="fas fa-paper-plane"></i></button>` : ''}
          ${canEdit      ? `<button onclick="openTimesheetModal(${t.id})" class="btn-secondary text-xs px-2 py-1" title="Sửa"><i class="fas fa-edit"></i></button>` : ''}
          ${canApproveBt ? `<button onclick="approveTimesheet(${t.id})" class="btn-primary text-xs px-2 py-1" title="Duyệt"><i class="fas fa-check"></i></button>` : ''}
          ${canRejectBt  ? `<button onclick="rejectTimesheet(${t.id})" class="text-red-400 hover:text-red-600 border border-red-200 rounded px-2 py-1 text-xs" title="Từ chối"><i class="fas fa-times"></i></button>` : ''}
          ${canDelete    ? `<button onclick="deleteTimesheet(${t.id})" class="text-red-400 hover:text-red-600 px-1.5 text-sm" title="Xóa"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </td>
    </tr>`
  }).join('')
}

// ── Biến lưu trạng thái locked hiện tại của modal ────────────────────────────
let _tsModalLocked = false

// Token để huỷ load task cũ khi user đổi project liên tiếp nhanh
let _tsProjChangeToken = 0

// ── Khởi tạo combobox Dự án trong modal Timesheet ───────────────────────────
function _initTsProjectCombobox(selectedProjId = '', locked = false) {
  _tsModalLocked = locked   // lưu lại để closure onchange dùng đúng

  // Build items từ allProjects; nếu project hiện tại không có trong list
  // (ví dụ user bị remove khỏi project) → thêm tạm để hiển thị đúng label
  let projItems = allProjects.map(p => ({
    value: String(p.id),
    label: `${p.code} – ${p.name}`
  }))
  if (selectedProjId && !projItems.find(i => i.value === String(selectedProjId))) {
    projItems = [{ value: String(selectedProjId), label: `Dự án #${selectedProjId}` }, ...projItems]
  }

  createCombobox('tsProjectCombobox', {
    placeholder: '🔍 Tìm & chọn dự án...',
    items: projItems,
    value: selectedProjId ? String(selectedProjId) : '',
    fullWidth: true,
    onchange: async (val) => {
      // Cập nhật hidden input ngay lập tức
      $('tsProjectHidden').value = val || ''
      // Reset task + category hidden input khi đổi project
      $('tsTaskHidden').value = ''
      if ($('tsCategoryHidden')) $('tsCategoryHidden').value = ''
      // Ẩn badge hạng mục của đơn task
      const _badge = document.getElementById('tsTaskCategoryBadge')
      if (_badge) _badge.style.display = 'none'

      // Dùng token để tránh race condition khi user đổi project liên tiếp
      const token = ++_tsProjChangeToken

      // Reset task combobox về trống ngay
      _initTsTaskCombobox([], null, _tsModalLocked)

      // Load hạng mục dự án
      await _loadTsCategories(val || null, null, _tsModalLocked)

      // Load tasks cho project mới (sẽ được lọc lại khi chọn category)
      if (val) await _loadAndInitTsTaskCombobox(val, null, _tsModalLocked, token)
    }
  })

  // Disable trigger nếu locked
  const wrap = $('tsProjectCombobox_wrap')
  if (wrap) {
    wrap.style.pointerEvents = locked ? 'none' : ''
    wrap.style.opacity       = locked ? '0.6'  : ''
  }

  $('tsProjectHidden').value = selectedProjId ? String(selectedProjId) : ''
}

// ── Load hạng mục HSPL theo dự án cho modal Timesheet ───────────────────────
// ── Load hạng mục dự án theo project cho modal Timesheet ────────────────────
let _tsCachedCategories = []

async function _loadTsCategories(projectId, selectedCatId = null, locked = false) {
  const row = $('tsCategoryRow')
  const hiddenInput = $('tsCategoryHidden')
  if (!row) return

  // Reset hidden value khi đổi project
  if (hiddenInput) hiddenInput.value = ''
  _tsCachedCategories = []

  if (!projectId) {
    row.style.display = 'none'
    _initTsCategoryCombobox([], null, locked)
    return
  }

  // Hiện row với trạng thái đang tải
  row.style.display = ''
  _initTsCategoryCombobox([], selectedCatId, locked, true) // loading state

  try {
    const cats = await api(`/projects/${projectId}/categories`)
    _tsCachedCategories = Array.isArray(cats) ? cats : []

    if (_tsCachedCategories.length === 0) {
      row.style.display = 'none'
      _initTsCategoryCombobox([], null, locked)
    } else {
      row.style.display = ''
      _initTsCategoryCombobox(_tsCachedCategories, selectedCatId, locked)
    }
  } catch (_) {
    row.style.display = 'none'
    _initTsCategoryCombobox([], null, locked)
  }
}

function _initTsCategoryCombobox(cats = [], selectedId = null, locked = false, loading = false) {
  const hiddenInput = $('tsCategoryHidden')

  if (_cbState['tsCategoryCombobox']) delete _cbState['tsCategoryCombobox']

  if (loading) {
    createCombobox('tsCategoryCombobox', {
      placeholder: '⏳ Đang tải hạng mục...',
      items: [],
      fullWidth: true
    })
    return
  }

  const items = cats.map(c => ({
    value: String(c.id),
    label: c.code ? `${c.code} – ${c.name}` : c.name
  }))

  createCombobox('tsCategoryCombobox', {
    placeholder: '— Tất cả hạng mục —',
    items,
    value: selectedId ? String(selectedId) : '',
    fullWidth: true,
    teleport: true,
    panelMaxWidth: '420px',
    dropdownMaxHeight: '280px',
    onchange: (val) => {
      if (hiddenInput) hiddenInput.value = val || ''
      // Lọc lại task combobox theo hạng mục được chọn
      const catId = val ? parseInt(val) : null
      const filteredTasks = catId
        ? _tsCachedTasks.filter(t => t.category_id === catId)
        : _tsCachedTasks
      _initTsTaskCombobox(filteredTasks, null, locked)
      $('tsTaskHidden').value = ''
      // Reset badge hạng mục đơn task
      const _badge = document.getElementById('tsTaskCategoryBadge')
      if (_badge) _badge.style.display = 'none'
      // Sync lock state ngay sau khi chọn/bỏ chọn hạng mục
      _tsSyncTaskLockState()
      // Re-render multi rows để cập nhật lock state
      _tsRenderMultiRows()
    }
  })

  if (hiddenInput && selectedId) hiddenInput.value = String(selectedId)

  // Disable nếu locked
  const wrapEl = document.getElementById('tsCategoryCombobox')
  const wrap = wrapEl ? wrapEl.querySelector('[id$="_wrap"]') : null
  if (wrap) {
    wrap.style.pointerEvents = locked ? 'none' : ''
    wrap.style.opacity = locked ? '0.6' : ''
  }
}

// ── Helper: build task items với prefix hạng mục để tránh nhầm tên ──────────
function _buildTsTaskItems(tasks, selId = '') {
  const icons = { todo: '⬜', in_progress: '🔵', review: '🟡', completed: '✅', cancelled: '❌' }
  return tasks
    .filter(t => !['completed', 'cancelled'].includes(t.status) || String(t.id) === selId)
    .map(t => {
      const icon = icons[t.status] || '⬜'
      const disc = t.discipline_code ? ` [${t.discipline_code}]` : ''
      // Tìm hạng mục từ _tsCachedCategories
      const cat = t.category_id ? _tsCachedCategories.find(c => c.id === t.category_id) : null
      const catPrefix = cat
        ? `[${cat.code || cat.name.slice(0, 8)}] `
        : ''
      return { value: String(t.id), label: `${icon}${disc} ${catPrefix}${t.title}` }
    })
}

// ── Kiểm tra và đồng bộ trạng thái lock của task combobox theo hạng mục ──
// Khi chưa chọn hạng mục → task phải bị khóa
function _tsSyncTaskLockState() {
  const hasCats   = _tsCachedCategories.length > 0
  const catChosen = !!(parseInt($('tsCategoryHidden')?.value) || null)
  // Nếu dự án có hạng mục và chưa chọn hạng mục → lock
  const shouldLockTask = hasCats && !catChosen
  // Đơn task
  const wrap = $('tsTaskCombobox_wrap')
  if (wrap) {
    wrap.style.pointerEvents = shouldLockTask ? 'none' : ''
    wrap.style.opacity       = shouldLockTask ? '0.45' : ''
    wrap.title = shouldLockTask ? 'Vui lòng chọn hạng mục trước' : ''
  }
  // Gợi ý cho user
  const hint = document.getElementById('tsTaskLockHint')
  if (hint) hint.style.display = shouldLockTask ? '' : 'none'
  return shouldLockTask
}

// ── Khởi tạo combobox Task ─────────────────────────────────────────────────
function _initTsTaskCombobox(tasks = [], selectedTaskId = null, locked = false) {
  // Chuẩn hoá selectedTaskId về string để so sánh chính xác
  const selId = selectedTaskId != null ? String(selectedTaskId) : ''

  // Build items: có prefix [Hạng mục] để phân biệt task trùng tên
  const taskItems = _buildTsTaskItems(tasks, selId)

  createCombobox('tsTaskCombobox', {
    placeholder: tasks.length ? '🔍 Tìm & chọn task...' : '— Chọn hạng mục trước —',
    items: taskItems,
    value: selId,
    fullWidth: true,
    onchange: (val) => {
      $('tsTaskHidden').value = val || ''
      // Hiển thị badge hạng mục của task vừa chọn
      _tsShowSingleTaskCategoryBadge(val)
    }
  })

  // Disable trigger nếu locked (by caller) hoặc chưa chọn hạng mục
  const hardLock = locked
  const wrap = $('tsTaskCombobox_wrap')
  if (wrap) {
    wrap.style.pointerEvents = hardLock ? 'none' : ''
    wrap.style.opacity       = hardLock ? '0.45' : ''
  }

  // Sync hidden input ngay khi khởi tạo (không chờ onchange)
  $('tsTaskHidden').value = selId
  // Hiện badge cho task đang được chọn sẵn khi mở modal sửa
  if (selId) _tsShowSingleTaskCategoryBadge(selId)
  // Sau khi render xong, đồng bộ lock state theo hạng mục
  if (!hardLock) _tsSyncTaskLockState()
}

// ── Hiện badge hạng mục cho đơn task được chọn ──────────────────────────────
function _tsShowSingleTaskCategoryBadge(taskId) {
  const badgeEl  = document.getElementById('tsTaskCategoryBadge')
  const badgeText = document.getElementById('tsTaskCategoryBadgeText')
  if (!badgeEl || !badgeText) return

  if (!taskId) { badgeEl.style.display = 'none'; return }

  const task = _tsCachedTasks.find(t => String(t.id) === String(taskId))
  if (!task || !task.category_id) { badgeEl.style.display = 'none'; return }

  const cat = _tsCachedCategories.find(c => c.id === task.category_id)
  if (!cat) {
    // Thử tìm trong _tsCachedCategories hoặc hiện category_name từ task
    if (task.category_name) {
      badgeText.textContent = (task.category_code ? task.category_code + ' – ' : '') + task.category_name
      badgeEl.style.display = ''
    } else {
      badgeEl.style.display = 'none'
    }
    return
  }

  badgeText.textContent = (cat.code ? cat.code + ' – ' : '') + cat.name
  badgeEl.style.display = ''
}

// ── Load tasks từ API rồi khởi tạo combobox task ─────────────────────────────
// token: nếu được truyền, hủy kết quả nếu token cũ (user đã đổi project khác)
async function _loadAndInitTsTaskCombobox(projectId, selectedTaskId = null, locked = false, token = null) {
  if (!projectId) { _initTsTaskCombobox([], null, locked); _tsCachedTasks = []; _tsRenderMultiRows(); return }
  const spinner = $('tsTaskLoadingSpinner')
  const spinnerMulti = document.getElementById('tsMultiTaskSpinner')
  if (spinner) spinner.style.display = 'inline'
  if (spinnerMulti) spinnerMulti.style.display = 'inline'
  try {
    const tasks = await api(`/tasks?project_id=${projectId}`)
    if (token !== null && token !== _tsProjChangeToken) return
    _tsCachedTasks = Array.isArray(tasks) ? tasks : []
    // Lọc theo hạng mục nếu đang có category được chọn
    const selCatId = parseInt($('tsCategoryHidden')?.value) || null
    const tasksToShow = selCatId ? _tsCachedTasks.filter(t => t.category_id === selCatId) : _tsCachedTasks
    _initTsTaskCombobox(tasksToShow, selectedTaskId, locked)
    // Re-render multi rows với task mới
    _tsRenderMultiRows()
  } catch (e) {
    if (token !== null && token !== _tsProjChangeToken) return
    _tsCachedTasks = []
    _initTsTaskCombobox([], null, locked)
    _tsRenderMultiRows()
  } finally {
    if (token === null || token === _tsProjChangeToken) {
      if (spinner) spinner.style.display = 'none'
      if (spinnerMulti) spinnerMulti.style.display = 'none'
    }
  }
}

async function openTimesheetModal(tsId = null) {
  if (!allProjects.length) allProjects = await api('/projects')

  const isAdmin     = currentUser.role === 'system_admin'
  const isProjAdmin = currentUser.role === 'project_admin' ||
                      currentUser.role === 'project_leader' ||
                      isAnyProjectLeaderOrAdmin()

  // system_admin cần danh sách đầy đủ tất cả nhân viên (không phải chỉ những người có timesheet)
  // Luôn fetch lại /users cho admin để tránh dùng allUsers đã bị ghi đè bởi /timesheets/members
  if (isAdmin) {
    try { allUsers = await api('/users') } catch(e) { if (!allUsers.length) allUsers = [] }
  } else if (!allUsers.length) {
    try { allUsers = await api('/users') } catch(e) { allUsers = [] }
  }

  // ── Hiện/ẩn hàng chọn nhân viên (chỉ system_admin) ──
  const userRow = document.getElementById('tsUserRow')
  if (userRow) userRow.style.display = isAdmin ? '' : 'none'

  // ── Khởi tạo combobox nhân viên (chỉ admin, chỉ khi thêm mới) ──
  if (isAdmin && !tsId) {
    // Force re-init combobox mỗi lần mở modal
    if (_cbState['tsUserCombobox']) delete _cbState['tsUserCombobox']
    const items = allUsers.map(u => ({
      value: String(u.id),
      label: u.full_name || u.username,
      sub: u.role ? (u.role === 'system_admin' ? 'System Admin' : u.role) : ''
    }))
    createCombobox('tsUserCombobox', {
      placeholder: '🔍 Tìm nhân viên...',
      items,
      fullWidth: true,
      onchange: (val) => {
        $('tsTargetUserHidden').value = val
        // Cập nhật gợi ý dự án đã khai báo theo nhân viên được chọn
        _updateTsDateHint($('tsDate').value, null, val ? parseInt(val) : null)
      }
    })
    // Default: chính mình
    const selfUser = allUsers.find(u => u.id === currentUser.id)
    const selfLabel = selfUser ? (selfUser.full_name || selfUser.username) : String(currentUser.id)
    _cbSelect('tsUserCombobox', String(currentUser.id), selfLabel)
    $('tsTargetUserHidden').value = String(currentUser.id)
  } else if (isAdmin && tsId) {
    // Khi sửa: hiển thị tên nhân viên nhưng không cho đổi
    if (_cbState['tsUserCombobox']) delete _cbState['tsUserCombobox']
    const ts = allTimesheets.find(t => t.id === tsId)
    if (ts) {
      const u = allUsers.find(u => u.id === ts.user_id)
      const uLabel = u ? (u.full_name || u.username) : `#${ts.user_id}`
      const items = [{ value: String(ts.user_id), label: uLabel }]
      createCombobox('tsUserCombobox', { placeholder: '', items, fullWidth: true })
      _cbSelect('tsUserCombobox', String(ts.user_id), uLabel)
      $('tsTargetUserHidden').value = String(ts.user_id)
      // Disable combobox khi sửa
      const wrap = document.getElementById('tsUserCombobox')?.querySelector('[id$="_wrap"]')
      if (wrap) { wrap.style.pointerEvents = 'none'; wrap.style.opacity = '0.6' }
    }
  }

  // ── Tính phạm vi tuần hiện tại (T2 → CN) ──
  const weekRange = _getCurrentWeekRange()
  const canEditFreeDate = isAdmin   // chỉ system_admin không bị giới hạn ngày

  // Cập nhật banner tuần
  const banner = document.getElementById('tsWeekBanner')
  const weekLabel = document.getElementById('tsWeekLabel')
  if (banner && weekLabel) {
    if (canEditFreeDate) {
      banner.style.display = 'none'
    } else {
      banner.style.display = ''
      weekLabel.textContent = `${fmtDate(weekRange.start)} → ${fmtDate(weekRange.end)}`
    }
  }

  $('tsModalTitle').textContent = tsId ? 'Sửa Timesheet' : 'Thêm Timesheet'
  $('tsId').value = tsId || ''

  if (tsId) {
    const ts = allTimesheets.find(t => t.id === tsId)
    if (!ts) { toast('Không tìm thấy timesheet', 'error'); return }

    // Kiểm tra quyền sửa
    const isOwner = ts.user_id === currentUser.id
    if (!isAdmin && !isProjAdmin && !(isOwner && ['draft', 'rejected'].includes(ts.status))) {
      toast('Bạn không có quyền sửa timesheet này', 'warning')
      return
    }

    // ── Kiểm tra giới hạn tuần (chặn sớm ở frontend) ──
    if (!canEditFreeDate && !isProjAdmin) {
      const workDate = new Date(ts.work_date + 'T00:00:00')
      const wkStart  = new Date(weekRange.start + 'T00:00:00')
      const wkEnd    = new Date(weekRange.end   + 'T00:00:00')
      if (workDate < wkStart || workDate > wkEnd) {
        toast(`Timesheet ngày ${fmtDate(ts.work_date)} thuộc tuần đã qua — không thể chỉnh sửa nữa.`, 'warning')
        return
      }
    }

    // locked = chỉ khi member thường & timesheet đã submitted
    const locked = !isAdmin && !isProjAdmin && ts.status === 'submitted'

    $('tsDate').value             = ts.work_date || ''
    $('tsDate').disabled          = locked
    // Giới hạn ngày trong tuần hiện tại cho non-admin
    if (!canEditFreeDate) {
      $('tsDate').min = weekRange.start
      $('tsDate').max = weekRange.end
    } else {
      $('tsDate').removeAttribute('min')
      $('tsDate').removeAttribute('max')
    }
    // Loại ngày
    if ($('tsDayType')) { $('tsDayType').value = ts.day_type || 'work'; $('tsDayType').disabled = locked }
    tsDayTypeChanged()
    $('tsRegularHours').value     = ts.regular_hours  ?? 8
    $('tsOvertimeHours').value    = ts.overtime_hours ?? 0
    $('tsDescription').value      = ts.description    || ''
    $('tsRegularHours').disabled  = locked
    $('tsOvertimeHours').disabled = locked
    $('tsDescription').disabled   = locked

    // Khởi tạo project combobox (set _tsModalLocked = locked)
    _initTsProjectCombobox(ts.project_id || '', locked)

    // Mở modal trước để DOM đã render rồi mới fill task
    openModal('timesheetModal')

    // Hiển thị gợi ý + giờ HC còn lại (trừ bản ghi đang sửa)
    const _editTargetUid = isAdmin ? (parseInt($('tsTargetUserHidden').value) || currentUser.id) : null
    _updateTsDateHint(ts.work_date, ts.id, _editTargetUid)

    // Load & init task combobox với task đang chọn sẵn + đúng locked
    // Reset multi-task về single mode mặc định
    _tsMultiRows = []; _tsMultiRowIdx = 0; _tsCachedTasks = []
    document.querySelectorAll('input[name="tsModeRadio"]').forEach(r => { r.checked = r.value === 'single' })
    tsModeChanged('single')
    // Load hạng mục TRƯỚC khi init task rows để _tsCachedCategories có dữ liệu khi render
    if (ts.project_id) await _loadTsCategories(ts.project_id, ts.category_id || null, locked)
    await _loadAndInitTsTaskCombobox(ts.project_id, ts.task_id, locked)
    // Nếu timesheet có task_entries → chuyển sang multi mode
    if (ts.task_entries && ts.task_entries.length > 0) {
      document.querySelectorAll('input[name="tsModeRadio"]').forEach(r => { r.checked = r.value === 'multi' })
      tsModeChanged('multi')
      _tsInitMultiRowsFromEntries(ts.task_entries)
    }

  } else {
    // ─── Thêm mới ────────────────────────────────────────────
    $('tsDate').value             = today()
    $('tsDate').disabled          = false
    // Giới hạn ngày trong tuần hiện tại cho non-admin
    if (!canEditFreeDate) {
      $('tsDate').min = weekRange.start
      $('tsDate').max = weekRange.end
    } else {
      $('tsDate').removeAttribute('min')
      $('tsDate').removeAttribute('max')
    }
    // Reset loại ngày về "làm việc"
    if ($('tsDayType')) { $('tsDayType').value = 'work'; $('tsDayType').disabled = false }
    tsDayTypeChanged()
    $('tsRegularHours').value     = 8
    $('tsOvertimeHours').value    = 0
    $('tsDescription').value      = ''
    $('tsRegularHours').disabled  = false
    $('tsOvertimeHours').disabled = false
    $('tsDescription').disabled   = false

    // Reset về single mode
    _tsMultiRows = []; _tsMultiRowIdx = 0; _tsCachedTasks = []
    document.querySelectorAll('input[name="tsModeRadio"]').forEach(r => { r.checked = r.value === 'single' })
    tsModeChanged('single')

    _initTsProjectCombobox('', false)
    _initTsTaskCombobox([], null, false)
    // Ẩn hạng mục (reset)
    _tsCachedCategories = []
    const _tsCatRow = $('tsCategoryRow'); if (_tsCatRow) _tsCatRow.style.display = 'none'
    if ($('tsCategoryHidden')) $('tsCategoryHidden').value = ''

    openModal('timesheetModal')

    // Hiển thị gợi ý dự án đã khai báo cho ngày hôm nay
    const targetUid = isAdmin ? (parseInt($('tsTargetUserHidden').value) || currentUser.id) : null
    _updateTsDateHint(today(), null, targetUid)
    // Cập nhật giờ HC mặc định = số giờ còn lại hôm nay
    const _usedToday = allTimesheets.filter(t =>
      t.work_date === today() && t.user_id === (targetUid || currentUser.id) &&
      ['work','half_day_am','half_day_pm','business_trip'].includes(t.day_type || 'work')
    ).reduce((s, t) => s + (t.regular_hours || 0), 0)
    const _remToday = Math.max(0, 8 - _usedToday)
    if ($('tsRegularHours')) $('tsRegularHours').value = _remToday
  }
}

// ── Loại ngày: ẩn/hiện các trường dự án/giờ khi chọn loại nghỉ ──
function tsDayTypeChanged() {
  const dayType = $('tsDayType')?.value || 'work'
  const workFields  = document.getElementById('tsWorkFields')
  const leaveNotice = document.getElementById('tsLeaveNotice')
  const leaveText   = document.getElementById('tsLeaveNoticeText')
  const isLeave = !['work','half_day_am','half_day_pm','business_trip'].includes(dayType)
  const isHalf  = dayType === 'half_day_am' || dayType === 'half_day_pm'

  if (workFields)  workFields.style.display  = isLeave ? 'none' : ''
  // Ẩn hạng mục khi chọn ngày nghỉ hoàn toàn
  const catRow = document.getElementById('tsCategoryRow')
  if (catRow && isLeave) catRow.style.display = 'none'
  if (leaveNotice) {
    leaveNotice.style.display = (isLeave || isHalf) ? '' : 'none'
    if (leaveText) {
      const labels = {
        half_day_am:   '🌅 Nghỉ nửa ngày (sáng) — giờ HC còn lại 4h. Vẫn khai báo dự án/task cho buổi làm việc.',
        half_day_pm:   '🌆 Nghỉ nửa ngày (chiều) — giờ HC còn lại 4h. Vẫn khai báo dự án/task cho buổi làm việc.',
        annual_leave:  '🌴 Nghỉ phép năm — giờ công ghi nhận 0h, được tính vào phép năm.',
        unpaid_leave:  '💸 Nghỉ không lương — giờ công ghi nhận 0h, không tính lương ngày này.',
        holiday:       '🎉 Nghỉ lễ — giờ công ghi nhận 0h.',
        sick_leave:    '🤒 Nghỉ ốm — giờ công ghi nhận 0h.',
        compensatory:  '🔄 Nghỉ bù — giờ công ghi nhận 0h.',
        business_trip: '✈️ Đi công tác — khai báo dự án và giờ làm việc bình thường.',
      }
      leaveText.textContent = labels[dayType] || 'Ngày nghỉ — giờ công ghi nhận 0h.'
    }
  }

  // Nếu chọn nửa ngày → mặc định giờ HC = 4h, giữ chế độ single/multi bình thường
  if (isHalf) {
    const regEl = $('tsRegularHours')
    if (regEl && (parseFloat(regEl.value) === 8 || parseFloat(regEl.value) === 0)) regEl.value = '4'
  } else if (dayType === 'work') {
    const regEl = $('tsRegularHours')
    if (regEl && parseFloat(regEl.value) === 4) regEl.value = '8'
  }
}

// ── Chế độ đơn/nhiều task ──────────────────────────────────────────────────
let _tsCachedTasks = []   // tasks đã load cho project hiện tại

function tsModeChanged(mode) {
  const single = document.getElementById('tsSingleTaskBlock')
  const multi  = document.getElementById('tsMultiTaskBlock')
  if (single) single.style.display = mode === 'single' ? '' : 'none'
  if (multi)  multi.style.display  = mode === 'multi'  ? '' : 'none'

  // Mở rộng modal khi chọn nhiều task để combobox có đủ không gian
  const modalBox = document.querySelector('#timesheetModal .modal')
  if (modalBox) {
    modalBox.style.maxWidth = mode === 'multi' ? '720px' : '560px'
  }

  if (mode === 'multi' && _tsCachedTasks.length === 0) {
    // Nếu chưa có task nào → thêm 1 dòng trống
    _tsMultiRows = []
    tsAddMultiTaskRow()
  } else if (mode === 'multi') {
    _tsRenderMultiRows()
  }
}

// Mảng các dòng task trong chế độ multi
let _tsMultiRows = []   // [{idx, category_id, task_id, reg, ot}]
let _tsMultiRowIdx = 0

function tsAddMultiTaskRow(taskId = '', reg = '', ot = '', categoryId = '') {
  const idx = _tsMultiRowIdx++
  _tsMultiRows.push({ idx, task_id: taskId, category_id: categoryId, reg, ot })
  _tsRenderMultiRows()
}

function tsRemoveMultiTaskRow(idx) {
  _tsMultiRows = _tsMultiRows.filter(r => r.idx !== idx)
  _tsRenderMultiRows()
}

function _tsRenderMultiRows() {
  const container = document.getElementById('tsMultiTaskRows')
  if (!container) return

  // ── SYNC STATE TRƯỚC KHI RE-RENDER ──────────────────────────────────────
  // Đọc giá trị hiện tại từ combobox state và input fields vào _tsMultiRows
  // (tránh mất dữ liệu khi re-render do thêm/xóa dòng)
  _tsMultiRows.forEach(r => {
    const catVal  = _cbState[`tsMultiCat_cb_${r.idx}`]?.value
    const taskVal = _cbState[`tsMultiTask_cb_${r.idx}`]?.value
    if (catVal  !== undefined) r.category_id = catVal
    if (taskVal !== undefined) r.task_id     = taskVal
    // Sync hours từ input DOM (nếu đã render)
    const regEl = document.getElementById(`tsMultiReg_${r.idx}`)
    const otEl  = document.getElementById(`tsMultiOT_${r.idx}`)
    if (regEl) r.reg = regEl.value
    if (otEl)  r.ot  = otEl.value
  })

  // Xóa combobox state cũ SAU KHI đã sync
  Object.keys(_cbState).forEach(k => {
    if (k.startsWith('tsMultiTask_cb_') || k.startsWith('tsMultiCat_cb_')) delete _cbState[k]
  })
  // Ẩn lock hint banner (không còn dùng)
  const hintBanner = document.getElementById('tsMultiTaskLockHint')
  if (hintBanner) hintBanner.style.display = 'none'

  if (_tsMultiRows.length === 0) {
    container.innerHTML = `<div class="text-xs text-gray-400 text-center py-2">Nhấn "+ Thêm task" để bắt đầu</div>`
    _tsUpdateMultiTotals()
    return
  }

  // Helper: build category items cho combobox hàng
  const catItems = _tsCachedCategories.map(c => ({
    value: String(c.id),
    label: c.code ? `${c.code} – ${c.name}` : c.name
  }))

  // Render rows: grid 5 cột [Hạng mục] [Task] [HC] [OT] [Xóa]
  container.innerHTML = _tsMultiRows.map((row, i) => `
    <div id="tsMultiRow_${row.idx}"
      style="display:grid;grid-template-columns:minmax(160px,1.2fr) minmax(0,2.5fr) 72px 72px 28px;gap:6px;align-items:center;background:${i%2===0?'#f9fafb':'#ffffff'};border:1px solid #e5e7eb;border-radius:8px;padding:6px 6px 6px 8px">
      <div id="tsMultiCat_cb_${row.idx}"></div>
      <div id="tsMultiTask_cb_${row.idx}"></div>
      <input type="number" id="tsMultiReg_${row.idx}"
        style="width:100%;border:1.5px solid #bfdbfe;border-radius:7px;padding:6px 4px;font-size:14px;font-weight:600;text-align:center;color:#1d4ed8;background:#eff6ff;outline:none;box-sizing:border-box"
        value="${row.reg}" min="0" max="24" step="0.5" placeholder="0"
        onfocus="this.style.borderColor='#3b82f6';this.style.boxShadow='0 0 0 2px rgba(59,130,246,.2)'"
        onblur="this.style.borderColor='#bfdbfe';this.style.boxShadow=''"
        onchange="_tsMultiRowChange(${row.idx},'reg',this.value)"
        oninput="_tsMultiRowChange(${row.idx},'reg',this.value)">
      <input type="number" id="tsMultiOT_${row.idx}"
        style="width:100%;border:1.5px solid #fed7aa;border-radius:7px;padding:6px 4px;font-size:14px;font-weight:600;text-align:center;color:#c2410c;background:#fff7ed;outline:none;box-sizing:border-box"
        value="${row.ot}" min="0" max="24" step="0.5" placeholder="0"
        onfocus="this.style.borderColor='#f97316';this.style.boxShadow='0 0 0 2px rgba(249,115,22,.2)'"
        onblur="this.style.borderColor='#fed7aa';this.style.boxShadow=''"
        onchange="_tsMultiRowChange(${row.idx},'ot',this.value)"
        oninput="_tsMultiRowChange(${row.idx},'ot',this.value)">
      <button type="button" onclick="tsRemoveMultiTaskRow(${row.idx})"
        style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:#f87171;background:transparent;border:none;cursor:pointer;flex-shrink:0;transition:background .15s"
        onmouseenter="this.style.background='#fee2e2';this.style.color='#dc2626'"
        onmouseleave="this.style.background='transparent';this.style.color='#f87171'"
        title="Xóa dòng này">
        <i class="fas fa-times text-sm"></i>
      </button>
    </div>`).join('')

  // Init combobox cho từng row
  _tsMultiRows.forEach(row => {
    const catCbId  = `tsMultiCat_cb_${row.idx}`
    const taskCbId = `tsMultiTask_cb_${row.idx}`

    // ── 1. Category combobox ──
    // Lấy danh sách task lọc theo category của row này (hoặc toàn bộ nếu chưa chọn)
    const rowCatId = row.category_id ? parseInt(row.category_id) : null

    const buildFilteredTaskItems = (catId) => {
      const filtered = catId
        ? _tsCachedTasks.filter(t => t.category_id === catId)
        : _tsCachedTasks
      return _buildTsTaskItems(filtered, row.task_id ? String(row.task_id) : '')
    }

    // ── 1. Category combobox ──
    // Tạo với value='' và KHÔNG dùng _cbSelect để restore (tránh trigger onchange)
    createCombobox(catCbId, {
      placeholder: _tsCachedCategories.length === 0 ? '—' : '— Chọn hạng mục —',
      items: catItems,
      fullWidth: true,
      value: '',   // luôn khởi tạo rỗng, restore thủ công bên dưới
      teleport: true,
      panelMaxWidth: '280px',
      dropdownMaxHeight: '260px',
      onchange: (val) => {
        // User chủ động đổi hạng mục → reset task của row này
        _tsMultiRowChange(row.idx, 'category_id', val || '')
        _tsMultiRowChange(row.idx, 'task_id', '')
        // Rebuild task combobox theo hạng mục mới
        const newCatId  = val ? parseInt(val) : null
        const newItems  = newCatId
          ? _buildTsTaskItems(_tsCachedTasks.filter(t => t.category_id === newCatId), '')
          : _buildTsTaskItems(_tsCachedTasks, '')
        if (_cbState[taskCbId]) delete _cbState[taskCbId]
        createCombobox(taskCbId, {
          placeholder: '— Chọn task —',
          items: newItems,
          fullWidth: true,
          value: '',
          teleport: true,
          panelMaxWidth: '480px',
          dropdownMaxHeight: '320px',
          onchange: (tVal) => {
            _tsMultiRowChange(row.idx, 'task_id', tVal)
          }
        })
      }
    })
    // Restore category value trực tiếp vào state (KHÔNG dùng _cbSelect để tránh fire onchange)
    if (row.category_id) {
      const cItem = catItems.find(ci => ci.value === String(row.category_id))
      if (cItem && _cbState[catCbId]) {
        _cbState[catCbId].value = cItem.value
        _cbState[catCbId].label = cItem.label
        _cbUpdateTrigger(catCbId)
      }
    }

    // ── 2. Task combobox (filtered by row's current category) ──
    const taskItems = buildFilteredTaskItems(rowCatId)
    createCombobox(taskCbId, {
      placeholder: '— Chọn task —',
      items: taskItems,
      fullWidth: true,
      value: '',   // luôn khởi tạo rỗng, restore thủ công bên dưới
      teleport: true,
      panelMaxWidth: '480px',
      dropdownMaxHeight: '320px',
      onchange: (val) => {
        _tsMultiRowChange(row.idx, 'task_id', val)
        // Nếu task có category và row chưa chọn category → auto-fill category
        if (val && !row.category_id) {
          const selTask = _tsCachedTasks.find(t => String(t.id) === String(val))
          if (selTask?.category_id) {
            _tsMultiRowChange(row.idx, 'category_id', String(selTask.category_id))
            // Set category label trực tiếp, không fire onchange
            const cItem = catItems.find(ci => ci.value === String(selTask.category_id))
            if (cItem && _cbState[catCbId]) {
              _cbState[catCbId].value = cItem.value
              _cbState[catCbId].label = cItem.label
              _cbUpdateTrigger(catCbId)
            }
          }
        }
      }
    })
    // Restore task value trực tiếp vào state (KHÔNG dùng _cbSelect để tránh fire onchange)
    if (row.task_id) {
      const tItem = taskItems.find(ti => ti.value === String(row.task_id))
      if (tItem && _cbState[taskCbId]) {
        _cbState[taskCbId].value = tItem.value
        _cbState[taskCbId].label = tItem.label
        _cbUpdateTrigger(taskCbId)
      }
    }
  })

  _tsUpdateMultiTotals()
}

function _tsMultiRowChange(idx, field, val) {
  const row = _tsMultiRows.find(r => r.idx === idx)
  if (row) row[field] = val
  _tsUpdateMultiTotals()
}

function _tsUpdateMultiTotals() {
  const totReg = _tsMultiRows.reduce((s, r) => s + (parseFloat(r.reg) || 0), 0)
  const totOT  = _tsMultiRows.reduce((s, r) => s + (parseFloat(r.ot)  || 0), 0)
  const elReg = document.getElementById('tsMultiTotalReg')
  const elOT  = document.getElementById('tsMultiTotalOT')
  if (elReg) elReg.textContent = totReg + 'h'
  if (elOT)  elOT.textContent  = totOT  + 'h'
}

// Khởi tạo multi-task rows từ task_entries khi mở modal sửa
function _tsInitMultiRowsFromEntries(entries = []) {
  _tsMultiRows = []
  _tsMultiRowIdx = 0
  if (entries.length === 0) {
    tsAddMultiTaskRow()
  } else {
    entries.forEach(e => {
      const idx = _tsMultiRowIdx++
      // Lấy category_id từ task trong cache (nếu có), hoặc từ entry trực tiếp
      const cachedTask = _tsCachedTasks.find(t => String(t.id) === String(e.task_id || ''))
      const catId = cachedTask?.category_id ? String(cachedTask.category_id) : ''
      _tsMultiRows.push({ idx, task_id: String(e.task_id || ''), category_id: catId, reg: e.regular_hours || '', ot: e.overtime_hours || '' })
    })
    _tsRenderMultiRows()
  }
}

// ── Tính phạm vi tuần hiện tại (ISO: T2–CN) ──
function _getCurrentWeekRange() {
  const now = new Date()
  // Thứ trong tuần: 0=CN → chuyển sang T2=0..CN=6
  const dow = (now.getDay() + 6) % 7
  const mon = new Date(now); mon.setDate(now.getDate() - dow); mon.setHours(0,0,0,0)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  return { start: fmt(mon), end: fmt(sun) }
}

// ── Cập nhật gợi ý dự án đã khai báo cho ngày được chọn ──
function _updateTsDateHint(selectedDate, excludeTimesheetId = null, overrideUserId = null) {
  const hint      = document.getElementById('tsDateHint')
  const hintProjs = document.getElementById('tsDateHintProjects')
  const hintUsed  = document.getElementById('tsDateHintUsed')
  const hintRemain= document.getElementById('tsDateHintRemain')
  const regInput  = document.getElementById('tsRegularHours')
  const regLabel  = document.getElementById('tsRegLabel')
  if (!hint || !hintProjs) return

  if (!selectedDate) {
    hint.style.display = 'none'
    if (regInput) { regInput.max = 8; regInput.value = Math.min(parseFloat(regInput.value)||8, 8) }
    if (regLabel) regLabel.textContent = '(tối đa 8h/ngày)'
    return
  }

  // Lọc timesheets cùng ngày, cùng user, loại trừ bản ghi đang sửa
  const userId = overrideUserId || currentUser.id
  const sameDay = allTimesheets.filter(t =>
    t.work_date === selectedDate &&
    t.user_id   === userId &&
    (excludeTimesheetId == null || t.id !== excludeTimesheetId) &&
    ['work','half_day_am','half_day_pm','business_trip'].includes(t.day_type || 'work')
  )

  // Tính tổng giờ HC đã dùng trong ngày (trừ bản ghi đang sửa)
  const usedReg = sameDay.reduce((s, t) => s + (t.regular_hours || 0), 0)
  const remaining = Math.max(0, 8 - usedReg)

  // Cập nhật max trên input giờ HC
  if (regInput) {
    regInput.max = remaining
    // Nếu giá trị hiện tại > remaining → auto-cap
    const cur = parseFloat(regInput.value) || 0
    if (cur > remaining) regInput.value = remaining
  }
  if (regLabel) {
    if (remaining <= 0) {
      regLabel.innerHTML = '<span class="text-red-500 font-semibold">⛔ Đã đủ 8h HC hôm nay</span>'
    } else {
      regLabel.innerHTML = `<span class="text-green-700">(còn ${remaining}h HC hôm nay)</span>`
    }
  }

  if (!sameDay.length) { hint.style.display = 'none'; return }

  // Lấy tên dự án
  const projNames = sameDay.map(t => {
    const proj = allProjects.find(p => p.id === t.project_id)
    return proj ? (proj.code ? proj.code : proj.name) : (t.project_name || `#${t.project_id}`)
  })
  hintProjs.textContent = projNames.join(', ')

  // Hiển thị số giờ HC đã dùng / còn lại
  if (hintUsed)   hintUsed.textContent   = `⏱ Đã dùng: ${usedReg}h HC`
  if (hintRemain) {
    if (remaining <= 0) {
      hintRemain.innerHTML = '<span class="text-red-600 font-bold">⛔ Đã đủ 8h — không thể thêm giờ HC</span>'
    } else {
      hintRemain.textContent = `✅ Còn lại: ${remaining}h HC`
    }
  }
  hint.style.display = ''
}

// ══════════════════════════════════════════════════
//  BULK IMPORT — Nhập tổng giờ theo năm (system_admin)
// ══════════════════════════════════════════════════
let _tsBulkRowCount = 0

const _MONTHS = ['Th.1','Th.2','Th.3','Th.4','Th.5','Th.6',
                 'Th.7','Th.8','Th.9','Th.10','Th.11','Th.12']

async function openTsBulkModal() {
  if (currentUser.role !== 'system_admin') return
  if (!allProjects.length) allProjects = await api('/projects')
  if (!allUsers.length)    allUsers    = await api('/users')

  // Populate year select (dynamic from API)
  const yearSel = $('tsBulkYear')
  if (yearSel) {
    yearSel.innerHTML = ''
    await initCalendarYearFilter(yearSel)
    yearSel.value = String(new Date().getFullYear())
  }

  // Init user combobox (force re-init)
  if (_cbState && _cbState['tsBulkUserCombobox']) delete _cbState['tsBulkUserCombobox']
  const userItems = allUsers.map(u => ({
    value: String(u.id),
    label: u.full_name || u.username,
    sub: u.role || ''
  }))
  createCombobox('tsBulkUserCombobox', {
    placeholder: '🔍 Tìm nhân viên...',
    items: userItems,
    fullWidth: true,
    onchange: (val) => { $('tsBulkUserHidden').value = val }
  })

  // Reset to "cả năm" mode
  const modeYearEl = $('tsBulkModeYear')
  if (modeYearEl) modeYearEl.checked = true
  const modeMonthEl = $('tsBulkModeMonth')
  if (modeMonthEl) modeMonthEl.checked = false

  // Tháng đại diện mặc định = 6
  const repMonth = $('tsBulkRepMonth')
  if (repMonth) repMonth.value = '6'

  // Reset rows
  _tsBulkRowCount = 0
  const rowsEl = $('tsBulkRows')
  if (rowsEl) rowsEl.innerHTML = ''

  tsBulkModeChange()   // renders header + first row
  openModal('tsBulkModal')
}

// Gọi mỗi khi đổi mode (year / month)
function tsBulkModeChange() {
  const mode = document.querySelector('input[name="tsBulkMode"]:checked')?.value || 'year'
  const repMonthWrap = $('tsBulkRepMonthWrap')
  if (repMonthWrap) repMonthWrap.style.display = mode === 'year' ? '' : 'none'

  // Render header
  _tsBulkRenderHeader(mode)

  // Re-render existing rows under new mode
  const rowsEl = $('tsBulkRows')
  if (rowsEl) rowsEl.innerHTML = ''
  _tsBulkRowCount = 0
  _tsBulkAddRow()
}

function _tsBulkRenderHeader(mode) {
  const hdr = $('tsBulkHeader')
  if (!hdr) return
  if (mode === 'month') {
    hdr.className = 'grid gap-2 mb-1 px-1 text-xs font-semibold text-gray-500 uppercase tracking-wide items-center'
    hdr.style.gridTemplateColumns = 'minmax(0,1fr) 110px 90px 90px 28px'
    hdr.innerHTML = `
      <div>Dự án</div>
      <div class="text-center">Tháng</div>
      <div class="text-center">Giờ HC</div>
      <div class="text-center">Giờ OT</div>
      <div></div>`
  } else {
    hdr.className = 'grid gap-2 mb-1 px-1 text-xs font-semibold text-gray-500 uppercase tracking-wide items-center'
    hdr.style.gridTemplateColumns = 'minmax(0,1fr) 110px 110px 28px'
    hdr.innerHTML = `
      <div>Dự án</div>
      <div class="text-center">Giờ HC (cả năm)</div>
      <div class="text-center">Giờ OT (cả năm)</div>
      <div></div>`
  }
}

function _tsBulkAddRow() {
  _tsBulkRowCount++
  const idx  = _tsBulkRowCount
  const mode = document.querySelector('input[name="tsBulkMode"]:checked')?.value || 'year'

  const projItems = allProjects.map(p => ({
    value: String(p.id),
    label: (p.code ? p.code + ' – ' : '') + p.name
  }))

  const monthOptions = _MONTHS.map((m, i) =>
    `<option value="${i+1}" ${(i+1) === new Date().getMonth()+1 ? 'selected' : ''}>${m}</option>`
  ).join('')

  const rowsEl = $('tsBulkRows')
  if (!rowsEl) return
  const div = document.createElement('div')
  div.id = `tsBulkRow_${idx}`
  div.className = 'grid gap-2 items-center'

  if (mode === 'month') {
    div.style.gridTemplateColumns = 'minmax(0,1fr) 110px 90px 90px 28px'
    div.innerHTML = `
      <div style="min-width:0">
        <div id="tsBulkProjCb_${idx}" style="width:100%"></div>
        <input type="hidden" id="tsBulkProj_${idx}">
      </div>
      <select id="tsBulkMonth_${idx}" class="input-field text-sm w-full">${monthOptions}</select>
      <input type="number" id="tsBulkReg_${idx}" class="input-field text-sm text-center w-full" placeholder="0" min="0" step="0.5" value="0">
      <input type="number" id="tsBulkOT_${idx}"  class="input-field text-sm text-center w-full" placeholder="0" min="0" step="0.5" value="0">
      <button type="button" onclick="_tsBulkRemoveRow(${idx})" class="text-red-400 hover:text-red-600 flex justify-center items-center h-full">
        <i class="fas fa-times"></i>
      </button>`
  } else {
    div.style.gridTemplateColumns = 'minmax(0,1fr) 110px 110px 28px'
    div.innerHTML = `
      <div style="min-width:0">
        <div id="tsBulkProjCb_${idx}" style="width:100%"></div>
        <input type="hidden" id="tsBulkProj_${idx}">
      </div>
      <input type="number" id="tsBulkReg_${idx}" class="input-field text-sm text-center w-full" placeholder="0" min="0" step="0.5" value="0">
      <input type="number" id="tsBulkOT_${idx}"  class="input-field text-sm text-center w-full" placeholder="0" min="0" step="0.5" value="0">
      <button type="button" onclick="_tsBulkRemoveRow(${idx})" class="text-red-400 hover:text-red-600 flex justify-center items-center h-full">
        <i class="fas fa-times"></i>
      </button>`
  }
  rowsEl.appendChild(div)

  // Init searchable combobox for project after DOM is ready
  createCombobox(`tsBulkProjCb_${idx}`, {
    placeholder: '🔍 Tìm / chọn dự án...',
    items: projItems,
    fullWidth: true,
    teleport: true,
    panelMaxWidth: '480px',
    dropdownMaxHeight: '260px',
    onchange: (val) => {
      const hidden = $(`tsBulkProj_${idx}`)
      if (hidden) hidden.value = val
    }
  })
}

function _tsBulkRemoveRow(idx) {
  const el = $(`tsBulkRow_${idx}`)
  if (el) el.remove()
}

async function _tsBulkSubmit() {
  const userId = parseInt($('tsBulkUserHidden').value) || 0
  if (!userId) { toast('Vui lòng chọn nhân viên', 'warning'); return }

  const year = parseInt($('tsBulkYear').value)
  if (!year) { toast('Vui lòng chọn năm', 'warning'); return }

  const mode = document.querySelector('input[name="tsBulkMode"]:checked')?.value || 'year'

  // Tháng đại diện (chỉ dùng khi mode = year), mặc định = 6
  const repMonth = parseInt($('tsBulkRepMonth')?.value) || 6

  // Collect rows
  const entries = []
  const rowsEl = $('tsBulkRows')
  if (!rowsEl) return

  rowsEl.querySelectorAll('[id^="tsBulkRow_"]').forEach(row => {
    const idx      = row.id.replace('tsBulkRow_', '')
    const projId   = parseInt($(`tsBulkProj_${idx}`)?.value) || 0
    const regHours = parseFloat($(`tsBulkReg_${idx}`)?.value) || 0
    const otHours  = parseFloat($(`tsBulkOT_${idx}`)?.value)  || 0
    if (!projId) return
    if (!regHours && !otHours) return

    let month
    if (mode === 'month') {
      month = parseInt($(`tsBulkMonth_${idx}`)?.value) || new Date().getMonth() + 1
    } else {
      month = repMonth
    }

    const mm = String(month).padStart(2, '0')
    const workDate = `${year}-${mm}-01`
    entries.push({ project_id: projId, work_date: workDate, regular_hours: regHours, overtime_hours: otHours })
  })

  if (!entries.length) { toast('Vui lòng nhập ít nhất 1 dòng có giờ > 0', 'warning'); return }

  // Mô tả rõ chế độ
  const modeLabel = mode === 'month' ? 'theo tháng' : `cả năm (tháng ${repMonth})`

  try {
    const result = await api('/timesheets/bulk-import', {
      method: 'post',
      data: { user_id: userId, year, entries, mode }
    })
    toast(`✅ Đã lưu ${result.saved} bản ghi timesheet tổng hợp (${modeLabel})`, 'success')
    closeModal('tsBulkModal')
    loadTimesheets()
  } catch (e) {
    toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error')
  }
}
// Giữ lại hàm loadTsTasks để tương thích nơi khác gọi
async function loadTsTasks(projectId = null, selectedTaskId = null) {
  const projId = projectId || _cbGetValue('tsProjectCombobox')
  if (projId) await _loadAndInitTsTaskCombobox(projId, selectedTaskId, false)
}

// Cập nhật gợi ý khi người dùng thay đổi ngày (chỉ khi đang thêm mới)
$('tsDate').addEventListener('change', () => {
  if (!$('tsId').value) {   // chỉ khi thêm mới (tsId rỗng)
    const uid = currentUser.role === 'system_admin'
      ? (parseInt($('tsTargetUserHidden').value) || currentUser.id)
      : null
    _updateTsDateHint($('tsDate').value, null, uid)
  }
})

$('tsForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('tsId').value

  const dayType = $('tsDayType')?.value || 'work'
  // half_day_am / half_day_pm vẫn là ngày làm việc (có dự án/task/giờ)
  const isLeaveDay = !['work','half_day_am','half_day_pm','business_trip'].includes(dayType)

  // Detect multi-task mode
  const isMultiMode = document.querySelector('input[name="tsModeRadio"]:checked')?.value === 'multi'

  // Validate: ngày làm việc phải chọn dự án
  const projId = _cbGetValue('tsProjectCombobox') || $('tsProjectHidden').value
  const taskId = _cbGetValue('tsTaskCombobox')    || $('tsTaskHidden').value
  // Sync lại hidden inputs để luôn khớp với combobox value
  if ($('tsProjectHidden')) $('tsProjectHidden').value = projId || ''
  if ($('tsTaskHidden'))    $('tsTaskHidden').value    = taskId || ''

  if (!isLeaveDay && !projId) {
    toast('Vui lòng chọn dự án', 'warning')
    return
  }

  // === Validate tổng giờ HC trong ngày không vượt 8h ===
  if (!isLeaveDay) {
    const workDate = $('tsDate').value
    const editingId = id ? parseInt(id) : null
    const userId = (currentUser.role === 'system_admin' && parseInt($('tsTargetUserHidden')?.value))
      ? parseInt($('tsTargetUserHidden').value)
      : currentUser.id
    // Tổng giờ HC đã khai trong ngày (trừ bản ghi đang sửa)
    const usedReg = allTimesheets
      .filter(t =>
        t.work_date === workDate &&
        t.user_id   === userId &&
        (editingId == null || t.id !== editingId) &&
        ['work','half_day_am','half_day_pm','business_trip'].includes(t.day_type || 'work')
      )
      .reduce((s, t) => s + (t.regular_hours || 0), 0)
    const remaining = Math.max(0, 8 - usedReg)

    // Tính giờ HC sẽ submit
    let submitReg = 0
    if (isMultiMode) {
      _tsMultiRows.forEach(r => {
        const regEl = document.getElementById(`tsMultiReg_${r.idx}`)
        submitReg += parseFloat(regEl ? regEl.value : r.reg) || 0
      })
    } else {
      submitReg = parseFloat($('tsRegularHours')?.value) || 0
    }

    if (submitReg > remaining + 0.001) {
      toast(`⛔ Tổng giờ HC vượt giới hạn! Ngày ${workDate} đã dùng ${usedReg}h, còn lại ${remaining}h. Bạn đang nhập ${submitReg}h.`, 'error')
      // Auto-cap
      if (!isMultiMode && $('tsRegularHours')) $('tsRegularHours').value = remaining
      return
    }
  }

  // Multi-task mode: validate có ít nhất 1 dòng task
  if (!isLeaveDay && isMultiMode) {
    if (_tsMultiRows.length === 0) {
      toast('Vui lòng thêm ít nhất một task', 'warning')
      return
    }
    const hasHours = _tsMultiRows.some(r => {
      const regEl = document.getElementById(`tsMultiReg_${r.idx}`)
      const otEl  = document.getElementById(`tsMultiOT_${r.idx}`)
      const reg = parseFloat(regEl ? regEl.value : r.reg) || 0
      const ot  = parseFloat(otEl  ? otEl.value  : r.ot)  || 0
      return reg > 0 || ot > 0
    })
    if (!hasHours) {
      toast('Vui lòng nhập giờ cho ít nhất một task', 'warning')
      return
    }
  }

  // Build data object
  const data = {
    day_type: dayType,
    project_id: isLeaveDay ? null : (parseInt(projId) || null),
    work_date: $('tsDate').value,
    description: $('tsDescription').value,
    category_id: isLeaveDay ? null : (parseInt($('tsCategoryHidden')?.value) || null)
  }

  if (isLeaveDay) {
    data.task_id = null
    data.regular_hours = 0
    data.overtime_hours = 0
  } else if (!isLeaveDay && isMultiMode) {
    // Multi-task: gửi task_entries, không gửi task_id/hours ở cấp top-level
    // Sync task_id và category_id từ combobox state (phòng trường hợp onchange chưa fire)
    _tsMultiRows.forEach(r => {
      const taskVal = _cbState[`tsMultiTask_cb_${r.idx}`]?.value
      if (taskVal !== undefined) r.task_id = taskVal
      const catVal = _cbState[`tsMultiCat_cb_${r.idx}`]?.value
      if (catVal !== undefined) r.category_id = catVal
      // Sync hours from input fields directly
      const regEl = document.getElementById(`tsMultiReg_${r.idx}`)
      const otEl  = document.getElementById(`tsMultiOT_${r.idx}`)
      if (regEl) r.reg = regEl.value
      if (otEl)  r.ot  = otEl.value
    })
    data.task_id = null
    data.task_entries = _tsMultiRows.map(r => ({
      task_id: r.task_id ? (parseInt(r.task_id) || null) : null,
      regular_hours: parseFloat(r.reg) || 0,
      overtime_hours: parseFloat(r.ot) || 0
    }))
  } else {
    // Single-task
    data.task_id = parseInt(taskId) || null
    data.regular_hours = parseFloat($('tsRegularHours').value) || 0
    data.overtime_hours = parseFloat($('tsOvertimeHours').value) || 0
  }

  // Nếu admin chọn nhân viên khác → truyền user_id
  if (currentUser.role === 'system_admin') {
    const targetUid = parseInt($('tsTargetUserHidden').value) || 0
    if (targetUid && targetUid !== currentUser.id) {
      data.user_id = targetUid
    }
  }
  try {
    let result
    if (id) {
      // Lấy project_id cũ của timesheet trước khi lưu (để so sánh)
      const oldTs = allTimesheets.find(t => t.id === parseInt(id))
      const oldProjectId = oldTs ? String(oldTs.project_id) : ''

      result = await api(`/timesheets/${id}`, { method: 'put', data })

      // Nếu user đổi project → clear filter project để timesheet vẫn hiển thị sau reload
      const newProjectId = String(data.project_id || '')
      if (oldProjectId && newProjectId && oldProjectId !== newProjectId) {
        // Project đã thay đổi: reset filter project về "Tất cả"
        // để danh sách sau reload sẽ hiện timesheet với project mới
        if (_cbState['tsProjectFilterCombobox']) {
          _cbState['tsProjectFilterCombobox'].value = ''
          _cbState['tsProjectFilterCombobox'].label = _cbState['tsProjectFilterCombobox'].placeholder
          _cbUpdateTrigger('tsProjectFilterCombobox')
        }
        // Tìm tên project mới để thông báo rõ ràng
        const newProj = allProjects.find(p => String(p.id) === newProjectId)
        const newProjName = newProj ? `${newProj.code} – ${newProj.name}` : `#${newProjectId}`
        toast(`✅ Đã đổi dự án → ${newProjName}`, 'success')
      } else {
        toast('Đã cập nhật timesheet', 'success')
      }

      // Đồng bộ filter tháng/năm theo work_date của timesheet vừa sửa
      // (để loadTimesheets() hiển thị đúng timesheet sau khi lưu)
      if (data.work_date) {
        const [wYear, wMonth] = data.work_date.split('-')
        const monthSel = $('tsMonthFilter')
        const yearSel  = $('tsYearFilter')
        if (monthSel && monthSel.value) monthSel.value = wMonth
        if (yearSel) {
          // Kiểm tra option năm có tồn tại không; nếu không thì thêm vào
          const hasYearOpt = Array.from(yearSel.options).some(o => o.value === wYear)
          if (!hasYearOpt) {
            const opt = document.createElement('option')
            opt.value = wYear
            opt.textContent = wYear
            yearSel.appendChild(opt)
          }
          yearSel.value = wYear
        }
      }
    } else {
      result = await api('/timesheets', { method: 'post', data })
      // Backend returns action: 'updated' if it auto-updated an existing record
      const leaveLabels = { half_day_am: 'Nghỉ nửa ngày (sáng)', half_day_pm: 'Nghỉ nửa ngày (chiều)', annual_leave: 'Nghỉ phép năm', unpaid_leave: 'Nghỉ không lương', holiday: 'Nghỉ lễ', sick_leave: 'Nghỉ ốm', compensatory: 'Nghỉ bù', business_trip: 'Đi công tác' }
      if (result && result.action === 'updated') {
        toast('✅ Đã cập nhật timesheet cho ngày này (đã tồn tại)', 'success')
      } else if (data.day_type && !['work'].includes(data.day_type)) {
        toast(`✅ Đã khai báo ${leaveLabels[data.day_type] || 'ngày nghỉ'} thành công`, 'success')
      } else if (isMultiMode && data.task_entries) {
        toast(`✅ Đã thêm timesheet với ${data.task_entries.length} task thành công`, 'success')
      } else {
        toast('✅ Đã thêm timesheet thành công', 'success')
      }
      // Tự động đồng bộ filter tháng/năm với work_date của timesheet vừa tạo
      if (data.work_date) {
        const [wYear, wMonth] = data.work_date.split('-')
        const monthSel = $('tsMonthFilter')
        const yearSel  = $('tsYearFilter')
        if (monthSel) monthSel.value = wMonth
        if (yearSel) {
          const hasYearOpt = Array.from(yearSel.options).some(o => o.value === wYear)
          if (!hasYearOpt) {
            const opt = document.createElement('option')
            opt.value = wYear
            opt.textContent = wYear
            yearSel.appendChild(opt)
          }
          yearSel.value = wYear
        }
      }
    }
    closeModal('timesheetModal')
    loadTimesheets()
  } catch (e) {
    const errMsg = e.response?.data?.error || e.message || 'Lỗi không xác định'
    // 422 week_limit — hiển thị cảnh báo nổi bật
    if (e.response?.status === 422 && e.response?.data?.week_limit) {
      toast('⏰ ' + errMsg, 'warning')
    } else if (e.response?.status === 422 && e.response?.data?.hours_exceeded) {
      toast('⛔ ' + errMsg, 'error')
      // Auto-cap giờ HC về giờ còn lại
      const rem = e.response?.data?.remaining ?? 0
      if ($('tsRegularHours')) $('tsRegularHours').value = rem
    } else if (e.response?.status === 409 && e.response?.data?.exists) {
      toast('⚠️ ' + errMsg, 'warning')
    } else {
      toast('Lỗi: ' + errMsg, 'error')
    }
  }
})

async function submitTimesheet(id) {
  if (!confirm('Gửi timesheet này để chờ duyệt?')) return
  try {
    await api(`/timesheets/${id}`, { method: 'put', data: { status: 'submitted' } })
    toast('Đã gửi timesheet chờ duyệt', 'success')
    loadTimesheets()
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
}

async function approveTimesheet(id) {
  try {
    await api(`/timesheets/${id}`, { method: 'put', data: { status: 'approved' } })
    toast('Đã duyệt timesheet', 'success')
    loadTimesheets()
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

async function rejectTimesheet(id) {
  if (!confirm('Từ chối timesheet này?')) return
  try {
    await api(`/timesheets/${id}`, { method: 'put', data: { status: 'rejected' } })
    toast('Đã từ chối timesheet', 'warning')
    loadTimesheets()
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

async function bulkApproveTimesheets() {
  const pending = allTimesheets.filter(t => t.status === 'submitted')
  if (!pending.length) { toast('Không có timesheet nào đang chờ duyệt', 'info'); return }
  if (!confirm(`Duyệt tất cả ${pending.length} timesheet đang chờ?`)) return
  try {
    const ids = pending.map(t => t.id)
    const result = await api('/timesheets/bulk-approve', { method: 'post', data: { ids } })
    toast(`Đã duyệt ${result.approved}/${pending.length} timesheet`, 'success')
    loadTimesheets()
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
}

async function deleteTimesheet(id) {
  if (!confirm('Xóa timesheet này?')) return
  try {
    await api(`/timesheets/${id}`, { method: 'delete' })
    toast('Đã xóa timesheet')
    loadTimesheets()
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
}

// ================================================================
// GANTT CHART
// ================================================================
async function loadGantt() {
  if (!allProjects.length) allProjects = await api('/projects')
  const sorted = [...allProjects].sort((a, b) => (a.code || '').localeCompare(b.code || ''))
  const items = sorted.map(p => ({ value: String(p.id), label: `${p.code} – ${p.name}` }))
  const cbEl = $('ganttProjectSelectCombobox')
  if (!cbEl) return
  if (cbEl.querySelector('[id$="_wrap"]')) {
    _cbSetItems('ganttProjectSelectCombobox', items, false)
  } else {
    createCombobox('ganttProjectSelectCombobox', {
      placeholder: '-- Chọn dự án --',
      items,
      value: '',
      fullWidth: true,
      onchange: () => renderGantt()
    })
  }
}

async function renderGantt() {
  const projectId = _cbGetValue('ganttProjectSelectCombobox')
  if (!projectId) return

  try {
    const tasks = await api(`/tasks?project_id=${projectId}`)
    const categories = await api(`/projects/${projectId}/categories`)
    const container = $('ganttContainer')

    if (!tasks.length) {
      container.innerHTML = '<div class="text-center text-gray-400 py-12"><i class="fas fa-chart-gantt text-5xl mb-3"></i><p>Không có task trong dự án này</p></div>'
      return
    }

    const project = allProjects.find(p => p.id === parseInt(projectId))
    const startDate = project?.start_date ? new Date(project.start_date) : new Date(Math.min(...tasks.filter(t => t.start_date).map(t => new Date(t.start_date))))
    const endDate = project?.end_date ? new Date(project.end_date) : new Date(Math.max(...tasks.filter(t => t.due_date).map(t => new Date(t.due_date))))
    const now = new Date()

    const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1
    const todayOffset = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24))
    const todayPct = Math.max(0, Math.min(100, (todayOffset / totalDays) * 100))

    // Generate week markers
    const weeks = []
    let d = new Date(startDate)
    while (d <= endDate) {
      weeks.push(d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }))
      d.setDate(d.getDate() + 7)
    }

    const taskRows = tasks.map(t => {
      if (!t.start_date || !t.due_date) return ''
      const taskStart = new Date(t.start_date)
      const taskEnd = new Date(t.due_date)
      const startPct = Math.max(0, ((taskStart - startDate) / (1000 * 60 * 60 * 24)) / totalDays * 100)
      const widthPct = Math.max(1, ((taskEnd - taskStart) / (1000 * 60 * 60 * 24)) / totalDays * 100)
      const overdue = isOverdue(t)
      const barColor = (t.status === 'completed') ? '#00A651' : (t.status === 'review') ? '#10B981' : overdue ? '#EF4444' : t.status === 'in_progress' ? '#0066CC' : '#9CA3AF'

      return `<div class="flex items-center gap-3 py-1.5 border-b border-gray-100 hover:bg-gray-50">
        <div class="w-56 flex-shrink-0 text-xs truncate">
          <span class="font-medium text-gray-800">${t.title}</span>
          <div class="text-gray-400">${t.discipline_code||''} • ${t.assigned_to_name||''}</div>
        </div>
        <div class="flex-1 relative h-7" style="min-width:200px">
          <div class="gantt-today" style="left:${todayPct}%"></div>
          <div class="gantt-bar absolute top-1 flex items-center" 
               style="left:${startPct}%;width:${widthPct}%;background:${barColor};opacity:${(t.status==='completed'||t.status==='review')?1:0.8}"
               title="${t.title}: ${fmtDate(t.start_date)} → ${fmtDate(t.due_date)} (${t.progress}%)">
            <div class="absolute left-0 top-0 bottom-0 rounded-l" style="width:${t.progress||0}%;background:rgba(255,255,255,0.3)"></div>
            <span class="text-white text-xs font-bold px-1 truncate relative z-10">${t.progress||0}%</span>
          </div>
        </div>
        <div class="w-16 text-right text-xs ${overdue?'text-red-500 font-bold':'text-gray-400'}">${fmtDate(t.due_date)}</div>
        <div class="w-20">${getStatusBadge(t.status)}</div>
      </div>`
    }).join('')

    container.innerHTML = `
      <div class="overflow-x-auto">
        <div class="flex items-center gap-3 mb-4 pb-2 border-b">
          <div class="w-56 flex-shrink-0 text-xs font-bold text-gray-500 uppercase">Task</div>
          <div class="flex-1 relative">
            <div class="flex justify-between text-xs text-gray-400">
              <span>${fmtDate(project?.start_date)}</span>
              <span class="text-red-500 font-bold">Hôm nay: ${fmtDate(now.toISOString().split('T')[0])}</span>
              <span>${fmtDate(project?.end_date)}</span>
            </div>
          </div>
          <div class="w-16"></div>
          <div class="w-20"></div>
        </div>
        <div>${taskRows}</div>
        <div class="mt-4 flex gap-4 text-xs">
          <span><span class="inline-block w-4 h-3 rounded mr-1" style="background:#00A651"></span>Hoàn thành</span>
          <span><span class="inline-block w-4 h-3 rounded mr-1" style="background:#0066CC"></span>Đang làm</span>
          <span><span class="inline-block w-4 h-3 rounded mr-1" style="background:#EF4444"></span>Trễ hạn</span>
          <span><span class="inline-block w-4 h-3 rounded mr-1" style="background:#9CA3AF"></span>Chờ làm</span>
          <span><span class="inline-block w-1 h-4" style="background:red;vertical-align:middle"></span> Hôm nay</span>
        </div>
      </div>
    `
  } catch (e) { toast('Lỗi tải Gantt: ' + e.message, 'error') }
}

// ================================================================
// COSTS
// ================================================================
// Khởi tạo dropdown năm NTC động từ dữ liệu thực tế trong DB
async function initCostYearFilter(sel) {
  if (!sel) return
  try {
    const res = await api('/dashboard/available-years')
    const years = res.years || []
    const currentNtc = res.current_ntc_year || new Date().getFullYear()

    // Lưu giá trị đang chọn (nếu có) để restore sau khi rebuild
    const prevVal = sel.value ? parseInt(sel.value) : currentNtc

    sel.innerHTML = years.map(y =>
      `<option value="${y}"${y === prevVal ? ' selected' : ''}>NTC ${y}</option>`
    ).join('')

    // Nếu giá trị cũ không còn trong danh sách → chọn NTC hiện tại
    if (!years.includes(prevVal)) {
      sel.value = String(currentNtc)
    }
  } catch {
    // Fallback: tạo 5 năm quanh năm hiện tại nếu API lỗi
    const cur = new Date().getFullYear()
    sel.innerHTML = ''
    for (let y = cur - 2; y <= cur + 2; y++) {
      const opt = document.createElement('option')
      opt.value = y; opt.textContent = `NTC ${y}`
      if (y === cur) opt.selected = true
      sel.appendChild(opt)
    }
  }
}

// Khởi tạo dropdown năm dương lịch (calendar year) cho các filter lương, tài chính dự án, chi phí chung
async function initCalendarYearFilter(sel) {
  if (!sel) return
  try {
    const res = await api('/dashboard/available-years')
    // Ưu tiên dùng calendar_years (bao gồm năm từ timesheets + project start_date)
    const calYears = res.calendar_years || res.years || []
    const curYear = res.current_cal_year || new Date().getFullYear()

    // Gom thêm năm hiện tại + năm tiếp theo luôn có trong list
    const yearSet = new Set(calYears)
    yearSet.add(curYear)
    yearSet.add(curYear + 1)
    const sortedYears = Array.from(yearSet).sort((a, b) => a - b)

    const prevVal = sel.value ? parseInt(sel.value) : curYear

    sel.innerHTML = sortedYears.map(y =>
      `<option value="${y}"${y === prevVal ? ' selected' : ''}>${y}</option>`
    ).join('')

    if (!sortedYears.includes(prevVal)) {
      sel.value = String(curYear)
    }
  } catch {
    const cur = new Date().getFullYear()
    sel.innerHTML = ''
    for (let y = cur - 3; y <= cur + 2; y++) {
      const opt = document.createElement('option')
      opt.value = y; opt.textContent = y
      if (y === cur) opt.selected = true
      sel.appendChild(opt)
    }
  }
}

async function loadCostDashboard() {
  // Guard: if already loading, mark pending so we re-run after current finishes
  if (_costDashboardLoading) { _costDashboardPending = true; return }
  _costDashboardLoading = true
  _costDashboardPending = false
  try {
    if (!allProjects.length) allProjects = await api('/projects')

    // Khởi tạo danh sách năm NTC động (chỉ chạy 1 lần khi chưa có options)
    const yearSel = $('costYearFilter')
    if (yearSel && yearSel.options.length === 0) {
      await initCostYearFilter(yearSel)
    }

    // Fill cost project combobox
    const costProjItems = allProjects.map(p => ({ value: String(p.id), label: `${p.code} – ${p.name}` }))
    if ($('costProjectFilterCombobox')?.querySelector('[id$="_wrap"]')) {
      _cbSetItems('costProjectFilterCombobox', costProjItems, true)
    } else {
      createCombobox('costProjectFilterCombobox', {
        placeholder: 'Tất cả dự án',
        items: costProjItems,
        value: '',
        fullWidth: true,
        onchange: () => loadCostDashboard()
      })
    }

    // Fill analysis project combobox (searchable)
    const analysisProjItems = allProjects.map(p => ({ value: String(p.id), label: `${p.code} – ${p.name}` }))
    if ($('analysisProjCombobox')?.querySelector('[id$="_wrap"]')) {
      _cbSetItems('analysisProjCombobox', analysisProjItems, true)
    } else {
      createCombobox('analysisProjCombobox', {
        placeholder: '-- Chọn dự án --',
        items: analysisProjItems,
        value: allProjects.length === 1 ? String(allProjects[0].id) : '',
        fullWidth: true,
        onchange: (val) => {
          const hid = $('analysisProjSel'); if (hid) hid.value = val || ''
        }
      })
    }
    // Sync hidden input on init
    const _initVal = allProjects.length === 1 ? String(allProjects[0].id) : ''
    const _hidSel = $('analysisProjSel'); if (_hidSel) _hidSel.value = _initVal

    const year = $('costYearFilter')?.value || new Date().getFullYear().toString()
    const [summary, sharedSummary] = await Promise.all([
      api(`/dashboard/cost-summary?year=${year}`),
      api(`/shared-costs/summary?year=${year}`).catch(() => ({ total_shared_cost: 0, by_project: [] }))
    ])

    let totalRevenue = 0, totalCost = 0
    summary.revenue_by_project?.forEach(p => totalRevenue += p.total_revenue || 0)

    // Aggregate OTHER costs (non-salary) by project from project_costs
    const costByProject = {}
    summary.cost_by_project?.forEach(item => {
      if (!costByProject[item.id]) costByProject[item.id] = { id: item.id, code: item.code, name: item.name, total_cost: 0, labor_cost: 0, shared_cost: 0 }
      costByProject[item.id].total_cost += item.total_cost || 0
    })
    // Add labor costs from project_labor_costs (SUM all months for year)
    summary.labor_by_project?.forEach(item => {
      if (!costByProject[item.id]) costByProject[item.id] = { id: item.id, code: item.code, name: item.name, total_cost: 0, labor_cost: 0, shared_cost: 0 }
      costByProject[item.id].labor_cost = item.labor_cost || 0
      costByProject[item.id].total_cost += item.labor_cost || 0
    })
    // Add shared cost allocations per project
    const sharedByProj = sharedSummary?.by_project || []
    sharedByProj.forEach(item => {
      if (!costByProject[item.id]) costByProject[item.id] = { id: item.id, code: item.code, name: item.name, total_cost: 0, labor_cost: 0, shared_cost: 0 }
      costByProject[item.id].shared_cost = item.allocated_cost || 0
      costByProject[item.id].total_cost += item.allocated_cost || 0
    })
    Object.values(costByProject).forEach(p => totalCost += p.total_cost)
    const profit = totalRevenue - totalCost
    const margin = totalRevenue > 0 ? (profit / totalRevenue * 100).toFixed(1) : 0
    const totalShared = sharedSummary?.total_shared_cost || 0
    const totalSharedAllocated = sharedByProj.reduce((s, p) => s + (p.allocated_cost || 0), 0)

    // Kiểm tra chênh lệch giữa pool_total_labor (tổng đã nhập) và project_labor_total (đã phân bổ)
    const poolTotalLabor = summary.pool_total_labor || 0
    const projLaborTotal = summary.project_labor_total || 0
    const laborDiff = poolTotalLabor - projLaborTotal
    const hasLaborDiff = poolTotalLabor > 0 && Math.abs(laborDiff) > 1000 // > 1,000đ thì mới cảnh báo

    $('costKpiRevenue').textContent = fmtMoney(totalRevenue)
    $('costKpiCost').innerHTML = fmtMoney(totalCost) +
      (totalSharedAllocated > 0
        ? `<br><span class="text-xs font-normal text-yellow-600" title="Đã bao gồm ${fmtMoney(totalSharedAllocated)} chi phí chung phân bổ"><i class="fas fa-share-alt mr-1"></i>Gồm ${fmtMoney(totalSharedAllocated)} chi phí chung</span>`
        : '') +
      (hasLaborDiff
        ? `<br><span class="text-xs font-normal text-orange-500" title="Chi phí lương đã nhập tổng thể: ${fmtMoney(poolTotalLabor)} — Đã phân bổ vào dự án: ${fmtMoney(projLaborTotal)}. Chênh lệch ${fmtMoney(laborDiff)} do chưa đồng bộ (Sync) chi phí lương."><i class="fas fa-exclamation-triangle mr-1"></i>Lương chưa sync đủ: ${fmtMoney(laborDiff)}</span>`
        : '')
    $('costKpiProfit').innerHTML = fmtMoney(profit)
    const profitEl = $('costKpiProfit')
    if (profitEl) profitEl.className = `text-2xl font-bold mt-1 ${profit < 0 ? 'text-red-600' : 'text-purple-600'}`
    $('costKpiMargin').textContent = margin + '%'
    const marginEl = $('costKpiMargin')
    if (marginEl) marginEl.className = `text-2xl font-bold mt-1 ${Number(margin) < 0 ? 'text-red-600' : Number(margin) < 10 ? 'text-orange-500' : 'text-yellow-600'}`

    // Hiển thị nhãn NTC
    const fyLabelEl = $('fyPeriodLabel')
    if (fyLabelEl) {
      if (summary.fiscal_year_label) {
        fyLabelEl.textContent = summary.fiscal_year_label
        fyLabelEl.title = `${summary.fiscal_year_start || ''} → ${summary.fiscal_year_end || ''}`
      } else {
        // Fallback: hiển thị NTC mặc định
        fyLabelEl.textContent = `NTC ${year}: ${year}-02-01 → ${parseInt(year)+1}-01-31`
      }
    }

    renderCostProjectChart(summary.revenue_by_project, Object.values(costByProject))
    renderCostMonthlyChart(summary.monthly_summary, sharedSummary?.by_project || [])

    loadCosts()
    // Nếu đang ở tab Chi phí chung → reload luôn khi năm thay đổi
    if (currentCostTab === 'shared') loadSharedCosts()
  } catch (e) { toast('Lỗi tải dữ liệu tài chính: ' + e.message, 'error') }
  finally {
    _costDashboardLoading = false
    // If a new reload was requested while we were loading, run it now
    if (_costDashboardPending) { _costDashboardPending = false; setTimeout(loadCostDashboard, 50) }
  }
}

function renderCostProjectChart(revenues, costs) {
  destroyChart('costProject')
  const ctx = $('costProjectChart')
  if (!ctx) return
  const existingCostProject = Chart.getChart(ctx)
  if (existingCostProject) { try { existingCostProject.destroy() } catch(e){} }

  // Gộp doanh thu + chi phí, sort theo chi phí giảm dần
  const allProj = (revenues || []).map(p => {
    const c = costs?.find(cc => cc.id === p.id)
    return { code: p.code || p.name?.substring(0, 12), name: p.name || p.code, revenue: p.total_revenue || 0, cost: c?.total_cost || 0 }
  })
  // Thêm dự án có chi phí nhưng chưa có doanh thu
  ;(costs || []).forEach(c => {
    if (!allProj.find(p => p.code === c.code)) {
      allProj.push({ code: c.code || c.name?.substring(0, 12), name: c.name || c.code, revenue: 0, cost: c.total_cost || 0 })
    }
  })
  // Sort theo tổng chi phí từ lớn → nhỏ
  allProj.sort((a, b) => b.cost - a.cost)

  const projects = allProj
  const BAR_WIDTH = 90   // px mỗi nhóm bar
  const MIN_WIDTH = 400  // px tối thiểu
  const chartWidth = Math.max(MIN_WIDTH, projects.length * BAR_WIDTH)

  // Điều chỉnh width wrapper để scroll ngang
  const inner = $('costProjChartInner')
  if (inner) inner.style.minWidth = chartWidth + 'px'

  // Cập nhật info label
  const info = $('costProjChartInfo')
  if (info) info.textContent = `${projects.length} dự án • kéo ngang để xem thêm`

  charts['costProject'] = safeChart(ctx, {
    type: 'bar',
    data: {
      labels: projects.map(p => p.code),
      datasets: [
        { label: 'Doanh thu', data: projects.map(p => p.revenue), backgroundColor: '#00A651cc', borderRadius: 4 },
        { label: 'Chi phí',   data: projects.map(p => p.cost),    backgroundColor: '#EF4444cc', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            title: (items) => {
              const idx = items[0]?.dataIndex
              return projects[idx]?.name || items[0]?.label || ''
            },
            label: (item) => ` ${item.dataset.label}: ${fmtMoney(item.raw)}`
          }
        }
      },
      scales: {
        x: { ticks: { font: { size: 11 }, maxRotation: 35, minRotation: 20 } },
        y: { beginAtZero: true, ticks: { callback: v => fmtMoney(v), font: { size: 11 } } }
      }
    }
  })
}

function renderCostMonthlyChart(data, sharedByProject) {
  destroyChart('costMonthly')
  const ctx = $('costMonthlyChart')
  if (!ctx) return
  // Extra guard: destroy any existing chart on this canvas
  const existingCostMonthly = Chart.getChart(ctx)
  if (existingCostMonthly) { try { existingCostMonthly.destroy() } catch(e){} }

  // Aggregate monthly non-salary + labor costs
  const monthlyMap = {}
  data?.forEach(d => {
    if (!monthlyMap[d.month]) monthlyMap[d.month] = 0
    monthlyMap[d.month] += d.total_cost || 0
  })

  const months = Object.keys(monthlyMap).sort()
  charts['costMonthly'] = safeChart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{ label: 'Tổng chi phí', data: months.map(m => monthlyMap[m]), borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: 0.4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => fmtMoney(v) } } }
    }
  })
}

async function loadCosts() {
  try {
    const projectId = _cbGetValue('costProjectFilterCombobox')
    const year = $('costYearFilter')?.value || new Date().getFullYear().toString()
    let costUrl = `/costs?year=${year}`
    let revUrl = `/revenues?year=${year}`
    if (projectId) { costUrl += `&project_id=${projectId}`; revUrl += `&project_id=${projectId}` }

    allCosts = await api(costUrl)
    allRevenues = await api(revUrl)
    _costPage = 1          // Reset về trang 1 khi load dữ liệu mới
    _costTypeFilter = ''   // Reset filter
    const sel = $('costTypeFilterSel'); if (sel) sel.value = ''
    renderCostTable()
  } catch (e) { console.error(e) }
}

async function switchCostTab(tab) {
  currentCostTab = tab
  // Tab buttons
  const tabs = ['costs', 'revenues', 'analysis', 'duplicates', 'shared']
  tabs.forEach(t => {
    const btn = $(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`)
    if (btn) btn.className = 'tab-btn ' + (t === tab ? 'active' : '')
  })
  // Tab panels
  const panels = { costs: 'tabPanelTable', revenues: 'tabPanelTable', analysis: 'tabPanelAnalysis', duplicates: 'tabPanelDuplicates', shared: 'tabPanelShared' }
  ;['tabPanelTable','tabPanelAnalysis','tabPanelDuplicates','tabPanelShared'].forEach(id => {
    const el = $(id); if (el) el.classList.add('hidden')
  })
  const activePanel = panels[tab]
  if (activePanel) { const el = $(activePanel); if (el) el.classList.remove('hidden') }

  // costFilter is now always visible (moved above tabs as global bar)
  // Filter loại chi phí chỉ hiện ở tab chi phí riêng
  const costTypeSel = $('costTypeFilterSel')
  if (costTypeSel) costTypeSel.style.display = (tab === 'costs') ? '' : 'none'

  // "Thêm chi phí chung" button — only visible on shared tab
  const btnAdd = $('btnAddSharedCost')
  if (btnAdd) btnAdd.classList.toggle('hidden', tab !== 'shared')

  if (tab === 'shared') {
    loadSharedCosts()
    return
  }

  renderCostTable()

  // Init analysis project combobox
  if (tab === 'analysis') {
    if ($('analysisProjCombobox') && !$('analysisProjCombobox')?.querySelector('[id$="_wrap"]') && allProjects.length) {
      const items = allProjects.map(p => ({ value: String(p.id), label: `${p.code} – ${p.name}` }))
      createCombobox('analysisProjCombobox', {
        placeholder: '-- Chọn dự án --',
        items,
        value: '',
        fullWidth: true,
        onchange: (val) => {
          const hid = $('analysisProjSel'); if (hid) hid.value = val || ''
        }
      })
    }
    // Set default month/year — khởi tạo năm động nếu chưa có options
    const now = new Date()
    const ms = $('analysisMonthSel'); if (ms) ms.value = String(now.getMonth() + 1).padStart(2, '0')
    const ys = $('analysisYearSel')
    if (ys) {
      if (ys.options.length === 0) {
        await initCostYearFilter(ys)
      }
      if (!ys.value) ys.value = String(now.getFullYear())
    }
    // Reset cache key so fresh data is loaded when user clicks Phân tích
    _lastAnalysisKey = ''
    _costAnalysisLoaded = false
  }
}

// ── Phân tích chi tiết ──────────────────────────────────────────────
// Period-type toggle for Analysis tab
function onAnalysisPeriodTypeChange() {
  const pt = $('analysisPeriodType')?.value || 'single'
  const sc = $('analysisSingleCtrl'); const mc = $('analysisMultiCtrl')
  if (sc) sc.classList.toggle('hidden', pt !== 'single')
  if (mc) mc.classList.toggle('hidden', pt !== 'multi')
  // Reset cache so next "Phân tích" click fetches fresh data
  _lastAnalysisKey = ''
  _costAnalysisLoaded = false
}

// Debounced wrapper for "Phân tích" button — prevent rapid double-clicks
function debouncedLoadCostAnalysis() {
  if (_costAnalysisDebounceTimer) clearTimeout(_costAnalysisDebounceTimer)
  _costAnalysisDebounceTimer = setTimeout(() => {
    _costAnalysisDebounceTimer = null
    loadCostAnalysis()
  }, 300)
}

async function loadCostAnalysis() {
  // Guard: if already loading, mark pending so we re-run after current finishes
  if (_costAnalysisLoading) { _costAnalysisPending = true; return }
  const projId = _cbGetValue('analysisProjCombobox') || $('analysisProjSel')?.value
  const year   = $('analysisYearSel')?.value
  const periodType = $('analysisPeriodType')?.value || 'single'
  if (!projId) { toast('Vui lòng chọn dự án', 'warning'); return }
  if (!year) { toast('Vui lòng chọn năm', 'warning'); return }

  // Build query params
  let apiUrl = `/projects/${projId}/costs-revenue-summary?year=${year}`
  let cacheKey = `${projId}-${periodType}-${year}`
  if (periodType === 'all') {
    apiUrl += '&all_months=true'
    cacheKey += '-all'
  } else if (periodType === 'multi') {
    const checked = [...document.querySelectorAll('.analysisMonthCheck:checked')].map(el => el.value)
    if (checked.length === 0) { toast('Vui lòng chọn ít nhất một tháng', 'warning'); return }
    apiUrl += `&months=${checked.join(',')}`
    cacheKey += '-' + checked.join(',')
  } else {
    const month = $('analysisMonthSel')?.value
    if (!month) { toast('Vui lòng chọn tháng', 'warning'); return }
    apiUrl += `&month=${month}`
    cacheKey += '-' + month
  }

  // Avoid re-fetching same data (prevents double-render on filter change event fires)
  if (cacheKey === _lastAnalysisKey && _costAnalysisLoaded) return
  _lastAnalysisKey = cacheKey

  _costAnalysisLoading = true
  _costAnalysisPending = false
  try {
    const data = await api(apiUrl)

    // Show cards
    const cards = $('analysisCards'); if (cards) cards.classList.remove('hidden')
    _costAnalysisLoaded = true

    // Map from new costs-revenue-summary response
    const fin = data.financial || {}
    const revVal      = fin.revenue?.value || 0
    const pendingRev  = fin.revenue?.pending_revenue || 0
    const laborVal = fin.costs?.labor?.value || 0
    const otherVal = fin.costs?.other?.value || 0
    const sharedVal = fin.costs?.shared?.value || 0
    const totalVal = fin.costs?.total?.value || 0
    const profitVal = fin.profit?.value ?? 0
    const margin   = fin.profit?.percentage
    const anaPeriodLabel = data.period?.label || ''
    const anaPeriodType2 = data.period?.type || 'single_month'
    const isMultiPeriod0 = anaPeriodType2 === 'all_months' || anaPeriodType2 === 'multiple_months'

    // Update dynamic labels to reflect period type
    if ($('anaRevenueLabel')) $('anaRevenueLabel').textContent = isMultiPeriod0 ? `Doanh thu (${anaPeriodLabel})` : 'Doanh thu tháng'
    if ($('anaRevenueSubLabel')) $('anaRevenueSubLabel').textContent = isMultiPeriod0 ? 'Tổng thực thu các tháng' : 'Thực thu trong tháng'

    $('anaRevenue').textContent   = fmtMoney(revVal)
    $('anaLaborCost').textContent = fmtMoney(laborVal)
    $('anaOtherCost').textContent = fmtMoney(otherVal)
    if ($('anaSharedCost')) {
      $('anaSharedCost').textContent = fmtMoney(sharedVal)
      if ($('anaSharedDetail')) {
        const sc = fin.costs?.shared
        $('anaSharedDetail').textContent = sc?.count > 0 ? `${sc.count} khoản phân bổ` : 'Không có phân bổ'
      }
    }
    $('anaTotalCost').textContent = fmtMoney(totalVal)
    $('anaProfit').textContent    = fmtMoney(profitVal)
    // Hiển thị tỷ suất LN và cảnh báo pending revenue
    if (revVal > 0) {
      $('anaProfitMargin').textContent = `Tỷ suất LN: ${margin ?? 'N/A'}%`
    } else if (pendingRev > 0) {
      $('anaProfitMargin').textContent = `⏳ Chờ TT: ${fmtMoney(pendingRev)} (chưa tính DT)`
    } else {
      $('anaProfitMargin').textContent = '⚠️ Chưa có doanh thu'
    }

    const profitCard = $('anaProfitCard')
    if (profitCard) {
      const profitStatus = data.validation?.profit_status || 'ok'
      profitCard.style.background = profitStatus === 'ok'
        ? 'linear-gradient(135deg,#9c27b0,#7b1fa2)'
        : profitStatus === 'warning'
          ? 'linear-gradient(135deg,#f59e0b,#d97706)'
          : (profitStatus === 'no_data' || profitStatus === 'no_revenue')
            ? 'linear-gradient(135deg,#9ca3af,#6b7280)'
            : 'linear-gradient(135deg,#ef4444,#dc2626)'
    }

    // Data sync source indicator
    const syncBadge = $('anaDataSyncBadge')
    if (syncBadge) {
      const src = fin.costs?.labor?.source || 'none'
      const syncedFrom = fin.costs?.labor?.synced_from || ''
      const periodLabel = data.period?.label || ''
      const laborMonths = fin.costs?.labor?.details?.months_count || 0
      const periodType2 = data.period?.type || 'single_month'
      const isMultiPeriod = periodType2 === 'all_months' || periodType2 === 'multiple_months'
      const isMixed = src === 'mixed'
      const isSynced = src === 'project_labor_costs'
      const colorClass = isSynced ? 'bg-green-50 border-green-200' : isMixed ? 'bg-blue-50 border-blue-200' : 'bg-yellow-50 border-yellow-200'
      const iconClass  = isSynced ? 'fa-check-circle text-green-500' : isMixed ? 'fa-layer-group text-blue-500' : 'fa-exclamation-circle text-yellow-500'
      const textClass  = isSynced ? 'text-green-700' : isMixed ? 'text-blue-700' : 'text-yellow-700'
      const srcLabel = isSynced ? 'Đã đồng bộ' : isMixed ? 'Đồng bộ + Real-time (hybrid)' : 'Real-time từ timesheet'
      syncBadge.innerHTML = `<div class="flex items-center gap-2 mb-3 p-2 rounded-lg ${colorClass} border">
        <i class="fas ${iconClass} text-sm flex-shrink-0"></i>
        <span class="text-xs ${textClass} flex-1">
          Chi phí lương: <strong>${syncedFrom || srcLabel}</strong>
          ${periodLabel ? ` &nbsp;|&nbsp; Kỳ: <strong>${periodLabel}</strong>` : ''}
          ${isMultiPeriod && laborMonths > 0 ? ` &nbsp;|&nbsp; <strong>${laborMonths} tháng</strong> có dữ liệu` : ''}
          ${isMultiPeriod ? ` &nbsp;|&nbsp; Tổng = SUM(${periodType2 === 'all_months' ? 'T1→T12' : 'các tháng chọn'})` : ''}
        </span>
        ${!isSynced && !isMixed && periodType2 === 'single_month'
          ? `<button onclick="createLaborForAnalysisProject(${projId})" class="ml-auto text-xs text-yellow-700 underline hover:no-underline flex-shrink-0">Đồng bộ ngay</button>`
          : ''}
      </div>`
      syncBadge.classList.remove('hidden')
    }

    // Show validation warnings
    const warnDiv = $('anaValidationWarnings')
    if (warnDiv) {
      const warnings = data.validation?.warnings || []
      if (warnings.length > 0) {
        warnDiv.innerHTML = `<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
          <div class="flex items-center gap-2 mb-2">
            <i class="fas fa-exclamation-triangle text-yellow-500"></i>
            <span class="font-semibold text-yellow-700 text-sm">Cảnh báo dữ liệu</span>
          </div>
          <ul class="space-y-1">
            ${warnings.map(w => `<li class="text-sm text-yellow-700">• ${w}</li>`).join('')}
          </ul>
        </div>`
        warnDiv.classList.remove('hidden')
      } else {
        warnDiv.innerHTML = `<div class="bg-green-50 border border-green-200 rounded-lg p-2 mb-3 flex items-center gap-2">
          <i class="fas fa-check-circle text-green-500 text-xs"></i>
          <span class="text-xs text-green-700">Dữ liệu hợp lệ — không có cảnh báo</span>
        </div>`
        warnDiv.classList.remove('hidden')
      }
    }

    const laborDet = fin.costs?.labor?.details
    const laborPeriodType3 = data.period?.type || 'single_month'
    if ($('anaLaborDetail') && laborDet) {
      const isMultiP = laborPeriodType3 === 'all_months' || laborPeriodType3 === 'multiple_months'
      $('anaLaborDetail').textContent = isMultiP
        ? `SUM ${laborDet.months_count || 0} tháng = ${fmtMoney(laborVal)}`
        : `${laborDet.total_hours}h × ${fmtMoney(laborDet.cost_per_hour)}/h`
    }

    const breakdown = data.cost_breakdown || []
    const hasData = breakdown.length > 0 || totalVal > 0

    const detailDiv = $('analysisDetail'); const emptyDiv = $('analysisEmpty')
    if (detailDiv) detailDiv.classList.toggle('hidden', !hasData)
    if (emptyDiv) emptyDiv.classList.toggle('hidden', hasData)

    if (hasData) {
      // Breakdown table
      const tbody = $('anaBreakdownTbody')
      if (tbody) {
        const costTypeIcons = { salary:'👥', material:'🔩', equipment:'🔧', transport:'🚛', travel:'🚗', office:'🏢', depreciation:'📉', manmonth:'📅', department:'🏬', shared:'🤝', other:'📋' }
        tbody.innerHTML = breakdown.map(b => `
          <tr class="border-b border-gray-50 hover:bg-gray-50 ${b.cost_type === 'shared' ? 'bg-yellow-50' : ''}">
            <td class="py-2 pr-3">
              <span class="flex items-center gap-1.5">
                <span>${costTypeIcons[b.cost_type] || '📋'}</span>
                <span class="font-medium text-gray-700">${b.type}</span>
                ${b.is_auto ? '<span class="text-xs bg-blue-100 text-blue-600 px-1 rounded ml-1">tự động</span>' : ''}
                ${b.cost_type === 'shared' ? `<span class="text-xs bg-yellow-100 text-yellow-700 px-1 rounded ml-1">chung (${b.shared_count || '?'} khoản)</span>` : ''}
                ${b.source && b.cost_type !== 'shared' ? `<span class="text-xs text-gray-400 ml-1">[${b.source}]</span>` : ''}
              </span>
            </td>
            <td class="py-2 pr-3 text-right font-bold text-gray-800">${fmtMoney(b.amount)}</td>
            <td class="py-2 text-right">
              <span class="inline-flex items-center gap-1">
                <div class="w-16 bg-gray-100 rounded-full h-1.5 inline-block align-middle">
                  <div class="h-1.5 rounded-full" style="width:${Math.min(b.percentage||0,100)}%;background:${b.cost_type==='shared'?'#f59e0b':'#00A651'}"></div>
                </div>
                <span class="text-xs text-gray-500">${b.percentage||0}%</span>
              </span>
            </td>
          </tr>`).join('')

        // Totals row
        tbody.innerHTML += `
          <tr class="border-t-2 border-gray-300">
            <td class="py-2 pr-3 font-bold text-gray-800">Tổng chi phí</td>
            <td class="py-2 pr-3 text-right font-bold text-red-600">${fmtMoney(totalVal)}</td>
            <td class="py-2 text-right font-bold text-gray-600">100%</td>
          </tr>`
      }

      // Labor info box
      const laborInfo = $('anaLaborInfo')
      if (laborInfo && laborDet) {
        laborInfo.classList.remove('hidden')
        const laborSrc = $('anaLaborInfoContent')
        const laborSrcStr = fin.costs?.labor?.source === 'project_labor_costs' ? 'project_labor_costs (đã đồng bộ)' : fin.costs?.labor?.source === 'manual' ? 'Nhập thủ công' : 'Real-time (tự động)'
        const laborPeriodType = data.period?.type || 'single_month'
        const isLaborMulti = laborPeriodType === 'all_months' || laborPeriodType === 'multiple_months'
        if (laborSrc) laborSrc.innerHTML = `
          ${isLaborMulti
            ? `<p>• Kỳ báo cáo: <strong>${data.period?.label || ''}</strong> (${laborDet.months_count || 0} tháng có dữ liệu)</p>
               <p>• Tổng giờ làm: <strong>${laborDet.total_hours}h</strong> (cộng dồn tất cả tháng)</p>
               <p>• Chi phí/giờ TB: <strong>${fmtMoney(laborDet.cost_per_hour)}/h</strong></p>
               <p>• Tổng chi phí lương = SUM(từng tháng) = <strong>${fmtMoney(laborVal)}</strong></p>`
            : `<p>• Giờ làm dự án kỳ này: <strong>${laborDet.total_hours}h</strong></p>
               <p>• Chi phí/giờ: <strong>${fmtMoney(laborDet.cost_per_hour)}/h</strong></p>
               ${laborDet.formula ? `<p>• Công thức: <strong>${laborDet.formula}</strong></p>` : `<p>• Chi phí = ${laborDet.total_hours}h × ${fmtMoney(laborDet.cost_per_hour)} = <strong>${fmtMoney(laborVal)}</strong></p>`}`}
          <p>• Nguồn: <strong>${laborSrcStr}</strong></p>`
      }

      // Doughnut chart
      destroyChart('anaDoughnut')
      const ctx = $('anaDoughnutChart')
      if (ctx) { const ex = Chart.getChart(ctx); if (ex) { try { ex.destroy() } catch(e){} } }
      if (ctx && breakdown.length) {
        const colors = ['#2196f3','#ff9800','#f44336','#9c27b0','#00bcd4','#4caf50','#795548']
        charts['anaDoughnut'] = safeChart(ctx, {
          type: 'doughnut',
          data: {
            labels: breakdown.map(b => b.type),
            datasets: [{
              data: breakdown.map(b => b.amount),
              backgroundColor: colors.slice(0, breakdown.length),
              borderColor: '#fff',
              borderWidth: 2
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } },
              tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtMoney(ctx.raw)}` } }
            }
          }
        })
      }
    }
  } catch (e) {
    toast('Lỗi tải phân tích: ' + e.message, 'error')
    _lastAnalysisKey = '' // reset cache key on error so next call can retry
  } finally {
    _costAnalysisLoading = false
    // If a new reload was requested while loading, run it now
    if (_costAnalysisPending) { _costAnalysisPending = false; setTimeout(loadCostAnalysis, 50) }
  }
}

// Quick sync helper called from the analysis page sync badge
async function createLaborForAnalysisProject(projId) {
  const month = $('analysisMonthSel')?.value
  const year  = $('analysisYearSel')?.value
  if (!month || !year) { toast('Chưa chọn tháng/năm cụ thể để đồng bộ', 'warning'); return }
  try {
    const res = await api(`/projects/${projId}/labor-costs/sync`, { method: 'POST', data: { month: parseInt(month), year: parseInt(year) } })
    toast(`Đồng bộ thành công: ${fmtMoney(res.data?.total_labor_cost)} ₫`, 'success')
    _lastAnalysisKey = '' // force re-fetch after sync
    loadCostAnalysis()
  } catch(e) { toast('Lỗi đồng bộ: ' + e.message, 'error') }
}

// ── Kiểm tra & xóa trùng lặp ────────────────────────────────────────
async function checkCostDuplicates() {
  try {
    $('dupStatusMsg').textContent = 'Đang kiểm tra...'
    const data = await api('/costs/duplicates')
    $('dupStatusMsg').textContent = ''

    const total = data.total_duplicate_groups || 0
    if (total === 0) {
      $('dupResultsPanel').classList.add('hidden')
      $('dupEmptyMsg').classList.remove('hidden')
      $('btnCleanupCostDups').classList.add('hidden')
      return
    }

    $('dupEmptyMsg').classList.add('hidden')
    $('dupResultsPanel').classList.remove('hidden')
    $('dupTotalCount').textContent = total
    $('btnCleanupCostDups').classList.remove('hidden')

    const costTypeNames = { salary:'Chi phí lương', material:'Chi phí vật liệu', equipment:'Chi phí thiết bị', transport:'Chi phí vận chuyển', other:'Chi phí khác', manmonth:'Chi phí tháng', department:'Chi phí phòng', depreciation:'Chi phí khấu hao', travel:'Chi phí đi lại', office:'Chi phí văn phòng' }
    const tbody = $('dupTableBody')
    if (!tbody) return

    const costsRows = (data.project_costs_duplicates || []).map(d => `
      <tr class="border-b border-gray-100 hover:bg-red-50">
        <td class="py-2 pr-3"><span class="badge" style="background:#fef3c7;color:#92400e">Chi phí</span></td>
        <td class="py-2 pr-3 font-medium text-sm">${d.project_code || d.project_id}</td>
        <td class="py-2 pr-3 text-sm">${d.type_name || costTypeNames[d.cost_type] || getCostTypeNameDynamic(d.cost_type)}</td>
        <td class="py-2 pr-3 text-sm text-gray-500">${fmtDate(d.cost_date)}</td>
        <td class="py-2 pr-3 text-center"><span class="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">${d.duplicate_count}</span></td>
        <td class="py-2 pr-3 text-right text-sm font-medium text-red-600">${fmt(d.total_amount)}</td>
        <td class="py-2 text-xs text-gray-400">${d.ids}</td>
      </tr>`)

    const revRows = (data.revenue_duplicates || []).map(d => `
      <tr class="border-b border-gray-100 hover:bg-red-50">
        <td class="py-2 pr-3"><span class="badge badge-completed">Doanh thu</span></td>
        <td class="py-2 pr-3 font-medium text-sm">${d.project_code || d.project_id}</td>
        <td class="py-2 pr-3 text-sm text-gray-500">${(d.description||'').substring(0,30)}</td>
        <td class="py-2 pr-3 text-sm text-gray-500">${fmtDate(d.revenue_date)}</td>
        <td class="py-2 pr-3 text-center"><span class="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">${d.duplicate_count}</span></td>
        <td class="py-2 pr-3 text-right text-sm font-medium text-green-600">${fmt(d.total_amount)}</td>
        <td class="py-2 text-xs text-gray-400">${d.ids}</td>
      </tr>`)

    tbody.innerHTML = [...costsRows, ...revRows].join('') ||
      '<tr><td colspan="7" class="text-center py-4 text-gray-400">Không có dữ liệu trùng</td></tr>'

    toast(`Phát hiện ${total} nhóm trùng lặp!`, 'warning')
  } catch (e) { toast('Lỗi kiểm tra: ' + e.message, 'error') }
}

async function cleanupCostDuplicates() {
  if (!confirm('Xóa tất cả dữ liệu trùng lặp?\n(Giữ lại bản ghi mới nhất, không thể hoàn tác)')) return
  try {
    $('dupStatusMsg').textContent = 'Đang xóa...'
    const result = await api('/costs/cleanup-duplicates', { method: 'post', data: {} })
    $('dupStatusMsg').textContent = ''
    const total = (result.project_costs_deleted || 0) + (result.revenue_deleted || 0)
    toast(`Đã xóa ${total} bản ghi trùng (Chi phí: ${result.project_costs_deleted}, DT: ${result.revenue_deleted})`, 'success')
    $('dupResultsPanel').classList.add('hidden')
    $('btnCleanupCostDups').classList.add('hidden')
    $('dupEmptyMsg').classList.remove('hidden')
    loadCostDashboard()
  } catch (e) { toast('Lỗi xóa trùng: ' + e.message, 'error') }
}

// ── Full duplicate cleanup with detailed before/after report ─────────
async function runFullDuplicateCleanup() {
  const statusEl = $('fullCleanupStatus')
  const resultEl = $('fullCleanupResult')
  const btn = $('btnFullCleanup')

  if (!confirm('Dọn dẹp toàn bộ dữ liệu trùng lặp trong project_costs, project_revenues và project_labor_costs?\n\n• Giữ lại bản ghi MỚI NHẤT (MAX id) cho mỗi nhóm\n• Thao tác KHÔNG thể hoàn tác\n\nXác nhận tiếp tục?')) return

  if (btn) btn.disabled = true
  if (statusEl) { statusEl.textContent = 'Đang dọn dẹp...'; statusEl.className = 'text-yellow-600 text-sm' }

  try {
    const result = await api('/data-cleanup/project-costs-duplicates', { method: 'post', data: {} })
    const total = result.summary?.total_deleted || 0

    if (statusEl) {
      statusEl.textContent = total > 0 ? `✓ Đã xóa ${total} bản ghi trùng` : '✓ Không có dữ liệu trùng'
      statusEl.className = 'text-green-600 text-sm font-medium'
    }

    if (resultEl) {
      const b = result.before || {}; const a = result.after || {}
      resultEl.innerHTML = `
        <div class="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm">
          <div class="font-semibold text-gray-700 mb-2">📊 Báo cáo dọn dẹp</div>
          <table class="w-full text-xs">
            <thead><tr class="text-gray-500 border-b"><th class="text-left pb-1">Bảng</th><th class="text-right pb-1">Trước</th><th class="text-right pb-1">Đã xóa</th><th class="text-right pb-1">Sau</th></tr></thead>
            <tbody>
              <tr class="border-b border-gray-100">
                <td class="py-1">project_costs</td>
                <td class="text-right text-orange-600">${b.project_costs || 0}</td>
                <td class="text-right text-red-600">-${result.summary?.project_costs_deleted || 0}</td>
                <td class="text-right text-green-600 font-medium">${a.project_costs || 0}</td>
              </tr>
              <tr class="border-b border-gray-100">
                <td class="py-1">project_revenues</td>
                <td class="text-right text-orange-600">${b.project_revenues || 0}</td>
                <td class="text-right text-red-600">-${result.summary?.revenue_deleted || 0}</td>
                <td class="text-right text-green-600 font-medium">${a.project_revenues || 0}</td>
              </tr>
              <tr>
                <td class="py-1">project_labor_costs</td>
                <td class="text-right text-orange-600">${b.project_labor_costs || 0}</td>
                <td class="text-right text-red-600">-${result.summary?.labor_costs_deleted || 0}</td>
                <td class="text-right text-green-600 font-medium">${a.project_labor_costs || 0}</td>
              </tr>
            </tbody>
          </table>
          ${a.remaining_duplicate_cost_groups > 0
            ? `<div class="mt-2 text-red-600">⚠ Còn ${a.remaining_duplicate_cost_groups} nhóm trùng trong project_costs</div>`
            : '<div class="mt-2 text-green-600">✓ Không còn bản ghi trùng lặp</div>'
          }
        </div>`
      resultEl.classList.remove('hidden')
    }

    if (total > 0) {
      toast(result.message || `Đã xóa ${total} bản ghi trùng`, 'success')
      loadCostDashboard()
    } else {
      toast('Không có bản ghi trùng lặp', 'info')
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = 'Lỗi: ' + e.message; statusEl.className = 'text-red-600 text-sm' }
    toast('Lỗi dọn dẹp: ' + e.message, 'error')
  } finally {
    if (btn) btn.disabled = false
  }
}

// ── Populate dropdown filter loại chi phí ──────────────────────────────────
function populateCostTypeFilter() {
  const sel = $('costTypeFilterSel')
  if (!sel) return
  // Thu thập các loại chi phí thực sự có trong allCosts
  const usedTypes = [...new Set((allCosts || []).map(c => c.cost_type).filter(Boolean))]
  // Giữ lựa chọn hiện tại
  const prev = sel.value
  sel.innerHTML = '<option value="">-- Tất cả loại CP --</option>'
  usedTypes.sort().forEach(code => {
    const name = (allCostTypes.find(ct => ct.code === code)?.name) || getCostTypeName(code) || code
    const opt = document.createElement('option')
    opt.value = code
    opt.textContent = name
    sel.appendChild(opt)
  })
  if (prev && usedTypes.includes(prev)) sel.value = prev
  else { sel.value = ''; _costTypeFilter = '' }
}

function onCostTypeFilterChange() {
  _costTypeFilter = $('costTypeFilterSel')?.value || ''
  _costPage = 1
  renderCostTable()
}

function renderCostTable() {
  const head = $('costTableHead')
  const tbody = $('costTableBody')
  if (!head || !tbody) return

  if (currentCostTab === 'revenues') {
    // ── Tab Doanh thu: chỉ xem, không có nút thêm/sửa/xóa ─────────────────
    head.innerHTML = `<tr class="text-left text-gray-500 border-b text-xs uppercase">
      <th class="pb-3 pr-3">Dự án</th>
      <th class="pb-3 pr-3">Mô tả</th>
      <th class="pb-3 pr-3">Số HĐ</th>
      <th class="pb-3 pr-3">Ngày TT</th>
      <th class="pb-3 pr-3">Trạng thái</th>
      <th class="pb-3 pr-3 text-right">Số tiền</th>
      <th class="pb-3 pr-3 text-center">Nguồn</th>
    </tr>`
    const payColors  = { pending: 'badge-todo', processing: 'badge-in_progress', partial: 'badge-in_progress', paid: 'badge-completed', rejected: 'badge-canceled' }
    const payLabels  = { pending: '⏳ Chờ TT', processing: '🔄 Đang xử lý', partial: '💰 TT một phần', paid: '✅ Đã TT', rejected: '❌ Từ chối' }
    tbody.innerHTML = allRevenues.map(r => `
      <tr class="table-row">
        <td class="py-2 pr-3 text-sm font-medium">${r.project_code || '-'}</td>
        <td class="py-2 pr-3 text-sm text-gray-700">${r.description}</td>
        <td class="py-2 pr-3 text-sm text-gray-500">${r.invoice_number || '-'}</td>
        <td class="py-2 pr-3 text-sm text-gray-500">${fmtDate(r.revenue_date)}</td>
        <td class="py-2 pr-3"><span class="badge ${payColors[r.payment_status] || 'badge-todo'}">${payLabels[r.payment_status] || r.payment_status}</span></td>
        <td class="py-2 pr-3 text-sm text-right font-bold text-green-600">${fmt(r.amount)}</td>
        <td class="py-2 pr-3 text-center">
          <span class="text-xs text-blue-500 bg-blue-50 rounded px-2 py-0.5 whitespace-nowrap">
            <i class="fas fa-sync-alt mr-1"></i>Tình trạng TT
          </span>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="7" class="text-center py-6 text-gray-400"><i class="fas fa-info-circle mr-1"></i>Doanh thu được đồng bộ tự động từ <strong>Tình trạng thanh toán</strong></td></tr>'
    return
  }

  // ── Tab Chi phí riêng ───────────────────────────────────────────────────
  head.innerHTML = `<tr class="text-left text-gray-500 border-b text-xs uppercase">
      <th class="pb-3 pr-3">Dự án</th>
      <th class="pb-3 pr-3">Loại</th>
      <th class="pb-3 pr-3">Mô tả</th>
      <th class="pb-3 pr-3">Nhà CC</th>
      <th class="pb-3 pr-3">Ngày</th>
      <th class="pb-3 pr-3 text-right">Số tiền</th>
      <th class="pb-3">Thao tác</th>
    </tr>`

  // Populate filter dropdown & ẩn/hiện select filter (chỉ hiện khi ở tab Chi phí riêng)
  populateCostTypeFilter()
  const filterSel = $('costTypeFilterSel')
  if (filterSel) filterSel.style.display = (currentCostTab === 'costs') ? '' : 'none'

  // Lọc theo loại chi phí
  const filtered = _costTypeFilter
    ? allCosts.filter(c => c.cost_type === _costTypeFilter)
    : allCosts

  // Phân trang
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / COST_PAGE_SIZE))
  if (_costPage > totalPages) _costPage = totalPages
  const start = (_costPage - 1) * COST_PAGE_SIZE
  const pageData = filtered.slice(start, start + COST_PAGE_SIZE)

  // Tổng tiền trang hiện tại & toàn bộ
  const pageTotal = pageData.reduce((s, c) => s + (c.amount || 0), 0)
  const allTotal  = filtered.reduce((s, c) => s + (c.amount || 0), 0)

  tbody.innerHTML = pageData.map(c => `
      <tr class="table-row">
        <td class="py-2 pr-3 text-sm font-medium">${c.project_code || '-'}</td>
        <td class="py-2 pr-3"><span class="badge" style="background:${c.type_color ? c.type_color+'22' : '#fef3c7'};color:${c.type_color || '#92400e'}">${c.type_name || getCostTypeNameDynamic(c.cost_type)}</span></td>
        <td class="py-2 pr-3 text-sm text-gray-700">${c.description}</td>
        <td class="py-2 pr-3 text-sm text-gray-500">${c.vendor || '-'}</td>
        <td class="py-2 pr-3 text-sm text-gray-500">${fmtDate(c.cost_date)}</td>
        <td class="py-2 pr-3 text-sm text-right font-bold text-red-600">${fmt(c.amount)}</td>
        <td class="py-2">
          <div class="flex gap-1">
            <button onclick="openCostModal(${c.id})" class="btn-secondary text-xs px-2 py-1"><i class="fas fa-edit"></i></button>
            <button onclick="deleteCostItem('cost', ${c.id})" class="text-red-400 hover:text-red-600 px-1.5 text-sm"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `).join('')
    + (pageData.length === 0 ? '<tr><td colspan="7" class="text-center py-6 text-gray-400">Không có dữ liệu chi phí</td></tr>' : '')
    + (total > 0 ? `<tr class="bg-gray-50 font-semibold text-sm border-t-2 border-gray-200">
        <td class="py-2 pr-3 text-gray-500" colspan="5">
          Trang ${_costPage}/${totalPages} &nbsp;·&nbsp; ${total} khoản
          ${_costTypeFilter ? `&nbsp;·&nbsp; <span style="color:#92400e">${getCostTypeNameDynamic(_costTypeFilter)}</span>` : ''}
        </td>
        <td class="py-2 pr-3 text-right text-red-600">${fmt(allTotal)}</td>
        <td></td>
      </tr>` : '')

  // Render pagination bar
  const pgDiv  = $('costPagination')
  const pgInfo = $('costPaginationInfo')
  const pgBtns = $('costPaginationBtns')
  if (pgDiv) {
    if (totalPages <= 1 && total <= COST_PAGE_SIZE) {
      pgDiv.classList.add('hidden')
    } else {
      pgDiv.classList.remove('hidden')
      if (pgInfo) pgInfo.textContent = `Hiển thị ${start + 1}–${Math.min(start + COST_PAGE_SIZE, total)} / ${total} khoản · Tổng: ${fmtMoney(allTotal)}`
      if (pgBtns) {
        let btns = ''
        // Prev
        btns += `<button onclick="setCostPage(${_costPage - 1})" class="px-2 py-1 text-xs rounded border ${_costPage <= 1 ? 'opacity-40 cursor-not-allowed border-gray-200 text-gray-400' : 'border-blue-300 text-blue-600 hover:bg-blue-50'}" ${_costPage <= 1 ? 'disabled' : ''}>‹ Trước</button>`
        // Page numbers (max 7 visible)
        const delta = 2
        let pages = []
        for (let p = 1; p <= totalPages; p++) {
          if (p === 1 || p === totalPages || (p >= _costPage - delta && p <= _costPage + delta)) pages.push(p)
          else if (pages[pages.length - 1] !== '...') pages.push('...')
        }
        pages.forEach(p => {
          if (p === '...') {
            btns += `<span class="px-1 text-xs text-gray-400">…</span>`
          } else {
            btns += `<button onclick="setCostPage(${p})" class="px-2.5 py-1 text-xs rounded border ${p === _costPage ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}">${p}</button>`
          }
        })
        // Next
        btns += `<button onclick="setCostPage(${_costPage + 1})" class="px-2 py-1 text-xs rounded border ${_costPage >= totalPages ? 'opacity-40 cursor-not-allowed border-gray-200 text-gray-400' : 'border-blue-300 text-blue-600 hover:bg-blue-50'}" ${_costPage >= totalPages ? 'disabled' : ''}>Sau ›</button>`
        pgBtns.innerHTML = btns
      }
    }
  }
}

function setCostPage(p) {
  const totalPages = Math.max(1, Math.ceil(
    (_costTypeFilter ? allCosts.filter(c => c.cost_type === _costTypeFilter) : allCosts).length / COST_PAGE_SIZE
  ))
  _costPage = Math.max(1, Math.min(p, totalPages))
  renderCostTable()
  // Scroll lên đầu bảng
  const tbl = $('costTable'); if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

async function openCostModal(id = null) {
  if (!allProjects.length) allProjects = await api('/projects')
  // Đảm bảo danh sách loại chi phí đã load
  if (!allCostTypes.length) {
    try { allCostTypes = await api('/cost-types') } catch(e) {}
  }
  _populateAllCostTypeDropdowns()

  $('costModalTitle').textContent = id ? 'Sửa Chi phí' : 'Thêm Chi phí'
  $('costId').value = id || ''

  const typeGroup = $('costTypeGroup')
  typeGroup.style.display = 'block'

  // Build project items for combobox
  const costProjItems = allProjects.map(p => ({ value: String(p.id), label: `${p.code} – ${p.name}` }))

  let initProjVal = ''
  if (id) {
    const item = allCosts.find(c => c.id === id)
    if (item) {
      initProjVal = String(item.project_id || '')
      $('costDescription').value = item.description || ''
      setMoneyInput('costAmount', item.amount || 0)
      $('costDate').value = item.cost_date || ''
      $('costInvoice').value = item.invoice_number || ''
      $('costVendor').value = item.vendor || ''
      $('costNotes').value = item.notes || ''
      $('costType').value = item.cost_type || ''
    }
  } else {
    $('costDescription').value = ''
    setMoneyInput('costAmount', 0)
    $('costDate').value = today()
    $('costInvoice').value = ''
    $('costVendor').value = ''
    $('costNotes').value = ''
    if ($('costType').options.length) $('costType').selectedIndex = 0
  }

  // Render searchable combobox for project selection
  createCombobox('costProjectCombobox', {
    placeholder: '🔍 Tìm / chọn dự án...',
    items: costProjItems,
    value: initProjVal,
    fullWidth: true,
    panelMaxWidth: '480px',
    dropdownMaxHeight: '260px',
    teleport: true,
    onchange: (val) => { $('costProject').value = val }
  })
  // Sync hidden input with initial value
  $('costProject').value = initProjVal

  openModal('costModal')
}

$('costForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('costId').value
  const data = {
    project_id: parseInt($('costProject').value),
    description: $('costDescription').value,
    amount: parseMoneyVal('costAmount'),
    cost_date: $('costDate').value,
    invoice_number: $('costInvoice').value,
    notes: $('costNotes').value,
    cost_type: $('costType').value,
    vendor: $('costVendor').value
  }
  try {
    if (id) await api(`/costs/${id}`, { method: 'put', data })
    else await api('/costs', { method: 'post', data })
    toast('Lưu thành công')
    // Reload data TRƯỚC khi đóng modal để đảm bảo allCosts được cập nhật
    await loadCostDashboard()
    closeModal('costModal')
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
})

async function deleteCostItem(type, id) {
  if (!confirm('Xóa mục này?')) return
  try {
    await api(`/costs/${id}`, { method: 'delete' })
    toast('Đã xóa')
    await loadCostDashboard()
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

// ================================================================
// ASSETS
// ================================================================
async function loadAssets() {
  try {
    if (!allUsers.length) allUsers = await api('/users')
    allAssets = await api('/assets')
    _assetPage = 1
    renderAssetStats()
    renderAssetsTable(allAssets)
  } catch (e) { toast('Lỗi tải tài sản: ' + e.message, 'error') }
}

function renderAssetStats() {
  const stats = $('assetStats')
  if (!stats) return
  // Flatten cây để tính stats
  const flat = []
  ;(allAssets || []).forEach(a => { flat.push(a); (a.children||[]).forEach(c => flat.push(c)) })

  const byStatus = {}
  flat.forEach(a => byStatus[a.status] = (byStatus[a.status] || 0) + 1)
  const totalPurchase = flat.reduce((s, a) => s + (a.purchase_price || 0), 0)
  const totalNetValue = flat.reduce((s, a) => s + (a.net_book_value || a.current_value || 0), 0)
  const deprActive = flat.filter(a => a.depreciation_status === 'active').length
  const totalMonthlyDepr = flat.filter(a => a.depreciation_status === 'active').reduce((s, a) => s + (a.monthly_depreciation || 0), 0)

  stats.innerHTML = [
    { label: 'Tổng tài sản', value: allAssets.length, icon: 'laptop', color: '#0066CC', bg: 'bg-blue-100' },
    { label: 'Đang sử dụng', value: byStatus['active'] || 0, icon: 'check-circle', color: '#00A651', bg: 'bg-green-100' },
    { label: 'Đang khấu hao', value: deprActive, icon: 'chart-line', color: '#8B5CF6', bg: 'bg-purple-100', sub: `${fmt(totalMonthlyDepr)}/tháng` },
    { label: 'Giá trị còn lại', value: fmtMoney(totalNetValue), icon: 'coins', color: '#FF6B00', bg: 'bg-orange-100', sub: `Giá mua: ${fmtMoney(totalPurchase)}` }
  ].map(s => `<div class="kpi-card" style="border-color:${s.color}">
    <div class="flex justify-between">
      <div>
        <p class="text-xs text-gray-500">${s.label}</p>
        <p class="text-xl font-bold mt-1" style="color:${s.color}">${s.value}</p>
        ${s.sub ? `<p class="text-xs text-gray-400 mt-0.5">${s.sub}</p>` : ''}
      </div>
      <div class="w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center">
        <i class="fas fa-${s.icon} text-xl" style="color:${s.color}"></i>
      </div>
    </div>
  </div>`).join('')
}

function renderAssetsTable(assets) {
  const tbody = $('assetsTable')
  if (!tbody) return
  const statusColors = { active: 'badge-completed', unused: 'badge-todo', maintenance: 'badge-review', repair: 'badge-high', retired: 'badge-cancelled', lost: 'badge-overdue' }
  const statusLabels = { active: 'Đang dùng', unused: 'Chưa dùng', maintenance: 'Bảo trì', repair: 'Sửa chữa', retired: 'Thanh lý', lost: 'Mất' }
  const deprColors = { active: 'background:#ede9fe;color:#5b21b6', none: 'background:#f3f4f6;color:#6b7280', completed: 'background:#d1fae5;color:#065f46', paused: 'background:#fef3c7;color:#92400e' }
  const deprLabels = { active: 'Đang KH', none: 'Không KH', completed: 'Hết KH', paused: 'Tạm dừng' }

  // Render 1 hàng tài sản (dùng chung cho cha và con)
  function renderRow(a, isChild = false) {
    const assignedUser = a.assigned_to ? (allUsers.find(u => u.id === a.assigned_to) || null) : null
    const assignedName = assignedUser ? assignedUser.full_name : null
    const deprSt = a.depreciation_status || 'none'
    const netVal = a.net_book_value || a.current_value || 0
    const pctDepr = a.purchase_price > 0 ? Math.min(100, Math.round((a.accumulated_depreciation || 0) / a.purchase_price * 100)) : 0
    const hasChildren = a.children && a.children.length > 0
    const childCount = hasChildren ? a.children.length : 0

    // Style cho hàng con: thụt lề, nền nhạt, đường kẻ trái
    const rowStyle = isChild
      ? 'background:#f8faff; border-left:3px solid #93c5fd;'
      : ''
    const indent = isChild
      ? `<span style="display:inline-block;width:20px;color:#93c5fd;flex-shrink:0"><i class="fas fa-level-up-alt fa-rotate-90 text-xs"></i></span>`
      : ''

    // Badge số tài sản con (chỉ hàng cha)
    const childBadge = hasChildren
      ? `<span class="ml-1 text-xs px-1.5 py-0.5 rounded-full font-semibold" style="background:#dbeafe;color:#1d4ed8" title="${childCount} linh kiện/thành phần">${childCount} thành phần</span>`
      : ''

    // Nút expand/collapse (chỉ hàng cha có children)
    const toggleBtn = hasChildren
      ? `<button onclick="toggleAssetChildren(${a.id})" class="text-blue-400 hover:text-blue-600 px-1 text-xs" id="toggle-${a.id}" title="Xem/ẩn tài sản con"><i class="fas fa-chevron-down" id="toggle-icon-${a.id}"></i></button>`
      : ''

    return `<tr class="table-row" style="${rowStyle}" id="asset-row-${a.id}">
      <td class="py-2 pr-3 font-mono text-sm font-bold text-primary">
        <div class="flex items-center gap-1">
          ${indent}${toggleBtn}
          <span>${a.asset_code}</span>
        </div>
      </td>
      <td class="py-2 pr-3">
        <div class="font-medium text-gray-800 text-sm">${a.name}${childBadge}</div>
        <div class="text-xs text-gray-400">${a.brand || ''} ${a.model ? '/ ' + a.model : ''}</div>
      </td>
      <td class="py-2 pr-3 text-xs text-gray-500 max-w-[160px]">
        ${a.specifications ? `<span title="${a.specifications.replace(/"/g,'&quot;')}" class="block truncate cursor-help">${a.specifications}</span>` : '<span class="text-gray-300">-</span>'}
      </td>
      <td class="py-2 pr-3"><span class="badge" style="background:#e0f2fe;color:#0369a1">${getAssetCategoryName(a.category)}</span></td>
      <td class="py-2 pr-3 text-sm text-gray-600">${a.purchase_date ? fmtDate(a.purchase_date) : '-'}</td>
      <td class="py-2 pr-3 text-sm text-gray-700">
        ${assignedName ? `<div class="flex items-center gap-1.5"><span class="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold flex-shrink-0">${assignedName.split(' ').pop()?.charAt(0) || '?'}</span><span class="truncate max-w-[100px]" title="${assignedName}">${assignedName}</span></div>` : '<span class="text-gray-300">-</span>'}
      </td>
      <td class="py-2 pr-3 text-sm text-right font-medium text-gray-800">${fmt(a.purchase_price)}</td>
      <td class="py-2 pr-3 text-sm text-right font-semibold" style="color:#8B5CF6">${deprSt === 'active' ? fmt(a.monthly_depreciation) : '<span class="text-gray-300">-</span>'}</td>
      <td class="py-2 pr-3 text-sm text-right font-bold text-primary">${fmt(netVal)}
        ${deprSt === 'active' ? `<div class="progress-bar mt-1" style="height:4px"><div class="progress-fill${pctDepr > 80 ? ' danger' : ''}" style="width:${pctDepr}%"></div></div>` : ''}
      </td>
      <td class="py-2 pr-3"><span class="badge text-xs" style="${deprColors[deprSt]||deprColors.none}">${deprLabels[deprSt]||deprSt}${deprSt==='active'?' ('+a.depreciation_years+'y)':''}</span></td>
      <td class="py-2 pr-3"><span class="badge ${statusColors[a.status]||'badge-todo'}">${statusLabels[a.status]||a.status}</span></td>
      <td class="py-2">
        <div class="flex gap-1 flex-wrap">
          <button onclick="openAssetModal(${a.id})" class="btn-secondary text-xs px-2 py-1" title="Chỉnh sửa"><i class="fas fa-edit"></i></button>
          ${!isChild ? `<button onclick="openAssetModalAsChild(${a.id})" class="text-xs px-2 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50" title="Thêm tài sản con"><i class="fas fa-plus-circle"></i></button>` : ''}
          ${deprSt !== 'none' ? `<button onclick="openDeprDetailFromAsset(${a.id})" class="text-xs px-2 py-1 rounded-lg border border-purple-200 text-purple-600 hover:bg-purple-50" title="Lịch KH"><i class="fas fa-chart-line"></i></button>` : ''}
          <button onclick="deleteAsset(${a.id})" class="text-red-400 hover:text-red-600 px-1.5 text-sm" title="Xóa"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`
  }

  // Render cả cây: cha rồi các con (ban đầu ẩn con)
  // Flatten để phân trang: mỗi "row đơn vị" là 1 cha (kèm con của nó)
  if (!assets || assets.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="text-center py-8 text-gray-400">Không có tài sản</td></tr>'
    const pgDiv = $('assetPagination'); if (pgDiv) pgDiv.classList.add('hidden')
    return
  }

  // Phân trang theo tài sản CHA (mỗi cha + các con của nó = 1 đơn vị)
  const totalParents = assets.length
  const totalPages = Math.max(1, Math.ceil(totalParents / ASSET_PAGE_SIZE))
  if (_assetPage > totalPages) _assetPage = totalPages
  const start = (_assetPage - 1) * ASSET_PAGE_SIZE
  const pageAssets = assets.slice(start, start + ASSET_PAGE_SIZE)

  let html = ''
  pageAssets.forEach(a => {
    html += renderRow(a, false)
    if (a.children && a.children.length > 0) {
      a.children.forEach(child => {
        const childRow = renderRow(child, true)
        html += childRow.replace(
          /^<tr class="table-row"/,
          `<tr class="table-row asset-child-of-${a.id}" style="display:none"`
        )
      })
    }
  })
  tbody.innerHTML = html

  // Render pagination bar
  const pgDiv  = $('assetPagination')
  const pgInfo = $('assetPaginationInfo')
  const pgBtns = $('assetPaginationBtns')
  if (pgDiv) {
    if (totalPages <= 1) {
      pgDiv.classList.add('hidden')
    } else {
      pgDiv.classList.remove('hidden')
      if (pgInfo) pgInfo.textContent = `Hiển thị ${start + 1}–${Math.min(start + ASSET_PAGE_SIZE, totalParents)} / ${totalParents} tài sản`
      if (pgBtns) {
        let btns = ''
        btns += `<button onclick="setAssetPage(${_assetPage - 1})" class="px-2 py-1 text-xs rounded border ${_assetPage <= 1 ? 'opacity-40 cursor-not-allowed border-gray-200 text-gray-400' : 'border-blue-300 text-blue-600 hover:bg-blue-50'}" ${_assetPage <= 1 ? 'disabled' : ''}>‹ Trước</button>`
        const delta = 2
        let pages = []
        for (let p = 1; p <= totalPages; p++) {
          if (p === 1 || p === totalPages || (p >= _assetPage - delta && p <= _assetPage + delta)) pages.push(p)
          else if (pages[pages.length - 1] !== '...') pages.push('...')
        }
        pages.forEach(p => {
          if (p === '...') {
            btns += `<span class="px-1 text-xs text-gray-400">…</span>`
          } else {
            btns += `<button onclick="setAssetPage(${p})" class="px-2.5 py-1 text-xs rounded border ${p === _assetPage ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}">${p}</button>`
          }
        })
        btns += `<button onclick="setAssetPage(${_assetPage + 1})" class="px-2 py-1 text-xs rounded border ${_assetPage >= totalPages ? 'opacity-40 cursor-not-allowed border-gray-200 text-gray-400' : 'border-blue-300 text-blue-600 hover:bg-blue-50'}" ${_assetPage >= totalPages ? 'disabled' : ''}>Sau ›</button>`
        pgBtns.innerHTML = btns
      }
    }
  }
}

function setAssetPage(p) {
  const totalPages = Math.max(1, Math.ceil((allAssets || []).length / ASSET_PAGE_SIZE))
  _assetPage = Math.max(1, Math.min(p, totalPages))
  renderAssetsTable(allAssets)
  const tbl = $('assetsTable'); if (tbl) tbl.closest('.overflow-x-auto')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

// Toggle hiện/ẩn tài sản con
function toggleAssetChildren(parentId) {
  const rows = document.querySelectorAll(`.asset-child-of-${parentId}`)
  const iconEl = $(`toggle-icon-${parentId}`)
  const isHidden = rows.length > 0 && rows[0].style.display === 'none'
  rows.forEach(r => r.style.display = isHidden ? '' : 'none')
  if (iconEl) {
    iconEl.className = isHidden ? 'fas fa-chevron-up' : 'fas fa-chevron-down'
  }
}

function filterAssets() {
  const search = ($('assetSearch')?.value || '').toLowerCase()
  const category = $('assetCategoryFilter')?.value || ''
  const status = $('assetStatusFilter')?.value || ''
  const depr = $('assetDeprFilter')?.value || ''

  // Flatten tree để lọc
  const flatAll = []
  ;(allAssets || []).forEach(a => {
    flatAll.push(a)
    ;(a.children || []).forEach(c => flatAll.push(c))
  })

  // Nếu không có filter → render tree gốc
  const hasFilter = search || category || status || depr
  if (!hasFilter) {
    _assetPage = 1
    renderAssetsTable(allAssets)
    return
  }

  // Có filter → render flat (không hiển thị tree)
  const filtered = flatAll.filter(a =>
    (!search || a.name.toLowerCase().includes(search) || a.asset_code.toLowerCase().includes(search) || (a.brand||'').toLowerCase().includes(search)) &&
    (!category || a.category === category) &&
    (!status || a.status === status) &&
    (!depr || (a.depreciation_status || 'none') === depr)
  )
  // Render flat kết quả (không children)
  const flatAssets = filtered.map(a => ({ ...a, children: [] }))
  _assetPage = 1
  renderAssetsTable(flatAssets)
}

async function openAssetModal(assetId = null) {
  if (!allUsers.length) allUsers = await api('/users')
  $('assetModalTitle').textContent = assetId ? 'Chỉnh sửa tài sản' : 'Thêm tài sản mới'
  $('assetId').value = assetId || ''
  $('assetParentId').value = ''
  $('assetAssignedTo').innerHTML = '<option value="">-- Không giao --</option>' +
    allUsers.filter(u => u.is_active).map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')

  // Ẩn banner tài sản cha mặc định
  if ($('assetParentRow')) $('assetParentRow').classList.add('hidden')
  if ($('assignParentRow')) $('assignParentRow').classList.add('hidden')
  if ($('changeParentUI')) $('changeParentUI').classList.add('hidden')
  if ($('assignParentUI')) $('assignParentUI').classList.add('hidden')

  if (assetId) {
    // Tìm trong tree (cha hoặc con)
    let asset = allAssets.find(a => a.id === assetId)
    if (!asset) allAssets.forEach(a => { if (!asset) asset = (a.children||[]).find(c => c.id === assetId) })
    if (asset) {
      $('assetCode').value = asset.asset_code || ''
      $('assetName').value = asset.name || ''
      $('assetCategory').value = asset.category || 'computer'
      $('assetStatus').value = asset.status || 'active'
      $('assetBrand').value = asset.brand || ''
      $('assetModel').value = asset.model || ''
      $('assetSerial').value = asset.serial_number || ''
      $('assetPurchaseDate').value = asset.purchase_date || ''
      setMoneyInput('assetPurchasePrice', asset.purchase_price || 0)
      setMoneyInput('assetCurrentValue', asset.current_value || 0)
      $('assetDepartment').value = asset.department || ''
      $('assetAssignedTo').value = asset.assigned_to || ''
      $('assetSpecs').value = asset.specifications || ''
      $('assetDepreciationYears').value = asset.depreciation_years || 0
      $('assetDepreciationStart').value = asset.depreciation_start_date || asset.purchase_date || ''

      // Hiển thị banner tài sản cha nếu là tài sản con
      if (asset.parent_asset_id) {
        $('assetParentId').value = asset.parent_asset_id
        const parentName = asset.parent_asset_name || asset.parent_asset_code || `#${asset.parent_asset_id}`
        $('assetParentLabel').textContent = parentName
        $('assetParentRow').classList.remove('hidden')
        if ($('assignParentRow')) $('assignParentRow').classList.add('hidden')
      } else {
        // Tài sản độc lập → hiển thị section "Gắn vào tài sản cha"
        if ($('assignParentRow')) $('assignParentRow').classList.remove('hidden')
      }
    }
  } else {
    ;['assetCode','assetName','assetBrand','assetModel','assetSerial','assetDepartment','assetSpecs'].forEach(f => { if ($(f)) $(f).value = '' })
    setMoneyInput('assetPurchasePrice', 0)
    setMoneyInput('assetCurrentValue', 0)
    $('assetCategory').value = 'computer'
    $('assetStatus').value = 'active'
    $('assetPurchaseDate').value = today()
    $('assetAssignedTo').value = ''
    $('assetDepreciationYears').value = '0'
    $('assetDepreciationStart').value = today()
    if ($('assignParentRow')) $('assignParentRow').classList.add('hidden')
  }
  updateDeprPreview()
  openModal('assetModal')
}

// Mở modal thêm tài sản con cho một tài sản cha
async function openAssetModalAsChild(parentId) {
  if (!allUsers.length) allUsers = await api('/users')
  const parentAsset = allAssets.find(a => a.id === parentId)
  if (!parentAsset) return

  $('assetModalTitle').innerHTML = `<i class="fas fa-sitemap text-blue-500 mr-2"></i>Thêm tài sản con`
  $('assetId').value = ''
  $('assetParentId').value = parentId

  // Hiển thị banner tài sản cha
  $('assetParentLabel').textContent = `[${parentAsset.asset_code}] ${parentAsset.name}`
  $('assetParentRow').classList.remove('hidden')
  if ($('assignParentRow')) $('assignParentRow').classList.add('hidden')
  if ($('changeParentUI')) $('changeParentUI').classList.add('hidden')

  $('assetAssignedTo').innerHTML = '<option value="">-- Không giao --</option>' +
    allUsers.filter(u => u.is_active).map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')

  // Clear các field, inherit phòng ban từ cha
  ;['assetCode','assetName','assetBrand','assetModel','assetSerial','assetSpecs'].forEach(f => { if ($(f)) $(f).value = '' })
  setMoneyInput('assetPurchasePrice', 0)
  setMoneyInput('assetCurrentValue', 0)
  $('assetCategory').value = parentAsset.category || 'computer'
  $('assetStatus').value = 'active'
  $('assetDepartment').value = parentAsset.department || ''
  $('assetAssignedTo').value = parentAsset.assigned_to || ''
  $('assetPurchaseDate').value = today()
  $('assetDepreciationYears').value = '0'
  $('assetDepreciationStart').value = today()

  updateDeprPreview()
  openModal('assetModal')
}

// Bỏ liên kết tài sản cha (chuyển thành tài sản độc lập)
function clearAssetParent() {
  $('assetParentId').value = ''
  $('assetParentRow').classList.add('hidden')
  // Hiển thị section tài sản độc lập nếu đang chỉnh sửa
  if ($('assetId').value) {
    $('assignParentRow').classList.remove('hidden')
    populateParentSelectList('assignParentSelect', null)
  }
  cancelChangeParent()
}

// Populate danh sách dropdown tài sản cha có thể chọn
// excludeId: id của tài sản hiện tại (không đưa vào list)
// currentParentId: id của tài sản cha hiện tại (để bỏ qua hoặc highlight)
function populateParentSelectList(selectId, excludeId) {
  const sel = $(selectId)
  if (!sel) return
  // Chỉ lấy các tài sản cha (không có parent_asset_id) và không phải tài sản hiện tại
  const parentAssets = allAssets.filter(a => !a.parent_asset_id && a.id !== excludeId)
  sel.innerHTML = '<option value="">-- Chọn tài sản cha --</option>' +
    parentAssets.map(a => `<option value="${a.id}">[${a.asset_code}] ${a.name}</option>`).join('')
}

// ── Toggle UI đổi tài sản cha (khi đang là tài sản con) ──
function toggleChangeParentUI() {
  const ui = $('changeParentUI')
  if (!ui) return
  const isHidden = ui.classList.contains('hidden')
  if (isHidden) {
    const currentId = $('assetId').value ? parseInt($('assetId').value) : null
    populateParentSelectList('changeParentSelect', currentId)
    ui.classList.remove('hidden')
  } else {
    ui.classList.add('hidden')
  }
}

function cancelChangeParent() {
  if ($('changeParentUI')) $('changeParentUI').classList.add('hidden')
}

function applyChangeParent() {
  const sel = $('changeParentSelect')
  if (!sel || !sel.value) { showToast('Vui lòng chọn tài sản cha', 'warning'); return }
  const parentId = parseInt(sel.value)
  const parentAsset = allAssets.find(a => a.id === parentId)
  if (!parentAsset) return
  $('assetParentId').value = parentId
  $('assetParentLabel').textContent = `[${parentAsset.asset_code}] ${parentAsset.name}`
  $('assetParentRow').classList.remove('hidden')
  $('assignParentRow').classList.add('hidden')
  cancelChangeParent()
  showToast('Đã chọn tài sản cha mới. Nhấn Lưu để áp dụng.', 'info')
}

// ── Toggle UI gắn tài sản độc lập vào tài sản cha ──
function toggleAssignParentUI() {
  const ui = $('assignParentUI')
  if (!ui) return
  const isHidden = ui.classList.contains('hidden')
  if (isHidden) {
    const currentId = $('assetId').value ? parseInt($('assetId').value) : null
    populateParentSelectList('assignParentSelect', currentId)
    ui.classList.remove('hidden')
  } else {
    ui.classList.add('hidden')
  }
}

function cancelAssignParent() {
  if ($('assignParentUI')) $('assignParentUI').classList.add('hidden')
}

function applyAssignParent() {
  const sel = $('assignParentSelect')
  if (!sel || !sel.value) { showToast('Vui lòng chọn tài sản cha', 'warning'); return }
  const parentId = parseInt(sel.value)
  const parentAsset = allAssets.find(a => a.id === parentId)
  if (!parentAsset) return
  $('assetParentId').value = parentId
  $('assetParentLabel').textContent = `[${parentAsset.asset_code}] ${parentAsset.name}`
  $('assetParentRow').classList.remove('hidden')
  $('assignParentRow').classList.add('hidden')
  cancelAssignParent()
  showToast('Đã gắn vào tài sản cha. Nhấn Lưu để áp dụng.', 'info')
}

function updateDeprPreview() {
  const yrs = parseInt($('assetDepreciationYears')?.value || '0')
  const price = parseMoneyVal('assetPurchasePrice')
  const box = $('deprPreviewBox')
  const txt = $('deprPreviewText')
  if (!box || !txt) return
  if (yrs > 0 && price > 0) {
    const monthly = price / (yrs * 12)
    const yearly = price / yrs
    box.style.display = 'block'
    txt.innerHTML = `Khấu hao <strong>${yrs} năm</strong> = <strong class="text-green-700">${fmt(monthly)}/tháng</strong> &nbsp;|&nbsp; <strong>${fmt(yearly)}/năm</strong> &nbsp;|&nbsp; Tổng: ${fmt(price)}`
  } else {
    box.style.display = 'none'
  }
}

// Live preview khi đổi giá mua
document.addEventListener('input', (e) => {
  if (e.target?.id === 'assetPurchasePrice') updateDeprPreview()
})

$('assetForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('assetId').value
  const parentId = $('assetParentId').value ? parseInt($('assetParentId').value) : null
  const data = {
    asset_code: $('assetCode').value, name: $('assetName').value,
    category: $('assetCategory').value, status: $('assetStatus').value,
    brand: $('assetBrand').value, model: $('assetModel').value,
    serial_number: $('assetSerial').value, purchase_date: $('assetPurchaseDate').value,
    purchase_price: parseMoneyVal('assetPurchasePrice'),
    current_value: parseMoneyVal('assetCurrentValue'),
    department: $('assetDepartment').value,
    assigned_to: parseInt($('assetAssignedTo').value) || null,
    specifications: $('assetSpecs').value,
    depreciation_years: parseInt($('assetDepreciationYears').value) || 0,
    depreciation_start_date: $('assetDepreciationStart').value || null,
    parent_asset_id: parentId
  }
  try {
    if (id) {
      await api(`/assets/${id}`, { method: 'put', data })
      // Backend tự động tính lại lịch KH khi có thay đổi depreciation_years, depreciation_start_date hoặc purchase_price
    } else {
      await api('/assets', { method: 'post', data })
    }
    closeModal('assetModal')
    toast(id ? 'Cập nhật tài sản thành công' : 'Thêm tài sản thành công')
    loadAssets()
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
})

async function deleteAsset(id) {
  if (!confirm('Xóa tài sản này?')) return
  try {
    await api(`/assets/${id}`, { method: 'delete' })
    toast('Đã xóa tài sản')
    loadAssets()
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

// Mở chi tiết KH từ bảng tài sản
async function openDeprDetailFromAsset(assetId) {
  navigate('depreciation')
  setTimeout(() => {
    switchDeprTab('assets')
    openDeprDetail(assetId)
  }, 400)
}

// ================================================================
// DEPRECIATION (Khấu hao tài sản)
// ================================================================
let deprSummaryData = null

async function loadDepreciation() {
  initDeprYearFilter()
  switchDeprTab('monthly')  // Luôn bắt đầu ở tab Lịch theo tháng
  await loadDepreciationSummary()
  await loadDeprPending()
}

function initDeprYearFilter() {
  const sel = $('deprYearFilter')
  if (!sel) return
  // Luôn re-init để đảm bảo options đúng
  const cur = new Date().getFullYear()
  const currentVal = sel.value ? parseInt(sel.value) : cur
  sel.innerHTML = ''
  for (let y = cur + 2; y >= cur - 5; y--) {
    const opt = document.createElement('option')
    opt.value = y; opt.textContent = `Năm ${y}`
    if (y === currentVal) opt.selected = true
    sel.appendChild(opt)
  }
  // Nếu chưa chọn năm nào, set default là năm hiện tại
  if (!sel.value) sel.value = cur
}

// Khi thay đổi năm → reset tháng về "Cả năm"
function onDeprYearChange() {
  const monthSel = $('deprMonthFilter')
  if (monthSel) monthSel.value = ''
  loadDepreciationSummary()
}

async function loadDepreciationSummary() {
  // Show loading state
  const kpiEl = $('deprKpiCards')
  const monthlyTbody = $('deprMonthlyTable')
  if (monthlyTbody) monthlyTbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>Đang tải...</td></tr>'
  try {
    const year = $('deprYearFilter')?.value || new Date().getFullYear()
    const month = $('deprMonthFilter')?.value || ''
    let url = `/depreciation/summary?year=${year}`
    if (month) url += `&month=${month}`
    deprSummaryData = await api(url)
    renderDeprKpiCards(deprSummaryData)
    renderDeprMonthlyTable(deprSummaryData)
    renderDeprAssetsTable(deprSummaryData)
    // Nếu đang filter tháng, tự switch sang tab monthly để xem chi tiết
    const selectedMonth = $('deprMonthFilter')?.value
    if (selectedMonth) switchDeprTab('monthly')
  } catch (e) { toast('Lỗi tải dữ liệu khấu hao: ' + e.message, 'error') }
}

async function loadDeprPending() {
  try {
    const rows = await api('/depreciation/monthly-unallocated?limit=24')
    renderDeprPendingTable(rows)
    // Badge - chỉ đếm 3 tháng gần nhất để badge không quá lớn
    const badge = $('deprPendingBadge')
    if (badge) {
      if (rows.length > 0) { badge.textContent = rows.length; badge.style.cssText = 'display:inline-flex!important' }
      else { badge.style.cssText = 'display:none!important' }
    }
  } catch (e) { /* silent */ }
}

function renderDeprKpiCards(data) {
  const el = $('deprKpiCards')
  if (!el || !data) return
  const st = data.total_stats || {}
  const monthlySummary = data.monthly_summary || []
  const selectedMonth = data.month
  const selectedYear = data.year

  // Tính tổng từ monthly_summary (1 tháng hoặc cả năm tùy filter)
  const totalDepr = monthlySummary.reduce((s, m) => s + (m.total_depreciation || 0), 0)
  const allocated = monthlySummary.reduce((s, m) => s + (m.allocated_amount || 0), 0)
  const pending = monthlySummary.reduce((s, m) => s + (m.pending_allocation || 0), 0)

  const periodLabel = selectedMonth
    ? `T${selectedMonth}/${selectedYear}`
    : `Năm ${selectedYear}`

  el.innerHTML = [
    { label: 'Tài sản đang KH', value: st.total_assets || 0, sub: `Tổng giá trị: ${fmtMoney(st.total_purchase_value || 0)}`, icon: 'laptop', color: '#0066CC' },
    { label: 'KH/tháng (hiện tại)', value: fmtMoney(st.total_monthly_depreciation || 0), sub: 'Tổng tất cả tài sản đang KH', icon: 'calendar-alt', color: '#8B5CF6' },
    { label: `Tổng KH ${periodLabel}`, value: fmtMoney(totalDepr), sub: `Đã phân bổ: ${fmtMoney(allocated)}`, icon: 'chart-bar', color: '#00A651' },
    { label: `Chờ phân bổ ${periodLabel}`, value: fmtMoney(pending), sub: pending > 0 ? 'Cần phân bổ vào dự án' : 'Đã phân bổ hết ✓', icon: 'clock', color: pending > 0 ? '#FF6B00' : '#6B7280' }
  ].map(s => `<div class="kpi-card" style="border-color:${s.color}">
    <div class="flex justify-between">
      <div>
        <p class="text-xs text-gray-500">${s.label}</p>
        <p class="text-lg font-bold mt-1" style="color:${s.color}">${s.value}</p>
        <p class="text-xs text-gray-400 mt-0.5">${s.sub}</p>
      </div>
      <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:${s.color}20">
        <i class="fas fa-${s.icon}" style="color:${s.color}"></i>
      </div>
    </div>
  </div>`).join('')
}

function renderDeprMonthlyTable(data) {
  const tbody = $('deprMonthlyTable')
  if (!tbody || !data) return
  const months = data.monthly_summary || []
  const curY = new Date().getFullYear()
  const curM = new Date().getMonth() + 1
  const selectedYear = parseInt($('deprYearFilter')?.value || curY)
  const selectedMonth = parseInt($('deprMonthFilter')?.value || '0') || null

  if (months.length === 0) {
    const msg = selectedMonth
      ? `Không có tài sản nào đang khấu hao trong T${selectedMonth}/${selectedYear}`
      : `Không có tài sản nào đang khấu hao trong năm ${selectedYear}`
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400">
      <i class="fas fa-info-circle mr-2"></i>${msg}
    </td></tr>`
    return
  }

  tbody.innerHTML = months.map(m => {
    const isPast = (m.year < curY) || (m.year == curY && m.month < curM)
    const isCur = (m.year == curY && m.month == curM)
    const alloc = m.allocated_amount || 0
    const pending = m.pending_allocation || 0
    const isFullAllocated = pending < 1
    return `<tr class="table-row${isCur ? ' bg-blue-50' : ''}">
      <td class="py-2.5 px-3 font-semibold text-gray-700">
        T${m.month}/${m.year}${isCur ? ' <span class="text-xs text-blue-600 ml-1">(Tháng hiện tại)</span>' : ''}
      </td>
      <td class="py-2.5 px-3 text-center text-gray-600">${m.asset_count}</td>
      <td class="py-2.5 px-3 text-right font-bold text-purple-700">${fmt(m.total_depreciation)}</td>
      <td class="py-2.5 px-3 text-right text-green-700">${fmt(alloc)}</td>
      <td class="py-2.5 px-3 text-right ${pending > 0 ? 'text-orange-600 font-semibold' : 'text-gray-400'}">${pending > 0 ? fmt(pending) : '-'}</td>
      <td class="py-2.5 px-3 text-center">
        ${isFullAllocated
          ? '<span class="badge" style="background:#d1fae5;color:#065f46"><i class="fas fa-check mr-1"></i>Đã phân bổ</span>'
          : isPast || isCur
            ? '<span class="badge" style="background:#fef3c7;color:#92400e"><i class="fas fa-clock mr-1"></i>Chờ phân bổ</span>'
            : '<span class="badge badge-todo">Chưa đến hạn</span>'
        }
      </td>
      <td class="py-2.5 px-3 text-center">
        ${(isPast || isCur) && !isFullAllocated
          ? `<button onclick="allocateDeprMonth(${m.year},${m.month})" class="btn-primary text-xs px-3 py-1.5">
               <i class="fas fa-share mr-1"></i>Phân bổ vào dự án
             </button>`
          : isFullAllocated
            ? `<span class="text-xs text-gray-400"><i class="fas fa-check-circle text-green-500 mr-1"></i>Hoàn thành</span>`
            : '<span class="text-xs text-gray-300">Chưa đến hạn</span>'
        }
      </td>
    </tr>`
  }).join('')

  // Nếu filter theo tháng cụ thể → hiển thị chi tiết tài sản trong tháng đó
  renderDeprMonthDetailSection(data)
}

// Hiển thị bảng chi tiết từng tài sản trong tháng được chọn
function renderDeprMonthDetailSection(data) {
  const detailSection = $('deprMonthDetailSection')
  if (!detailSection) return
  const monthDetail = data.month_detail || []
  const selectedMonth = parseInt($('deprMonthFilter')?.value || '0') || null
  const selectedYear = parseInt($('deprYearFilter')?.value || new Date().getFullYear())

  if (!selectedMonth || monthDetail.length === 0) {
    detailSection.style.display = 'none'
    return
  }

  detailSection.style.display = 'block'
  const tbody = detailSection.querySelector('#deprMonthDetailTable')
  if (!tbody) return

  tbody.innerHTML = monthDetail.map(row => `
    <tr class="table-row">
      <td class="py-2 px-3">
        <span class="font-mono text-xs font-bold text-primary">${row.asset_code}</span>
        <div class="text-xs text-gray-500">${row.asset_name}</div>
      </td>
      <td class="py-2 px-3 text-right text-sm">${fmt(row.purchase_price)}</td>
      <td class="py-2 px-3 text-right font-semibold text-purple-700">${fmt(row.depreciation_amount)}</td>
      <td class="py-2 px-3 text-right text-orange-600">${fmt(row.accumulated_amount)}</td>
      <td class="py-2 px-3 text-right font-bold text-primary">${fmt(row.net_book_value)}</td>
      <td class="py-2 px-3 text-center">
        ${row.is_allocated
          ? '<span class="badge" style="background:#d1fae5;color:#065f46"><i class="fas fa-check mr-1"></i>Đã PB</span>'
          : '<span class="badge badge-todo">Chưa PB</span>'}
      </td>
    </tr>
  `).join('')
}

function renderDeprAssetsTable(data) {
  const tbody = $('deprAssetsTable')
  if (!tbody || !data) return
  const assets = data.active_assets || []
  if (assets.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-400">Chưa có tài sản nào đang khấu hao</td></tr>'
    return
  }

  tbody.innerHTML = assets.map(a => {
    const totalMonths = (a.depreciation_years || 0) * 12
    const usedMonths = a.purchase_price > 0 ? Math.round((a.accumulated_depreciation || 0) / (a.monthly_depreciation || 1)) : 0
    const pct = totalMonths > 0 ? Math.min(100, Math.round(usedMonths / totalMonths * 100)) : 0
    const netVal = a.net_book_value || 0
    return `<tr class="table-row">
      <td class="py-2.5 px-3">
        <div class="font-semibold text-gray-800 text-sm">${a.asset_code}</div>
        <div class="text-xs text-gray-500">${a.name}</div>
        <div class="text-xs text-gray-400">${getAssetCategoryName(a.category)}</div>
      </td>
      <td class="py-2.5 px-3 text-right text-sm">${fmt(a.purchase_price)}</td>
      <td class="py-2.5 px-3 text-center">
        <span class="badge" style="background:#ede9fe;color:#5b21b6">${a.depreciation_years} năm</span>
      </td>
      <td class="py-2.5 px-3 text-center text-xs text-gray-600">${a.depreciation_start_date || '-'}</td>
      <td class="py-2.5 px-3 text-right font-semibold text-purple-700">${fmt(a.monthly_depreciation)}</td>
      <td class="py-2.5 px-3 text-right text-orange-600">${fmt(a.accumulated_depreciation || 0)}</td>
      <td class="py-2.5 px-3 text-right font-bold text-primary">${fmt(netVal)}</td>
      <td class="py-2.5 px-3" style="min-width:140px">
        <div class="flex items-center gap-2">
          <div class="progress-bar flex-1" style="height:8px">
            <div class="progress-fill${pct > 80 ? ' danger' : ''}" style="width:${pct}%"></div>
          </div>
          <span class="text-xs font-semibold ${pct > 80 ? 'text-red-600' : 'text-gray-600'}">${pct}%</span>
        </div>
        <div class="text-xs text-gray-400 mt-0.5">${usedMonths}/${totalMonths} tháng</div>
      </td>
      <td class="py-2.5 px-3 text-center">
        <button onclick="openDeprDetail(${a.id})" class="btn-secondary text-xs px-2 py-1">
          <i class="fas fa-list-alt mr-1"></i>Chi tiết
        </button>
      </td>
    </tr>`
  }).join('')
}

function renderDeprPendingTable(rows) {
  const tbody = $('deprPendingTable')
  if (!tbody) return
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-400"><i class="fas fa-check-circle text-green-400 text-2xl mb-2 block"></i>Tất cả đã được phân bổ!</td></tr>'
    // Cập nhật summary info nếu có
    const summaryEl = $('deprPendingSummary')
    if (summaryEl) summaryEl.innerHTML = '<span class="text-green-600 text-sm font-medium"><i class="fas fa-check-circle mr-1"></i>Tất cả đã phân bổ</span>'
    return
  }
  const totalPending = rows.reduce((s, r) => s + (r.total_depreciation || 0), 0)
  // Cập nhật summary info
  const summaryEl = $('deprPendingSummary')
  if (summaryEl) summaryEl.innerHTML = `<span class="text-orange-600 text-sm font-semibold">${rows.length} tháng chờ phân bổ — Tổng: ${fmtMoney(totalPending)}</span>`

  const curY = new Date().getFullYear()
  const curM = new Date().getMonth() + 1
  tbody.innerHTML = rows.map(r => {
    const isCurrentMonth = (r.year == curY && r.month == curM)
    const isPast = (r.year < curY) || (r.year == curY && r.month < curM)
    return `
    <tr class="table-row${isCurrentMonth ? ' bg-blue-50' : ''}">
      <td class="py-2.5 px-3 font-semibold text-gray-700">
        Tháng ${r.month}/${r.year}
        ${isCurrentMonth ? '<span class="ml-2 badge" style="background:#dbeafe;color:#1d4ed8;font-size:10px">Tháng này</span>' : ''}
        ${isPast && !isCurrentMonth ? '<span class="ml-2 badge" style="background:#fef3c7;color:#92400e;font-size:10px">Quá hạn</span>' : ''}
      </td>
      <td class="py-2.5 px-3 text-center text-gray-600">${r.asset_count} tài sản</td>
      <td class="py-2.5 px-3 text-right font-bold text-orange-600">${fmt(r.total_depreciation)}</td>
      <td class="py-2.5 px-3 text-center">
        <span id="deprPreview-${r.year}-${r.month}" class="text-xs text-gray-400 italic">
          <i class="fas fa-spinner fa-spin mr-1"></i>Đang tải...
        </span>
      </td>
      <td class="py-2.5 px-3 text-center">
        <button onclick="allocateDeprMonth(${r.year},${r.month})" class="btn-primary text-xs px-3 py-1.5">
          <i class="fas fa-share mr-1"></i>Phân bổ
        </button>
      </td>
    </tr>
  `}).join('')

  // Load preview cho từng tháng (bất đồng bộ, không block render)
  rows.forEach(r => loadDeprRowPreview(r.year, r.month))
}

// Load preview dự án cho một dòng trong bảng chờ phân bổ
async function loadDeprRowPreview(year, month) {
  const el = $(`deprPreview-${year}-${month}`)
  if (!el) return
  try {
    const preview = await api(`/depreciation/allocation-preview?year=${year}&month=${month}`)
    if (preview.eligible_count === 0) {
      el.innerHTML = '<span class="text-red-500"><i class="fas fa-exclamation-triangle mr-1"></i>Không có dự án</span>'
    } else {
      const projList = preview.eligible_projects.map(p => `<span title="${p.name} (bắt đầu ${p.start_date})" class="inline-block bg-blue-100 text-blue-700 text-xs rounded px-1.5 py-0.5 mr-1">${p.code}</span>`).join('')
      const excludedNote = preview.excluded_count > 0
        ? `<span class="text-gray-400 text-xs ml-1" title="${preview.excluded_projects.map(p=>p.code+': '+p.reason).join('; ')}">+${preview.excluded_count} chưa bắt đầu</span>`
        : ''
      el.innerHTML = projList + excludedNote
    }
  } catch {
    el.innerHTML = '<span class="text-gray-400 text-xs">-</span>'
  }
}

// Sửa dữ liệu khấu hao orphan (is_allocated=1 nhưng không có shared_cost tương ứng)
async function repairOrphanedDepr() {
  if (!confirm('Kiểm tra và sửa dữ liệu khấu hao bị lỗi?\n\nThao tác này sẽ:\n• Tìm các tháng khấu hao đã đánh dấu "đã phân bổ" nhưng không có chi phí chung tương ứng\n• Reset các tháng đó về trạng thái "chưa phân bổ"\n\nLưu ý: Thao tác này an toàn và có thể phân bổ lại sau.')) return
  try {
    const res = await api('/depreciation/repair-orphaned', { method: 'post', data: {} })
    if (res.repaired === 0) {
      toast('✅ Không có dữ liệu lỗi - tất cả dữ liệu khấu hao đều hợp lệ')
    } else {
      toast(`✅ Đã sửa ${res.repaired} dòng khấu hao lỗi cho ${res.affected_assets} tài sản\nCác tháng bị ảnh hưởng: ${res.affected_months.join(', ')}`)
    }
    await loadDepreciationSummary()
    await loadDeprPending()
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
}

async function allocateDeprMonth(year, month) {
  const monthName = `T${month}/${year}`
  try {
    // Lấy preview để biết dự án nào sẽ được phân bổ
    const preview = await api(`/depreciation/allocation-preview?year=${year}&month=${month}`)
    const fiscalYear = month < 2 ? year - 1 : year
    const fiscalLabel = preview.fiscal_year_label || `NTC${fiscalYear}`

    if (preview.eligible_count === 0) {
      toast(`Không có dự án nào đã bắt đầu từ tháng ${monthName} trở về trước để phân bổ`, 'warning')
      return
    }

    // Tạo confirm dialog chi tiết
    const eligibleLines = preview.eligible_projects.map(p =>
      `  ✅ ${p.code} - ${p.name} (bắt đầu ${p.start_date || '?'}): ${fmtMoney(p.amount)}`
    ).join('\n')
    const excludedLines = preview.excluded_projects.length > 0
      ? '\n\nDự án KHÔNG được tính (chưa bắt đầu):\n' + preview.excluded_projects.map(p =>
          `  ❌ ${p.code} - ${p.name}: ${p.reason}`
        ).join('\n')
      : ''

    const msg = `Phân bổ khấu hao tháng ${monthName} vào Chi phí chung?

Tổng khấu hao: ${fmtMoney(preview.total_depreciation)} (${preview.asset_count} tài sản)
Chia đều cho ${preview.eligible_count} dự án đã bắt đầu:

${eligibleLines}${excludedLines}

Thao tác này không thể hoàn tác.`

    if (!confirm(msg)) return

    const res = await api('/depreciation/allocate-to-shared-cost', { method: 'post', data: { year, month } })
    const ntcLabel = res.fiscal_year_label || fiscalLabel
    // Hiển thị chi tiết từng dự án trong toast
    const projDetail = res.projects
      ? res.projects.map(p => `${p.code}: ${fmtMoney(p.amount)}`).join(' | ')
      : `${fmtMoney(res.per_project)}/dự án`
    toast(`✅ Đã phân bổ ${fmtMoney(res.total_depreciation)} (${ntcLabel}) cho ${res.project_count} dự án\n${projDetail}`)
    await loadDepreciationSummary()
    await loadDeprPending()
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
}

function switchDeprTab(tab) {
  ;['monthly','assets','pending'].forEach(t => {
    const btn = $(`deprTab-${t}`)
    const content = $(`deprContent-${t}`)
    if (btn) btn.classList.toggle('active', t === tab)
    if (content) content.style.display = t === tab ? 'block' : 'none'
  })
}

// Modal chi tiết lịch KH từng tài sản
let deprDetailAssetId = null

async function openDeprDetail(assetId) {
  deprDetailAssetId = assetId
  // Khởi tạo year filter
  const sel = $('deprDetailYear')
  if (sel) {
    const cur = new Date().getFullYear()
    sel.innerHTML = ''
    for (let y = cur + 2; y >= cur - 3; y--) {
      const opt = document.createElement('option')
      opt.value = y; opt.textContent = `Năm ${y}`
      if (y === cur) opt.selected = true
      sel.appendChild(opt)
    }
  }
  openModal('deprDetailModal')
  await loadAssetDeprDetail()
}

async function loadAssetDeprDetail() {
  if (!deprDetailAssetId) return
  try {
    const year = $('deprDetailYear')?.value || new Date().getFullYear()
    const res = await api(`/assets/${deprDetailAssetId}/depreciation?year=${year}`)
    const asset = res.asset
    const schedule = res.schedule || []

    $('deprDetailTitle').textContent = `Lịch KH: ${asset.name} (${asset.asset_code})`
    const infoEl = $('deprDetailAssetInfo')
    if (infoEl) {
      infoEl.innerHTML = `
        <div><div class="text-xs text-gray-400">Giá mua</div><div class="font-bold text-gray-800">${fmt(asset.purchase_price)}</div></div>
        <div><div class="text-xs text-gray-400">KH/tháng</div><div class="font-bold text-purple-700">${fmt(asset.monthly_depreciation)}</div></div>
        <div><div class="text-xs text-gray-400">Thời hạn KH</div><div class="font-bold text-gray-700">${asset.depreciation_years} năm (${(asset.depreciation_years||0)*12} tháng)</div></div>
        <div><div class="text-xs text-gray-400">Giá trị còn lại</div><div class="font-bold text-primary">${fmt(asset.net_book_value)}</div></div>
        <div><div class="text-xs text-gray-400">Đã KH lũy kế</div><div class="font-bold text-orange-600">${fmt(asset.accumulated_depreciation)}</div></div>
        <div><div class="text-xs text-gray-400">Trạng thái KH</div><div><span class="badge text-xs" style="background:#ede9fe;color:#5b21b6">${asset.depreciation_status==='active'?'Đang KH':'Không KH'}</span></div></div>
      `
    }

    const tbody = $('deprDetailTable')
    if (tbody) {
      if (schedule.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-gray-400">Không có dữ liệu năm ${year}</td></tr>`
      } else {
        tbody.innerHTML = schedule.map(row => `
          <tr class="table-row${row.is_allocated ? '' : ''}">
            <td class="py-2 px-3 font-medium text-gray-700">Tháng ${row.month}/${row.year}</td>
            <td class="py-2 px-3 text-right text-purple-700 font-semibold">${fmt(row.depreciation_amount)}</td>
            <td class="py-2 px-3 text-right text-orange-600">${fmt(row.accumulated_amount)}</td>
            <td class="py-2 px-3 text-right text-primary font-bold">${fmt(row.net_book_value)}</td>
            <td class="py-2 px-3 text-center">
              ${row.is_allocated
                ? '<span class="badge" style="background:#d1fae5;color:#065f46"><i class="fas fa-check mr-1"></i>Đã phân bổ</span>'
                : '<span class="badge badge-todo">Chưa phân bổ</span>'}
            </td>
          </tr>
        `).join('')
      }
    }
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

// ================================================================
// USERS
// ================================================================
async function loadUsers() {
  try {
    allUsers = await api('/users?show_inactive=1')
    renderUsersTable(allUsers)
    _renderUserKpi(allUsers)
    // Hiện nút Quản lý Phòng ban + load departments cho modal nếu là system_admin
    if (currentUser?.role === 'system_admin') {
      const btn = $('btnManageDept')
      if (btn) btn.style.display = ''
    }
    await loadDepartments()
    _populateUserDeptFilter()
  } catch (e) { toast('Lỗi tải nhân sự: ' + e.message, 'error') }
}

function _renderUserKpi(users) {
  const total = users.length
  const active = users.filter(u => u.is_active).length
  const depts = new Set(users.map(u => u.department).filter(Boolean)).size
  const complete = users.filter(u => u.email && u.phone && u.department && u.cccd && u.birthday).length
  if ($('statTotalUsers')) $('statTotalUsers').textContent = total
  if ($('statActiveUsers')) $('statActiveUsers').textContent = active
  if ($('statTotalDepts')) $('statTotalDepts').textContent = depts
  if ($('statCompleteProfile')) $('statCompleteProfile').textContent = complete
}

function _populateUserDeptFilter() {
  const sel = $('userDeptFilter')
  if (!sel) return
  const current = sel.value
  sel.innerHTML = '<option value="">Tất cả phòng ban</option>'
  const depts = [...new Set(allUsers.map(u => u.department).filter(Boolean))].sort()
  depts.forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = d; sel.appendChild(o) })
  if (current) sel.value = current
}

// ── User list pagination state ────────────────────────────────────────────
const USER_PAGE_SIZE = 20
let _userCurrentPage = 1
let _userAllData     = []

function userPaginatedData() {
  const start = (_userCurrentPage - 1) * USER_PAGE_SIZE
  return _userAllData.slice(start, start + USER_PAGE_SIZE)
}

function renderUserPagination() {
  const container = $('userPagination')
  if (!container) return
  const total = _userAllData.length
  const totalPages = Math.max(1, Math.ceil(total / USER_PAGE_SIZE))
  if (totalPages <= 1) { container.innerHTML = ''; return }

  const p = _userCurrentPage
  let pages = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages = [1]
    if (p > 3) pages.push('...')
    for (let i = Math.max(2, p - 1); i <= Math.min(totalPages - 1, p + 1); i++) pages.push(i)
    if (p < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  const btn = (label, page, disabled = false, active = false) =>
    `<button onclick="userGoPage(${page})" ${disabled ? 'disabled' : ''}
      class="min-w-[32px] h-8 px-2 rounded-lg text-xs font-medium border transition-colors
      ${active ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary'}
      ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}">${label}</button>`

  const from = total === 0 ? 0 : (p - 1) * USER_PAGE_SIZE + 1
  const to   = Math.min(p * USER_PAGE_SIZE, total)

  container.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-gray-100 mt-3">
      <p class="text-xs text-gray-500">Hiển thị <strong>${from}–${to}</strong> / <strong>${total}</strong> nhân sự</p>
      <div class="flex items-center gap-1">
        ${btn('<i class="fas fa-chevron-left"></i>', p - 1, p === 1)}
        ${pages.map(pg => pg === '...'
            ? `<span class="px-1 text-gray-400 text-xs">…</span>`
            : btn(pg, pg, false, pg === p)
          ).join('')}
        ${btn('<i class="fas fa-chevron-right"></i>', p + 1, p === totalPages)}
      </div>
    </div>`
}

function userGoPage(page) {
  const totalPages = Math.max(1, Math.ceil(_userAllData.length / USER_PAGE_SIZE))
  _userCurrentPage = Math.max(1, Math.min(page, totalPages))
  renderUserRows()
  renderUserPagination()
  const tbody = $('usersTable')
  if (tbody) tbody.closest('.overflow-x-auto')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function renderUsersTable(users) {
  _userAllData     = users
  _userCurrentPage = 1
  renderUserRows()
  renderUserPagination()
}

function renderUserRows() {
  const tbody = $('usersTable')
  if (!tbody) return

  if (_userAllData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400">Không có nhân sự</td></tr>'
    return
  }

  tbody.innerHTML = userPaginatedData().map(u => `
    <tr class="table-row cursor-pointer hover:bg-primary/5 transition-colors" onclick="openUserDetail(${u.id})">
      <td class="py-2 pr-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">${u.full_name?.split(' ').pop()?.charAt(0)||'U'}</div>
          <div>
            <div class="text-sm font-medium text-gray-800">${u.full_name}</div>
            ${u.phone ? `<div class="text-xs text-gray-400">${u.phone}</div>` : ''}
          </div>
        </div>
      </td>
      <td class="py-2 pr-3 font-mono text-sm text-gray-600">${u.username}</td>
      <td class="py-2 pr-3 text-sm text-gray-600">${u.email || '-'}</td>
      <td class="py-2 pr-3 text-sm text-gray-600">${u.department || '-'}</td>
      <td class="py-2 pr-3">${getRoleBadge(u.role)}</td>
      <td class="py-2 pr-3">
        <span class="badge ${u.is_active ? 'badge-completed' : 'badge-cancelled'}">${u.is_active ? 'Hoạt động' : 'Vô hiệu'}</span>
      </td>
      <td class="py-2" onclick="event.stopPropagation()">
        <div class="flex gap-1 items-center">
          <button onclick="openUserModal(${u.id})" class="btn-secondary text-xs px-2 py-1" title="Chỉnh sửa"><i class="fas fa-edit"></i></button>
          ${u.id !== currentUser.id ? `
            <button onclick="toggleUserStatus(${u.id}, ${u.is_active})"
              class="${u.is_active ? 'text-orange-400 hover:text-orange-600' : 'text-green-400 hover:text-green-600'} px-1.5 text-sm"
              title="${u.is_active ? 'Vô hiệu hóa' : 'Kích hoạt'}">
              <i class="fas fa-${u.is_active ? 'ban' : 'check-circle'}"></i>
            </button>
            <button onclick="confirmDeleteUser(${u.id}, '${u.full_name.replace(/'/g,"\\'")}')"
              class="text-red-400 hover:text-red-600 px-1.5 text-sm" title="Xóa vĩnh viễn">
              <i class="fas fa-trash"></i>
            </button>
          ` : '<span class="text-xs text-gray-300 px-2">(bạn)</span>'}
        </div>
      </td>
    </tr>
  `).join('')
}

function filterUsers() {
  const search = $('userSearch').value.toLowerCase()
  const role = $('userRoleFilter').value
  const dept = $('userDeptFilter')?.value || ''
  const filtered = allUsers.filter(u =>
    (!search || u.full_name.toLowerCase().includes(search) || u.username.toLowerCase().includes(search) || (u.email||'').toLowerCase().includes(search)) &&
    (!role || u.role === role) &&
    (!dept || u.department === dept)
  )
  renderUsersTable(filtered)
}

// ================================================================
// USER DETAIL DRAWER
// ================================================================
let _userStatsCharts = {}

function switchUserTab(tab) {
  const isList  = tab === 'list'
  const isTable = tab === 'table'
  const isStats = tab === 'stats'

  $('panelUserList').classList.toggle('hidden', !isList)
  $('panelUserTable') && $('panelUserTable').classList.toggle('hidden', !isTable)
  $('panelUserStats').classList.toggle('hidden', !isStats)

  const activeClass  = 'px-5 py-2 rounded-lg text-sm font-medium bg-white text-primary shadow-sm transition-all'
  const inactiveClass = 'px-5 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-700 transition-all'
  $('tabUserList').className  = isList  ? activeClass : inactiveClass
  $('tabUserTable') && ($('tabUserTable').className = isTable ? activeClass : inactiveClass)
  $('tabUserStats').className = isStats ? activeClass : inactiveClass

  if (isStats) _renderUserStatsPanel()
  if (isTable) _renderStaffFullTable()
}

// ========================
// BẢNG NHÂN VIÊN ĐẦY ĐỦ
// ========================
let _staffTableData = []
let _staffTableSort = { key: 'full_name', dir: 1 }
let _staffTablePage = 1
const STAFF_TABLE_PAGE_SIZE = 20

function _renderStaffFullTable() {
  // Điền department filter từ _departmentsCache (đầy đủ phòng ban hệ thống)
  const deptSel = $('tableUserDeptFilter')
  if (deptSel) {
    const current = deptSel.value
    deptSel.innerHTML = '<option value="">Tất cả phòng ban</option>'
    const depts = (_departmentsCache && _departmentsCache.length)
      ? _departmentsCache.map(d => d.name).sort()
      : [...new Set(allUsers.map(u => u.department).filter(Boolean))].sort()
    depts.forEach(d => {
      const o = document.createElement('option')
      o.value = d; o.textContent = d
      deptSel.appendChild(o)
    })
    if (current) deptSel.value = current
  }
  filterUserTable()
}

function filterUserTable() {
  const search = ($('tableUserSearch')?.value || '').toLowerCase().trim()
  const dept   = $('tableUserDeptFilter')?.value || ''
  const role   = $('tableUserRoleFilter')?.value || ''
  const status = $('tableUserStatusFilter')?.value

  _staffTableData = allUsers.filter(u => {
    const matchSearch = !search || (u.full_name||'').toLowerCase().includes(search)
      || (u.username||'').toLowerCase().includes(search)
      || (u.cccd||'').toLowerCase().includes(search)
      || (u.email||'').toLowerCase().includes(search)
    const matchDept   = !dept   || u.department === dept
    const matchRole   = !role   || u.role === role
    const matchStatus = status === undefined || status === '' || String(u.is_active) === status
    return matchSearch && matchDept && matchRole && matchStatus
  })

  // Sort
  _staffTableData.sort((a, b) => {
    const va = (a[_staffTableSort.key] || '').toString().toLowerCase()
    const vb = (b[_staffTableSort.key] || '').toString().toLowerCase()
    return va < vb ? -_staffTableSort.dir : va > vb ? _staffTableSort.dir : 0
  })

  _staffTablePage = 1
  _renderStaffTableRows()
}

function sortUserTable(key) {
  if (_staffTableSort.key === key) _staffTableSort.dir *= -1
  else { _staffTableSort.key = key; _staffTableSort.dir = 1 }
  filterUserTable()
}

function _renderStaffTableRows() {
  const tbody = $('staffFullTableBody')
  if (!tbody) return

  const total   = _staffTableData.length
  const pages   = Math.ceil(total / STAFF_TABLE_PAGE_SIZE) || 1
  _staffTablePage = Math.min(_staffTablePage, pages)
  const start   = (_staffTablePage - 1) * STAFF_TABLE_PAGE_SIZE
  const slice   = _staffTableData.slice(start, start + STAFF_TABLE_PAGE_SIZE)

  const roleLabel = r => ({
    system_admin:'System Admin', project_admin:'Project Admin',
    project_leader:'Project Leader', member:'Member'
  }[r] || r)
  const roleBadgeClass = r => ({
    system_admin:'bg-purple-100 text-purple-700',
    project_admin:'bg-blue-100 text-blue-700',
    project_leader:'bg-green-100 text-green-600',
    member:'bg-gray-100 text-gray-600'
  }[r] || 'bg-gray-100 text-gray-600')

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="22" class="py-12 text-center text-gray-400"><i class="fas fa-search text-3xl mb-2 block"></i>Không tìm thấy nhân viên nào</td></tr>`
  } else {
    tbody.innerHTML = slice.map((u, i) => {
      const avatar = u.avatar?.startsWith('data:image/')
        ? `<img src="${u.avatar}" class="w-8 h-8 rounded-full object-cover flex-shrink-0" />`
        : `<div class="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold flex-shrink-0">${(u.full_name||'?').split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase()}</div>`
      const fmtDate = s => {
        if (!s) return '<span class="text-gray-300">—</span>'
        const d = new Date(s)
        if (isNaN(d)) return s
        return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
      }
      const cell = v => v ? `<span class="text-gray-800">${v}</span>` : '<span class="text-gray-300">—</span>'
      const genderTxt = {male:'Nam', female:'Nữ', other:'Khác'}[u.gender] || null
      const rowBg = (i % 2 === 0) ? '#ffffff' : '#f9fafb'
      return `<tr class="hover:bg-blue-50 transition-colors cursor-pointer" onmouseover="this.querySelectorAll('.sticky-col').forEach(c=>c.style.background='#eff6ff')" onmouseout="this.querySelectorAll('.sticky-col').forEach(c=>c.style.background='${rowBg}')" onclick="openUserDetail(${u.id})">
        <td class="sticky-col py-2.5 px-3 text-gray-400 text-xs border-r border-gray-100" style="position:sticky;left:0;z-index:10;background:${rowBg};min-width:42px">${start + i + 1}</td>
        <td class="sticky-col py-2.5 px-3 border-r border-gray-200" style="position:sticky;left:42px;z-index:10;background:${rowBg};min-width:200px;box-shadow:2px 0 6px rgba(0,0,0,0.08)">
          <div class="flex items-center gap-2">
            ${avatar}
            <div>
              <p class="font-medium text-gray-800 text-sm whitespace-nowrap">${u.full_name || '—'}</p>
              ${u.department ? `<p class="text-xs text-gray-400">${u.department}</p>` : ''}
            </div>
          </div>
        </td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">${cell(u.job_title)}</td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">${cell(genderTxt)}</td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">${fmtDate(u.join_date)}</td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">${cell(u.phone)}</td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">${cell(u.cccd)}</td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">${fmtDate(u.cccd_issue_date)}</td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap max-w-[150px]"><div class="truncate" title="${u.cccd_issue_place||''}">${cell(u.cccd_issue_place)}</div></td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">${fmtDate(u.birthday)}</td>
        <td class="py-2.5 px-3 text-xs text-gray-600 max-w-[150px]"><div class="truncate" title="${u.address||''}">${cell(u.address)}</div></td>
        <td class="py-2.5 px-3 text-xs text-gray-600 max-w-[150px]"><div class="truncate" title="${u.current_address||''}">${cell(u.current_address)}</div></td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">${cell(u.social_insurance_number)}</td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">${cell(u.tax_number)}</td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">${cell(u.bank_account)}</td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">${cell(u.bank_name)}</td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap max-w-[130px]"><div class="truncate" title="${u.bank_branch||''}">${cell(u.bank_branch)}</div></td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">${cell(u.degree)}</td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap max-w-[160px]"><div class="truncate" title="${u.major||''}">${cell(u.major)}</div></td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap max-w-[150px]"><div class="truncate" title="${u.university||''}">${cell(u.university)}</div></td>
        <td class="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">${cell(u.graduation_year)}</td>
        <td class="py-2.5 px-3 text-xs text-gray-400 whitespace-nowrap">${fmtDate(u.created_at)}</td>
      </tr>`
    }).join('')
  }

  // Pagination
  const pagDiv = $('userTablePagination')
  if (pagDiv) {
    if (pages <= 1) { pagDiv.innerHTML = ''; return }
    let btns = `<div class="flex items-center gap-2 justify-end mt-3 text-sm">`
    btns += `<span class="text-gray-500 text-xs">Hiển thị ${start+1}–${Math.min(start+STAFF_TABLE_PAGE_SIZE, total)} / ${total} nhân viên</span>`
    btns += `<div class="flex gap-1 ml-3">`
    for (let p = 1; p <= pages; p++) {
      if (pages > 7 && p > 2 && p < pages-1 && Math.abs(p - _staffTablePage) > 1) {
        if (p === 3 || p === pages-2) btns += `<span class="px-2 py-1 text-gray-400">…</span>`
        continue
      }
      btns += `<button onclick="_staffTablePage=${p};_renderStaffTableRows()" class="px-3 py-1 rounded-lg border text-xs transition-colors ${p===_staffTablePage?'bg-primary text-white border-primary':'border-gray-200 text-gray-600 hover:bg-gray-50'}">${p}</button>`
    }
    btns += `</div></div>`
    pagDiv.innerHTML = btns
  }
}

function exportUserTableCSV() {
  const data = _staffTableData.length ? _staffTableData : allUsers
  const roleLabel = r => ({system_admin:'System Admin',project_admin:'Project Admin',project_leader:'Project Leader',member:'Member'}[r]||r)
  const genderLabel = g => ({male:'Nam', female:'Nữ', other:'Khác'}[g] || '')
  const fmtDate = s => {
    if (!s) return ''
    const d = new Date(s)
    if (isNaN(d)) return s
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
  }
  const headers = [
    'STT','Họ và tên','Tài khoản','Phòng ban','Vai trò','Trạng thái',
    'Email','Điện thoại','Giới tính','Chức danh','Ngày vào công ty',
    'Số CCCD','Ngày cấp CCCD','Nơi cấp CCCD','Ngày sinh',
    'Thường trú','Nơi ở hiện tại',
    'Mã số BHXH','Mã số thuế (MST)',
    'Số tài khoản NH','Tên ngân hàng','Chi nhánh NH',
    'Trình độ','Chuyên ngành','Trường ĐH','Năm TN',
    'Ngày tạo'
  ]
  const rows = data.map((u, i) => [
    i+1,
    u.full_name||'',
    u.username||'',
    u.department||'',
    roleLabel(u.role),
    u.is_active ? 'Hoạt động' : 'Ngưng',
    u.email||'',
    u.phone||'',
    genderLabel(u.gender),
    u.job_title||'',
    fmtDate(u.join_date),
    u.cccd||'',
    fmtDate(u.cccd_issue_date),
    u.cccd_issue_place||'',
    fmtDate(u.birthday),
    u.address||'',
    u.current_address||'',
    u.social_insurance_number||'',
    u.tax_number||'',
    u.bank_account||'',
    u.bank_name||'',
    u.bank_branch||'',
    u.degree||'',
    u.major||'',
    u.university||'',
    u.graduation_year||'',
    fmtDate(u.created_at)
  ].map(v => `"${String(v).replace(/"/g,'""')}"`))

  const bom = '\uFEFF'
  const csv = bom + [headers.join(','), ...rows.map(r=>r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `danh_sach_nhan_vien_${new Date().toISOString().slice(0,10)}.csv`
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
  showToast('Đã xuất file CSV thành công!', 'success')
}

function _renderUserStatsPanel() {
  const users = allUsers
  if (!users.length) return

  // --- Biểu đồ phòng ban ---
  const deptMap = {}
  users.forEach(u => {
    const d = u.department || '(Chưa phân công)'
    deptMap[d] = (deptMap[d] || 0) + 1
  })
  const deptLabels = Object.keys(deptMap).sort((a, b) => deptMap[b] - deptMap[a])
  const deptData   = deptLabels.map(k => deptMap[k])
  const palette = ['#00A651','#0066CC','#FF6B00','#8B5CF6','#EC4899','#14B8A6','#F59E0B','#6366F1','#EF4444','#10B981']

  const ctxDept = $('chartDeptDist')?.getContext('2d')
  if (ctxDept) {
    if (_userStatsCharts.dept) _userStatsCharts.dept.destroy()
    _userStatsCharts.dept = new Chart(ctxDept, {
      type: 'bar',
      data: {
        labels: deptLabels,
        datasets: [{ label: 'Nhân sự', data: deptData,
          backgroundColor: deptLabels.map((_, i) => palette[i % palette.length] + 'CC'),
          borderColor: deptLabels.map((_, i) => palette[i % palette.length]),
          borderWidth: 1.5, borderRadius: 6 }]
      },
      options: { responsive: true, plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    })
  }

  // --- Biểu đồ vai trò ---
  const roleLabels = ['System Admin','Project Admin','Project Leader','Member']
  const roleKeys   = ['system_admin','project_admin','project_leader','member']
  const roleData   = roleKeys.map(r => users.filter(u => u.role === r).length)
  const ctxRole = $('chartRoleDist')?.getContext('2d')
  if (ctxRole) {
    if (_userStatsCharts.role) _userStatsCharts.role.destroy()
    _userStatsCharts.role = new Chart(ctxRole, {
      type: 'doughnut',
      data: { labels: roleLabels, datasets: [{ data: roleData,
        backgroundColor: ['#8B5CF6CC','#0066CCCC','#00A651CC','#F59E0BCC'],
        borderColor: ['#8B5CF6','#0066CC','#00A651','#F59E0B'], borderWidth: 2 }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    })
  }

  // --- Bảng tổng hợp theo phòng ban ---
  const tbody = $('statsDeptTable')
  if (!tbody) return
  const allDepts = [...new Set(users.map(u => u.department || '(Chưa phân công)'))].sort()
  tbody.innerHTML = allDepts.map(dept => {
    const grp = users.filter(u => (u.department || '(Chưa phân công)') === dept)
    const active = grp.filter(u => u.is_active).length
    const admins = grp.filter(u => ['system_admin','project_admin'].includes(u.role)).length
    const leaders = grp.filter(u => u.role === 'project_leader').length
    const members = grp.filter(u => u.role === 'member').length
    const hasEmail = grp.filter(u => u.email).length
    const fullProfile = grp.filter(u => u.email && u.phone && u.cccd && u.birthday).length
    const pct = grp.length ? Math.round(fullProfile / grp.length * 100) : 0
    return `<tr class="hover:bg-gray-50 transition-colors">
      <td class="py-2.5 pr-4 font-medium text-gray-800 text-sm">${dept}</td>
      <td class="py-2.5 pr-4 text-center"><span class="font-bold text-gray-800">${grp.length}</span></td>
      <td class="py-2.5 pr-4 text-center"><span class="text-green-600 font-medium">${active}</span></td>
      <td class="py-2.5 pr-4 text-center text-purple-600">${admins || '-'}</td>
      <td class="py-2.5 pr-4 text-center text-blue-600">${leaders || '-'}</td>
      <td class="py-2.5 pr-4 text-center text-gray-600">${members || '-'}</td>
      <td class="py-2.5 pr-4 text-center text-sm">${hasEmail}/${grp.length}</td>
      <td class="py-2.5 text-center">
        <div class="flex items-center gap-2 justify-center">
          <div class="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full ${pct>=80?'bg-green-500':pct>=50?'bg-yellow-400':'bg-red-400'}" style="width:${pct}%"></div>
          </div>
          <span class="text-xs font-medium text-gray-600">${pct}%</span>
        </div>
      </td>
    </tr>`
  }).join('')
}

// --- Drawer chi tiết nhân sự ---
async function openUserDetail(userId) {
  const user = allUsers.find(u => u.id === userId)
  if (!user) return
  // Lấy thêm chi tiết đầy đủ từ server (có cccd, birthday, degree...)
  let detail = user
  try { detail = await api(`/users/${userId}/detail`) } catch(_) {}

  const drawer = $('userDetailDrawer')
  const panel  = $('userDetailPanel')
  drawer.style.display = 'block'
  setTimeout(() => panel.style.transform = 'translateX(0)', 10)

  // Nút chỉnh sửa
  const editBtn = $('btnEditFromDetail')
  if (editBtn) editBtn.onclick = () => { closeUserDetail(); openUserModal(userId) }

  // Nút reset mật khẩu (chỉ system_admin)
  const resetPwBtn = $('btnResetPwFromDetail')
  if (resetPwBtn) {
    if (currentUser.role === 'system_admin') {
      resetPwBtn.style.display = ''
      resetPwBtn.onclick = () => resetUserPassword(userId, detail.full_name || detail.username)
    } else {
      resetPwBtn.style.display = 'none'
    }
  }

  // Render nội dung
  const initials = detail.full_name?.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase() || 'U'
  const avatarHtml = detail.avatar?.startsWith('data:image/')
    ? `<img src="${detail.avatar}" class="w-20 h-20 rounded-full object-cover" />`
    : `<div class="w-20 h-20 rounded-full bg-primary flex items-center justify-center text-white text-2xl font-bold">${initials}</div>`

  const row = (icon, label, val, cls='') => val
    ? `<div class="flex gap-3 py-2 border-b border-gray-50 last:border-0">
        <i class="fas fa-${icon} text-primary w-4 mt-0.5 flex-shrink-0 text-sm"></i>
        <div class="min-w-0"><p class="text-xs text-gray-400">${label}</p><p class="text-sm font-medium text-gray-800 break-words ${cls}">${val}</p></div>
       </div>` : ''

  const fmtD = s => {
    if (!s) return null
    const d = new Date(s)
    if (isNaN(d)) return s
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
  }
  const genderTxt = {male:'Nam', female:'Nữ', other:'Khác'}[detail.gender] || null

  $('userDetailBody').innerHTML = `
    <!-- Avatar + tên -->
    <div class="flex items-center gap-4 mb-6">
      ${avatarHtml}
      <div class="min-w-0">
        <h2 class="text-xl font-bold text-gray-800">${detail.full_name}</h2>
        <div class="flex items-center gap-2 mt-1">${getRoleBadge(detail.role)}</div>
        ${detail.job_title ? `<p class="text-sm text-gray-500 mt-0.5"><i class="fas fa-briefcase mr-1 text-primary"></i>${detail.job_title}</p>` : ''}
        <p class="text-sm text-gray-400 mt-0.5 font-mono">@${detail.username}</p>
      </div>
      <div class="ml-auto flex-shrink-0">
        <span class="badge ${detail.is_active ? 'badge-completed' : 'badge-cancelled'} text-xs">${detail.is_active ? 'Hoạt động' : 'Vô hiệu'}</span>
      </div>
    </div>

    <!-- Thông tin cá nhân -->
    <div class="mb-4">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2"><i class="fas fa-user mr-1.5"></i>Thông tin cá nhân</p>
      <div class="bg-gray-50 rounded-xl px-4">
        ${row('envelope','Email',detail.email)}
        ${row('phone','Số điện thoại',detail.phone)}
        ${row('building','Phòng ban/Bộ môn',detail.department)}
        ${row('venus-mars','Giới tính',genderTxt)}
        ${row('birthday-cake','Ngày sinh',fmtD(detail.birthday))}
        ${row('calendar-plus','Ngày vào công ty',fmtD(detail.join_date))}
      </div>
    </div>

    <!-- Giấy tờ tùy thân -->
    ${(detail.cccd || detail.cccd_issue_date || detail.cccd_issue_place) ? `
    <div class="mb-4">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2"><i class="fas fa-id-card mr-1.5"></i>Giấy tờ tùy thân</p>
      <div class="bg-gray-50 rounded-xl px-4">
        ${row('id-card','Số CCCD',detail.cccd)}
        ${row('calendar','Ngày cấp CCCD',fmtD(detail.cccd_issue_date))}
        ${row('map-pin','Nơi cấp CCCD',detail.cccd_issue_place)}
      </div>
    </div>` : ''}

    <!-- Địa chỉ -->
    ${(detail.address || detail.current_address) ? `
    <div class="mb-4">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2"><i class="fas fa-map-marker-alt mr-1.5"></i>Địa chỉ</p>
      <div class="bg-gray-50 rounded-xl px-4">
        ${row('map-marker-alt','Thường trú',detail.address)}
        ${row('home','Nơi ở hiện tại',detail.current_address)}
      </div>
    </div>` : ''}

    <!-- Bảo hiểm & Thuế -->
    ${(detail.social_insurance_number || detail.tax_number) ? `
    <div class="mb-4">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2"><i class="fas fa-shield-alt mr-1.5"></i>Bảo hiểm & Thuế</p>
      <div class="bg-gray-50 rounded-xl px-4">
        ${row('shield-alt','Mã số BHXH',detail.social_insurance_number)}
        ${row('file-invoice','Mã số thuế (MST)',detail.tax_number)}
      </div>
    </div>` : ''}

    <!-- Ngân hàng -->
    ${(detail.bank_account || detail.bank_name || detail.bank_branch) ? `
    <div class="mb-4">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2"><i class="fas fa-university mr-1.5"></i>Thông tin ngân hàng</p>
      <div class="bg-gray-50 rounded-xl px-4">
        ${row('credit-card','Số tài khoản',detail.bank_account)}
        ${row('university','Tên ngân hàng',detail.bank_name)}
        ${row('code-branch','Chi nhánh',detail.bank_branch)}
      </div>
    </div>` : ''}

    <!-- Học vấn -->
    ${(detail.degree || detail.major || detail.university || detail.graduation_year) ? `
    <div class="mb-4">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2"><i class="fas fa-graduation-cap mr-1.5"></i>Học vấn</p>
      <div class="bg-gray-50 rounded-xl px-4">
        ${row('award','Trình độ',detail.degree)}
        ${row('book','Chuyên ngành',detail.major)}
        ${row('university','Trường đại học',detail.university)}
        ${row('calendar-check','Năm tốt nghiệp',detail.graduation_year)}
      </div>
    </div>` : ''}

    <!-- Hồ sơ hoàn thiện -->
    <div class="mt-4">
      ${_profileCompletenessHtml(detail)}
    </div>
  `
}

function _profileCompletenessHtml(u) {
  const fields = [
    { label: 'Email',        ok: !!u.email },
    { label: 'SĐT',         ok: !!u.phone },
    { label: 'Phòng ban',   ok: !!u.department },
    { label: 'Giới tính',   ok: !!u.gender },
    { label: 'Chức danh',   ok: !!u.job_title },
    { label: 'Ngày vào CT', ok: !!u.join_date },
    { label: 'CCCD',        ok: !!u.cccd },
    { label: 'Ngày cấp CC', ok: !!u.cccd_issue_date },
    { label: 'Nơi cấp CC',  ok: !!u.cccd_issue_place },
    { label: 'Ngày sinh',   ok: !!u.birthday },
    { label: 'Thường trú',  ok: !!u.address },
    { label: 'Nơi ở HT',   ok: !!u.current_address },
    { label: 'BHXH',        ok: !!u.social_insurance_number },
    { label: 'MST',         ok: !!u.tax_number },
    { label: 'Số TK NH',    ok: !!u.bank_account },
    { label: 'Tên NH',      ok: !!u.bank_name },
    { label: 'Trình độ',    ok: !!u.degree },
    { label: 'Chuyên ngành',ok: !!u.major },
    { label: 'Trường ĐH',   ok: !!u.university },
  ]
  const done = fields.filter(f => f.ok).length
  const pct  = Math.round(done / fields.length * 100)
  const color = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-400' : 'bg-red-400'
  return `
    <div class="bg-gray-50 rounded-xl p-4">
      <div class="flex justify-between items-center mb-2">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Mức độ hoàn thiện hồ sơ</p>
        <span class="text-sm font-bold ${pct>=80?'text-green-600':pct>=50?'text-yellow-500':'text-red-500'}">${pct}%</span>
      </div>
      <div class="w-full h-2 bg-gray-200 rounded-full mb-3 overflow-hidden">
        <div class="${color} h-full rounded-full transition-all" style="width:${pct}%"></div>
      </div>
      <div class="flex flex-wrap gap-1.5">
        ${fields.map(f => `<span class="text-xs px-2 py-0.5 rounded-full font-medium ${f.ok ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-400 line-through'}">${f.label}</span>`).join('')}
      </div>
    </div>`
}

async function resetUserPassword(userId, fullName) {
  const defaultPw = 'Bim@2024'
  const custom = prompt(`Đặt lại mật khẩu cho "${fullName}".\nNhập mật khẩu mới (để trống = dùng mặc định: ${defaultPw}):`)
  if (custom === null) return  // user cancelled
  const newPw = custom.trim() || defaultPw
  try {
    const res = await api(`/users/${userId}/reset-password`, { method: 'post', data: { password: newPw } })
    toast(`✅ ${res.message}`, 'success')
  } catch(e) {
    toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error')
  }
}

function closeUserDetail() {
  const panel = $('userDetailPanel')
  const drawer = $('userDetailDrawer')
  if (panel) panel.style.transform = 'translateX(100%)'
  setTimeout(() => { if (drawer) drawer.style.display = 'none' }, 300)
}

// Đóng drawer khi nhấn Escape
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeUserDetail() })

async function openUserModal(userId = null) {
  $('userModalTitle').textContent = userId ? 'Chỉnh sửa tài khoản' : 'Tạo tài khoản mới'
  $('userId').value = userId || ''

  // Submit button text
  const submitBtn = $('userSubmitBtn')
  if (submitBtn) submitBtn.textContent = userId ? 'Lưu thay đổi' : 'Tạo tài khoản'

  // Username: có thể sửa khi edit (system_admin), hiển thị hint
  const usernameInput = $('userUsername')
  const usernameHint  = $('userUsernameHint')
  if (userId) {
    if (usernameInput) usernameInput.disabled = false  // cho phép sửa
    if (usernameHint)  usernameHint.classList.remove('hidden')
    $('userPassword').required = false
    $('userPassword').placeholder = 'Để trống nếu không đổi'
  } else {
    if (usernameInput) usernameInput.disabled = false
    if (usernameHint)  usernameHint.classList.add('hidden')
    $('userPassword').required = true
    $('userPassword').placeholder = 'Mật khẩu ban đầu'
  }

  if (userId) {
    const user = allUsers.find(u => u.id === userId)
    if (user) {
      $('userUsername').value = user.username || ''
      $('userFullName').value = user.full_name || ''
      $('userEmail').value = user.email || ''
      $('userPhone').value = user.phone || ''
      $('userRole').value = user.role || 'member'
      // Populate department dropdown từ cache rồi set giá trị
      _populateDeptDropdowns()
      $('userDepartment').value = user.department || ''
      setMoneyInput('userSalary', user.salary_monthly || 0)
      $('userPassword').value = ''
    }
  } else {
    $('userUsername').value = ''
    $('userPassword').value = ''
    $('userFullName').value = ''
    $('userEmail').value = ''
    $('userPhone').value = ''
    $('userRole').value = 'member'
    $('userDepartment').value = ''
    setMoneyInput('userSalary', 0)
  }
  openModal('userModal')
}

$('userForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('userId').value
  const username = $('userUsername').value.trim()
  const password = $('userPassword').value

  if (!id && !password) { toast('Nhập mật khẩu', 'warning'); return }
  if (!username) { toast('Tên đăng nhập không được để trống', 'warning'); return }

  const data = {
    username,
    full_name: $('userFullName').value,
    email: $('userEmail').value,
    phone: $('userPhone').value,
    role: $('userRole').value,
    department: ($('userDepartment')?.value) || '',
    salary_monthly: parseMoneyVal('userSalary')
  }
  if (password) data.password = password

  try {
    if (id) await api(`/users/${id}`, { method: 'put', data })
    else     await api('/users', { method: 'post', data })
    closeModal('userModal')
    toast(id ? 'Cập nhật tài khoản thành công' : 'Tạo tài khoản thành công')
    loadUsers()
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
})

async function toggleUserStatus(id, isActive) {
  if (!confirm(isActive ? 'Vô hiệu hóa tài khoản này?' : 'Kích hoạt tài khoản này?')) return
  try {
    await api(`/users/${id}`, { method: 'put', data: { is_active: isActive ? 0 : 1 } })
    toast(isActive ? 'Đã vô hiệu hóa' : 'Đã kích hoạt')
    loadUsers()
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

function confirmDeleteUser(id, name) {
  showConfirmDelete(
    'Xóa tài khoản',
    `<p>Bạn có chắc muốn <strong class="text-red-600">XÓA VĨNH VIỄN</strong> tài khoản <strong>"${name}"</strong>?</p>
     <p class="text-red-600 mt-2 text-xs font-bold">⚠️ Toàn bộ dữ liệu liên quan (timesheet, thành viên dự án, thông báo) sẽ bị xóa và không thể khôi phục!</p>`,
    async () => {
      try {
        const res = await api(`/users/${id}`, { method: 'delete' })
        toast(res?.message || 'Đã xóa tài khoản thành công')
        loadUsers()
      } catch (e) { toast('Lỗi xóa: ' + (e.response?.data?.error || e.message), 'error') }
    }
  )
}

// ================================================================
// PROFILE
// ================================================================
function switchGuideTab(tab) {
  // Update tab buttons
  document.querySelectorAll('.guide-tab-btn').forEach(btn => {
    const isActive = btn.id === `guideTab-${tab}`
    btn.className = isActive
      ? 'guide-tab-btn active flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border-2 border-primary bg-primary text-white transition-all'
      : 'guide-tab-btn flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border-2 border-gray-200 text-gray-600 hover:border-primary hover:text-primary transition-all'
  })
  // Show/hide panels
  document.querySelectorAll('.guide-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `guidePanel-${tab}`)
  })
}

function switchMGuideTab(tab) {
  // Update tab buttons in the guide modal
  document.querySelectorAll('.mguide-tab-btn').forEach(btn => {
    const isActive = btn.id === `mGuideTab-${tab}`
    btn.className = isActive
      ? 'mguide-tab-btn active-mguide flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border-2 border-primary bg-primary text-white transition-all whitespace-nowrap'
      : 'mguide-tab-btn flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border-2 border-gray-200 text-gray-600 hover:border-primary hover:text-primary transition-all whitespace-nowrap'
  })
  // Show/hide panels in the guide modal
  document.querySelectorAll('.mguide-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `mGuidePanel-${tab}`)
  })
}

// ================================================================
// DEPARTMENTS — Quản lý phòng ban
// ================================================================
let _departmentsCache = []

async function loadDepartments() {
  try {
    _departmentsCache = await api('/departments')
  } catch (e) {
    _departmentsCache = []
  }
  _populateDeptDropdowns()
  return _departmentsCache
}

// Điền options vào tất cả <select> phòng ban trong trang
function _populateDeptDropdowns() {
  const selectors = ['#profileDeptInput', '#userDepartment']
  selectors.forEach(sel => {
    const el = document.querySelector(sel)
    if (!el) return
    const current = el.value
    // Giữ option đầu tiên (-- Chọn phòng ban --)
    el.innerHTML = '<option value="">-- Chọn phòng ban --</option>'
    _departmentsCache.forEach(d => {
      const opt = document.createElement('option')
      opt.value = d.name
      opt.textContent = d.name
      el.appendChild(opt)
    })
    // Khôi phục giá trị đang chọn
    if (current) el.value = current
  })
}

// ---- Modal quản lý phòng ban (System Admin only) ----
async function openDeptModal() {
  cancelDeptEdit()
  await _renderDeptList()
  openModal('deptModal')
}

async function _renderDeptList() {
  const listEl = $('deptList')
  if (!listEl) return
  try {
    const depts = await api('/departments')
    _departmentsCache = depts
    if (!depts.length) {
      listEl.innerHTML = '<p class="text-center text-gray-400 py-4 text-sm">Chưa có phòng ban nào</p>'
      return
    }
    listEl.innerHTML = depts.map(d => `
      <div class="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-2.5 hover:border-primary/30 transition-colors">
        <span class="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">${d.sort_order || '·'}</span>
        <div class="flex-1 min-w-0">
          <p class="font-medium text-gray-800 text-sm">${d.name}</p>
          ${d.description ? `<p class="text-xs text-gray-400 truncate">${d.description}</p>` : ''}
        </div>
        <div class="flex gap-1.5 flex-shrink-0">
          <button onclick="editDept(${d.id},'${d.name.replace(/'/g,"\\'")}','${(d.description||'').replace(/'/g,"\\'")}',${d.sort_order||0})"
            class="w-7 h-7 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center transition-colors" title="Sửa">
            <i class="fas fa-pen text-xs"></i>
          </button>
          <button onclick="deleteDept(${d.id},'${d.name.replace(/'/g,"\\'")}')"
            class="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center transition-colors" title="Xóa">
            <i class="fas fa-trash text-xs"></i>
          </button>
        </div>
      </div>`).join('')
  } catch (e) {
    listEl.innerHTML = '<p class="text-center text-red-400 py-4 text-sm">Lỗi tải danh sách</p>'
  }
}

function editDept(id, name, description, sortOrder) {
  $('deptEditId').value = id
  $('deptName').value = name
  $('deptDescription').value = description
  $('deptSortOrder').value = sortOrder
  $('deptFormTitle').innerHTML = '<i class="fas fa-pen mr-1 text-blue-500"></i>Chỉnh sửa phòng ban'
  $('deptSaveLabel').textContent = 'Lưu thay đổi'
  $('btnCancelDeptEdit').classList.remove('hidden')
  $('deptName').focus()
}

function cancelDeptEdit() {
  $('deptEditId').value = ''
  $('deptName').value = ''
  $('deptDescription').value = ''
  $('deptSortOrder').value = ''
  $('deptFormTitle').innerHTML = '<i class="fas fa-plus-circle mr-1 text-primary"></i>Thêm phòng ban mới'
  $('deptSaveLabel').textContent = 'Thêm mới'
  $('btnCancelDeptEdit').classList.add('hidden')
}

async function saveDept() {
  const id = $('deptEditId').value
  const name = $('deptName').value.trim()
  const description = $('deptDescription').value.trim()
  const sortOrder = parseInt($('deptSortOrder').value) || 0
  if (!name) { toast('Nhập tên phòng ban', 'warning'); return }
  try {
    if (id) {
      await api(`/departments/${id}`, { method: 'put', data: { name, description, sort_order: sortOrder } })
      toast('Đã cập nhật phòng ban', 'success')
    } else {
      await api('/departments', { method: 'post', data: { name, description, sort_order: sortOrder } })
      toast('Đã thêm phòng ban mới', 'success')
    }
    cancelDeptEdit()
    await _renderDeptList()
    await loadDepartments()   // Refresh dropdowns khắp trang
  } catch (e) {
    toast(e.response?.data?.error || e.message, 'error')
  }
}

async function deleteDept(id, name) {
  if (!confirm(`Xóa phòng ban "${name}"?\nKhông thể xóa nếu còn nhân sự thuộc phòng ban này.`)) return
  try {
    await api(`/departments/${id}`, { method: 'delete' })
    toast('Đã xóa phòng ban', 'success')
    await _renderDeptList()
    await loadDepartments()
  } catch (e) {
    toast(e.response?.data?.error || e.message, 'error')
  }
}

async function loadProfile() {
  // Load departments trước để populate dropdown
  await loadDepartments()

  let user = null
  try {
    user = await api('/auth/me')
    currentUser = { ...currentUser, ...user }

    // --- Avatar ---
    const avatarImg = $('profileAvatarImg')
    const avatarText = $('profileAvatar')
    if (user.avatar && user.avatar.startsWith('data:image/')) {
      avatarImg.src = user.avatar
      avatarImg.classList.remove('hidden')
      avatarText.classList.add('hidden')
    } else {
      const initials = user.full_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'U'
      avatarText.textContent = initials
      avatarImg.classList.add('hidden')
      avatarText.classList.remove('hidden')
    }

    // --- Thẻ trái ---
    const initials = user.full_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'U'
    $('profileName').textContent = user.full_name
    $('profileRole').textContent = getRoleLabel(user.role)
    $('profileDept').textContent = user.department || '-'
    $('profileDeptDisplay').textContent = user.department || '-'
    $('profileDegreeDisplay').textContent = user.degree || '-'
    $('profileJobTitleDisplay').textContent = user.job_title || '-'
    $('profileGenderDisplay').textContent = ({male:'Nam', female:'Nữ', other:'Khác'}[user.gender]) || '-'
    $('profileJoinDateDisplay').textContent = user.join_date ? formatBirthday(user.join_date) : '-'
    $('profileEmail').textContent = user.email || '-'
    $('profilePhone').textContent = user.phone || '-'
    $('profileCccdDisplay').textContent = user.cccd || '-'
    $('profileBirthdayDisplay').textContent = user.birthday ? formatBirthday(user.birthday) : '-'
    $('profileAddressDisplay').textContent = user.address || '-'
    $('profileCurrentAddressDisplay').textContent = user.current_address || '-'
    $('profileMajorDisplay').textContent = user.major || '-'
    $('profileUniversityDisplay').textContent = user.university || '-'
    $('profileGraduationYearDisplay').textContent = user.graduation_year || '-'

    // --- Form inputs ---
    $('profileFullName').value = user.full_name || ''
    $('profileEmailInput').value = user.email || ''
    $('profilePhoneInput').value = user.phone || ''
    $('profileDeptInput').value = user.department || ''
    $('profileGenderInput').value = user.gender || ''
    $('profileJobTitleInput').value = user.job_title || ''
    $('profileJoinDateInput').value = user.join_date || ''
    $('profileDegreeInput').value = user.degree || ''
    $('profileCccdInput').value = user.cccd || ''
    $('profileCccdIssueDateInput').value = user.cccd_issue_date || ''
    $('profileCccdIssuePlaceInput').value = user.cccd_issue_place || ''
    $('profileBirthdayInput').value = user.birthday || ''
    $('profileAddressInput').value = user.address || ''
    $('profileCurrentAddressInput').value = user.current_address || ''
    $('profileSocialInsuranceInput').value = user.social_insurance_number || ''
    $('profileTaxNumberInput').value = user.tax_number || ''
    $('profileBankAccountInput').value = user.bank_account || ''
    $('profileBankNameInput').value = user.bank_name || ''
    $('profileBankBranchInput').value = user.bank_branch || ''
    $('profileMajorInput').value = user.major || ''
    $('profileUniversityInput').value = user.university || ''
    $('profileGraduationYearInput').value = user.graduation_year || ''
  } catch (e) { toast('Lỗi tải profile', 'error') }

  // Sync avatar lên topbar/sidebar
  _syncTopbarAvatar()

  // Show email settings card only for system_admin
  const emailCard = $('emailSettingsCard')
  if (emailCard) {
    if (user?.role === 'system_admin') {
      emailCard.classList.remove('hidden')
      // Load weekly report config & preview
      loadWeeklyReportConfig()
    } else {
      emailCard.classList.add('hidden')
    }
  }
  // Show weekly report card only for system_admin
  const weeklyCard = $('weeklyReportCard')
  if (weeklyCard) {
    if (user?.role === 'system_admin') {
      weeklyCard.classList.remove('hidden')
    } else {
      weeklyCard.classList.add('hidden')
    }
  }

  // Render browser push notification toggle
  renderPushButton()
}

// ================================================================
// EMAIL NOTIFICATION SETTINGS (removed — all 4 events are always-on)
// Settings card is shown only to system_admin (handled in loadProfile)
// ================================================================

// ================================================================
// PROFILE HELPERS
// ================================================================
function formatBirthday(dateStr) {
  if (!dateStr) return '-'
  // dateStr là dạng YYYY-MM-DD
  const parts = dateStr.split('-')
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`
  return dateStr
}

function _syncTopbarAvatar() {
  // Cập nhật avatar/chữ tắt trên topbar và sidebar
  const user = currentUser
  if (!user) return
  const initials = user.full_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'U'
  const sidebarAvatar = $('sidebarAvatar')
  const sidebarAvatarMini = $('sidebarAvatarMini')
  if (sidebarAvatar) sidebarAvatar.textContent = initials
  if (sidebarAvatarMini) sidebarAvatarMini.textContent = initials
  if (user.avatar && user.avatar.startsWith('data:image/')) {
    _applyAvatarToTopbar(user.avatar)
  }
}

// Thay chữ tắt trên topbar/sidebar bằng ảnh avatar
function _applyAvatarToTopbar(avatarDataUrl) {
  // topbar avatar
  const topbarEl = $('topbarAvatar')
  if (topbarEl) {
    topbarEl.innerHTML = `<img src="${avatarDataUrl}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
  }
  // sidebar avatar
  const sidebarEl = $('sidebarAvatar')
  if (sidebarEl) {
    sidebarEl.innerHTML = `<img src="${avatarDataUrl}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
  }
}

// Upload avatar: đọc file → base64 → POST API
async function handleAvatarUpload(event) {
  const file = event.target.files[0]
  if (!file) return
  if (!file.type.startsWith('image/')) { toast('Vui lòng chọn file ảnh', 'warning'); return }
  if (file.size > 600 * 1024) { toast('Ảnh quá lớn, vui lòng chọn ảnh nhỏ hơn 600KB', 'warning'); return }

  // Resize ảnh xuống tối đa 200x200 trước khi upload
  const base64 = await _resizeImageToBase64(file, 200)

  try {
    toast('Đang tải ảnh lên...', 'info')
    const res = await api('/auth/upload-avatar', { method: 'post', data: { avatar: base64 } })
    if (res.success) {
      // Hiển thị ảnh mới ngay lập tức
      const avatarImg = $('profileAvatarImg')
      const avatarText = $('profileAvatar')
      avatarImg.src = base64
      avatarImg.classList.remove('hidden')
      avatarText.classList.add('hidden')
      currentUser.avatar = base64
      toast('Cập nhật ảnh đại diện thành công!', 'success')
    }
  } catch (e) {
    toast('Lỗi tải ảnh: ' + (e.response?.data?.error || e.message), 'error')
  }
  // Reset input để có thể chọn lại cùng file
  event.target.value = ''
}

// Resize ảnh về maxSize x maxSize, trả về base64 string
function _resizeImageToBase64(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let w = img.width, h = img.height
        if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize } }
        else { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize } }
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = reject
      img.src = e.target.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ================================================================
// EMAIL ADMIN PAGE
// ================================================================
let _emailLogsCache = []

async function loadEmailAdmin() {
  await loadEmailConfig()
  await refreshEmailLogs()
  await loadEmailRecipients()
}

async function loadEmailConfig() {
  try {
    const config = await api('/system-config')
    if (config.resend_api_key?.configured) {
      const el = $('cfgResendApiKey')
      if (el) el.placeholder = '(đã cấu hình — nhập để thay đổi)'
      const statusEl = $('emailConfigStatus')
      if (statusEl) { statusEl.textContent = '✅ API Key đã cấu hình'; statusEl.className = 'font-bold text-green-600' }
    }
    if (config.email_from_name?.value) {
      const el = $('cfgEmailFromName')
      if (el) el.value = config.email_from_name.value
    }
  } catch (e) { /* ignore */ }
}

async function verifyAndSaveApiKey() {
  const apiKey = $('cfgResendApiKey')?.value?.trim()
  const fromName = $('cfgEmailFromName')?.value?.trim()
  const statusEl = $('emailConfigSaveStatus')
  const btn = $('btnVerifySave')

  if (!apiKey && !fromName) { toast('Vui lòng nhập API Key hoặc tên hiển thị', 'warning'); return }

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang xác minh...' }
  if (statusEl) statusEl.textContent = ''

  try {
    // Nếu có API key mới → verify trước
    if (apiKey) {
      if (statusEl) { statusEl.textContent = '🔍 Đang kiểm tra key...'; statusEl.className = 'text-sm text-blue-600' }
      const verifyRes = await api('/system-config/verify-email-key', { method: 'POST', data: { api_key: apiKey } })
      if (!verifyRes.valid) {
        toast('❌ API Key không hợp lệ: ' + verifyRes.error, 'error')
        if (statusEl) { statusEl.textContent = '❌ Key không hợp lệ'; statusEl.className = 'text-sm text-red-600' }
        return
      }
      toast('✅ API Key hợp lệ! Đang lưu...', 'success')
    }

    // Lưu cấu hình
    const payload = {}
    if (apiKey) payload.resend_api_key = apiKey
    if (fromName) payload.email_from_name = fromName
    await api('/system-config', { method: 'PUT', data: payload })

    if (statusEl) { statusEl.textContent = '✅ Đã lưu & xác minh'; statusEl.className = 'text-sm text-green-600' }
    if (apiKey) {
      const keyEl = $('cfgResendApiKey')
      if (keyEl) { keyEl.value = ''; keyEl.placeholder = '✅ API Key đã cấu hình & hợp lệ' }
      const configStatusEl = $('emailConfigStatus')
      if (configStatusEl) { configStatusEl.textContent = '✅ Đã cấu hình'; configStatusEl.className = 'font-bold text-green-600' }
    }
    toast('✅ Cấu hình email đã được lưu thành công!', 'success')
  } catch(e) {
    toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error')
    if (statusEl) { statusEl.textContent = '❌ Lỗi'; statusEl.className = 'text-sm text-red-600' }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle"></i> Xác minh & Lưu' }
  }
}

async function saveEmailConfig() {
  return verifyAndSaveApiKey()
}

async function sendTestEmailFromConfig() {
  const toEmail = currentUser?.email
  if (!toEmail) { toast('Không tìm thấy email của bạn. Cập nhật email trong Hồ sơ.', 'warning'); return }
  const btn = $('btnTestEmailConfig')
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang gửi...' }
  try {
    const res = await api('/email-settings/test', { method: 'POST', data: { to_email: toEmail } })
    toast('✅ ' + (res.message || `Email test đã gửi đến ${toEmail}`), 'success')
    setTimeout(() => refreshEmailLogs(), 1500)
  } catch(e) {
    const errMsg = e.response?.data?.error || e.message || 'Lỗi không xác định'
    toast('❌ ' + errMsg, 'error')
    if (errMsg.includes('API key')) {
      const statusEl = $('emailConfigSaveStatus')
      if (statusEl) { statusEl.textContent = '⚠️ API Key chưa cấu hình hoặc không hợp lệ'; statusEl.className = 'text-sm text-orange-500' }
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Gửi email test' }
  }
}

// ── Email recipients list state ──────────────────────────────────────────────
let _emailRecipientsAll = []    // full data cache
let _emailRecipientsOpen = false

async function loadEmailRecipients() {
  // Chỉ load data, KHÔNG tự mở panel
  try {
    const users = await api('/users')
    _emailRecipientsAll = users || []

    // Cập nhật badge đếm và subtitle ngay cả khi đóng
    const total = _emailRecipientsAll.length
    const valid = _emailRecipientsAll.filter(u => u.email && u.email.includes('@') && !u.email.endsWith('@onecad.vn')).length
    const badgeEl = $('emailRecipientsBadge')
    const subtitleEl = $('emailRecipientsSubtitle')
    if (badgeEl) { badgeEl.textContent = `${total} nhân sự`; badgeEl.classList.remove('hidden') }
    if (subtitleEl) subtitleEl.textContent = `${total} nhân sự · ${valid} có email hợp lệ · Nhấn để ${_emailRecipientsOpen ? 'thu nhỏ' : 'mở rộng'}`

    // Nếu đang mở thì render luôn
    if (_emailRecipientsOpen) _renderEmailRecipients()
  } catch(e) {
    const el = $('emailRecipientsList')
    if (el) el.innerHTML = '<p class="text-red-400 text-xs">Lỗi tải danh sách</p>'
  }
}

// ── Toggle mở/đóng panel danh sách email ────────────────────────────────────
function toggleEmailRecipients() {
  _emailRecipientsOpen = !_emailRecipientsOpen
  const body     = $('emailRecipientsBody')
  const chevron  = $('emailRecipientsChevron')
  const subtitle = $('emailRecipientsSubtitle')

  if (_emailRecipientsOpen) {
    // Mở: animate max-height → scroll height
    body.style.opacity = '0'
    body.style.maxHeight = body.scrollHeight + 500 + 'px'  // +500 để đủ chỗ khi filter
    setTimeout(() => { body.style.opacity = '1' }, 50)
    if (chevron) chevron.style.transform = 'rotate(180deg)'
    if (subtitle) {
      const total = _emailRecipientsAll.length
      const valid = _emailRecipientsAll.filter(u => u.email && u.email.includes('@') && !u.email.endsWith('@onecad.vn')).length
      subtitle.textContent = `${total} nhân sự · ${valid} có email hợp lệ · Nhấn để thu nhỏ`
    }
    // Render nếu chưa có data
    if (_emailRecipientsAll.length === 0) {
      loadEmailRecipients()
    } else {
      _renderEmailRecipients()
    }
  } else {
    // Đóng: animate về 0
    body.style.opacity = '0'
    body.style.maxHeight = '0'
    if (chevron) chevron.style.transform = 'rotate(0deg)'
    if (subtitle) {
      const total = _emailRecipientsAll.length
      const valid = _emailRecipientsAll.filter(u => u.email && u.email.includes('@') && !u.email.endsWith('@onecad.vn')).length
      subtitle.textContent = total > 0
        ? `${total} nhân sự · ${valid} có email hợp lệ · Nhấn để mở rộng`
        : 'Nhấn để xem danh sách...'
    }
  }
}

// ── Filter danh sách theo search / role / email status ───────────────────────
function filterEmailRecipients() {
  _renderEmailRecipients()
  // Cập nhật max-height sau khi filter (content có thể thay đổi chiều cao)
  const body = $('emailRecipientsBody')
  if (body && _emailRecipientsOpen) {
    body.style.maxHeight = body.scrollHeight + 200 + 'px'
  }
}

function _renderEmailRecipients() {
  const el          = $('emailRecipientsList')
  const statsEl     = $('emailRecipientsStats')
  if (!el) return

  const search      = ($('emailRecipientsSearch')?.value || '').toLowerCase().trim()
  const roleFilter  = $('emailRecipientsRoleFilter')?.value || ''
  const emailFilter = $('emailRecipientsEmailFilter')?.value || ''

  const roleLabels = { system_admin: ['🔴', 'Admin', 'bg-red-100 text-red-700'], project_admin: ['🟠', 'Proj. Admin', 'bg-orange-100 text-orange-700'], project_leader: ['🟡', 'Leader', 'bg-yellow-100 text-yellow-700'], member: ['🟢', 'Member', 'bg-green-100 text-green-700'] }
  const avatarColors = ['bg-primary', 'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-orange-500', 'bg-teal-500']

  // Filter
  let filtered = _emailRecipientsAll.filter(u => {
    const isValidEmail = u.email && u.email.includes('@') && !u.email.endsWith('@onecad.vn')
    if (search && !u.full_name?.toLowerCase().includes(search) && !u.email?.toLowerCase().includes(search)) return false
    if (roleFilter && u.role !== roleFilter) return false
    if (emailFilter === 'valid' && !isValidEmail) return false
    if (emailFilter === 'invalid' && isValidEmail) return false
    return true
  })

  // Stats bar
  const totalAll   = _emailRecipientsAll.length
  const validAll   = _emailRecipientsAll.filter(u => u.email && u.email.includes('@') && !u.email.endsWith('@onecad.vn')).length
  const invalidAll = totalAll - validAll
  if (statsEl) {
    statsEl.innerHTML = `
      <span class="flex items-center gap-1.5 text-xs bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-medium text-gray-700">
        <i class="fas fa-users text-primary"></i> ${totalAll} tổng
      </span>
      <span class="flex items-center gap-1.5 text-xs bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 font-medium text-green-700">
        <i class="fas fa-check-circle"></i> ${validAll} có email
      </span>
      ${invalidAll > 0 ? `<span class="flex items-center gap-1.5 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 font-medium text-red-600">
        <i class="fas fa-exclamation-triangle"></i> ${invalidAll} chưa có
      </span>` : ''}
      ${filtered.length !== totalAll ? `<span class="flex items-center gap-1.5 text-xs bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 font-medium text-blue-700">
        <i class="fas fa-filter"></i> ${filtered.length} kết quả
      </span>` : ''}
    `
  }

  if (!filtered.length) {
    el.innerHTML = `<div class="py-8 text-center text-gray-400"><i class="fas fa-search text-2xl mb-2 block"></i><p class="text-sm">Không tìm thấy nhân sự phù hợp</p></div>`
    return
  }

  // Render rows — chia nhóm theo role
  const grouped = {}
  filtered.forEach(u => { if (!grouped[u.role]) grouped[u.role] = []; grouped[u.role].push(u) })
  const roleOrder = ['system_admin', 'project_admin', 'project_leader', 'member']

  let html = ''
  for (const role of roleOrder) {
    if (!grouped[role]?.length) continue
    const [icon, label] = roleLabels[role] || ['⚪', role, '']
    html += `<div class="mb-3">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
        <span>${icon}</span> ${label} <span class="font-normal normal-case text-gray-300">(${grouped[role].length})</span>
      </p>
      <div class="space-y-0.5">`
    grouped[role].forEach((u, idx) => {
      const isValidEmail = u.email && u.email.includes('@') && !u.email.endsWith('@onecad.vn')
      const avatarColor = avatarColors[u.id % avatarColors.length] || 'bg-primary'
      const emailDisplay = isValidEmail
        ? `<a href="mailto:${u.email}" class="text-green-600 hover:text-green-700 hover:underline font-medium" title="Gửi email">${u.email}</a>`
        : `<span class="text-red-400 italic">${u.email || '(chưa có email)'}</span>`
      const emailIcon = isValidEmail
        ? `<span class="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0" title="Có email hợp lệ"><i class="fas fa-check text-green-600" style="font-size:9px"></i></span>`
        : `<span class="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0" title="Chưa có email hợp lệ"><i class="fas fa-times text-red-500" style="font-size:9px"></i></span>`
      html += `<div class="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/70 transition-colors group">
        ${emailIcon}
        <div class="w-7 h-7 rounded-full ${avatarColor} text-white flex items-center justify-center text-xs font-bold flex-shrink-0">${u.full_name?.charAt(0)?.toUpperCase() || '?'}</div>
        <span class="font-medium text-gray-800 text-sm flex-shrink-0 w-36 truncate" title="${u.full_name}">${u.full_name}</span>
        ${u.department ? `<span class="text-xs text-gray-400 hidden sm:block truncate max-w-[120px]" title="${u.department}">${u.department}</span>` : '<span class="hidden sm:block w-20"></span>'}
        <span class="ml-auto text-xs">${emailDisplay}</span>
      </div>`
    })
    html += `</div></div>`
  }
  el.innerHTML = html
}

function toggleApiKeyVisibility() {
  const input = $('cfgResendApiKey')
  const icon = $('apiKeyEyeIcon')
  if (!input) return
  if (input.type === 'password') { input.type = 'text'; if(icon) { icon.className = 'fas fa-eye-slash' } }
  else { input.type = 'password'; if(icon) { icon.className = 'fas fa-eye' } }
}

async function refreshEmailLogs() {
  try {
    const logs = await api('/email-logs?limit=20')
    _emailLogsCache = logs || []
    renderEmailLogs(_emailLogsCache)

    // Stats
    const today = toLocalDayjs(new Date().toISOString()).format('YYYY-MM-DD')
    const todayLogs = _emailLogsCache.filter(l => l.sent_at && toLocalDayjs(l.sent_at).format('YYYY-MM-DD') === today)
    const sentToday = todayLogs.filter(l => l.status === 'sent').length
    const failedToday = todayLogs.filter(l => l.status === 'failed').length

    const sentEl = $('emailSentToday')
    const failEl = $('emailFailedToday')
    const configEl = $('emailConfigStatus')

    if (sentEl) sentEl.textContent = sentEl ? String(sentToday) : '-'
    if (failEl) failEl.textContent = String(failedToday)

    if (configEl) {
      const hasLogs = _emailLogsCache.length > 0
      const hasSuccess = _emailLogsCache.some(l => l.status === 'sent')
      if (hasSuccess) {
        configEl.textContent = '✅ Đã cấu hình'
        configEl.className = 'font-bold text-green-600'
      } else if (hasLogs) {
        configEl.textContent = '⚠️ Có lỗi gửi'
        configEl.className = 'font-bold text-orange-500'
      } else {
        configEl.textContent = '❓ Chưa có log'
        configEl.className = 'font-bold text-gray-500'
      }
    }
  } catch (e) {
    toast('Lỗi tải email logs: ' + (e.response?.data?.error || e.message), 'error')
  }
}

function filterEmailLogs() {
  const filter = $('emailLogFilter')?.value || ''
  if (!filter) { renderEmailLogs(_emailLogsCache); return }
  const filtered = _emailLogsCache.filter(l => l.status === filter || l.event_type === filter)
  renderEmailLogs(filtered)
}

// ── Overdue reminder: xem trước + gửi mail ──────────────────────
async function previewOverdueTasks() {
  const listEl   = $('overduePreviewList')
  const tbodyEl  = $('overduePreviewTbody')
  const resultEl = $('overdueReminderResult')
  if (!listEl || !tbodyEl) return

  resultEl.textContent = 'Đang tải...'
  try {
    const tasks = await api('/admin/overdue-tasks-preview')
    if (!tasks.length) {
      resultEl.textContent = '✅ Không có task quá hạn nào'
      listEl.classList.add('hidden')
      return
    }
    resultEl.textContent = `Tìm thấy ${tasks.length} task quá hạn`
    tbodyEl.innerHTML = tasks.map(t => {
      const days = Math.floor((Date.now() - new Date(t.due_date).getTime()) / 86400000)
      return `<tr class="table-row">
        <td class="py-1.5 pr-3 font-medium text-gray-800 max-w-[200px] truncate">${t.title}</td>
        <td class="py-1.5 pr-3 text-gray-500">${t.project_code}</td>
        <td class="py-1.5 pr-3 font-medium">${t.assignee_name}</td>
        <td class="py-1.5 pr-3 text-blue-600">${t.assignee_email}</td>
        <td class="py-1.5 pr-3 text-red-600 font-bold">${t.due_date} <span class="text-red-400 font-normal">(+${days}ngày)</span></td>
        <td class="py-1.5"><span class="badge badge-inprogress text-xs">${t.status}</span></td>
      </tr>`
    }).join('')
    listEl.classList.remove('hidden')
  } catch(e) {
    resultEl.textContent = '❌ Lỗi: ' + e.message
  }
}

async function sendOverdueReminders() {
  const resultEl = $('overdueReminderResult')
  if (!confirm('Gửi email nhắc ⚠️ quá hạn đến tất cả nhân sự phụ trách task chưa hoàn thành?')) return
  if (resultEl) resultEl.textContent = 'Đang gửi...'
  try {
    const res = await api('/admin/send-overdue-reminders', { method: 'POST' })
    if (resultEl) {
      if (res.sent === 0) {
        resultEl.textContent = `✅ ${res.message || 'Không có task quá hạn nào'}`
      } else {
        resultEl.textContent = `✅ Đã gửi ${res.sent}/${res.total_overdue} email thành công`
      }
    }
    toast(`✅ Đã gửi ${res.sent} email nhắc deadline`, 'success', 4000)
    setTimeout(() => refreshEmailLogs(), 2000)
  } catch(e) {
    if (resultEl) resultEl.textContent = '❌ Lỗi: ' + e.message
    toast('Lỗi gửi mail: ' + e.message, 'error')
  }
}

// ─── WEEKLY TASK REPORT ───────────────────────────────────────────────────────
const DAY_NAMES = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

async function loadWeeklyReportConfig() {
  try {
    const data = await api('/admin/weekly-task-report/preview')
    const cfg  = data.config || {}
    // Update toggles
    const toggle = $('weeklyReportEnabled')
    if (toggle) toggle.checked = cfg.enabled !== '0'
    const daySelect = $('weeklyReportDay')
    if (daySelect) daySelect.value = cfg.day ?? '5'
    const hourSelect = $('weeklyReportHour')
    if (hourSelect) hourSelect.value = cfg.hour ?? '8'
    // Render preview stats
    renderWeeklyReportPreview(data)
  } catch(e) {
    toast('Lỗi tải cấu hình báo cáo tuần: ' + e.message, 'error')
  }
}

function renderWeeklyReportPreview(data) {
  const el = $('weeklyReportPreview')
  if (!el) return
  const stats   = data.memberStats || []
  const summary = data.summary    || {}
  if (stats.length === 0) {
    el.innerHTML = '<p class="text-xs text-gray-400 py-4 text-center">Chưa có dữ liệu task</p>'
    return
  }
  const rows = stats.map(m => {
    const rate = m.total > 0 ? Math.round(m.done / m.total * 100) : 0
    const overdueTag = m.overdue > 0
      ? `<span class="text-red-600 font-bold text-xs ml-1">(⚠ ${m.overdue} QH)</span>` : ''
    return `<tr class="border-b border-gray-100 hover:bg-gray-50">
      <td class="py-1.5 px-2 text-sm font-medium text-gray-800">${m.name}${overdueTag}</td>
      <td class="py-1.5 px-2 text-center text-sm text-green-600 font-bold">${m.done}</td>
      <td class="py-1.5 px-2 text-center text-sm text-blue-600">${m.inprogress}</td>
      <td class="py-1.5 px-2 text-center text-sm text-gray-500">${m.todo}</td>
      <td class="py-1.5 px-2 text-center text-sm ${m.overdue>0?'text-red-600 font-bold':'text-gray-400'}">${m.overdue}</td>
      <td class="py-1.5 px-2 text-center text-sm text-gray-700">${m.total}</td>
      <td class="py-1.5 px-2 text-sm">
        <div class="flex items-center gap-1">
          <div class="flex-1 bg-gray-200 rounded h-1.5">
            <div class="rounded h-1.5" style="width:${rate}%;background:${rate>=80?'#16a34a':rate>=50?'#f59e0b':'#ef4444'}"></div>
          </div>
          <span class="text-xs text-gray-500 w-8 text-right">${rate}%</span>
        </div>
      </td>
    </tr>`
  }).join('')

  el.innerHTML = `
    <div class="grid grid-cols-4 gap-2 mb-3">
      <div class="bg-green-50 rounded-lg p-2 text-center"><div class="text-lg font-bold text-green-600">${summary.totalDone||0}</div><div class="text-xs text-green-700">✅ Hoàn thành</div></div>
      <div class="bg-blue-50 rounded-lg p-2 text-center"><div class="text-lg font-bold text-blue-600">${summary.totalInprog||0}</div><div class="text-xs text-blue-700">🔄 Đang làm</div></div>
      <div class="bg-gray-50 rounded-lg p-2 text-center"><div class="text-lg font-bold text-gray-600">${summary.totalTodo||0}</div><div class="text-xs text-gray-600">📋 Chưa làm</div></div>
      <div class="bg-red-50 rounded-lg p-2 text-center"><div class="text-lg font-bold text-red-600">${summary.totalOverdue||0}</div><div class="text-xs text-red-700">⚠️ Quá hạn</div></div>
    </div>
    <div class="overflow-x-auto rounded border border-gray-100">
      <table class="w-full text-xs">
        <thead><tr class="bg-gray-50 text-gray-600">
          <th class="py-1.5 px-2 text-left font-medium">Nhân sự (${stats.length})</th>
          <th class="py-1.5 px-2 text-center font-medium text-green-600">✅ HT</th>
          <th class="py-1.5 px-2 text-center font-medium text-blue-600">🔄 ĐL</th>
          <th class="py-1.5 px-2 text-center font-medium text-gray-500">📋 CL</th>
          <th class="py-1.5 px-2 text-center font-medium text-red-500">⚠ QH</th>
          <th class="py-1.5 px-2 text-center font-medium">Tổng</th>
          <th class="py-1.5 px-2 text-left font-medium">% HT</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}

async function saveWeeklyReportConfig() {
  const enabled = $('weeklyReportEnabled')?.checked ? '1' : '0'
  const day     = $('weeklyReportDay')?.value  || '5'
  const hour    = $('weeklyReportHour')?.value || '8'
  try {
    await api('/system-config', { method: 'PUT', data: {
      weekly_report_enabled: enabled,
      weekly_report_day:     day,
      weekly_report_hour:    hour,
    }})
    toast('✅ Đã lưu cấu hình báo cáo tuần', 'success')
  } catch(e) {
    toast('Lỗi lưu cấu hình: ' + e.message, 'error')
  }
}

async function sendWeeklyReportNow() {
  const btn = $('btnSendWeeklyReport')
  const resultEl = $('weeklyReportResult')
  if (!confirm('Gửi ngay báo cáo task tuần đến tất cả System Admin?')) return
  if (btn) btn.disabled = true
  if (resultEl) resultEl.textContent = 'Đang gửi...'
  try {
    const res = await api('/admin/weekly-task-report/send?force=1', { method: 'POST' })
    const msg = res.sent > 0
      ? `✅ Đã gửi báo cáo tuần đến ${res.sent} admin (${res.week})`
      : `ℹ️ ${res.message || 'Đã xử lý'}`
    if (resultEl) resultEl.textContent = msg
    toast(msg, res.sent > 0 ? 'success' : 'info', 5000)
    setTimeout(() => refreshEmailLogs(), 2000)
  } catch(e) {
    if (resultEl) resultEl.textContent = '❌ Lỗi: ' + e.message
    toast('Lỗi gửi báo cáo: ' + e.message, 'error')
  } finally {
    if (btn) btn.disabled = false
  }
}

const EMAIL_EVENT_LABELS = {
  task_assigned:        '📌 Giao task',
  task_status_updated:  '🔄 Cập nhật task',
  task_overdue:         '⚠️ Quá hạn',
  weekly_task_report:   '📊 Báo cáo tuần',
  project_added:        '🏗️ Thêm dự án',
  project_updated:      '📝 Cập nhật dự án',
  timesheet_reviewed:   '✅ Duyệt timesheet',
  payment_request_new:  '💰 Thanh toán',
  chat_mention:         '💬 @Mention',
  test:                 '🧪 Test',
}

function renderEmailLogs(logs) {
  const container = $('emailLogsContainer')
  if (!container) return

  if (!logs.length) {
    container.innerHTML = '<div class="py-8 text-center text-gray-400 text-sm"><i class="fas fa-inbox mr-2 text-lg block mb-2"></i>Chưa có email nào được gửi</div>'
    return
  }

  const EVENT_ICON = {
    task_assigned:       '📌', task_status_updated: '🔄', task_overdue: '⚠️',
    project_added:       '🏗️', project_created:     '🆕', project_status_changed: '🔄',
    timesheet_reviewed:  '✅', timesheet_bulk_approved: '✅',
    payment_request_new: '💰', payment_status_changed: '💳',
    chat_mention:        '💬', member_added_to_project: '👤', test: '🧪',
  }
  const EVENT_SHORT = {
    task_assigned:       'Giao task',       task_status_updated: 'Cập nhật task',
    task_overdue:        'Quá hạn',         project_added:       'Tham gia dự án',
    project_created:     'Dự án mới',       project_status_changed: 'TT dự án',
    timesheet_reviewed:  'Duyệt timesheet', timesheet_bulk_approved: 'Duyệt TS',
    payment_request_new: 'Đề nghị TT',      payment_status_changed: 'Cập nhật TT',
    chat_mention:        '@Mention',         member_added_to_project: 'Thành viên mới',
    test:                'Test',
  }

  container.innerHTML = logs.map(l => {
    // Compact time: "08:15 · 26/3"
    let timeStr = '-'
    if (l.sent_at) {
      const d = toLocalDayjs(l.sent_at)
      timeStr = `${d.format('HH:mm')} · ${d.format('D/M')}`
    }
    const icon = EVENT_ICON[l.event_type] || '📧'
    const label = EVENT_SHORT[l.event_type] || l.event_type
    const name = l.full_name || l.to_email || '—'
    const isOk = l.status === 'sent'
    const statusDot = isOk
      ? '<span class="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 mt-0.5" title="Thành công"></span>'
      : '<span class="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 mt-0.5" title="Thất bại"></span>'
    const errorHint = l.error_msg
      ? `<span class="text-red-400 text-xs truncate max-w-[140px]" title="${l.error_msg}">⚠️ ${l.error_msg.slice(0,40)}...</span>`
      : ''

    return `<div class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors group">
      ${statusDot}
      <span class="text-base flex-shrink-0 w-5 text-center">${icon}</span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-gray-700">${name}</span>
          <span class="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">${label}</span>
          ${errorHint}
        </div>
      </div>
      <span class="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">${timeStr}</span>
    </div>`
  }).join('')
}

async function updateProfile() {
  // Validate CCCD
  const cccd = $('profileCccdInput').value.trim()
  if (cccd && !/^\d{12}$/.test(cccd)) {
    toast('Số CCCD phải đúng 12 chữ số', 'warning'); return
  }
  // Validate năm tốt nghiệp
  const gradYearRaw = $('profileGraduationYearInput').value.trim()
  const gradYear = gradYearRaw ? parseInt(gradYearRaw) : null
  if (gradYear && (gradYear < 1970 || gradYear > 2099)) {
    toast('Năm tốt nghiệp không hợp lệ (1970–2099)', 'warning'); return
  }
  try {
    await api(`/users/${currentUser.id}`, {
      method: 'put',
      data: {
        full_name: $('profileFullName').value,
        email: $('profileEmailInput').value,
        phone: $('profilePhoneInput').value,
        department: $('profileDeptInput').value || null,
        gender: $('profileGenderInput').value || null,
        job_title: $('profileJobTitleInput').value.trim() || null,
        join_date: $('profileJoinDateInput').value || null,
        degree: $('profileDegreeInput').value || null,
        cccd: cccd || null,
        cccd_issue_date: $('profileCccdIssueDateInput').value || null,
        cccd_issue_place: $('profileCccdIssuePlaceInput').value.trim() || null,
        birthday: $('profileBirthdayInput').value || null,
        address: $('profileAddressInput').value.trim() || null,
        current_address: $('profileCurrentAddressInput').value.trim() || null,
        social_insurance_number: $('profileSocialInsuranceInput').value.trim() || null,
        tax_number: $('profileTaxNumberInput').value.trim() || null,
        bank_account: $('profileBankAccountInput').value.trim() || null,
        bank_name: $('profileBankNameInput').value.trim() || null,
        bank_branch: $('profileBankBranchInput').value.trim() || null,
        major: $('profileMajorInput').value.trim() || null,
        university: $('profileUniversityInput').value.trim() || null,
        graduation_year: gradYear
      }
    })
    toast('Cập nhật thông tin thành công', 'success')
    loadProfile()
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
}

async function changePassword() {
  const oldPass = $('oldPassword').value
  const newPass = $('newPassword').value
  const confirmPass = $('confirmPassword').value

  if (!oldPass || !newPass) { toast('Nhập đầy đủ thông tin', 'warning'); return }
  if (newPass !== confirmPass) { toast('Mật khẩu xác nhận không khớp', 'error'); return }
  if (newPass.length < 6) { toast('Mật khẩu tối thiểu 6 ký tự', 'warning'); return }

  try {
    await api('/auth/change-password', { method: 'post', data: { old_password: oldPass, new_password: newPass } })
    toast('Đổi mật khẩu thành công')
    $('oldPassword').value = ''
    $('newPassword').value = ''
    $('confirmPassword').value = ''
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
}

// ================================================================
// AUTO LOGIN CHECK
// ================================================================
window.addEventListener('load', async () => {
  const savedToken = localStorage.getItem('bim_token')
  const savedUser = localStorage.getItem('bim_user')

  if (savedToken && savedUser) {
    try {
      authToken = savedToken
      currentUser = JSON.parse(savedUser)
      // Verify token is still valid
      const user = await api('/auth/me')
      currentUser = { ...currentUser, ...user }
      initApp()
    } catch (e) {
      localStorage.removeItem('bim_token')
      localStorage.removeItem('bim_user')
      $('loginPage').style.display = 'flex'
    }
  } else {
    $('loginPage').style.display = 'flex'
  }
})

// Reset loading guards on page unload so they don't persist on back-navigation
window.addEventListener('beforeunload', () => {
  _costDashboardLoading = false
  _costDashboardPending = false
  _costAnalysisLoading = false
  _costAnalysisPending = false
  _costAnalysisLoaded = false
  _lastAnalysisKey = ''
})

// Close modals when clicking outside
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none'
  })
})

// ================================================================
// CONFIRM DELETE MODAL
// ================================================================
function showConfirmDelete(title, message, onConfirm) {
  $('confirmDeleteTitle').textContent = title
  $('confirmDeleteMessage').innerHTML = message
  const btn = $('confirmDeleteBtn')
  btn.onclick = async () => {
    try {
      closeModal('confirmDeleteModal')
      await onConfirm()
    } catch(e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
  }
  openModal('confirmDeleteModal')
}

// ================================================================
// DASHBOARD WIDGET TOGGLE
// ================================================================
function toggleDashboardWidgets() {
  const panel = $('dashWidgetPanel')
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
}

function toggleWidget(id, visible) {
  const el = $(id)
  if (el) el.style.display = visible === false ? 'none' : ''
}

// ================================================================
// PRODUCTIVITY PAGE
// ================================================================
let allProductivityData = []
let prodSortKey = 'score'

function _initProdProjectCombobox() {
  const container = $('prodProjectCombobox')
  if (!container) return

  // Destroy old state and rebuild
  container.innerHTML = ''
  if (_cbState['prodProjectCombobox']) delete _cbState['prodProjectCombobox']

  const items = allProjects.map(p => ({ value: String(p.id), label: p.code + ' – ' + p.name }))

  createCombobox('prodProjectCombobox', {
    placeholder: 'Tất cả dự án',
    items,
    fullWidth: true,
    onchange: (_val) => { loadProductivity(true) }
  })
}

async function loadProductivity(skipReinit = false) {
  try {
    if (!allProjects.length) allProjects = await api('/projects')

    // Init/rebuild combobox on first call or when projects just loaded
    if (!skipReinit || !_cbState['prodProjectCombobox']) {
      _initProdProjectCombobox()
    }

    const projectId = _cbGetValue('prodProjectCombobox') || ''
    const days = $('prodDaysFilter')?.value || '30'
    let url = `/productivity?days=${days}`
    if (projectId) url += `&project_id=${projectId}`
    allProductivityData = await api(url)
    renderProductivityPage(allProductivityData)
  } catch(e) { toast('Lỗi tải năng suất: ' + e.message, 'error') }
}

// ── Productivity pagination ──────────────────────────────────────
const PROD_PAGE_SIZE = 20
let _prodCurrentPage = 1
let _prodAllData = []

function prodPaginatedData() {
  const start = (_prodCurrentPage - 1) * PROD_PAGE_SIZE
  return _prodAllData.slice(start, start + PROD_PAGE_SIZE)
}

function renderProdRows() {
  const tbody = $('productivityTable')
  if (!tbody) return
  const data = prodPaginatedData()
  const getScoreColor = s => s >= 75 ? 'text-green-600' : s >= 50 ? 'text-yellow-600' : 'text-red-600'
  const getBadgeClass  = s => s >= 75 ? 'badge-completed' : s >= 50 ? 'badge-review' : 'badge-overdue'
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-gray-400"><i class="fas fa-inbox text-2xl mb-2 block"></i>Không có dữ liệu</td></tr>'
    return
  }
  tbody.innerHTML = data.map(u => {
    const completionRate = u.completion_rate || 0
    const ontimeRate     = u.ontime_rate     || 0
    const productivity   = u.productivity    || 0
    const score          = u.score           || 0
    return `
    <tr class="table-row">
      <td class="py-2 pr-3">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">${(u.full_name||'?').split(' ').pop()?.charAt(0)}</div>
          <div><div class="font-medium text-gray-800 text-sm">${u.full_name || '—'}</div></div>
        </div>
      </td>
      <td class="py-2 pr-3 text-xs text-gray-500">${u.department || '—'}</td>
      <td class="py-2 pr-3 text-center font-medium">${u.total_tasks}</td>
      <td class="py-2 pr-3 text-center font-medium text-green-600">${u.completed_tasks}</td>
      <td class="py-2 pr-3 text-center"><span class="${getScoreColor(completionRate)} font-medium">${completionRate}%</span></td>
      <td class="py-2 pr-3 text-center text-green-600">${u.ontime_tasks}</td>
      <td class="py-2 pr-3 text-center text-red-500">${u.late_completed}</td>
      <td class="py-2 pr-3 text-center">
        <div class="flex items-center gap-1 justify-center">
          <div class="progress-bar w-12"><div class="progress-fill" style="width:${ontimeRate}%;background:#0066CC"></div></div>
          <span class="text-xs text-blue-600">${ontimeRate}%</span>
        </div>
      </td>
      <td class="py-2 pr-3 text-center">
        <div class="flex items-center gap-1 justify-center">
          <div class="progress-bar w-12"><div class="progress-fill" style="width:${productivity}%;background:#F59E0B"></div></div>
          <span class="text-xs ${getScoreColor(productivity)}">${productivity}%</span>
        </div>
      </td>
      <td class="py-2 text-center"><span class="badge font-bold text-sm px-3 ${getBadgeClass(score)}">${score}</span></td>
    </tr>`
  }).join('')
}

function renderProdPagination() {
  const container = $('prodPagination')
  if (!container) return
  const total = _prodAllData.length
  const totalPages = Math.ceil(total / PROD_PAGE_SIZE)
  if (totalPages <= 1) { container.innerHTML = ''; return }
  const p = _prodCurrentPage
  const start = (p - 1) * PROD_PAGE_SIZE + 1
  const end = Math.min(p * PROD_PAGE_SIZE, total)
  const btn = (pg, label, disabled, active) =>
    `<button onclick="prodGoPage(${pg})" class="px-3 py-1 rounded text-sm border ${active ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}" ${disabled ? 'disabled' : ''}>${label}</button>`
  let pages = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(btn(i, i, false, i === p))
  } else {
    pages.push(btn(1, 1, false, p === 1))
    if (p > 3) pages.push('<span class="px-2 text-gray-400">…</span>')
    for (let i = Math.max(2, p - 1); i <= Math.min(totalPages - 1, p + 1); i++) pages.push(btn(i, i, false, i === p))
    if (p < totalPages - 2) pages.push('<span class="px-2 text-gray-400">…</span>')
    pages.push(btn(totalPages, totalPages, false, p === totalPages))
  }
  container.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-2">
      <span class="text-xs text-gray-500">Hiển thị ${start}–${end} / ${total} nhân sự</span>
      <div class="flex items-center gap-1">
        ${btn(p - 1, '‹ Trước', p <= 1, false)}
        ${pages.join('')}
        ${btn(p + 1, 'Tiếp ›', p >= totalPages, false)}
      </div>
    </div>`
}

function prodGoPage(page) {
  const totalPages = Math.ceil(_prodAllData.length / PROD_PAGE_SIZE)
  if (page < 1 || page > totalPages) return
  _prodCurrentPage = page
  renderProdRows()
  renderProdPagination()
  const el = $('productivityTable')
  if (el) el.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function sortProductivity(key) {
  prodSortKey = key
  // Map display sort keys to actual data keys
  const fieldMap = { score: 'score', completed_tasks: 'completed_tasks',
                     productivity: 'productivity', completion_rate: 'completion_rate' }
  const dataKey = fieldMap[key] || key
  const sorted = [...allProductivityData].sort((a, b) => (b[dataKey] || 0) - (a[dataKey] || 0))
  renderProductivityPage(sorted)
}

function renderProductivityPage(data) {
  // ================================================================
  // CÔNG THỨC NĂNG SUẤT (chính thức):
  //
  //   % Hoàn thành  = completed_tasks / total_tasks × 100
  //   Chính xác     = ontime_tasks / completed_tasks × 100  (0 nếu done=0)
  //   Năng suất     = (% Hoàn thành + Chính xác) / 2
  //   Điểm          = (Năng suất + Chính xác) / 2          ← KHÁC Năng suất!
  //
  // Test case B (2 task giao, 1 xong, 0 đúng hạn):
  //   % Hoàn thành = 1/2×100 = 50%
  //   Chính xác    = 0/1×100 = 0%
  //   Năng suất    = (50+0)/2 = 25%
  //   Điểm         = (25+0)/2 = 13  [Math.round(12.5)=13]
  //
  // Màu Điểm: xanh ≥75 | vàng 50-74 | đỏ <50
  // ================================================================

  // Log công thức tính ra console để debug
  console.group('%c📊 Năng Suất Nhân Sự — Công thức tính', 'color:#00A651;font-weight:bold;font-size:13px')
  console.log('%c% Hoàn thành  = completed / total × 100', 'color:#6b7280')
  console.log('%cChính xác     = ontime / completed × 100  (0 khi completed=0)', 'color:#6b7280')
  console.log('%cNăng suất     = (% Hoàn thành + Chính xác) / 2', 'color:#8B5CF6')
  console.log('%cĐiểm          = (Năng suất + Chính xác) / 2  ← KHÁC Năng suất', 'color:#EF4444;font-weight:bold')
  console.log('─'.repeat(60))
  data.forEach(u => {
    const cr  = u.completion_rate || 0
    const cx  = u.ontime_rate     || 0
    const ns  = u.productivity    || 0
    const d   = u.score           || 0
    console.log(
      `%c${(u.full_name||'?').padEnd(20)}` +
      `  Giao=${u.total_tasks} Xong=${u.completed_tasks} ĐúngHạn=${u.ontime_tasks}` +
      `  %Hoàn=${cr}%  CX=${cx}%  NS=(${cr}+${cx})/2=${Math.round((cr+cx)/2)}%  Điểm=(${ns}+${cx})/2=${Math.round((ns+cx)/2)}`,
      'color:#374151'
    )
  })
  console.groupEnd()

  // ---- Bar chart: 4 datasets ----
  destroyChart('prodBar')
  const ctx1 = $('prodBarChart')
  if (ctx1 && data.length) {
    const top = data.slice(0, 10)
    charts['prodBar'] = safeChart(ctx1, {
      type: 'bar',
      data: {
        labels: top.map(u => u.full_name?.split(' ').pop() || u.full_name),
        datasets: [
          {
            label: '% Hoàn Thành',
            data: top.map(u => u.completion_rate || 0),
            backgroundColor: '#00A651', borderRadius: 4
          },
          {
            label: 'Chính xác (%)',
            data: top.map(u => u.ontime_rate || 0),
            backgroundColor: '#0066CC', borderRadius: 4
          },
          {
            label: 'Năng suất (%)',
            data: top.map(u => u.productivity || 0),
            backgroundColor: '#F59E0B', borderRadius: 4
          },
          {
            label: 'Điểm',
            data: top.map(u => u.score || 0),
            backgroundColor: '#8B5CF6', borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
        scales: { y: { beginAtZero: true, max: 100,
          ticks: { callback: v => v + '%' } } }
      }
    })
  }

  // ---- Pie chart: completed tasks distribution ----
  destroyChart('prodPie')
  const ctx2 = $('prodPieChart')
  if (ctx2 && data.length) {
    const topP = data.filter(u => u.completed_tasks > 0).slice(0, 8)
    const colors = ['#00A651','#0066CC','#FF6B00','#8B5CF6','#F59E0B','#EF4444','#10B981','#3B82F6']
    if (topP.length) {
      // Legend position: bottom on small screens, right on larger screens
      const isSmallScreen = window.innerWidth < 768
      charts['prodPie'] = safeChart(ctx2, {
        type: 'pie',
        data: {
          labels: topP.map(u => u.full_name?.split(' ').pop()),
          datasets: [{ data: topP.map(u => u.completed_tasks), backgroundColor: colors }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: {
            position: isSmallScreen ? 'bottom' : 'right',
            labels: { font: { size: 11 }, boxWidth: 12, padding: 8 }
          }}
        }
      })
    }
  }

  // ---- Table (pagination) ----
  _prodAllData = data
  _prodCurrentPage = 1
  renderProdRows()
  renderProdPagination()
}

// ================================================================
// FINANCE PROJECT PAGE
// ================================================================
async function loadFinanceProjectPage() {
  try {
    if (!allProjects.length) allProjects = await api('/projects')
    const projItems = allProjects.map(p => ({ value: String(p.id), label: `${p.code} – ${p.name}` }))
    if ($('finProjSelectCombobox')?.querySelector('[id$="_wrap"]')) {
      _cbSetItems('finProjSelectCombobox', projItems, true)
    } else {
      createCombobox('finProjSelectCombobox', {
        placeholder: '-- Chọn dự án --',
        items: projItems,
        value: '',
        fullWidth: true,
        onchange: (val) => { if (val) loadFinanceProject() }
      })
    }
    // Khởi tạo finNtcYearFilter động (NTC)
    const fntcf = $('finNtcYearFilter')
    if (fntcf && fntcf.options.length === 0) {
      await initCostYearFilter(fntcf)
    }
    // Khởi tạo finYearFilter động (dương lịch)
    const fyf = $('finYearFilter')
    if (fyf && fyf.options.length === 0) {
      await initCalendarYearFilter(fyf)
    }
    // Init default date range for 'range' mode
    const today = new Date().toISOString().slice(0, 10)
    const firstOfYear = today.slice(0, 4) + '-01-01'
    if ($('finFromDate') && !$('finFromDate').value) $('finFromDate').value = firstOfYear
    if ($('finToDate')   && !$('finToDate').value)   $('finToDate').value   = today
  } catch(e) { console.error(e) }
}

// Period-type toggle for Finance Project page
function onFinPeriodTypeChange() {
  const pt = $('finPeriodType')?.value || 'all_time'
  const ntcYearCtrl = $('finNtcYearCtrl')
  const yearCtrl    = $('finYearCtrl')
  const singleCtrl  = $('finSingleMonthCtrl')
  const multiCtrl   = $('finMultiMonthCtrl')
  const rangeCtrl   = $('finRangeCtrl')

  // Show/hide controls based on mode
  if (ntcYearCtrl) ntcYearCtrl.classList.toggle('hidden', pt !== 'ntc')
  if (yearCtrl)    yearCtrl.classList.toggle('hidden',   !['year','months','month'].includes(pt))
  if (singleCtrl)  singleCtrl.classList.toggle('hidden', pt !== 'month')
  if (multiCtrl)   multiCtrl.classList.toggle('hidden',  pt !== 'months')
  if (rangeCtrl)   rangeCtrl.classList.toggle('hidden',  pt !== 'range')

  // Reset checkboxes when switching to months mode
  if (pt === 'months') {
    document.querySelectorAll('.finMonthCheck').forEach(cb => cb.checked = false)
  }
  // Auto-reload (unless months which needs checkbox selection first)
  if (pt !== 'months') loadFinanceProject()
}

// Called whenever a finMonthCheck checkbox changes
function onFinMonthCheckChange() {
  const checked = [...document.querySelectorAll('.finMonthCheck:checked')]
  // Auto-load if at least 1 month selected
  if (checked.length > 0) loadFinanceProject()
}

async function loadFinanceProject() {
  const projectId = _cbGetValue('finProjSelectCombobox')
  if (!projectId) return
  const el = $('financeProjectContent')
  if (el) el.innerHTML = '<div class="text-center py-10 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl"></i><p class="mt-2 text-sm">Đang tải...</p></div>'
  try {
    const periodMode = $('finPeriodType')?.value || 'all_time'
    const year = $('finYearFilter')?.value || String(new Date().getFullYear())
    const ntcYear = $('finNtcYearFilter')?.value || String(new Date().getFullYear())

    // Build query params based on mode
    let query = `/finance/project/${projectId}?mode=${periodMode}`

    if (periodMode === 'ntc') {
      query += `&year=${ntcYear}`
    } else if (periodMode === 'year') {
      query += `&year=${year}`
    } else if (periodMode === 'month') {
      const mf = $('finMonthFilter')?.value || String(new Date().getMonth() + 1)
      query += `&year=${year}&month=${mf}`
    } else if (periodMode === 'months') {
      const checked = [...document.querySelectorAll('.finMonthCheck:checked')].map(el => el.value)
      if (checked.length === 0) { toast('Vui lòng chọn ít nhất một tháng', 'warning'); return }
      query += `&year=${year}&months=${checked.join(',')}`
    } else if (periodMode === 'range') {
      const fromDate = $('finFromDate')?.value
      const toDate   = $('finToDate')?.value
      if (!fromDate || !toDate) { toast('Vui lòng chọn ngày bắt đầu và kết thúc', 'warning'); return }
      query += `&from=${fromDate}&to=${toDate}`
    }
    // all_time and ytd: no extra params needed
    const [data, projDetail] = await Promise.all([
      api(query),
      api(`/projects/${projectId}`).catch(() => null)
    ])
    if (!el) return
    const { project, summary, costs_by_type, timeline, revenue_timeline, labor_timeline, validation } = data
    const members = projDetail?.members || []

    // Validation warnings banner
    const warningBanner = validation?.has_warnings
      ? `<div class="bg-yellow-50 border border-yellow-300 rounded-lg p-3 mb-4">
           <div class="flex items-center gap-2 mb-1">
             <i class="fas fa-exclamation-triangle text-yellow-500"></i>
             <span class="font-semibold text-yellow-700 text-sm">Cảnh báo dữ liệu</span>
             <span class="ml-auto text-xs bg-yellow-200 text-yellow-800 px-2 rounded-full">${validation.warnings.length} cảnh báo</span>
           </div>
           <ul class="space-y-0.5">${(validation.warnings || []).map(w => `<li class="text-xs text-yellow-700">• ${w}</li>`).join('')}</ul>
         </div>`
      : validation
        ? `<div class="bg-green-50 border border-green-200 rounded-lg p-2 mb-3 flex items-center gap-2">
             <i class="fas fa-check-circle text-green-500 text-xs"></i>
             <span class="text-xs text-green-700">Dữ liệu hợp lệ — không có cảnh báo</span>
           </div>`
        : ''

    const profitColor = validation?.profit_status === 'ok' ? 'text-purple-600' : validation?.profit_status === 'warning' ? 'text-amber-600' : (validation?.profit_status === 'no_revenue' || validation?.profit_status === 'no_data') ? 'text-gray-400' : 'text-red-600'
    const profitBorder = validation?.profit_status === 'ok' ? '#8B5CF6' : validation?.profit_status === 'warning' ? '#F59E0B' : (validation?.profit_status === 'no_revenue' || validation?.profit_status === 'no_data') ? '#9CA3AF' : '#EF4444'

    // Period label — use server-returned label for accuracy
    const periodLabel = data.period?.label || `Kỳ báo cáo`

    // Revenue progress vs contract
    const revenueProgress = project.contract_value > 0 ? Math.min(100, Math.round(summary.total_revenue / project.contract_value * 100)) : 0
    const pendingRevenue = summary.pending_revenue || 0
    const costProgress = project.contract_value > 0 ? Math.min(100, Math.round(summary.total_cost / project.contract_value * 100)) : 0

    // Labor source badge
    const laborSourceBadge = summary.labor_source === 'project_labor_costs'
      ? `<span class="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full"><i class="fas fa-database"></i> Đã đồng bộ</span>`
      : summary.labor_source === 'mixed'
        ? `<span class="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full"><i class="fas fa-layer-group"></i> Đồng bộ + Real-time</span>`
        : summary.labor_source === 'realtime'
          ? `<span class="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full"><i class="fas fa-clock"></i> Real-time</span>`
          : `<span class="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Chưa có dữ liệu</span>`

    // Monthly breakdown — merge cost, labor, and revenue timelines by month
    const timelineByMonth = {}
    ;(timeline || []).forEach(t => {
      if (!timelineByMonth[t.month]) timelineByMonth[t.month] = { other_cost: 0, labor: 0, revenue: 0 }
      timelineByMonth[t.month].other_cost += t.total || 0
    })
    ;(labor_timeline || []).forEach(l => {
      if (!timelineByMonth[l.month]) timelineByMonth[l.month] = { other_cost: 0, labor: 0, revenue: 0 }
      timelineByMonth[l.month].labor += l.total || 0
    })
    ;(revenue_timeline || []).forEach(r => {
      if (!timelineByMonth[r.month]) timelineByMonth[r.month] = { other_cost: 0, labor: 0, revenue: 0 }
      timelineByMonth[r.month].revenue += r.total || 0
    })
    const monthlyRows = Object.entries(timelineByMonth).sort(([a],[b]) => a.localeCompare(b)).map(([month, info]) => {
      const [yr, mo] = month.split('-')
      const totalCostRow = (info.other_cost || 0) + (info.labor || 0)
      const profitRow = info.revenue - totalCostRow
      const profitClass = profitRow > 0 ? 'text-green-600' : profitRow < 0 ? 'text-red-600' : 'text-gray-400'
      const costDetail = info.labor > 0
        ? `${fmt(totalCostRow)} <span class="text-gray-400 text-xs">(lương ${fmt(info.labor)})</span>`
        : (info.other_cost > 0 ? fmt(totalCostRow) : '—')
      return `<tr class="border-b hover:bg-gray-50 text-xs">
        <td class="py-1.5 px-2 font-medium">T${parseInt(mo)}/${yr}</td>
        <td class="py-1.5 px-2 text-right text-green-600">${info.revenue > 0 ? fmt(info.revenue) : '—'}</td>
        <td class="py-1.5 px-2 text-right text-red-600">${costDetail}</td>
        <td class="py-1.5 px-2 text-right ${profitClass}">${(info.revenue > 0 || totalCostRow > 0) ? fmt(profitRow) : '—'}</td>
      </tr>`
    }).join('')

    // Members list
    const membersHtml = members && members.length
      ? members.map(m => `<span class="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
          <i class="fas fa-user text-gray-400"></i>${m.full_name || m.username}
          <span class="text-gray-400">(${m.role === 'leader' ? 'Trưởng nhóm' : m.role === 'admin' ? 'Quản lý' : 'Thành viên'})</span>
        </span>`).join('')
      : '<span class="text-xs text-gray-400">Chưa có thành viên</span>'

    // KPI cards
    el.innerHTML = `
      ${warningBanner}
      <!-- Project header info -->
      <div class="bg-white border border-gray-200 rounded-lg p-4 mb-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="font-bold text-lg text-gray-800">${project.code} — ${project.name || ''}</h2>
            <div class="flex flex-wrap gap-2 mt-2">${membersHtml}</div>
          </div>
          <div class="text-right text-xs text-gray-500">
            <div><i class="fas fa-calendar-alt mr-1 text-blue-400"></i>Kỳ báo cáo: <strong class="text-gray-700">${periodLabel}</strong></div>
            <div class="mt-1"><i class="fas fa-file-contract mr-1 text-green-500"></i>Giá trị HĐ: <strong class="text-green-700">${fmtMoney(project.contract_value)}</strong></div>
          </div>
        </div>
      </div>

      <!-- KPI cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <div class="kpi-card" style="border-color:#00A651">
          <p class="text-xs text-gray-500 uppercase tracking-wide">Doanh thu</p>
          ${summary.total_revenue > 0
            ? `<p class="text-xl font-bold text-green-600 mt-1">${fmtMoney(summary.total_revenue)}</p>
               <div class="mt-2">
                 <div class="flex justify-between text-xs text-gray-400 mb-0.5"><span>Tiến độ HĐ</span><span>${revenueProgress}%</span></div>
                 <div class="w-full bg-gray-200 rounded-full h-1.5"><div class="bg-green-500 h-1.5 rounded-full" style="width:${revenueProgress}%"></div></div>
               </div>
               ${pendingRevenue > 0 ? `<p class="text-xs text-amber-600 mt-1">⏳ Chờ TT: ${fmtMoney(pendingRevenue)}</p>` : ''}`
            : pendingRevenue > 0
              ? `<p class="text-xl font-bold text-amber-500 mt-1">${fmtMoney(pendingRevenue)}</p>
                 <p class="text-xs text-amber-600 mt-1">⏳ Chờ thanh toán (chưa tính DT)</p>`
              : `<p class="text-xl font-bold text-gray-400 mt-1">— 0 ₫</p>
                 <p class="text-xs text-orange-500 mt-1">⚠️ Chưa khai báo doanh thu</p>`
          }
        </div>
        <div class="kpi-card" style="border-color:#2196F3">
          <p class="text-xs text-gray-500 uppercase tracking-wide">Chi phí lương</p>
          <p class="text-xl font-bold text-blue-600 mt-1">${fmtMoney(summary.labor_cost)}</p>
          <p class="text-xs text-gray-400 mt-1">${summary.labor_hours > 0 ? summary.labor_hours + 'h × ' + fmtMoney(summary.labor_per_hour) + '/h' : 'Chưa có dữ liệu'}</p>
          <div class="mt-1">${laborSourceBadge}</div>
        </div>
        <div class="kpi-card" style="border-color:#EF4444">
          <p class="text-xs text-gray-500 uppercase tracking-wide">Tổng chi phí</p>
          <p class="text-xl font-bold text-red-600 mt-1">${fmtMoney(summary.total_cost)}</p>
          ${summary.shared_cost > 0 ? `<p class="text-xs text-yellow-600 mt-0.5"><i class="fas fa-share-alt mr-1"></i>Gồm ${fmtMoney(summary.shared_cost)} chi phí chung</p>` : ''}
          <div class="mt-2">
            <div class="flex justify-between text-xs text-gray-400 mb-0.5"><span>% HĐ</span><span>${costProgress}%</span></div>
            <div class="w-full bg-gray-200 rounded-full h-1.5"><div class="${costProgress > 100 ? 'bg-red-600' : costProgress > 80 ? 'bg-amber-500' : 'bg-red-400'} h-1.5 rounded-full" style="width:${Math.min(costProgress,100)}%"></div></div>
          </div>
        </div>
        <div class="kpi-card" style="border-color:${profitBorder}">
          <p class="text-xs text-gray-500 uppercase tracking-wide">Lợi nhuận</p>
          ${summary.profit !== null && summary.profit !== undefined
            ? (() => {
                const hasRevenue = (summary.total_revenue || 0) > 0
                const profitLabel = validation?.profit_status === 'ok' ? 'Tốt' : validation?.profit_status === 'warning' ? 'Cần chú ý' : 'Lỗ'
                const badgeClass = validation?.profit_status === 'ok' ? 'bg-purple-100 text-purple-700' : validation?.profit_status === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                return `<p class="text-xl font-bold ${profitColor} mt-1">${fmtMoney(summary.profit)}</p>
               ${hasRevenue
                 ? `<p class="text-xs mt-1"><span class="font-semibold ${profitColor}">${summary.margin ?? 0}%</span> <span class="text-gray-400">tỷ suất LN</span></p>`
                 : `<p class="text-xs text-orange-500 mt-1">⚠️ Chưa khai báo doanh thu</p>`
               }
               <div class="mt-1"><span class="text-xs px-1.5 py-0.5 rounded-full ${badgeClass}">${profitLabel}</span></div>`
              })()
            : `<p class="text-xl font-bold text-gray-400 mt-1">—</p>
               <p class="text-xs text-gray-400 mt-1">Chưa có hoạt động tài chính</p>`
          }
        </div>
      </div>

      <!-- Charts row -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div class="card">
          <h3 class="font-bold text-sm mb-3"><i class="fas fa-chart-pie text-primary mr-2"></i>Cơ cấu chi phí</h3>
          <canvas id="finCostPie" height="260"></canvas>
        </div>
        <div class="card">
          <h3 class="font-bold text-sm mb-3"><i class="fas fa-chart-bar text-accent mr-2"></i>Chi phí + Doanh thu theo tháng</h3>
          <canvas id="finTimeline" height="260"></canvas>
        </div>
      </div>

      <!-- Cost breakdown table -->
      <div class="card mb-4">
        <h3 class="font-bold text-sm mb-3"><i class="fas fa-table text-primary mr-2"></i>Chi tiết chi phí theo loại</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-gray-500 border-b text-xs uppercase bg-gray-50">
              <th class="py-2 px-3">Loại chi phí</th>
              <th class="py-2 px-3 text-right">Số tiền</th>
              <th class="py-2 px-3 text-right">% Tổng</th>
              <th class="py-2 px-3 text-center">Nguồn</th>
            </tr></thead>
            <tbody>
              ${costs_by_type.map(c => {
                const pct = summary.total_cost > 0 ? Math.round(c.total / summary.total_cost * 100) : 0
                const ctIcon = c.cost_type === 'salary' ? '👤' : c.cost_type === 'shared' ? '🤝' : c.cost_type === 'material' ? '🧱' : c.cost_type === 'equipment' ? '⚙️' : c.cost_type === 'transport' ? '🚛' : '📦'
                const rowBg = c.cost_type === 'shared' ? 'bg-yellow-50' : ''
                return `<tr class="table-row border-b hover:bg-gray-50 ${rowBg}">
                  <td class="py-2 px-3">${ctIcon} ${c.label || getCostTypeNameDynamic(c.cost_type)}
                    ${c.cost_type === 'shared' ? `<span class="ml-1 text-xs bg-yellow-100 text-yellow-700 px-1.5 rounded-full">${c.shared_count || '?'} khoản</span>` : ''}
                  </td>
                  <td class="py-2 px-3 text-right font-medium ${c.cost_type === 'shared' ? 'text-yellow-700' : 'text-red-600'}">${fmt(c.total)} VNĐ</td>
                  <td class="py-2 px-3 text-right">
                    <div class="flex items-center justify-end gap-2">
                      <div class="w-16 bg-gray-100 rounded-full h-1.5 hidden sm:block"><div class="${c.cost_type === 'shared' ? 'bg-yellow-400' : 'bg-red-400'} h-1.5 rounded-full" style="width:${pct}%"></div></div>
                      <span class="text-gray-500 text-xs">${pct}%</span>
                    </div>
                  </td>
                  <td class="py-2 px-3 text-center">${c.is_auto ? '<span class="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">🤖 tự động</span>' : '<span class="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">✏️ thủ công</span>'}</td>
                </tr>`
              }).join('')}
            </tbody>
            <tfoot>
              <tr class="bg-gray-50 font-semibold">
                <td class="py-2 px-3 text-gray-700">TỔNG CHI PHÍ</td>
                <td class="py-2 px-3 text-right text-red-700">${fmt(summary.total_cost)} VNĐ</td>
                <td class="py-2 px-3 text-right text-gray-500">100%</td>
                <td class="py-2 px-3 text-center text-xs text-gray-400">Lương + Riêng + Chung</td>
              </tr>
            </tfoot>
          </table>
        </div>
        ${summary.labor_source !== 'none' ? `
        <div class="mt-3 bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800 flex flex-wrap gap-3 items-center">
          <div><i class="fas fa-info-circle mr-1"></i>Nguồn lương: ${laborSourceBadge}</div>
          ${summary.labor_hours > 0 ? `<div><i class="fas fa-clock mr-1"></i>${summary.labor_hours}h × ${fmtMoney(summary.labor_per_hour)}/h</div>` : ''}
          <div><i class="fas fa-calendar mr-1"></i>Kỳ: <strong>${periodLabel}</strong></div>
          ${summary.labor_months_count > 0 ? `<div><i class="fas fa-layer-group mr-1"></i>${summary.labor_months_count} tháng có dữ liệu lương</div>` : ''}
          <button onclick="syncLaborForFinProject(${project.id}, '${data.period?.date_from}', '${data.period?.date_to}')" class="ml-auto btn-secondary text-xs py-1 px-2">
            <i class="fas fa-sync mr-1"></i>${summary.labor_source === 'project_labor_costs' ? 'Đồng bộ lại' : 'Đồng bộ ngay'}
          </button>
        </div>` : `
        <div class="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 flex flex-wrap gap-3 items-center">
          <div><i class="fas fa-exclamation-circle mr-1 text-orange-500"></i>Chưa có dữ liệu chi phí lương cho dự án này</div>
          <button onclick="syncLaborForFinProject(${project.id}, '${data.period?.date_from}', '${data.period?.date_to}')" class="ml-auto btn-secondary text-xs py-1 px-2">
            <i class="fas fa-sync mr-1"></i>Đồng bộ ngay
          </button>
        </div>`}
        ${summary.shared_cost > 0 ? `
        <div class="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800 flex flex-wrap gap-3 items-center">
          <i class="fas fa-share-alt text-yellow-600"></i>
          <div><strong>Chi phí chung phân bổ:</strong> ${fmtMoney(summary.shared_cost)} từ ${summary.shared_cost_count || '?'} khoản chi phí chung</div>
          <button onclick="navigate('costs'); setTimeout(()=>switchCostTab('shared'),200)" class="ml-auto text-xs text-yellow-700 underline hover:no-underline">Quản lý chi phí chung →</button>
        </div>` : ''}
      </div>

      <!-- Revenue detail -->
      <div class="card mb-4">
        <h3 class="font-bold text-sm mb-3"><i class="fas fa-money-bill-wave text-green-600 mr-2"></i>Thông tin doanh thu</h3>
        <div class="grid grid-cols-3 gap-4 text-center">
          <div class="${summary.total_revenue > 0 ? 'bg-green-50' : (pendingRevenue > 0 ? 'bg-amber-50' : 'bg-orange-50')} rounded-lg p-3">
            <p class="text-xs text-gray-500">Doanh thu đã TT</p>
            ${summary.total_revenue > 0
              ? `<p class="font-bold text-green-700 text-base mt-1">${fmtMoney(summary.total_revenue)}</p>
                 ${pendingRevenue > 0 ? `<p class="text-xs text-amber-600 mt-0.5">⏳ +${fmtMoney(pendingRevenue)} chờ TT</p>` : ''}`
              : pendingRevenue > 0
                ? `<p class="font-bold text-amber-600 text-base mt-1">${fmtMoney(pendingRevenue)}</p>
                   <p class="text-xs text-amber-500">⏳ Chờ thanh toán</p>`
                : `<p class="font-bold text-orange-500 text-base mt-1">— 0 ₫</p>
                   <p class="text-xs text-orange-400">⚠️ Chưa khai báo</p>`
            }
          </div>
          <div class="bg-blue-50 rounded-lg p-3">
            <p class="text-xs text-gray-500">Giá trị hợp đồng</p>
            <p class="font-bold text-blue-700 text-base mt-1">${fmtMoney(project.contract_value)}</p>
          </div>
          <div class="${summary.total_revenue > 0 ? 'bg-' + (summary.total_revenue >= project.contract_value * 0.5 ? 'green' : 'amber') + '-50' : 'bg-gray-50'} rounded-lg p-3">
            <p class="text-xs text-gray-500">Tỷ lệ thực hiện</p>
            ${summary.total_revenue > 0
              ? `<p class="font-bold text-${summary.total_revenue >= project.contract_value * 0.5 ? 'green' : 'amber'}-700 text-base mt-1">${revenueProgress}%</p>`
              : `<p class="font-bold text-gray-400 text-base mt-1">—</p>`
            }
          </div>
        </div>
      </div>

      <!-- Monthly breakdown table -->
      ${Object.keys(timelineByMonth).length > 0 ? `
      <div class="card mb-4">
        <h3 class="font-bold text-sm mb-3"><i class="fas fa-calendar-alt text-blue-500 mr-2"></i>Chi tiết theo tháng</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-gray-500 border-b text-xs uppercase bg-gray-50">
              <th class="py-2 px-2">Tháng</th>
              <th class="py-2 px-2 text-right text-green-600">Doanh thu</th>
              <th class="py-2 px-2 text-right text-red-600">Chi phí</th>
              <th class="py-2 px-2 text-right">Lợi nhuận</th>
            </tr></thead>
            <tbody>${monthlyRows}</tbody>
          </table>
        </div>
        <p class="text-xs text-gray-400 mt-2">* Chi phí chung phân bổ không được phân tách theo tháng trong bảng này</p>
      </div>` : ''}
    `

    // Render charts
    setTimeout(() => {
      destroyChart('finCostPie')
      const ctx1 = $('finCostPie')
      if (ctx1 && costs_by_type.length) {
        const colors = ['#00A651','#2196F3','#FF6B00','#8B5CF6','#F59E0B','#EF4444']
        charts['finCostPie'] = safeChart(ctx1, {
          type: 'doughnut',
          data: {
            labels: costs_by_type.map(c => c.label || getCostTypeNameDynamic(c.cost_type)),
            datasets: [{ data: costs_by_type.map(c => c.total), backgroundColor: colors, borderWidth: 2 }]
          },
          options: {
            responsive: true,
            plugins: {
              legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } },
              tooltip: { callbacks: { label: (ctx) => ` ${fmtMoney(ctx.parsed)}` } }
            }
          }
        })
      }

      // Timeline chart: combined cost + revenue by month
      destroyChart('finTimeline')
      const ctx2 = $('finTimeline')
      if (ctx2) {
        // Merge all months from cost timeline, labor timeline and revenue timeline
        const allMonthsSet = new Set([
          ...(timeline || []).map(t => t.month),
          ...(labor_timeline || []).map(l => l.month),
          ...(revenue_timeline || []).map(r => r.month)
        ])
        const displayMonths = [...allMonthsSet].sort()
        if (displayMonths.length) {
          const otherCostData = displayMonths.map(m => (timeline || []).filter(t => t.month === m).reduce((s, t) => s + (t.total || 0), 0))
          const laborData     = displayMonths.map(m => { const l = (labor_timeline || []).find(l => l.month === m); return l?.total || 0 })
          const revenueData   = displayMonths.map(m => { const r = (revenue_timeline || []).find(r => r.month === m); return r?.total || 0 })
          charts['finTimeline'] = safeChart(ctx2, {
            type: 'bar',
            data: {
              labels: displayMonths.map(m => { const [y,mo] = m.split('-'); return `T${parseInt(mo)}/${y}` }),
              datasets: [
                { label: 'Lương', data: laborData, backgroundColor: 'rgba(59,130,246,0.75)', borderRadius: 4, order: 3, stack: 'cost' },
                { label: 'Chi phí khác', data: otherCostData, backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4, order: 4, stack: 'cost' },
                { label: 'Doanh thu', data: revenueData, backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4, order: 1 }
              ]
            },
            options: {
              responsive: true,
              plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y)}` } } },
              scales: { x: { stacked: true }, y: { beginAtZero: true, stacked: false, ticks: { callback: v => fmtMoney(v) } } }
            }
          })
        } else {
          ctx2.closest('.card').innerHTML += '<p class="text-xs text-gray-400 text-center py-4">Chưa có dữ liệu theo tháng</p>'
        }
      }
    }, 100)

  } catch(e) { toast('Lỗi tải tài chính dự án: ' + e.message, 'error') }
}

// Sync labor cost for finance project page
async function syncLaborForFinProject(projectId, dateFrom, dateTo) {
  const btn = event?.target?.closest('button')
  const origLabel = btn?.innerHTML || ''
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Đang đồng bộ...' }
  try {
    // Tính tất cả các năm nằm trong khoảng dateFrom → dateTo
    const fromYear = dateFrom ? parseInt(dateFrom.slice(0, 4)) : new Date().getFullYear()
    const toYear   = dateTo   ? parseInt(dateTo.slice(0, 4))   : new Date().getFullYear()
    let totalSynced = 0
    for (let y = fromYear; y <= toYear; y++) {
      const result = await api(`/projects/${projectId}/labor-costs/sync`, {
        method: 'POST',
        data: { year: y, all_months: true }
      })
      totalSynced += result.months_synced || 0
    }
    toast(`✅ Đã đồng bộ ${totalSynced} tháng`, 'success')
    loadFinanceProject()
  } catch(e) {
    toast('Lỗi đồng bộ: ' + e.message, 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel }
  }
}

// ================================================================
// LABOR COST PAGE — with manual monthly input + auto-calculation
// ================================================================

function formatLaborInput(input) {
  // Format number with thousand separators as user types
  const raw = input.value.replace(/[^\d]/g, '')
  input.value = raw ? new Intl.NumberFormat('vi-VN').format(raw) : ''
  input.dataset.raw = raw
}

async function saveLaborCost() {
  const month = $('laborInputMonth')?.value
  const year  = $('laborInputYear')?.value
  const rawEl = $('laborInputCost')
  const raw   = rawEl?.dataset.raw || rawEl?.value.replace(/[^\d]/g, '')
  const notes = $('laborInputNotes')?.value || ''

  if (!month || !year || !raw) {
    toast('Vui lòng nhập đầy đủ tháng, năm và tổng chi phí lương', 'warning')
    return
  }
  try {
    const result = await api('/monthly-labor-costs', {
      method: 'POST',
      data: { month: parseInt(month), year: parseInt(year), total_labor_cost: parseFloat(raw), notes }
    })
    toast(`Đã ${result.action === 'updated' ? 'cập nhật' : 'lưu'} chi phí lương tháng ${month}/${year}`, 'success')
    // Sync filter to the saved month/year and reload
    if ($('laborMonthFilter')) $('laborMonthFilter').value = month.padStart ? month.padStart(2,'0') : month
    if ($('laborYearFilter'))  $('laborYearFilter').value  = year
    loadLaborCost()
    // Refresh history if visible
    if ($('laborHistoryPanel')?.style.display !== 'none') loadLaborCostHistory()
  } catch(e) { toast('Lỗi lưu chi phí lương: ' + e.message, 'error') }
}

async function loadLaborCostHistory() {
  const panel = $('laborHistoryPanel')
  if (!panel) return
  panel.style.display = 'block'
  try {
    const rows = await api('/monthly-labor-costs')
    const tbody = $('laborHistoryTable')
    if (!tbody) return
    const mNames = ['','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12']
    tbody.innerHTML = rows.length ? rows.map(r => `
      <tr class="table-row border-b">
        <td class="py-2 pr-3 font-medium">${mNames[r.month] || r.month}/${r.year}</td>
        <td class="py-2 pr-3 text-right text-green-700 font-semibold">${fmt(r.total_labor_cost)} ₫</td>
        <td class="py-2 pr-3 text-gray-500 text-xs">${r.notes || '-'}</td>
        <td class="py-2 text-right">
          <button onclick="editLaborEntry(${r.month},${r.year},${r.total_labor_cost},'${(r.notes||'').replace(/'/g,'')}')"
            class="text-blue-500 hover:underline text-xs mr-2"><i class="fas fa-edit"></i></button>
          <button onclick="deleteLaborEntry(${r.id},'${mNames[r.month]}/${r.year}')"
            class="text-red-500 hover:underline text-xs"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="4" class="text-center py-4 text-gray-400">Chưa có dữ liệu nhập</td></tr>'
  } catch(e) { toast('Lỗi tải lịch sử: ' + e.message, 'error') }
}

function editLaborEntry(month, year, cost, notes) {
  if ($('laborInputMonth')) $('laborInputMonth').value = String(month).padStart(2,'0')
  if ($('laborInputYear'))  $('laborInputYear').value  = year
  const costEl = $('laborInputCost')
  if (costEl) { costEl.dataset.raw = cost; costEl.value = new Intl.NumberFormat('vi-VN').format(cost) }
  if ($('laborInputNotes')) $('laborInputNotes').value = notes
  $('laborInputCard')?.scrollIntoView({ behavior: 'smooth' })
}

async function deleteLaborEntry(id, label) {
  if (!confirm(`Xóa chi phí lương ${label}?`)) return
  try {
    await api(`/monthly-labor-costs/${id}`, { method: 'DELETE' })
    toast('Đã xóa', 'success')
    loadLaborCostHistory()
    loadLaborCost()
  } catch(e) { toast('Lỗi xóa: ' + e.message, 'error') }
}

async function loadLaborCost() {
  // Init month filter (single mode)
  const mf = $('laborMonthFilter')
  if (mf && mf.options.length === 0) {
    const mNames = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12']
    mNames.forEach((n, i) => {
      const opt = document.createElement('option')
      opt.value = String(i+1).padStart(2,'0'); opt.textContent = n
      if (i+1 === new Date().getMonth()+1) opt.selected = true
      mf.appendChild(opt)
    })
  }
  // Init year filter (động từ API)
  const yf = $('laborYearFilter')
  if (yf && yf.options.length === 0) {
    await initCalendarYearFilter(yf)
  }
  // Init input form dropdowns (month)
  const im = $('laborInputMonth')
  if (im && im.options.length === 0) {
    const mNames = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12']
    mNames.forEach((n, i) => {
      const opt = document.createElement('option')
      opt.value = String(i+1).padStart(2,'0'); opt.textContent = n
      if (i+1 === new Date().getMonth()+1) opt.selected = true
      im.appendChild(opt)
    })
  }
  const iy = $('laborInputYear')
  if (iy && iy.options.length === 0) {
    await initCalendarYearFilter(iy)
  }

  const periodType = $('laborPeriodType')?.value || 'single'
  const year = $('laborYearFilter')?.value || String(new Date().getFullYear())

  // --- YEARLY / MULTI-MONTH totals via /api/financial-summary/labor-costs-all-projects ---
  const yearlyCard = $('laborYearlyCard')
  const isMultiOrAll = (periodType === 'all' || periodType === 'multi')
  if (yearlyCard) yearlyCard.classList.toggle('hidden', !isMultiOrAll)

  if (isMultiOrAll) {
    // Build URL for project-level aggregated summary
    let aggUrl = `/financial-summary/labor-costs-all-projects?year=${year}`
    if (periodType === 'all') {
      aggUrl += '&all_months=true'
    } else {
      const checked = [...document.querySelectorAll('.laborMonthCheck:checked')].map(el => el.value)
      if (checked.length === 0) { toast('Vui lòng chọn ít nhất một tháng', 'warning'); return }
      aggUrl += `&months=${checked.join(',')}`
    }
    try {
      const aggData = await api(aggUrl)
      // Yearly totals card
      const fyStartM = aggData.fiscal_year_start_month || 2
      // NTC {year}: T1 (tháng fyStartM/{year}) đến T12 (tháng trước fyStartM/{year+1})
      const fyEndM = fyStartM === 1 ? 12 : fyStartM - 1
      const fyEndY = fyStartM === 1 ? parseInt(year) : parseInt(year) + 1
      const calPairsForLabel = aggData.cal_pairs || []
      let fyLabel
      if (periodType === 'all') {
        fyLabel = `Tổng hợp NTC ${year} (T1=${fyStartM}/${year} → T12=${fyEndM}/${fyEndY})`
      } else {
        // Hiển thị các tháng dương lịch đã chọn
        const mLabels = calPairsForLabel.map(p => `${p.calMonth}/${p.calYear}`).join(', ')
        fyLabel = `Tổng hợp tháng: ${mLabels}`
      }
      if ($('laborYearlyTitle')) $('laborYearlyTitle').textContent = fyLabel
      if ($('laborYearlySubtitle')) $('laborYearlySubtitle').textContent = `${aggData.projects_count} dự án có dữ liệu`
      // displayTotal = grand_total_labor_cost (phân bổ thực tế theo timesheet)
      // pool_total = tổng ngân sách lương đã nhập thủ công (tham chiếu)
      const displayTotal = aggData.grand_total_labor_cost
      const poolRef = aggData.pool_total || 0
      if ($('laborYearlyTotalCost')) {
        $('laborYearlyTotalCost').textContent = fmtMoney(displayTotal)
        // Hiển thị pool_total (ngân sách) bên dưới như thông tin tham chiếu
        const diffEl = $('laborYearlyPoolDiff')
        if (diffEl) {
          if (poolRef > 0) {
            const poolDiff = poolRef - displayTotal
            const poolDiffSign = poolDiff >= 0 ? '+' : ''
            const color = Math.abs(poolDiff) < 1000 ? 'text-green-600' : (poolDiff > 0 ? 'text-orange-500' : 'text-red-500')
            diffEl.innerHTML = `<span class="${color}">Ngân sách nhập: ${fmtMoney(poolRef)}` +
              (Math.abs(poolDiff) > 1000 ? ` <span class="text-xs">(${poolDiffSign}${fmtMoney(poolDiff)})</span>` : ' ✓') +
              `</span>`
            diffEl.classList.remove('hidden')
          } else {
            diffEl.classList.add('hidden')
          }
        }
      }

      // For per-project totals calculate aggregate hours & avg rate
      const projs = aggData.projects || []
      const totalHrs = projs.reduce((s, p) => s + (p.total_hours || 0), 0)
      // grand_avg_cost_per_hour từ API = grand_total_labor_cost / grand_total_eff_hours
      // Nhất quán với single-month (budget / comp_eff_hours), tránh sai lệch do làm tròn từng dự án
      const avgRate = aggData.grand_avg_cost_per_hour || 0
      if ($('laborYearlyTotalHours')) $('laborYearlyTotalHours').textContent = fmt(totalHrs) + 'h'
      if ($('laborYearlyAvgRate')) $('laborYearlyAvgRate').textContent = fmtMoney(Math.round(avgRate)) + '/h'

      // Hiển thị bảng tổng hợp theo dự án
      // Chi phí/giờ mỗi dự án = grand_avg_cost_per_hour (tất cả dự án trong cùng kỳ dùng cùng đơn giá)
      const tbody2 = $('laborTable')
      if (tbody2) {
        const rateLabel = fmtMoney(Math.round(avgRate))
        tbody2.innerHTML = projs.length ? projs.map(p => `
          <tr class="table-row border-b">
            <td class="py-2 pr-3">
              <div class="font-medium text-sm">${p.project_name}</div>
              <div class="text-xs text-gray-400">${p.project_code}</div>
            </td>
            <td class="py-2 pr-3 text-right">${fmt(p.total_hours||0)}h</td>
            <td class="py-2 pr-3 text-right">
              <span class="badge" style="background:#e0f2fe;color:#0369a1">${totalHrs > 0 ? ((p.total_hours||0)/totalHrs*100).toFixed(1) : 0}%</span>
            </td>
            <td class="py-2 pr-3 text-right text-purple-600">${rateLabel}/h</td>
            <td class="py-2 text-right font-semibold text-green-700">
              ${fmtMoney(p.total_labor_cost||0)}
              <div class="text-xs text-gray-400">${p.months_count} tháng</div>
            </td>
          </tr>
        `).join('') : '<tr><td colspan="5" class="text-center py-6 text-gray-400">Không có dữ liệu trong kỳ này</td></tr>'
      }

      // Charts — destroy & rebuild bar chart with project totals
      destroyChart('labor')
      const ctx1 = $('laborChart')
      if (ctx1 && projs.length) {
        charts['labor'] = safeChart(ctx1, {
          type: 'bar',
          data: {
            labels: projs.map(p => p.project_code),
            datasets: [{ label: 'Chi phí lương (₫)', data: projs.map(p => p.total_labor_cost||0), backgroundColor: '#00A651', borderRadius: 4 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
            scales: { y: { beginAtZero: true, ticks: { font: { size: 11 }, callback: v => fmtMoney(v) } } }
          }
        })
      }
      destroyChart('laborPie')
      const ctx2 = $('laborPieChart')
      if (ctx2 && projs.length) {
        const colors = ['#00A651','#0066CC','#FF6B00','#8B5CF6','#F59E0B','#EF4444','#10B981','#3B82F6']
        charts['laborPie'] = safeChart(ctx2, {
          type: 'pie',
          data: {
            labels: projs.map(p => p.project_code + ' (' + (totalHrs>0 ? ((p.total_hours||0)/totalHrs*100).toFixed(1) : '0.0') + '%)'),
            datasets: [{ data: projs.map(p => p.total_hours||0), backgroundColor: colors }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 10 } } } } }
        })
      }

      // KPI cards — dùng grand_total_labor_cost (phân bổ thực tế) làm KPI chính
      const kpiTotal = aggData.grand_total_labor_cost
      if ($('laborKpiPool'))     $('laborKpiPool').textContent     = fmtMoney(kpiTotal)
      if ($('laborKpiSource'))   $('laborKpiSource').textContent   = periodType === 'all' ? `🗓️ NTC ${year}` : `📆 Nhiều tháng NTC ${year}`
      if ($('laborKpiHours'))    $('laborKpiHours').textContent    = fmt(totalHrs) + 'h'
      if ($('laborKpiRate'))     $('laborKpiRate').textContent     = fmtMoney(Math.round(avgRate)) + '/h'
      if ($('laborKpiProjects')) $('laborKpiProjects').textContent = aggData.projects_count || 0

      // Monthly breakdown table — dùng monthly_totals từ API (phân bổ thực tế)
      // Đồng thời load monthly_labor_costs để hiển thị ngân sách nhập (tham chiếu)
      const monthlyBreakTbody = $('laborMonthlyBreakdownTable')
      const monthlyTotalsData = aggData.monthly_totals || []
      if (monthlyBreakTbody && monthlyTotalsData.length > 0) {
        try {
          // Load ngân sách nhập thủ công để hiển thị tham chiếu
          const mlcList = await api(`/monthly-labor-costs`)
          const mlcMap = {}
          for (const r of mlcList) mlcMap[`${r.month}-${r.year}`] = r

          const cph = aggData.grand_avg_cost_per_hour || 0
          const rows = monthlyTotalsData.map(mt => {
            const ntcLabel = `T${mt.fiscal_idx}`
            const calLabel = `(${mt.cal_month}/${mt.cal_year})`
            const mlcEntry = mlcMap[`${mt.cal_month}-${mt.cal_year}`]
            const budgetAmt = mlcEntry?.total_labor_cost || 0
            const hrs = mt.raw_hours || 0
            const allocated = mt.allocated || 0
            const cphRow = hrs > 0 && allocated > 0 ? Math.round(allocated / hrs) : cph

            if (hrs === 0 && allocated === 0) {
              // Không có timesheet tháng này
              return `<tr class="border-b border-blue-100">
                <td class="py-1 pr-3">
                  <span class="font-medium text-blue-700">${ntcLabel}</span>
                  <span class="text-xs text-blue-400 ml-1">${calLabel}</span>
                </td>
                <td colspan="4" class="py-1 text-xs text-gray-400 text-center">Chưa có timesheet</td>
              </tr>`
            }

            // So sánh phân bổ TT vs ngân sách nhập
            const budgetDiff = budgetAmt > 0 ? allocated - budgetAmt : 0
            const budgetDiffStr = budgetAmt > 0
              ? `<span class="text-xs ${Math.abs(budgetDiff) < 1000 ? 'text-green-500' : (budgetDiff > 0 ? 'text-red-400' : 'text-orange-400')}" title="Ngân sách nhập: ${fmtMoney(budgetAmt)}">${' / NS: ' + fmtMoney(budgetAmt)}</span>`
              : ''

            return `<tr class="border-b border-blue-100">
              <td class="py-1 pr-3">
                <span class="font-medium text-blue-700">${ntcLabel}</span>
                <span class="text-xs text-blue-400 ml-1">${calLabel}</span>
              </td>
              <td class="py-1 pr-3 text-right">${hrs > 0 ? fmt(hrs) + 'h' : '—'}</td>
              <td class="py-1 pr-3 text-right text-purple-600">${cphRow > 0 ? fmtMoney(cphRow) + '/h' : '—'}</td>
              <td class="py-1 text-right font-semibold text-green-700">
                ${fmtMoney(allocated)}${budgetDiffStr}
              </td>
            </tr>`
          }).join('')
          monthlyBreakTbody.innerHTML = rows
          $('laborMonthlyTableWrap')?.classList.remove('hidden')
        } catch(e2) { console.warn('Monthly breakdown error:', e2) }
      }
      return
    } catch(e) { toast('Lỗi tải dữ liệu tổng hợp: ' + e.message, 'error'); return }
  }

  // --- SINGLE MONTH mode (original behavior) ---
  try {
    const month = $('laborMonthFilter')?.value
    let url = '/finance/labor-cost?'
    if (month) url += `month=${month}&`
    if (year)  url += `year=${year}`
    const data = await api(url)

    // KPI cards
    // FIX: laborUsed = 0 nếu chưa nhập thủ công, KHÔNG tự dùng salary_pool
    const laborUsed = data.manual_labor_cost ?? 0
    if ($('laborKpiPool'))     $('laborKpiPool').textContent     = fmtMoney(laborUsed)
    if ($('laborKpiSource'))   $('laborKpiSource').textContent   = data.cost_source === 'manual' ? '✏️ Đã nhập thủ công' : (data.total_hours > 0 ? '⚠️ Chưa nhập chi phí lương' : '— Không có timesheet tháng này')
    if ($('laborKpiHours'))    $('laborKpiHours').textContent    = fmt(data.total_hours) + 'h'
    if ($('laborKpiRate'))     $('laborKpiRate').textContent     = data.cost_source === 'manual' ? fmtMoney(data.cost_per_hour) + '/h' : '— chưa nhập'
    if ($('laborKpiProjects')) $('laborKpiProjects').textContent = data.projects?.length || 0

    // Source badge
    const badge = $('laborCostSourceBadge')
    if (badge) {
      if (data.total_hours === 0) {
        badge.innerHTML = `<span class="badge" style="background:#f3f4f6;color:#6b7280;font-size:11px">ℹ️ Không có timesheet tháng ${data.month_int}/${data.year_int} — Chi phí lương = 0</span>`
      } else if (data.cost_source === 'manual') {
        badge.innerHTML = `<span class="badge" style="background:#dcfce7;color:#166534;font-size:11px">✏️ Chi phí đã nhập tháng ${data.month_int}/${data.year_int}: ${fmtMoney(data.manual_labor_cost)}</span>`
      } else {
        badge.innerHTML = `<span class="badge" style="background:#fee2e2;color:#991b1b;font-size:11px">⚠️ Chưa nhập chi phí lương tháng ${data.month_int}/${data.year_int}</span>`
      }
    }

    // Pre-fill the input form with current month's value if exists
    if (data.manual_labor_cost && $('laborInputCost') && !$('laborInputCost').dataset.raw) {
      $('laborInputCost').dataset.raw = data.manual_labor_cost
      $('laborInputCost').value = new Intl.NumberFormat('vi-VN').format(data.manual_labor_cost)
      if ($('laborInputNotes')) $('laborInputNotes').value = data.notes || ''
      if ($('laborInputMonth')) $('laborInputMonth').value = String(data.month_int).padStart(2,'0')
      if ($('laborInputYear'))  $('laborInputYear').value  = data.year_int
    }

    // Formula detail
    const fd = $('laborFormulaDetail')
    if (fd) {
      if (data.total_hours === 0) {
        fd.textContent = `Không có dữ liệu timesheet tháng ${data.month_int}/${data.year_int} → Chi phí lương = 0 ₫`
      } else if (data.cost_source === 'manual') {
        fd.textContent = `${fmtMoney(data.manual_labor_cost)} ÷ ${fmt(data.total_hours)}h = ${fmtMoney(data.cost_per_hour)}/h (nguồn: nhập thủ công tháng ${data.month_int}/${data.year_int})`
      } else {
        fd.textContent = `Có ${fmt(data.total_hours)}h làm việc nhưng chưa nhập chi phí lương tháng ${data.month_int}/${data.year_int}. Vui lòng nhập chi phí lương để tính chi phí/giờ.`
      }
    }

    // Charts
    destroyChart('labor')
    const ctx1 = $('laborChart')
    if (ctx1 && data.projects?.length) {
      charts['labor'] = safeChart(ctx1, {
        type: 'bar',
        data: {
          labels: data.projects.map(p => p.code),
          datasets: [{ label: 'Chi phí lương (₫)', data: data.projects.map(p => p.labor_cost), backgroundColor: '#00A651', borderRadius: 4 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
          scales: { y: { beginAtZero: true, ticks: { font: { size: 11 }, callback: v => fmtMoney(v) } } }
        }
      })
    }
    destroyChart('laborPie')
    const ctx2 = $('laborPieChart')
    if (ctx2 && data.projects?.length) {
      const colors = ['#00A651','#0066CC','#FF6B00','#8B5CF6','#F59E0B','#EF4444','#10B981','#3B82F6']
      charts['laborPie'] = safeChart(ctx2, {
        type: 'pie',
        data: {
          labels: data.projects.map(p => p.code + ' (' + p.pct + '%)'),
          datasets: [{ data: data.projects.map(p => p.project_hours), backgroundColor: colors }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'right', labels: { font: { size: 10 } } } }
        }
      })
    }

    // Table — enhanced with cost_per_hour column
    const tbody = $('laborTable')
    if (tbody) {
      tbody.innerHTML = data.projects?.map(p => `
        <tr class="table-row border-b">
          <td class="py-2 pr-3">
            <div class="font-medium text-sm">${p.name}</div>
            <div class="text-xs text-gray-400">${p.code}</div>
          </td>
          <td class="py-2 pr-3 text-right">${fmt(p.project_hours)}h</td>
          <td class="py-2 pr-3 text-right">
            <span class="badge" style="background:#e0f2fe;color:#0369a1">${p.pct}%</span>
          </td>
          <td class="py-2 pr-3 text-right text-purple-600">${fmtMoney(data.cost_per_hour)}/h</td>
          <td class="py-2 text-right font-semibold text-green-700">
            ${fmt(p.labor_cost)} ₫
            <i class="fas fa-lock text-gray-300 ml-1 text-xs" title="Tính tự động"></i>
          </td>
        </tr>
      `).join('') || '<tr><td colspan="5" class="text-center py-6 text-gray-400">Không có dữ liệu timesheet tháng này</td></tr>'
    }
  } catch(e) { toast('Lỗi tải chi phí lương: ' + e.message, 'error') }
}

// Period-type toggle for Labor Cost page
function onLaborPeriodTypeChange() {
  const pt = $('laborPeriodType')?.value || 'single'
  const single = $('laborSingleControls')
  const multi  = $('laborMultiControls')
  const yCard  = $('laborYearlyCard')
  if (single) single.classList.toggle('hidden', pt !== 'single')
  if (multi)  multi.classList.toggle('hidden', pt !== 'multi')
  if (yCard)  yCard.classList.toggle('hidden', pt === 'single')
  // Auto-reload on type change
  if (pt !== 'multi') loadLaborCost() // multi requires checkbox selection first
}

function toggleLaborMonthlyTable() {
  const wrap = $('laborMonthlyTableWrap')
  const btn  = $('btnToggleLaborMonthly')
  if (!wrap) return
  const hidden = wrap.classList.toggle('hidden')
  if (btn) btn.innerHTML = hidden
    ? '<i class="fas fa-table mr-1"></i>Xem chi tiết theo tháng'
    : '<i class="fas fa-eye-slash mr-1"></i>Ẩn chi tiết'
}



// ================================================================
// COST TYPES PAGE
// ================================================================
let allCostTypes = []

async function loadCostTypes() {
  try {
    allCostTypes = await api('/cost-types')
    renderCostTypesTable()
    // Đồng bộ dropdown Loại chi phí cho CẢ 2 form: chi phí riêng (costType) và chi phí chung (scCostType)
    _populateAllCostTypeDropdowns()
  } catch(e) { toast('Lỗi tải loại chi phí: ' + e.message, 'error') }
}

// Helper: populate tất cả dropdown loại chi phí từ allCostTypes
function _populateAllCostTypeDropdowns(savedValue = null) {
  const activeCostTypes = allCostTypes.filter(ct => ct.is_active)
  const optionsHtml = activeCostTypes.map(ct =>
    `<option value="${ct.code}">${ct.name}</option>`
  ).join('')

  // Form chi phí riêng (project_costs)
  const ctSel = $('costType')
  if (ctSel && activeCostTypes.length) {
    ctSel.innerHTML = optionsHtml
  }

  // Form chi phí chung (shared_costs)
  const scSel = $('scCostType')
  if (scSel && activeCostTypes.length) {
    scSel.innerHTML = optionsHtml
    if (savedValue) scSel.value = savedValue
  }
}

function renderCostTypesTable() {
  const tbody = $('costTypesTable')
  if (!tbody) return
  tbody.innerHTML = allCostTypes.map(ct => `
    <tr class="table-row">
      <td class="py-2 pr-3 font-mono font-bold text-sm text-primary">${ct.code}</td>
      <td class="py-2 pr-3 font-medium text-gray-800">${ct.name}</td>
      <td class="py-2 pr-3 text-sm text-gray-500">${ct.description || '-'}</td>
      <td class="py-2 pr-3 text-center">
        <span class="inline-block w-6 h-6 rounded-full border-2 border-gray-200" style="background:${ct.color||'#6B7280'}"></span>
      </td>
      <td class="py-2 pr-3 text-center text-sm text-gray-600">${ct.usage_count || 0}</td>
      <td class="py-2 pr-3 text-center">
        <span class="badge ${ct.is_active ? 'badge-completed' : 'badge-cancelled'}">${ct.is_active ? 'Đang dùng' : 'Ngưng'}</span>
      </td>
      <td class="py-2">
        <div class="flex gap-1">
          <button onclick="openCostTypeModal(${ct.id})" class="btn-secondary text-xs px-2 py-1"><i class="fas fa-edit"></i></button>
          ${ct.usage_count > 0 ? `<span class="text-gray-300 text-xs px-2 py-1" title="Đang được sử dụng, không thể xóa"><i class="fas fa-lock"></i></span>` :
            `<button onclick="deleteCostType(${ct.id},'${ct.name}')" class="text-red-400 hover:text-red-600 px-1.5 text-sm"><i class="fas fa-trash"></i></button>`}
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="text-center py-8 text-gray-400">Không có loại chi phí</td></tr>'
}

function openCostTypeModal(id = null) {
  $('costTypeModalTitle').textContent = id ? 'Chỉnh sửa loại chi phí' : 'Thêm loại chi phí'
  $('costTypeId').value = id || ''
  if (id) {
    const ct = allCostTypes.find(c => c.id === id)
    if (ct) {
      $('costTypeCode').value = ct.code || ''
      $('costTypeCode').disabled = true // code cannot be changed after creation
      $('costTypeName').value = ct.name || ''
      $('costTypeDesc').value = ct.description || ''
      $('costTypeColor').value = ct.color || '#6B7280'
      $('costTypeColorHex').value = ct.color || '#6B7280'
      $('costTypeActive').value = ct.is_active ? '1' : '0'
    }
  } else {
    $('costTypeCode').value = ''
    $('costTypeCode').disabled = false
    $('costTypeName').value = ''
    $('costTypeDesc').value = ''
    $('costTypeColor').value = '#6B7280'
    $('costTypeColorHex').value = '#6B7280'
    $('costTypeActive').value = '1'
  }
  // Sync color picker and hex
  $('costTypeColor').oninput = (e) => { $('costTypeColorHex').value = e.target.value }
  openModal('costTypeModal')
}

$('costTypeForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('costTypeId').value
  const data = {
    name: $('costTypeName').value,
    description: $('costTypeDesc').value,
    color: $('costTypeColor').value,
    is_active: parseInt($('costTypeActive').value)
  }
  if (!id) data.code = $('costTypeCode').value
  try {
    if (id) await api(`/cost-types/${id}`, { method: 'put', data })
    else await api('/cost-types', { method: 'post', data })
    closeModal('costTypeModal')
    toast(id ? 'Cập nhật loại chi phí thành công' : 'Thêm loại chi phí thành công')
    loadCostTypes()
  } catch(e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
})

function deleteCostType(id, name) {
  showConfirmDelete('Xóa Loại chi phí', `Xóa loại chi phí "<strong>${name}</strong>"?`,
    async () => {
      await api(`/cost-types/${id}`, { method: 'delete' })
      toast('Đã xóa loại chi phí')
      loadCostTypes()
    }
  )
}

// Update getCostTypeName to use dynamic list
function getCostTypeNameDynamic(code) {
  const ct = allCostTypes.find(c => c.code === code)
  return ct ? ct.name : getCostTypeName(code)
}

// ================================================================
// DATA AUDIT — Consistency Check + Fix
// ================================================================

// Run audit from Tài Chính Dự Án page (shows in dataAuditPanel)
async function runDataAudit() {
  const mf = $('finMonthFilter')?.value
  const yf = $('finYearFilter')?.value
  const panel = $('dataAuditPanel')
  if (!panel) return
  panel.innerHTML = `<div class="card p-4 text-sm text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Đang kiểm tra tính nhất quán dữ liệu...</div>`
  panel.classList.remove('hidden')
  try {
    let url = '/data-audit/consistency-check'
    const p = []; if (mf) p.push(`month=${mf}`); if (yf) p.push(`year=${yf}`)
    if (p.length) url += '?' + p.join('&')
    const data = await api(url)
    renderAuditPanel(panel, data, mf, yf)
  } catch(e) {
    panel.innerHTML = `<div class="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm"><i class="fas fa-times-circle mr-2"></i>Lỗi: ${e.message}</div>`
  }
}

// Run audit from Chi Phí & Doanh Thu analysis tab
async function runDataAuditForCosts() {
  const month = $('analysisMonthSel')?.value
  const year  = $('analysisYearSel')?.value
  const warnDiv = $('anaValidationWarnings')
  if (!warnDiv) return
  warnDiv.innerHTML = `<div class="bg-gray-50 rounded p-3 text-sm text-gray-500 mb-3"><i class="fas fa-spinner fa-spin mr-2"></i>Đang kiểm tra...</div>`
  warnDiv.classList.remove('hidden')
  try {
    let url = '/data-audit/consistency-check'
    if (month && year) url += `?month=${month}&year=${year}`
    const data = await api(url)
    const { summary, errors, warnings } = data
    const all = [...errors, ...warnings]
    if (all.length === 0) {
      warnDiv.innerHTML = `<div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-3 flex items-center gap-2">
        <i class="fas fa-check-circle text-green-500"></i>
        <span class="text-sm text-green-700">✅ Không phát hiện lỗi hoặc cảnh báo dữ liệu cho tháng ${summary.month}/${summary.year}</span>
      </div>`
    } else {
      const errHtml = errors.length > 0
        ? `<div class="mb-2"><span class="text-xs font-bold text-red-600 uppercase">Lỗi (${errors.length})</span>
            <ul class="mt-1 space-y-0.5">${errors.map(e => `<li class="text-xs text-red-700">🔴 ${e.message}</li>`).join('')}</ul></div>` : ''
      const warnHtml = warnings.length > 0
        ? `<div><span class="text-xs font-bold text-yellow-600 uppercase">Cảnh báo (${warnings.length})</span>
            <ul class="mt-1 space-y-0.5">${warnings.map(w => `<li class="text-xs text-yellow-700">🟡 ${w.message}</li>`).join('')}</ul></div>` : ''
      warnDiv.innerHTML = `<div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas fa-exclamation-triangle text-red-500"></i>
          <span class="font-semibold text-red-700 text-sm">Phát hiện ${all.length} vấn đề</span>
          <button onclick="fixDataInconsistency('${month}','${year}')" class="ml-auto text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">
            <i class="fas fa-wrench mr-1"></i>Tự động sửa
          </button>
        </div>
        ${errHtml}${warnHtml}
      </div>`
    }
  } catch(e) {
    warnDiv.innerHTML = `<div class="text-red-600 text-xs p-2">Lỗi kiểm tra: ${e.message}</div>`
  }
}

function renderAuditPanel(panel, data, mf, yf) {
  const { summary, errors, warnings } = data
  const statusColor = summary.status === 'OK' ? 'green' : summary.status === 'WARNING' ? 'yellow' : 'red'
  const statusIcon  = summary.status === 'OK' ? 'check-circle' : 'exclamation-triangle'

  panel.innerHTML = `
    <div class="card mb-4">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 rounded-full flex items-center justify-center" style="background:${statusColor === 'green' ? '#dcfce7' : statusColor === 'yellow' ? '#fef3c7' : '#fee2e2'}">
          <i class="fas fa-${statusIcon}" style="color:${statusColor === 'green' ? '#16a34a' : statusColor === 'yellow' ? '#d97706' : '#dc2626'}"></i>
        </div>
        <div>
          <h3 class="font-bold text-gray-800">Kiểm tra nhất quán dữ liệu — T${summary.month}/${summary.year}</h3>
          <p class="text-xs text-gray-500">${summary.total_errors} lỗi · ${summary.total_warnings} cảnh báo · Chi phí/giờ: ${fmtMoney(summary.cost_per_hour)}</p>
        </div>
        <div class="ml-auto flex gap-2">
          ${errors.length > 0 || summary.duplicate_cost_groups > 0 || summary.duplicate_timesheet_groups > 0
            ? `<button onclick="fixDataInconsistency('${mf||''}','${yf||''}')"
                class="text-sm bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700 flex items-center gap-1.5">
                <i class="fas fa-wrench"></i>Tự động sửa lỗi
              </button>` : ''}
          <button onclick="$('dataAuditPanel').classList.add('hidden')" class="text-xs text-gray-400 hover:text-gray-600 px-2">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <!-- Summary grid -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
        <div class="bg-gray-50 rounded p-3 text-center">
          <div class="text-xl font-bold ${summary.duplicate_cost_groups > 0 ? 'text-red-600' : 'text-green-600'}">${summary.duplicate_cost_groups}</div>
          <div class="text-xs text-gray-500">Nhóm trùng chi phí</div>
        </div>
        <div class="bg-gray-50 rounded p-3 text-center">
          <div class="text-xl font-bold ${summary.duplicate_timesheet_groups > 0 ? 'text-red-600' : 'text-green-600'}">${summary.duplicate_timesheet_groups}</div>
          <div class="text-xs text-gray-500">Nhóm trùng timesheet</div>
        </div>
        <div class="bg-gray-50 rounded p-3 text-center">
          <div class="text-xl font-bold text-blue-600">${summary.company_total_hours}</div>
          <div class="text-xs text-gray-500">Tổng giờ công ty</div>
        </div>
        <div class="bg-gray-50 rounded p-3 text-center">
          <div class="text-sm font-bold text-purple-600">${summary.labor_cost_source === 'manual' ? 'Thủ công' : 'Tự động'}</div>
          <div class="text-xs text-gray-500">Nguồn chi phí lương</div>
        </div>
      </div>

      <!-- Errors -->
      ${errors.length > 0 ? `
        <div class="mb-3">
          <h4 class="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1.5">
            <i class="fas fa-times-circle text-red-500"></i> Lỗi cần xử lý (${errors.length})
          </h4>
          <div class="space-y-1.5">
            ${errors.map(e => `
              <div class="flex items-start gap-2 bg-red-50 border border-red-100 rounded p-2 text-xs">
                <i class="fas fa-circle text-red-400 mt-0.5 flex-shrink-0" style="font-size:6px"></i>
                <div>
                  <span class="font-medium text-red-800">[${e.code}]</span>
                  <span class="text-red-700 ml-1">${e.message}</span>
                </div>
              </div>`).join('')}
          </div>
        </div>` : ''}

      <!-- Warnings -->
      ${warnings.length > 0 ? `
        <div>
          <h4 class="text-sm font-semibold text-yellow-700 mb-2 flex items-center gap-1.5">
            <i class="fas fa-exclamation-triangle text-yellow-500"></i> Cảnh báo (${warnings.length})
          </h4>
          <div class="space-y-1.5">
            ${warnings.map(w => `
              <div class="flex items-start gap-2 bg-yellow-50 border border-yellow-100 rounded p-2 text-xs">
                <i class="fas fa-circle text-yellow-400 mt-0.5 flex-shrink-0" style="font-size:6px"></i>
                <div>
                  <span class="font-medium text-yellow-800">[${w.code}]</span>
                  <span class="text-yellow-700 ml-1">${w.message}</span>
                </div>
              </div>`).join('')}
          </div>
        </div>` : ''}

      ${errors.length === 0 && warnings.length === 0 ? `
        <div class="flex items-center gap-2 text-green-700 text-sm py-2">
          <i class="fas fa-check-circle text-green-500"></i>
          <span>✅ Dữ liệu nhất quán — không có lỗi hay cảnh báo</span>
        </div>` : ''}
    </div>
  `
  panel.classList.remove('hidden')
}

async function fixDataInconsistency(month, year) {
  if (!confirm(`Tự động sửa lỗi dữ liệu cho tháng ${month||'hiện tại'}/${year||'hiện tại'}?\n\nHành động này sẽ:\n• Xóa bản ghi trùng lặp (giữ bản đầu tiên)\n• Đồng bộ chi phí lương dự án\n• Tạo bản ghi chi phí lương tháng nếu thiếu`)) return

  const btn = event?.target
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Đang sửa...' }

  try {
    const body = { actions: ['dedup_all', 'fix_labor', 'create_missing'] }
    if (month) body.month = parseInt(month)
    if (year) body.year = parseInt(year)
    const result = await api('/data-audit/fix-inconsistency', { method: 'POST', data: body })

    toast(`✅ Đã sửa: ${result.rows_deleted} bản ghi trùng xóa, ${result.rows_fixed} dự án đồng bộ, ${result.rows_created} bản ghi mới`, 'success')

    // Show result details
    const panel = $('dataAuditPanel')
    if (panel && !panel.classList.contains('hidden')) {
      const resultDiv = document.createElement('div')
      resultDiv.className = 'bg-green-50 border border-green-200 rounded-lg p-3 mb-3 text-sm'
      resultDiv.innerHTML = `
        <div class="font-semibold text-green-700 mb-1"><i class="fas fa-check-circle mr-1"></i>Kết quả sửa lỗi</div>
        <ul class="space-y-0.5 text-xs text-green-700">
          ${(result.actions_performed || []).map(a => `<li>• ${a}</li>`).join('')}
          <li>• Còn lại ${result.remaining_duplicate_groups} nhóm trùng</li>
        </ul>`
      panel.insertBefore(resultDiv, panel.firstChild)
    }

    // Re-run audit to show clean state
    setTimeout(() => runDataAudit(), 500)
  } catch(e) {
    toast('Lỗi sửa dữ liệu: ' + e.message, 'error')
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wrench mr-1"></i>Tự động sửa lỗi' }
  }
}


// =============================================
// SYSTEM CONFIG — Cấu hình hệ thống
// =============================================

async function loadSystemConfig() {
  try {
    const config = await api('/system/config')
    const factor = config.overtime_factor || 1.5
    const input = $('overtimeFactorInput')
    if (input) input.value = factor
    updateOvertimeExample(factor)

    // Fiscal year settings
    const fyMonth = config.fiscal_year_start_month || 2
    const fySelect = $('fyStartMonthInput')
    if (fySelect) fySelect.value = fyMonth
    updateFyExample(config.fiscal_year_example)
  } catch(e) {
    console.warn('Không tải được cấu hình hệ thống:', e.message)
  }
}

function updateOvertimeExample(factor) {
  const el = $('overtimeExample')
  if (!el) return
  const f = parseFloat(factor) || 1.5
  el.innerHTML = `
    <div class="flex justify-between border-b pb-1 mb-1">
      <span>8h thường + 2h tăng ca</span>
      <span class="font-semibold text-blue-700">= ${(8 + 2 * f).toFixed(1)} giờ quy đổi</span>
    </div>
    <div class="flex justify-between border-b pb-1 mb-1">
      <span>8h thường + 4h tăng ca</span>
      <span class="font-semibold text-blue-700">= ${(8 + 4 * f).toFixed(1)} giờ quy đổi</span>
    </div>
    <div class="flex justify-between">
      <span>Nếu CPH = 600,000 ₫/h:</span>
      <span class="font-semibold text-green-700">1h tăng ca = ${fmtMoney(Math.round(f * 600000))}</span>
    </div>
  `
}

async function saveOvertimeFactor() {
  const input = $('overtimeFactorInput')
  const val = parseFloat(input?.value)
  if (isNaN(val) || val < 1 || val > 5) {
    toast('Hệ số phải từ 1.0 đến 5.0', 'error')
    return
  }
  try {
    const result = await api('/system/config', { method: 'PUT', data: { overtime_factor: val } })
    toast(`✅ ${result.message} — Hệ số mới: ×${result.current_config.overtime_factor}`, 'success')
    updateOvertimeExample(val)
  } catch(e) {
    toast('Lỗi lưu cấu hình: ' + e.message, 'error')
  }
}

// ============================================================
// FISCAL YEAR CONFIG (Cấu hình Năm tài chính)
// ============================================================

function updateFyExample(fyExample) {
  const el = $('fyExample')
  if (!el) return
  if (!fyExample) {
    el.innerHTML = '<span class="text-gray-400">Chưa tải được thông tin</span>'
    return
  }
  const currentYear = new Date().getFullYear()
  el.innerHTML = `
    <div class="flex justify-between border-b pb-1 mb-1">
      <span>NTC ${fyExample.year || currentYear}:</span>
      <span class="font-semibold text-green-700">${fyExample.start || '?'} → ${fyExample.end || '?'}</span>
    </div>
    <div class="flex justify-between border-b pb-1 mb-1">
      <span>NTC ${(fyExample.year || currentYear) + 1}:</span>
      <span class="font-semibold text-green-700">${fyExample.start ? fyExample.start.replace(/^\d{4}/, (fyExample.year||currentYear)+1) : '?'} → ${fyExample.end ? fyExample.end.replace(/^\d{4}/, (fyExample.year||currentYear)+2) : '?'}</span>
    </div>
    <div class="mt-2 text-xs text-green-600 font-medium">
      <i class="fas fa-info-circle mr-1"></i>${fyExample.label || ''}
    </div>
  `
}

async function saveFiscalYearConfig() {
  const monthSelect = $('fyStartMonthInput')
  const monthVal = parseInt(monthSelect?.value)
  if (isNaN(monthVal) || monthVal < 1 || monthVal > 12) {
    toast('Tháng bắt đầu NTC phải từ 1 đến 12', 'error')
    return
  }
  try {
    const result = await api('/system/config', { method: 'PUT', data: {
      fiscal_year_start_month: monthVal,
      fiscal_year_start_day: 1
    }})
    toast(`✅ ${result.message}`, 'success')
    updateFyExample(result.current_config?.fiscal_year_example)
  } catch(e) {
    toast('Lỗi lưu cấu hình NTC: ' + e.message, 'error')
  }
}

// Real-time preview as user types
document.addEventListener('DOMContentLoaded', () => {
  const input = $('overtimeFactorInput')
  if (input) {
    input.addEventListener('input', () => updateOvertimeExample(input.value))
  }
  const fySelect = $('fyStartMonthInput')
  if (fySelect) {
    fySelect.addEventListener('change', async () => {
      // Preview: fetch config example for selected month
      const m = parseInt(fySelect.value)
      const currentYear = new Date().getFullYear()
      const pad = n => String(n).padStart(2, '0')
      const endMonth = m === 1 ? 12 : m - 1
      const endYear  = m === 1 ? currentYear : currentYear + 1
      const endDay   = new Date(endYear, endMonth, 0).getDate()
      updateFyExample({
        year: currentYear,
        start: `${currentYear}-${pad(m)}-01`,
        end: `${endYear}-${pad(endMonth)}-${pad(endDay)}`,
        label: `NTC ${currentYear}: ${pad(1)}/${pad(m)}/${currentYear} – ${pad(endDay)}/${pad(endMonth)}/${endYear}`
      })
    })
  }
})

// ============================================================
// SHARED COSTS (Chi phí chung)
// ============================================================

let _sharedCosts = []
let _sharedCostSummary = null

// Mở tab chi phí chung và load dữ liệu
async function loadSharedCosts() {
  const year = $('costYearFilter')?.value || new Date().getFullYear().toString()
  try {
    // Đảm bảo allCostTypes đã load (cần cho dropdown loại chi phí)
    if (!allCostTypes.length) {
      try { allCostTypes = await api('/cost-types') } catch(e) {}
    }

    const [list, summary] = await Promise.all([
      api(`/shared-costs?year=${year}`),
      api(`/shared-costs/summary?year=${year}`)
    ])
    _sharedCosts = Array.isArray(list) ? list : []
    _sharedCostSummary = summary

    // KPI cards
    const total = summary.total_shared_cost || 0
    const count = summary.shared_cost_count || 0
    const byProject = summary.by_project || []
    const projectCount = byProject.length
    const avg = projectCount > 0 ? total / projectCount : 0

    if ($('sharedKpiTotal')) $('sharedKpiTotal').textContent = fmtMoney(total)
    if ($('sharedKpiCount')) $('sharedKpiCount').textContent = count + ' khoản'
    if ($('sharedKpiProjects')) $('sharedKpiProjects').textContent = projectCount + ' dự án'
    if ($('sharedKpiAvg')) $('sharedKpiAvg').textContent = fmtMoney(avg)

    // Phân bổ theo dự án
    const allocDiv = $('sharedAllocationByProject')
    if (allocDiv) {
      if (byProject.length === 0) {
        allocDiv.innerHTML = '<p class="text-xs text-gray-400 col-span-4">Chưa có phân bổ nào</p>'
      } else {
        allocDiv.innerHTML = byProject.map(p => `
          <div class="bg-white border rounded p-2 text-xs">
            <div class="font-semibold text-gray-700">${p.code}</div>
            <div class="text-gray-500 truncate" title="${p.name}">${p.name}</div>
            <div class="font-bold text-indigo-600 mt-1">${fmtMoney(p.allocated_cost)}</div>
            <div class="text-gray-400">${p.shared_cost_count} khoản</div>
          </div>
        `).join('')
      }
    }

    // Populate type filter dropdown from loaded data
    const typeFilterSel = $('sharedTypeFilter')
    if (typeFilterSel) {
      const currentVal = typeFilterSel.value
      const uniqueTypes = [...new Set(_sharedCosts.map(sc => sc.cost_type).filter(Boolean))]
      typeFilterSel.innerHTML = '<option value="">-- Tất cả loại CP --</option>'
        + uniqueTypes.map(code => {
            const name = getCostTypeNameDynamic(code)
            return `<option value="${code}"${code === currentVal ? ' selected' : ''}>${name}</option>`
          }).join('')
    }

    // Bảng danh sách
    renderSharedCostTable()
  } catch (e) {
    toast('Lỗi tải chi phí chung: ' + e.message, 'error')
  }
}

function renderSharedCostTable() {
  const tbody = $('sharedCostTableBody')
  if (!tbody) return

  // Apply filters
  const typeFilter = $('sharedTypeFilter')?.value || ''
  const descSearch = ($('sharedDescSearch')?.value || '').toLowerCase().trim()
  const filtered = _sharedCosts.filter(sc => {
    if (typeFilter && sc.cost_type !== typeFilter) return false
    if (descSearch && !(sc.description || '').toLowerCase().includes(descSearch)) return false
    return true
  })

  // Update filter info
  const infoEl = $('sharedFilterInfo')
  if (infoEl) {
    const hasFilter = typeFilter || descSearch
    infoEl.textContent = hasFilter ? `Hiển thị ${filtered.length} / ${_sharedCosts.length} khoản` : `${_sharedCosts.length} khoản`
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-400">
      <i class="fas fa-folder-open text-2xl mb-2 block"></i>
      ${_sharedCosts.length === 0 ? `Chưa có chi phí chung. <button onclick="openSharedCostModal()" class="text-blue-600 hover:underline">Thêm ngay</button>` : 'Không có kết quả phù hợp với bộ lọc.'}
    </td></tr>`
    return
  }

  const basisLabel = { contract_value: '% GTHĐ', equal: 'Chia đều', manual: 'Thủ công' }
  const costTypeLabel = {
    office: 'Chi phí văn phòng', equipment: 'Chi phí thiết bị', material: 'Chi phí vật liệu',
    travel: 'Chi phí đi lại', transport: 'Chi phí vận chuyển', salary: 'Chi phí lương',
    depreciation: 'Chi phí khấu hao', other: 'Chi phí khác', manmonth: 'Chi phí tháng',
    department: 'Chi phí phòng', shared: 'Chi phí chung (phân bổ)'
  }
  const costTypeStyle = {
    depreciation: 'background:#ede9fe;color:#5b21b6',  // tím cho khấu hao
    salary:       'background:#dbeafe;color:#1e40af',  // xanh lam cho lương
    equipment:    'background:#fef3c7;color:#92400e',  // vàng cho thiết bị
    material:     'background:#dcfce7;color:#166534',  // xanh lá cho vật liệu
    travel:       'background:#fce7f3;color:#9d174d',  // hồng cho đi lại
    transport:    'background:#ffedd5;color:#9a3412',  // cam cho vận chuyển
    office:       'background:#e0f2fe;color:#075985',  // xanh nhạt cho văn phòng
    manmonth:     'background:#fef9c3;color:#854d0e',  // vàng nhạt cho tháng
    department:   'background:#f0fdf4;color:#166534',  // xanh nhạt cho phòng
    other:        'background:#f3f4f6;color:#374151',  // xám cho khác
  }

  // Helper lấy màu từ allCostTypes (DB) cho loại tuỳ chỉnh
  const _getSharedTypeStyle = (code) => {
    if (costTypeStyle[code]) return costTypeStyle[code]
    const ct = allCostTypes.find(c => c.code === code)
    if (ct && ct.color) return `background:${ct.color}22;color:${ct.color}`
    return 'background:#fef3c7;color:#92400e'
  }

  tbody.innerHTML = filtered.map(sc => {
    const allocInfo = (sc.allocations || []).map(a =>
      `<span class="inline-block bg-indigo-100 text-indigo-700 rounded px-1 py-0.5 mr-1 mb-1 text-xs" title="${a.project_name}: ${fmtMoney(a.allocated_amount)} (${a.allocation_pct.toFixed(1)}%)">${a.project_code}: ${fmtMoney(a.allocated_amount)}</span>`
    ).join('')
    const period = sc.month ? `T${sc.month}/${sc.year}` : (sc.year ? `NTC${sc.year}` : '-')
    const typeStyle = _getSharedTypeStyle(sc.cost_type)
    const typeLabel = costTypeLabel[sc.cost_type] || getCostTypeNameDynamic(sc.cost_type)
    const isDepr = sc.cost_type === 'depreciation'
    return `<tr class="hover:bg-gray-50${isDepr ? ' bg-purple-50' : ''}">
      <td class="px-3 py-2">
        <div class="font-medium text-gray-800">${sc.description}</div>
        ${sc.notes ? `<div class="text-xs text-gray-400">${sc.notes}</div>` : ''}
        <div class="mt-1">${allocInfo}</div>
      </td>
      <td class="px-3 py-2 text-xs"><span class="badge" style="${typeStyle}">${typeLabel}</span></td>
      <td class="px-3 py-2 text-right font-semibold text-yellow-700">${fmtMoney(sc.amount)}</td>
      <td class="px-3 py-2 text-center text-xs">${basisLabel[sc.allocation_basis] || sc.allocation_basis}</td>
      <td class="px-3 py-2 text-center text-xs">${sc.project_count || 0} dự án</td>
      <td class="px-3 py-2 text-center text-xs font-medium${isDepr ? ' text-purple-700' : ''}">${period}</td>
      <td class="px-3 py-2 text-xs text-gray-500">${sc.vendor || '-'}</td>
      <td class="px-3 py-2 text-center">
        <button onclick="openSharedCostModal(${sc.id})" class="text-blue-600 hover:text-blue-800 mr-2 text-xs"><i class="fas fa-edit"></i></button>
        <button onclick="deleteSharedCost(${sc.id})" class="text-red-500 hover:text-red-700 text-xs"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`
  }).join('')
}

// Hiển thị NTC year hint khi user chọn tháng/năm trong form chi phí chung
function updateScNtcHint() {
  const hint = $('scNtcHint')
  if (!hint) return
  const monthVal = $('scMonth')?.value
  const yearVal  = $('scYear')?.value
  if (!monthVal || !yearVal) { hint.classList.add('hidden'); return }
  const calMonth = parseInt(monthVal)
  const calYear  = parseInt(yearVal)
  // NTC bắt đầu tháng 2 (mặc định) — lấy từ setting nếu có, fallback = 2
  const fiscalStartMonth = window._fiscalStartMonth || 2
  const ntcYear = calMonth < fiscalStartMonth ? calYear - 1 : calYear
  const isWrap  = calMonth < fiscalStartMonth  // tháng "wrap" sang NTC năm trước
  hint.className = `text-xs mt-1 font-semibold ${isWrap ? 'text-orange-600' : 'text-green-600'}`
  hint.textContent = `→ Tháng ${calMonth}/${calYear} thuộc NTC ${ntcYear}${isWrap ? ' ⚠️ (tháng đầu năm lịch)' : ''}`
  hint.classList.remove('hidden')
}

function clearSharedFilters() {
  const tf = $('sharedTypeFilter'); if (tf) tf.value = ''
  const ds = $('sharedDescSearch'); if (ds) ds.value = ''
  renderSharedCostTable()
}

// Thu nhỏ / mở rộng hộp Phân bổ theo dự án
let _allocationPanelCollapsed = false
function toggleAllocationPanel() {
  _allocationPanelCollapsed = !_allocationPanelCollapsed
  const panel = $('sharedAllocationByProject')
  const icon  = $('iconToggleAllocation')
  const lbl   = $('lblToggleAllocation')
  if (!panel) return
  if (_allocationPanelCollapsed) {
    panel.style.maxHeight = '0'
    panel.style.overflow  = 'hidden'
    panel.style.transition = 'max-height 0.3s ease'
    if (icon) { icon.classList.remove('fa-chevron-up'); icon.classList.add('fa-chevron-down') }
    if (lbl)  lbl.textContent = 'Mở rộng'
  } else {
    panel.style.maxHeight = '1000px'
    panel.style.overflow  = 'visible'
    panel.style.transition = 'max-height 0.4s ease'
    if (icon) { icon.classList.remove('fa-chevron-down'); icon.classList.add('fa-chevron-up') }
    if (lbl)  lbl.textContent = 'Thu nhỏ'
  }
}

async function openSharedCostModal(id = null) {
  if (!allProjects.length) allProjects = await api('/projects')

  // Đảm bảo danh sách loại chi phí đã được load
  if (!allCostTypes.length) {
    try { allCostTypes = await api('/cost-types') } catch(e) {}
  }
  // Populate dropdown scCostType từ danh sách loại chi phí động
  _populateAllCostTypeDropdowns()

  // Khởi tạo scYear động (chỉ lần đầu)
  const scYearEl = $('scYear')
  if (scYearEl && scYearEl.options.length === 0) {
    await initCalendarYearFilter(scYearEl)
  }

  // Reset form
  $('sharedCostId').value = ''
  $('sharedCostForm').reset()
  $('scYear').value = $('costYearFilter')?.value || new Date().getFullYear().toString()
  $('scCostDate').value = new Date().toISOString().split('T')[0]
  $('scPreviewPanel').classList.add('hidden')
  updateScNtcHint()

  // Reset search + select-all button
  const searchEl = $('scProjectSearch')
  if (searchEl) searchEl.value = ''
  const selAllBtn = $('scSelectAllBtn')
  if (selAllBtn) { selAllBtn.innerHTML = '<i class="fas fa-check-square"></i> Chọn tất cả'; selAllBtn._allSelected = false }

  // Render project checkboxes
  const activeProjects = allProjects.filter(p => p.status !== 'cancelled')
  $('scProjectList').innerHTML = activeProjects.map(p => `
    <label data-proj-id="${p.id}" data-proj-code="${p.code}" data-proj-name="${p.name}"
      class="flex items-center gap-2 p-2 hover:bg-white rounded cursor-pointer border border-transparent hover:border-gray-200 transition-colors">
      <input type="checkbox" class="scProjectCheck" value="${p.id}" data-contract="${p.contract_value || 0}"
        onchange="updateSharedCostPreview()">
      <div class="flex-1 min-w-0">
        <span class="font-medium text-sm text-gray-800">${p.code}</span>
        <span class="text-xs text-gray-500 ml-2 truncate">${p.name}</span>
      </div>
      <span class="text-xs text-gray-400">${fmtMoney(p.contract_value || 0)}</span>
      <span class="scManualPctWrap hidden ml-2">
        <input type="number" class="scManualPct border rounded px-1 py-0.5 w-16 text-xs text-right"
          placeholder="%" min="0" max="100" step="0.1"
          data-project-id="${p.id}" oninput="updateSharedCostPreview()">
        <span class="text-xs text-gray-400">%</span>
      </span>
    </label>
  `).join('')

  if (id) {
    // Edit mode
    $('sharedCostModalTitle').textContent = 'Chỉnh sửa chi phí chung'
    const sc = _sharedCosts.find(s => s.id === id)
    if (sc) {
      $('sharedCostId').value = sc.id
      $('scDescription').value = sc.description
      // Populate dropdown trước, rồi set giá trị đã lưu
      _populateAllCostTypeDropdowns(sc.cost_type || 'other')
      setMoneyInput('scAmount', sc.amount || 0)
      if (sc.cost_date) $('scCostDate').value = sc.cost_date
      if (sc.month) $('scMonth').value = sc.month
      if (sc.year) $('scYear').value = sc.year
      updateScNtcHint()
      if (sc.invoice_number) $('scInvoice').value = sc.invoice_number
      if (sc.vendor) $('scVendor').value = sc.vendor
      if (sc.notes) $('scNotes').value = sc.notes
      $('scAllocationBasis').value = sc.allocation_basis || 'contract_value'

      // Pre-check allocated projects
      const allocatedIds = (sc.allocations || []).map(a => a.project_id)
      const manualPcts = {}
      ;(sc.allocations || []).forEach(a => { manualPcts[a.project_id] = a.allocation_pct })

      document.querySelectorAll('.scProjectCheck').forEach(chk => {
        if (allocatedIds.includes(parseInt(chk.value))) {
          chk.checked = true
          const manualInput = chk.closest('label').querySelector('.scManualPct')
          if (manualInput) manualInput.value = (manualPcts[parseInt(chk.value)] || '').toFixed(1)
        }
      })

      onAllocationBasisChange()
      updateSharedCostPreview()
    }
  } else {
    $('sharedCostModalTitle').textContent = 'Thêm chi phí chung'
    onAllocationBasisChange()
  }

  $('sharedCostModal').style.display = 'flex'

  // Form submit
  $('sharedCostForm').onsubmit = async (e) => {
    e.preventDefault()
    await saveSharedCost()
  }
}

function onAllocationBasisChange() {
  const basis = $('scAllocationBasis')?.value || 'contract_value'
  const hints = {
    contract_value: 'Phân bổ theo tỷ lệ % giá trị hợp đồng (GTHĐ) của mỗi dự án so với tổng GTHĐ các dự án được chọn.',
    equal: 'Chia đều chi phí cho tất cả dự án được chọn (mỗi dự án nhận cùng số tiền).',
    manual: 'Nhập tay % phân bổ cho từng dự án. Tổng % phải = 100%.'
  }
  if ($('scBasisHint')) $('scBasisHint').textContent = hints[basis] || ''

  // Show/hide manual % inputs
  const isManual = basis === 'manual'
  document.querySelectorAll('.scManualPctWrap').forEach(wrap => {
    wrap.classList.toggle('hidden', !isManual)
  })
  updateSharedCostPreview()
}

// Lọc danh sách dự án trong modal chi phí chung theo search
function filterScProjectList() {
  const q = ($('scProjectSearch')?.value || '').trim().toLowerCase()
  const labels = $('scProjectList')?.querySelectorAll('label[data-proj-id]')
  if (!labels) return
  labels.forEach(lbl => {
    const code = (lbl.dataset.projCode || '').toLowerCase()
    const name = (lbl.dataset.projName || '').toLowerCase()
    lbl.style.display = (!q || code.includes(q) || name.includes(q)) ? '' : 'none'
  })
}

// Toggle chọn tất cả / bỏ chọn tất cả (chỉ những dự án đang visible)
function toggleSelectAllProjects() {
  const btn = $('scSelectAllBtn')
  const isAllSelected = btn?._allSelected
  const visibleChecks = [...($('scProjectList')?.querySelectorAll('label[data-proj-id]') || [])]
    .filter(lbl => lbl.style.display !== 'none')
    .map(lbl => lbl.querySelector('.scProjectCheck'))
    .filter(Boolean)
  visibleChecks.forEach(chk => { chk.checked = !isAllSelected })
  if (btn) {
    btn._allSelected = !isAllSelected
    btn.innerHTML = btn._allSelected
      ? '<i class="fas fa-square"></i> Bỏ chọn tất cả'
      : '<i class="fas fa-check-square"></i> Chọn tất cả'
  }
  updateSharedCostPreview()
}

function updateSharedCostPreview() {
  const amount = parseMoneyVal('scAmount') || 0
  const basis = $('scAllocationBasis')?.value || 'contract_value'
  const checkedBoxes = [...document.querySelectorAll('.scProjectCheck:checked')]

  if (amount <= 0 || checkedBoxes.length === 0) {
    $('scPreviewPanel').classList.add('hidden')
    return
  }

  $('scPreviewPanel').classList.remove('hidden')

  const projects = checkedBoxes.map(chk => ({
    id: parseInt(chk.value),
    contract: parseFloat(chk.dataset.contract) || 0,
    label: chk.closest('label').querySelector('.font-medium')?.textContent || '',
    manualPct: parseFloat(chk.closest('label').querySelector('.scManualPct')?.value) || 0
  }))

  let rows = []
  if (basis === 'contract_value') {
    const totalContract = projects.reduce((s, p) => s + p.contract, 0)
    rows = projects.map(p => {
      const pct = totalContract > 0 ? (p.contract / totalContract * 100) : (100 / projects.length)
      const allocated = Math.round(amount * pct / 100)
      return { label: p.label, pct: pct.toFixed(1), allocated }
    })
  } else if (basis === 'equal') {
    const pct = 100 / projects.length
    const allocated = Math.round(amount / projects.length)
    rows = projects.map(p => ({ label: p.label, pct: pct.toFixed(1), allocated }))
  } else {
    const totalPct = projects.reduce((s, p) => s + p.manualPct, 0)
    rows = projects.map(p => ({
      label: p.label,
      pct: p.manualPct.toFixed(1),
      allocated: Math.round(amount * p.manualPct / 100),
      warn: totalPct !== 100
    }))
    if (Math.abs(totalPct - 100) > 0.1) {
      $('scPreviewTable').innerHTML = `<div class="p-2 bg-red-50 text-red-700 text-xs">⚠️ Tổng % = ${totalPct.toFixed(1)}% (phải = 100%)</div>`
      return
    }
  }

  $('scPreviewTable').innerHTML = `
    <table class="w-full">
      <thead><tr class="bg-gray-100">
        <th class="text-left px-3 py-1 font-medium">Dự án</th>
        <th class="text-right px-3 py-1 font-medium">%</th>
        <th class="text-right px-3 py-1 font-medium">Số tiền phân bổ</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr class="border-t">
          <td class="px-3 py-1">${r.label}</td>
          <td class="px-3 py-1 text-right text-gray-600">${r.pct}%</td>
          <td class="px-3 py-1 text-right font-semibold text-indigo-700">${fmtMoney(r.allocated)}</td>
        </tr>`).join('')}
        <tr class="border-t bg-yellow-50 font-semibold">
          <td class="px-3 py-1">Tổng</td>
          <td class="px-3 py-1 text-right">100%</td>
          <td class="px-3 py-1 text-right text-yellow-700">${fmtMoney(amount)}</td>
        </tr>
      </tbody>
    </table>
  `
}

async function saveSharedCost() {
  const id = $('sharedCostId')?.value
  const description = $('scDescription').value.trim()
  const amount = parseMoneyVal('scAmount')
  const basis = $('scAllocationBasis').value

  if (!description || !amount || amount <= 0) {
    toast('Vui lòng nhập mô tả và số tiền hợp lệ', 'error'); return
  }

  const checkedBoxes = [...document.querySelectorAll('.scProjectCheck:checked')]
  if (checkedBoxes.length === 0) {
    toast('Vui lòng chọn ít nhất một dự án', 'error'); return
  }

  const project_ids = checkedBoxes.map(chk => parseInt(chk.value))
  let manual_pcts = null
  if (basis === 'manual') {
    const totalPct = checkedBoxes.reduce((s, chk) => {
      return s + (parseFloat(chk.closest('label').querySelector('.scManualPct')?.value) || 0)
    }, 0)
    if (Math.abs(totalPct - 100) > 0.1) {
      toast(`Tổng % phân bổ = ${totalPct.toFixed(1)}% (phải = 100%)`, 'error'); return
    }
    manual_pcts = {}
    checkedBoxes.forEach(chk => {
      manual_pcts[parseInt(chk.value)] = parseFloat(chk.closest('label').querySelector('.scManualPct')?.value) || 0
    })
  }

  const payload = {
    description,
    cost_type: $('scCostType').value,
    amount,
    cost_date: $('scCostDate').value || null,
    invoice_number: $('scInvoice').value || null,
    vendor: $('scVendor').value || null,
    notes: $('scNotes').value || null,
    allocation_basis: basis,
    year: parseInt($('scYear').value),
    month: $('scMonth').value ? parseInt($('scMonth').value) : null,
    project_ids,
    manual_pcts
  }

  const btn = $('scSaveBtn')
  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Đang lưu...'

  try {
    if (id) {
      await api(`/shared-costs/${id}`, { method: 'PUT', data: payload })
      toast('Đã cập nhật chi phí chung', 'success')
    } else {
      const res = await api('/shared-costs', { method: 'POST', data: payload })
      toast(`Đã tạo chi phí chung, phân bổ ${res.allocations_created} dự án`, 'success')
    }
    closeModal('sharedCostModal')
    await loadSharedCosts()
  } catch (e) {
    toast('Lỗi lưu: ' + e.message, 'error')
  } finally {
    btn.disabled = false
    btn.innerHTML = '<i class="fas fa-save mr-1"></i>Lưu chi phí chung'
  }
}

async function deleteSharedCost(id) {
  // Tìm chi phí chung trong cache để kiểm tra loại
  const sc = _sharedCosts.find(s => s.id === id)
  const isDepr = sc && sc.cost_type === 'depreciation'

  const confirmMsg = isDepr
    ? `⚠️ Xóa khoản Khấu hao tài sản này?\n\n"${sc.description}"\n\n• Tất cả phân bổ về dự án sẽ bị xóa\n• Trạng thái khấu hao sẽ được hoàn lại "Chưa phân bổ"\n• Tháng khấu hao tương ứng sẽ xuất hiện lại trong tab "Chờ phân bổ"\n\nThao tác này không thể hoàn tác.`
    : `Xóa chi phí chung này? Tất cả phân bổ về dự án cũng sẽ bị xóa.`

  if (!confirm(confirmMsg)) return
  try {
    const res = await api(`/shared-costs/${id}`, { method: 'DELETE' })
    const msg = res.message || 'Đã xóa chi phí chung'
    toast(msg, 'success')
    await loadSharedCosts()
    // Nếu là khấu hao → cập nhật lại trang depreciation nếu đang mở
    if (isDepr && document.querySelector('#page-depreciation.active')) {
      await loadDepreciationSummary()
      await loadDeprPending()
    }
  } catch (e) {
    toast('Lỗi xóa: ' + (e.response?.data?.error || e.message), 'error')
  }
}

// ================================================================
// ADVANCED ANALYTICS
// ================================================================
let _analyticsActiveTab = 'health'
let _analyticsCharts = {}

function getAnalyticsYear() {
  return document.getElementById('analyticsYear')?.value || new Date().getFullYear().toString()
}

async function loadAnalytics() {
  // Set năm mặc định = năm hiện tại nếu chưa có options
  const sel = document.getElementById('analyticsYear')
  if (sel && !sel.dataset.initialized) {
    sel.dataset.initialized = '1'
    await initCalendarYearFilter(sel)
    sel.value = new Date().getFullYear().toString()
  }
  switchAnalyticsTab(_analyticsActiveTab)
}

function reloadAnalytics() {
  // Clear caches and reload current tab
  _analyticsActiveTab = _analyticsActiveTab
  switchAnalyticsTab(_analyticsActiveTab, true)
}

function switchAnalyticsTab(tab, force = false) {
  _analyticsActiveTab = tab
  document.querySelectorAll('.analytics-tab').forEach(btn => btn.classList.remove('active'))
  const activeBtn = document.getElementById(`tab-${tab}`)
  if (activeBtn) activeBtn.classList.add('active')

  document.querySelectorAll('.analytics-content').forEach(el => el.classList.add('hidden'))
  const activeContent = document.getElementById(`analytics-${tab}`)
  if (activeContent) activeContent.classList.remove('hidden')

  if (tab === 'health') renderHealthTab(force)
  else if (tab === 'performance') renderPerformanceTab(force)
  else if (tab === 'tasks') renderTasksTab(force)
  else if (tab === 'team') renderTeamTab(force)
  else if (tab === 'timesheet') renderTimesheetAnalyticsTab(force)
  else if (tab === 'financial' && currentUser?.role === 'system_admin') renderFinancialTab(force)
  else if (tab === 'project-finance' && currentUser?.role === 'system_admin') renderProjectFinancialTab(force)
  else if (tab === 'cost-breakdown' && currentUser?.role === 'system_admin') initCostBreakdownTab(force)
}

// ---- Helpers ----
function fmtM(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' triệu'
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' K'
  return (n || 0).toLocaleString()
}
function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0 }
function monthName(m) { return ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'][parseInt(m)-1] || m }

function destroyAnalyticsChart(key) {
  if (_analyticsCharts[key]) { try { _analyticsCharts[key].destroy() } catch(e){} delete _analyticsCharts[key] }
}

// ================================================================
// TAB 1: PROJECT HEALTH SCORE
// ================================================================
async function renderHealthTab(force = false) {
  const el = document.getElementById('analyticsHealthContent')
  el.innerHTML = `<div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-3"></i><p>Đang tải dữ liệu sức khỏe dự án...</p></div>`
  try {
    const data = await api(`/analytics/project-health`)
    const projects = data.projects || []
    if (!projects.length) { el.innerHTML = `<div class="text-center py-16 text-gray-400"><i class="fas fa-folder-open text-4xl mb-3"></i><p>Chưa có dự án nào</p></div>`; return }

    const counts = { excellent: 0, good: 0, fair: 0, poor: 0, critical: 0 }
    projects.forEach(p => counts[p.health_status] = (counts[p.health_status] || 0) + 1)
    const avgScore = Math.round(projects.reduce((s, p) => s + p.health_score, 0) / projects.length)

    const healthLabel = { excellent: 'Xuất sắc', good: 'Tốt', fair: 'Trung bình', poor: 'Kém', critical: 'Nguy kịch' }
    const healthColor = { excellent: '#00A651', good: '#3b82f6', fair: '#f59e0b', poor: '#ef4444', critical: '#be185d' }

    el.innerHTML = `
      <!-- KPI Row -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div class="card text-center col-span-2 md:col-span-1">
          <div class="text-3xl font-black text-gray-800">${avgScore}</div>
          <div class="text-xs text-gray-500 mt-1">Điểm TB toàn công ty</div>
          <div class="text-xs font-semibold mt-1 ${avgScore>=75?'text-green-600':avgScore>=60?'text-blue-600':avgScore>=40?'text-yellow-600':'text-red-600'}">${avgScore>=90?'Xuất sắc':avgScore>=75?'Tốt':avgScore>=60?'Trung bình':avgScore>=40?'Kém':'Nguy kịch'}</div>
        </div>
        ${Object.entries(counts).map(([k, v]) => `
          <div class="card text-center">
            <div class="text-2xl font-bold" style="color:${healthColor[k]}">${v}</div>
            <div class="text-xs text-gray-500 mt-1">${healthLabel[k]}</div>
          </div>
        `).join('')}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <!-- Donut chart -->
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-4"><i class="fas fa-chart-pie mr-2 text-primary"></i>Phân bố sức khỏe</h3>
          <div class="relative" style="height:200px">
            <canvas id="chartHealthDist"></canvas>
          </div>
        </div>
        <!-- Bar chart: scores -->
        <div class="card lg:col-span-2">
          <h3 class="font-semibold text-gray-700 mb-4"><i class="fas fa-bar-chart mr-2 text-blue-500"></i>Điểm sức khỏe từng dự án</h3>
          <div class="relative" style="height:200px">
            <canvas id="chartHealthBars"></canvas>
          </div>
        </div>
      </div>

      <!-- Project list -->
      <div class="card">
        <h3 class="font-semibold text-gray-700 mb-4"><i class="fas fa-list mr-2 text-gray-500"></i>Danh sách dự án theo sức khỏe</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b text-left text-gray-500 text-xs uppercase">
                <th class="pb-2 pr-4">Dự án</th>
                <th class="pb-2 pr-4 text-center">Điểm</th>
                <th class="pb-2 pr-4 text-center">Trạng thái</th>
                <th class="pb-2 pr-4 text-center">Hoàn thành</th>
                <th class="pb-2 pr-4 text-center">Task trễ</th>
                <th class="pb-2 pr-4 text-center">Nhóm</th>
                <th class="pb-2">Vấn đề</th>
              </tr>
            </thead>
            <tbody id="healthProjectsTbody"></tbody>
          </table>
        </div>
        <div id="healthProjectsPagination"></div>
      </div>
    `

    // ── Health projects pagination ──────────────────────────────
    const HEALTH_PAGE_SIZE = 15
    const healthSorted = [...projects].sort((a, b) => a.health_score - b.health_score)
    let _healthPage = 1

    function renderHealthRows() {
      const tbody = document.getElementById('healthProjectsTbody')
      if (!tbody) return
      const start = (_healthPage - 1) * HEALTH_PAGE_SIZE
      const pageData = healthSorted.slice(start, start + HEALTH_PAGE_SIZE)
      tbody.innerHTML = pageData.map(p => `
        <tr class="border-b hover:bg-gray-50">
          <td class="py-3 pr-4">
            <div class="font-medium text-gray-800">${p.name}</div>
            <div class="text-xs text-gray-400">${p.code}</div>
          </td>
          <td class="py-3 pr-4 text-center">
            <span class="inline-flex items-center justify-center w-12 h-8 rounded-lg font-bold text-sm health-${p.health_status}">${p.health_score}</span>
          </td>
          <td class="py-3 pr-4 text-center">
            <span class="px-2 py-1 rounded-full text-xs font-medium health-${p.health_status}">${healthLabel[p.health_status]}</span>
          </td>
          <td class="py-3 pr-4 text-center">
            <div class="flex items-center gap-2">
              <div class="flex-1 bg-gray-200 rounded-full h-2">
                <div class="h-2 rounded-full ${p.completion_rate>=80?'bg-green-500':p.completion_rate>=50?'bg-blue-500':'bg-red-400'}" style="width:${p.completion_rate}%"></div>
              </div>
              <span class="text-xs text-gray-600 w-8">${p.completion_rate}%</span>
            </div>
          </td>
          <td class="py-3 pr-4 text-center">
            <span class="${p.overdue_tasks > 0 ? 'text-red-600 font-bold' : 'text-gray-400'}">${p.overdue_tasks}</span>
          </td>
          <td class="py-3 pr-4 text-center text-gray-600">${p.team_size} người</td>
          <td class="py-3 text-xs text-gray-500">${p.issues.length ? p.issues.slice(0,2).join(', ') : '<span class="text-green-600">Không có vấn đề</span>'}</td>
        </tr>
      `).join('')
    }

    function renderHealthPagination() {
      const container = document.getElementById('healthProjectsPagination')
      if (!container) return
      const total = healthSorted.length
      const totalPages = Math.max(1, Math.ceil(total / HEALTH_PAGE_SIZE))
      if (totalPages <= 1) { container.innerHTML = ''; return }

      const p = _healthPage
      let pages = []
      if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i)
      } else {
        pages = [1]
        if (p > 3) pages.push('...')
        for (let i = Math.max(2, p-1); i <= Math.min(totalPages-1, p+1); i++) pages.push(i)
        if (p < totalPages - 2) pages.push('...')
        pages.push(totalPages)
      }

      const from = (p - 1) * HEALTH_PAGE_SIZE + 1
      const to   = Math.min(p * HEALTH_PAGE_SIZE, total)

      // Expose goPage to window scope so onclick works
      window._healthGoPage = (page) => {
        _healthPage = Math.max(1, Math.min(page, totalPages))
        renderHealthRows()
        renderHealthPagination()
      }

      const btn = (label, pg, disabled = false, active = false) =>
        `<button onclick="_healthGoPage(${pg})" ${disabled ? 'disabled' : ''}
          class="min-w-[32px] h-8 px-2 rounded-lg text-xs font-medium border transition-colors
          ${active ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary'}
          ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}">${label}</button>`

      container.innerHTML = `
        <div class="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-gray-100 mt-3">
          <p class="text-xs text-gray-500">Hiển thị <strong>${from}–${to}</strong> / <strong>${total}</strong> dự án</p>
          <div class="flex items-center gap-1">
            ${btn('<i class="fas fa-chevron-left"></i>', p - 1, p === 1)}
            ${pages.map(pg => pg === '...'
                ? `<span class="px-1 text-gray-400 text-xs">…</span>`
                : btn(pg, pg, false, pg === p)
              ).join('')}
            ${btn('<i class="fas fa-chevron-right"></i>', p + 1, p === totalPages)}
          </div>
        </div>`
    }

    renderHealthRows()
    renderHealthPagination()
    // ─────────────────────────────────────────────────────────────

    // Draw charts
    destroyAnalyticsChart('healthDist')
    destroyAnalyticsChart('healthBars')

    const ctxDist = document.getElementById('chartHealthDist')?.getContext('2d')
    if (ctxDist) {
      _analyticsCharts['healthDist'] = safeChart(ctxDist, {
        type: 'doughnut',
        data: {
          labels: Object.keys(counts).map(k => healthLabel[k]),
          datasets: [{ data: Object.values(counts), backgroundColor: Object.keys(counts).map(k => healthColor[k]), borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } } }
      })
    }

    const topProjects = [...projects].sort((a,b) => b.health_score - a.health_score).slice(0, 12)
    const ctxBars = document.getElementById('chartHealthBars')?.getContext('2d')
    if (ctxBars) {
      _analyticsCharts['healthBars'] = safeChart(ctxBars, {
        type: 'bar',
        data: {
          labels: topProjects.map(p => p.code || p.name.substring(0, 10)),
          datasets: [{ label: 'Điểm sức khỏe', data: topProjects.map(p => p.health_score),
            backgroundColor: topProjects.map(p => healthColor[p.health_status] + 'cc'), borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { y: { min: 0, max: 100, ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } } }
      })
    }
  } catch (e) {
    el.innerHTML = `<div class="text-center py-12 text-red-400"><i class="fas fa-exclamation-triangle text-2xl mb-3"></i><p>${e.message}</p></div>`
  }
}

// ================================================================
// TAB 2: PROJECT PERFORMANCE
// ================================================================
async function renderPerformanceTab(force = false) {
  const el = document.getElementById('analyticsPerformanceContent')
  el.innerHTML = `<div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-3"></i><p>Đang tải dữ liệu hiệu suất...</p></div>`
  try {
    const year = getAnalyticsYear()
    const data = await api(`/analytics/project-performance?year=${year}`)
    const projects = data.projects || []
    if (!projects.length) { el.innerHTML = `<div class="text-center py-16 text-gray-400"><i class="fas fa-folder-open text-4xl mb-3"></i><p>Chưa có dự án</p></div>`; return }

    const totalTasks = projects.reduce((s, p) => s + (p.total_tasks||0), 0)
    const totalDone = projects.reduce((s, p) => s + (p.completed_tasks||0), 0)
    const totalHours = projects.reduce((s, p) => s + (p.total_hours||0), 0)
    const totalMembers = projects.reduce((s, p) => s + (p.member_count||0), 0)
    const overallPct = pct(totalDone, totalTasks)

    const statusLabel = { planning:'Lập kế hoạch', active:'Đang hoạt động', on_hold:'Tạm dừng', completed:'Hoàn thành', cancelled:'Đã hủy' }
    const statusColor = { planning:'#6b7280', active:'#00A651', on_hold:'#f59e0b', completed:'#3b82f6', cancelled:'#ef4444' }

    el.innerHTML = `
      <!-- KPI Row -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="kpi-card card"><div class="flex items-center gap-3"><div class="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center"><i class="fas fa-project-diagram text-green-600"></i></div><div><div class="text-2xl font-bold text-gray-800">${projects.length}</div><div class="text-xs text-gray-500">Tổng dự án</div></div></div></div>
        <div class="kpi-card card"><div class="flex items-center gap-3"><div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center"><i class="fas fa-check-circle text-blue-600"></i></div><div><div class="text-2xl font-bold text-gray-800">${overallPct}%</div><div class="text-xs text-gray-500">Tỷ lệ hoàn thành task</div></div></div></div>
        <div class="kpi-card card"><div class="flex items-center gap-3"><div class="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center"><i class="fas fa-clock text-purple-600"></i></div><div><div class="text-2xl font-bold text-gray-800">${fmtM(totalHours)}h</div><div class="text-xs text-gray-500">Tổng giờ làm việc</div></div></div></div>
        <div class="kpi-card card"><div class="flex items-center gap-3"><div class="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center"><i class="fas fa-users text-orange-600"></i></div><div><div class="text-2xl font-bold text-gray-800">${totalMembers}</div><div class="text-xs text-gray-500">Tổng thành viên</div></div></div></div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <!-- Task completion stacked bar -->
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-4"><i class="fas fa-tasks mr-2 text-primary"></i>Task hoàn thành vs tổng theo dự án</h3>
          <div style="height:240px"><canvas id="chartPerfTasks"></canvas></div>
        </div>
        <!-- Hours by project -->
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-4"><i class="fas fa-clock mr-2 text-purple-500"></i>Giờ làm việc theo dự án</h3>
          <div style="height:240px"><canvas id="chartPerfHours"></canvas></div>
        </div>
      </div>

      <!-- Project Table -->
      <div class="card">
        <h3 class="font-semibold text-gray-700 mb-4"><i class="fas fa-table mr-2 text-gray-500"></i>Chi tiết hiệu suất từng dự án (${year})</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="border-b text-left text-gray-500 text-xs uppercase">
              <th class="pb-2 pr-4">Dự án</th><th class="pb-2 pr-4">Trạng thái</th>
              <th class="pb-2 pr-4 text-right">Task (Xong/Tổng)</th>
              <th class="pb-2 pr-4 text-right">Trễ hạn</th>
              <th class="pb-2 pr-4 text-right">Giờ làm</th>
              <th class="pb-2 pr-4 text-right">Nhóm</th>
              <th class="pb-2 text-right">Tiến độ</th>
            </tr></thead>
            <tbody id="perfProjectsTbody"></tbody>
          </table>
        </div>
        <div id="perfProjectsPagination"></div>
      </div>
    `

    // ── Performance projects pagination ──────────────────────────────────
    const PERF_PAGE_SIZE = 15
    let _perfPage = 1

    function renderPerfRows() {
      const tbody = document.getElementById('perfProjectsTbody')
      if (!tbody) return
      const start = (_perfPage - 1) * PERF_PAGE_SIZE
      const pageData = projects.slice(start, start + PERF_PAGE_SIZE)
      tbody.innerHTML = pageData.map(p => `
        <tr class="border-b hover:bg-gray-50">
          <td class="py-3 pr-4"><div class="font-medium text-gray-800">${p.name}</div><div class="text-xs text-gray-400">${p.code}</div></td>
          <td class="py-3 pr-4"><span class="px-2 py-1 rounded-full text-xs font-medium" style="background:${statusColor[p.status]}22;color:${statusColor[p.status]}">${statusLabel[p.status]||p.status}</span></td>
          <td class="py-3 pr-4 text-right font-medium">${p.completed_tasks||0}/${p.total_tasks||0}</td>
          <td class="py-3 pr-4 text-right"><span class="${p.overdue_tasks>0?'text-red-600 font-bold':'text-gray-400'}">${p.overdue_tasks||0}</span></td>
          <td class="py-3 pr-4 text-right text-gray-600">${(p.total_hours||0).toFixed(1)}h</td>
          <td class="py-3 pr-4 text-right text-gray-600">${p.member_count||0}</td>
          <td class="py-3 text-right">
            <div class="flex items-center justify-end gap-2">
              <div class="w-16 bg-gray-200 rounded-full h-2"><div class="h-2 rounded-full bg-green-500" style="width:${p.progress||0}%"></div></div>
              <span class="text-xs text-gray-600 w-8">${p.progress||0}%</span>
            </div>
          </td>
        </tr>
      `).join('')
    }

    function renderPerfPagination() {
      const container = document.getElementById('perfProjectsPagination')
      if (!container) return
      const total = projects.length
      const totalPages = Math.max(1, Math.ceil(total / PERF_PAGE_SIZE))
      if (totalPages <= 1) { container.innerHTML = ''; return }

      const p = _perfPage
      let pages = []
      if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i)
      } else {
        pages = [1]
        if (p > 3) pages.push('...')
        for (let i = Math.max(2, p-1); i <= Math.min(totalPages-1, p+1); i++) pages.push(i)
        if (p < totalPages - 2) pages.push('...')
        pages.push(totalPages)
      }
      const from = (p - 1) * PERF_PAGE_SIZE + 1
      const to   = Math.min(p * PERF_PAGE_SIZE, total)

      window._perfGoPage = (page) => {
        _perfPage = Math.max(1, Math.min(page, totalPages))
        renderPerfRows()
        renderPerfPagination()
      }

      const btn = (label, pg, disabled = false, active = false) =>
        `<button onclick="_perfGoPage(${pg})" ${disabled ? 'disabled' : ''}
          class="min-w-[32px] h-8 px-2 rounded-lg text-xs font-medium border transition-colors
          ${active ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary'}
          ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}">${label}</button>`

      container.innerHTML = `
        <div class="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-gray-100 mt-3">
          <p class="text-xs text-gray-500">Hiển thị <strong>${from}–${to}</strong> / <strong>${total}</strong> dự án</p>
          <div class="flex items-center gap-1">
            ${btn('<i class="fas fa-chevron-left"></i>', p - 1, p === 1)}
            ${pages.map(pg => pg === '...'
                ? `<span class="px-1 text-gray-400 text-xs">…</span>`
                : btn(pg, pg, false, pg === p)
              ).join('')}
            ${btn('<i class="fas fa-chevron-right"></i>', p + 1, p === totalPages)}
          </div>
        </div>`
    }

    renderPerfRows()
    renderPerfPagination()
    // ─────────────────────────────────────────────────────────────────────

    destroyAnalyticsChart('perfTasks'); destroyAnalyticsChart('perfHours')
    const top10 = [...projects].sort((a,b) => (b.total_tasks||0) - (a.total_tasks||0)).slice(0, 10)

    const ctxT = document.getElementById('chartPerfTasks')?.getContext('2d')
    if (ctxT) _analyticsCharts['perfTasks'] = safeChart(ctxT, {
      type: 'bar',
      data: {
        labels: top10.map(p => p.code || p.name.substring(0,8)),
        datasets: [
          { label: 'Hoàn thành', data: top10.map(p => p.completed_tasks||0), backgroundColor: '#00A651cc', borderRadius: 3 },
          { label: 'Còn lại', data: top10.map(p => (p.total_tasks||0) - (p.completed_tasks||0)), backgroundColor: '#e5e7eb', borderRadius: 3 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 10 } } } },
        scales: { x: { stacked: true, ticks: { font: { size: 10 } } }, y: { stacked: true, ticks: { font: { size: 10 } } } } }
    })

    const ctxH = document.getElementById('chartPerfHours')?.getContext('2d')
    if (ctxH) _analyticsCharts['perfHours'] = safeChart(ctxH, {
      type: 'bar',
      data: {
        labels: top10.map(p => p.code || p.name.substring(0,8)),
        datasets: [{ label: 'Giờ làm', data: top10.map(p => +(p.total_hours||0).toFixed(1)), backgroundColor: '#818cf8cc', borderRadius: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } } }
    })
  } catch (e) {
    el.innerHTML = `<div class="text-center py-12 text-red-400"><i class="fas fa-exclamation-triangle text-2xl mb-3"></i><p>${e.message}</p></div>`
  }
}

// ================================================================
// TAB 3: TASK ANALYTICS
// ================================================================
async function renderTasksTab(force = false) {
  const el = document.getElementById('analyticsTasksContent')
  el.innerHTML = `<div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-3"></i><p>Đang phân tích task...</p></div>`
  try {
    const year = getAnalyticsYear()
    const data = await api(`/analytics/task-analytics?year=${year}`)

    const statusLabel = { todo: 'Chờ làm', in_progress: 'Đang làm', review: 'Review', completed: 'Hoàn thành', cancelled: 'Đã hủy' }
    const statusColors = ['#94a3b8','#3b82f6','#f59e0b','#00A651','#ef4444']
    const prioLabel = { low: 'Thấp', medium: 'Trung bình', high: 'Cao', urgent: 'Khẩn cấp' }
    const prioColors = ['#10b981','#3b82f6','#f59e0b','#ef4444']

    const totalTasks = (data.byStatus||[]).reduce((s,x)=>s+(x.count||0),0)
    const doneTasks = (data.byStatus||[]).find(x=>x.status==='completed')?.count || 0
    const overdueTasks = (data.byDiscipline||[]).reduce((s,x)=>s+(x.overdue||0),0)
    const urgentTasks = (data.byPriority||[]).find(x=>x.priority==='urgent')?.count || 0

    el.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="kpi-card card"><div class="text-2xl font-bold text-gray-800">${totalTasks}</div><div class="text-xs text-gray-500 mt-1">Tổng task</div></div>
        <div class="kpi-card card"><div class="text-2xl font-bold text-green-600">${doneTasks}</div><div class="text-xs text-gray-500 mt-1">Hoàn thành (${pct(doneTasks,totalTasks)}%)</div></div>
        <div class="kpi-card card"><div class="text-2xl font-bold text-red-500">${overdueTasks}</div><div class="text-xs text-gray-500 mt-1">Trễ hạn</div></div>
        <div class="kpi-card card"><div class="text-2xl font-bold text-orange-500">${urgentTasks}</div><div class="text-xs text-gray-500 mt-1">Khẩn cấp</div></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-circle-notch mr-2 text-blue-500"></i>Phân bố trạng thái</h3>
          <div style="height:200px"><canvas id="chartTaskStatus"></canvas></div>
        </div>
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-flag mr-2 text-orange-500"></i>Phân bố độ ưu tiên</h3>
          <div style="height:200px"><canvas id="chartTaskPriority"></canvas></div>
        </div>
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-layer-group mr-2 text-purple-500"></i>Theo giai đoạn</h3>
          <div style="height:200px"><canvas id="chartTaskPhase"></canvas></div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-building mr-2 text-primary"></i>Task theo bộ môn BIM</h3>
          <div style="height:260px"><canvas id="chartTaskDiscipline"></canvas></div>
        </div>
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-chart-line mr-2 text-green-500"></i>Xu hướng hoàn thành (${year})</h3>
          <div style="height:260px"><canvas id="chartTaskTrend"></canvas></div>
        </div>
      </div>
    `

    destroyAnalyticsChart('taskStatus'); destroyAnalyticsChart('taskPriority'); destroyAnalyticsChart('taskPhase'); destroyAnalyticsChart('taskDiscipline'); destroyAnalyticsChart('taskTrend')

    const ctxS = document.getElementById('chartTaskStatus')?.getContext('2d')
    if (ctxS) _analyticsCharts['taskStatus'] = safeChart(ctxS, {
      type: 'doughnut',
      data: { labels: (data.byStatus||[]).map(x=>statusLabel[x.status]||x.status), datasets: [{ data: (data.byStatus||[]).map(x=>x.count), backgroundColor: statusColors }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } } }
    })

    const ctxP = document.getElementById('chartTaskPriority')?.getContext('2d')
    if (ctxP) _analyticsCharts['taskPriority'] = safeChart(ctxP, {
      type: 'pie',
      data: { labels: (data.byPriority||[]).map(x=>prioLabel[x.priority]||x.priority), datasets: [{ data: (data.byPriority||[]).map(x=>x.count), backgroundColor: prioColors }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } } }
    })

    const phaseLabel = { basic_design:'Thiết kế cơ sở', technical_design:'TKKT', construction_design:'TK thi công', as_built:'Hoàn công' }
    const ctxPh = document.getElementById('chartTaskPhase')?.getContext('2d')
    if (ctxPh) _analyticsCharts['taskPhase'] = safeChart(ctxPh, {
      type: 'doughnut',
      data: { labels: (data.byPhase||[]).map(x=>phaseLabel[x.phase]||x.phase), datasets: [{ data: (data.byPhase||[]).map(x=>x.count), backgroundColor: ['#00A651','#3b82f6','#f59e0b','#8b5cf6'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 10 } } } } }
    })

    const disc = (data.byDiscipline||[]).slice(0,10)
    const ctxD = document.getElementById('chartTaskDiscipline')?.getContext('2d')
    if (ctxD) _analyticsCharts['taskDiscipline'] = safeChart(ctxD, {
      type: 'bar',
      data: {
        labels: disc.map(x=>x.discipline_code),
        datasets: [
          { label: 'Hoàn thành', data: disc.map(x=>x.completed), backgroundColor: '#00A651cc', borderRadius: 3 },
          { label: 'Trễ hạn', data: disc.map(x=>x.overdue), backgroundColor: '#ef4444cc', borderRadius: 3 },
          { label: 'Tổng', data: disc.map(x=>x.count - x.completed - x.overdue), backgroundColor: '#d1d5db', borderRadius: 3 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 10 } } } },
        scales: { x: { stacked: true, ticks: { font: { size: 10 } } }, y: { stacked: true, ticks: { font: { size: 10 } } } } }
    })

    const months = Array.from({length:12}, (_,i)=>String(i+1).padStart(2,'0'))
    const trendMap = {}
    ;(data.completionTrend||[]).forEach(x=>{ trendMap[x.month] = x })
    const ctxTr = document.getElementById('chartTaskTrend')?.getContext('2d')
    if (ctxTr) _analyticsCharts['taskTrend'] = safeChart(ctxTr, {
      type: 'line',
      data: {
        labels: months.map(m=>monthName(m)),
        datasets: [
          { label: 'Tổng task', data: months.map(m=>trendMap[m]?.total||0), borderColor: '#3b82f6', backgroundColor: '#3b82f620', fill: true, tension: 0.4 },
          { label: 'Hoàn thành', data: months.map(m=>trendMap[m]?.completed||0), borderColor: '#00A651', backgroundColor: '#00A65120', fill: true, tension: 0.4 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 11 } } } },
        scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } } }
    })
  } catch (e) {
    el.innerHTML = `<div class="text-center py-12 text-red-400"><i class="fas fa-exclamation-triangle text-2xl mb-3"></i><p>${e.message}</p></div>`
  }
}

// ================================================================
// TAB 4: TEAM PRODUCTIVITY
// ================================================================
async function renderTeamTab(force = false) {
  const el = document.getElementById('analyticsTeamContent')
  el.innerHTML = `<div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-3"></i><p>Đang phân tích năng suất nhân sự...</p></div>`
  try {
    const year = getAnalyticsYear()
    const data = await api(`/analytics/team-productivity?year=${year}`)
    const members = data.members || []
    if (!members.length) { el.innerHTML = `<div class="text-center py-16 text-gray-400"><p>Chưa có dữ liệu</p></div>`; return }

    const totalHours = members.reduce((s,m)=>s+(m.total_hours||0),0)
    const totalOT = members.reduce((s,m)=>s+(m.overtime_hours||0),0)
    const active = members.filter(m=>m.total_hours>0).length
    const avgHours = active > 0 ? (totalHours / active).toFixed(1) : 0

    el.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="kpi-card card"><div class="text-2xl font-bold text-gray-800">${members.length}</div><div class="text-xs text-gray-500 mt-1">Tổng nhân sự</div></div>
        <div class="kpi-card card"><div class="text-2xl font-bold text-green-600">${fmtM(totalHours)}h</div><div class="text-xs text-gray-500 mt-1">Tổng giờ làm</div></div>
        <div class="kpi-card card"><div class="text-2xl font-bold text-orange-500">${fmtM(totalOT)}h</div><div class="text-xs text-gray-500 mt-1">Giờ tăng ca</div></div>
        <div class="kpi-card card"><div class="text-2xl font-bold text-blue-600">${avgHours}h</div><div class="text-xs text-gray-500 mt-1">TB giờ/người</div></div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-trophy mr-2 text-yellow-500"></i>Top 10 nhân sự (giờ làm)</h3>
          <div style="height:260px"><canvas id="chartTeamTopHours"></canvas></div>
        </div>
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-check-double mr-2 text-green-500"></i>Task hoàn thành vs được giao</h3>
          <div style="height:260px"><canvas id="chartTeamTaskRate"></canvas></div>
        </div>
      </div>

      <!-- Member Detail Table with pagination -->
      <div class="card" id="teamProdTableCard">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-gray-700"><i class="fas fa-table mr-2 text-gray-500"></i>Bảng năng suất chi tiết (${year})</h3>
          <span class="text-xs text-gray-400" id="teamProdCount"></span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="border-b text-left text-gray-500 text-xs uppercase bg-gray-50">
              <th class="py-2 px-3">Nhân sự</th>
              <th class="py-2 px-3">Phòng ban</th>
              <th class="py-2 px-3 text-right">Giờ thường</th>
              <th class="py-2 px-3 text-right">Giờ TC</th>
              <th class="py-2 px-3 text-right">Tổng giờ</th>
              <th class="py-2 px-3 text-right">Task xong/giao</th>
              <th class="py-2 px-3 text-right">Hiệu suất task</th>
            </tr></thead>
            <tbody id="teamProdTbody"></tbody>
          </table>
        </div>
        <!-- Pagination -->
        <div class="flex items-center justify-between mt-4 pt-3 border-t border-gray-100" id="teamProdPager">
          <div class="flex items-center gap-2 text-xs text-gray-500" id="teamProdPageInfo"></div>
          <div class="flex items-center gap-1" id="teamProdPageBtns"></div>
        </div>
      </div>
    `

    // ── Pagination for detail table ──────────────────────────────────
    const PROD_PAGE_SIZE = 15
    const sortedMembers = members.slice().sort((a,b)=>(b.total_hours||0)-(a.total_hours||0))
    let _prodPage = 1

    function renderProdTable(page) {
      _prodPage = page
      const total   = sortedMembers.length
      const pages   = Math.max(1, Math.ceil(total / PROD_PAGE_SIZE))
      const start   = (page - 1) * PROD_PAGE_SIZE
      const slice   = sortedMembers.slice(start, start + PROD_PAGE_SIZE)

      const tbody = document.getElementById('teamProdTbody')
      const info  = document.getElementById('teamProdPageInfo')
      const btns  = document.getElementById('teamProdPageBtns')
      const count = document.getElementById('teamProdCount')
      if (!tbody) return

      // Count label
      if (count) count.textContent = `${total} nhân sự`

      // Rows
      tbody.innerHTML = slice.map((m, idx) => {
        const rate = m.assigned_tasks > 0 ? Math.min(100, Math.round((m.completed_tasks||0) / m.assigned_tasks * 100)) : 0
        const barColor = rate >= 80 ? 'bg-green-500' : rate >= 50 ? 'bg-blue-500' : rate > 0 ? 'bg-red-400' : 'bg-gray-300'
        const rowBg = (start + idx) % 2 === 1 ? 'bg-gray-50/40' : ''
        return `<tr class="border-b border-gray-100 hover:bg-green-50/30 transition-colors ${rowBg}">
          <td class="py-2.5 px-3 font-medium text-gray-800 text-sm">${m.full_name}</td>
          <td class="py-2.5 px-3 text-gray-500 text-xs">${m.department||'—'}</td>
          <td class="py-2.5 px-3 text-right text-sm">${(m.regular_hours||0).toFixed(1)}h</td>
          <td class="py-2.5 px-3 text-right text-orange-600 text-sm">${(m.overtime_hours||0).toFixed(1)}h</td>
          <td class="py-2.5 px-3 text-right font-semibold text-sm">${(m.total_hours||0).toFixed(1)}h</td>
          <td class="py-2.5 px-3 text-right text-sm">${m.completed_tasks||0}/${m.assigned_tasks||0}</td>
          <td class="py-2.5 px-3 text-right">
            <div class="flex items-center justify-end gap-2">
              <div class="w-16 bg-gray-200 rounded-full h-2 flex-shrink-0">
                <div class="h-2 rounded-full ${barColor}" style="width:${rate}%"></div>
              </div>
              <span class="text-xs font-medium w-8 text-right ${rate>=80?'text-green-600':rate>=50?'text-blue-600':rate>0?'text-red-500':'text-gray-400'}">${rate}%</span>
            </div>
          </td>
        </tr>`
      }).join('')

      // Page info
      if (info) info.innerHTML = `<span>Hiển thị <b>${start+1}–${Math.min(start+PROD_PAGE_SIZE,total)}</b> / ${total} nhân sự</span>`

      // Page buttons
      if (btns) {
        const maxBtn = 7
        let html = ''
        // Prev
        html += `<button onclick="renderProdTable(${page-1})" ${page<=1?'disabled':''} class="px-2 py-1 rounded text-xs border ${page<=1?'text-gray-300 border-gray-200 cursor-not-allowed':'text-gray-600 border-gray-300 hover:bg-gray-100'}"><i class="fas fa-chevron-left"></i></button>`
        // Page numbers
        let startP = Math.max(1, page - Math.floor(maxBtn/2))
        let endP   = Math.min(pages, startP + maxBtn - 1)
        if (endP - startP < maxBtn - 1) startP = Math.max(1, endP - maxBtn + 1)
        if (startP > 1) html += `<button onclick="renderProdTable(1)" class="px-2.5 py-1 rounded text-xs border border-gray-300 hover:bg-gray-100 text-gray-600">1</button>${startP>2?'<span class="text-gray-400 text-xs px-1">…</span>':''}`
        for (let p = startP; p <= endP; p++) {
          html += `<button onclick="renderProdTable(${p})" class="px-2.5 py-1 rounded text-xs border ${p===page?'bg-green-600 text-white border-green-600 font-semibold':'border-gray-300 hover:bg-gray-100 text-gray-600'}">${p}</button>`
        }
        if (endP < pages) html += `${endP<pages-1?'<span class="text-gray-400 text-xs px-1">…</span>':''}<button onclick="renderProdTable(${pages})" class="px-2.5 py-1 rounded text-xs border border-gray-300 hover:bg-gray-100 text-gray-600">${pages}</button>`
        // Next
        html += `<button onclick="renderProdTable(${page+1})" ${page>=pages?'disabled':''} class="px-2 py-1 rounded text-xs border ${page>=pages?'text-gray-300 border-gray-200 cursor-not-allowed':'text-gray-600 border-gray-300 hover:bg-gray-100'}"><i class="fas fa-chevron-right"></i></button>`
        btns.innerHTML = html
      }

      // Hide pager if only 1 page
      const pager = document.getElementById('teamProdPager')
      if (pager) pager.style.display = pages <= 1 ? 'none' : 'flex'
    }

    // Initial render
    renderProdTable(1)

    destroyAnalyticsChart('teamTopHours'); destroyAnalyticsChart('teamTaskRate')
    const top10 = members.slice(0, 10)

    const ctxH = document.getElementById('chartTeamTopHours')?.getContext('2d')
    if (ctxH) _analyticsCharts['teamTopHours'] = safeChart(ctxH, {
      type: 'bar',
      data: {
        labels: top10.map(m => m.full_name.split(' ').pop()),
        datasets: [
          { label: 'Giờ thường', data: top10.map(m=>+(m.regular_hours||0).toFixed(1)), backgroundColor: '#00A651bb', borderRadius: 3 },
          { label: 'Tăng ca', data: top10.map(m=>+(m.overtime_hours||0).toFixed(1)), backgroundColor: '#f59e0bbb', borderRadius: 3 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 10 } } } },
        scales: { x: { stacked: true, ticks: { font: { size: 10 } } }, y: { stacked: true, ticks: { font: { size: 10 } } } } }
    })

    const ctxR = document.getElementById('chartTeamTaskRate')?.getContext('2d')
    if (ctxR) _analyticsCharts['teamTaskRate'] = safeChart(ctxR, {
      type: 'bar',
      data: {
        labels: top10.map(m => m.full_name.split(' ').pop()),
        datasets: [
          { label: 'Được giao', data: top10.map(m=>m.assigned_tasks||0), backgroundColor: '#93c5fdbb', borderRadius: 3 },
          { label: 'Hoàn thành', data: top10.map(m=>m.completed_tasks||0), backgroundColor: '#00A651bb', borderRadius: 3 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 10 } } } },
        scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } } }
    })
  } catch (e) {
    el.innerHTML = `<div class="text-center py-12 text-red-400"><i class="fas fa-exclamation-triangle text-2xl mb-3"></i><p>${e.message}</p></div>`
  }
}

// ================================================================
// TAB 5: TIMESHEET ANALYTICS
// ================================================================
async function renderTimesheetAnalyticsTab(force = false) {
  const el = document.getElementById('analyticsTimesheetContent')
  el.innerHTML = `<div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-3"></i><p>Đang phân tích chấm công...</p></div>`
  try {
    const year = getAnalyticsYear()
    const data = await api(`/analytics/timesheet?year=${year}`)
    const monthly        = data.monthlyHours       || []
    const byDept         = data.byDepartment       || []
    const byStatus       = data.byStatus           || []
    const topWorkers     = data.topWorkers         || []
    const taskVsPlan     = data.taskHoursVsPlan    || []
    const projVsPlan     = data.projectHoursVsPlan || []

    const totalHours    = monthly.reduce((s,m)=>s+(m.regular||0)+(m.overtime||0),0)
    const totalOT       = monthly.reduce((s,m)=>s+(m.overtime||0),0)
    const totalApproved = monthly.reduce((s,m)=>s+(m.approved_hours||0),0)
    const approvalRate  = totalHours > 0 ? pct(totalApproved, totalHours) : 0

    // ── Tính toán tổng hợp task vs plan ──
    const totalPlanned = taskVsPlan.reduce((s,t)=>s+(t.planned_hours||0), 0)
    const totalActual  = taskVsPlan.reduce((s,t)=>s+(t.ts_actual_hours||0), 0)
    const overBudgetCount  = taskVsPlan.filter(t => t.pct_used != null && t.pct_used > 100).length
    const noPlanCount      = taskVsPlan.filter(t => !t.planned_hours || t.planned_hours === 0).length

    const statusLabel = { draft:'Nháp', submitted:'Đã nộp', approved:'Đã duyệt', rejected:'Từ chối' }
    const statusColor = { draft:'#6b7280', submitted:'#3b82f6', approved:'#00A651', rejected:'#ef4444' }
    const taskStatusLabel = { todo:'Chờ làm', in_progress:'Đang làm', review:'Đang duyệt', completed:'Hoàn thành', cancelled:'Đã hủy' }

    // ── Hàm render badge pct_used ──
    function pctBadge(pct, planned) {
      if (planned == null || planned === 0)
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">Chưa ước tính</span>`
      if (pct == null)
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">—</span>`
      const color = pct > 120 ? 'bg-red-100 text-red-700' : pct > 100 ? 'bg-orange-100 text-orange-700' : pct > 80 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-600'
      const icon  = pct > 100 ? '⚠️' : '✅'
      return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${color}">${icon} ${pct}%</span>`
    }

    // ── Progress bar inline ──
    function progressBar(actual, planned) {
      if (!planned || planned === 0) return `<span class="text-xs text-gray-400">—</span>`
      const p = Math.min(Math.round(actual / planned * 100), 150)
      const color = p > 120 ? '#ef4444' : p > 100 ? '#f97316' : p > 80 ? '#f59e0b' : '#00A651'
      const display = Math.min(p, 100)
      return `<div class="flex items-center gap-2 min-w-[100px]">
        <div style="flex:1;height:6px;background:#f3f4f6;border-radius:3px;overflow:visible;position:relative">
          <div style="width:${display}%;height:100%;background:${color};border-radius:3px;position:relative">
            ${p > 100 ? `<div style="position:absolute;right:-2px;top:-2px;width:10px;height:10px;background:${color};border-radius:50%;border:2px solid white"></div>` : ''}
          </div>
        </div>
        <span style="font-size:11px;color:${color};font-weight:600;min-width:28px">${p}%</span>
      </div>`
    }

    el.innerHTML = `
      <!-- ═══ KPI CARDS ═══ -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="kpi-card card"><div class="text-2xl font-bold text-gray-800">${fmtM(totalHours)}h</div><div class="text-xs text-gray-500 mt-1">Tổng giờ làm</div></div>
        <div class="kpi-card card"><div class="text-2xl font-bold text-orange-500">${fmtM(totalOT)}h</div><div class="text-xs text-gray-500 mt-1">Tổng giờ tăng ca</div></div>
        <div class="kpi-card card"><div class="text-2xl font-bold text-green-600">${fmtM(totalApproved)}h</div><div class="text-xs text-gray-500 mt-1">Giờ được duyệt</div></div>
        <div class="kpi-card card"><div class="text-2xl font-bold text-blue-600">${approvalRate}%</div><div class="text-xs text-gray-500 mt-1">Tỷ lệ phê duyệt</div></div>
      </div>

      <!-- ═══ ROW 1: Giờ theo tháng + Trạng thái ═══ -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div class="card lg:col-span-2">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-calendar-alt mr-2 text-blue-500"></i>Giờ làm theo tháng (${year})</h3>
          <div style="height:240px"><canvas id="chartTsMonthly"></canvas></div>
        </div>
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-check-circle mr-2 text-green-500"></i>Trạng thái timesheet</h3>
          <div style="height:240px"><canvas id="chartTsStatus"></canvas></div>
        </div>
      </div>

      <!-- ═══ ROW 2: Phòng ban + Top nhân sự ═══ -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-building mr-2 text-primary"></i>Giờ làm theo phòng ban</h3>
          <div style="height:240px"><canvas id="chartTsDept"></canvas></div>
        </div>
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-medal mr-2 text-yellow-500"></i>Top nhân sự (tổng giờ - ${year})</h3>
          <div class="overflow-y-auto" style="max-height:240px">
            <table class="w-full text-sm">
              <thead class="sticky top-0 bg-white"><tr class="border-b text-xs text-gray-500 uppercase">
                <th class="pb-2 text-left">#</th><th class="pb-2 text-left">Nhân sự</th>
                <th class="pb-2 text-right">Tổng giờ</th><th class="pb-2 text-right">Tăng ca</th><th class="pb-2 text-right">Ngày làm</th>
              </tr></thead>
              <tbody>
                ${topWorkers.map((w,i)=>`
                  <tr class="border-b hover:bg-gray-50">
                    <td class="py-2 text-gray-400 font-bold">${i+1}</td>
                    <td class="py-2"><div class="font-medium text-gray-800 text-xs">${w.full_name}</div><div class="text-gray-400 text-xs">${w.department||'-'}</div></td>
                    <td class="py-2 text-right font-semibold text-green-600">${(w.total_hours||0).toFixed(1)}h</td>
                    <td class="py-2 text-right text-orange-500">${(w.overtime_hours||0).toFixed(1)}h</td>
                    <td class="py-2 text-right text-gray-500">${w.days_worked||0}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ═══ ROW 3: SECTION MỚI — Giờ thực tế vs Kế hoạch ═══ -->
      <div class="card mb-6" style="border-top:3px solid #00A651">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h3 class="font-bold text-gray-800 text-base">
              <i class="fas fa-balance-scale mr-2 text-primary"></i>Giờ thực tế vs Kế hoạch theo Task (${year})
            </h3>
            <p class="text-xs text-gray-400 mt-0.5">So sánh tổng giờ đã chấm công với giờ ước tính ban đầu của từng task</p>
          </div>
          <!-- Tóm tắt nhanh -->
          <div class="flex flex-wrap gap-3">
            <div class="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <i class="fas fa-clock text-green-600 text-sm"></i>
              <div><div class="text-xs text-gray-500">Tổng giờ thực tế</div><div class="font-bold text-green-600">${totalActual.toFixed(1)}h</div></div>
            </div>
            <div class="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <i class="fas fa-calendar-check text-blue-600 text-sm"></i>
              <div><div class="text-xs text-gray-500">Tổng giờ kế hoạch</div><div class="font-bold text-blue-600">${totalPlanned.toFixed(1)}h</div></div>
            </div>
            <div class="flex items-center gap-2 ${overBudgetCount > 0 ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'} rounded-lg px-3 py-2">
              <i class="fas fa-exclamation-triangle ${overBudgetCount > 0 ? 'text-red-500' : 'text-gray-400'} text-sm"></i>
              <div><div class="text-xs text-gray-500">Vượt kế hoạch</div><div class="font-bold ${overBudgetCount > 0 ? 'text-red-600' : 'text-gray-500'}">${overBudgetCount} task</div></div>
            </div>
          </div>
        </div>

        <!-- Chart so sánh actual vs planned (Top 15 task) -->
        <div class="mb-5">
          <h4 class="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
            <i class="fas fa-chart-bar text-primary"></i> Biểu đồ so sánh Top 15 task (giờ)
          </h4>
          <div style="height:300px"><canvas id="chartTaskVsPlan"></canvas></div>
        </div>

        <!-- Tổng hợp theo dự án -->
        ${projVsPlan.length ? `
        <div class="mb-5">
          <h4 class="text-xs font-semibold text-gray-500 uppercase mb-3 flex items-center gap-1">
            <i class="fas fa-project-diagram text-accent"></i> Tổng hợp theo dự án
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            ${projVsPlan.map(p => {
              const act = p.total_actual_hours || 0
              const pln = p.total_planned_hours || 0
              const ratio = pln > 0 ? Math.round(act / pln * 100) : null
              const barColor = ratio == null ? '#6b7280' : ratio > 120 ? '#ef4444' : ratio > 100 ? '#f97316' : '#00A651'
              const barW = ratio != null ? Math.min(ratio, 100) : 0
              return `<div class="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <div class="flex items-center justify-between mb-2">
                  <div>
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold text-white" style="background:#0066CC">${p.project_code}</span>
                    <span class="text-xs text-gray-600 ml-1 font-medium">${p.project_name?.substring(0,22)}${p.project_name?.length>22?'…':''}</span>
                  </div>
                  ${ratio != null ? `<span class="text-xs font-bold" style="color:${barColor}">${ratio}%</span>` : '<span class="text-xs text-gray-400">—</span>'}
                </div>
                <div class="flex gap-4 text-xs text-gray-500 mb-2">
                  <span><i class="fas fa-clock text-green-500 mr-1"></i>Thực tế: <b class="text-gray-800">${act.toFixed(1)}h</b></span>
                  <span><i class="fas fa-calendar text-blue-400 mr-1"></i>KH: <b class="text-gray-800">${pln > 0 ? pln.toFixed(1)+'h' : '—'}</b></span>
                </div>
                ${ratio != null ? `
                <div style="height:5px;background:#e5e7eb;border-radius:3px;overflow:hidden">
                  <div style="width:${barW}%;height:100%;background:${barColor};border-radius:3px;transition:width .4s"></div>
                </div>` : ''}
              </div>`
            }).join('')}
          </div>
        </div>` : ''}

        <!-- Bảng chi tiết task -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-xs font-semibold text-gray-500 uppercase flex items-center gap-1">
              <i class="fas fa-table text-gray-400"></i> Chi tiết từng task (${taskVsPlan.length} task có chấm công)
            </h4>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-400 flex items-center gap-1"><span class="w-3 h-3 rounded-full inline-block" style="background:#00A651"></span> ≤100% bình thường</span>
              <span class="text-xs text-gray-400 flex items-center gap-1"><span class="w-3 h-3 rounded-full inline-block" style="background:#f97316"></span> 100–120% cảnh báo</span>
              <span class="text-xs text-gray-400 flex items-center gap-1"><span class="w-3 h-3 rounded-full inline-block" style="background:#ef4444"></span> >120% vượt kế hoạch</span>
            </div>
          </div>
          ${taskVsPlan.length === 0
            ? `<div class="text-center py-8 text-gray-400 text-sm"><i class="fas fa-inbox text-3xl mb-2 block"></i>Chưa có task nào được chấm công trong năm ${year}</div>`
            : `<div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b-2 border-gray-200 bg-gray-50 text-gray-500 uppercase" style="font-size:10px">
                    <th class="py-2 px-3 text-left">Task</th>
                    <th class="py-2 px-3 text-left">Dự án</th>
                    <th class="py-2 px-3 text-left">Người phụ trách</th>
                    <th class="py-2 px-3 text-center">Trạng thái</th>
                    <th class="py-2 px-3 text-right">Kế hoạch</th>
                    <th class="py-2 px-3 text-right">Thực tế (TS)</th>
                    <th class="py-2 px-3 text-right">Chênh lệch</th>
                    <th class="py-2 px-3 text-center" style="min-width:140px">% Sử dụng</th>
                    <th class="py-2 px-3 text-right">Ngày log</th>
                  </tr>
                </thead>
                <tbody>
                  ${taskVsPlan.map(t => {
                    const diff = (t.ts_actual_hours||0) - (t.planned_hours||0)
                    const diffColor = t.planned_hours > 0
                      ? (diff > 0 ? '#ef4444' : '#00A651')
                      : '#9ca3af'
                    const diffText = t.planned_hours > 0
                      ? `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}h`
                      : '—'
                    const rowBg = t.pct_used > 120 ? 'background:#fff5f5' : t.pct_used > 100 ? 'background:#fff8f0' : ''
                    const taskStatusColors = {
                      todo:'bg-gray-100 text-gray-600', in_progress:'bg-blue-100 text-blue-700',
                      review:'bg-yellow-100 text-yellow-700', completed:'bg-green-100 text-green-700', cancelled:'bg-red-100 text-red-600'
                    }
                    return `<tr class="border-b border-gray-100 hover:bg-gray-50 transition" style="${rowBg}">
                      <td class="py-2 px-3">
                        <div class="font-medium text-gray-800" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t.task_title}">${t.task_title}</div>
                        ${t.discipline_code ? `<span class="text-gray-400">[${t.discipline_code}]</span>` : ''}
                      </td>
                      <td class="py-2 px-3">
                        <span class="inline-flex items-center px-1.5 py-0.5 rounded text-white font-bold" style="background:#0066CC;font-size:10px">${t.project_code}</span>
                      </td>
                      <td class="py-2 px-3 text-gray-600" style="white-space:nowrap">${t.assignee||'—'}</td>
                      <td class="py-2 px-3 text-center">
                        <span class="inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${taskStatusColors[t.task_status]||'bg-gray-100 text-gray-600'}">
                          ${taskStatusLabel[t.task_status]||t.task_status}
                        </span>
                      </td>
                      <td class="py-2 px-3 text-right font-medium text-blue-600">
                        ${t.planned_hours > 0 ? t.planned_hours.toFixed(1)+'h' : '<span class="text-gray-400">—</span>'}
                      </td>
                      <td class="py-2 px-3 text-right font-bold text-green-600">${(t.ts_actual_hours||0).toFixed(1)}h</td>
                      <td class="py-2 px-3 text-right font-semibold" style="color:${diffColor}">${diffText}</td>
                      <td class="py-2 px-3">${progressBar(t.ts_actual_hours||0, t.planned_hours)}</td>
                      <td class="py-2 px-3 text-right text-gray-500">${t.days_logged||0}d · ${t.members_logged||0}người</td>
                    </tr>`
                  }).join('')}
                </tbody>
                <tfoot>
                  <tr class="bg-gray-100 font-bold text-xs border-t-2 border-gray-300">
                    <td class="py-2 px-3 text-gray-700" colspan="4">Tổng cộng (${taskVsPlan.length} tasks)</td>
                    <td class="py-2 px-3 text-right text-blue-600">${totalPlanned.toFixed(1)}h</td>
                    <td class="py-2 px-3 text-right text-green-600">${totalActual.toFixed(1)}h</td>
                    <td class="py-2 px-3 text-right" style="color:${totalActual-totalPlanned>=0?'#ef4444':'#00A651'}">
                      ${totalPlanned>0 ? `${totalActual-totalPlanned>=0?'+':''}${(totalActual-totalPlanned).toFixed(1)}h` : '—'}
                    </td>
                    <td class="py-2 px-3">
                      ${totalPlanned > 0 ? progressBar(totalActual, totalPlanned) : '<span class="text-gray-400 text-xs">—</span>'}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>`
          }
        </div>
      </div>
    `

    // ── Render charts ──
    destroyAnalyticsChart('tsMonthly'); destroyAnalyticsChart('tsStatus'); destroyAnalyticsChart('tsDept'); destroyAnalyticsChart('taskVsPlan')

    const months = Array.from({length:12}, (_,i)=>String(i+1).padStart(2,'0'))
    const mMap = {}; monthly.forEach(m=>{ mMap[m.month] = m })

    // Chart giờ theo tháng
    const ctxM = document.getElementById('chartTsMonthly')?.getContext('2d')
    if (ctxM) _analyticsCharts['tsMonthly'] = safeChart(ctxM, {
      type: 'bar',
      data: {
        labels: months.map(m=>monthName(m)),
        datasets: [
          { label: 'Giờ thường', data: months.map(m=>+(mMap[m]?.regular||0).toFixed(1)), backgroundColor: '#00A651bb', borderRadius: 3 },
          { label: 'Tăng ca',    data: months.map(m=>+(mMap[m]?.overtime||0).toFixed(1)), backgroundColor: '#f59e0bbb', borderRadius: 3 }
        ]
      },
      options: { responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ font:{ size:10 } } } },
        scales:{ x:{ stacked:true, ticks:{ font:{ size:10 } } }, y:{ stacked:true, beginAtZero:true, ticks:{ font:{ size:10 } } } } }
    })

    // Chart trạng thái
    const ctxSt = document.getElementById('chartTsStatus')?.getContext('2d')
    if (ctxSt) _analyticsCharts['tsStatus'] = safeChart(ctxSt, {
      type: 'doughnut',
      data: {
        labels: (byStatus||[]).map(s=>statusLabel[s.status]||s.status),
        datasets: [{ data:(byStatus||[]).map(s=>s.count), backgroundColor:(byStatus||[]).map(s=>statusColor[s.status]||'#6b7280') }]
      },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ font:{ size:10 } } } } }
    })

    // Chart phòng ban
    const ctxDp = document.getElementById('chartTsDept')?.getContext('2d')
    if (ctxDp) _analyticsCharts['tsDept'] = safeChart(ctxDp, {
      type: 'bar',
      data: {
        labels: byDept.map(d=>d.department||'Chưa phân công'),
        datasets: [{ label:'Tổng giờ', data:byDept.map(d=>+(d.total_hours||0).toFixed(1)), backgroundColor:'#818cf8bb', borderRadius:4 }]
      },
      options: { responsive:true, maintainAspectRatio:false, indexAxis:'y',
        plugins:{ legend:{ display:false } },
        scales:{ x:{ ticks:{ font:{ size:10 } } }, y:{ ticks:{ font:{ size:10 } } } } }
    })

    // ── Chart task actual vs planned (top 15) ──
    const top15 = taskVsPlan.slice(0, 15)
    const ctxTV = document.getElementById('chartTaskVsPlan')?.getContext('2d')
    if (ctxTV && top15.length > 0) {
      const labels   = top15.map(t => t.task_title.length > 28 ? t.task_title.substring(0,26)+'…' : t.task_title)
      const actuals  = top15.map(t => +(t.ts_actual_hours||0).toFixed(1))
      const planneds = top15.map(t => +(t.planned_hours||0).toFixed(1))
      // Bar color: xanh nếu ≤100%, cam nếu 100-120%, đỏ nếu >120%
      const barColors = top15.map(t => {
        if (!t.planned_hours || t.planned_hours === 0) return '#94a3b8'
        const r = (t.ts_actual_hours||0) / t.planned_hours * 100
        return r > 120 ? '#ef444499' : r > 100 ? '#f9731699' : '#00A65199'
      })
      _analyticsCharts['taskVsPlan'] = safeChart(ctxTV, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label:'Giờ thực tế (Timesheet)', data:actuals, backgroundColor:barColors, borderRadius:4, order:1 },
            { label:'Giờ kế hoạch',            data:planneds, type:'line',
              borderColor:'#0066CC', backgroundColor:'#0066CC22',
              borderWidth:2, borderDash:[5,3], pointRadius:4, pointBackgroundColor:'#0066CC',
              fill:false, tension:0, order:0 }
          ]
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          plugins:{
            legend:{ position:'top', labels:{ font:{ size:11 } } },
            tooltip:{ callbacks:{
              afterLabel: (ctx) => {
                const t = top15[ctx.dataIndex]
                if (!t) return ''
                if (ctx.datasetIndex === 0) {
                  const diff = (t.ts_actual_hours||0) - (t.planned_hours||0)
                  const pctU = t.pct_used != null ? ` (${t.pct_used}%)` : ''
                  return t.planned_hours > 0
                    ? `Chênh: ${diff>=0?'+':''}${diff.toFixed(1)}h${pctU}`
                    : 'Chưa có kế hoạch'
                }
                return ''
              }
            }}
          },
          scales:{
            x:{ ticks:{ font:{ size:10 }, maxRotation:35 } },
            y:{ beginAtZero:true, ticks:{ font:{ size:10 }, callback: v => v+'h' } }
          }
        }
      })
    } else if (ctxTV) {
      // Không có data
      const parent = document.getElementById('chartTaskVsPlan').parentElement
      if (parent) parent.innerHTML = `<div class="flex items-center justify-center h-full text-gray-400 text-sm"><i class="fas fa-inbox mr-2"></i>Chưa có task nào được chấm công</div>`
    }

  } catch (e) {
    el.innerHTML = `<div class="text-center py-12 text-red-400"><i class="fas fa-exclamation-triangle text-2xl mb-3"></i><p>${e.message}</p></div>`
  }
}

// ================================================================
// TAB 6: FINANCIAL ANALYTICS (Admin only)
// ================================================================
async function renderFinancialTab(force = false) {
  const el = document.getElementById('analyticsFinancialContent')
  el.innerHTML = `<div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-3"></i><p>Đang tải dữ liệu tài chính...</p></div>`
  try {
    const year = getAnalyticsYear()
    const data = await api(`/analytics/financial?year=${year}`)
    const monthly = data.monthlyRevCost || []
    const kpi = data.kpi || {}
    const costTypes = data.costByType || []
    const topProjects = data.topProjectsByRevenue || []
    const revenueStatus = data.revenueByStatus || []

    const totalRev = kpi.total_revenue || 0
    const totalCost = kpi.total_cost || 0
    const totalLaborCost = kpi.total_labor_cost || 0
    const totalDirectCost = kpi.total_direct_cost || 0
    const totalSharedCost = kpi.total_shared_cost || 0
    const profit = totalRev - totalCost
    const margin = totalRev > 0 ? pct(profit, totalRev) : 0
    const fyLabel = kpi.fiscal_year_label || `NTC ${year}`
    const fyStart = kpi.fiscal_year_start || ''
    const fyEnd = kpi.fiscal_year_end || ''

    const costTypeLabel = { salary:'Chi phí lương', equipment:'Chi phí thiết bị', material:'Chi phí vật liệu', travel:'Chi phí đi lại', office:'Chi phí văn phòng', shared:'Chi phí chung', transport:'Chi phí vận chuyển', other:'Chi phí khác', manmonth:'Chi phí tháng', department:'Chi phí phòng', depreciation:'Chi phí khấu hao' }
    const revStatusLabel = { pending:'Chờ thanh toán', partial:'Thanh toán một phần', paid:'Đã thanh toán' }
    const revStatusColor = { pending:'#f59e0b', partial:'#3b82f6', paid:'#00A651' }

    el.innerHTML = `
      <!-- NTC label -->
      <div class="mb-4 flex items-center gap-2">
        <span class="inline-flex items-center gap-1 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded-full">
          <i class="fas fa-calendar-alt"></i> ${fyLabel}
          ${fyStart ? `<span class="text-blue-400 ml-1">${fyStart} → ${fyEnd}</span>` : ''}
        </span>
        <span class="text-xs text-gray-400">Doanh thu chỉ tính đã thu (paid/partial) · Chi phí gồm trực tiếp + lương + chi phí chung</span>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="kpi-card card border-l-4 border-green-500">
          <div class="text-xs text-gray-500 mb-1">Tổng doanh thu</div>
          <div class="text-xl font-bold text-green-600">${fmtM(totalRev)} VNĐ</div>
          <div class="text-xs text-gray-400 mt-1">Đã thu (paid/partial)</div>
        </div>
        <div class="kpi-card card border-l-4 border-red-400">
          <div class="text-xs text-gray-500 mb-1">Tổng chi phí</div>
          <div class="text-xl font-bold text-red-500">${fmtM(totalCost)} VNĐ</div>
          <div class="text-xs text-gray-400 mt-1 space-y-0.5">
            ${totalDirectCost>0?`<span class="block">Trực tiếp: ${fmtM(totalDirectCost)}</span>`:''}
            ${totalLaborCost>0?`<span class="block">Lương: ${fmtM(totalLaborCost)}</span>`:''}
            ${totalSharedCost>0?`<span class="block">Chi phí chung: ${fmtM(totalSharedCost)}</span>`:''}
          </div>
        </div>
        <div class="kpi-card card border-l-4 ${profit>=0?'border-blue-500':'border-orange-500'}">
          <div class="text-xs text-gray-500 mb-1">Lợi nhuận</div>
          <div class="text-xl font-bold ${profit>=0?'text-blue-600':'text-orange-600'}">${fmtM(profit)} VNĐ</div>
          <div class="text-xs ${profit>=0?'text-blue-400':'text-orange-400'} mt-1">${profit>=0?'Có lãi':'Lỗ'}</div>
        </div>
        <div class="kpi-card card border-l-4 border-purple-500">
          <div class="text-xs text-gray-500 mb-1">Biên lợi nhuận</div>
          <div class="text-xl font-bold text-purple-600">${margin}%</div>
          <div class="text-xs text-gray-400 mt-1">${margin>=30?'Tốt':margin>=10?'Trung bình':'Thấp'}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div class="card lg:col-span-2">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-chart-line mr-2 text-green-500"></i>Doanh thu & Chi phí & Lợi nhuận theo tháng (${fyLabel})</h3>
          <div style="height:260px"><canvas id="chartFinMonthly"></canvas></div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-tags mr-2 text-blue-500"></i>Chi phí theo loại</h3>
          <div style="height:200px"><canvas id="chartFinCostType"></canvas></div>
        </div>
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-file-invoice-dollar mr-2 text-yellow-500"></i>Trạng thái doanh thu</h3>
          <div style="height:200px"><canvas id="chartFinRevStatus"></canvas></div>
        </div>
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3"><i class="fas fa-info-circle mr-2 text-gray-500"></i>Tóm tắt</h3>
          <div class="space-y-3 mt-2">
            <div class="flex justify-between text-sm"><span class="text-gray-500">Dự án đang hoạt động</span><span class="font-bold">${kpi.active_projects||0}</span></div>
            <div class="flex justify-between text-sm"><span class="text-gray-500">Dự án hoàn thành (${fyLabel})</span><span class="font-bold text-green-600">${kpi.completed_projects||0}</span></div>
            <div class="border-t pt-3 space-y-1">
              <div class="flex justify-between text-sm"><span class="text-gray-500">Doanh thu (đã thu)</span><span class="font-bold text-green-600">${fmtM(totalRev)}</span></div>
              <div class="flex justify-between text-sm"><span class="text-gray-500">Chi phí trực tiếp</span><span class="font-semibold text-red-500">${fmtM(totalDirectCost)}</span></div>
              ${totalLaborCost>0?`<div class="flex justify-between text-sm"><span class="text-gray-500">Chi phí lương</span><span class="font-semibold text-orange-500">${fmtM(totalLaborCost)}</span></div>`:''}
              ${totalSharedCost>0?`<div class="flex justify-between text-sm"><span class="text-gray-500">Chi phí chung</span><span class="font-semibold text-yellow-600">${fmtM(totalSharedCost)}</span></div>`:''}
              <div class="flex justify-between text-sm font-semibold border-t pt-1"><span>Tổng chi phí</span><span class="text-red-500">${fmtM(totalCost)}</span></div>
              <div class="flex justify-between text-sm border-t pt-2"><span class="font-semibold">Lợi nhuận ròng</span><span class="font-bold ${profit>=0?'text-blue-600':'text-red-600'}">${fmtM(profit)}</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Top projects table -->
      <div class="card">
        <h3 class="font-semibold text-gray-700 mb-4"><i class="fas fa-crown mr-2 text-yellow-500"></i>Top dự án theo doanh thu (${fyLabel})</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="border-b text-left text-gray-500 text-xs uppercase">
              <th class="pb-2 pr-4">Dự án</th><th class="pb-2 pr-4 text-right">Doanh thu</th>
              <th class="pb-2 pr-4 text-right">Chi phí</th><th class="pb-2 pr-4 text-right">Lợi nhuận</th><th class="pb-2 text-right">Biên LN</th>
            </tr></thead>
            <tbody>
              ${topProjects.map(p=>{
                const pm = p.revenue>0 ? pct(p.profit, p.revenue) : 0
                return `<tr class="border-b hover:bg-gray-50">
                  <td class="py-3 pr-4"><div class="font-medium text-gray-800">${p.name}</div><div class="text-xs text-gray-400">${p.code}</div></td>
                  <td class="py-3 pr-4 text-right font-semibold text-green-600">${fmtM(p.revenue)}</td>
                  <td class="py-3 pr-4 text-right text-red-500">${fmtM(p.cost)}</td>
                  <td class="py-3 pr-4 text-right font-semibold ${p.profit>=0?'text-blue-600':'text-red-600'}">${fmtM(p.profit)}</td>
                  <td class="py-3 text-right">
                    <span class="px-2 py-1 rounded text-xs font-medium ${pm>=30?'bg-green-100 text-green-700':pm>=10?'bg-blue-100 text-blue-700':'bg-red-100 text-red-600'}">${pm}%</span>
                  </td>
                </tr>`
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `

    destroyAnalyticsChart('finMonthly'); destroyAnalyticsChart('finCostType'); destroyAnalyticsChart('finRevStatus')

    // Monthly chart dùng label T1..T12 từ NTC
    const monthLabels = monthly.map(m => m.month || m.month_key)
    const ctxFM = document.getElementById('chartFinMonthly')?.getContext('2d')
    if (ctxFM) _analyticsCharts['finMonthly'] = safeChart(ctxFM, {
      type: 'bar',
      data: {
        labels: monthLabels,
        datasets: [
          { label: 'Doanh thu', data: monthly.map(m=>+(m.revenue||0)), backgroundColor: '#00A651bb', borderRadius: 3, yAxisID: 'y' },
          { label: 'Chi phí', data: monthly.map(m=>+(m.cost||0)), backgroundColor: '#ef4444bb', borderRadius: 3, yAxisID: 'y' },
          { type: 'line', label: 'Lợi nhuận', data: monthly.map(m=>+(m.profit||0)), borderColor: '#3b82f6', pointRadius: 4, tension: 0.4, yAxisID: 'y' }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { font: { size: 11 } } } },
        scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } } }
    })

    const ctxCT = document.getElementById('chartFinCostType')?.getContext('2d')
    if (ctxCT) _analyticsCharts['finCostType'] = safeChart(ctxCT, {
      type: 'doughnut',
      data: {
        labels: costTypes.map(x=>costTypeLabel[x.cost_type]||getCostTypeNameDynamic(x.cost_type)),
        datasets: [{ data: costTypes.map(x=>x.total), backgroundColor: ['#00A651','#3b82f6','#f59e0b','#8b5cf6','#ef4444','#6b7280'] }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 10 } } } } }
    })

    const ctxRS = document.getElementById('chartFinRevStatus')?.getContext('2d')
    if (ctxRS) _analyticsCharts['finRevStatus'] = safeChart(ctxRS, {
      type: 'doughnut',
      data: {
        labels: revenueStatus.map(s=>revStatusLabel[s.payment_status]||s.payment_status),
        datasets: [{ data: revenueStatus.map(s=>s.total), backgroundColor: revenueStatus.map(s=>revStatusColor[s.payment_status]||'#6b7280') }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 10 } } } } }
    })
  } catch (e) {
    el.innerHTML = `<div class="text-center py-12 text-red-400"><i class="fas fa-exclamation-triangle text-2xl mb-3"></i><p>${e.message}</p></div>`
  }
}

// ================================================================
// TAB 7: PROJECT FINANCIAL DASHBOARD (Admin only)
// ================================================================
let _projFinCache = null
let _projFinYear = null
let _projFinMode = 'fiscal'   // 'fiscal' | 'lifetime'

function _switchProjFinMode(mode) {
  if (_projFinMode === mode) return
  _projFinMode = mode
  _projFinCache = null  // bust cache on mode switch
  renderProjectFinancialTab(true)
}

async function renderProjectFinancialTab(force = false) {
  const el = document.getElementById('analyticsProjectFinanceContent')
  if (!el) return
  const year = getAnalyticsYear()
  const mode = _projFinMode

  // Cache per year+mode
  if (!force && _projFinCache && _projFinYear === year + '_' + mode) {
    el.innerHTML = _projFinCache
    _drawProjectFinCharts(_projFinData)
    return
  }

  el.innerHTML = `<div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-3"></i><p>Đang tải dữ liệu tài chính dự án...</p></div>`
  try {
    const url = mode === 'lifetime'
      ? `/analytics/financial-by-project-lifetime`
      : `/analytics/financial-by-project?year=${year}`
    const data = await api(url)
    _projFinData = data
    window._projFinRaw = { ...data, fiscal_year_label: data.fiscal_year_label || `NTC ${year}` }
    _projFinYear = year + '_' + mode
    const projects = data.projects || []
    const totals   = data.totals  || {}
    const isLifetime = mode === 'lifetime'
    const fyLabel  = isLifetime ? 'Toàn vòng đời dự án' : (data.fiscal_year_label || `NTC ${year}`)
    const fyStart  = data.fiscal_year_start || ''
    const fyEnd    = data.fiscal_year_end   || ''

    // Sort: theo GTHĐ từ cao → thấp, sau đó theo doanh thu đã thu
    const sorted = [...projects].sort((a, b) => {
      // Ưu tiên có GTHĐ trước
      if (b.contract_value !== a.contract_value) return b.contract_value - a.contract_value
      // Nếu GTHĐ bằng nhau, sort theo doanh thu đã thu
      return b.revenue_collected - a.revenue_collected
    })

    // Chỉ lấy dự án có dữ liệu tài chính để vẽ chart
    const activeProjs = sorted.filter(p => p.revenue_total > 0 || p.total_cost > 0)

    const statusLabel = { active:'Đang chạy', planning:'Kế hoạch', on_hold:'Tạm dừng', completed:'Hoàn thành' }
    const statusColor = { active:'badge-active', planning:'badge-planning', on_hold:'badge-on_hold', completed:'badge-completed' }

    // Margin color helper
    const marginColor = (m) => m >= 30 ? 'text-green-600' : m >= 10 ? 'text-blue-600' : m >= 0 ? 'text-yellow-600' : 'text-red-600'
    const marginBg    = (m) => m >= 30 ? 'bg-green-100 text-green-700' : m >= 10 ? 'bg-blue-100 text-blue-700' : m >= 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
    const profitColor = (v) => v >= 0 ? 'text-blue-600' : 'text-red-500'

    // Bar helper (width capped at 100%)
    const bar = (pct, color) => `<div class="w-full bg-gray-100 rounded-full h-1.5 mt-1"><div class="h-1.5 rounded-full ${color}" style="width:${Math.min(100,Math.max(0,pct))}%"></div></div>`

    // ── KPI summary row ─────────────────────────────────────────────
    const kpiHtml = `
      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <div class="kpi-card" style="border-left-color:#6366f1">
          <div class="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Tổng GTHĐ</div>
          <div class="text-xl font-bold text-indigo-600">${fmtM(totals.contract_value)}</div>
          <div class="text-xs text-gray-400 mt-1">Giá trị hợp đồng</div>
        </div>
        <div class="kpi-card" style="border-left-color:#10b981">
          <div class="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Doanh thu đã thu</div>
          <div class="text-xl font-bold text-emerald-600">${fmtM(totals.revenue_collected)}</div>
          <div class="text-xs text-gray-400 mt-1">${totals.contract_value > 0 ? pct(totals.revenue_collected, totals.contract_value) + '% GTHĐ · ' : ''}${fmtM(totals.revenue_pending)} chờ thu</div>
        </div>
        <div class="kpi-card" style="border-left-color:#ef4444">
          <div class="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Tổng chi phí</div>
          <div class="text-xl font-bold text-red-500">${fmtM(totals.total_cost)}</div>
          <div class="text-xs text-gray-400 mt-1">${totals.contract_value > 0 ? pct(totals.total_cost, totals.contract_value) + '% GTHĐ · ' : ''}${totals.pct_cost}% doanh thu</div>
        </div>
        <div class="kpi-card" style="border-left-color:#3b82f6">
          <div class="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Lợi nhuận ròng</div>
          <div class="text-xl font-bold ${profitColor(totals.profit)}">${fmtM(totals.profit)}</div>
          <div class="text-xs text-gray-400 mt-1">${totals.contract_value > 0 ? pct(totals.profit, totals.contract_value) + '% GTHĐ · ' : ''}Sau toàn bộ chi phí</div>
        </div>
        <div class="kpi-card" style="border-left-color:#8b5cf6">
          <div class="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Biên lợi nhuận</div>
          <div class="text-xl font-bold ${marginColor(totals.margin)}">${totals.margin}%</div>
          <div class="text-xs text-gray-400 mt-1">${totals.margin>=30?'✅ Tốt':totals.margin>=10?'🟡 TB':'🔴 Thấp'}</div>
        </div>
        <div class="kpi-card" style="border-left-color:#f59e0b">
          <div class="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Tiến độ GTHĐ</div>
          <div class="text-xl font-bold text-amber-600">${totals.contract_progress}%</div>
          <div class="text-xs text-gray-400 mt-1">Doanh thu / GTHĐ</div>
        </div>
      </div>
    `

    // ── Cơ cấu chi phí tổng ─────────────────────────────────────────
    const costBreakdownHtml = `
      <div class="card mb-6">
        <h3 class="font-semibold text-gray-700 mb-4 text-sm">
          <i class="fas fa-layer-group mr-2 text-purple-500"></i>Cơ cấu chi phí toàn công ty — ${fyLabel}
        </h3>
        <div class="grid grid-cols-3 md:grid-cols-3 gap-4">
          <div class="text-center p-4 bg-blue-50 rounded-xl">
            <div class="text-2xl font-bold text-blue-600">${fmtM(totals.direct_cost)}</div>
            <div class="text-xs text-gray-600 mt-1 font-medium">Chi phí trực tiếp</div>
            <div class="text-xs text-blue-500 mt-0.5">${totals.contract_value > 0 ? pct(totals.direct_cost, totals.contract_value) : 0}% GTHĐ</div>
            ${bar(totals.contract_value > 0 ? (totals.direct_cost / totals.contract_value * 100) : 0,'bg-blue-500')}
          </div>
          <div class="text-center p-4 bg-orange-50 rounded-xl">
            <div class="text-2xl font-bold text-orange-600">${fmtM(totals.labor_cost)}</div>
            <div class="text-xs text-gray-600 mt-1 font-medium">Chi phí lương</div>
            <div class="text-xs text-orange-500 mt-0.5">${totals.contract_value > 0 ? pct(totals.labor_cost, totals.contract_value) : 0}% GTHĐ</div>
            ${bar(totals.contract_value > 0 ? (totals.labor_cost / totals.contract_value * 100) : 0,'bg-orange-500')}
          </div>
          <div class="text-center p-4 bg-yellow-50 rounded-xl">
            <div class="text-2xl font-bold text-yellow-600">${fmtM(totals.shared_cost)}</div>
            <div class="text-xs text-gray-600 mt-1 font-medium">Chi phí chung</div>
            <div class="text-xs text-yellow-600 mt-0.5">${totals.contract_value > 0 ? pct(totals.shared_cost, totals.contract_value) : 0}% GTHĐ</div>
            ${bar(totals.contract_value > 0 ? (totals.shared_cost / totals.contract_value * 100) : 0,'bg-yellow-400')}
          </div>
        </div>
      </div>
    `

    // ── 2 charts: Waterfall overview + Cost breakdown donut ─────────
    const chartsHtml = activeProjs.length > 0 ? `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3 text-sm">
            <i class="fas fa-chart-bar mr-2 text-green-500"></i>GTHĐ · Doanh thu · Chi phí · Lợi nhuận (sắp xếp theo GTHĐ)
          </h3>
          <div class="overflow-x-auto">
            <div style="height:280px;min-width:${Math.max(600, activeProjs.length * 50)}px">
              <canvas id="chartProjFinOverview"></canvas>
            </div>
          </div>
        </div>
        <div class="card">
          <h3 class="font-semibold text-gray-700 mb-3 text-sm">
            <i class="fas fa-chart-bar mr-2 text-purple-500"></i>Biên lợi nhuận theo dự án (%)
          </h3>
          <div style="height:280px"><canvas id="chartProjFinMargin"></canvas></div>
        </div>
      </div>
    ` : ''

    // ── Bảng chi tiết per-project ────────────────────────────────────
    // Dùng 1 table duy nhất với sticky thead/tfoot để tránh lệch cột khi tên dài
    const nameColW  = isLifetime ? 200 : 220   // px — cột tên dự án cố định
    const timeColW  = isLifetime ? 100 : 0
    const numCols   = [95, 95, 85, 85, 85, 75, 85, 85, 65, 110]  // GTHĐ, DT đã thu, DT chờ, CP TT, CP lương, CP chung, Tổng CP, LN, Biên, Tiến độ
    const totalMinW = nameColW + (isLifetime ? timeColW : 0) + numCols.reduce((a,b)=>a+b,0)
    const colgroup  = `<colgroup>
        <col style="width:${nameColW}px;min-width:${nameColW}px;max-width:${nameColW}px">
        ${isLifetime ? `<col style="width:${timeColW}px;min-width:${timeColW}px">` : ''}
        ${numCols.map(w => `<col style="width:${w}px;min-width:${w}px">`).join('')}
      </colgroup>`

    const tableHtml = `
      <div class="card">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-gray-700 text-sm">
            <i class="fas fa-table mr-2 text-gray-500"></i>Chi tiết tài chính từng dự án — ${fyLabel}
          </h3>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2 text-xs text-gray-400">
              <span class="inline-flex items-center gap-1"><span class="w-3 h-3 rounded bg-green-500 inline-block"></span>Doanh thu đã thu</span>
              <span class="inline-flex items-center gap-1"><span class="w-3 h-3 rounded bg-red-400 inline-block"></span>Tổng chi phí</span>
            </div>
            <button onclick="exportFinDetailExcel()" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors shadow-sm">
              <i class="fas fa-file-excel"></i> Xuất Excel
            </button>
          </div>
        </div>
        <div class="overflow-x-auto">
          <div style="max-height:580px;overflow-y:auto;position:relative;" id="finDetailScrollBody">
          <table class="text-sm border-collapse" style="table-layout:fixed;width:100%;min-width:${totalMinW}px" id="finDetailTable">
            ${colgroup}
            <thead style="position:sticky;top:0;z-index:2">
              <tr class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th class="text-left py-3 px-3 font-semibold border-b border-gray-200" style="overflow:hidden">Dự án</th>
                ${isLifetime ? `<th class="text-center py-3 px-3 font-semibold border-b border-gray-200 whitespace-nowrap">Thời gian</th>` : ''}
                <th class="text-right py-3 px-3 font-semibold border-b border-gray-200 whitespace-nowrap">GTHĐ</th>
                <th class="text-right py-3 px-3 font-semibold border-b border-gray-200 whitespace-nowrap">DT đã thu</th>
                <th class="text-right py-3 px-3 font-semibold border-b border-gray-200 whitespace-nowrap">DT chờ</th>
                <th class="text-right py-3 px-3 font-semibold border-b border-gray-200 whitespace-nowrap">CP trực tiếp</th>
                <th class="text-right py-3 px-3 font-semibold border-b border-gray-200 whitespace-nowrap">CP lương</th>
                <th class="text-right py-3 px-3 font-semibold border-b border-gray-200 whitespace-nowrap">CP chung</th>
                <th class="text-right py-3 px-3 font-semibold border-b border-gray-200 whitespace-nowrap">Tổng CP</th>
                <th class="text-right py-3 px-3 font-semibold border-b border-gray-200 whitespace-nowrap">Lợi nhuận</th>
                <th class="text-center py-3 px-3 font-semibold border-b border-gray-200 whitespace-nowrap">Biên LN</th>
                <th class="text-center py-3 px-3 font-semibold border-b border-gray-200 whitespace-nowrap">Tiến độ</th>
              </tr>
            </thead>
            <tbody id="finDetailTbody">
              ${sorted.map((p, idx) => {
                const hasData = p.revenue_total > 0 || p.total_cost > 0
                const rowBg = !hasData ? 'bg-gray-50 opacity-60' : idx % 2 === 0 ? '' : 'bg-gray-50/50'
                const cProg = p.contract_value > 0 ? Math.min(100, p.contract_progress) : 0
                const progColor = cProg >= 80 ? 'bg-green-500' : cProg >= 40 ? 'bg-blue-500' : 'bg-gray-300'
                const timespan = (isLifetime && (p.start_date || p.end_date))
                  ? `<div class="text-xs text-gray-400 whitespace-nowrap">${(p.start_date||'?').substring(0,7)} → ${(p.end_date||'?').substring(0,7)}</div>`
                  : ''
                return `
                  <tr class="border-b border-gray-100 hover:bg-green-50/30 transition-colors ${rowBg}">
                    <td class="py-2 px-3" style="overflow:hidden;max-width:${nameColW}px">
                      <div class="flex items-center gap-2">
                        <div class="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style="background:${!hasData?'#d1d5db':p.margin>=30?'#00A651':p.margin>=10?'#3b82f6':p.margin>=0?'#f59e0b':'#ef4444'}">
                          ${p.code?.substring(0,3)||'?'}
                        </div>
                        <div style="min-width:0;flex:1;overflow:hidden">
                          <div class="font-semibold text-gray-800 text-xs leading-tight" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${p.name.replace(/"/g,'&quot;')}">${p.name}</div>
                          <div class="flex items-center gap-1 mt-0.5">
                            <span class="text-gray-400 text-xs">${p.code}</span>
                            <span class="badge ${statusColor[p.status]||'badge-planning'} text-xs py-0 px-1.5" style="font-size:9px">${statusLabel[p.status]||p.status}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    ${isLifetime ? `<td class="py-2 px-3 text-center">${timespan||'<span class="text-gray-300 text-xs">—</span>'}</td>` : ''}
                    <td class="py-2 px-3 text-right whitespace-nowrap">
                      <span class="font-semibold text-indigo-700">${p.contract_value > 0 ? fmtM(p.contract_value) : '<span class="text-gray-300">—</span>'}</span>
                    </td>
                    <td class="py-2 px-3 text-right whitespace-nowrap">
                      <span class="font-semibold text-emerald-600">${p.revenue_collected > 0 ? fmtM(p.revenue_collected) : '<span class="text-gray-300">—</span>'}</span>
                      ${p.revenue_collected > 0 && p.contract_value > 0 ? `<div class="text-xs text-gray-400" title="% trên GTHĐ">${pct(p.revenue_collected, p.contract_value)}%</div>` : ''}
                    </td>
                    <td class="py-2 px-3 text-right whitespace-nowrap">
                      <span class="${p.revenue_pending > 0 ? 'text-amber-600 font-medium' : 'text-gray-300'}">${p.revenue_pending > 0 ? fmtM(p.revenue_pending) : '—'}</span>
                      ${p.revenue_pending > 0 && p.contract_value > 0 ? `<div class="text-xs text-gray-400" title="% trên GTHĐ">${pct(p.revenue_pending, p.contract_value)}%</div>` : ''}
                    </td>
                    <td class="py-2 px-3 text-right whitespace-nowrap">
                      <span class="${p.direct_cost > 0 ? 'text-blue-600' : 'text-gray-300'}">${p.direct_cost > 0 ? fmtM(p.direct_cost) : '—'}</span>
                      ${p.direct_cost > 0 && p.pct_direct > 0 ? `<div class="text-xs text-gray-400" title="% trên GTHĐ">${p.pct_direct}%</div>` : ''}
                    </td>
                    <td class="py-2 px-3 text-right whitespace-nowrap">
                      <span class="${p.labor_cost > 0 ? 'text-orange-600' : 'text-gray-300'}">${p.labor_cost > 0 ? fmtM(p.labor_cost) : '—'}</span>
                      ${p.labor_cost > 0 && p.pct_labor > 0 ? `<div class="text-xs text-gray-400" title="% trên GTHĐ">${p.pct_labor}%</div>` : ''}
                    </td>
                    <td class="py-2 px-3 text-right whitespace-nowrap">
                      <span class="${p.shared_cost > 0 ? 'text-yellow-600' : 'text-gray-300'}">${p.shared_cost > 0 ? fmtM(p.shared_cost) : '—'}</span>
                      ${p.shared_cost > 0 && p.pct_shared > 0 ? `<div class="text-xs text-gray-400" title="% trên GTHĐ">${p.pct_shared}%</div>` : ''}
                    </td>
                    <td class="py-2 px-3 text-right whitespace-nowrap">
                      <span class="font-semibold text-red-500">${p.total_cost > 0 ? fmtM(p.total_cost) : '<span class="text-gray-300">—</span>'}</span>
                      ${p.total_cost > 0 && p.pct_cost > 0 ? `<div class="text-xs text-gray-400" title="% trên GTHĐ">${p.pct_cost}%</div>` : ''}
                    </td>
                    <td class="py-2 px-3 text-right whitespace-nowrap">
                      ${(p.revenue_collected > 0 || p.total_cost > 0)
                        ? `<span class="font-bold ${profitColor(p.profit)}">${fmtM(p.profit)}</span>`
                        : '<span class="text-gray-300">—</span>'
                      }
                    </td>
                    <td class="py-2 px-3 text-center">
                      ${p.revenue_collected > 0
                        ? `<span class="inline-block px-2 py-0.5 rounded-lg text-xs font-bold ${marginBg(p.margin)}">${p.margin}%</span>`
                        : '<span class="text-gray-300 text-xs">—</span>'
                      }
                    </td>
                    <td class="py-2 px-3">
                      ${p.contract_value > 0 ? `
                        <div class="flex items-center gap-1">
                          <div class="flex-1 bg-gray-200 rounded-full h-1.5">
                            <div class="h-1.5 rounded-full ${progColor}" style="width:${cProg}%"></div>
                          </div>
                          <span class="text-xs font-semibold text-gray-600 whitespace-nowrap">${p.contract_progress}%</span>
                        </div>
                      ` : '<span class="text-xs text-gray-300">—</span>'}
                    </td>
                  </tr>
                `
              }).join('')}
            </tbody>
            <tfoot style="position:sticky;bottom:0;z-index:2">
              <tr class="bg-gray-100 font-bold text-sm border-t-2 border-gray-300">
                <td class="py-3 px-3 text-gray-700 whitespace-nowrap" style="overflow:hidden;text-overflow:ellipsis;max-width:${nameColW}px"><i class="fas fa-sigma mr-1 text-gray-500"></i>Tổng cộng</td>
                ${isLifetime ? `<td class="py-3 px-3 text-center text-gray-400 text-xs">—</td>` : ''}
                <td class="py-3 px-3 text-right text-indigo-700 whitespace-nowrap">${fmtM(totals.contract_value)}</td>
                <td class="py-3 px-3 text-right text-emerald-600 whitespace-nowrap">${fmtM(totals.revenue_collected)}</td>
                <td class="py-3 px-3 text-right text-amber-600 whitespace-nowrap">${fmtM(totals.revenue_pending)}</td>
                <td class="py-3 px-3 text-right text-blue-600 whitespace-nowrap">${fmtM(totals.direct_cost)}</td>
                <td class="py-3 px-3 text-right text-orange-600 whitespace-nowrap">${fmtM(totals.labor_cost)}</td>
                <td class="py-3 px-3 text-right text-yellow-600 whitespace-nowrap">${fmtM(totals.shared_cost)}</td>
                <td class="py-3 px-3 text-right text-red-500 whitespace-nowrap">${fmtM(totals.total_cost)}</td>
                <td class="py-3 px-3 text-right whitespace-nowrap ${profitColor(totals.profit)}">${fmtM(totals.profit)}</td>
                <td class="py-3 px-3 text-center">
                  <span class="inline-block px-2 py-0.5 rounded-lg text-xs font-bold ${marginBg(totals.margin)}">${totals.margin}%</span>
                </td>
                <td class="py-3 px-3 text-center text-gray-500 text-xs whitespace-nowrap">${totals.contract_progress}%</td>
              </tr>
            </tfoot>
          </table>
          </div><!-- end scroll wrapper -->
        </div>
      </div>
    `

    // ── Ghi chú & legend ─────────────────────────────────────────────
    const legendHtml = `
      <div class="card mt-4 bg-blue-50 border border-blue-100">
        <div class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
          <span><strong>GTHĐ</strong>: Giá trị hợp đồng</span>
          <span><strong>DT đã thu</strong>: Doanh thu trạng thái <em>paid + partial</em></span>
          <span><strong>DT chờ thu</strong>: Doanh thu trạng thái <em>pending</em></span>
          <span><strong>CP trực tiếp</strong>: Chi phí vật liệu, thiết bị, đi lại, văn phòng…</span>
          <span><strong>CP lương</strong>: Từ bảng project_labor_costs (tính theo timesheet)</span>
          <span><strong>CP chung</strong>: Chi phí chung phân bổ (điện, nước, văn phòng…)</span>
          <span><strong>Biên LN</strong>: Lợi nhuận / Doanh thu đã thu × 100%</span>
          <span><strong>Tiến độ GTHĐ</strong>: Tổng doanh thu (all status) / GTHĐ × 100%</span>
          ${isLifetime ? `<span class="text-emerald-600 font-medium"><i class="fas fa-infinity mr-1"></i>Chế độ <em>Toàn vòng đời</em>: dữ liệu không lọc theo năm, tổng hợp từ lúc bắt đầu đến khi kết thúc dự án.</span>` : ''}
        </div>
      </div>
    `

    const html = `
      <!-- Mode toggle bar -->
      <div class="flex items-center gap-3 mb-4 flex-wrap">
        <div class="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium shadow-sm">
          <button onclick="_switchProjFinMode('fiscal')"
            class="px-4 py-2 transition-colors ${mode==='fiscal'
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'}">
            <i class="fas fa-calendar-alt mr-1"></i>Theo năm tài chính
          </button>
          <button onclick="_switchProjFinMode('lifetime')"
            class="px-4 py-2 transition-colors ${mode==='lifetime'
              ? 'bg-emerald-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'}">
            <i class="fas fa-infinity mr-1"></i>Toàn vòng đời dự án
          </button>
        </div>
        ${isLifetime
          ? `<span class="inline-flex items-center gap-1 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full">
               <i class="fas fa-infinity"></i> Toàn bộ lịch sử tài chính
             </span>`
          : `<span class="inline-flex items-center gap-1 text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1 rounded-full">
               <i class="fas fa-calendar-alt"></i> ${fyLabel}
               ${fyStart ? `<span class="text-indigo-400 ml-1">${fyStart} → ${fyEnd}</span>` : ''}
             </span>`
        }
        <span class="text-xs text-gray-400">${projects.length} dự án · ${activeProjs.length} có dữ liệu tài chính</span>
      </div>
      ${kpiHtml}
      ${costBreakdownHtml}
      ${chartsHtml}
      ${tableHtml}
      ${legendHtml}
    `

    el.innerHTML = html
    _projFinCache = html

    // Single table with sticky thead/tfoot — no column sync needed
    requestAnimationFrame(() => {
      _drawProjectFinCharts(data)
    })

  } catch(e) {
    el.innerHTML = `<div class="text-center py-12 text-red-400"><i class="fas fa-exclamation-triangle text-2xl mb-3"></i><p>${e.message}</p></div>`
  }
}

let _projFinData = null

// ── Xuất Excel bảng chi tiết tài chính từng dự án ────────────────
function exportFinDetailExcel() {
  if (typeof XLSX === 'undefined') {
    toast('Thư viện Excel chưa sẵn sàng, vui lòng thử lại', 'error'); return
  }

  // Lấy data từ DOM table hiện tại
  const table = document.getElementById('finDetailTable')
  if (!table) { toast('Không tìm thấy bảng dữ liệu', 'error'); return }

  const isLifetime = document.querySelector('#analyticsProjectFinanceContent h3')
    ?.textContent?.includes('Toàn vòng đời') || false

  // Lấy tiêu đề từ heading bảng
  const titleEl = document.querySelector('#analyticsProjectFinanceContent .card h3')
  const title   = titleEl?.textContent?.trim().replace(/^\s*\S+\s*/, '') || 'Chi tiết tài chính'

  // Thu thập rows từ thead + tbody + tfoot
  const wb = XLSX.utils.book_new()

  // Màu sắc header
  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 },
    fill: { fgColor: { rgb: '1F7A4D' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } }
  }
  const numStyle = {
    numFmt: '#,##0',
    alignment: { horizontal: 'right', vertical: 'center' }
  }
  const pctStyle = {
    numFmt: '0.0"%"',
    alignment: { horizontal: 'center', vertical: 'center' }
  }
  const totalStyle = {
    font: { bold: true, sz: 10 },
    fill: { fgColor: { rgb: 'F3F4F6' } },
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '#,##0'
  }

  // ── Header rows ──
  const headers1 = isLifetime
    ? ['Dự án', 'Mã', 'Trạng thái', 'Thời gian', 'GTHĐ', 'DT đã thu', '% GTHĐ', 'DT chờ thu', '% GTHĐ', 'CP trực tiếp', '% GTHĐ', 'CP lương', '% GTHĐ', 'CP chung', '% GTHĐ', 'Tổng CP', '% GTHĐ', 'Lợi nhuận', 'Biên LN (%)', 'Tiến độ HĐ (%)']
    : ['Dự án', 'Mã', 'Trạng thái', 'GTHĐ', 'DT đã thu', '% GTHĐ', 'DT chờ thu', '% GTHĐ', 'CP trực tiếp', '% GTHĐ', 'CP lương', '% GTHĐ', 'CP chung', '% GTHĐ', 'Tổng CP', '% GTHĐ', 'Lợi nhuận', 'Biên LN (%)', 'Tiến độ HĐ (%)']

  // ── Lấy dữ liệu từ _projFinData nếu có ──
  const rawData    = window._projFinRaw || {}
  const projects   = rawData.projects || []
  const totals     = rawData.totals   || {}
  const fyLabel    = rawData.fiscal_year_label || ''
  const statusLbl  = { active:'Đang chạy', planning:'Kế hoạch', on_hold:'Tạm dừng', completed:'Hoàn thành', cancelled:'Đã hủy' }

  // Sort same as UI
  const sorted = [...projects].sort((a, b) => {
    const scoreA = (a.revenue_total > 0 ? 2 : 0) + (a.total_cost > 0 ? 1 : 0)
    const scoreB = (b.revenue_total > 0 ? 2 : 0) + (b.total_cost > 0 ? 1 : 0)
    if (scoreB !== scoreA) return scoreB - scoreA
    return b.revenue_collected - a.revenue_collected
  })

  const aoa = []
  // Title row
  aoa.push([`Chi tiết tài chính từng dự án — ${fyLabel || title}`])
  aoa.push([]) // blank
  aoa.push(headers1)

  sorted.forEach(p => {
    const cv  = p.contract_value    || 0
    const rc  = p.revenue_collected || 0
    const rp  = p.revenue_pending   || 0
    const dc  = p.direct_cost       || 0
    const lc  = p.labor_cost        || 0
    const sc  = p.shared_cost       || 0
    const tc  = p.total_cost        || 0
    const pf  = p.profit            || 0
    const base = cv > 0 ? cv : rc
    const pctOf = (v) => base > 0 ? Math.round(v / base * 1000) / 10 : ''
    const timespan = (p.start_date || p.end_date)
      ? `${(p.start_date||'?').substring(0,7)} → ${(p.end_date||'?').substring(0,7)}`
      : ''

    if (isLifetime) {
      aoa.push([
        p.name, p.code, statusLbl[p.status]||p.status, timespan,
        cv||'', rc||'', pctOf(rc), rp||'', pctOf(rp),
        dc||'', pctOf(dc), lc||'', pctOf(lc), sc||'', pctOf(sc),
        tc||'', pctOf(tc), pf, p.margin||'', p.contract_progress||''
      ])
    } else {
      aoa.push([
        p.name, p.code, statusLbl[p.status]||p.status,
        cv||'', rc||'', pctOf(rc), rp||'', pctOf(rp),
        dc||'', pctOf(dc), lc||'', pctOf(lc), sc||'', pctOf(sc),
        tc||'', pctOf(tc), pf, p.margin||'', p.contract_progress||''
      ])
    }
  })

  // Totals row
  const tbase = (totals.contract_value||0) > 0 ? totals.contract_value : (totals.revenue_collected||0)
  const tpctOf = (v) => tbase > 0 ? Math.round((v||0) / tbase * 1000) / 10 : ''
  if (isLifetime) {
    aoa.push([
      'TỔNG CỘNG', '', '', '',
      totals.contract_value||0, totals.revenue_collected||0, tpctOf(totals.revenue_collected),
      totals.revenue_pending||0, tpctOf(totals.revenue_pending),
      totals.direct_cost||0, tpctOf(totals.direct_cost),
      totals.labor_cost||0,  tpctOf(totals.labor_cost),
      totals.shared_cost||0, tpctOf(totals.shared_cost),
      totals.total_cost||0,  tpctOf(totals.total_cost),
      totals.profit||0, totals.margin||'', totals.contract_progress||''
    ])
  } else {
    aoa.push([
      'TỔNG CỘNG', '', '',
      totals.contract_value||0, totals.revenue_collected||0, tpctOf(totals.revenue_collected),
      totals.revenue_pending||0, tpctOf(totals.revenue_pending),
      totals.direct_cost||0, tpctOf(totals.direct_cost),
      totals.labor_cost||0,  tpctOf(totals.labor_cost),
      totals.shared_cost||0, tpctOf(totals.shared_cost),
      totals.total_cost||0,  tpctOf(totals.total_cost),
      totals.profit||0, totals.margin||'', totals.contract_progress||''
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Column widths
  const colWidths = isLifetime
    ? [40, 10, 12, 20, 14, 14, 8, 14, 8, 14, 8, 14, 8, 14, 8, 14, 8, 14, 10, 10]
    : [40, 10, 12, 14, 14, 8, 14, 8, 14, 8, 14, 8, 14, 8, 14, 8, 14, 10, 10]
  ws['!cols'] = colWidths.map(w => ({ wch: w }))

  // Merge title across all cols
  const totalCols = headers1.length
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }]

  // Row heights
  ws['!rows'] = [{ hpt: 22 }, { hpt: 4 }, { hpt: 32 }]

  XLSX.utils.book_append_sheet(wb, ws, 'Tài chính dự án')

  // Tên file
  const safeLabel = (fyLabel || title).replace(/[/\\?*[\]]/g, '-').substring(0, 40)
  const fname = `TaiChinh_DuAn_${safeLabel}_${new Date().toISOString().slice(0,10)}.xlsx`
  XLSX.writeFile(wb, fname)
  toast('Xuất Excel thành công!', 'success')
}

function _drawProjectFinCharts(data) {
  if (!data) return
  const projects = (data.projects || []).filter(p => p.revenue_total > 0 || p.total_cost > 0)
  if (!projects.length) return

  // Sort theo GTHĐ từ cao → thấp, giới hạn top 15 dự án để biểu đồ dễ đọc
  const top = [...projects].sort((a,b) => b.contract_value - a.contract_value).slice(0, 15)
  const labels = top.map(p => p.code || p.name.substring(0,10))

  // Chart 1: Overview grouped bar
  destroyAnalyticsChart('projFinOverview')
  const ctx1 = document.getElementById('chartProjFinOverview')?.getContext('2d')
  if (ctx1) {
    _analyticsCharts['projFinOverview'] = safeChart(ctx1, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'GTHĐ', data: top.map(p => p.contract_value), backgroundColor: '#818cf820', borderColor: '#818cf8', borderWidth: 1.5, borderRadius: 3 },
          { label: 'DT đã thu', data: top.map(p => p.revenue_collected), backgroundColor: '#00A651bb', borderRadius: 3 },
          { label: 'Tổng chi phí', data: top.map(p => p.total_cost), backgroundColor: '#ef4444bb', borderRadius: 3 },
          { type: 'line', label: 'Lợi nhuận', data: top.map(p => p.profit),
            borderColor: '#3b82f6', backgroundColor: '#3b82f620',
            pointBackgroundColor: top.map(p => p.profit >= 0 ? '#3b82f6' : '#ef4444'),
            pointRadius: 5, tension: 0.3, fill: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { font: { size: 10 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtMoney(ctx.raw)}` } }
        },
        scales: {
          x: { ticks: { font: { size: 9 }, maxRotation: 35 } },
          y: { ticks: { font: { size: 9 }, callback: v => fmtM(v) } }
        }
      }
    })
  }

  // Chart 2: Margin bar chart (horizontal)
  destroyAnalyticsChart('projFinMargin')
  const ctx2 = document.getElementById('chartProjFinMargin')?.getContext('2d')
  if (ctx2) {
    const withMargin = top.filter(p => p.revenue_collected > 0)
    const mLabels = withMargin.map(p => p.code || p.name.substring(0,10))
    const mData   = withMargin.map(p => p.margin)
    const mColors = mData.map(m => m >= 30 ? '#00A651' : m >= 10 ? '#3b82f6' : m >= 0 ? '#f59e0b' : '#ef4444')
    _analyticsCharts['projFinMargin'] = safeChart(ctx2, {
      type: 'bar',
      data: {
        labels: mLabels,
        datasets: [{
          label: 'Biên lợi nhuận (%)',
          data: mData,
          backgroundColor: mColors,
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.raw}%` } }
        },
        scales: {
          x: {
            ticks: { font: { size: 9 }, callback: v => v + '%' },
            grid: { color: '#f3f4f6' }
          },
          y: { ticks: { font: { size: 9 } } }
        }
      }
    })
  }
}

// ----------------------------------------------------------------
// Export PDF (basic print dialog)
// ----------------------------------------------------------------
function exportAnalyticsPDF() {
  window.print()
}


// ================================================================
// MODULE: HỒ SƠ PHÁP LÝ DỰ ÁN
// ================================================================

let _legalCurrentProjectId = null
let _legalOverviewData = null
let _legalCurrentTab = 'stages'
let _legalTabSetByUser = false

const LEGAL_STATUS_LABELS = {
  pending: 'Chưa thực hiện',
  in_progress: 'Đang thực hiện',
  completed: 'Đã hoàn thành',
  na: 'Không áp dụng'
}
const LEGAL_STATUS_COLORS = {
  pending: 'badge-todo',
  in_progress: 'badge-in_progress',
  completed: 'badge-completed',
  na: 'badge-cancelled'
}
const LEGAL_DOC_TYPE_LABELS = {
  contract:   'Hợp đồng',
  appendix:   'Phụ lục HĐ',
  acceptance: 'Nghiệm thu',
  payment:    'Thanh toán',
  cv:         'Công văn (CV)',
  bc:         'Báo cáo (BC)',
  bb:         'Biên bản (BB)',
  tb:         'Thông báo (TB)',
  qd:         'Quyết định (QĐ)',
  tt:         'Tờ trình (TT)',
  kh:         'Kế hoạch (KH)',
  yc:         'Yêu cầu (YC)',
  pl:         'Phụ lục (PL)',
  other:      'Văn bản khác (VB)'
}
const LEGAL_LETTER_STATUS_LABELS = {
  draft: 'Nháp',
  sent: 'Đã gửi',
  acknowledged: 'Đã xác nhận'
}
const LEGAL_LETTER_STATUS_COLORS = {
  draft: 'badge-todo',
  sent: 'badge-in_progress',
  acknowledged: 'badge-completed'
}
const STAGE_COLORS = {
  A: { bg: '#eff6ff', border: '#3b82f6', text: '#1d4ed8', icon: 'fa-clipboard-list' },
  B: { bg: '#fdf4ff', border: '#a855f7', text: '#7e22ce', icon: 'fa-handshake' },
  C: { bg: '#fff7ed', border: '#f97316', text: '#c2410c', icon: 'fa-file-signature' },
  D: { bg: '#f0fdf4', border: '#22c55e', text: '#15803d', icon: 'fa-check-double' },
  E: { bg: '#ecfdf5', border: '#10b981', text: '#065f46', icon: 'fa-money-check-alt' },
  F: { bg: '#fefce8', border: '#eab308', text: '#854d0e', icon: 'fa-folder-open' },
  G: { bg: '#f0f9ff', border: '#0ea5e9', text: '#0369a1', icon: 'fa-layer-group' },
  H: { bg: '#fff1f2', border: '#f43f5e', text: '#9f1239', icon: 'fa-archive' },
  I: { bg: '#f5f3ff', border: '#8b5cf6', text: '#5b21b6', icon: 'fa-box' },
  J: { bg: '#fef9c3', border: '#ca8a04', text: '#92400e', icon: 'fa-file-alt' },
}

const PAYMENT_STATUS_LABELS = {
  pending:    '⏳ Chờ thanh toán',
  processing: '🔄 Đang xử lý',
  partial:    '💰 TT một phần',
  paid:       '✅ Đã thanh toán',
  rejected:   '❌ Từ chối'
}
const PAYMENT_STATUS_COLORS = {
  pending:    'badge-todo',
  processing: 'badge-in_progress',
  partial:    'badge-in_progress',
  paid:       'badge-completed',
  rejected:   'badge-cancelled'
}

// ── Navigate to Legal page ───────────────────────────────────────────────────
async function loadLegal() {
  // Load projects if needed
  if (allProjects.length === 0) {
    try { allProjects = (await api('/projects')).projects || [] } catch(e) {}
  }

  // Build searchable combobox for project selection
  const items = allProjects.map(p => ({ value: String(p.id), label: `[${p.code}] ${p.name}` }))
  const currentVal = _legalCurrentProjectId ? String(_legalCurrentProjectId) : ''
  createCombobox('legalProjectSelectCombobox', {
    placeholder: '-- Chọn dự án --',
    items,
    value: currentVal,
    minWidth: '240px',
    onchange: (val) => _onLegalProjectComboChange(val)
  })

  // If project already selected, reload
  if (_legalCurrentProjectId) {
    await loadLegalProject(_legalCurrentProjectId)
  }
}

async function _onLegalProjectComboChange(val) {
  const projectId = parseInt(val)
  if (!projectId) {
    _legalCurrentProjectId = null
    $('legalStagesContainer').innerHTML = `<div class="card text-center py-16 text-gray-400">
      <i class="fas fa-file-contract text-5xl mb-4 opacity-30"></i>
      <p class="font-medium">Chọn dự án để xem hồ sơ pháp lý</p>
    </div>`
    $('legalKPIRow').style.display = 'none'
    $('legalTabs').style.display = 'none'
    ;['btnAddLetter','btnAddDoc','btnLetterConfig','btnImportExcel'].forEach(id => { if($(id)) $(id).style.display='none' })
    return
  }
  await loadLegalProject(projectId)
}

// Keep backward compat if any inline onchange still references this
async function onLegalProjectChange() {
  const val = _cbGetValue('legalProjectSelectCombobox')
  await _onLegalProjectComboChange(val)
}

async function loadLegalProject(projectId) {
  _legalCurrentProjectId = projectId
  try {
    // Auto-init if first time
    await api(`/legal/init/${projectId}`, { method: 'POST' })
    // Load overview
    const data = await api(`/legal/${projectId}/overview`)
    _legalOverviewData = data

    // ── Kiểm tra quyền của user trong dự án này ──
    // Member chỉ được xem + tạo văn bản gửi đi
    // Project Leader trở lên: toàn quyền
    const effRole = getEffectiveRoleForProject(projectId)
    // Kiểm tra quyền: chỉ system_admin mới có full quyền
    const isSystemAdmin = effRole === 'system_admin'

    // Show KPI row
    $('legalKPIRow').style.display = ''

    // Điều chỉnh tabs theo quyền
    if (!isSystemAdmin) {
      // Member / Project Leader / Project Admin: chỉ hiện Văn bản gửi đi, Biên bản họp, Tài liệu đính kèm
      $('legalTabs').style.display = ''
      ;['stages', 'payments'].forEach(t => {
        const btn = $('ltab-' + t)
        if (btn) btn.style.display = 'none'
      })
      // Đảm bảo tab letters, minutes, docs luôn hiển thị
      const btnLetters = $('ltab-letters')
      const btnMinutes = $('ltab-minutes')
      const btnDocs = $('ltab-docs')
      if (btnLetters) btnLetters.style.display = ''
      if (btnMinutes) btnMinutes.style.display = ''
      if (btnDocs) btnDocs.style.display = ''
      // Force tab vào một trong 3 tab được phép
      if (!['letters', 'minutes', 'docs'].includes(_legalCurrentTab)) {
        _legalCurrentTab = 'letters'
      }
      // Nút header: hiện Gửi văn bản và Thêm tài liệu, ẩn các nút admin
      if ($('btnAddLetter')) $('btnAddLetter').style.display = ''
      if ($('btnAddDoc')) $('btnAddDoc').style.display = ''
      ;['btnLetterConfig', 'btnImportExcel'].forEach(id => { if($(id)) $(id).style.display = 'none' })
      // Ẩn KPI cards liên quan đến stages và payments
      const kpiCards = $('legalKPIRow')?.querySelectorAll('.kpi-card')
      if (kpiCards) {
        kpiCards.forEach((card, idx) => {
          // idx 0 = Tổng hạng mục, 1 = Đã hoàn thành → ẩn (liên quan stages)
          // idx 2 = Văn bản gửi đi, 3 = Tài liệu đính kèm → giữ lại
          card.style.display = (idx === 0 || idx === 1) ? 'none' : ''
        })
      }
    } else {
      // System Admin: toàn quyền tất cả tabs
      $('legalTabs').style.display = ''
      ;['stages', 'letters', 'minutes', 'docs', 'payments'].forEach(t => {
        const btn = $('ltab-' + t)
        if (btn) btn.style.display = ''
      })
      ;['btnAddLetter', 'btnAddDoc', 'btnLetterConfig', 'btnImportExcel'].forEach(id => { if($(id)) $(id).style.display = '' })
      // Khôi phục tất cả KPI cards
      const kpiCards = $('legalKPIRow')?.querySelectorAll('.kpi-card')
      if (kpiCards) kpiCards.forEach(card => card.style.display = '')
      // Nếu tab hiện tại bị reset về letters do lần trước không phải admin, phục hồi stages
      if (['letters', 'minutes', 'docs'].includes(_legalCurrentTab) && !_legalTabSetByUser) {
        _legalCurrentTab = 'stages'
      }
    }

    // Render KPI — tính tổng qua packages → stages → items
    let totalItems = 0, doneItems = 0
    const allStages = (data.packages || []).flatMap(pkg => pkg.stages || [])
    allStages.forEach(stage => {
      stage.items.forEach(item => {
        totalItems++
        if (item.status === 'completed') doneItems++
        ;(item.children || []).forEach(ch => {
          totalItems++
          if (ch.status === 'completed') doneItems++
        })
      })
    })
    $('legalKpiTotal').textContent = totalItems
    $('legalKpiDone').textContent = doneItems
    $('legalKpiLetters').textContent = (data.letters || []).length
    $('legalKpiDocs').textContent = (data.documents || []).length

    // Sync tab UI rồi render
    switchLegalTab(_legalCurrentTab)

  } catch(e) {
    toast('Lỗi tải dữ liệu pháp lý: ' + e.message, 'error')
  }
}

function switchLegalTab(tab) {
  // Nếu gọi từ onclick của người dùng → đánh dấu
  _legalCurrentTab = tab
  _legalTabSetByUser = true
  ;['stages','letters','minutes','docs','payments'].forEach(t => {
    const btn = $('ltab-' + t)
    const panel = $('legalTab' + t.charAt(0).toUpperCase() + t.slice(1))
    if (btn) btn.classList.toggle('active', t === tab)
    if (panel) panel.style.display = t === tab ? '' : 'none'
  })
  renderLegalTab(tab)
}

function renderLegalTab(tab) {
  if (!_legalOverviewData) return
  if (tab === 'stages') renderLegalPackages(_legalOverviewData.packages || [], _legalOverviewData.stages || [])
  else if (tab === 'letters') renderLegalLetters(_legalOverviewData.letters || [])
  else if (tab === 'minutes') renderMeetingMinutes(_legalOverviewData.minutes || [])
  else if (tab === 'docs') renderLegalDocs(_legalOverviewData.documents || [])
  else if (tab === 'payments') renderPaymentStatus(_legalOverviewData.payments || [])
}

// ── Package collapse state ────────────────────────────────────────────────────
const _pkgCollapseState = {}

// ── Render Packages (3-level: Package → Stage A-D → Items) ───────────────────
function renderLegalPackages(packages, flatStages) {
  const container = $('legalStagesContainer')
  if (!container) return

  // If no packages yet, fall back to flat stages view
  if (!packages || packages.length === 0) {
    if (flatStages && flatStages.length > 0) {
      renderLegalStages(flatStages)
      return
    }
    container.innerHTML = `
      <div class="card text-center py-10 text-gray-400">
        <i class="fas fa-folder-open text-4xl mb-3 block text-gray-300"></i>
        <div class="font-semibold mb-1">Chưa có gói thầu nào</div>
        <div class="text-sm mb-4">Tạo gói thầu để bắt đầu theo dõi hồ sơ dự án</div>
        <button onclick="openAddPackageModal()" class="btn-accent text-sm mx-auto" style="width:auto;padding:6px 20px">
          <i class="fas fa-plus mr-1"></i> Tạo gói thầu mới
        </button>
      </div>`
    return
  }

  // Colors for packages
  const PKG_COLORS = [
    { bg:'#eff6ff', border:'#3b82f6', text:'#1d4ed8', icon:'fa-building' },
    { bg:'#fdf4ff', border:'#a855f7', text:'#7e22ce', icon:'fa-drafting-compass' },
    { bg:'#fff7ed', border:'#f97316', text:'#c2410c', icon:'fa-hard-hat' },
    { bg:'#f0fdf4', border:'#22c55e', text:'#15803d', icon:'fa-check-double' },
    { bg:'#fefce8', border:'#eab308', text:'#a16207', icon:'fa-star' },
  ]

  let html = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
    <div style="font-size:13px;color:#64748b;font-weight:500">
      <i class="fas fa-layer-group mr-1 text-indigo-500"></i>
      ${packages.length} gói thầu · ${packages.reduce((a,p)=>a+(p.stages||[]).length,0)} giai đoạn
    </div>
    <div style="display:flex;gap:6px">
      <button onclick="collapseAllPackages()" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#64748b;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:4px 12px;cursor:pointer">
        <i class="fas fa-compress-alt" style="font-size:10px"></i> Thu gọn
      </button>
      <button onclick="expandAllPackages()" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#6366f1;background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px;padding:4px 12px;cursor:pointer">
        <i class="fas fa-expand-alt" style="font-size:10px"></i> Mở rộng
      </button>
      <button onclick="openAddPackageModal()" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#10b981;background:#f0fdf4;border:1.5px solid #6ee7b7;border-radius:6px;padding:4px 12px;cursor:pointer">
        <i class="fas fa-plus" style="font-size:10px"></i> Thêm gói thầu
      </button>
    </div>
  </div>`

  packages.forEach((pkg, pkgIdx) => {
    const pc = PKG_COLORS[pkgIdx % PKG_COLORS.length]
    const stages = pkg.stages || []
    const isOpen = _pkgCollapseState[pkg.id] !== false
    const pkgBodyId = `pkgBody_${pkg.id}`
    const pkgChevId = `pkgChev_${pkg.id}`

    // Compute package totals
    let pkgTotal = 0, pkgDone = 0
    stages.forEach(s => {
      ;(s.items || []).forEach(it => {
        pkgTotal++; if (it.status === 'completed') pkgDone++
        ;(it.children||[]).forEach(ch => {
          pkgTotal++; if (ch.status === 'completed') pkgDone++
        })
      })
    })
    const pkgPct = pkgTotal > 0 ? Math.round(pkgDone/pkgTotal*100) : 0
    const pkgBarCol = pkgPct === 100 ? '#10b981' : pkgPct >= 50 ? '#6366f1' : pc.border

    html += `
    <!-- ═══════ PACKAGE CARD ═══════ -->
    <div class="mb-5" style="border-radius:14px;border:2px solid ${pc.border}55;background:#fff;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">

      <!-- Package Header -->
      <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;background:${pc.bg};cursor:pointer;user-select:none;border-bottom:2px solid ${pc.border}33"
           onclick="togglePackageCollapse(${pkg.id})">

        <div style="width:44px;height:44px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;background:${pc.border};box-shadow:0 2px 6px ${pc.border}55">
          <i class="fas ${pc.icon}"></i>
        </div>

        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:800;color:${pc.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pkg.name}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:5px;flex-wrap:wrap">
            <div style="width:140px;height:6px;background:#e5e7eb;border-radius:10px;overflow:hidden">
              <div style="width:${pkgPct}%;height:100%;background:${pkgBarCol};border-radius:10px;transition:width .4s"></div>
            </div>
            <span style="font-size:12px;font-weight:700;color:${pkgBarCol}">${pkgPct}%</span>
            <span style="font-size:11px;color:#9ca3af">${pkgDone}/${pkgTotal} hạng mục</span>
            <span style="font-size:11px;color:#64748b;background:#f1f5f9;padding:1px 8px;border-radius:8px;border:1px solid #e2e8f0">
              <i class="fas fa-layer-group mr-1" style="font-size:9px"></i>${stages.length} giai đoạn A–D
            </span>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0" onclick="event.stopPropagation()">
          <button onclick="openRenamePackageModal(${pkg.id}, '${pkg.name.replace(/'/g,'\\&apos;')}')"
            style="width:30px;height:30px;border-radius:7px;border:1px solid ${pc.border}66;background:#fff;color:${pc.text};cursor:pointer;display:flex;align-items:center;justify-content:center" title="Đổi tên gói thầu">
            <i class="fas fa-pen" style="font-size:10px"></i>
          </button>
          <button onclick="confirmDeletePackage(${pkg.id}, '${pkg.name.replace(/'/g,'\\&apos;')}', ${pkgTotal})"
            style="width:30px;height:30px;border-radius:7px;border:1px solid #fecaca;background:#fef2f2;color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Xóa gói thầu">
            <i class="fas fa-trash" style="font-size:10px"></i>
          </button>
          <button id="${pkgChevId}" onclick="event.stopPropagation();togglePackageCollapse(${pkg.id})"
            style="width:32px;height:32px;border-radius:8px;border:1px solid ${pc.border}44;background:#fff;color:${pc.text};cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s">
            <i id="${pkgChevId}_icon" class="fas fa-chevron-up" style="font-size:11px;transition:transform .25s;transform:rotate(${isOpen?'0':'180'}deg)"></i>
          </button>
        </div>
      </div>

      <!-- Package Body (stages) -->
      <div id="${pkgBodyId}" style="display:${isOpen?'block':'none'};padding:12px 16px 16px">
        ${stages.length === 0 ? `<div style="text-align:center;padding:20px;color:#9ca3af;font-size:13px">Gói thầu chưa có giai đoạn nào</div>` : ''}
        ${stages.map(stage => renderPackageStageCard(stage, pc)).join('')}

        <!-- Add stage within package -->
        <div style="display:flex;justify-content:center;margin-top:10px">
          <button onclick="openAddStageInPackageModal(${pkg.id})"
            style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#6366f1;background:#eef2ff;border:1.5px dashed #a5b4fc;border-radius:8px;padding:6px 18px;cursor:pointer;width:100%;justify-content:center">
            <i class="fas fa-plus-circle" style="font-size:11px"></i> Thêm giai đoạn vào gói này
          </button>
        </div>
      </div>
    </div>`
  })

  // Add package button at bottom
  html += `
  <div style="display:flex;justify-content:center;margin-top:4px">
    <button onclick="openAddPackageModal()"
      style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#10b981;background:#f0fdf4;border:1.5px dashed #6ee7b7;border-radius:8px;padding:8px 24px;cursor:pointer;width:100%;justify-content:center">
      <i class="fas fa-plus-circle" style="font-size:12px"></i> Thêm gói thầu mới (BCNCKT / TKBVTC / Thi công & Hoàn công…)
    </button>
  </div>`

  container.innerHTML = html
}

// ── Render a single stage card INSIDE a package ───────────────────────────────
function renderPackageStageCard(stage, pkgColor) {
  const sc = STAGE_COLORS[stage.code] || { bg:'#f9fafb', border:'#6b7280', text:'#374151', icon:'fa-folder' }
  const totalInStage = stage.items.reduce((a, it) => a + 1 + (it.children?.length||0), 0)
  const doneInStage  = stage.items.reduce((a, it) => {
    let d = it.status === 'completed' ? 1 : 0
    d += (it.children||[]).filter(c => c.status === 'completed').length
    return a + d
  }, 0)
  const pct    = totalInStage > 0 ? Math.round(doneInStage/totalInStage*100) : 0
  const barCol = pct === 100 ? '#10b981' : pct >= 50 ? '#3b82f6' : sc.border
  const isOpen = _stageCollapseState[stage.id] !== false
  const bodyId = `stageBody_${stage.id}`
  const chevId = `stageChev_${stage.id}`

  let html = `
  <div class="mb-3" style="border-radius:10px;border:1px solid ${sc.border}44;background:#fafafa;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04)">

    <!-- Stage Header -->
    <div onclick="toggleStageCollapse(${stage.id})"
      style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:${isOpen?sc.bg:'#f9fafb'};cursor:pointer;user-select:none;border-left:4px solid ${sc.border};transition:background .2s">

      <div style="width:34px;height:34px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#fff;background:${sc.border}">
        ${stage.code}
      </div>

      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${stage.name}</div>
        <div style="display:flex;align-items:center;gap:7px;margin-top:3px">
          <div style="width:100px;height:4px;background:#e5e7eb;border-radius:10px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${barCol};border-radius:10px"></div>
          </div>
          <span style="font-size:10px;font-weight:700;color:${barCol}">${pct}%</span>
          <span style="font-size:10px;color:#9ca3af">${doneInStage}/${totalInStage}</span>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:5px;flex-shrink:0" onclick="event.stopPropagation()">
        <button onclick="openAddLegalItem(${stage.id}, null, ${_legalCurrentProjectId})"
          style="display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:#6366f1;background:#eef2ff;border:1px solid #c7d2fe;border-radius:5px;padding:3px 9px;cursor:pointer" title="Thêm hạng mục">
          <i class="fas fa-plus" style="font-size:9px"></i> Thêm
        </button>
        <button onclick="openRenameStageModal(${stage.id}, '${stage.name.replace(/'/g,'\\&apos;')}')"
          style="width:28px;height:28px;border-radius:6px;border:1px solid #e5e7eb;background:#fff;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Đổi tên">
          <i class="fas fa-pen" style="font-size:9px"></i>
        </button>
        <button onclick="confirmDeleteStage(${stage.id}, '${stage.name.replace(/'/g,'\\&apos;')}', ${totalInStage})"
          style="width:28px;height:28px;border-radius:6px;border:1px solid #fecaca;background:#fef2f2;color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Xóa giai đoạn">
          <i class="fas fa-trash" style="font-size:9px"></i>
        </button>
        <button id="${chevId}" onclick="event.stopPropagation();toggleStageCollapse(${stage.id})"
          style="width:28px;height:28px;border-radius:6px;border:1px solid #e5e7eb;background:${isOpen?'#eef2ff':'#f9fafb'};color:${isOpen?'#6366f1':'#9ca3af'};cursor:pointer;display:flex;align-items:center;justify-content:center">
          <i id="${chevId}_icon" class="fas fa-chevron-up" style="font-size:10px;transform:rotate(${isOpen?'0':'180'}deg);transition:transform .25s"></i>
        </button>
      </div>
    </div>

    <!-- Stage Items Table -->
    <div id="${bodyId}" style="display:${isOpen?'block':'none'}">
      ${totalInStage === 0 ? `<div style="text-align:center;padding:12px;color:#9ca3af;font-size:12px"><i class="fas fa-inbox mr-1"></i>Chưa có hạng mục</div>` : `
      <table class="w-full" style="font-size:13px">
        <thead>
          <tr style="background:${sc.bg}">
            <th class="py-2 px-3 text-left font-semibold text-gray-600" style="width:70px">STT</th>
            <th class="py-2 px-3 text-left font-semibold text-gray-600">Hạng mục công việc</th>
            <th class="py-2 px-3 text-center font-semibold text-gray-600" style="width:110px">Hạn</th>
            <th class="py-2 px-3 text-center font-semibold text-gray-600" style="width:110px">Trạng thái</th>
            <th class="py-2 px-3 text-left font-semibold text-gray-600" style="width:160px">Ghi chú</th>
            <th class="py-2 px-3 text-center font-semibold text-gray-600" style="width:160px">Thao tác</th>
          </tr>
        </thead>
        <tbody>`}
  `

  if (totalInStage > 0) {
    stage.items.forEach(item => {
      const rowBg = item.status === 'completed' ? '#f0fdf4' : (item.status === 'in_progress' ? '#eff6ff' : '#fff')
      html += renderLegalItemRow(item, sc, rowBg, false, stage.id)
      ;(item.children || []).forEach(child => {
        html += renderLegalItemRow(child, sc, rowBg, true, stage.id)
      })
    })
    html += `</tbody></table>`
  }

  html += `
      <div style="padding:7px 14px;border-top:1px solid #f3f4f6;display:flex;justify-content:flex-end">
        <button onclick="openAddLegalItem(${stage.id}, null, ${_legalCurrentProjectId})"
          style="font-size:11px;color:#6366f1;background:none;border:none;cursor:pointer;display:inline-flex;align-items:center;gap:3px">
          <i class="fas fa-plus-circle" style="font-size:10px"></i> Thêm hạng mục
        </button>
      </div>
    </div>
  </div>`

  return html
}

// ── Toggle Package collapse ───────────────────────────────────────────────────
function togglePackageCollapse(pkgId) {
  const body = document.getElementById(`pkgBody_${pkgId}`)
  const chevIcon = document.getElementById(`pkgChev_${pkgId}_icon`)
  if (!body) return
  const isOpen = body.style.display !== 'none'
  body.style.display = isOpen ? 'none' : 'block'
  _pkgCollapseState[pkgId] = !isOpen
  if (chevIcon) chevIcon.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)'
}

function collapseAllPackages() {
  document.querySelectorAll('[id^="pkgBody_"]').forEach(body => {
    const id = body.id.replace('pkgBody_', '')
    if (body.style.display !== 'none') togglePackageCollapse(id)
  })
}
function expandAllPackages() {
  document.querySelectorAll('[id^="pkgBody_"]').forEach(body => {
    const id = body.id.replace('pkgBody_', '')
    if (body.style.display === 'none') togglePackageCollapse(id)
  })
}

// ── Package Management ────────────────────────────────────────────────────────

// Package type options
const PACKAGE_TYPE_OPTIONS = [
  { value: 'bcnckt',       label: 'Gói BCNCKT (Báo cáo nghiên cứu khả thi)' },
  { value: 'tkbvtc',       label: 'Gói TKBVTC (Thiết kế bản vẽ thi công)' },
  { value: 'construction', label: 'Gói Thi công & Hoàn công' },
  { value: 'custom',       label: 'Gói tùy chỉnh (nhập tên riêng)' },
]

function openAddPackageModal() {
  const typeOpts = PACKAGE_TYPE_OPTIONS.map(o =>
    `<option value="${o.value}">${o.label}</option>`
  ).join('')

  const modalHtml = `
  <div id="addPkgModal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px">
    <div style="background:#fff;border-radius:16px;width:100%;max-width:480px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden">
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:20px 24px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:16px;font-weight:700;color:#fff"><i class="fas fa-folder-plus mr-2"></i>Thêm gói thầu</div>
          <div style="font-size:12px;color:#e0e7ff;margin-top:2px">Mỗi gói thầu sẽ có 4 giai đoạn A–B–C–D tự động</div>
        </div>
        <button onclick="document.getElementById('addPkgModal').remove()" style="color:#e0e7ff;background:none;border:none;cursor:pointer;font-size:18px">&times;</button>
      </div>
      <div style="padding:24px">
        <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">Loại gói thầu</label>
        <select id="addPkgType" onchange="onAddPkgTypeChange()" style="width:100%;padding:8px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:13px;margin-bottom:14px">
          ${typeOpts}
        </select>

        <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">Tên gói thầu</label>
        <input id="addPkgName" type="text" placeholder="VD: Gói BCNCKT dự án..." value="${PACKAGE_TYPE_OPTIONS[0].label}"
          style="width:100%;padding:9px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:13px;margin-bottom:6px">
        <div style="font-size:11px;color:#6b7280;margin-bottom:18px">
          <i class="fas fa-info-circle mr-1 text-blue-400"></i>
          Hệ thống sẽ tự động tạo 4 giai đoạn: A. Chuẩn bị & Dự thầu · B. Ký hợp đồng · C. Thực hiện & Sản phẩm BIM · D. Nghiệm thu & Thanh toán
        </div>

        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button onclick="document.getElementById('addPkgModal').remove()"
            style="padding:9px 20px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;font-size:13px;cursor:pointer">
            Hủy
          </button>
          <button onclick="submitAddPackage()"
            style="padding:9px 20px;border:none;border-radius:8px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:13px;font-weight:600;cursor:pointer">
            <i class="fas fa-plus mr-1"></i> Tạo gói thầu
          </button>
        </div>
      </div>
    </div>
  </div>`
  document.body.insertAdjacentHTML('beforeend', modalHtml)
}

function onAddPkgTypeChange() {
  const sel = document.getElementById('addPkgType')
  const inp = document.getElementById('addPkgName')
  const opt = PACKAGE_TYPE_OPTIONS.find(o => o.value === sel.value)
  if (opt && sel.value !== 'custom') {
    inp.value = opt.label
  } else {
    inp.value = ''
    inp.focus()
  }
}

async function submitAddPackage() {
  const type = document.getElementById('addPkgType')?.value || 'custom'
  const name = document.getElementById('addPkgName')?.value?.trim()
  if (!name) { toast('Vui lòng nhập tên gói thầu', 'warning'); return }
  try {
    const res = await api(`/legal/${_legalCurrentProjectId}/packages`, {
      method: 'POST', data: { name, package_type: type }
    })
    document.getElementById('addPkgModal')?.remove()
    toast(`Đã tạo gói thầu "${name}" với 4 giai đoạn A–D`, 'success', 4000)
    loadLegalProject(_legalCurrentProjectId)
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}

function openRenamePackageModal(pkgId, currentName) {
  const newName = prompt('Đổi tên gói thầu:', currentName)
  if (!newName || !newName.trim() || newName.trim() === currentName) return
  api(`/legal/packages/${pkgId}`, { method: 'PUT', data: { name: newName.trim() } })
    .then(() => {
      toast('Đã đổi tên gói thầu', 'success')
      loadLegalProject(_legalCurrentProjectId)
    })
    .catch(err => toast('Lỗi: ' + err.message, 'error'))
}

async function confirmDeletePackage(pkgId, pkgName, itemCount) {
  const hasItems = itemCount > 0
  const msg = hasItems
    ? `Xóa gói thầu "${pkgName}"?\n\n⚠️ Gói này còn ${itemCount} hạng mục — tất cả sẽ bị xóa vĩnh viễn cùng với 4 giai đoạn A–D.\n\nHành động này KHÔNG THỂ hoàn tác.`
    : `Xóa gói thầu "${pkgName}"?\nTất cả 4 giai đoạn A–D trong gói sẽ bị xóa.\nHành động này không thể hoàn tác.`
  if (!confirm(msg)) return
  try {
    await api(`/legal/packages/${pkgId}`, { method: 'DELETE' })
    toast(`Đã xóa gói thầu "${pkgName}"`, 'success')
    loadLegalProject(_legalCurrentProjectId)
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}

function openAddStageInPackageModal(pkgId) {
  const newName = prompt('Tên giai đoạn mới trong gói thầu này:\n(Tên sẽ được tùy chỉnh, code A–D–E–… tự động)')
  if (!newName || !newName.trim()) return
  api(`/legal/${_legalCurrentProjectId}/stages`, {
    method: 'POST',
    data: { name: newName.trim(), package_id: pkgId }
  })
    .then(res => {
      toast(`Đã thêm giai đoạn [${res.code}]: ${res.name}`, 'success', 4000)
      loadLegalProject(_legalCurrentProjectId)
    })
    .catch(err => toast('Lỗi: ' + err.message, 'error'))
}

// ── Render Stages Table ──────────────────────────────────────────────────────
// Lưu trạng thái collapse từng giai đoạn (mặc định mở)
const _stageCollapseState = {}

function renderLegalStages(stages) {
  const container = $('legalStagesContainer')
  if (!stages || stages.length === 0) {
    container.innerHTML = '<div class="card text-center py-8 text-gray-400">Chưa có dữ liệu</div>'
    return
  }

  let html = ''
  stages.forEach(stage => {
    const sc = STAGE_COLORS[stage.code] || { bg:'#f9fafb', border:'#6b7280', text:'#374151', icon:'fa-folder' }
    const totalInStage = stage.items.reduce((a, it) => a + 1 + (it.children?.length||0), 0)
    const doneInStage  = stage.items.reduce((a, it) => {
      let d = it.status === 'completed' ? 1 : 0
      d += (it.children||[]).filter(c => c.status === 'completed').length
      return a + d
    }, 0)
    const pct      = totalInStage > 0 ? Math.round(doneInStage/totalInStage*100) : 0
    const barCol   = pct === 100 ? '#10b981' : pct >= 50 ? '#3b82f6' : sc.border
    const isOpen   = _stageCollapseState[stage.id] !== false   // mặc định mở
    const bodyId   = `stageBody_${stage.id}`
    const chevId   = `stageChev_${stage.id}`

    // Badge tóm tắt khi thu gọn
    const pendingCount    = totalInStage - doneInStage
    const inProgressCount = stage.items.reduce((a,it) => {
      let c = it.status === 'in_progress' ? 1 : 0
      c += (it.children||[]).filter(ch => ch.status === 'in_progress').length
      return a + c
    }, 0)

    html += `
    <div class="mb-4" style="border-radius:12px;border:1px solid ${isOpen?sc.border+'55':'#e5e7eb'};background:#fff;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);transition:border-color .2s">

      <!-- ══ HEADER (click to collapse) ══ -->
      <div onclick="toggleStageCollapse(${stage.id})"
        style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:${isOpen ? sc.bg : '#f9fafb'};cursor:pointer;user-select:none;border-left:4px solid ${sc.border};transition:background .2s">

        <!-- Stage badge -->
        <div style="width:38px;height:38px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800;color:#fff;background:${sc.border}">
          ${stage.code}
        </div>

        <!-- Name + progress -->
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${stage.name}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
            <div style="width:120px;height:5px;background:#e5e7eb;border-radius:10px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:${barCol};border-radius:10px;transition:width .4s"></div>
            </div>
            <span style="font-size:11px;font-weight:700;color:${barCol}">${pct}%</span>
            <span style="font-size:11px;color:#9ca3af">${doneInStage}/${totalInStage} hoàn thành</span>
            ${!isOpen && inProgressCount > 0 ? `<span style="font-size:10px;font-weight:600;color:#2563eb;background:#dbeafe;padding:1px 7px;border-radius:10px">${inProgressCount} đang làm</span>` : ''}
            ${!isOpen && pendingCount > 0 && pendingCount < totalInStage ? `<span style="font-size:10px;font-weight:600;color:#64748b;background:#f1f5f9;padding:1px 7px;border-radius:10px">${pendingCount} còn lại</span>` : ''}
          </div>
        </div>

        <!-- Right controls -->
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0" onclick="event.stopPropagation()">
          <button onclick="openAddLegalItem(${stage.id}, null, ${_legalCurrentProjectId})"
            style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#6366f1;background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px;padding:4px 10px;cursor:pointer" title="Thêm hạng mục">
            <i class="fas fa-plus" style="font-size:9px"></i> Thêm
          </button>
          <button onclick="openRenameStageModal(${stage.id}, '${stage.name.replace(/'/g,'\\&apos;')}')"
            style="width:30px;height:30px;border-radius:6px;border:1px solid #e5e7eb;background:#f9fafb;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="Đổi tên giai đoạn">
            <i class="fas fa-pen" style="font-size:10px"></i>
          </button>
          <button onclick="confirmDeleteStage(${stage.id}, '${stage.name.replace(/'/g,'\\&apos;')}', ${totalInStage})"
            style="width:30px;height:30px;border-radius:6px;border:1px solid #fecaca;background:#fef2f2;color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="Xóa giai đoạn">
            <i class="fas fa-trash" style="font-size:10px"></i>
          </button>
          <!-- Chevron collapse -->
          <button id="${chevId}" onclick="event.stopPropagation();toggleStageCollapse(${stage.id})"
            style="width:32px;height:32px;border-radius:8px;border:1px solid #e5e7eb;background:${isOpen?'#eef2ff':'#f9fafb'};color:${isOpen?'#6366f1':'#9ca3af'};cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s" title="${isOpen?'Thu gọn':'Mở rộng'}">
            <i id="${chevId}_icon" class="fas fa-chevron-up" style="font-size:11px;transition:transform .25s;transform:rotate(${isOpen?'0':'180'}deg)"></i>
          </button>
        </div>
      </div>

      <!-- ══ BODY (collapsible) ══ -->
      <div id="${bodyId}" style="display:${isOpen?'block':'none'}">
        <table class="w-full" style="font-size:13px">
          <thead>
            <tr style="background:${sc.bg}">
              <th class="py-2 px-3 text-left font-semibold text-gray-600" style="width:70px">STT</th>
              <th class="py-2 px-3 text-left font-semibold text-gray-600">Hạng mục công việc</th>
              <th class="py-2 px-3 text-center font-semibold text-gray-600" style="width:110px">Hạn</th>
              <th class="py-2 px-3 text-center font-semibold text-gray-600" style="width:110px">Trạng thái</th>
              <th class="py-2 px-3 text-left font-semibold text-gray-600" style="width:180px">Ghi chú</th>
              <th class="py-2 px-3 text-center font-semibold text-gray-600" style="width:160px">Thao tác</th>
            </tr>
          </thead>
          <tbody>`

    stage.items.forEach(item => {
      const rowBg = item.status === 'completed' ? '#f0fdf4' : (item.status === 'in_progress' ? '#eff6ff' : '#fff')
      html += renderLegalItemRow(item, sc, rowBg, false, stage.id)
      ;(item.children || []).forEach(child => {
        html += renderLegalItemRow(child, sc, rowBg, true, stage.id)
      })
    })

    html += `
          </tbody>
        </table>
        <div style="padding:8px 16px;border-top:1px solid #f3f4f6;display:flex;justify-content:flex-end">
          <button onclick="openAddLegalItem(${stage.id}, null, ${_legalCurrentProjectId})"
            style="font-size:12px;color:#6366f1;background:none;border:none;cursor:pointer;display:inline-flex;align-items:center;gap:4px">
            <i class="fas fa-plus-circle" style="font-size:11px"></i> Thêm hạng mục vào giai đoạn này
          </button>
        </div>
      </div><!-- /body -->
    </div><!-- /stage card -->`
  })

  // Nút Để thêm giai đoạn mới
  html += `
  <div style="display:flex;justify-content:center;margin-top:8px">
    <button onclick="openAddStageModal()"
      style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#10b981;background:#f0fdf4;border:1.5px dashed #6ee7b7;border-radius:8px;padding:7px 20px;cursor:pointer;width:100%;justify-content:center">
      <i class="fas fa-plus-circle" style="font-size:12px"></i> Thêm giai đoạn hồ sơ mới
    </button>
  </div>`

  // Nút expand/collapse tất cả
  html = `
  <div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:10px">
    <button onclick="collapseAllStages()"
      style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#64748b;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:4px 12px;cursor:pointer">
      <i class="fas fa-compress-alt" style="font-size:10px"></i> Thu gọn tất cả
    </button>
    <button onclick="expandAllStages()"
      style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#6366f1;background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px;padding:4px 12px;cursor:pointer">
      <i class="fas fa-expand-alt" style="font-size:10px"></i> Mở rộng tất cả
    </button>
  </div>` + html

  container.innerHTML = html
}

// ── Toggle một giai đoạn ──────────────────────────────────────────────────────
function toggleStageCollapse(stageId) {
  const bodyId  = `stageBody_${stageId}`
  const chevId  = `stageChev_${stageId}`
  const body     = document.getElementById(bodyId)
  const chevBtn  = document.getElementById(chevId)
  const chevIcon = document.getElementById(`${chevId}_icon`)
  if (!body) return

  const isOpen = body.style.display !== 'none'
  if (isOpen) {
    body.style.display = 'none'
    _stageCollapseState[stageId] = false
    if (chevIcon) chevIcon.style.transform = 'rotate(180deg)'
    if (chevBtn)  { chevBtn.style.background = '#f9fafb'; chevBtn.style.color = '#9ca3af'; chevBtn.title = 'Mở rộng' }
    const header = body.previousElementSibling
    if (header) header.style.background = '#f9fafb'
  } else {
    body.style.display = 'block'
    _stageCollapseState[stageId] = true
    if (chevIcon) chevIcon.style.transform = 'rotate(0deg)'
    if (chevBtn)  { chevBtn.style.background = '#eef2ff'; chevBtn.style.color = '#6366f1'; chevBtn.title = 'Thu gọn' }
    const header = body.previousElementSibling
    if (header) header.style.background = ''  // reset về màu stage
  }
}

// ── Thu gọn/mở rộng tất cả ───────────────────────────────────────────────────
function collapseAllStages() {
  document.querySelectorAll('[id^="stageBody_"]').forEach(body => {
    const stageId = body.id.replace('stageBody_', '')
    if (body.style.display !== 'none') toggleStageCollapse(stageId)
  })
}
function expandAllStages() {
  document.querySelectorAll('[id^="stageBody_"]').forEach(body => {
    const stageId = body.id.replace('stageBody_', '')
    if (body.style.display === 'none') toggleStageCollapse(stageId)
  })
}

// ── Stage Management (Rename / Add / Delete) ─────────────────────────────────

function openRenameStageModal(stageId, currentName) {
  const newName = prompt('Đổi tên giai đoạn hồ sơ:', currentName)
  if (!newName || !newName.trim() || newName.trim() === currentName) return
  api(`/legal/stages/${stageId}`, { method: 'PUT', data: { name: newName.trim() } })
    .then(() => {
      toast('Đã đổi tên giai đoạn', 'success')
      loadLegalProject(_legalCurrentProjectId)
    })
    .catch(err => toast('Lỗi: ' + err.message, 'error'))
}

async function confirmDeleteStage(stageId, stageName, itemCount) {
  const hasItems = itemCount > 0
  const msg = hasItems
    ? `Xóa giai đoạn "${stageName}"?\n\n⚠️ Giai đoạn này còn ${itemCount} hạng mục — tất cả sẽ bị xóa vĩnh viễn.\n\nHành động này KHÔNG THỂ hoàn tác.`
    : `Xóa giai đoạn "${stageName}"?\nHành động này không thể hoàn tác.`
  if (!confirm(msg)) return
  try {
    const res = await api(`/legal/stages/${stageId}`, { method: 'DELETE' })
    const deletedMsg = res?.deleted_items > 0 ? ` (đã xóa ${res.deleted_items} hạng mục)` : ''
    toast(`Đã xóa giai đoạn${deletedMsg}`, 'success')
    loadLegalProject(_legalCurrentProjectId)
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}

function openAddStageModal() {
  const newName = prompt('Tên giai đoạn hồ sơ mới:\n(VD: Hồ sơ GĐTK + Thi công, Hồ sơ Thi công & Hoàn công...)')
  if (!newName || !newName.trim()) return
  api(`/legal/${_legalCurrentProjectId}/stages`, { method: 'POST', data: { name: newName.trim() } })
    .then(res => {
      toast(`Đã thêm giai đoạn [${res.code}]: ${res.name}`, 'success', 4000)
      loadLegalProject(_legalCurrentProjectId)
    })
    .catch(err => toast('Lỗi: ' + err.message, 'error'))
}

function renderLegalItemRow(item, sc, rowBg, isChild, stageId) {
  const statusBadge = `<span class="badge ${LEGAL_STATUS_COLORS[item.status]||'badge-todo'}">${LEGAL_STATUS_LABELS[item.status]||item.status}</span>`
  const checkIcon = item.status === 'completed'
    ? `<i class="fas fa-check-circle text-green-500 mr-1"></i>`
    : (item.item_type === 'document' ? `<i class="fas fa-file-alt text-blue-400 mr-1"></i>` : `<i class="fas fa-tasks text-gray-400 mr-1"></i>`)

  // STT styling: parent = bold, child = thụt lề + màu xám
  const sttDisplay = item.stt || ''
  const sttCellStyle = isChild
    ? 'color:#6b7280; padding-left:28px; font-size:12px;'
    : 'font-weight:700; color:#374151;'
  const titleIndent = isChild ? 'pl-7' : 'font-semibold'

  // Hạn + Trạng thái + Ghi chú: luôn hiển thị cho cả parent & child
  const dueDateCell = item.due_date
    ? `<span class="text-xs ${new Date(item.due_date) < new Date() && item.status !== 'completed' ? 'text-red-500 font-medium' : 'text-gray-500'}">${fmtDate(item.due_date)}</span>`
    : `<span class="text-gray-300 text-xs">—</span>`

  return `
  <tr style="background:${item.status==='completed'?'#f0fdf4':isChild?'#fafafa':'#fff'};border-bottom:1px solid #f3f4f6" class="table-row">
    <td class="py-2 px-3 text-xs" style="${sttCellStyle}">
      <div class="flex items-center gap-1">
        <span>${sttDisplay}</span>
        <div class="flex flex-col opacity-0 group-hover:opacity-100" style="line-height:1">
          <button onclick="reorderLegalItem(${item.id},'up')" class="text-gray-300 hover:text-gray-600 leading-none" title="Lên" style="font-size:9px;padding:0"><i class="fas fa-caret-up"></i></button>
          <button onclick="reorderLegalItem(${item.id},'down')" class="text-gray-300 hover:text-gray-600 leading-none" title="Xuống" style="font-size:9px;padding:0"><i class="fas fa-caret-down"></i></button>
        </div>
      </div>
    </td>
    <td class="py-2 px-3 ${titleIndent}">
      <div class="flex items-center gap-2">
        ${checkIcon}
        <span class="${isChild ? 'text-sm text-gray-700' : 'text-gray-800'}">${item.title}</span>
      </div>
    </td>
    <td class="py-2 px-3 text-center">${dueDateCell}</td>
    <td class="py-2 px-3 text-center">${statusBadge}</td>
    <td class="py-2 px-3 text-xs text-gray-500">${item.notes ? `<span title="${item.notes}">${item.notes.length > 40 ? item.notes.substring(0,40)+'…' : item.notes}</span>` : '<span class="text-gray-300">—</span>'}</td>
    <td class="py-2 px-3 text-center">
      <div class="flex items-center justify-center gap-1 flex-wrap">
        <button onclick="reorderLegalItem(${item.id},'up')" class="text-gray-400 hover:text-gray-600 p-1" title="Lên"><i class="fas fa-arrow-up text-xs"></i></button>
        <button onclick="reorderLegalItem(${item.id},'down')" class="text-gray-400 hover:text-gray-600 p-1" title="Xuống"><i class="fas fa-arrow-down text-xs"></i></button>
        ${!isChild ? `<button onclick="openAddLegalItem(${stageId}, ${item.id}, ${_legalCurrentProjectId})" class="text-blue-500 hover:text-blue-700 p-1" title="Thêm sub-hạng mục"><i class="fas fa-indent text-xs"></i></button>` : ''}
        <button onclick="openEditLegalItem(${JSON.stringify(item).replace(/"/g,'&quot;')})" class="text-primary hover:text-green-700 p-1" title="Sửa"><i class="fas fa-edit text-xs"></i></button>
        <button onclick="deleteLegalItem(${item.id})" class="text-red-400 hover:text-red-600 p-1" title="Xóa"><i class="fas fa-trash text-xs"></i></button>
        <button id="taskToggleBtn_${item.id}" onclick="toggleLegalItemTasks(${item.id}, this)"
          style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:600;color:#6366f1;background:#eef2ff;border:1px solid #c7d2fe;border-radius:5px;padding:3px 7px;cursor:pointer"
          title="Xem / Quản lý tasks">
          <i class="fas fa-layer-group" style="font-size:9px"></i> Tasks
        </button>
      </div>
    </td>
  </tr>
  <tr id="legalTaskPanelRow_${item.id}" style="display:table-row">
    <td colspan="6" style="padding:0;border-bottom:1px solid #eef0f3">
      <div id="legalTaskPanel_${item.id}" style="display:none" data-is-child="${isChild?1:0}"></div>
    </td>
  </tr>`
}

// ── Render Letters Table ─────────────────────────────────────────────────────
function renderLegalLetters(letters) {
  const container = $('legalLettersTable')
  if (!letters || letters.length === 0) {
    container.innerHTML = '<div class="text-center py-8 text-gray-400"><i class="fas fa-paper-plane text-3xl mb-3 opacity-30"></i><p>Chưa có văn bản gửi đi</p></div>'
    return
  }
  const letterTypeColors = {
    cv:'#0066CC', bc:'#0891b2', bb:'#059669', tb:'#7c3aed',
    qd:'#dc2626', tt:'#ea580c', kh:'#16a34a', yc:'#ca8a04',
    pl:'#9333ea', contract:'#3b82f6', appendix:'#a855f7',
    acceptance:'#22c55e', payment:'#f97316', other:'#6b7280'
  }
  let html = `<div class="overflow-x-auto">
  <table class="w-full" style="font-size:13px">
    <thead><tr class="bg-gray-50">
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">Số văn bản</th>
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">Loại</th>
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">Trích yếu</th>
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">Hạng mục</th>
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">Người nhận</th>
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">Ngày gửi</th>
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">Ghi chú</th>
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">Trạng thái</th>
      <th class="py-2 px-3 text-center text-xs font-semibold text-gray-500 uppercase">Thao tác</th>
    </tr></thead>
    <tbody>`

  letters.forEach(l => {
    const statusBadge = `<span class="badge ${LEGAL_LETTER_STATUS_COLORS[l.status]||'badge-todo'}">${LEGAL_LETTER_STATUS_LABELS[l.status]||l.status}</span>`
    const ltColor = letterTypeColors[l.letter_type] || '#6b7280'
    const ltLabel = LEGAL_DOC_TYPE_LABELS[l.letter_type] || 'Công văn (CV)'
    html += `<tr class="table-row border-b border-gray-100">
      <td class="py-2 px-3">
        <span class="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-1 rounded">${l.letter_number}</span>
      </td>
      <td class="py-2 px-3">
        <span class="badge" style="background:${ltColor}22;color:${ltColor}">${ltLabel}</span>
      </td>
      <td class="py-2 px-3 font-medium text-gray-800 max-w-xs">${l.subject}</td>
      <td class="py-2 px-3 text-xs text-gray-500">${l.item_title
        ? `<div style="line-height:1.5">
            ${l.package_name ? `<span style="font-size:10px;color:#6366f1;font-weight:600;background:#eef2ff;padding:1px 6px;border-radius:4px;display:inline-block;margin-bottom:2px">📦 ${l.package_name}</span>` : ''}
            ${l.stage_code ? `<span style="font-size:10px;color:#64748b;background:#f1f5f9;padding:1px 5px;border-radius:4px;margin-left:2px">[${l.stage_code}]</span><br>` : ''}
            <span>${l.item_title}</span>
           </div>`
        : '<span class="text-gray-300">—</span>'}</td>
      <td class="py-2 px-3 text-xs text-gray-500">${l.recipient||'-'}</td>
      <td class="py-2 px-3 text-xs text-gray-500">${l.sent_date ? fmtDate(l.sent_date) : '-'}</td>
      <td class="py-2 px-3 text-xs text-gray-500 max-w-xs">${l.notes
        ? `<span title="${l.notes.replace(/"/g,'&quot;')}" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.4;max-width:180px">${l.notes}</span>`
        : '<span class="text-gray-300">—</span>'}</td>
      <td class="py-2 px-3">${statusBadge}</td>
      <td class="py-2 px-3 text-center">
        <div class="flex items-center justify-center gap-1">
          <button onclick="openEditLegalLetter(${JSON.stringify(l).replace(/"/g,'&quot;')})" class="text-primary hover:text-green-700 p-1" title="Sửa"><i class="fas fa-edit text-xs"></i></button>
          <button onclick="deleteLegalLetter(${l.id})" class="text-red-400 hover:text-red-600 p-1" title="Xóa"><i class="fas fa-trash text-xs"></i></button>
        </div>
      </td>
    </tr>`
  })

  html += '</tbody></table></div>'
  container.innerHTML = html
}

// ── Render Documents Table ───────────────────────────────────────────────────
function renderLegalDocs(docs) {
  const container = $('legalDocsTable')
  if (!docs || docs.length === 0) {
    container.innerHTML = '<div class="text-center py-8 text-gray-400"><i class="fas fa-paperclip text-3xl mb-3 opacity-30"></i><p>Chưa có tài liệu đính kèm</p></div>'
    return
  }
  const docTypeColors = {
    contract:   '#3b82f6',
    appendix:   '#a855f7',
    acceptance: '#22c55e',
    payment:    '#f97316',
    cv:         '#0066CC',
    bc:         '#0891b2',
    bb:         '#059669',
    tb:         '#7c3aed',
    qd:         '#dc2626',
    tt:         '#ea580c',
    kh:         '#16a34a',
    yc:         '#ca8a04',
    pl:         '#9333ea',
    other:      '#6b7280'
  }
  let html = `<div class="overflow-x-auto">
  <table class="w-full" style="font-size:13px">
    <thead><tr class="bg-gray-50">
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">Loại</th>
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">Tên tài liệu</th>
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">Hạng mục</th>
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">Ngày ký</th>
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">File / Link</th>
      <th class="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase">Ghi chú</th>
      <th class="py-2 px-3 text-center text-xs font-semibold text-gray-500 uppercase">Thao tác</th>
    </tr></thead>
    <tbody>`

  docs.forEach(d => {
    const color = docTypeColors[d.doc_type] || '#6b7280'
    const typeLabel = LEGAL_DOC_TYPE_LABELS[d.doc_type] || d.doc_type
    const fileLink = d.file_url
      ? `<a href="${d.file_url}" target="_blank" class="text-blue-600 hover:underline text-xs"><i class="fas fa-external-link-alt mr-1"></i>${d.file_name||'Xem'}</a>`
      : (d.file_name ? `<span class="text-gray-500 text-xs"><i class="fas fa-file mr-1"></i>${d.file_name}</span>` : '-')

    html += `<tr class="table-row border-b border-gray-100">
      <td class="py-2 px-3">
        <span class="badge" style="background:${color}22;color:${color}">${typeLabel}</span>
      </td>
      <td class="py-2 px-3 font-medium text-gray-800">${d.title}</td>
      <td class="py-2 px-3 text-xs text-gray-500">${d.item_title
        ? `<div style="line-height:1.5">
            ${d.package_name ? `<span style="font-size:10px;color:#6366f1;font-weight:600;background:#eef2ff;padding:1px 6px;border-radius:4px;display:inline-block;margin-bottom:2px">📦 ${d.package_name}</span>` : ''}
            ${d.stage_code ? `<span style="font-size:10px;color:#64748b;background:#f1f5f9;padding:1px 5px;border-radius:4px;margin-left:2px">[${d.stage_code}]</span><br>` : ''}
            <span>${d.item_title}</span>
           </div>`
        : '<span class="text-gray-300">—</span>'}</td>
      <td class="py-2 px-3 text-xs text-gray-500">${d.signed_date ? fmtDate(d.signed_date) : '-'}</td>
      <td class="py-2 px-3">${fileLink}</td>
      <td class="py-2 px-3 text-xs text-gray-400 max-w-xs truncate">${d.notes||'-'}</td>
      <td class="py-2 px-3 text-center">
        <div class="flex items-center justify-center gap-1">
          <button onclick="openEditLegalDoc(${JSON.stringify(d).replace(/"/g,'&quot;')})" class="text-primary hover:text-green-700 p-1" title="Sửa"><i class="fas fa-edit text-xs"></i></button>
          <button onclick="deleteLegalDoc(${d.id})" class="text-red-400 hover:text-red-600 p-1" title="Xóa"><i class="fas fa-trash text-xs"></i></button>
        </div>
      </td>
    </tr>`
  })

  html += '</tbody></table></div>'
  container.innerHTML = html
}

// ── Item Modal (Add / Edit) ──────────────────────────────────────────────────
function openAddLegalItem(stageId, parentId, projectId) {
  $('legalItemId').value = ''
  $('legalItemStageId').value = stageId
  $('legalItemParentId').value = parentId || ''
  $('legalItemProjectId').value = projectId
  $('legalItemStt').value = ''
  $('legalItemTitle').value = ''
  $('legalItemType').value = 'task'
  $('legalItemDueDate').value = ''
  $('legalItemStatus').value = 'pending'
  $('legalItemNotes').value = ''
  $('legalItemModalTitle').innerHTML = parentId
    ? '<i class="fas fa-indent text-primary mr-2"></i>Thêm sub-hạng mục'
    : '<i class="fas fa-plus text-primary mr-2"></i>Thêm hạng mục'
  // Preview STT tự động
  _previewAutoStt(stageId, parentId)
  openModal('legalItemModal')
}

function _previewAutoStt(stageId, parentId) {
  const prev = $('legalItemSttPreviewVal')
  if (!prev) return
  const stages = _legalOverviewData?.stages || []
  if (!parentId) {
    const stage = stages.find(s => s.id === parseInt(stageId))
    const count = (stage?.items || []).length
    prev.textContent = String(count + 1)
  } else {
    let parentStt = '1'
    let childCount = 0
    stages.forEach(s => {
      s.items.forEach(it => {
        if (it.id === parseInt(parentId)) {
          parentStt = it.stt
          childCount = (it.children || []).length
        }
      })
    })
    prev.textContent = `${parentStt}.${childCount + 1}`
  }
}

function openEditLegalItem(item) {
  if (typeof item === 'string') item = JSON.parse(item)
  $('legalItemId').value = item.id
  $('legalItemStageId').value = item.stage_id
  $('legalItemParentId').value = item.parent_id || ''
  $('legalItemProjectId').value = item.project_id
  $('legalItemStt').value = item.stt
  $('legalItemTitle').value = item.title
  $('legalItemType').value = item.item_type || 'task'
  $('legalItemDueDate').value = item.due_date || ''
  $('legalItemStatus').value = item.status || 'pending'
  $('legalItemNotes').value = item.notes || ''
  $('legalItemModalTitle').innerHTML = '<i class="fas fa-edit text-primary mr-2"></i>Chỉnh sửa hạng mục'
  const prev = $('legalItemSttPreviewVal')
  if (prev) prev.textContent = item.stt
  openModal('legalItemModal')
}

async function saveLegalItem(e) {
  e.preventDefault()
  const id = $('legalItemId').value
  const projectId = parseInt($('legalItemProjectId').value)
  const body = {
    stage_id: parseInt($('legalItemStageId').value),
    parent_id: $('legalItemParentId').value ? parseInt($('legalItemParentId').value) : null,
    title: $('legalItemTitle').value.trim(),
    item_type: $('legalItemType').value,
    due_date: $('legalItemDueDate').value || null,
    status: $('legalItemStatus').value,
    notes: $('legalItemNotes').value.trim() || null
  }
  try {
    if (id) {
      await api(`/legal/items/${id}`, { method: 'PUT', data: body })
      toast('Đã cập nhật hạng mục')
    } else {
      const res = await api(`/legal/${projectId}/items`, { method: 'POST', data: body })
      toast(`Đã thêm hạng mục STT: ${res.stt}`)
    }
    closeModal('legalItemModal')
    await loadLegalProject(projectId)
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}

async function reorderLegalItem(id, direction) {
  try {
    await api(`/legal/items/${id}/reorder`, { method: 'POST', data: { direction } })
    await loadLegalProject(_legalCurrentProjectId)
  } catch(err) {
    toast('Lỗi đổi thứ tự: ' + err.message, 'error')
  }
}

async function deleteLegalItem(id) {
  if (!confirm('Xóa hạng mục này? Các sub-hạng mục bên trong cũng sẽ bị xóa.')) return
  try {
    await api(`/legal/items/${id}`, { method: 'DELETE' })
    toast('Đã xóa hạng mục')
    await loadLegalProject(_legalCurrentProjectId)
  } catch(err) {
    toast('Lỗi xóa: ' + err.message, 'error')
  }
}

// ── Letter Modal ─────────────────────────────────────────────────────────────
function _populateLegalItemSelect(selectId) {
  const sel = $(selectId)
  sel.innerHTML = '<option value="">-- Chọn hạng mục --</option>'
  if (!_legalOverviewData) return

  const packages = _legalOverviewData.packages || []
  if (packages.length > 0) {
    // Cấu trúc mới: packages → stages → items — dùng optgroup để phân nhóm theo gói thầu
    packages.forEach(pkg => {
      const stages = pkg.stages || []
      if (stages.length === 0) return

      const grp = document.createElement('optgroup')
      grp.label = `📦 ${pkg.name}`
      sel.appendChild(grp)

      stages.forEach(stage => {
        stage.items.forEach(item => {
          const opt = document.createElement('option')
          opt.value = item.id
          opt.textContent = `[${stage.code}] ${item.stt} - ${item.title}`
          grp.appendChild(opt)
          ;(item.children||[]).forEach(ch => {
            const copt = document.createElement('option')
            copt.value = ch.id
            copt.textContent = `  └ ${ch.stt} - ${ch.title}`
            grp.appendChild(copt)
          })
        })
      })
    })
  } else if (_legalOverviewData.stages) {
    // fallback: stages phẳng (dữ liệu cũ)
    _legalOverviewData.stages.forEach(stage => {
      stage.items.forEach(item => {
        const opt = document.createElement('option')
        opt.value = item.id
        opt.textContent = `[${stage.code}] ${item.stt} - ${item.title}`
        sel.appendChild(opt)
        ;(item.children||[]).forEach(ch => {
          const copt = document.createElement('option')
          copt.value = ch.id
          copt.textContent = `  └ ${ch.stt} - ${ch.title}`
          sel.appendChild(copt)
        })
      })
    })
  }
}

async function openLegalLetterModal() {
  if (!_legalCurrentProjectId) { toast('Vui lòng chọn dự án trước', 'warning'); return }
  $('legalLetterId').value = ''
  $('legalLetterProjectId').value = _legalCurrentProjectId
  $('legalLetterType').value = 'cv'
  $('legalLetterSubject').value = ''
  $('legalLetterRecipient').value = ''
  $('legalLetterSentDate').value = today()
  $('legalLetterStatus').value = 'draft'
  $('legalLetterNotes').value = ''
  _populateLegalItemSelect('legalLetterItemId')
  $('legalLetterModalTitle').innerHTML = '<i class="fas fa-paper-plane text-blue-500 mr-2"></i>Tạo văn bản gửi đi'

  // Ẩn note cảnh báo đổi loại (chỉ hiện khi edit)
  const noteEl = $('legalLetterTypeChangeNote')
  if (noteEl) noteEl.classList.add('hidden')

  // Đổi nút submit về mặc định "Tạo văn bản"
  const submitBtn = document.querySelector('#legalLetterForm button[type="submit"]')
  if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i>Tạo văn bản'

  // Reload project từ server để lấy project_code_letter mới nhất (Fix vấn đề 2)
  try {
    const fresh = await api(`/projects/${_legalCurrentProjectId}`)
    if (fresh && fresh.project) {
      const idx = allProjects.findIndex(p => p.id === _legalCurrentProjectId)
      if (idx >= 0) allProjects[idx] = { ...allProjects[idx], ...fresh.project }
    }
  } catch(e) {}

  // Cập nhật preview khi đổi loại văn bản
  $('legalLetterType').onchange = () => previewLetterNumber()
  await previewLetterNumber()
  openModal('legalLetterModal')
}

async function openEditLegalLetter(letter) {
  if (typeof letter === 'string') letter = JSON.parse(letter)
  $('legalLetterId').value = letter.id
  $('legalLetterProjectId').value = letter.project_id
  $('legalLetterType').value = letter.letter_type || 'cv'
  $('legalLetterSubject').value = letter.subject
  $('legalLetterRecipient').value = letter.recipient || ''
  $('legalLetterSentDate').value = letter.sent_date || ''
  $('legalLetterStatus').value = letter.status || 'draft'
  $('legalLetterNotes').value = letter.notes || ''
  _populateLegalItemSelect('legalLetterItemId')
  $('legalLetterItemId').value = letter.legal_item_id || ''

  // Khi edit: hiển thị số hiệu hiện tại, cho phép preview số mới khi đổi loại
  $('legalLetterNumberPreview').textContent = letter.letter_number

  // Loại văn bản cho phép đổi → preview số hiệu mới theo loại mới
  const origType = letter.letter_type || 'cv'
  $('legalLetterType').onchange = async () => {
    const noteEl = $('legalLetterTypeChangeNote')
    const curType = $('legalLetterType').value
    if (curType !== origType) {
      // Preview số hiệu mới với loại mới
      try {
        const res = await api(`/legal/${letter.project_id}/letters/preview-number?type=${curType}`)
        $('legalLetterNumberPreview').textContent = res.number + ' (sẽ cập nhật khi lưu)'
      } catch(e) {}
      if (noteEl) noteEl.classList.remove('hidden')
    } else {
      // Restore số hiệu gốc
      $('legalLetterNumberPreview').textContent = letter.letter_number
      if (noteEl) noteEl.classList.add('hidden')
    }
  }

  // Ẩn note cảnh báo ban đầu
  const noteEl = $('legalLetterTypeChangeNote')
  if (noteEl) noteEl.classList.add('hidden')

  $('legalLetterModalTitle').innerHTML = '<i class="fas fa-edit text-blue-500 mr-2"></i>Chỉnh sửa văn bản'

  // Đổi nút submit thành "Lưu thay đổi"
  const submitBtn = document.querySelector('#legalLetterForm button[type="submit"]')
  if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-save mr-1"></i>Lưu thay đổi'

  openModal('legalLetterModal')
}

async function previewLetterNumber() {
  if (!_legalCurrentProjectId) return
  const letterId = $('legalLetterId').value
  if (letterId) return // editing – keep existing number, do not regenerate
  const letterType = $('legalLetterType').value || 'cv'
  try {
    // Luôn gọi API để lấy số mới nhất (tránh cache project_code_letter cũ)
    const res = await api(`/legal/${_legalCurrentProjectId}/letters/preview-number?type=${letterType}`)
    $('legalLetterNumberPreview').textContent = res.number
  } catch(e) {}
}

async function saveLegalLetter(e) {
  e.preventDefault()
  const id = $('legalLetterId').value
  const projectId = parseInt($('legalLetterProjectId').value)
  const body = {
    letter_type: $('legalLetterType').value || 'cv',
    subject: $('legalLetterSubject').value.trim(),
    recipient: $('legalLetterRecipient').value.trim() || null,
    sent_date: $('legalLetterSentDate').value || null,
    status: $('legalLetterStatus').value,
    notes: $('legalLetterNotes').value.trim() || null,
    legal_item_id: $('legalLetterItemId').value ? parseInt($('legalLetterItemId').value) : null
  }
  try {
    if (id) {
      const res = await api(`/legal/letters/${id}`, { method: 'PUT', data: body })
      const newNum = res?.letter_number
      toast(newNum ? `Đã cập nhật văn bản → ${newNum}` : 'Đã cập nhật văn bản', 'success', 4000)
    } else {
      const res = await api(`/legal/${projectId}/letters`, { method: 'POST', data: body })
      toast(`Đã tạo văn bản số: ${res.letter_number}`, 'success', 4000)
    }
    closeModal('legalLetterModal')
    await loadLegalProject(projectId)
    if (_legalCurrentTab !== 'letters') switchLegalTab('letters')
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}

async function deleteLegalLetter(id) {
  if (!confirm('Xóa văn bản này?')) return
  try {
    await api(`/legal/letters/${id}`, { method: 'DELETE' })
    toast('Đã xóa văn bản')
    await loadLegalProject(_legalCurrentProjectId)
  } catch(err) {
    toast('Lỗi xóa: ' + err.message, 'error')
  }
}

// ── Document Modal ────────────────────────────────────────────────────────────
async function openLegalDocModal() {
  if (!_legalCurrentProjectId) { toast('Vui lòng chọn dự án trước', 'warning'); return }
  $('legalDocId').value = ''
  $('legalDocProjectId').value = _legalCurrentProjectId
  $('legalDocTitle').value = ''
  $('legalDocType').value = 'contract'
  $('legalDocSignedDate').value = ''
  $('legalDocFileName').value = ''
  $('legalDocFileUrl').value = ''
  $('legalDocNotes').value = ''
  _populateLegalItemSelect('legalDocItemId')
  $('legalDocModalTitle').innerHTML = '<i class="fas fa-paperclip text-orange-500 mr-2"></i>Thêm tài liệu đính kèm'
  openModal('legalDocModal')
}

async function openEditLegalDoc(doc) {
  if (typeof doc === 'string') doc = JSON.parse(doc)
  $('legalDocId').value = doc.id
  $('legalDocProjectId').value = doc.project_id
  $('legalDocTitle').value = doc.title
  $('legalDocType').value = doc.doc_type || 'other'
  $('legalDocSignedDate').value = doc.signed_date || ''
  $('legalDocFileName').value = doc.file_name || ''
  $('legalDocFileUrl').value = doc.file_url || ''
  $('legalDocNotes').value = doc.notes || ''
  _populateLegalItemSelect('legalDocItemId')
  $('legalDocItemId').value = doc.legal_item_id || ''
  $('legalDocModalTitle').innerHTML = '<i class="fas fa-edit text-orange-500 mr-2"></i>Chỉnh sửa tài liệu'
  openModal('legalDocModal')
}

async function saveLegalDoc(e) {
  e.preventDefault()
  const id = $('legalDocId').value
  const projectId = parseInt($('legalDocProjectId').value)
  const body = {
    title: $('legalDocTitle').value.trim(),
    doc_type: $('legalDocType').value,
    signed_date: $('legalDocSignedDate').value || null,
    file_name: $('legalDocFileName').value.trim() || null,
    file_url: $('legalDocFileUrl').value.trim() || null,
    notes: $('legalDocNotes').value.trim() || null,
    legal_item_id: $('legalDocItemId').value ? parseInt($('legalDocItemId').value) : null
  }
  try {
    if (id) {
      await api(`/legal/documents/${id}`, { method: 'PUT', data: body })
      toast('Đã cập nhật tài liệu')
    } else {
      await api(`/legal/${projectId}/documents`, { method: 'POST', data: body })
      toast('Đã thêm tài liệu')
    }
    closeModal('legalDocModal')
    await loadLegalProject(projectId)
    if (_legalCurrentTab !== 'docs') switchLegalTab('docs')
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}

async function deleteLegalDoc(id) {
  if (!confirm('Xóa tài liệu này?')) return
  try {
    await api(`/legal/documents/${id}`, { method: 'DELETE' })
    toast('Đã xóa tài liệu')
    await loadLegalProject(_legalCurrentProjectId)
  } catch(err) {
    toast('Lỗi xóa: ' + err.message, 'error')
  }
}

// ── Letter Config Modal ──────────────────────────────────────────────────────
async function openLegalLetterConfig() {
  if (!_legalCurrentProjectId) return
  const proj = allProjects.find(p => p.id == _legalCurrentProjectId)
  $('legalConfigProjectId').value = _legalCurrentProjectId
  // Dùng project_code_letter của dự án (ưu tiên) hoặc code
  const codeLetter = proj?.project_code_letter || proj?.code || ''
  $('legalConfigCodeLetter').value = codeLetter
  updateLegalConfigPreview()

  // Load thống kê văn bản
  try {
    const res = await api(`/legal/${_legalCurrentProjectId}/letters`)
    const letters = res.letters || []
    const total = letters.length
    const byType = {}
    letters.forEach(l => { byType[l.letter_type] = (byType[l.letter_type] || 0) + 1 })
    const TYPE_SHORT = {cv:'CV',bc:'BC',bb:'BB',tb:'TB',qd:'QĐ',tt:'TT',kh:'KH',yc:'YC',pl:'PL',contract:'HĐ',appendix:'PLHĐ',acceptance:'BBNT',payment:'TT',other:'VB'}
    const typeSummary = Object.entries(byType).map(([t,n]) => `${TYPE_SHORT[t]||t.toUpperCase()}: ${n}`).join(' · ')
    $('legalConfigStatsText').textContent = total > 0
      ? `Đã tạo ${total} văn bản${typeSummary ? ' (' + typeSummary + ')' : ''}`
      : 'Chưa có văn bản nào'
  } catch(e) {
    $('legalConfigStatsText').textContent = 'Không thể tải thống kê'
  }

  openModal('legalLetterConfigModal')
}

function updateLegalConfigPreview() {
  const code = $('legalConfigCodeLetter')?.value.trim() || 'MÃ-DỰ-ÁN'
  const el = $('legalConfigPreview')
  if (el) el.textContent = `01-CV/OneCAD-BIM(${code})`
}

async function saveLegalLetterConfig(e) {
  e.preventDefault()
  const projectId = parseInt($('legalConfigProjectId').value)
  const codeLetter = $('legalConfigCodeLetter').value.trim()
  if (!codeLetter) {
    toast('Vui lòng nhập số hiệu dự án', 'warning')
    return
  }
  try {
    // Cập nhật project_code_letter qua API dự án
    await api(`/projects/${projectId}`, { method: 'PUT', data: { project_code_letter: codeLetter } })
    // Cập nhật local cache allProjects
    const proj = allProjects.find(p => p.id == projectId)
    if (proj) proj.project_code_letter = codeLetter
    // Reload project detail từ server để đồng bộ hoàn toàn
    try {
      const fresh = await api(`/projects/${projectId}`)
      if (fresh && fresh.project) {
        const idx = allProjects.findIndex(p => p.id === projectId)
        if (idx >= 0) allProjects[idx] = { ...allProjects[idx], ...fresh.project }
      }
    } catch(e2) {}
    toast(`Đã cập nhật số hiệu dự án: ${codeLetter} — Văn bản mới sẽ dùng mã này`, 'success', 4000)
    closeModal('legalLetterConfigModal')
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}
// ── E. Payment Status Tab ────────────────────────────────────────────────────
function renderPaymentStatus(payments) {
  const container = $('legalPaymentsTable')
  const summaryEl = $('paymentSummaryCards')
  if (!container) return

  // Summary cards
  const total = payments.length
  const totalAmount = payments.reduce((s, p) => s + (p.amount || 0), 0)
  const paidAmount = payments.reduce((s, p) => s + (p.paid_amount || 0), 0)
  const pending = payments.filter(p => p.status === 'pending' || p.status === 'processing').length
  const paid = payments.filter(p => p.status === 'paid').length

  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
        <div class="text-2xl font-bold text-blue-700">${total}</div>
        <div class="text-xs text-blue-500 mt-1">Tổng đợt TT</div>
      </div>
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
        <div class="text-sm font-bold text-amber-700">${fmtMoney(totalAmount)}</div>
        <div class="text-xs text-amber-500 mt-1">Tổng đề nghị</div>
      </div>
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
        <div class="text-sm font-bold text-emerald-700">${fmtMoney(paidAmount)}</div>
        <div class="text-xs text-emerald-500 mt-1">Đã thanh toán</div>
      </div>
      <div class="bg-rose-50 border border-rose-200 rounded-xl p-3 text-center">
        <div class="text-2xl font-bold text-rose-700">${pending}</div>
        <div class="text-xs text-rose-500 mt-1">Chờ xử lý</div>
      </div>
    `
  }

  if (!payments.length) {
    container.innerHTML = `<div class="text-center py-12 text-gray-400">
      <i class="fas fa-money-check-alt text-4xl mb-3 opacity-30"></i>
      <p class="font-medium">Chưa có đợt thanh toán nào</p>
      <p class="text-sm mt-1">Nhấn "+ Thêm đợt thanh toán" để tạo mới</p>
    </div>`
    return
  }

  // Progress bar overall
  const progressPct = totalAmount > 0 ? Math.min(100, Math.round(paidAmount / totalAmount * 100)) : 0
  const progressColor = progressPct >= 100 ? '#10b981' : progressPct >= 50 ? '#3b82f6' : '#f97316'

  let html = `
    <div class="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div class="flex justify-between text-sm mb-1">
        <span class="text-gray-600 font-medium">Tiến độ thanh toán</span>
        <span class="font-bold" style="color:${progressColor}">${progressPct}%</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2">
        <div class="h-2 rounded-full transition-all" style="width:${progressPct}%;background:${progressColor}"></div>
      </div>
      <div class="flex justify-between text-xs text-gray-400 mt-1">
        <span>Đã TT: ${fmtMoney(paidAmount)}</span>
        <span>Tổng ĐN: ${fmtMoney(totalAmount)}</span>
      </div>
    </div>
    <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-gray-200 bg-gray-50">
          <th class="py-2 px-3 text-left text-gray-600 font-semibold">Đợt TT</th>
          <th class="py-2 px-3 text-left text-gray-600 font-semibold">Nội dung</th>
          <th class="py-2 px-3 text-right text-gray-600 font-semibold">Số tiền ĐN</th>
          <th class="py-2 px-3 text-right text-gray-600 font-semibold">Đã TT</th>
          <th class="py-2 px-3 text-center text-gray-600 font-semibold">Ngày TT</th>
          <th class="py-2 px-3 text-center text-gray-600 font-semibold">Trạng thái</th>
          <th class="py-2 px-3 text-center text-gray-600 font-semibold">Hóa đơn</th>
          <th class="py-2 px-3 text-center text-gray-600 font-semibold">Doanh thu</th>
          <th class="py-2 px-3 text-center text-gray-600 font-semibold"></th>
        </tr>
      </thead>
      <tbody>
  `

  payments.forEach((p, idx) => {
    const statusLabel = PAYMENT_STATUS_LABELS[p.status] || p.status
    const statusClass = PAYMENT_STATUS_COLORS[p.status] || 'badge-todo'
    const rowBg = idx % 2 === 0 ? '' : 'style="background:#f9fafb"'
    const paidPct = (p.amount || 0) > 0 ? Math.min(100, Math.round((p.paid_amount || 0) / p.amount * 100)) : 0
    html += `
      <tr class="border-b border-gray-100 hover:bg-blue-50/30 transition-colors" ${rowBg}>
        <td class="py-2 px-3">
          <span class="font-semibold text-gray-700">${p.payment_phase || '—'}</span>
          ${p.request_number ? `<div class="text-xs text-gray-400 mt-0.5">${p.request_number}</div>` : ''}
        </td>
        <td class="py-2 px-3">
          <div class="text-gray-800">${p.description}</div>
          ${p.item_title 
            ? `<div class="text-xs text-gray-500 mt-0.5">
                ${p.package_name ? `<span style="font-size:10px;color:#6366f1;font-weight:600;background:#eef2ff;padding:1px 5px;border-radius:4px">📦 ${p.package_name}</span> ` : ''}
                ${p.stage_code ? `<span style="font-size:10px;color:#64748b;background:#f1f5f9;padding:1px 4px;border-radius:4px">[${p.stage_code}]</span> ` : ''}
                <i class="fas fa-link" style="font-size:9px;color:#94a3b8"></i> ${p.item_stt ? '['+p.item_stt+'] ' : ''}${p.item_title}
               </div>` 
            : ''}
          ${p.notes ? `<div class="text-xs text-gray-400 mt-0.5 italic">${p.notes}</div>` : ''}
        </td>
        <td class="py-2 px-3 text-right font-mono text-gray-700">${fmtMoney(p.amount || 0)}</td>
        <td class="py-2 px-3 text-right">
          <div class="font-mono text-emerald-700">${fmtMoney(p.paid_amount || 0)}</div>
          ${p.amount > 0 ? `<div class="text-xs text-gray-400">${paidPct}%</div>` : ''}
        </td>
        <td class="py-2 px-3 text-center text-gray-600 text-xs">${p.paid_date ? p.paid_date : '—'}</td>
        <td class="py-2 px-3 text-center"><span class="badge ${statusClass} text-xs">${statusLabel}</span></td>
        <td class="py-2 px-3 text-center text-xs text-gray-500">
          ${p.invoice_number ? `<div class="font-mono">${p.invoice_number}</div>` : '—'}
          ${p.invoice_date ? `<div class="text-gray-400">${p.invoice_date}</div>` : ''}
        </td>
        <td class="py-2 px-3 text-center">
          ${p.revenue_synced
            ? `<span class="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5" title="Đã tự động tạo doanh thu trong Chi phí & Doanh thu">
                <i class="fas fa-sync-alt text-emerald-500"></i> Đã đồng bộ
               </span>`
            : `<span class="text-xs text-gray-300">—</span>`
          }
        </td>
        <td class="py-2 px-3 text-center whitespace-nowrap">
          <button onclick="editPayment(${p.id})" class="text-blue-500 hover:text-blue-700 mr-2" title="Chỉnh sửa"><i class="fas fa-edit"></i></button>
          <button onclick="deletePayment(${p.id})" class="text-red-400 hover:text-red-600" title="Xóa"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `
  })

  html += '</tbody></table></div>'
  container.innerHTML = html
}

async function openPaymentModal() {
  if (!_legalCurrentProjectId) return
  $('paymentModalTitle').innerHTML = '<i class="fas fa-money-check-alt text-emerald-600 mr-2"></i>Thêm đợt thanh toán'
  $('paymentId').value = ''
  $('paymentProjectId').value = _legalCurrentProjectId
  $('paymentPhase').value = ''
  $('paymentRequestNumber').value = ''
  $('paymentDescription').value = ''
  $('paymentRequestDate').value = new Date().toISOString().slice(0,10)
  $('paymentStatus').value = 'pending'
  setMoneyInput('paymentAmount', 0)
  setMoneyInput('paymentPaidAmount', 0)
  $('paymentPaidDate').value = ''
  $('paymentInvoiceNumber').value = ''
  $('paymentInvoiceDate').value = ''
  $('paymentNotes').value = ''
  // populate legal item select
  _populatePaymentItemSelect(null)
  openModal('paymentModal')
}

async function editPayment(id) {
  if (!_legalOverviewData) return
  const payment = (_legalOverviewData.payments || []).find(p => p.id === id)
  if (!payment) return
  $('paymentModalTitle').innerHTML = '<i class="fas fa-edit text-blue-500 mr-2"></i>Chỉnh sửa đợt thanh toán'
  $('paymentId').value = payment.id
  $('paymentProjectId').value = payment.project_id
  $('paymentPhase').value = payment.payment_phase || ''
  $('paymentRequestNumber').value = payment.request_number || ''
  $('paymentDescription').value = payment.description || ''
  $('paymentRequestDate').value = payment.request_date || ''
  $('paymentStatus').value = payment.status || 'pending'
  setMoneyInput('paymentAmount', payment.amount || 0)
  setMoneyInput('paymentPaidAmount', payment.paid_amount || 0)
  $('paymentPaidDate').value = payment.paid_date || ''
  $('paymentInvoiceNumber').value = payment.invoice_number || ''
  $('paymentInvoiceDate').value = payment.invoice_date || ''
  $('paymentNotes').value = payment.notes || ''
  _populatePaymentItemSelect(payment.legal_item_id)
  openModal('paymentModal')
}

function _populatePaymentItemSelect(selectedId) {
  const sel = $('paymentLegalItemId')
  if (!sel) return
  sel.innerHTML = '<option value="">-- Chọn hạng mục --</option>'
  if (!_legalOverviewData) return

  const packages = _legalOverviewData.packages || []
  if (packages.length > 0) {
    // Cấu trúc mới: packages → stages → items
    // Hiển thị tên gói thầu rút gọn để phân biệt
    packages.forEach(pkg => {
      const pkgShort = pkg.name.length > 22 ? pkg.name.substring(0, 22) + '…' : pkg.name
      const stages = pkg.stages || []
      if (stages.length === 0) return

      // Tạo optgroup cho mỗi gói thầu
      const grp = document.createElement('optgroup')
      grp.label = `📦 ${pkg.name}`
      sel.appendChild(grp)

      stages.forEach(stage => {
        stage.items.forEach(item => {
          const opt = document.createElement('option')
          opt.value = item.id
          opt.textContent = `[${stage.code}] ${item.stt} - ${item.title}`
          if (item.id === selectedId) opt.selected = true
          grp.appendChild(opt)
          ;(item.children || []).forEach(child => {
            const copt = document.createElement('option')
            copt.value = child.id
            copt.textContent = `  └ ${item.stt}.${child.stt} - ${child.title}`
            if (child.id === selectedId) copt.selected = true
            grp.appendChild(copt)
          })
        })
      })
    })
  } else if (_legalOverviewData.stages) {
    // Fallback: flat stages (dữ liệu cũ)
    _legalOverviewData.stages.forEach(stage => {
      stage.items.forEach(item => {
        const opt = document.createElement('option')
        opt.value = item.id
        opt.textContent = `[${stage.code}] ${item.stt} - ${item.title}`
        if (item.id === selectedId) opt.selected = true
        sel.appendChild(opt)
        ;(item.children || []).forEach(child => {
          const copt = document.createElement('option')
          copt.value = child.id
          copt.textContent = `  └ ${item.stt}.${child.stt} - ${child.title}`
          if (child.id === selectedId) copt.selected = true
          sel.appendChild(copt)
        })
      })
    })
  }
}

async function savePayment(e) {
  e.preventDefault()
  const id = $('paymentId').value
  const projectId = parseInt($('paymentProjectId').value)
  const payload = {
    description:     $('paymentDescription').value.trim(),
    payment_phase:   $('paymentPhase').value.trim(),
    request_number:  $('paymentRequestNumber').value.trim(),
    request_date:    $('paymentRequestDate').value || null,
    status:          $('paymentStatus').value,
    amount:          parseMoneyVal('paymentAmount'),
    paid_amount:     parseMoneyVal('paymentPaidAmount'),
    paid_date:       $('paymentPaidDate').value || null,
    invoice_number:  $('paymentInvoiceNumber').value.trim(),
    invoice_date:    $('paymentInvoiceDate').value || null,
    legal_item_id:   parseInt($('paymentLegalItemId').value) || null,
    notes:           $('paymentNotes').value.trim()
  }
  try {
    const syncStatuses = ['paid', 'partial']
    const willSync = syncStatuses.includes(payload.status) && (payload.paid_amount || 0) > 0
    if (id) {
      const res = await api(`/legal/payments/${id}`, { method: 'PUT', data: payload })
      const msg = willSync
        ? 'Đã cập nhật & đồng bộ doanh thu ✓'
        : 'Đã cập nhật đợt thanh toán'
      toast(msg, 'success', 4000)
    } else {
      const res = await api(`/legal/${projectId}/payments`, { method: 'POST', data: payload })
      const msg = willSync
        ? 'Đã thêm đợt TT & tự động tạo doanh thu ✓'
        : 'Đã thêm đợt thanh toán'
      toast(msg, 'success', 4000)
    }
    closeModal('paymentModal')
    await loadLegalProject(_legalCurrentProjectId)
    if (_legalCurrentTab !== 'payments') switchLegalTab('payments')
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}

async function deletePayment(id) {
  // Kiểm tra có revenue liên kết không
  const payment = (_legalOverviewData?.payments || []).find(p => p.id === id)
  const hasRevenue = payment?.revenue_synced || payment?.revenue_id
  const confirmMsg = hasRevenue
    ? 'Xóa đợt thanh toán này?\n⚠️ Bản ghi doanh thu liên kết trong "Chi phí & Doanh thu" cũng sẽ bị xóa.'
    : 'Xóa đợt thanh toán này?'
  if (!confirm(confirmMsg)) return
  try {
    await api(`/legal/payments/${id}`, { method: 'DELETE' })
    toast(hasRevenue ? 'Đã xóa đợt TT & doanh thu liên kết' : 'Đã xóa đợt thanh toán', 'success')
    await loadLegalProject(_legalCurrentProjectId)
  } catch(err) {
    toast('Lỗi xóa: ' + err.message, 'error')
  }
}

// ── End Legal Module ─────────────────────────────────────────────────────────

// ===================================================
// LEGAL ITEM TASKS & SUBTASKS MODULE
// ===================================================

// Cache tasks theo item id
const _legalItemTasksCache = {}

// ── Toggle trạng thái task nhanh (click vào vòng tròn) ───────────────────────
async function toggleLegalTaskStatus(taskId, currentStatus, itemId) {
  // Chu kỳ status khớp với enum của bảng tasks: todo → in_progress → review → completed → todo
  // Không dùng 'done' vì không phải giá trị hợp lệ trong DB
  const next = { todo:'in_progress', in_progress:'review', review:'completed', completed:'todo', done:'completed' }
  const newStatus = next[currentStatus] || 'todo'
  try {
    await api(`/tasks/${taskId}`, { method: 'PUT', data: { status: newStatus } })
    await loadLegalItemTasks(itemId)
  } catch(e) { toast('Lỗi cập nhật trạng thái', 'error') }
}

// ── Mở rộng/thu gọn panel tasks của 1 hạng mục ──────────────────────────────
async function toggleLegalItemTasks(itemId, btn) {
  const panel = $(`legalTaskPanel_${itemId}`)
  if (!panel) return
  const isOpen = panel.style.display !== 'none'
  if (isOpen) {
    panel.style.display = 'none'
    btn.style.background = '#eef2ff'
    btn.style.color = '#6366f1'
    btn.style.borderColor = '#c7d2fe'
    btn.innerHTML = '<i class="fas fa-layer-group" style="font-size:9px"></i> Tasks'
    btn.title = 'Xem / Quản lý tasks'
    return
  }
  panel.style.display = 'block'
  btn.style.background = '#6366f1'
  btn.style.color = '#fff'
  btn.style.borderColor = '#6366f1'
  btn.innerHTML = '<i class="fas fa-chevron-up" style="font-size:9px"></i> Thu gọn'
  btn.title = 'Thu gọn tasks'
  await loadLegalItemTasks(itemId)
}

async function loadLegalItemTasks(itemId) {
  const panel = $(`legalTaskPanel_${itemId}`)
  if (!panel) return
  panel.innerHTML = '<div class="py-2 px-3 text-xs text-gray-400"><i class="fas fa-spinner fa-spin mr-1"></i>Đang tải...</div>'
  try {
    const tasks = await api(`/legal/items/${itemId}/tasks`)
    _legalItemTasksCache[itemId] = tasks
    renderLegalItemTasks(itemId, tasks)
  } catch(e) {
    panel.innerHTML = `<div class="py-2 px-3 text-xs text-red-400">Lỗi tải tasks</div>`
  }
}

function renderLegalItemTasks(itemId, tasks) {
  const panel = $(`legalTaskPanel_${itemId}`)
  if (!panel) return

  const isChild = panel.dataset.isChild === '1'
  const leftPad = isChild ? '48px' : '20px'  // align với title column

  const PRIORITY_META = {
    low:    { color:'#10b981', bg:'#ecfdf5', label:'Thấp',      icon:'fa-arrow-down' },
    medium: { color:'#f59e0b', bg:'#fffbeb', label:'TB',         icon:'fa-minus' },
    high:   { color:'#ef4444', bg:'#fef2f2', label:'Cao',        icon:'fa-arrow-up' }
  }
  const STATUS_META = {
    todo:       { color:'#64748b', bg:'#f1f5f9', label:'Chưa làm',   dot:'#94a3b8' },
    in_progress:{ color:'#2563eb', bg:'#dbeafe', label:'Đang làm',   dot:'#3b82f6' },
    review:     { color:'#d97706', bg:'#fef3c7', label:'Đang duyệt', dot:'#f59e0b' },
    completed:  { color:'#059669', bg:'#d1fae5', label:'Hoàn thành', dot:'#10b981' },
    cancelled:  { color:'#6b7280', bg:'#f3f4f6', label:'Đã hủy',     dot:'#9ca3af' },
    done:       { color:'#059669', bg:'#d1fae5', label:'Hoàn thành', dot:'#10b981' }
  }

  const done  = tasks.filter(t => t.status === 'done' || t.status === 'completed').length
  const total = tasks.length
  const pct   = total > 0 ? Math.round(done / total * 100) : 0
  const barCol = pct === 100 ? '#10b981' : pct >= 50 ? '#3b82f6' : '#f59e0b'

  // ── Header ──
  let html = `
  <div style="background:#f8fafc;border-top:2px solid #e2e8f0;padding-left:${leftPad}">
    <div style="display:flex;align-items:center;gap:10px;padding:7px 14px 7px 0;border-bottom:1px solid #e8ecf0">
      <span style="font-size:10px;font-weight:800;color:#6366f1;letter-spacing:.8px;text-transform:uppercase">
        <i class="fas fa-layer-group" style="margin-right:4px;font-size:9px"></i>TASKS
      </span>
      <span style="font-size:11px;font-weight:700;color:#6366f1;background:#eef2ff;border-radius:20px;padding:1px 8px">${total}</span>
      ${total > 0 ? `
      <div style="display:flex;align-items:center;gap:5px">
        <div style="width:70px;height:5px;background:#e5e7eb;border-radius:10px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${barCol};border-radius:10px;transition:width .4s"></div>
        </div>
        <span style="font-size:10px;font-weight:700;color:${barCol}">${done}/${total} · ${pct}%</span>
      </div>` : ''}
      <div style="flex:1"></div>
      <button onclick="openLegalItemTaskModal(${itemId})"
        style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#fff;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;border-radius:6px;padding:4px 12px;cursor:pointer;box-shadow:0 1px 4px rgba(99,102,241,.35)">
        <i class="fas fa-plus" style="font-size:9px"></i>Thêm task
      </button>
    </div>

    <!-- Task list -->
    <div style="padding:8px 14px 10px 0" id="taskList_${itemId}">`

  if (total === 0) {
    html += `
    <div style="text-align:center;padding:14px 0;color:#9ca3af">
      <i class="fas fa-clipboard-list" style="font-size:18px;opacity:.35;display:block;margin-bottom:6px"></i>
      <span style="font-size:11px">Chưa có task — nhấn <b style="color:#6366f1">+ Thêm task</b></span>
    </div>`
  } else {
    tasks.forEach((task, idx) => {
      const pm   = PRIORITY_META[task.priority] || PRIORITY_META.medium
      const sm   = STATUS_META[task.status]     || STATUS_META.todo
      const isDone      = task.status === 'done' || task.status === 'completed'
      const subTotal    = task.subtask_count || 0
      const subDone     = task.subtask_done_count || 0
      const subPct      = subTotal > 0 ? Math.round(subDone / subTotal * 100) : 0
      const subBarCol   = subPct === 100 ? '#10b981' : '#6366f1'
      const expandId    = `taskExpand_${task.id}`
      const hasDetail   = (task.subtasks && task.subtasks.length > 0) || task.description

      html += `
      <!-- Task card #${idx+1} -->
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)">

        <!-- ── Compact header row ── -->
        <div style="display:flex;align-items:center;gap:7px;padding:7px 10px;border-left:3px solid ${pm.color};cursor:pointer"
             onclick="toggleTaskCard('${expandId}', this)">

          <!-- Status circle (click stops propagation) -->
          <button onclick="event.stopPropagation();toggleLegalTaskStatus(${task.id},'${task.status}',${itemId})"
            style="flex-shrink:0;width:20px;height:20px;border-radius:50%;border:2px solid ${sm.dot};background:${isDone?sm.dot:'#fff'};display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s"
            title="Click để đổi trạng thái">
            ${isDone ? '<i class="fas fa-check" style="color:#fff;font-size:8px"></i>' : ''}
          </button>

          <!-- Title -->
          <span style="flex:1;font-size:12px;font-weight:${isDone?'400':'600'};color:${isDone?'#9ca3af':'#1f2937'};${isDone?'text-decoration:line-through':''};min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                title="${task.title}">${task.title}</span>

          <!-- Meta badges (compact) -->
          <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
            <span style="font-size:10px;font-weight:600;color:${pm.color};background:${pm.bg};padding:2px 6px;border-radius:4px;white-space:nowrap">
              <i class="fas ${pm.icon}" style="font-size:8px"></i> ${pm.label}
            </span>
            <span style="font-size:10px;font-weight:600;color:${sm.color};background:${sm.bg};padding:2px 6px;border-radius:4px;white-space:nowrap">${sm.label}</span>
            ${task.due_date ? `<span style="font-size:10px;color:#9ca3af;white-space:nowrap"><i class="fas fa-calendar-alt" style="font-size:8px;color:#d1d5db;margin-right:2px"></i>${fmtDate(task.due_date)}</span>` : ''}
            ${subTotal > 0 ? `<span style="font-size:10px;font-weight:600;color:${subBarCol};background:${subPct===100?'#d1fae5':'#ede9fe'};padding:2px 6px;border-radius:4px;white-space:nowrap"><i class="fas fa-check-double" style="font-size:8px;margin-right:2px"></i>${subDone}/${subTotal}</span>` : ''}
          </div>

          <!-- Action buttons -->
          <div style="display:flex;gap:3px;flex-shrink:0" onclick="event.stopPropagation()">
            <button onclick="openLegalItemSubtaskModal(${task.id})"
              style="width:26px;height:26px;border-radius:6px;border:1px solid #e0e7ff;background:#eef2ff;color:#6366f1;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Thêm subtask">
              <i class="fas fa-plus" style="font-size:9px"></i>
            </button>
            <button onclick="openLegalItemTaskModal(${itemId}, ${JSON.stringify(task).replace(/"/g,'&quot;')})"
              style="width:26px;height:26px;border-radius:6px;border:1px solid #d1fae5;background:#ecfdf5;color:#059669;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Sửa task">
              <i class="fas fa-pen" style="font-size:9px"></i>
            </button>
            <button onclick="deleteLegalItemTask(${task.id}, ${itemId})"
              style="width:26px;height:26px;border-radius:6px;border:1px solid #fee2e2;background:#fef2f2;color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Xóa task">
              <i class="fas fa-trash" style="font-size:9px"></i>
            </button>
            <!-- Expand toggle -->
            <button id="chevron_${task.id}"
              style="width:26px;height:26px;border-radius:6px;border:1px solid #e5e7eb;background:#f9fafb;color:#9ca3af;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s" title="Mở rộng / Thu gọn">
              <i class="fas fa-chevron-down" style="font-size:9px;transition:transform .25s"></i>
            </button>
          </div>
        </div>

        <!-- ── Expandable detail section ── -->
        <div id="${expandId}" style="display:none;overflow:hidden">
          ${subTotal > 0 ? `
          <!-- Subtask mini progress -->
          <div style="display:flex;align-items:center;gap:6px;padding:4px 10px 4px 38px;background:#fafafa;border-top:1px solid #f3f4f6">
            <span style="font-size:10px;color:#6b7280;white-space:nowrap"><i class="fas fa-check-double" style="font-size:9px;color:#6366f1;margin-right:3px"></i>${subDone}/${subTotal} subtask</span>
            <div style="flex:1;height:4px;background:#e5e7eb;border-radius:10px">
              <div style="width:${subPct}%;height:100%;background:${subBarCol};border-radius:10px;transition:width .4s"></div>
            </div>
            <span style="font-size:10px;font-weight:700;color:${subBarCol}">${subPct}%</span>
          </div>` : ''}
          ${task.description ? `
          <div style="padding:6px 10px 6px 38px;background:#fafafa;border-top:1px solid #f3f4f6">
            <span style="font-size:11px;color:#6b7280;font-style:italic">${task.description}</span>
          </div>` : ''}
          ${task.subtasks && task.subtasks.length > 0 ? renderLegalSubtasksList(task.id, task.subtasks) : ''}
          <!-- Add subtask -->
          <div style="padding:5px 10px 7px 38px;border-top:1px dashed #f0f0f0;background:#fafafa">
            <button onclick="openLegalItemSubtaskModal(${task.id})"
              style="font-size:11px;color:#6366f1;background:none;border:none;cursor:pointer;padding:0;display:inline-flex;align-items:center;gap:4px">
              <i class="fas fa-plus-circle" style="font-size:10px"></i> Thêm subtask
            </button>
          </div>
        </div>

      </div>`
    })
  }

  html += `</div></div>`
  panel.innerHTML = html
}

// ── Toggle expand/collapse task card ─────────────────────────────────────────
function toggleTaskCard(expandId, headerEl) {
  const detail  = document.getElementById(expandId)
  const taskId  = expandId.replace('taskExpand_', '')
  const chevron = document.getElementById(`chevron_${taskId}`)
  if (!detail) return
  const isOpen = detail.style.display !== 'none'
  if (isOpen) {
    detail.style.display = 'none'
    if (chevron) chevron.querySelector('i').style.transform = 'rotate(0deg)'
    if (chevron) { chevron.style.background = '#f9fafb'; chevron.style.color = '#9ca3af' }
  } else {
    detail.style.display = 'block'
    if (chevron) chevron.querySelector('i').style.transform = 'rotate(180deg)'
    if (chevron) { chevron.style.background = '#eef2ff'; chevron.style.color = '#6366f1'; chevron.style.borderColor = '#c7d2fe' }
  }
}

function renderLegalSubtasksList(taskId, subtasks) {
  const ST_META = {
    todo:       { color:'#64748b', bg:'#f1f5f9', dot:'#94a3b8', label:'Chưa làm' },
    in_progress:{ color:'#2563eb', bg:'#dbeafe', dot:'#3b82f6', label:'Đang làm' },
    done:       { color:'#059669', bg:'#d1fae5', dot:'#10b981', label:'Xong'      },
    completed:  { color:'#059669', bg:'#d1fae5', dot:'#10b981', label:'Xong'      }
  }
  let html = `<div style="background:#f8fafc;border-top:1px solid #f0f0f0;padding:4px 10px 2px 38px">`
  subtasks.forEach((st, i) => {
    const m      = ST_META[st.status] || ST_META.todo
    const isDone = st.status === 'done' || st.status === 'completed'
    html += `
    <div id="lst_${st.id}" class="subtask-row-legal"
      style="display:flex;align-items:center;gap:8px;padding:5px 2px;${i < subtasks.length-1 ? 'border-bottom:1px dashed #f0f0f0' : ''}">
      <button onclick="toggleSubtaskDoneLegal(${st.id},'${st.status}',${taskId})"
        style="flex-shrink:0;width:15px;height:15px;border-radius:3px;border:1.5px solid ${m.dot};background:${isDone?m.dot:'#fff'};display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s" title="Đánh dấu xong">
        ${isDone ? '<i class="fas fa-check" style="color:#fff;font-size:7px"></i>' : ''}
      </button>
      <span style="flex:1;font-size:11px;color:${isDone?'#9ca3af':'#374151'};${isDone?'text-decoration:line-through':''};min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${st.title}">${st.title}</span>
      <span style="flex-shrink:0;font-size:9px;font-weight:600;color:${m.color};background:${m.bg};padding:1px 6px;border-radius:10px">${m.label}</span>
      <div class="st-actions" style="display:flex;gap:2px;opacity:0;transition:opacity .15s;flex-shrink:0">
        <button onclick="openLegalItemSubtaskModal(${taskId},${JSON.stringify(st).replace(/"/g,'&quot;')})"
          style="width:20px;height:20px;border-radius:4px;border:none;background:#e0e7ff;color:#6366f1;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Sửa">
          <i class="fas fa-pen" style="font-size:7px"></i>
        </button>
        <button onclick="deleteLegalItemSubtask(${st.id},${taskId})"
          style="width:20px;height:20px;border-radius:4px;border:none;background:#fee2e2;color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Xóa">
          <i class="fas fa-trash" style="font-size:7px"></i>
        </button>
      </div>
    </div>`
  })
  html += `</div>`
  return html
}

// ── Toggle done nhanh cho subtask ────────────────────────────────────────────
async function toggleSubtaskDoneLegal(subtaskId, currentStatus, taskId) {
  const newStatus = currentStatus === 'done' ? 'todo' : 'done'
  try {
    await api(`/subtasks/${subtaskId}`, { method: 'PUT', data: { status: newStatus } })
    // Reload tasks panel
    const task = Object.values(_legalItemTasksCache).flat().find((t) => t.id === taskId)
    if (task) await loadLegalItemTasks(task.legal_item_id)
  } catch(e) {}
}

// ── Modal Task ────────────────────────────────────────────────────────────────
function openLegalItemTaskModal(itemId, task = null) {
  $('legalItemTaskLegalItemId').value = itemId
  $('legalItemTaskId').value = task?.id || ''
  $('legalItemTaskTitle').value = task?.title || ''
  $('legalItemTaskPriority').value = task?.priority || 'medium'
  $('legalItemTaskStatus').value = task?.status || 'todo'
  $('legalItemTaskDueDate').value = task?.due_date || ''
  $('legalItemTaskHours').value = task?.estimated_hours || ''
  $('legalItemTaskDesc').value = task?.description || ''
  $('legalItemTaskModalTitle').innerHTML = task
    ? '<i class="fas fa-edit text-green-500 mr-2"></i>Chỉnh sửa task'
    : '<i class="fas fa-plus text-green-500 mr-2"></i>Tạo task mới'
  openModal('legalItemTaskModal')
}

async function saveLegalItemTask(e) {
  e.preventDefault()
  const itemId = parseInt($('legalItemTaskLegalItemId').value)
  const id = $('legalItemTaskId').value
  const body = {
    title: $('legalItemTaskTitle').value.trim(),
    priority: $('legalItemTaskPriority').value,
    status: $('legalItemTaskStatus').value,
    due_date: $('legalItemTaskDueDate').value || null,
    estimated_hours: parseFloat($('legalItemTaskHours').value) || 0,
    description: $('legalItemTaskDesc').value.trim() || null
  }
  try {
    if (id) {
      await api(`/tasks/${id}`, { method: 'PUT', data: body })
      toast('Đã cập nhật task')
    } else {
      await api(`/legal/items/${itemId}/tasks`, { method: 'POST', data: body })
      toast('Đã tạo task mới')
    }
    closeModal('legalItemTaskModal')
    await loadLegalItemTasks(itemId)
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}

async function deleteLegalItemTask(taskId, itemId) {
  if (!confirm('Xóa task này?')) return
  try {
    await api(`/tasks/${taskId}`, { method: 'DELETE' })
    toast('Đã xóa task')
    await loadLegalItemTasks(itemId)
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}

// ── Modal Subtask ─────────────────────────────────────────────────────────────
function openLegalItemSubtaskModal(taskId, subtask = null) {
  $('legalItemSubtaskTaskId').value = taskId
  $('legalItemSubtaskId').value = subtask?.id || ''
  $('legalItemSubtaskTitle').value = subtask?.title || ''
  $('legalItemSubtaskPriority').value = subtask?.priority || 'medium'
  $('legalItemSubtaskStatus').value = subtask?.status || 'todo'
  $('legalItemSubtaskDueDate').value = subtask?.due_date || ''
  $('legalItemSubtaskModalTitle').innerHTML = subtask
    ? '<i class="fas fa-edit text-indigo-500 mr-2"></i>Chỉnh sửa subtask'
    : '<i class="fas fa-plus text-indigo-500 mr-2"></i>Thêm subtask mới'
  openModal('legalItemSubtaskModal')
}

async function saveLegalItemSubtask(e) {
  e.preventDefault()
  const taskId = parseInt($('legalItemSubtaskTaskId').value)
  const id = $('legalItemSubtaskId').value
  const body = {
    title: $('legalItemSubtaskTitle').value.trim(),
    priority: $('legalItemSubtaskPriority').value,
    status: $('legalItemSubtaskStatus').value,
    due_date: $('legalItemSubtaskDueDate').value || null
  }
  try {
    if (id) {
      await api(`/subtasks/${id}`, { method: 'PUT', data: body })
      toast('Đã cập nhật subtask')
    } else {
      await api(`/tasks/${taskId}/subtasks`, { method: 'POST', data: body })
      toast('Đã thêm subtask')
    }
    closeModal('legalItemSubtaskModal')
    // Reload panel của legal item chứa task này
    const allItems = Object.keys(_legalItemTasksCache)
    for (const itemId of allItems) {
      const tasks = _legalItemTasksCache[itemId] || []
      if (tasks.some((t) => t.id === taskId)) {
        await loadLegalItemTasks(parseInt(itemId))
        break
      }
    }
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}

async function deleteLegalItemSubtask(subtaskId, taskId) {
  if (!confirm('Xóa subtask này?')) return
  try {
    await api(`/subtasks/${subtaskId}`, { method: 'DELETE' })
    toast('Đã xóa subtask')
    const allItems = Object.keys(_legalItemTasksCache)
    for (const itemId of allItems) {
      const tasks = _legalItemTasksCache[itemId] || []
      if (tasks.some((t) => t.id === taskId)) {
        await loadLegalItemTasks(parseInt(itemId))
        break
      }
    }
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}
// ── End Legal Item Tasks Module ───────────────────────────────────────────────

// ============================================================
// IMPORT EXCEL - Hồ Sơ Pháp Lý
// ============================================================

let _importExcelFile = null

async function openImportExcelModal() {
  if (!_legalCurrentProjectId) {
    toast('Vui lòng chọn dự án trước', 'warning'); return
  }
  clearImportFile()
  $('importResultBox').classList.add('hidden')
  $('importResultBox').innerHTML = ''
  $('importProgressWrap').classList.add('hidden')
  $('importProgressBar').style.width = '0%'
  $('importProgressPct').textContent = '0%'
  $('importReplaceExisting').checked = true
  updateImportReplaceWarning()

  // Load danh sách gói thầu vào dropdown
  const sel = $('importPackageSelect')
  if (sel) {
    sel.innerHTML = '<option value="">-- Đang tải... --</option>'
    try {
      const data = await api(`/legal/${_legalCurrentProjectId}/packages`)
      const pkgs = data.packages || []
      if (pkgs.length === 0) {
        sel.innerHTML = '<option value="">-- Chưa có gói thầu (import vào project chung) --</option>'
      } else {
        sel.innerHTML = pkgs.map(p =>
          `<option value="${p.id}">${p.name}</option>`
        ).join('')
      }
    } catch(e) {
      sel.innerHTML = '<option value="">-- Lỗi tải gói thầu --</option>'
    }
  }

  $('modalImportExcel').classList.remove('hidden')
}

function closeImportExcelModal() {
  $('modalImportExcel').classList.add('hidden')
  _importExcelFile = null
}

function updateImportReplaceWarning() {
  const checked = $('importReplaceExisting').checked
  $('importReplaceWarning').style.display = checked ? '' : 'none'
}

// Bind checkbox change
document.addEventListener('DOMContentLoaded', () => {
  const chk = $('importReplaceExisting')
  if (chk) chk.addEventListener('change', updateImportReplaceWarning)
})

function handleImportDrop(e) {
  e.preventDefault()
  $('importDropZone').classList.remove('border-green-400','bg-green-50')
  const file = e.dataTransfer.files[0]
  if (file) setImportFile(file)
}

function onImportFileSelected(e) {
  const file = e.target.files[0]
  if (file) setImportFile(file)
}

function setImportFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext !== 'xlsx' && ext !== 'xls') {
    toast('Chỉ hỗ trợ file .xlsx hoặc .xls', 'error'); return
  }
  if (file.size > 10 * 1024 * 1024) {
    toast('File quá lớn (tối đa 10MB)', 'error'); return
  }
  _importExcelFile = file
  $('importFileName').textContent = file.name
  $('importFileSize').textContent = (file.size / 1024).toFixed(1) + ' KB'
  $('importFilePreview').classList.remove('hidden')
  $('importDropZone').classList.add('hidden')
  // Enable button
  const btn = $('btnExecuteImport')
  btn.disabled = false
  btn.style.opacity = '1'
  btn.style.cursor = 'pointer'
}

function clearImportFile() {
  _importExcelFile = null
  $('importExcelFileInput').value = ''
  $('importFilePreview').classList.add('hidden')
  $('importDropZone').classList.remove('hidden')
  const btn = $('btnExecuteImport')
  btn.disabled = true
  btn.style.opacity = '0.5'
  btn.style.cursor = 'not-allowed'
}

async function executeImportExcel() {
  if (!_importExcelFile || !_legalCurrentProjectId) return

  // Lấy package_id được chọn
  const packageId = $('importPackageSelect')?.value || ''
  if (!packageId) {
    toast('Vui lòng chọn gói thầu để import vào', 'warning')
    return
  }

  const replaceExisting = $('importReplaceExisting').checked
  const btn = $('btnExecuteImport')
  const resultBox = $('importResultBox')

  // Show progress
  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Đang xử lý...'
  $('importProgressWrap').classList.remove('hidden')
  resultBox.classList.add('hidden')

  // Simulate progress animation
  let pct = 0
  const progressInterval = setInterval(() => {
    pct = Math.min(pct + 5, 85)
    $('importProgressBar').style.width = pct + '%'
    $('importProgressPct').textContent = pct + '%'
  }, 120)

  try {
    const formData = new FormData()
    formData.append('file', _importExcelFile)
    formData.append('replace', replaceExisting ? '1' : '0')
    if (packageId) formData.append('package_id', packageId)

    const token = localStorage.getItem('bim_token')
    const res = await fetch(`/api/legal/import-excel/${_legalCurrentProjectId}`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData
    })

    clearInterval(progressInterval)
    $('importProgressBar').style.width = '100%'
    $('importProgressPct').textContent = '100%'

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || 'Lỗi import')
    }

    // Success
    resultBox.innerHTML = `
      <div class="bg-green-50 border border-green-200 rounded-lg p-4">
        <div class="flex items-start gap-3">
          <i class="fas fa-check-circle text-green-500 text-xl mt-0.5"></i>
          <div>
            <p class="font-semibold text-green-800 mb-2">Import thành công!</p>
            <div class="grid grid-cols-3 gap-3">
              <div class="text-center bg-white rounded-lg p-2 border border-green-100">
                <div class="text-2xl font-bold text-green-600">${data.stats?.stages || 0}</div>
                <div class="text-xs text-gray-500">Giai đoạn</div>
              </div>
              <div class="text-center bg-white rounded-lg p-2 border border-green-100">
                <div class="text-2xl font-bold text-blue-600">${data.stats?.parents || 0}</div>
                <div class="text-xs text-gray-500">Hạng mục</div>
              </div>
              <div class="text-center bg-white rounded-lg p-2 border border-green-100">
                <div class="text-2xl font-bold text-orange-500">${data.stats?.children || 0}</div>
                <div class="text-xs text-gray-500">Tài liệu con</div>
              </div>
            </div>
          </div>
        </div>
      </div>`
    resultBox.classList.remove('hidden')

    // Reload data
    await loadLegalProject(_legalCurrentProjectId)
    toast(data.message || 'Import thành công!', 'success')

    // Reset button
    setTimeout(() => {
      btn.disabled = false
      btn.innerHTML = '<i class="fas fa-upload mr-1"></i>Import lại'
      btn.style.opacity = '1'
      btn.style.cursor = 'pointer'
    }, 1500)

  } catch (e) {
    clearInterval(progressInterval)
    $('importProgressWrap').classList.add('hidden')
    resultBox.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
        <i class="fas fa-exclamation-circle text-red-500 text-xl mt-0.5"></i>
        <div>
          <p class="font-semibold text-red-800">Import thất bại</p>
          <p class="text-sm text-red-600 mt-1">${e.message}</p>
        </div>
      </div>`
    resultBox.classList.remove('hidden')
    btn.disabled = false
    btn.innerHTML = '<i class="fas fa-upload mr-1"></i>Thử lại'
    btn.style.opacity = '1'
    btn.style.cursor = 'pointer'
    toast('Lỗi import: ' + e.message, 'error')
  }
}

// ── Download Excel Template ──────────────────────────────────────────────────
function downloadExcelTemplate() {
  // Generate template Excel using SheetJS (XLSX library đã có sẵn)
  if (typeof XLSX === 'undefined') {
    toast('Thư viện XLSX chưa tải, vui lòng thử lại', 'error'); return
  }

  const wb = XLSX.utils.book_new()

  // Template data
  const templateData = [
    ['STT', 'Hạng mục công việc', 'Thời gian', 'Trạng thái', 'Ghi chú'],
    ['A', 'GIAI ĐOẠN CHUẨN BỊ GÓI THẦU', null, null, null],
    [1, 'Yêu cầu lập đề cương dự toán', '2025-03-01', null, null],
    ['=A3+0.1', 'Dự toán chi phí', null, null, null],
    ['=A4+0.1', 'Đề cương nhiệm vụ', null, null, null],
    [2, 'Trình thẩm tra đề cương dự toán', '2025-04-02', null, null],
    ['=A6+0.1', 'In đề cương dự toán', null, null, null],
    ['=A7+0.1', 'Trình TVTK ký', null, null, null],
    [3, 'Quyết định phê duyệt đề cương dự toán', '2025-04-04', null, null],
    ['B', 'GIAI ĐOẠN THAM GIA GÓI THẦU', null, null, null],
    [1, 'Yêu cầu chuẩn bị hồ sơ năng lực nhà thầu', '2025-03-01', null, null],
    ['=A11+0.1', 'Xin tên gói thầu, các thông tin liên quan nếu có', null, null, null],
    ['=A12+0.1', 'Thư ngỏ', '2024-03-24', null, null],
    ['=A13+0.1', 'Thư cam kết thực hiện', '2024-03-24', null, null],
    [2, 'Trình phiếu đánh giá năng lực nhà thầu', '2025-04-14', null, null],
    [3, 'Nhận hồ sơ yêu cầu', '2025-04-15', null, null],
    ['=A16+0.1', 'Văn bản giới thiệu nhân sự đến nhận HSYC', '2025-04-15', null, null],
    [4, 'Nộp hồ sơ đề xuất', '2025-04-21', null, 'In đóng cuốn 1 bộ gốc và photo thành 3 bộ'],
    ['C', 'GIAI ĐOẠN KÝ HỢP ĐỒNG VÀ THỰC HIỆN GÓI THẦU', null, null, null],
    [1, 'Thư mời thương thảo hợp đồng', '2025-04-21', null, null],
    ['=A20+0.1', 'Công văn tham gia thương thảo hợp đồng', '2025-04-21', null, null],
    ['=A21+0.1', 'Thương thảo hợp đồng', '2025-04-21', null, null],
    [2, 'Ký hợp đồng', '2025-04-23', null, null],
    ['=A23+0.1', 'Bảo lãnh tạm ứng (Nếu có)', null, null, null],
    ['=A24+0.1', 'Đơn đề nghị tạm ứng', null, null, null],
    ['D', 'GIAI ĐOẠN NGHIỆM THU', null, null, null],
    [1, 'Biên bản nghiệm thu hoàn thành sản phẩm tư vấn', null, null, null],
    [2, 'Mẫu số 3A - Xác định khối lượng công việc hoàn thành', null, null, null],
    [3, 'Giấy đề nghị thanh toán', null, null, null],
  ]

  const ws = XLSX.utils.aoa_to_sheet(templateData)

  // Style column widths
  ws['!cols'] = [
    { wch: 12 },  // STT
    { wch: 55 },  // Hạng mục
    { wch: 18 },  // Thời gian
    { wch: 14 },  // Trạng thái
    { wch: 30 },  // Ghi chú
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'TimeLine')
  XLSX.writeFile(wb, 'HSPL_Template.xlsx')
  toast('Đã tải xuống template HSPL_Template.xlsx', 'success')
}
// ── End Import Excel Module ──────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// ═══ MEETING MINUTES (BIÊN BẢN HỌP) MODULE ════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

// ── Render Meeting Minutes List ──────────────────────────────────────────────
function renderMeetingMinutes(minutes) {
  const container = $('meetingMinutesTable')
  if (!container) return

  if (!minutes || minutes.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-gray-400">
        <i class="fas fa-clipboard-list text-5xl mb-3 block opacity-20"></i>
        <div class="font-semibold mb-1">Chưa có biên bản họp nào</div>
        <div class="text-sm">Nhấn "Tạo biên bản" để bắt đầu ghi chép cuộc họp</div>
      </div>`
    return
  }

  const rows = minutes.map(m => {
    const statusBadge = {
      draft: '<span class="px-2 py-1 text-xs rounded bg-gray-100 text-gray-600">📝 Nháp</span>',
      finalized: '<span class="px-2 py-1 text-xs rounded bg-blue-100 text-blue-600">✅ Hoàn tất</span>',
      approved: '<span class="px-2 py-1 text-xs rounded bg-green-100 text-green-600">✔️ Đã duyệt</span>'
    }[m.status] || '<span class="px-2 py-1 text-xs rounded bg-gray-100 text-gray-600">—</span>'

    return `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-3 text-sm text-center">
          ${m.meeting_number ? '<span class="font-mono text-blue-600 font-semibold">' + m.meeting_number + '</span>' : '<span class="text-gray-400">—</span>'}
        </td>
        <td class="p-3 text-sm text-center text-gray-600">${m.meeting_date || '—'}</td>
        <td class="p-3 text-sm text-gray-600">${m.meeting_time || '—'}</td>
        <td class="p-3 text-sm font-medium text-gray-800">
          ${m.subject || '<span class="text-gray-400">Chưa có chủ đề</span>'}
        </td>
        <td class="p-3 text-sm text-gray-600">${m.location || '—'}</td>
        <td class="p-3 text-sm text-gray-600">${m.chair_person || '—'}</td>
        <td class="p-3 text-center">${statusBadge}</td>
        <td class="p-3 text-center">
          <button onclick="openEditMeetingMinute(${m.id})" class="text-blue-500 hover:text-blue-700 mr-2" title="Chỉnh sửa">
            <i class="fas fa-edit"></i>
          </button>
          <button onclick="deleteMeetingMinute(${m.id})" class="text-red-500 hover:text-red-700" title="Xóa">
            <i class="fas fa-trash-alt"></i>
          </button>
        </td>
      </tr>`
  }).join('')

  container.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full">
        <thead class="bg-gray-50 border-b-2">
          <tr>
            <th class="p-3 text-xs font-semibold text-gray-600 text-left">Số BB</th>
            <th class="p-3 text-xs font-semibold text-gray-600 text-left">Ngày họp</th>
            <th class="p-3 text-xs font-semibold text-gray-600 text-left">Giờ</th>
            <th class="p-3 text-xs font-semibold text-gray-600 text-left">Chủ đề</th>
            <th class="p-3 text-xs font-semibold text-gray-600 text-left">Địa điểm</th>
            <th class="p-3 text-xs font-semibold text-gray-600 text-left">Chủ trì</th>
            <th class="p-3 text-xs font-semibold text-gray-600 text-center">Trạng thái</th>
            <th class="p-3 text-xs font-semibold text-gray-600 text-center">Thao tác</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}

// ── Open Add Meeting Minute Modal ────────────────────────────────────────────
async function openMeetingMinuteModal() {
  if (!_legalCurrentProjectId) {
    toast('Vui lòng chọn dự án', 'warning')
    return
  }

  // Reset form
  $('meetingMinuteForm').reset()
  $('meetingMinuteId').value = ''
  $('meetingMinuteProjectId').value = _legalCurrentProjectId
  $('meetingMinuteModalTitle').innerHTML = '<i class="fas fa-clipboard-list text-purple-500 mr-2"></i>Tạo biên bản họp mới'
  
  // Set default date to today
  $('meetingMinuteDate').value = new Date().toISOString().split('T')[0]
  $('meetingMinuteStatus').value = 'draft'

  // Load legal items dropdown using shared function
  _populateLegalItemSelect('meetingMinuteLegalItem')

  openModal('meetingMinuteModal')
}

// ── Open Edit Meeting Minute Modal ───────────────────────────────────────────
async function openEditMeetingMinute(id) {
  try {
    const minute = await api(`/meeting-minutes/detail/${id}`)
    if (!minute) {
      toast('Không tìm thấy biên bản họp', 'error')
      return
    }

    // Fill form
    $('meetingMinuteId').value = minute.id
    $('meetingMinuteProjectId').value = minute.project_id
    $('meetingMinuteNumber').value = minute.meeting_number || ''
    $('meetingMinuteDate').value = minute.meeting_date || ''
    $('meetingMinuteTime').value = minute.meeting_time || ''
    $('meetingMinuteLocation').value = minute.location || ''
    $('meetingMinuteSubject').value = minute.subject || ''
    $('meetingMinuteChair').value = minute.chair_person || ''
    $('meetingMinuteSecretary').value = minute.secretary || ''
    $('meetingMinuteAttendees').value = minute.attendees || ''
    $('meetingMinuteAbsent').value = minute.absent_members || ''
    $('meetingMinuteAgenda').value = minute.agenda || ''
    $('meetingMinuteDiscussion').value = minute.discussion || ''
    $('meetingMinuteDecisions').value = minute.decisions || ''
    $('meetingMinuteActions').value = minute.action_items || ''
    $('meetingMinuteStatus').value = minute.status || 'draft'
    $('meetingMinuteNotes').value = minute.notes || ''

    // Load legal items dropdown using shared function
    _populateLegalItemSelect('meetingMinuteLegalItem')
    if (minute.legal_item_id) {
      $('meetingMinuteLegalItem').value = minute.legal_item_id
    }

    $('meetingMinuteModalTitle').innerHTML = '<i class="fas fa-edit text-purple-500 mr-2"></i>Chỉnh sửa biên bản họp'
    openModal('meetingMinuteModal')
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}

// ── Save Meeting Minute ──────────────────────────────────────────────────────
async function saveMeetingMinute(e) {
  e.preventDefault()
  const id = $('meetingMinuteId').value
  const projectId = parseInt($('meetingMinuteProjectId').value)

  const data = {
    meeting_number: $('meetingMinuteNumber').value.trim() || null,
    meeting_date: $('meetingMinuteDate').value,
    meeting_time: $('meetingMinuteTime').value.trim() || null,
    location: $('meetingMinuteLocation').value.trim() || null,
    subject: $('meetingMinuteSubject').value.trim(),
    chair_person: $('meetingMinuteChair').value.trim() || null,
    secretary: $('meetingMinuteSecretary').value.trim() || null,
    attendees: $('meetingMinuteAttendees').value.trim() || null,
    absent_members: $('meetingMinuteAbsent').value.trim() || null,
    agenda: $('meetingMinuteAgenda').value.trim() || null,
    discussion: $('meetingMinuteDiscussion').value.trim() || null,
    decisions: $('meetingMinuteDecisions').value.trim() || null,
    action_items: $('meetingMinuteActions').value.trim() || null,
    status: $('meetingMinuteStatus').value,
    notes: $('meetingMinuteNotes').value.trim() || null
  }

  const legalItemId = $('meetingMinuteLegalItem').value
  if (legalItemId) data.legal_item_id = parseInt(legalItemId)

  try {
    if (id) {
      await api(`/meeting-minutes/${id}`, { method: 'PUT', data })
      toast('Cập nhật biên bản họp thành công', 'success')
    } else {
      await api(`/meeting-minutes/${projectId}`, { method: 'POST', data })
      toast('Tạo biên bản họp thành công', 'success')
    }
    
    // Reload data
    await loadLegalProject(_legalCurrentProjectId)
    closeModal('meetingMinuteModal')
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}

// ── Delete Meeting Minute ────────────────────────────────────────────────────
async function deleteMeetingMinute(id) {
  if (!confirm('Bạn có chắc muốn xóa biên bản họp này?')) return

  try {
    await api(`/meeting-minutes/${id}`, { method: 'DELETE' })
    toast('Đã xóa biên bản họp', 'success')
    await loadLegalProject(_legalCurrentProjectId)
  } catch(err) {
    toast('Lỗi: ' + err.message, 'error')
  }
}

// ═══ END MEETING MINUTES MODULE ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE: CHI PHÍ THEO LOẠI (COST BREAKDOWN ANALYTICS)
// ═══════════════════════════════════════════════════════════════════════════════

let _cbInitialized = false
let _cbCharts = {}

function destroyCbChart(key) {
  if (_cbCharts[key]) { try { _cbCharts[key].destroy() } catch(e){} delete _cbCharts[key] }
}

async function initCostBreakdownTab(force = false) {
  if (_cbInitialized && !force) { loadCostBreakdown(); return }
  _cbInitialized = true

  // Populate year selector
  const yearSel = $('cbYear')
  if (yearSel && !yearSel.options.length) {
    const cur = new Date().getFullYear()
    for (let y = cur + 1; y >= cur - 4; y--) {
      const opt = document.createElement('option')
      opt.value = y; opt.textContent = `NTC ${y}`
      if (y === cur) opt.selected = true
      yearSel.appendChild(opt)
    }
  }

  // Populate cost type filter
  const ctSel = $('cbCostType')
  if (ctSel && ctSel.options.length <= 1) {
    try {
      const types = await api('/cost-types')
      types.forEach(t => {
        const opt = document.createElement('option')
        opt.value = t.code; opt.textContent = t.name
        ctSel.appendChild(opt)
      })
    } catch(e) {}
  }

  // Init project combobox
  if (!document.querySelector('#cbProjectCombobox .combobox-input')) {
    createCombobox('cbProjectCombobox', {
      placeholder: '-- Tất cả dự án --',
      allowEmpty: true,
      onchange: () => loadCostBreakdown()
    })
    try {
      const projs = await api('/projects')
      setComboboxOptions('cbProjectCombobox', projs.map(p => ({ value: String(p.id), label: `[${p.code}] ${p.name}` })))
    } catch(e) {}
  }

  loadCostBreakdown()
}

async function loadCostBreakdown() {
  const el = $('costBreakdownContent')
  if (!el) return
  el.innerHTML = '<div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-3"></i><p>Đang tải dữ liệu chi phí...</p></div>'

  try {
    const year     = $('cbYear')?.value || String(new Date().getFullYear())
    const projId   = _cbGetValue('cbProjectCombobox')
    const costType = $('cbCostType')?.value || ''

    let q = `/analytics/cost-breakdown?year=${year}`
    if (projId)   q += `&project_id=${projId}`
    if (costType) q += `&cost_type=${costType}`

    const data = await api(q)
    renderCostBreakdown(el, data)
  } catch(e) {
    el.innerHTML = `<div class="text-center py-12 text-red-400"><i class="fas fa-exclamation-circle text-3xl mb-3"></i><p>Lỗi tải dữ liệu: ${e.message}</p></div>`
  }
}

function renderCostBreakdown(el, data) {
  const { period, grand_total, by_type, by_project_type, timeline, top_projects, details,
          total_labor = 0, total_depr = 0, total_contract_value = 0,
          total_shared_non_depr = 0,
          labor_by_project = [], depr_by_project = [] } = data

  // ── Build maps for labor & depreciation ───────────────────────
  const laborMap = {}
  labor_by_project.forEach(r => { laborMap[r.project_id] = r.labor_total || 0 })
  const deprMap = {}
  depr_by_project.forEach(r => { deprMap[r.project_id] = r.depr_total || 0 })

  // ── Build project pivot table ──────────────────────────────────
  const projMap = {}
  const typeSet = new Set()
  const typeColorMap = {}
  const typeNameMap  = {}

  by_project_type.forEach(r => {
    typeSet.add(r.cost_type)
    typeColorMap[r.cost_type] = r.color
    typeNameMap[r.cost_type]  = r.type_name
    if (!projMap[r.project_id]) {
      projMap[r.project_id] = {
        id: r.project_id, code: r.project_code,
        name: r.project_name, contract_value: r.contract_value,
        types: {}, total: 0
      }
    }
    projMap[r.project_id].types[r.cost_type] = r.amount
    projMap[r.project_id].total += r.amount
  })

  // Merge in projects that only have labor/depr (no direct cost entries)
  labor_by_project.forEach(r => {
    if (!projMap[r.project_id]) {
      projMap[r.project_id] = { id: r.project_id, code: r.project_code, name: r.project_name, contract_value: r.contract_value || 0, types: {}, total: 0 }
    } else if (!projMap[r.project_id].contract_value && r.contract_value) {
      projMap[r.project_id].contract_value = r.contract_value
    }
  })
  depr_by_project.forEach(r => {
    if (!projMap[r.project_id]) {
      projMap[r.project_id] = { id: r.project_id, code: r.project_code, name: r.project_name, contract_value: r.contract_value || 0, types: {}, total: 0 }
    } else if (!projMap[r.project_id].contract_value && r.contract_value) {
      projMap[r.project_id].contract_value = r.contract_value
    }
  })

  const typeList = [...typeSet]
  const projects = Object.values(projMap).sort((a, b) => {
    const at = a.total + (laborMap[a.id]||0) + (deprMap[a.id]||0)
    const bt = b.total + (laborMap[b.id]||0) + (deprMap[b.id]||0)
    return bt - at
  })

  // Grand total including labor + depr
  const grandTotalAll = grand_total + total_labor + total_depr

  // ── KPI Cards ──────────────────────────────────────────────────
  const totalPctGthd = total_contract_value > 0 ? (grandTotalAll / total_contract_value * 100) : null
  // grand_total đã bao gồm chi phí chung (non-depr); tách riêng để hiển thị
  const grandDirectOnly = grand_total - total_shared_non_depr
  const kpiHtml = `
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      <div class="card text-center col-span-2 md:col-span-1 lg:col-span-2">
        <div class="text-xs text-gray-500 mb-1"><i class="fas fa-coins mr-1 text-blue-500"></i>Chi phí trực tiếp</div>
        <div class="text-xl font-black text-blue-700">${fmtM(grandDirectOnly)}</div>
        ${total_shared_non_depr > 0 ? `<div class="text-xs text-yellow-600 mt-0.5"><i class="fas fa-share-alt mr-1"></i>+${fmtM(total_shared_non_depr)} CP chung</div>` : `<div class="text-xs text-gray-400 mt-1">${period.label}</div>`}
      </div>
      <div class="card text-center">
        <div class="text-xs text-gray-500 mb-1"><i class="fas fa-users mr-1 text-green-500"></i>Chi phí lương</div>
        <div class="text-xl font-black ${total_labor > 0 ? 'text-green-700' : 'text-gray-400'}">${fmtM(total_labor)}</div>
        <div class="text-xs text-gray-400 mt-1">${total_labor > 0 ? 'Realtime từ TK lương' : '⚠ Chưa có dữ liệu kỳ này'}</div>
      </div>
      <div class="card text-center">
        <div class="text-xs text-gray-500 mb-1"><i class="fas fa-chart-area mr-1 text-orange-500"></i>Chi phí khấu hao</div>
        <div class="text-xl font-black text-orange-700">${fmtM(total_depr)}</div>
        <div class="text-xs text-gray-400 mt-1">Từ phân bổ tài sản</div>
      </div>
      <div class="card text-center">
        <div class="text-xs text-gray-500 mb-1"><i class="fas fa-layer-group mr-1 text-red-500"></i>Tổng cộng (tất cả)</div>
        <div class="text-xl font-black text-red-700">${fmtM(grandTotalAll)}</div>
        ${totalPctGthd !== null ? `<div class="text-xs mt-1 font-bold ${totalPctGthd > 100 ? 'text-red-600' : totalPctGthd > 80 ? 'text-orange-500' : 'text-indigo-600'}">${totalPctGthd.toFixed(1)}% GTHĐ</div>` : `<div class="text-xs text-gray-400 mt-1">CP trực tiếp + lương + KH</div>`}
      </div>
      ${total_contract_value > 0 ? `
      <div class="card text-center">
        <div class="text-xs text-gray-500 mb-1"><i class="fas fa-file-contract mr-1 text-indigo-500"></i>Tổng GTHĐ</div>
        <div class="text-xl font-black text-indigo-700">${fmtM(total_contract_value)}</div>
        <div class="text-xs text-gray-400 mt-1">Tất cả DA đang hoạt động · ${details.length} phiếu</div>
      </div>` : `
      <div class="card text-center">
        <div class="text-xs text-gray-500 mb-1"><i class="fas fa-tags mr-1 text-purple-500"></i>Dự án có chi phí</div>
        <div class="text-xl font-black text-purple-700">${projects.length}</div>
        <div class="text-xs text-gray-400 mt-1">${details.length} phiếu chi</div>
      </div>`}
    </div>`

  // ── Chart rows ─────────────────────────────────────────────────
  const chartHtml = `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
      <!-- Donut: % theo loại (gồm lương + KH) -->
      <div class="card">
        <h3 class="font-semibold text-gray-700 mb-3 text-sm"><i class="fas fa-chart-pie mr-2 text-blue-500"></i>Cơ cấu chi phí theo loại (bao gồm lương & khấu hao)</h3>
        <div class="flex items-center gap-4">
          <canvas id="cbDonutChart" style="max-width:220px;max-height:220px"></canvas>
          <div id="cbDonutLegend" class="text-xs space-y-1 flex-1 min-w-0"></div>
        </div>
      </div>
      <!-- Bar: top dự án -->
      <div class="card">
        <h3 class="font-semibold text-gray-700 mb-3 text-sm"><i class="fas fa-chart-bar mr-2 text-green-500"></i>Top dự án theo tổng chi phí</h3>
        <canvas id="cbBarChart" style="max-height:220px"></canvas>
      </div>
    </div>
    <!-- Stacked bar: timeline theo tháng -->
    <div class="card mb-6">
      <h3 class="font-semibold text-gray-700 mb-3 text-sm"><i class="fas fa-chart-line mr-2 text-purple-500"></i>Chi phí theo tháng — từng loại</h3>
      <canvas id="cbLineChart" style="max-height:250px"></canvas>
    </div>`

  // ── Summary table by type ──────────────────────────────────────
  // Append labor & depr as virtual rows
  const allTypeRows = [
    ...by_type,
    ...(total_labor > 0 ? [{ cost_type: '__labor__', type_name: 'Chi phí lương', color: '#10b981', entry_count: labor_by_project.length, total_amount: total_labor }] : []),
    ...(total_depr  > 0 ? [{ cost_type: '__depr__',  type_name: 'Chi phí khấu hao', color: '#f97316', entry_count: depr_by_project.length, total_amount: total_depr }] : [])
  ]
  const typeTableHtml = `
    <div class="card mb-6">
      <h3 class="font-semibold text-gray-700 mb-3 text-sm"><i class="fas fa-table mr-2 text-gray-500"></i>Tổng hợp theo loại chi phí <span class="text-xs font-normal text-gray-400">(bao gồm lương & khấu hao)</span></h3>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-gray-400 border-b text-xs">
            <th class="pb-2 pr-4">Loại chi phí</th>
            <th class="pb-2 pr-4 text-right">Số phiếu/DA</th>
            <th class="pb-2 pr-4 text-right">Tổng tiền</th>
            <th class="pb-2 pr-4 text-right">% tổng CP</th>
            ${total_contract_value > 0 ? `<th class="pb-2 pr-4 text-right text-indigo-600">% GTHĐ</th>` : ''}
            <th class="pb-2">Tỷ trọng</th>
          </tr></thead>
          <tbody class="divide-y">
            ${allTypeRows.map(t => {
              const pctVal = grandTotalAll > 0 ? (t.total_amount / grandTotalAll * 100) : 0
              const pctGthd = total_contract_value > 0 ? (t.total_amount / total_contract_value * 100) : null
              const isSpecial = t.cost_type === '__labor__' || t.cost_type === '__depr__'
              const hasShared = t.has_shared && !isSpecial
              return `<tr class="hover:bg-gray-50 ${isSpecial ? 'bg-gray-50' : ''}">
                <td class="py-2 pr-4">
                  <span class="inline-block w-3 h-3 rounded-sm mr-2" style="background:${t.color}"></span>
                  <span class="font-medium">${t.type_name}</span>
                  ${isSpecial ? '<span class="ml-1 text-xs text-gray-400 italic">(tự động)</span>' : ''}
                  ${hasShared ? '<span class="ml-1 text-xs text-yellow-600" title="Đã gộp chi phí chung"><i class="fas fa-share-alt"></i></span>' : ''}
                </td>
                <td class="py-2 pr-4 text-right text-gray-600">${t.entry_count}</td>
                <td class="py-2 pr-4 text-right font-semibold">${fmtM(t.total_amount)}</td>
                <td class="py-2 pr-4 text-right text-blue-700 font-bold">${pctVal.toFixed(1)}%</td>
                ${total_contract_value > 0 ? `<td class="py-2 pr-4 text-right font-bold ${pctGthd !== null && pctGthd > 30 ? 'text-red-600' : pctGthd !== null && pctGthd > 20 ? 'text-orange-600' : 'text-indigo-600'}">${pctGthd !== null ? pctGthd.toFixed(1)+'%' : '—'}</td>` : ''}
                <td class="py-2" style="min-width:120px">
                  <div class="bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div class="h-2 rounded-full" style="width:${Math.min(100,pctVal)}%;background:${t.color}"></div>
                  </div>
                </td>
              </tr>`
            }).join('')}
            <tr class="font-bold border-t-2 bg-blue-50">
              <td class="py-2 pr-4">Tổng cộng</td>
              <td class="py-2 pr-4 text-right"></td>
              <td class="py-2 pr-4 text-right text-blue-700">${fmtM(grandTotalAll)}</td>
              <td class="py-2 pr-4 text-right">100%</td>
              ${total_contract_value > 0 ? `<td class="py-2 pr-4 text-right font-bold ${grandTotalAll/total_contract_value*100 > 100 ? 'text-red-600' : grandTotalAll/total_contract_value*100 > 80 ? 'text-orange-600' : 'text-indigo-600'}">${(grandTotalAll/total_contract_value*100).toFixed(1)}%</td>` : ''}
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      ${total_contract_value > 0 ? `<div class="mt-2 text-xs text-gray-400"><i class="fas fa-info-circle mr-1"></i>Tổng GTHĐ các dự án có chi phí: <strong>${fmtM(total_contract_value)}</strong> — % GTHĐ = từng loại chi phí / tổng GTHĐ${total_shared_non_depr > 0 ? ` &nbsp;·&nbsp; <i class="fas fa-share-alt text-yellow-500"></i> Đã gộp <strong>${fmtM(total_shared_non_depr)}</strong> chi phí chung vào các loại tương ứng` : ''}</div>` : (total_shared_non_depr > 0 ? `<div class="mt-2 text-xs text-yellow-600"><i class="fas fa-share-alt mr-1"></i>Đã gộp <strong>${fmtM(total_shared_non_depr)}</strong> chi phí chung vào các loại tương ứng</div>` : '')}
    </div>`

  // ── Pivot table: project × cost_type + lương + KH ──────────────
  // Store pivot data for pagination
  window._cbPivotProjects   = projects
  window._cbPivotTypeList   = typeList
  window._cbPivotTypeColorMap = typeColorMap
  window._cbPivotTypeNameMap  = typeNameMap
  window._cbPivotLaborMap   = laborMap
  window._cbPivotDeprMap    = deprMap
  window._cbPivotTotalLabor    = total_labor
  window._cbPivotTotalDepr     = total_depr
  window._cbPivotByPT          = by_project_type
  window._cbPivotGrandAll      = grandTotalAll
  window._cbPivotContractValue = total_contract_value
  window._cbPivotPage          = 1
  window._cbPivotPageSize      = 15

  const pivotHtml = `
    <div class="card mb-6" id="cbPivotCard">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 class="font-semibold text-gray-700 text-sm"><i class="fas fa-th mr-2 text-indigo-500"></i>Chi tiết chi phí từng dự án × loại chi phí <span class="text-xs font-normal text-gray-400">(bao gồm lương & khấu hao)</span></h3>
        <div class="flex items-center gap-2 text-xs text-gray-500">
          <span>Số dòng/trang:</span>
          <select id="cbPivotPageSize" onchange="cbSetPivotPageSize(this.value)" class="border rounded px-1 py-0.5 text-xs">
            <option value="10">10</option>
            <option value="15" selected>15</option>
            <option value="25">25</option>
            <option value="50">50</option>
          </select>
        </div>
      </div>
      <div class="text-xs text-gray-400 mb-2"><i class="fas fa-info-circle mr-1"></i>Số tiền (màu) · <span class="text-indigo-500 font-medium">% GTHĐ</span> hiển thị bên dưới từng loại chi phí</div>
      <div class="overflow-x-auto" id="cbPivotTableWrap">
        <table class="w-full text-xs" id="cbPivotTable">
          <thead id="cbPivotThead"></thead>
          <tbody id="cbPivotTbody"></tbody>
        </table>
      </div>
      <div id="cbPivotPager" class="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t text-xs text-gray-500"></div>
    </div>`

  // ── Detail table ───────────────────────────────────────────────
  // Store details on window for pagination reuse
  window._cbDetails = details
  window._cbDetailsAll = details   // bản gốc, không thay đổi
  window._cbDetailPage = 1
  window._cbDetailPageSize = 20
  window._cbDetailFilterProject = ''
  window._cbDetailFilterType = ''

  // Build unique project list for combobox
  const detailProjects = []
  const _seenProj = new Set()
  details.forEach(d => {
    if (!_seenProj.has(d.project_code)) {
      _seenProj.add(d.project_code)
      detailProjects.push({ code: d.project_code, name: d.project_name || d.project_code })
    }
  })
  detailProjects.sort((a, b) => a.code.localeCompare(b.code))

  // Build unique type list for dropdown
  const detailTypes = []
  const _seenType = new Set()
  details.forEach(d => {
    if (!_seenType.has(d.cost_type)) {
      _seenType.add(d.cost_type)
      detailTypes.push({ code: d.cost_type, name: d.type_name, color: d.color })
    }
  })
  detailTypes.sort((a, b) => a.name.localeCompare(b.name))

  const detailHtml = `
    <div class="card" id="cbDetailCard">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 class="font-semibold text-gray-700 text-sm"><i class="fas fa-list mr-2 text-gray-500"></i>Danh sách chi phí trực tiếp <span class="text-xs font-normal text-gray-400" id="cbDetailCount">(${details.length} phiếu)</span></h3>
        <div class="flex items-center gap-2 text-xs text-gray-500">
          <span>Số dòng/trang:</span>
          <select id="cbPageSize" onchange="cbSetPageSize(this.value)" class="border rounded px-1 py-0.5 text-xs">
            <option value="10">10</option>
            <option value="20" selected>20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
      </div>
      <!-- Filter row -->
      <div class="flex flex-wrap gap-2 mb-3 p-2 bg-gray-50 rounded-lg border border-gray-100">
        <!-- Project search combobox -->
        <div class="relative flex-1 min-w-48">
          <div class="flex items-center border rounded bg-white px-2 py-1 gap-1 text-xs cursor-pointer" id="cbDetailProjBox" onclick="cbToggleDetailProjDropdown()">
            <i class="fas fa-building text-gray-400"></i>
            <span id="cbDetailProjLabel" class="flex-1 truncate text-gray-600">-- Tất cả dự án --</span>
            <i class="fas fa-chevron-down text-gray-400 text-xs"></i>
          </div>
          <div id="cbDetailProjDropdown" class="hidden absolute z-50 top-full left-0 right-0 mt-1 bg-white border rounded shadow-lg max-h-64 overflow-y-auto">
            <div class="p-1.5 border-b sticky top-0 bg-white">
              <input type="text" id="cbDetailProjSearch" placeholder="Tìm dự án..." oninput="cbFilterDetailProjList()" class="w-full border rounded px-2 py-1 text-xs outline-none">
            </div>
            <div id="cbDetailProjList">
              <div class="px-3 py-1.5 text-xs hover:bg-blue-50 cursor-pointer text-gray-500" onclick="cbSelectDetailProj('','-- Tất cả dự án --')">-- Tất cả dự án --</div>
              ${detailProjects.map(p => `<div class="px-3 py-1.5 text-xs hover:bg-blue-50 cursor-pointer" onclick="cbSelectDetailProj('${p.code}','[${p.code}] ${(p.name||'').replace(/'/g,'&#39;').replace(/"/g,'&quot;')}')">[${p.code}] ${p.name||p.code}</div>`).join('')}
            </div>
          </div>
        </div>
        <!-- Cost type dropdown -->
        <div class="flex items-center gap-1 text-xs">
          <i class="fas fa-tags text-gray-400"></i>
          <select id="cbDetailTypeFilter" onchange="cbSetDetailTypeFilter(this.value)" class="border rounded bg-white px-2 py-1 text-xs">
            <option value="">-- Tất cả loại --</option>
            ${detailTypes.map(t => `<option value="${t.code}">${t.name}</option>`).join('')}
          </select>
        </div>
        <!-- Clear filters -->
        <button onclick="cbClearDetailFilters()" class="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded border bg-white"><i class="fas fa-times mr-1"></i>Xóa lọc</button>
      </div>
      <div class="overflow-x-auto" id="cbDetailTableWrap">
        <table class="w-full text-xs">
          <thead><tr class="text-left text-gray-400 border-b">
            <th class="pb-2 pr-3 whitespace-nowrap">#</th>
            <th class="pb-2 pr-3 whitespace-nowrap">Ngày</th>
            <th class="pb-2 pr-3 whitespace-nowrap">Dự án</th>
            <th class="pb-2 pr-3 whitespace-nowrap">Loại</th>
            <th class="pb-2 pr-3">Diễn giải</th>
            <th class="pb-2 pr-3 whitespace-nowrap">Nhà cung cấp</th>
            <th class="pb-2 pr-3 whitespace-nowrap">Số HĐ</th>
            <th class="pb-2 text-right whitespace-nowrap">Số tiền</th>
          </tr></thead>
          <tbody id="cbDetailTbody"></tbody>
        </table>
      </div>
      <div id="cbDetailPager" class="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t text-xs text-gray-500"></div>
    </div>`

  el.innerHTML = kpiHtml + chartHtml + typeTableHtml + pivotHtml + detailHtml
  cbRenderPivotPage(1)
  cbRenderDetailPage(1)

  // ── Draw Charts ────────────────────────────────────────────────
  requestAnimationFrame(() => {
    // 1. Donut chart (gồm cả lương + KH)
    destroyCbChart('donut')
    const donutData = [
      ...by_type,
      ...(total_labor > 0 ? [{ type_name: 'Chi phí lương', color: '#10b981', total_amount: total_labor }] : []),
      ...(total_depr  > 0 ? [{ type_name: 'Chi phí khấu hao', color: '#f97316', total_amount: total_depr }] : [])
    ]
    const ctxD = document.getElementById('cbDonutChart')?.getContext('2d')
    if (ctxD && donutData.length) {
      _cbCharts.donut = new Chart(ctxD, {
        type: 'doughnut',
        data: {
          labels: donutData.map(t => t.type_name),
          datasets: [{ data: donutData.map(t => t.total_amount), backgroundColor: donutData.map(t => t.color), borderWidth: 2 }]
        },
        options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${fmtM(ctx.raw)} (${grandTotalAll>0?(ctx.raw/grandTotalAll*100).toFixed(1):0}%)` } } } }
      })
      const legend = $('cbDonutLegend')
      if (legend) legend.innerHTML = donutData.map(t => {
        const p = grandTotalAll > 0 ? (t.total_amount/grandTotalAll*100).toFixed(1) : '0.0'
        const pGthd = total_contract_value > 0 ? (t.total_amount/total_contract_value*100).toFixed(1) : null
        return `<div class="flex items-center gap-1.5 truncate">
          <span class="w-3 h-3 rounded-sm flex-shrink-0" style="background:${t.color}"></span>
          <span class="truncate">${t.type_name}</span>
          <span class="ml-auto font-semibold flex-shrink-0 text-blue-700">${p}%</span>
          ${pGthd !== null ? `<span class="flex-shrink-0 text-indigo-500 text-xs">(${pGthd}%HĐ)</span>` : ''}
        </div>`
      }).join('')
    }

    // 2. Bar chart – top projects (total incl. labor+depr)
    destroyCbChart('bar')
    const ctxB = document.getElementById('cbBarChart')?.getContext('2d')
    if (ctxB && projects.length) {
      const top10 = projects.slice(0, 10)
      _cbCharts.bar = new Chart(ctxB, {
        type: 'bar',
        data: {
          labels: top10.map(p => p.code),
          datasets: [
            { label: 'CP trực tiếp', data: top10.map(p => p.total), backgroundColor: 'rgba(59,130,246,0.75)', borderRadius: 3, stack: 'stack' },
            { label: 'CP lương',     data: top10.map(p => laborMap[p.id]||0), backgroundColor: 'rgba(16,185,129,0.75)', borderRadius: 3, stack: 'stack' },
            { label: 'CP khấu hao', data: top10.map(p => deprMap[p.id]||0), backgroundColor: 'rgba(249,115,22,0.75)', borderRadius: 3, stack: 'stack' },
            { label: 'GTHĐ', data: top10.map(p => p.contract_value||0), backgroundColor: 'rgba(99,102,241,0.25)', borderRadius: 3, type: 'bar' }
          ]
        },
        options: {
          responsive: true, indexAxis: 'y',
          plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10 } }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtM(ctx.raw)}` } } },
          scales: { x: { ticks: { callback: v => fmtM(v), font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } }
        }
      })
    }

    // 3. Stacked bar – monthly timeline
    destroyCbChart('line')
    const ctxL = document.getElementById('cbLineChart')?.getContext('2d')
    if (ctxL && timeline.length) {
      const months = [...new Set(timeline.map(r => r.month))].sort()
      const types  = [...new Set(timeline.map(r => r.cost_type))]
      const typeColors2 = {}
      timeline.forEach(r => typeColors2[r.cost_type] = { color: r.color, name: r.type_name })

      _cbCharts.line = new Chart(ctxL, {
        type: 'bar',
        data: {
          labels: months,
          datasets: types.map(t => ({
            label: typeColors2[t]?.name || t,
            data: months.map(m => { const row = timeline.find(r => r.month === m && r.cost_type === t); return row?.amount || 0 }),
            backgroundColor: typeColors2[t]?.color || '#6B7280',
            borderRadius: 3, stack: 'stack'
          }))
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtM(ctx.raw)}` } } },
          scales: { x: { stacked: true, ticks: { font: { size: 10 } } }, y: { stacked: true, ticks: { callback: v => fmtM(v), font: { size: 10 } } } }
        }
      })
    }
  })
}

// ── Detail table filter helpers ──────────────────────────────
function cbToggleDetailProjDropdown() {
  const dd = document.getElementById('cbDetailProjDropdown')
  if (!dd) return
  dd.classList.toggle('hidden')
  if (!dd.classList.contains('hidden')) {
    const inp = document.getElementById('cbDetailProjSearch')
    if (inp) { inp.value = ''; cbFilterDetailProjList(); inp.focus() }
  }
}
function cbFilterDetailProjList() {
  const q = (document.getElementById('cbDetailProjSearch')?.value || '').toLowerCase()
  const items = document.querySelectorAll('#cbDetailProjList > div')
  items.forEach(el => {
    el.style.display = !q || el.textContent.toLowerCase().includes(q) ? '' : 'none'
  })
}
function cbSelectDetailProj(code, label) {
  window._cbDetailFilterProject = code
  const lbl = document.getElementById('cbDetailProjLabel')
  if (lbl) { lbl.textContent = label; lbl.className = code ? 'flex-1 truncate text-blue-600 font-medium' : 'flex-1 truncate text-gray-600' }
  const dd = document.getElementById('cbDetailProjDropdown')
  if (dd) dd.classList.add('hidden')
  cbApplyDetailFilter()
}
function cbSetDetailTypeFilter(val) {
  window._cbDetailFilterType = val
  cbApplyDetailFilter()
}
function cbClearDetailFilters() {
  window._cbDetailFilterProject = ''
  window._cbDetailFilterType = ''
  const lbl = document.getElementById('cbDetailProjLabel')
  if (lbl) { lbl.textContent = '-- Tất cả dự án --'; lbl.className = 'flex-1 truncate text-gray-600' }
  const typeSelect = document.getElementById('cbDetailTypeFilter')
  if (typeSelect) typeSelect.value = ''
  cbApplyDetailFilter()
}
function cbApplyDetailFilter() {
  const all = window._cbDetailsAll || []
  const projFilter = window._cbDetailFilterProject || ''
  const typeFilter = window._cbDetailFilterType || ''
  let filtered = all
  if (projFilter) filtered = filtered.filter(d => d.project_code === projFilter)
  if (typeFilter) filtered = filtered.filter(d => d.cost_type === typeFilter)
  window._cbDetails = filtered
  cbRenderDetailPage(1)
}
// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  const box = document.getElementById('cbDetailProjBox')
  const dd  = document.getElementById('cbDetailProjDropdown')
  if (dd && box && !box.contains(e.target) && !dd.contains(e.target)) dd.classList.add('hidden')
}, true)

// ── Detail table pagination helpers ───────────────────────────
function cbRenderDetailPage(page) {
  const details  = window._cbDetails || []
  const pageSize = window._cbDetailPageSize || 20
  const total    = details.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  page = Math.max(1, Math.min(page, totalPages))
  window._cbDetailPage = page

  const start = (page - 1) * pageSize
  const end   = Math.min(start + pageSize, total)
  const slice = details.slice(start, end)

  const tbody = document.getElementById('cbDetailTbody')
  if (!tbody) return
  tbody.innerHTML = slice.map((d, i) => `<tr class="hover:bg-gray-50">
    <td class="py-1.5 pr-3 text-gray-400">${start + i + 1}</td>
    <td class="py-1.5 pr-3 whitespace-nowrap">${fmtDate(d.cost_date)}</td>
    <td class="py-1.5 pr-3 whitespace-nowrap"><span class="text-gray-400">[${d.project_code}]</span> <span class="text-gray-600">${d.project_name ? (d.project_name.length > 20 ? d.project_name.substring(0,20)+'…' : d.project_name) : ''}</span></td>
    <td class="py-1.5 pr-3 whitespace-nowrap">
      <span class="inline-block px-1.5 py-0.5 rounded text-white text-xs" style="background:${d.color}">${d.type_name}</span>
    </td>
    <td class="py-1.5 pr-3 max-w-xs truncate" title="${(d.description||'').replace(/"/g,'&quot;')}">${d.description||'—'}</td>
    <td class="py-1.5 pr-3 text-gray-500 whitespace-nowrap">${d.vendor||'—'}</td>
    <td class="py-1.5 pr-3 text-gray-500 whitespace-nowrap">${d.invoice_number||'—'}</td>
    <td class="py-1.5 text-right font-semibold whitespace-nowrap">${fmt(d.amount)}</td>
  </tr>`).join('')

  // Update count label
  const countEl = document.getElementById('cbDetailCount')
  const allCount = (window._cbDetailsAll || []).length
  const isFiltered = total < allCount
  if (countEl) countEl.textContent = isFiltered ? `(${total} / ${allCount} phiếu — trang ${page}/${totalPages})` : `(${total} phiếu — trang ${page}/${totalPages})`

  // Render pager
  const pager = document.getElementById('cbDetailPager')
  if (!pager) return
  const pageWindow = 2
  let btns = ''
  // Prev
  btns += `<button onclick="cbRenderDetailPage(${page-1})" ${page<=1?'disabled':''} class="px-2 py-1 rounded border text-xs ${page<=1?'text-gray-300 cursor-not-allowed':'hover:bg-gray-100'}"><i class="fas fa-chevron-left"></i> Trước</button>`
  // Page buttons
  const pagesHtml = []
  if (page > pageWindow + 1) pagesHtml.push(`<button onclick="cbRenderDetailPage(1)" class="px-2 py-1 rounded border text-xs hover:bg-gray-100">1</button>`)
  if (page > pageWindow + 2) pagesHtml.push(`<span class="px-1 text-gray-400">…</span>`)
  for (let p = Math.max(1, page - pageWindow); p <= Math.min(totalPages, page + pageWindow); p++) {
    pagesHtml.push(`<button onclick="cbRenderDetailPage(${p})" class="px-2 py-1 rounded border text-xs ${p===page?'bg-blue-500 text-white border-blue-500':'hover:bg-gray-100'}">${p}</button>`)
  }
  if (page < totalPages - pageWindow - 1) pagesHtml.push(`<span class="px-1 text-gray-400">…</span>`)
  if (page < totalPages - pageWindow) pagesHtml.push(`<button onclick="cbRenderDetailPage(${totalPages})" class="px-2 py-1 rounded border text-xs hover:bg-gray-100">${totalPages}</button>`)
  btns += pagesHtml.join('')
  // Next
  btns += `<button onclick="cbRenderDetailPage(${page+1})" ${page>=totalPages?'disabled':''} class="px-2 py-1 rounded border text-xs ${page>=totalPages?'text-gray-300 cursor-not-allowed':'hover:bg-gray-100'}">Tiếp <i class="fas fa-chevron-right"></i></button>`

  const rangeInfo = `<span class="text-gray-400">Hiển thị ${start+1}–${end} / ${total} phiếu</span>`
  pager.innerHTML = rangeInfo + `<div class="flex items-center gap-1">${btns}</div>`
}

function cbSetPageSize(val) {
  window._cbDetailPageSize = parseInt(val) || 20
  cbRenderDetailPage(1)
}
// ── END detail table pagination ────────────────────────────────

// ── Pivot table pagination helpers ────────────────────────────
function cbRenderPivotPage(page) {
  const projects   = window._cbPivotProjects   || []
  const typeList   = window._cbPivotTypeList   || []
  const typeColorMap = window._cbPivotTypeColorMap || {}
  const typeNameMap  = window._cbPivotTypeNameMap  || {}
  const laborMap   = window._cbPivotLaborMap   || {}
  const deprMap    = window._cbPivotDeprMap    || {}
  const total_labor        = window._cbPivotTotalLabor    || 0
  const total_depr         = window._cbPivotTotalDepr     || 0
  const by_project_type    = window._cbPivotByPT          || []
  const grandTotalAll      = window._cbPivotGrandAll      || 0
  const total_contract_value = window._cbPivotContractValue || 0
  const pageSize   = window._cbPivotPageSize   || 15
  const total      = projects.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  page = Math.max(1, Math.min(page, totalPages))
  window._cbPivotPage = page

  const start = (page - 1) * pageSize
  const end   = Math.min(start + pageSize, total)
  const slice = projects.slice(start, end)

  // Render thead
  const thead = document.getElementById('cbPivotThead')
  if (thead) {
    thead.innerHTML = `<tr class="text-left text-gray-400 border-b">
      <th class="pb-2 pr-3 whitespace-nowrap">#</th>
      <th class="pb-2 pr-3 whitespace-nowrap">Dự án</th>
      <th class="pb-2 pr-3 text-right whitespace-nowrap">GTHĐ</th>
      ${typeList.map(t => `<th class="pb-2 pr-3 text-right whitespace-nowrap" style="color:${typeColorMap[t]}">${typeNameMap[t]||t}</th>`).join('')}
      ${total_labor > 0 ? `<th class="pb-2 pr-3 text-right whitespace-nowrap text-green-600">CP Lương</th>` : ''}
      ${total_depr  > 0 ? `<th class="pb-2 pr-3 text-right whitespace-nowrap text-orange-600">CP Khấu hao</th>` : ''}
      <th class="pb-2 pr-3 text-right whitespace-nowrap font-bold text-blue-700">Tổng CP</th>
      <th class="pb-2 text-right whitespace-nowrap">% GTHĐ</th>
    </tr>`
  }

  // Render tbody (page slice)
  const tbody = document.getElementById('cbPivotTbody')
  if (!tbody) return
  tbody.innerHTML = slice.map((p, i) => {
    const labor    = laborMap[p.id] || 0
    const depr     = deprMap[p.id]  || 0
    const rowTotal = p.total + labor + depr
    const pctGthd  = p.contract_value > 0 ? (rowTotal / p.contract_value * 100) : null
    const pctColor = pctGthd === null ? 'text-gray-400' : pctGthd > 100 ? 'text-red-600 font-bold' : pctGthd > 80 ? 'text-orange-600' : 'text-green-600'
    const cv = p.contract_value || 0
    return `<tr class="hover:bg-gray-50">
      <td class="py-2 pr-3 text-gray-400 whitespace-nowrap">${start + i + 1}</td>
      <td class="py-2 pr-3 font-medium whitespace-nowrap">
        <span class="text-gray-400 text-xs">[${p.code}]</span> ${p.name.length>28?p.name.substring(0,28)+'…':p.name}
      </td>
      <td class="py-2 pr-3 text-right text-gray-500">${cv > 0 ? fmtM(cv) : '—'}</td>
      ${typeList.map(t => {
        const amt = p.types[t] || 0
        const pct = cv > 0 && amt > 0 ? (amt/cv*100).toFixed(1)+'%' : ''
        return `<td class="py-2 pr-3 text-right">${amt > 0 ? `<div>${fmtM(amt)}</div>${pct ? `<div class="text-indigo-500 font-semibold">${pct}</div>` : ''}` : '<span class="text-gray-300">—</span>'}</td>`
      }).join('')}
      ${total_labor > 0 ? (() => {
        const pct = cv > 0 && labor > 0 ? (labor/cv*100).toFixed(1)+'%' : ''
        return `<td class="py-2 pr-3 text-right font-medium text-green-700">${labor > 0 ? `<div>${fmtM(labor)}</div>${pct ? `<div class="text-indigo-500 font-semibold">${pct}</div>` : ''}` : '<span class="text-gray-300">—</span>'}</td>`
      })() : ''}
      ${total_depr > 0 ? (() => {
        const pct = cv > 0 && depr > 0 ? (depr/cv*100).toFixed(1)+'%' : ''
        return `<td class="py-2 pr-3 text-right font-medium text-orange-700">${depr > 0 ? `<div>${fmtM(depr)}</div>${pct ? `<div class="text-indigo-500 font-semibold">${pct}</div>` : ''}` : '<span class="text-gray-300">—</span>'}</td>`
      })() : ''}
      <td class="py-2 pr-3 text-right font-bold text-blue-700">${fmtM(rowTotal)}</td>
      <td class="py-2 text-right ${pctColor}">${pctGthd !== null ? pctGthd.toFixed(1)+'%' : '—'}</td>
    </tr>`
  }).join('')

  // Footer total row (always shown)
  tbody.innerHTML += `<tr class="font-bold border-t-2 bg-blue-50 text-sm">
    <td class="py-2 pr-3 text-gray-400 text-xs">Tổng</td>
    <td class="py-2 pr-3">Tất cả ${total} dự án</td>
    <td class="py-2 pr-3 text-right">${fmtM(projects.reduce((s,p)=>s+(p.contract_value||0),0))}</td>
    ${typeList.map(t => {
      const sum = by_project_type.filter(r=>r.cost_type===t).reduce((s,r)=>s+r.amount,0)
      return `<td class="py-2 pr-3 text-right" style="color:${typeColorMap[t]}">${fmtM(sum)}</td>`
    }).join('')}
    ${total_labor > 0 ? `<td class="py-2 pr-3 text-right text-green-700">${fmtM(total_labor)}</td>` : ''}
    ${total_depr  > 0 ? `<td class="py-2 pr-3 text-right text-orange-700">${fmtM(total_depr)}</td>` : ''}
    <td class="py-2 pr-3 text-right text-blue-700">${fmtM(grandTotalAll)}</td>
    <td class="py-2 text-right font-bold ${total_contract_value > 0 ? (grandTotalAll/total_contract_value*100 > 100 ? 'text-red-600' : grandTotalAll/total_contract_value*100 > 80 ? 'text-orange-600' : 'text-indigo-600') : 'text-gray-400'}">${total_contract_value > 0 ? (grandTotalAll/total_contract_value*100).toFixed(1)+'%' : '—'}</td>
  </tr>`

  // Pager
  const pager = document.getElementById('cbPivotPager')
  if (!pager) return
  if (totalPages <= 1) { pager.innerHTML = `<span class="text-gray-400">${total} dự án</span>`; return }
  const pw = 2
  let btns = `<button onclick="cbRenderPivotPage(${page-1})" ${page<=1?'disabled':''} class="px-2 py-1 rounded border text-xs ${page<=1?'text-gray-300 cursor-not-allowed':'hover:bg-gray-100'}"><i class="fas fa-chevron-left"></i> Trước</button>`
  const pagesHtml = []
  if (page > pw+1) pagesHtml.push(`<button onclick="cbRenderPivotPage(1)" class="px-2 py-1 rounded border text-xs hover:bg-gray-100">1</button>`)
  if (page > pw+2) pagesHtml.push(`<span class="px-1 text-gray-400">…</span>`)
  for (let p2 = Math.max(1,page-pw); p2 <= Math.min(totalPages,page+pw); p2++) {
    pagesHtml.push(`<button onclick="cbRenderPivotPage(${p2})" class="px-2 py-1 rounded border text-xs ${p2===page?'bg-blue-500 text-white border-blue-500':'hover:bg-gray-100'}">${p2}</button>`)
  }
  if (page < totalPages-pw-1) pagesHtml.push(`<span class="px-1 text-gray-400">…</span>`)
  if (page < totalPages-pw) pagesHtml.push(`<button onclick="cbRenderPivotPage(${totalPages})" class="px-2 py-1 rounded border text-xs hover:bg-gray-100">${totalPages}</button>`)
  btns += pagesHtml.join('')
  btns += `<button onclick="cbRenderPivotPage(${page+1})" ${page>=totalPages?'disabled':''} class="px-2 py-1 rounded border text-xs ${page>=totalPages?'text-gray-300 cursor-not-allowed':'hover:bg-gray-100'}">Tiếp <i class="fas fa-chevron-right"></i></button>`
  pager.innerHTML = `<span class="text-gray-400">Hiển thị ${start+1}–${end} / ${total} dự án (trang ${page}/${totalPages})</span><div class="flex items-center gap-1">${btns}</div>`
}

function cbSetPivotPageSize(val) {
  window._cbPivotPageSize = parseInt(val) || 15
  cbRenderPivotPage(1)
}
// ── END pivot table pagination ─────────────────────────────────

async function exportCostBreakdownExcel() {
  if (typeof XLSX === 'undefined') { toast('Thư viện XLSX chưa được tải', 'error'); return }
  const year   = $('cbYear')?.value || String(new Date().getFullYear())
  const projId = _cbGetValue('cbProjectCombobox')
  const costType = $('cbCostType')?.value || ''
  let q = `/analytics/cost-breakdown?year=${year}`
  if (projId)   q += `&project_id=${projId}`
  if (costType) q += `&cost_type=${costType}`

  toast('Đang xuất Excel...', 'info')
  try {
    const data = await api(q)
    const wb = XLSX.utils.book_new()
    const totalCv = data.total_contract_value || 0
    const grandAll = (data.grand_total||0) + (data.total_labor||0) + (data.total_depr||0)

    // Sheet 1: Tổng hợp theo loại
    const s1 = [['Loại chi phí','Số phiếu','Tổng tiền','% Tổng CP', totalCv > 0 ? '% GTHĐ' : null].filter(Boolean)]
    const allRows = [
      ...data.by_type,
      ...(data.total_labor > 0 ? [{ type_name: 'Chi phí lương', entry_count: (data.labor_by_project||[]).length, total_amount: data.total_labor }] : []),
      ...(data.total_depr  > 0 ? [{ type_name: 'Chi phí khấu hao', entry_count: (data.depr_by_project||[]).length, total_amount: data.total_depr }] : [])
    ]
    allRows.forEach(t => {
      const row = [t.type_name, t.entry_count, t.total_amount, grandAll > 0 ? +(t.total_amount/grandAll*100).toFixed(2) : 0]
      if (totalCv > 0) row.push(+(t.total_amount/totalCv*100).toFixed(2))
      s1.push(row)
    })
    const totRow = ['Tổng cộng', allRows.reduce((s,t)=>s+t.entry_count,0), grandAll, 100]
    if (totalCv > 0) totRow.push(+(grandAll/totalCv*100).toFixed(2))
    s1.push(totRow)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), 'Tổng hợp theo loại')

    // Sheet 2: Chi tiết
    const s2 = [['Ngày','Dự án','Mã DA','Loại CP','Diễn giải','Nhà cung cấp','Số HĐ','Số tiền']]
    data.details.forEach(d => s2.push([d.cost_date, d.project_name, d.project_code, d.type_name, d.description||'', d.vendor||'', d.invoice_number||'', d.amount]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2), 'Chi tiết chi phí')

    XLSX.writeFile(wb, `chi-phi-theo-loai-NTC${year}.xlsx`)
    toast('Xuất Excel thành công!', 'success')
  } catch(e) {
    toast('Lỗi xuất Excel: ' + e.message, 'error')
  }
}
// ═══ END COST BREAKDOWN MODULE ═══════════════════════════════════════════════
