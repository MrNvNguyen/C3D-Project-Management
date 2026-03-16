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
let allCosts = []
let allRevenues = []
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
const fmtMoney = (n) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', notation: 'compact', maximumFractionDigits: 1 }).format(n || 0)
const fmtDate = (d) => d ? dayjs(d).format('DD/MM/YYYY') : '-'
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

function closeModal(id) {
  $(id).style.display = 'none'
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

function getRoleLabel(role) {
  const map = { system_admin: 'System Admin', project_admin: 'Project Admin', project_leader: 'Project Leader', member: 'Member' }
  return map[role] || role
}

function getStatusBadge(status) {
  const labels = { todo: 'Chờ làm', in_progress: 'Đang làm', review: 'Đang duyệt', completed: 'Hoàn thành', cancelled: 'Đã hủy', active: 'Hoạt động', planning: 'Lập kế hoạch', on_hold: 'Tạm dừng' }
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`
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
  const m = { salary: 'Lương', equipment: 'Thiết bị', material: 'Vật liệu', travel: 'Đi lại', office: 'Văn phòng', other: 'Khác' }
  return m[t] || t
}

function isOverdue(task) {
  return task.due_date && task.due_date < today() && !['completed','review','cancelled'].includes(task.status)
}

function getProjectTypeName(t) {
  const m = { building: 'Công trình', infrastructure: 'Hạ tầng', transport: 'Giao thông', energy: 'Năng lượng' }
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

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))

  const pageEl = $(`page-${page}`)
  if (pageEl) pageEl.classList.add('active')

  const navEl = document.querySelector(`[onclick="navigate('${page}')"]`)
  if (navEl) navEl.classList.add('active')

  const breadcrumbs = {
    dashboard: 'Dashboard', projects: 'Dự án', 'project-detail': 'Chi tiết dự án',
    tasks: 'Công việc', timesheet: 'Timesheet', gantt: 'Tiến độ Gantt',
    costs: 'Chi phí & Doanh thu', assets: 'Tài sản', users: 'Nhân sự', profile: 'Hồ sơ',
    productivity: 'Năng suất nhân sự', 'finance-project': 'Tài chính dự án',
    'labor-cost': 'Chi phí lương', 'cost-types': 'Loại chi phí',
    'system-config': 'Cấu hình hệ thống', analytics: 'Báo cáo & Phân tích'
  }
  $('breadcrumb').textContent = breadcrumbs[page] || page

  if (page === 'dashboard') loadDashboard()
  else if (page === 'projects') loadProjects()
  else if (page === 'tasks') loadTasks()
  else if (page === 'timesheet') loadTimesheets()
  else if (page === 'gantt') loadGantt()
  else if (page === 'costs') loadCostDashboard()
  else if (page === 'assets') loadAssets()
  else if (page === 'users') loadUsers()
  else if (page === 'profile') loadProfile()
  else if (page === 'productivity') loadProductivity()
  else if (page === 'finance-project') { loadFinanceProjectPage() }
  else if (page === 'labor-cost') loadLaborCost()
  else if (page === 'cost-types') loadCostTypes()
  else if (page === 'system-config') loadSystemConfig()
  else if (page === 'analytics') loadAnalytics()

  closeAllDropdowns()
}

function toggleSidebar() {
  $('sidebar').classList.toggle('collapsed')
  $('mainContent').classList.toggle('expanded')
}

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

  // Chỉ system_admin mới được tạo dự án mới
  if (currentUser.role === 'system_admin') {
    $('adminNav').style.display = 'block'
    $('btnNewProject').classList.remove('hidden')
  } else if (currentUser.role === 'project_admin') {
    // project_admin: không tạo được dự án, chỉ quản lý dự án được phân công
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

  // Preload allProjects để populate _projectRoleCache sớm nhất có thể
  // (quan trọng: giúp task/timesheet pages biết effective role của user)
  try {
    allProjects = await api('/projects')
    refreshProjectRoleCache()
  } catch (e) { /* ignore */ }

  initDatetimeClock()
  loadDashboard()
  loadNotifications()
  setInterval(loadNotifications, 30000)  // Poll every 30s for chat notifications
}

// ================================================================
// DASHBOARD
// ================================================================
async function loadDashboard() {
  try {
    const data = await api('/dashboard/stats')
    const { stats, monthly_hours, project_progress, discipline_breakdown, member_productivity } = data

    // Tổng dự án = planning + active + on_hold (không tính cancelled, completed, đã xóa)
    $('kpiProjects').textContent = stats.total_projects
    $('kpiActiveProjects').textContent = stats.active_projects
    $('kpiTasks').textContent = stats.total_tasks
    $('kpiCompleted').textContent = stats.completed_tasks
    $('kpiOverdue').textContent = stats.overdue_tasks
    $('kpiRate').textContent = stats.completion_rate + '%'
    if ($('kpiUsers')) $('kpiUsers').textContent = stats.total_users || 0
    if ($('kpiAssets')) $('kpiAssets').textContent = stats.total_assets || 0

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

    renderProductivityChart(member_productivity)
    renderDisciplineChart(discipline_breakdown)
    renderHoursChart(monthly_hours)
    renderProjectProgressList(project_progress)
    renderRecentTasksTable(project_progress)
  } catch (e) {
    console.error('Dashboard error:', e)
  }
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
  const top10 = data.slice(0, 8)
  // Dashboard passes simpler data (total_tasks, completed_tasks, total_hours)
  // Compute completion_rate on the fly if not present
  const getRate = u => u.completion_rate != null ? u.completion_rate
    : (u.total_tasks > 0 ? Math.round((u.completed_tasks || 0) / u.total_tasks * 100) : 0)
  charts['productivity'] = safeChart(ctx, {
    type: 'bar',
    data: {
      labels: top10.map(u => u.full_name?.split(' ').pop() || u.full_name),
      datasets: [
        { label: '% Hoàn Thành',  data: top10.map(getRate),                    backgroundColor: '#00A651', borderRadius: 4 },
        { label: 'Chính xác (%)', data: top10.map(u => u.ontime_rate    || 0), backgroundColor: '#0066CC', borderRadius: 4 },
        { label: 'Năng suất (%)', data: top10.map(u => u.productivity   || 0), backgroundColor: '#F59E0B', borderRadius: 4 },
        { label: 'Điểm',          data: top10.map(u => u.score          || 0), backgroundColor: '#8B5CF6', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
      scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } }
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
  const months = data?.map(d => d.month) || []
  charts['hours'] = safeChart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        { label: 'Giờ hành chính', data: data?.map(d => d.regular || 0) || [], borderColor: '#00A651', backgroundColor: 'rgba(0,166,81,0.1)', fill: true, tension: 0.4 },
        { label: 'Tăng ca', data: data?.map(d => d.overtime || 0) || [], borderColor: '#FF6B00', backgroundColor: 'rgba(255,107,0,0.1)', fill: true, tension: 0.4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
      scales: { y: { beginAtZero: true } }
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

async function loadNotifications() {
  try {
    const [notifs, unreadChat] = await Promise.all([
      api('/notifications'),
      api('/messages/unread').catch(() => [])
    ])

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
              <p class="text-xs text-gray-400 mt-1">${dayjs(n.created_at).format('DD/MM HH:mm')}</p>
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
      minWidth: '190px',
      onchange: () => loadTimesheets()
    })

    // Cost/Revenue project filter
    createCombobox('costProjectFilterCombobox', {
      placeholder: 'Tất cả dự án',
      items: projItems,
      value: '',
      minWidth: '180px',
      onchange: () => loadCostDashboard()
    })

    // Finance-by-project selector
    createCombobox('finProjSelectCombobox', {
      placeholder: '-- Chọn dự án --',
      items: projItems,
      value: '',
      minWidth: '220px',
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
      minWidth: '190px',
      onchange: () => filterProjects()
    })

  } catch (e) { toast('Lỗi tải dự án: ' + e.message, 'error') }
}

function renderProjectsGrid(projects) {
  const grid = $('projectsGrid')
  if (!grid) return

  // Sắp xếp A-Z theo mã dự án (cả hai view)
  const sorted = [...projects].sort((a, b) => (a.code || '').localeCompare(b.code || ''))

  const typeColors = {
    building:       '#0066CC',
    infrastructure: '#F59E0B',
    transport:      '#8B5CF6',
    energy:         '#EF4444'
  }

  /* ── CARD VIEW (style cũ, sort A-Z theo mã) ──────── */
  if (_projectViewMode === 'card') {
    grid.className = 'card-view'
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
    }).join('') || `<div class="col-span-3 text-center py-12 text-gray-400">
      <i class="fas fa-project-diagram text-5xl mb-3"></i><p>Chưa có dự án nào</p>
    </div>`

  /* ── LIST / DETAIL VIEW (bảng cột, sort A-Z theo mã) */
  } else {
    grid.className = 'list-view'
    if (!sorted.length) {
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

    const canEdit = ['system_admin', 'project_admin', 'project_leader'].includes(effectiveRole)
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

    const total = tasks.length
    const done = tasks.filter(t => t.status === 'completed' || t.status === 'review').length
    const overdue = tasks.filter(t => isOverdue(t)).length
    const pct = total > 0 ? Math.round((done / total) * 100) : 0

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
            ${canEdit ? `<button onclick="openTaskModal(null, ${project.id})" class="btn-primary text-xs px-3 py-1.5"><i class="fas fa-plus mr-1"></i>Tạo task</button>` : ''}
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
              <tbody class="divide-y">
                ${tasks.length ? tasks.map(t => `<tr class="${isOverdue(t) ? 'overdue-row' : 'table-row'}" onclick="openTaskDetail(${t.id})" style="cursor:pointer">
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
                </tr>`).join('') : `<tr><td colspan="7" class="py-8 text-center text-gray-400 text-sm">Chưa có task nào trong dự án này</td></tr>`}
              </tbody>
            </table>
          </div>
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
  $('projectDesc').value = project?.description || ''
  $('projectClient').value = project?.client || ''
  $('projectType').value = project?.project_type || 'building'
  $('projectStartDate').value = project?.start_date || ''
  $('projectEndDate').value = project?.end_date || ''
  $('projectContractValue').value = project?.contract_value || ''
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
    description: $('projectDesc').value, client: $('projectClient').value,
    project_type: $('projectType').value, status: $('projectStatus').value,
    start_date: $('projectStartDate').value, end_date: $('projectEndDate').value,
    contract_value: currentUser?.role === 'system_admin' ? (parseFloat($('projectContractValue').value) || 0) : undefined,
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
function openAddMemberModal(projectId) {
  $('memberProjectId').value = projectId
  $('memberUserId').innerHTML = '<option value="">-- Chọn nhân viên --</option>' +
    allUsers.map(u => `<option value="${u.id}">${u.full_name} (${getRoleLabel(u.role)})</option>`).join('')
  openModal('addMemberModal')
}

async function addMemberToProject() {
  const projectId = $('memberProjectId').value
  const userId = $('memberUserId').value
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

    // Build project combobox
    createCombobox('taskProjectCombobox', {
      placeholder: 'Tất cả dự án',
      items: allProjects.map(p => ({ value: String(p.id), label: `${p.code} – ${p.name}` })),
      value: '',
      minWidth: '180px',
      onchange: (val) => onTaskProjectFilterChange(val)
    })

    // Fill discipline filter
    const df = $('taskDisciplineFilter')
    if (df && allDisciplines.length) {
      df.innerHTML = '<option value="">Tất cả bộ môn</option>' + allDisciplines.map(d => `<option value="${d.code}">${d.code} - ${d.name}</option>`).join('')
    }

    // Build category combobox (all categories from loaded tasks)
    updateTaskCategoryFilter()

    renderTasksTable(allTasks)
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

  _cbState[id] = {
    value: initVal,
    label: _cbLabelFor(items, initVal, placeholder),
    items,
    placeholder,
    onchange: options.onchange || null
  }

  container.innerHTML = _cbHTML(id, placeholder, minWidth)
  _cbRenderOptions(id, '')
  _cbUpdateTrigger(id)
}

function _cbLabelFor(items, value, placeholder) {
  if (!value) return placeholder
  const found = items.find(i => String(i.value) === String(value))
  return found ? found.label : placeholder
}

function _cbHTML(id, placeholder, minWidth) {
  const triggerStyle = 'display:flex;align-items:center;justify-content:space-between;gap:6px;border:1px solid #d1d5db;border-radius:8px;padding:6px 10px;background:#fff;cursor:pointer;font-size:13px;color:#374151;min-height:36px;user-select:none'
  const panelStyle = 'display:none;position:absolute;top:calc(100% + 4px);left:0;min-width:100%;width:max-content;max-width:320px;background:#fff;border:1px solid #d1d5db;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;overflow:hidden'
  const searchStyle = 'width:100%;border:1px solid #e5e7eb;border-radius:6px;padding:5px 10px 5px 28px;font-size:12px;outline:none;color:#374151;background:#f9fafb;box-sizing:border-box'
  const optsStyle = 'max-height:220px;overflow-y:auto;padding:4px 0'
  return '<div id="' + id + '_wrap" style="position:relative;min-width:' + minWidth + ';display:inline-block">'
    + '<div style="' + triggerStyle + '" onclick="_cbToggle(\'' + id + '\')">'
    + '<span id="' + id + '_label" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9ca3af">' + placeholder + '</span>'
    + '<span id="' + id + '_arrow" style="flex-shrink:0;font-size:10px;color:#9ca3af">&#9660;</span>'
    + '</div>'
    + '<div id="' + id + '_panel" style="' + panelStyle + '">'
    + '<div style="padding:8px 8px 6px;border-bottom:1px solid #f0f0f0">'
    + '<input id="' + id + '_search" type="text" placeholder="\uD83D\uDD0D T\u00ecm ki\u1EBFm..." style="' + searchStyle + '" oninput="_cbFilter(\'' + id + '\',this.value)" onclick="event.stopPropagation()" autocomplete="off">'
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
  if (!filtered.length) {
    opts.innerHTML = '<div style="padding:10px 12px;font-size:12px;color:#9ca3af;font-style:italic">Kh\u00f4ng t\u00ecm th\u1EA5y k\u1EBFt qu\u1EA3</div>'
    return
  }
  opts.innerHTML = filtered.map(i => {
    const isSel = String(i.value) === String(state.value)
    const bg = isSel ? '#f0fdf4' : 'transparent'
    const col = isSel ? '#00A651' : '#374151'
    const fw = isSel ? '600' : '400'
    const sv = String(i.value).replace(/'/g, '&#39;')
    const sl = i.label.replace(/'/g, '&#39;')
    return '<div style="padding:7px 12px;font-size:13px;cursor:pointer;display:flex;align-items:center;background:' + bg + ';color:' + col + ';font-weight:' + fw + '"'
      + ' onmouseenter="this.style.background=\'#f0fdf4\';this.style.color=\'#00A651\'"'
      + ' onmouseleave="this.style.background=\'' + bg + '\';this.style.color=\'' + col + '\'"'
      + ' onclick="_cbSelect(\'' + id + '\',\'' + sv + '\',\'' + sl + '\')">'
      + i.label
      + (isSel ? '<span style="margin-left:auto;font-size:11px">&#10003;</span>' : '')
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

function _cbToggle(id) {
  const panel = $(id + '_panel')
  const arrow = $(id + '_arrow')
  if (!panel) return
  const isOpen = panel.style.display !== 'none'
  // Close all other panels
  document.querySelectorAll('[id$="_panel"]').forEach(p => {
    if (p !== panel && p.style && p.style.display !== 'none') {
      p.style.display = 'none'
      const a = document.getElementById(p.id.replace('_panel', '_arrow'))
      if (a) a.style.transform = ''
    }
  })
  if (isOpen) {
    panel.style.display = 'none'
    if (arrow) arrow.style.transform = ''
  } else {
    panel.style.display = 'block'
    if (arrow) arrow.style.transform = 'rotate(180deg)'
    const search = $(id + '_search')
    if (search) { search.value = ''; setTimeout(() => search.focus(), 30) }
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
  if (panel) panel.style.display = 'none'
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
  if (!e.target.closest('[id$="_wrap"]')) {
    document.querySelectorAll('[id$="_panel"]').forEach(p => {
      if (p.style && p.style.display !== 'none') {
        p.style.display = 'none'
        const a = document.getElementById(p.id.replace('_panel', '_arrow'))
        if (a) a.style.transform = ''
      }
    })
  }
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
      minWidth: '180px',
      onchange: () => filterTasks()
    })
  }

  // Show the wrapper
  wrapper.style.display = ''
}


function renderTasksTable(tasks) {
  const tbody = $('tasksTable')
  if (!tbody) return
  const effGlobal = getEffectiveGlobalRole()

  if (!tasks.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="text-center py-8 text-gray-400">Không có task nào</td></tr>'
    return
  }

  tbody.innerHTML = tasks.map(t => {
    const isAssigned = t.assigned_to === currentUser?.id
    const effForTask = getEffectiveRoleForProject(t.project_id)
    const canEditThisTask = ['system_admin','project_admin','project_leader'].includes(effForTask) || isAssigned
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
      <td colspan="12" class="p-0">
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

    renderSubtaskPanel(taskId, subtasks, canAddSubtask)
  } catch(e) {
    panel.innerHTML = `<div class="py-3 px-4 text-red-400 text-sm">Lỗi tải subtask: ${e.message}</div>`
  }
}

// ── Render subtask rows inside the panel ──────────────────────────────────
function renderSubtaskPanel(taskId, subtasks, canAddSubtask) {
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
    const canEdit = canAddSubtask || s.created_by === currentUser?.id
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
      <input type="checkbox" ${isChecked} onchange="toggleSubtaskDone(${s.id}, ${taskId}, this)"
        class="w-4 h-4 rounded border-gray-300 text-indigo-500 cursor-pointer flex-shrink-0"
        title="Đánh dấu hoàn thành">
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
    renderSubtaskPanel(taskId, subtasks, ['system_admin','project_admin','project_leader'].includes(effForTask) || isAssigned)
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
    renderSubtaskPanel(taskId, subtasks, ['system_admin','project_admin','project_leader'].includes(effForTask) || isAssigned)
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
  const discipline = $('taskDisciplineFilter')?.value || ''
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

  assigneeSelect.innerHTML = '<option value="">-- Chọn người phụ trách --</option>' +
    members.map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')

  // Khôi phục giá trị đã chọn trước đó (khi edit task)
  if (preserveValue) assigneeSelect.value = preserveValue
}

async function openTaskModal(taskId = null, projectId = null) {
  if (!allProjects.length) { allProjects = await api('/projects'); refreshProjectRoleCache() }
  if (!allUsers.length) allUsers = await api('/users')

  $('taskModalTitle').textContent = taskId ? 'Chỉnh sửa Task' : 'Tạo Task mới'
  $('taskId').value = taskId || ''

  const effRoleForModal = projectId
    ? getEffectiveRoleForProject(projectId)
    : (taskId ? getEffectiveGlobalRole() : getEffectiveGlobalRole())
  const isMember = !['system_admin','project_admin','project_leader'].includes(effRoleForModal)

  // Fill disciplines
  $('taskDiscipline').innerHTML = '<option value="">-- Chọn bộ môn --</option>' +
    allDisciplines.map(d => `<option value="${d.code}">${d.code} - ${d.name}</option>`).join('')

  // Fill assignees
  $('taskAssignee').innerHTML = '<option value="">-- Chọn người phụ trách --</option>' +
    (allUsers || []).filter(u => u.is_active !== 0).map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')

  // Khởi tạo combobox Dự án
  const projItems = allProjects.map(p => ({ value: String(p.id), label: `${p.code} - ${p.name}` }))
  _initTaskProjectCombobox(projItems, isMember)

  // Khởi tạo combobox Hạng mục (rỗng, load sau khi chọn dự án)
  _initTaskCategoryCombobox([], isMember, null)

  // For member: disable non-combobox fields
  const adminOnlyFields = ['taskTitle','taskDesc','taskDiscipline','taskPhase','taskPriority','taskAssignee','taskStartDate','taskDueDate','taskEstHours']
  adminOnlyFields.forEach(id => { const el = $(id); if(el) el.disabled = isMember })

  if (taskId) {
    try {
      const task = await api(`/tasks/${taskId}`)
      $('taskTitle').value = task.title || ''
      $('taskDesc').value = task.description || ''
      $('taskDiscipline').value = task.discipline_code || ''
      $('taskPhase').value = task.phase || 'basic_design'
      $('taskPriority').value = task.priority || 'medium'
      $('taskStatus').value = task.status || 'todo'
      $('taskStartDate').value = task.start_date || ''
      $('taskDueDate').value = task.due_date || ''
      $('taskEstHours').value = task.estimated_hours || 0
      $('taskProgress').value = task.progress || 0
      $('taskProgressLabel').textContent = task.progress || 0

      // Set dự án trên combobox
      if (task.project_id) {
        const proj = allProjects.find(p => p.id === task.project_id)
        if (proj) _cbSelect('taskProjectComboboxModal', String(proj.id), `${proj.code} - ${proj.name}`)
        $('taskProject').value = task.project_id
      }

      // Load hạng mục rồi set giá trị
      await Promise.all([
        _loadAndInitTaskCategoryCombobox(task.project_id, task.category_id, isMember),
        updateTaskAssigneeByProject(task.project_id, task.assigned_to)
      ])
    } catch (e) { toast('Lỗi tải task', 'error'); return }
  } else {
    $('taskTitle').value = ''
    $('taskDesc').value = ''
    $('taskDiscipline').value = ''
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
function _initTaskProjectCombobox(items, locked) {
  createCombobox('taskProjectComboboxModal', {
    placeholder: '-- Chọn dự án --',
    items,
    minWidth: '100%',
    onchange: async (val) => {
      $('taskProject').value = val || ''
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
    minWidth: '100%',
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
    loadTasks()
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
})

function confirmDeleteTask(id, title) {
  showConfirmDelete(
    'Xóa Task',
    `Bạn có chắc muốn xóa task "<strong>${title}</strong>"? Hành động này không thể hoàn tác.`,
    async () => { await api(`/tasks/${id}`, { method: 'delete' }); toast('Đã xóa task'); loadTasks() }
  )
}

async function deleteTask(id) {
  if (!confirm('Xóa task này?')) return
  try {
    await api(`/tasks/${id}`, { method: 'delete' })
    toast('Đã xóa task')
    loadTasks()
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

async function openTaskDetail(id, openChatTab = false) {
  try {
    const task = await api(`/tasks/${id}`)
    const subtasks = await api(`/tasks/${id}/subtasks`).catch(() => [])
    $('taskDetailTitle').textContent = task.title
    const overdue = isOverdue(task)
    const effD = getEffectiveRoleForProject(task.project_id)
    const canEditTask = ['system_admin','project_admin','project_leader'].includes(effD) || task.assigned_to === currentUser?.id
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
                <span class="text-gray-400 flex-shrink-0">${dayjs(h.created_at).format('DD/MM HH:mm')}</span>
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
    const dt = dayjs(msg.created_at)
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

  const mentions = extractMentions(content, contextType, contextId)

  try {
    const btn = document.querySelector(`#chatInputBar_${contextType}_${contextId} button[onclick*="sendChatMessage"]`)
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin text-xs"></i>' }

    await api('/messages', { method: 'post', data: { context_type: contextType, context_id: parseInt(contextId), content, mentions, attachments } })

    ta.value = ''
    ta.style.height = 'auto'
    window[attKey] = []
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
  if (!projectId) return allUsers || []
  if (_chatMembersCache[projectId]) return _chatMembersCache[projectId]
  try {
    const proj = await api(`/projects/${projectId}`)
    // Include project members + admin + leader (deduplicated)
    const members = proj.members || []
    // Also add allUsers as fallback so @mention always works
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
    // Fallback: return allUsers if project fetch fails
    return allUsers || []
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
    return `<div class="mention-item ${i===0?'active':''}" onclick="insertMention('${name.replace(/'/g,"\\'")}','${contextType}',${contextId})" data-idx="${i}">
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
  insertMention(m.full_name || m.name || '', contextType, contextId)
}

function insertMention(fullName, contextType, contextId) {
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

  openModal('subtaskModal')
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

    // Refresh inline panel in task table (if visible)
    const panel = document.getElementById(`subtask-panel-${taskId}`)
    const containerRow = document.getElementById(`subtask-rows-${taskId}`)
    if (panel && containerRow && containerRow.style.display !== 'none') {
      const subtasks = await api(`/tasks/${taskId}/subtasks`)
      panel.dataset.loaded = '1'
      const task = allTasks.find(t => t.id === taskId) || {}
      const effForTask = getEffectiveRoleForProject(task.project_id)
      const isAssigned = task.assigned_to === currentUser?.id
      renderSubtaskPanel(taskId, subtasks, ['system_admin','project_admin','project_leader'].includes(effForTask) || isAssigned)
      refreshSubtaskBadge(taskId, subtasks)
    } else {
      // If panel not open yet, just re-open toggle or refresh task detail
      // Also refresh the expand button if task now has subtasks
      await refreshTaskRowSubtaskCount(taskId)
    }

    // Also refresh task detail if it's open
    const detailModal = $('taskDetailModal')
    if (detailModal && detailModal.style.display !== 'none') openTaskDetail(taskId)
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
    ;[2023, 2024, 2025, 2026, 2027].forEach(y => {
      const opt = document.createElement('option')
      opt.value = y; opt.textContent = y
      if (y === new Date().getFullYear()) opt.selected = true
      yearSel.appendChild(opt)
    })
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
        minWidth: '190px',
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
        minWidth: '190px',
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
      // Backfill allUsers cache
      if (!allUsers.length) allUsers = members
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
          minWidth: '190px',
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
          minWidth: '190px',
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
    const totalReg = apiSummary ? (apiSummary.total_regular_hours || 0)
                                : allTimesheets.reduce((s, t) => s + (t.regular_hours  || 0), 0)
    const totalOT  = apiSummary ? (apiSummary.total_overtime_hours || 0)
                                : allTimesheets.reduce((s, t) => s + (t.overtime_hours || 0), 0)
    const totalH   = apiSummary ? (apiSummary.total_hours || 0) : totalReg + totalOT

    if ($('tsCardTotal'))       $('tsCardTotal').textContent       = allTimesheets.length
    if ($('tsCardPending'))     $('tsCardPending').textContent     = pending
    if ($('tsCardApproved'))    $('tsCardApproved').textContent    = approved
    if ($('tsCardHours'))       $('tsCardHours').textContent       = totalH + 'h'
    if ($('tsCardHoursDetail')) $('tsCardHoursDetail').textContent = `HC: ${totalReg}h | OT: ${totalOT}h`
    if ($('tsFilterCount'))     $('tsFilterCount').textContent     = allTimesheets.length

    // Bulk-approve button
    const bulkBtn = $('tsBulkApproveBtn')
    if (bulkBtn) {
      if (canSeeAll && pending > 0) {
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
              <div class="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 rounded px-1 cursor-pointer"
                   onclick="filterTsByProject('${p.project_id}')">
                <div>
                  <span class="font-medium text-gray-700 text-xs">${p.code}</span>
                  <span class="text-gray-500 ml-1 text-xs truncate"
                        style="max-width:140px;display:inline-block;vertical-align:bottom">${p.name}</span>
                </div>
                <div class="text-right text-xs">
                  <span class="font-bold text-accent">${p.total_hours}h</span>
                  <span class="text-gray-400 ml-1">${p.member_count} người</span>
                </div>
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
  const headers = ['Ngày', canSeeAll ? 'Nhân viên' : '', 'Dự án', 'Task', 'Giờ HC', 'Tăng ca', 'Tổng giờ', 'Mô tả', 'Trạng thái'].filter(Boolean)
  const rows = allTimesheets.map(t => {
    const base = [t.work_date, t.project_code || '', t.task_title || '', t.regular_hours, t.overtime_hours, (t.regular_hours + t.overtime_hours), (t.description || '').replace(/"/g, '""'), statusLabels[t.status] || t.status]
    return canSeeAll ? [t.work_date, t.user_name || '', t.project_code || '', t.task_title || '', t.regular_hours, t.overtime_hours, (t.regular_hours + t.overtime_hours), (t.description || '').replace(/"/g, '""'), statusLabels[t.status] || t.status] : base
  })

  // Totals row
  let totalReg = 0, totalOT = 0
  allTimesheets.forEach(t => { totalReg += t.regular_hours || 0; totalOT += t.overtime_hours || 0 })
  const totalRow = canSeeAll
    ? ['TỔNG CỘNG', '', '', '', totalReg, totalOT, totalReg + totalOT, '', '']
    : ['TỔNG CỘNG', '', '', totalReg, totalOT, totalReg + totalOT, '', '']

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
  const canApprove  = isAdmin || isProjAdmin

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

  // Ẩn/hiện cột "Nhân viên"
  document.querySelectorAll('.ts-col-user').forEach(el => {
    el.style.display = canSeeAll ? '' : 'none'
  })

  const statusColors  = { draft: 'badge-todo', submitted: 'badge-review', approved: 'badge-completed', rejected: 'badge-overdue' }
  const statusLabels  = { draft: 'Nháp', submitted: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' }

  const emptyColspan = canSeeAll ? 10 : 9

  tbody.innerHTML = timesheets.map(t => {
    const isOwner   = t.user_id === currentUser.id
    const isDraft   = t.status === 'draft'
    const isRejected = t.status === 'rejected'
    const isSubmitted = t.status === 'submitted'

    // Quyền edit: admin/projAdmin luôn được; member chỉ khi draft/rejected của mình
    const canEdit   = isAdmin || isProjAdmin || (isOwner && (isDraft || isRejected))
    // Quyền xóa: admin luôn được; projAdmin được; member chỉ khi draft/rejected của mình
    const canDelete = isAdmin || isProjAdmin || (isOwner && (isDraft || isRejected))
    // Nút submit (gửi duyệt) — chỉ owner, khi đang draft
    const canSubmit = isOwner && isDraft
    // Nút approve — admin/projAdmin, khi submitted
    const canApproveBt = canApprove && isSubmitted
    // Nút reject — admin/projAdmin, khi submitted
    const canRejectBt = canApprove && isSubmitted

    return `
    <tr class="table-row ${isOwner && !canSeeAll ? 'bg-green-50/30' : ''}">
      <td class="py-2 pr-3 text-sm font-medium">${fmtDate(t.work_date)}</td>
      <td class="py-2 pr-3 text-sm ts-col-user" style="display:${canSeeAll ? '' : 'none'}">
        <div class="flex items-center gap-1.5">
          <div class="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">${(t.user_name||'?').split(' ').pop()?.charAt(0)}</div>
          <span>${t.user_name || '-'}</span>
        </div>
      </td>
      <td class="py-2 pr-3 text-sm text-gray-600">${t.project_code || '-'}</td>
      <td class="py-2 pr-3 text-xs text-gray-500 max-w-28 truncate" title="${t.task_title||''}">${t.task_title || '-'}</td>
      <td class="py-2 pr-3 text-center font-medium text-primary">${t.regular_hours}h</td>
      <td class="py-2 pr-3 text-center font-medium text-orange-500">${t.overtime_hours > 0 ? t.overtime_hours + 'h' : '-'}</td>
      <td class="py-2 pr-3 text-center font-bold text-gray-700">${(t.regular_hours + t.overtime_hours)}h</td>
      <td class="py-2 pr-3 text-xs text-gray-500 max-w-32 truncate" title="${t.description||''}">${t.description || '-'}</td>
      <td class="py-2 pr-3"><span class="badge ${statusColors[t.status] || 'badge-todo'}">${statusLabels[t.status] || t.status}</span></td>
      <td class="py-2">
        <div class="flex gap-1 flex-wrap">
          ${canSubmit ? `<button onclick="submitTimesheet(${t.id})" class="btn-secondary text-xs px-2 py-1 text-blue-600 border-blue-300" title="Gửi duyệt"><i class="fas fa-paper-plane"></i></button>` : ''}
          ${canEdit   ? `<button onclick="openTimesheetModal(${t.id})" class="btn-secondary text-xs px-2 py-1" title="Sửa"><i class="fas fa-edit"></i></button>` : ''}
          ${canApproveBt ? `<button onclick="approveTimesheet(${t.id})" class="btn-primary text-xs px-2 py-1" title="Duyệt"><i class="fas fa-check"></i></button>` : ''}
          ${canRejectBt  ? `<button onclick="rejectTimesheet(${t.id})" class="text-red-400 hover:text-red-600 border border-red-200 rounded px-2 py-1 text-xs" title="Từ chối"><i class="fas fa-times"></i></button>` : ''}
          ${canDelete ? `<button onclick="deleteTimesheet(${t.id})" class="text-red-400 hover:text-red-600 px-1.5 text-sm" title="Xóa"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </td>
    </tr>`
  }).join('') || `<tr><td colspan="${emptyColspan}" class="text-center py-8 text-gray-400">
    <i class="fas fa-clock text-3xl mb-2 block"></i>
    ${canSeeAll ? 'Không có timesheet nào trong khoảng thời gian này' : 'Bạn chưa có timesheet nào. Nhấn "+ Thêm timesheet" để bắt đầu.'}
  </td></tr>`
}

// ── Biến lưu trạng thái locked hiện tại của modal ────────────────────────────
let _tsModalLocked = false

// ── Khởi tạo combobox Dự án trong modal Timesheet ───────────────────────────
function _initTsProjectCombobox(selectedProjId = '', locked = false) {
  _tsModalLocked = locked   // lưu lại để closure onchange dùng đúng

  const projItems = allProjects.map(p => ({
    value: String(p.id),
    label: `${p.code} – ${p.name}`
  }))

  createCombobox('tsProjectCombobox', {
    placeholder: '🔍 Tìm & chọn dự án...',
    items: projItems,
    value: selectedProjId ? String(selectedProjId) : '',
    minWidth: '100%',
    onchange: async (val) => {
      $('tsProjectHidden').value = val || ''
      // Khi đổi dự án → reset task combobox rồi load lại
      // Dùng _tsModalLocked (không phải biến locked bị capture cũ)
      _initTsTaskCombobox([], null, _tsModalLocked)
      if (val) await _loadAndInitTsTaskCombobox(val, null, _tsModalLocked)
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

// ── Khởi tạo combobox Task ─────────────────────────────────────────────────
function _initTsTaskCombobox(tasks = [], selectedTaskId = null, locked = false) {
  // Chuẩn hoá selectedTaskId về string để so sánh chính xác
  const selId = selectedTaskId != null ? String(selectedTaskId) : ''

  // Giữ lại task đang được chọn dù status là completed/cancelled
  const taskItems = tasks
    .filter(t => !['completed', 'cancelled'].includes(t.status) || String(t.id) === selId)
    .map(t => {
      const statusIcons = { todo: '⬜', in_progress: '🔵', review: '🟡', completed: '✅', cancelled: '❌' }
      const icon = statusIcons[t.status] || '⬜'
      const disc = t.discipline_code ? ` [${t.discipline_code}]` : ''
      return { value: String(t.id), label: `${icon}${disc} ${t.title}` }
    })

  createCombobox('tsTaskCombobox', {
    placeholder: tasks.length ? '🔍 Tìm & chọn task...' : '— Không có task —',
    items: taskItems,
    value: selId,
    minWidth: '100%',
    onchange: (val) => {
      $('tsTaskHidden').value = val || ''
    }
  })

  // Disable trigger nếu locked
  const wrap = $('tsTaskCombobox_wrap')
  if (wrap) {
    wrap.style.pointerEvents = locked ? 'none' : ''
    wrap.style.opacity       = locked ? '0.6'  : ''
  }

  // Sync hidden input ngay khi khởi tạo (không chờ onchange)
  $('tsTaskHidden').value = selId
}

// ── Load tasks từ API rồi khởi tạo combobox task ─────────────────────────────
async function _loadAndInitTsTaskCombobox(projectId, selectedTaskId = null, locked = false) {
  if (!projectId) { _initTsTaskCombobox([], null, locked); return }
  const spinner = $('tsTaskLoadingSpinner')
  if (spinner) spinner.style.display = 'inline'
  try {
    // Lấy tất cả task của project (không filter status ở đây — filter trong _initTsTaskCombobox)
    const tasks = await api(`/tasks?project_id=${projectId}`)
    _initTsTaskCombobox(tasks, selectedTaskId, locked)
  } catch (e) {
    _initTsTaskCombobox([], null, locked)
  } finally {
    if (spinner) spinner.style.display = 'none'
  }
}

async function openTimesheetModal(tsId = null) {
  if (!allProjects.length) allProjects = await api('/projects')

  const isAdmin     = currentUser.role === 'system_admin'
  const isProjAdmin = currentUser.role === 'project_admin' ||
                      currentUser.role === 'project_leader' ||
                      isAnyProjectLeaderOrAdmin()

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

    // Load & init task combobox với task đang chọn sẵn + đúng locked
    await _loadAndInitTsTaskCombobox(ts.project_id, ts.task_id, locked)

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
    $('tsRegularHours').value     = 8
    $('tsOvertimeHours').value    = 0
    $('tsDescription').value      = ''
    $('tsRegularHours').disabled  = false
    $('tsOvertimeHours').disabled = false
    $('tsDescription').disabled   = false

    _initTsProjectCombobox('', false)
    _initTsTaskCombobox([], null, false)

    openModal('timesheetModal')
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

// Giữ lại hàm loadTsTasks để tương thích nơi khác gọi
async function loadTsTasks(projectId = null, selectedTaskId = null) {
  const projId = projectId || _cbGetValue('tsProjectCombobox')
  if (projId) await _loadAndInitTsTaskCombobox(projId, selectedTaskId, false)
}

$('tsForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('tsId').value

  // Ưu tiên _cbGetValue (luôn đúng với state combobox hiện tại)
  // fallback về hidden input nếu combobox chưa được tạo
  const projId = _cbGetValue('tsProjectCombobox') || $('tsProjectHidden').value
  const taskId = _cbGetValue('tsTaskCombobox')    || $('tsTaskHidden').value

  if (!projId) {
    toast('Vui lòng chọn dự án', 'warning')
    return
  }

  const data = {
    project_id: parseInt(projId),
    task_id: parseInt(taskId) || null,
    work_date: $('tsDate').value,
    regular_hours: parseFloat($('tsRegularHours').value) || 0,
    overtime_hours: parseFloat($('tsOvertimeHours').value) || 0,
    description: $('tsDescription').value
  }
  try {
    let result
    if (id) {
      result = await api(`/timesheets/${id}`, { method: 'put', data })
      toast('Đã cập nhật timesheet', 'success')
    } else {
      result = await api('/timesheets', { method: 'post', data })
      // Backend returns action: 'updated' if it auto-updated an existing record
      if (result && result.action === 'updated') {
        toast('✅ Đã cập nhật timesheet cho ngày này (đã tồn tại)', 'success')
      } else {
        toast('✅ Đã thêm timesheet thành công', 'success')
      }
      // Tự động đồng bộ filter tháng/năm với work_date của timesheet vừa tạo
      if (data.work_date) {
        const [wYear, wMonth] = data.work_date.split('-')
        const monthSel = $('tsMonthFilter')
        const yearSel  = $('tsYearFilter')
        if (monthSel) monthSel.value = wMonth
        if (yearSel)  yearSel.value  = wYear
      }
    }
    closeModal('timesheetModal')
    loadTimesheets()
  } catch (e) {
    const errMsg = e.response?.data?.error || e.message || 'Lỗi không xác định'
    // 422 week_limit — hiển thị cảnh báo nổi bật
    if (e.response?.status === 422 && e.response?.data?.week_limit) {
      toast('⏰ ' + errMsg, 'warning')
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
      minWidth: '240px',
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
async function loadCostDashboard() {
  // Guard: if already loading, mark pending so we re-run after current finishes
  if (_costDashboardLoading) { _costDashboardPending = true; return }
  _costDashboardLoading = true
  _costDashboardPending = false
  try {
    if (!allProjects.length) allProjects = await api('/projects')

    // Fill cost project combobox
    const costProjItems = allProjects.map(p => ({ value: String(p.id), label: `${p.code} – ${p.name}` }))
    if ($('costProjectFilterCombobox')?.querySelector('[id$="_wrap"]')) {
      _cbSetItems('costProjectFilterCombobox', costProjItems, true)
    } else {
      createCombobox('costProjectFilterCombobox', {
        placeholder: 'Tất cả dự án',
        items: costProjItems,
        value: '',
        minWidth: '180px',
        onchange: () => loadCostDashboard()
      })
    }

    // Fill analysis project dropdown
    const apf = $('analysisProjSel')
    if (apf && apf.options.length <= 1) {
      apf.innerHTML = '<option value="">-- Chọn dự án --</option>' +
        allProjects.map(p => `<option value="${p.id}">${p.code} - ${p.name}</option>`).join('')
      // Default to first project if only one
      if (allProjects.length === 1) apf.value = String(allProjects[0].id)
    }

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

    $('costKpiRevenue').textContent = fmtMoney(totalRevenue)
    $('costKpiCost').innerHTML = fmtMoney(totalCost) +
      (totalSharedAllocated > 0
        ? `<br><span class="text-xs font-normal text-yellow-600" title="Đã bao gồm ${fmtMoney(totalSharedAllocated)} chi phí chung phân bổ"><i class="fas fa-share-alt mr-1"></i>Gồm ${fmtMoney(totalSharedAllocated)} chi phí chung</span>`
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
  // Extra guard: destroy any existing chart on this canvas
  const existingCostProject = Chart.getChart(ctx)
  if (existingCostProject) { try { existingCostProject.destroy() } catch(e){} }
  const projects = revenues?.slice(0, 6) || []
  charts['costProject'] = safeChart(ctx, {
    type: 'bar',
    data: {
      labels: projects.map(p => p.code || p.name?.substring(0, 10)),
      datasets: [
        { label: 'Doanh thu', data: projects.map(p => p.total_revenue || 0), backgroundColor: '#00A651', borderRadius: 4 },
        { label: 'Chi phí', data: projects.map(p => { const c = costs?.find(cc => cc.id === p.id); return c?.total_cost || 0 }), backgroundColor: '#EF4444', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => fmtMoney(v) } } }
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
    renderCostTable()
  } catch (e) { console.error(e) }
}

function switchCostTab(tab) {
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

  // Cost filter row: only show for costs/revenues
  const costFilter = $('costFilter')
  if (costFilter) costFilter.classList.toggle('hidden', tab === 'analysis' || tab === 'duplicates' || tab === 'shared')

  // "Thêm chi phí chung" button — only visible on shared tab
  const btnAdd = $('btnAddSharedCost')
  if (btnAdd) btnAdd.classList.toggle('hidden', tab !== 'shared')

  if (tab === 'shared') {
    loadSharedCosts()
    return
  }

  renderCostTable()

  // Init analysis project dropdown
  if (tab === 'analysis') {
    const sel = $('analysisProjSel')
    if (sel && sel.options.length <= 1 && allProjects.length) {
      sel.innerHTML = '<option value="">-- Chọn dự án --</option>' +
        allProjects.map(p => `<option value="${p.id}">${p.code} - ${p.name}</option>`).join('')
    }
    // Set default month/year
    const now = new Date()
    const ms = $('analysisMonthSel'); if (ms) ms.value = String(now.getMonth() + 1).padStart(2, '0')
    const ys = $('analysisYearSel');  if (ys) ys.value = String(now.getFullYear())
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
  const projId = $('analysisProjSel')?.value
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
        const costTypeIcons = { 'Lương nhân sự':'👥', 'Vật liệu':'🔩', 'Thiết bị':'🔧', 'Vận chuyển':'🚛', 'Chi phí chung (phân bổ)':'🤝' }
        tbody.innerHTML = breakdown.map(b => `
          <tr class="border-b border-gray-50 hover:bg-gray-50 ${b.cost_type === 'shared' ? 'bg-yellow-50' : ''}">
            <td class="py-2 pr-3">
              <span class="flex items-center gap-1.5">
                <span>${costTypeIcons[b.type] || '📋'}</span>
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
    const res = await api(`/projects/${projId}/labor-costs/sync`, { method: 'POST', data: { month: parseInt(month), year: parseInt(year), force_recalculate: true } })
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

    const costTypeNames = { salary:'Lương nhân sự', material:'Vật liệu', equipment:'Thiết bị', transport:'Vận chuyển', other:'Chi phí khác' }
    const tbody = $('dupTableBody')
    if (!tbody) return

    const costsRows = (data.project_costs_duplicates || []).map(d => `
      <tr class="border-b border-gray-100 hover:bg-red-50">
        <td class="py-2 pr-3"><span class="badge" style="background:#fef3c7;color:#92400e">Chi phí</span></td>
        <td class="py-2 pr-3 font-medium text-sm">${d.project_code || d.project_id}</td>
        <td class="py-2 pr-3 text-sm">${costTypeNames[d.cost_type] || d.cost_type}</td>
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

function renderCostTable() {
  const head = $('costTableHead')
  const tbody = $('costTableBody')
  if (!head || !tbody) return

  if (currentCostTab === 'costs') {
    head.innerHTML = `<tr class="text-left text-gray-500 border-b text-xs uppercase">
      <th class="pb-3 pr-3">Dự án</th>
      <th class="pb-3 pr-3">Loại</th>
      <th class="pb-3 pr-3">Mô tả</th>
      <th class="pb-3 pr-3">Nhà CC</th>
      <th class="pb-3 pr-3">Ngày</th>
      <th class="pb-3 pr-3 text-right">Số tiền</th>
      <th class="pb-3">Thao tác</th>
    </tr>`
    tbody.innerHTML = allCosts.map(c => `
      <tr class="table-row">
        <td class="py-2 pr-3 text-sm font-medium">${c.project_code || '-'}</td>
        <td class="py-2 pr-3"><span class="badge" style="background:#fef3c7;color:#92400e">${getCostTypeName(c.cost_type)}</span></td>
        <td class="py-2 pr-3 text-sm text-gray-700">${c.description}</td>
        <td class="py-2 pr-3 text-sm text-gray-500">${c.vendor || '-'}</td>
        <td class="py-2 pr-3 text-sm text-gray-500">${fmtDate(c.cost_date)}</td>
        <td class="py-2 pr-3 text-sm text-right font-bold text-red-600">${fmt(c.amount)}</td>
        <td class="py-2">
          <div class="flex gap-1">
            <button onclick="openCostModal('cost', ${c.id})" class="btn-secondary text-xs px-2 py-1"><i class="fas fa-edit"></i></button>
            <button onclick="deleteCostItem('cost', ${c.id})" class="text-red-400 hover:text-red-600 px-1.5 text-sm"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="7" class="text-center py-6 text-gray-400">Không có dữ liệu chi phí</td></tr>'
  } else {
    head.innerHTML = `<tr class="text-left text-gray-500 border-b text-xs uppercase">
      <th class="pb-3 pr-3">Dự án</th>
      <th class="pb-3 pr-3">Mô tả</th>
      <th class="pb-3 pr-3">Số HĐ</th>
      <th class="pb-3 pr-3">Ngày</th>
      <th class="pb-3 pr-3">Thanh toán</th>
      <th class="pb-3 pr-3 text-right">Số tiền</th>
      <th class="pb-3">Thao tác</th>
    </tr>`
    const paymentColors = { pending: 'badge-todo', partial: 'badge-review', paid: 'badge-completed' }
    const paymentLabels = { pending: 'Chờ TT', partial: 'TT một phần', paid: 'Đã TT' }
    tbody.innerHTML = allRevenues.map(r => `
      <tr class="table-row">
        <td class="py-2 pr-3 text-sm font-medium">${r.project_code || '-'}</td>
        <td class="py-2 pr-3 text-sm text-gray-700">${r.description}</td>
        <td class="py-2 pr-3 text-sm text-gray-500">${r.invoice_number || '-'}</td>
        <td class="py-2 pr-3 text-sm text-gray-500">${fmtDate(r.revenue_date)}</td>
        <td class="py-2 pr-3"><span class="badge ${paymentColors[r.payment_status]||'badge-todo'}">${paymentLabels[r.payment_status]||r.payment_status}</span></td>
        <td class="py-2 pr-3 text-sm text-right font-bold text-green-600">${fmt(r.amount)}</td>
        <td class="py-2">
          <div class="flex gap-1">
            <button onclick="openCostModal('revenue', ${r.id})" class="btn-secondary text-xs px-2 py-1"><i class="fas fa-edit"></i></button>
            <button onclick="deleteCostItem('revenue', ${r.id})" class="text-red-400 hover:text-red-600 px-1.5 text-sm"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="7" class="text-center py-6 text-gray-400">Không có dữ liệu doanh thu</td></tr>'
  }
}

async function openCostModal(mode, id = null) {
  if (!allProjects.length) allProjects = await api('/projects')
  $('costMode').value = mode
  $('costModalTitle').textContent = mode === 'cost' ? (id ? 'Sửa Chi phí' : 'Thêm Chi phí') : (id ? 'Sửa Doanh thu' : 'Thêm Doanh thu')
  $('costId').value = id || ''

  const typeGroup = $('costTypeGroup')
  typeGroup.style.display = mode === 'cost' ? 'block' : 'none'

  // Hiện/ẩn trường trạng thái thanh toán (chỉ cho revenue)
  const payGroup = $('paymentStatusGroup')
  if (payGroup) payGroup.style.display = mode === 'revenue' ? 'block' : 'none'

  $('costProject').innerHTML = '<option value="">-- Chọn dự án --</option>' + allProjects.map(p => `<option value="${p.id}">${p.code} - ${p.name}</option>`).join('')

  if (id) {
    const item = mode === 'cost' ? allCosts.find(c => c.id === id) : allRevenues.find(r => r.id === id)
    if (item) {
      $('costProject').value = item.project_id || ''
      $('costDescription').value = item.description || ''
      $('costAmount').value = item.amount || ''
      $('costDate').value = item.cost_date || item.revenue_date || ''
      $('costInvoice').value = item.invoice_number || ''
      $('costVendor').value = item.vendor || ''
      $('costNotes').value = item.notes || ''
      if (mode === 'cost') $('costType').value = item.cost_type || 'other'
      if (mode === 'revenue' && $('costPaymentStatus')) $('costPaymentStatus').value = item.payment_status || 'pending'
    }
  } else {
    $('costProject').value = ''
    $('costDescription').value = ''
    $('costAmount').value = ''
    $('costDate').value = today()
    $('costInvoice').value = ''
    $('costVendor').value = ''
    $('costNotes').value = ''
    if (mode === 'cost') $('costType').value = 'other'
    // Mặc định "Chờ thanh toán" khi tạo mới doanh thu
    if (mode === 'revenue' && $('costPaymentStatus')) $('costPaymentStatus').value = 'pending'
  }

  openModal('costModal')
}

$('costForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('costId').value
  const mode = $('costMode').value
  const data = {
    project_id: parseInt($('costProject').value),
    description: $('costDescription').value,
    amount: parseFloat($('costAmount').value),
    cost_date: $('costDate').value,        // for costs
    revenue_date: $('costDate').value,     // for revenues (same field, different key)
    invoice_number: $('costInvoice').value,
    notes: $('costNotes').value
  }
  if (mode === 'cost') {
    data.cost_type = $('costType').value
    data.vendor = $('costVendor').value
  }
  if (mode === 'revenue') {
    // Gửi trạng thái thanh toán — bắt buộc cho revenue
    data.payment_status = $('costPaymentStatus')?.value || 'pending'
  }
  try {
    const endpoint = mode === 'cost' ? '/costs' : '/revenues'
    if (id) await api(`${endpoint}/${id}`, { method: 'put', data })
    else await api(endpoint, { method: 'post', data })
    closeModal('costModal')
    toast('Lưu thành công')
    loadCostDashboard()
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
})

async function deleteCostItem(type, id) {
  if (!confirm('Xóa mục này?')) return
  try {
    const endpoint = type === 'cost' ? `/costs/${id}` : `/revenues/${id}`
    await api(endpoint, { method: 'delete' })
    toast('Đã xóa')
    loadCostDashboard()
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

// ================================================================
// ASSETS
// ================================================================
async function loadAssets() {
  try {
    if (!allUsers.length) allUsers = await api('/users')
    allAssets = await api('/assets')
    renderAssetStats()
    renderAssetsTable(allAssets)
  } catch (e) { toast('Lỗi tải tài sản: ' + e.message, 'error') }
}

function renderAssetStats() {
  const stats = $('assetStats')
  if (!stats) return
  const byStatus = {}
  allAssets.forEach(a => byStatus[a.status] = (byStatus[a.status] || 0) + 1)
  const totalValue = allAssets.reduce((s, a) => s + (a.current_value || 0), 0)

  stats.innerHTML = [
    { label: 'Tổng tài sản', value: allAssets.length, icon: 'laptop', color: '#0066CC', bg: 'bg-blue-100' },
    { label: 'Đang sử dụng', value: byStatus['active'] || 0, icon: 'check-circle', color: '#00A651', bg: 'bg-green-100' },
    { label: 'Chưa sử dụng', value: byStatus['unused'] || 0, icon: 'box', color: '#6B7280', bg: 'bg-gray-100' },
    { label: 'Bảo trì/Sửa chữa', value: (byStatus['maintenance'] || 0) + (byStatus['repair'] || 0), icon: 'wrench', color: '#FF6B00', bg: 'bg-orange-100' },
    { label: 'Tổng giá trị', value: fmtMoney(totalValue), icon: 'coins', color: '#8B5CF6', bg: 'bg-purple-100' }
  ].map(s => `<div class="kpi-card" style="border-color:${s.color}">
    <div class="flex justify-between">
      <div>
        <p class="text-xs text-gray-500">${s.label}</p>
        <p class="text-2xl font-bold mt-1" style="color:${s.color}">${s.value}</p>
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

  tbody.innerHTML = assets.map(a => `
    <tr class="table-row">
      <td class="py-2 pr-3 font-mono text-sm font-bold text-primary">${a.asset_code}</td>
      <td class="py-2 pr-3 text-sm font-medium text-gray-800">${a.name}</td>
      <td class="py-2 pr-3"><span class="badge" style="background:#e0f2fe;color:#0369a1">${getAssetCategoryName(a.category)}</span></td>
      <td class="py-2 pr-3 text-xs text-gray-600">${a.brand || '-'} ${a.model ? '/ ' + a.model : ''}</td>
      <td class="py-2 pr-3 text-sm text-gray-600">${a.department || '-'}</td>
      <td class="py-2 pr-3 text-sm text-gray-700">${a.assigned_to_name || '<span class="text-gray-300">Không có</span>'}</td>
      <td class="py-2 pr-3 text-sm text-right font-medium text-primary">${fmt(a.current_value)}</td>
      <td class="py-2 pr-3"><span class="badge ${statusColors[a.status]||'badge-todo'}">${statusLabels[a.status]||a.status}</span></td>
      <td class="py-2">
        <div class="flex gap-1">
          <button onclick="openAssetModal(${a.id})" class="btn-secondary text-xs px-2 py-1"><i class="fas fa-edit"></i></button>
          <button onclick="deleteAsset(${a.id})" class="text-red-400 hover:text-red-600 px-1.5 text-sm"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="9" class="text-center py-8 text-gray-400">Không có tài sản</td></tr>'
}

function filterAssets() {
  const search = $('assetSearch').value.toLowerCase()
  const category = $('assetCategoryFilter').value
  const status = $('assetStatusFilter').value
  const filtered = allAssets.filter(a =>
    (!search || a.name.toLowerCase().includes(search) || a.asset_code.toLowerCase().includes(search) || (a.brand||'').toLowerCase().includes(search)) &&
    (!category || a.category === category) &&
    (!status || a.status === status)
  )
  renderAssetsTable(filtered)
}

async function openAssetModal(assetId = null) {
  if (!allUsers.length) allUsers = await api('/users')
  $('assetModalTitle').textContent = assetId ? 'Chỉnh sửa tài sản' : 'Thêm tài sản mới'
  $('assetId').value = assetId || ''
  $('assetAssignedTo').innerHTML = '<option value="">-- Không giao --</option>' +
    allUsers.filter(u => u.is_active).map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')

  if (assetId) {
    const asset = allAssets.find(a => a.id === assetId)
    if (asset) {
      $('assetCode').value = asset.asset_code || ''
      $('assetName').value = asset.name || ''
      $('assetCategory').value = asset.category || 'computer'
      $('assetStatus').value = asset.status || 'active'
      $('assetBrand').value = asset.brand || ''
      $('assetModel').value = asset.model || ''
      $('assetSerial').value = asset.serial_number || ''
      $('assetPurchaseDate').value = asset.purchase_date || ''
      $('assetPurchasePrice').value = asset.purchase_price || ''
      $('assetCurrentValue').value = asset.current_value || ''
      $('assetDepartment').value = asset.department || ''
      $('assetAssignedTo').value = asset.assigned_to || ''
      $('assetSpecs').value = asset.specifications || ''
    }
  } else {
    $('assetCode').value = ''
    $('assetName').value = ''
    $('assetCategory').value = 'computer'
    $('assetStatus').value = 'active'
    $('assetBrand').value = ''
    $('assetModel').value = ''
    $('assetSerial').value = ''
    $('assetPurchaseDate').value = today()
    $('assetPurchasePrice').value = ''
    $('assetCurrentValue').value = ''
    $('assetDepartment').value = ''
    $('assetAssignedTo').value = ''
    $('assetSpecs').value = ''
  }
  openModal('assetModal')
}

$('assetForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('assetId').value
  const data = {
    asset_code: $('assetCode').value, name: $('assetName').value,
    category: $('assetCategory').value, status: $('assetStatus').value,
    brand: $('assetBrand').value, model: $('assetModel').value,
    serial_number: $('assetSerial').value, purchase_date: $('assetPurchaseDate').value,
    purchase_price: parseFloat($('assetPurchasePrice').value) || 0,
    current_value: parseFloat($('assetCurrentValue').value) || 0,
    department: $('assetDepartment').value,
    assigned_to: parseInt($('assetAssignedTo').value) || null,
    specifications: $('assetSpecs').value
  }
  try {
    if (id) await api(`/assets/${id}`, { method: 'put', data })
    else await api('/assets', { method: 'post', data })
    closeModal('assetModal')
    toast(id ? 'Cập nhật tài sản' : 'Thêm tài sản thành công')
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

// ================================================================
// USERS
// ================================================================
async function loadUsers() {
  try {
    allUsers = await api('/users')
    renderUsersTable(allUsers)
  } catch (e) { toast('Lỗi tải nhân sự: ' + e.message, 'error') }
}

function renderUsersTable(users) {
  const tbody = $('usersTable')
  if (!tbody) return
  tbody.innerHTML = users.map(u => `
    <tr class="table-row">
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
      <td class="py-2">
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
  `).join('') || '<tr><td colspan="7" class="text-center py-8 text-gray-400">Không có nhân sự</td></tr>'
}

function filterUsers() {
  const search = $('userSearch').value.toLowerCase()
  const role = $('userRoleFilter').value
  const filtered = allUsers.filter(u =>
    (!search || u.full_name.toLowerCase().includes(search) || u.username.toLowerCase().includes(search)) &&
    (!role || u.role === role)
  )
  renderUsersTable(filtered)
}

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
      // Handle department dropdown
      const deptEl = $('userDepartment')
      if (deptEl) {
        if (deptEl.tagName === 'SELECT') {
          let found = false
          for (const opt of deptEl.options) { if (opt.value === user.department) { found = true; break } }
          if (!found && user.department) {
            const opt = document.createElement('option')
            opt.value = user.department; opt.textContent = user.department
            deptEl.appendChild(opt)
          }
          deptEl.value = user.department || ''
        } else {
          deptEl.value = user.department || ''
        }
      }
      $('userSalary').value = user.salary_monthly || ''
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
    $('userSalary').value = ''
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
    salary_monthly: parseFloat($('userSalary').value) || 0
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
async function loadProfile() {
  try {
    const user = await api('/auth/me')
    currentUser = { ...currentUser, ...user }

    const initials = user.full_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'U'
    $('profileAvatar').textContent = initials
    $('profileName').textContent = user.full_name
    $('profileRole').textContent = getRoleLabel(user.role)
    $('profileDept').textContent = user.department || '-'
    $('profileEmail').textContent = user.email || '-'
    $('profilePhone').textContent = user.phone || '-'

    $('profileFullName').value = user.full_name || ''
    $('profileEmailInput').value = user.email || ''
    $('profilePhoneInput').value = user.phone || ''
    $('profileDeptInput').value = user.department || ''
  } catch (e) { toast('Lỗi tải profile', 'error') }
}

async function updateProfile() {
  try {
    await api(`/users/${currentUser.id}`, {
      method: 'put',
      data: {
        full_name: $('profileFullName').value,
        email: $('profileEmailInput').value,
        phone: $('profilePhoneInput').value,
        department: $('profileDeptInput').value
      }
    })
    toast('Cập nhật thông tin thành công')
    loadProfile()
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
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

async function loadProductivity() {
  try {
    if (!allProjects.length) allProjects = await api('/projects')
    const pf = $('prodProjectFilter')
    if (pf && pf.options.length <= 1) {
      allProjects.forEach(p => {
        const opt = document.createElement('option')
        opt.value = p.id; opt.textContent = p.code + ' - ' + p.name
        pf.appendChild(opt)
      })
    }
    const projectId = pf?.value || ''
    const days = $('prodDaysFilter')?.value || '30'
    let url = `/productivity?days=${days}`
    if (projectId) url += `&project_id=${projectId}`
    allProductivityData = await api(url)
    renderProductivityPage(allProductivityData)
  } catch(e) { toast('Lỗi tải năng suất: ' + e.message, 'error') }
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

  const getScoreColor = s => s >= 75 ? 'text-green-600' : s >= 50 ? 'text-yellow-600' : 'text-red-600'
  const getBadgeClass = s => s >= 75 ? 'badge-completed' : s >= 50 ? 'badge-review' : 'badge-overdue'

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
      charts['prodPie'] = safeChart(ctx2, {
        type: 'pie',
        data: {
          labels: topP.map(u => u.full_name?.split(' ').pop()),
          datasets: [{ data: topP.map(u => u.completed_tasks), backgroundColor: colors }]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } }
        }
      })
    }
  }

  // ---- Table ----
  const tbody = $('productivityTable')
  if (!tbody) return

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-gray-400"><i class="fas fa-inbox text-2xl mb-2 block"></i>Không có dữ liệu</td></tr>'
    return
  }

  tbody.innerHTML = data.map((u, i) => {
    const completionRate = u.completion_rate || 0   // % Hoàn Thành = completed/total×100
    const ontimeRate     = u.ontime_rate     || 0   // Chính xác    = ontime/completed×100
    const productivity   = u.productivity    || 0   // Năng suất    = (%Hoàn + Chính xác)/2
    const score          = u.score           || 0   // Điểm         = (Năng suất + Chính xác)/2

    return `
    <tr class="table-row">
      <td class="py-2 pr-3">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">${(u.full_name||'?').split(' ').pop()?.charAt(0)}</div>
          <div>
            <div class="font-medium text-gray-800 text-sm">${u.full_name || '—'}</div>
          </div>
        </div>
      </td>
      <td class="py-2 pr-3 text-xs text-gray-500">${u.department || '—'}</td>
      <td class="py-2 pr-3 text-center font-medium">${u.total_tasks}</td>
      <td class="py-2 pr-3 text-center font-medium text-green-600">${u.completed_tasks}</td>
      <td class="py-2 pr-3 text-center">
        <span class="${getScoreColor(completionRate)} font-medium">${completionRate}%</span>
      </td>
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
      <td class="py-2 text-center">
        <span class="badge font-bold text-sm px-3 ${getBadgeClass(score)}">${score}</span>
      </td>
    </tr>`
  }).join('')
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
        minWidth: '220px',
        onchange: (val) => { if (val) loadFinanceProject() }
      })
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
  const yearCtrl   = $('finYearCtrl')
  const singleCtrl = $('finSingleMonthCtrl')
  const multiCtrl  = $('finMultiMonthCtrl')
  const rangeCtrl  = $('finRangeCtrl')

  // Show/hide controls based on mode
  if (yearCtrl)   yearCtrl.classList.toggle('hidden',   !['year','months','month'].includes(pt))
  if (singleCtrl) singleCtrl.classList.toggle('hidden', pt !== 'month')
  if (multiCtrl)  multiCtrl.classList.toggle('hidden',  pt !== 'months')
  if (rangeCtrl)  rangeCtrl.classList.toggle('hidden',  pt !== 'range')

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

    // Build query params based on mode
    let query = `/finance/project/${projectId}?mode=${periodMode}`

    if (periodMode === 'year') {
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
                  <td class="py-2 px-3">${ctIcon} ${c.label || getCostTypeName(c.cost_type)}
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
            labels: costs_by_type.map(c => c.label || getCostTypeName(c.cost_type)),
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
        data: { year: y, all_months: true, force_recalculate: true }
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
  // Init year filter
  const yf = $('laborYearFilter')
  if (yf && yf.options.length === 0) {
    [2023,2024,2025,2026,2027].forEach(y => {
      const opt = document.createElement('option')
      opt.value = y; opt.textContent = y
      if (y === new Date().getFullYear()) opt.selected = true
      yf.appendChild(opt)
    })
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
    [2023,2024,2025,2026,2027].forEach(y => {
      const opt = document.createElement('option')
      opt.value = y; opt.textContent = y
      if (y === new Date().getFullYear()) opt.selected = true
      iy.appendChild(opt)
    })
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
      // Ưu tiên pool_total (tổng đã nhập) làm tổng hiển thị, fallback grand_total
      const displayTotal = aggData.pool_total > 0 ? aggData.pool_total : aggData.grand_total_labor_cost
      if ($('laborYearlyTotalCost')) {
        $('laborYearlyTotalCost').textContent = fmtMoney(displayTotal)
        // Nếu pool_total khác grand_total → hiển thị ghi chú
        const diff = displayTotal - aggData.grand_total_labor_cost
        const diffEl = $('laborYearlyPoolDiff')
        if (diffEl) {
          if (aggData.pool_total > 0 && Math.abs(diff) > 0) {
            diffEl.textContent = `Đã phân bổ: ${fmtMoney(aggData.grand_total_labor_cost)}`
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

      // KPI cards — dùng pool_total (tổng lương đã nhập) làm KPI chính
      const kpiTotal = aggData.pool_total > 0 ? aggData.pool_total : aggData.grand_total_labor_cost
      if ($('laborKpiPool'))     $('laborKpiPool').textContent     = fmtMoney(kpiTotal)
      if ($('laborKpiSource'))   $('laborKpiSource').textContent   = periodType === 'all' ? `🗓️ NTC ${year}` : `📆 Nhiều tháng NTC ${year}`
      if ($('laborKpiHours'))    $('laborKpiHours').textContent    = fmt(totalHrs) + 'h'
      if ($('laborKpiRate'))     $('laborKpiRate').textContent     = fmtMoney(Math.round(avgRate)) + '/h'
      if ($('laborKpiProjects')) $('laborKpiProjects').textContent = aggData.projects_count || 0

      // Monthly breakdown table — dùng cal_pairs từ API (đã convert fiscal→calendar)
      const monthlyBreakTbody = $('laborMonthlyBreakdownTable')
      const calPairsData = aggData.cal_pairs || []
      if (monthlyBreakTbody && calPairsData.length > 0) {
        try {
          const mlcList = await api(`/monthly-labor-costs`)
          const mlcMap = {}
          for (const r of mlcList) mlcMap[`${r.month}-${r.year}`] = r

          const rows = calPairsData.map(p => {
            const key = `${p.calMonth}-${p.calYear}`
            const entry = mlcMap[key]
            // Dùng fiscalIdx (T1..T12) làm nhãn NTC, kèm tháng dương lịch để rõ ràng
            const ntcLabel = `T${p.fiscalIdx}`
            const calLabel = `(${p.calMonth}/${p.calYear})`
            const cph = aggData.grand_avg_cost_per_hour || 0
            if (!entry) return `<tr class="border-b border-blue-100">
              <td class="py-1 pr-3">
                <span class="font-medium text-blue-700">${ntcLabel}</span>
                <span class="text-xs text-blue-400 ml-1">${calLabel}</span>
              </td>
              <td colspan="3" class="py-1 text-xs text-gray-400 text-center">Chưa nhập</td>
            </tr>`
            return `<tr class="border-b border-blue-100">
              <td class="py-1 pr-3">
                <span class="font-medium text-blue-700">${ntcLabel}</span>
                <span class="text-xs text-blue-400 ml-1">${calLabel}</span>
              </td>
              <td class="py-1 pr-3 text-right">—</td>
              <td class="py-1 pr-3 text-right text-purple-600">${cph > 0 ? fmtMoney(Math.round(cph)) + '/h' : '—'}</td>
              <td class="py-1 text-right font-semibold text-green-700">${fmtMoney(entry.total_labor_cost)}</td>
            </tr>`
          }).join('')
          monthlyBreakTbody.innerHTML = rows
          $('laborMonthlyTableWrap')?.classList.remove('hidden')
        } catch(e2) { /* ignore monthly breakdown errors */ }
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

// Create / sync project labor cost (Error 3 fix)
async function createLaborCostForProject() {
  const panel = $('createLaborCostPanel')
  if (!panel) return
  // Populate project selector
  const sel = $('createLaborProjSel')
  if (sel && sel.options.length <= 1 && allProjects.length) {
    allProjects.forEach(p => {
      const opt = document.createElement('option')
      opt.value = p.id; opt.textContent = p.code + ' - ' + p.name
      sel.appendChild(opt)
    })
  } else if (sel && sel.options.length <= 1) {
    try {
      const projs = await api('/projects')
      projs.forEach(p => {
        const opt = document.createElement('option')
        opt.value = p.id; opt.textContent = p.code + ' - ' + p.name
        sel.appendChild(opt)
      })
    } catch(e) {}
  }
  // Set default month/year from filters
  const m = $('laborMonthFilter')?.value; const y = $('laborYearFilter')?.value
  if ($('createLaborMonth') && m) $('createLaborMonth').value = parseInt(m)
  if ($('createLaborYear') && y)  $('createLaborYear').value = y
  panel.classList.remove('hidden')
  panel.scrollIntoView({ behavior: 'smooth' })
}

async function doCreateLaborCost() {
  const projId = $('createLaborProjSel')?.value
  if (!projId) { toast('Vui lòng chọn dự án', 'warning'); return }
  const month = $('createLaborMonth')?.value
  const year  = $('createLaborYear')?.value
  const force = $('createLaborForce')?.checked || false
  const resultDiv = $('createLaborCostResult')

  try {
    // First check if exists
    const checkRes = await api(`/projects/${projId}/labor-costs-check?month=${month}&year=${year}`)
    if (checkRes.exists && !force) {
      if (!confirm(`Chi phí lương tháng ${month}/${year} cho dự án này đã tồn tại (${fmtMoney(checkRes.data?.total_labor_cost)} ₫).\nBấm OK để tính lại (force), hoặc Hủy để giữ nguyên.`)) {
        if (resultDiv) {
          resultDiv.classList.remove('hidden')
          resultDiv.innerHTML = `<span class="text-blue-700"><i class="fas fa-info-circle mr-1"></i>Giữ nguyên bản ghi hiện có: <strong>${fmtMoney(checkRes.data?.total_labor_cost)} ₫</strong></span>`
        }
        return
      }
      $('createLaborForce').checked = true
    }

    const body = { month: parseInt(month), year: parseInt(year), force_recalculate: force || checkRes.exists }
    const res = await api(`/projects/${projId}/labor-costs/sync`, { method: 'POST', data: body })
    toast(`${res.action === 'created' ? '✅ Đã tạo' : res.action === 'updated' ? '✅ Đã cập nhật' : '✅'} chi phí lương: ${fmtMoney(res.data?.total_labor_cost)} ₫`, 'success')

    if (resultDiv) {
      resultDiv.classList.remove('hidden')
      const actionLabel = res.action === 'created' ? 'Đã tạo mới' : res.action === 'updated' ? 'Đã cập nhật' : 'Đã xử lý'
      resultDiv.innerHTML = `<span class="text-green-700"><i class="fas fa-check-circle mr-1"></i>${actionLabel}: <strong>${fmtMoney(res.data?.total_labor_cost)} ₫</strong> | ${res.data?.total_hours}h × ${fmtMoney(res.data?.cost_per_hour)}/h</span>`
    }

    // Reload labor cost view
    loadLaborCost()
  } catch(e) {
    toast('Lỗi: ' + e.message, 'error')
    if (resultDiv) { resultDiv.classList.remove('hidden'); resultDiv.innerHTML = `<span class="text-red-600">Lỗi: ${e.message}</span>` }
  }
}

async function cleanupProjectLaborDuplicates() {
  const projId = $('createLaborProjSel')?.value || ''
  const label = projId ? `dự án ID ${projId}` : 'tất cả dự án'
  if (!confirm(`Xóa bản ghi chi phí lương trùng lặp cho ${label}?\n(Giữ bản ghi MIN id)`)) return
  try {
    let url = projId ? `/projects/${projId}/labor-costs/duplicates` : '/data-audit/fix-inconsistency'
    let result
    if (projId) {
      result = await api(url, { method: 'DELETE' })
      toast(`Đã xóa ${result.deleted_count} bản ghi trùng, còn lại ${result.remaining_records}`, 'success')
    } else {
      result = await api(url, { method: 'POST', data: { actions: ['dedup_all'] } })
      toast(`Đã xóa ${result.rows_deleted} bản ghi trùng lặp`, 'success')
    }
    loadLaborCost()
  } catch(e) { toast('Lỗi dọn trùng: ' + e.message, 'error') }
}

// ================================================================
// COST TYPES PAGE
// ================================================================
let allCostTypes = []

async function loadCostTypes() {
  try {
    allCostTypes = await api('/cost-types')
    renderCostTypesTable()
    // Also update cost type dropdown in cost modal
    const ctSel = $('costType')
    if (ctSel && allCostTypes.length) {
      ctSel.innerHTML = allCostTypes.filter(ct => ct.is_active).map(ct =>
        `<option value="${ct.code}">${ct.name}</option>`
      ).join('')
    }
  } catch(e) { toast('Lỗi tải loại chi phí: ' + e.message, 'error') }
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

    // Bảng danh sách
    renderSharedCostTable()
  } catch (e) {
    toast('Lỗi tải chi phí chung: ' + e.message, 'error')
  }
}

function renderSharedCostTable() {
  const tbody = $('sharedCostTableBody')
  if (!tbody) return
  if (_sharedCosts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-400">
      <i class="fas fa-folder-open text-2xl mb-2 block"></i>
      Chưa có chi phí chung. <button onclick="openSharedCostModal()" class="text-blue-600 hover:underline">Thêm ngay</button>
    </td></tr>`
    return
  }

  const basisLabel = { contract_value: '% GTHĐ', equal: 'Chia đều', manual: 'Thủ công' }
  const costTypeLabel = { office: 'Văn phòng', equipment: 'Thiết bị', material: 'Vật liệu', travel: 'Đi lại', other: 'Khác' }

  tbody.innerHTML = _sharedCosts.map(sc => {
    const allocInfo = (sc.allocations || []).map(a =>
      `<span class="inline-block bg-indigo-100 text-indigo-700 rounded px-1 py-0.5 mr-1 mb-1 text-xs" title="${a.project_name}: ${fmtMoney(a.allocated_amount)} (${a.allocation_pct.toFixed(1)}%)">${a.project_code}: ${fmtMoney(a.allocated_amount)}</span>`
    ).join('')
    const period = sc.month ? `T${sc.month}/${sc.year}` : (sc.year ? `Năm ${sc.year}` : '-')
    return `<tr class="hover:bg-gray-50">
      <td class="px-3 py-2">
        <div class="font-medium text-gray-800">${sc.description}</div>
        ${sc.notes ? `<div class="text-xs text-gray-400">${sc.notes}</div>` : ''}
        <div class="mt-1">${allocInfo}</div>
      </td>
      <td class="px-3 py-2 text-xs"><span class="badge badge-info">${costTypeLabel[sc.cost_type] || sc.cost_type}</span></td>
      <td class="px-3 py-2 text-right font-semibold text-yellow-700">${fmtMoney(sc.amount)}</td>
      <td class="px-3 py-2 text-center text-xs">${basisLabel[sc.allocation_basis] || sc.allocation_basis}</td>
      <td class="px-3 py-2 text-center text-xs">${sc.project_count || 0} dự án</td>
      <td class="px-3 py-2 text-center text-xs">${period}</td>
      <td class="px-3 py-2 text-xs text-gray-500">${sc.vendor || '-'}</td>
      <td class="px-3 py-2 text-center">
        <button onclick="openSharedCostModal(${sc.id})" class="text-blue-600 hover:text-blue-800 mr-2 text-xs"><i class="fas fa-edit"></i></button>
        <button onclick="deleteSharedCost(${sc.id})" class="text-red-500 hover:text-red-700 text-xs"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`
  }).join('')
}

async function openSharedCostModal(id = null) {
  if (!allProjects.length) allProjects = await api('/projects')

  // Reset form
  $('sharedCostId').value = ''
  $('sharedCostForm').reset()
  $('scYear').value = $('costYearFilter')?.value || new Date().getFullYear().toString()
  $('scCostDate').value = new Date().toISOString().split('T')[0]
  $('scPreviewPanel').classList.add('hidden')

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
      $('scCostType').value = sc.cost_type || 'other'
      $('scAmount').value = sc.amount
      if (sc.cost_date) $('scCostDate').value = sc.cost_date
      if (sc.month) $('scMonth').value = sc.month
      if (sc.year) $('scYear').value = sc.year
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
  const amount = parseFloat($('scAmount')?.value) || 0
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
  const amount = parseFloat($('scAmount').value)
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
  if (!confirm('Xóa chi phí chung này? Tất cả phân bổ về dự án cũng sẽ bị xóa.')) return
  try {
    await api(`/shared-costs/${id}`, { method: 'DELETE' })
    toast('Đã xóa chi phí chung', 'success')
    await loadSharedCosts()
  } catch (e) {
    toast('Lỗi xóa: ' + e.message, 'error')
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

function destroyChart(key) {
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
            <tbody>
              ${projects.sort((a,b) => a.health_score - b.health_score).map(p => `
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
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `

    // Draw charts
    destroyChart('healthDist')
    destroyChart('healthBars')

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
            <tbody>
              ${projects.map(p => `
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
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `

    destroyChart('perfTasks'); destroyChart('perfHours')
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

    destroyChart('taskStatus'); destroyChart('taskPriority'); destroyChart('taskPhase'); destroyChart('taskDiscipline'); destroyChart('taskTrend')

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

      <!-- Member Detail Table -->
      <div class="card">
        <h3 class="font-semibold text-gray-700 mb-4"><i class="fas fa-table mr-2 text-gray-500"></i>Bảng năng suất chi tiết (${year})</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="border-b text-left text-gray-500 text-xs uppercase">
              <th class="pb-2 pr-4">Nhân sự</th><th class="pb-2 pr-4">Phòng ban</th>
              <th class="pb-2 pr-4 text-right">Giờ thường</th><th class="pb-2 pr-4 text-right">Giờ TC</th>
              <th class="pb-2 pr-4 text-right">Tổng giờ</th><th class="pb-2 pr-4 text-right">Task xong/giao</th>
              <th class="pb-2 text-right">Hiệu suất task</th>
            </tr></thead>
            <tbody>
              ${members.sort((a,b)=>(b.total_hours||0)-(a.total_hours||0)).map(m => {
                const rate = pct(m.completed_tasks||0, m.assigned_tasks||1)
                return `<tr class="border-b hover:bg-gray-50">
                  <td class="py-3 pr-4 font-medium text-gray-800">${m.full_name}</td>
                  <td class="py-3 pr-4 text-gray-500 text-xs">${m.department||'-'}</td>
                  <td class="py-3 pr-4 text-right">${(m.regular_hours||0).toFixed(1)}h</td>
                  <td class="py-3 pr-4 text-right text-orange-600">${(m.overtime_hours||0).toFixed(1)}h</td>
                  <td class="py-3 pr-4 text-right font-semibold">${(m.total_hours||0).toFixed(1)}h</td>
                  <td class="py-3 pr-4 text-right">${m.completed_tasks||0}/${m.assigned_tasks||0}</td>
                  <td class="py-3 text-right">
                    <div class="flex items-center justify-end gap-2">
                      <div class="w-16 bg-gray-200 rounded-full h-2"><div class="h-2 rounded-full ${rate>=80?'bg-green-500':rate>=50?'bg-blue-500':'bg-red-400'}" style="width:${rate}%"></div></div>
                      <span class="text-xs text-gray-600 w-8">${rate}%</span>
                    </div>
                  </td>
                </tr>`
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `

    destroyChart('teamTopHours'); destroyChart('teamTaskRate')
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
    destroyChart('tsMonthly'); destroyChart('tsStatus'); destroyChart('tsDept'); destroyChart('taskVsPlan')

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
        scales:{ x:{ stacked:true, ticks:{ font:{ size:10 } } }, y:{ stacked:true, ticks:{ font:{ size:10 } } } } }
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

    const costTypeLabel = { salary:'Lương', equipment:'Thiết bị', material:'Vật liệu', travel:'Đi lại', office:'Văn phòng', shared:'Chi phí chung', transport:'Vận chuyển', other:'Khác' }
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

    destroyChart('finMonthly'); destroyChart('finCostType'); destroyChart('finRevStatus')

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
        labels: costTypes.map(x=>costTypeLabel[x.cost_type]||x.cost_type),
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

// ----------------------------------------------------------------
// Export PDF (basic print dialog)
// ----------------------------------------------------------------
function exportAnalyticsPDF() {
  window.print()
}
