// ================================================================
// OneCad BIM Management System - Frontend Application
// ================================================================

const API_BASE = ''
let currentUser = null
let authToken = null
let allProjects = []
let allTasks = []
let allUsers = []
let allTimesheets = []
let allAssets = []
let allCosts = []
let allRevenues = []
let allDisciplines = []
let currentCostTab = 'costs'
let charts = {}

// ── Guard flags to prevent duplicate API calls on Chi Phí & Doanh Thu ──
let _costDashboardLoading = false      // prevent concurrent loadCostDashboard calls
let _costAnalysisLoading = false       // prevent concurrent loadCostAnalysis calls
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

function closeModal(id) { $(id).style.display = 'none' }
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
    'system-config': 'Cấu hình hệ thống'
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

  initDatetimeClock()
  loadDashboard()
  loadNotifications()
  setInterval(loadNotifications, 60000)
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
  if (charts[id]) { charts[id].destroy(); delete charts[id] }
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
  charts['productivity'] = new Chart(ctx, {
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
  charts['discipline'] = new Chart(ctx, {
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
  charts['hours'] = new Chart(ctx, {
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
async function loadNotifications() {
  try {
    const notifs = await api('/notifications')
    const unread = notifs.filter(n => !n.is_read).length
    const badge = $('notifBadge')
    if (badge) {
      badge.textContent = unread
      badge.style.display = unread > 0 ? 'flex' : 'none'
    }
    const list = $('notifList')
    if (list) {
      list.innerHTML = notifs.slice(0, 10).map(n => `
        <div class="p-3 hover:bg-gray-50 cursor-pointer ${!n.is_read ? 'bg-green-50' : ''}" onclick="readNotif(${n.id})">
          <div class="flex gap-2">
            <div class="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${!n.is_read ? 'bg-green-500' : 'bg-gray-300'}"></div>
            <div>
              <p class="text-sm font-medium text-gray-800">${n.title}</p>
              <p class="text-xs text-gray-500">${n.message}</p>
              <p class="text-xs text-gray-400 mt-1">${dayjs(n.created_at).format('DD/MM HH:mm')}</p>
            </div>
          </div>
        </div>`
      ).join('') || '<div class="p-4 text-center text-gray-400 text-sm">Không có thông báo</div>'
    }
  } catch (e) { /* silent */ }
}

async function readNotif(id) {
  await api(`/notifications/${id}/read`, { method: 'patch' })
  loadNotifications()
}

async function markAllRead() {
  await api('/notifications/read-all', { method: 'patch' })
  loadNotifications()
  $('notifDropdown').style.display = 'none'
}

// ================================================================
// PROJECTS
// ================================================================
async function loadProjects() {
  try {
    allProjects = await api('/projects')
    allUsers = await api('/users')
    renderProjectsGrid(allProjects)

    // Fill project filter dropdowns across pages
    const selects = ['taskProjectFilter', 'tsProjectFilter', 'costProjectFilter', 'ganttProjectSelect', 'tsProject', 'costProject']
    selects.forEach(id => {
      const el = $(id)
      if (el) {
        const existing = el.innerHTML
        if (!el.querySelector('option[value=""]')) el.innerHTML = '<option value="">-- Chọn dự án --</option>'
        else el.innerHTML = el.querySelector('option[value=""]').outerHTML
        allProjects.forEach(p => {
          const opt = document.createElement('option')
          opt.value = p.id; opt.textContent = `${p.code} - ${p.name}`
          el.appendChild(opt)
        })
      }
    })
  } catch (e) { toast('Lỗi tải dự án: ' + e.message, 'error') }
}

function renderProjectsGrid(projects) {
  const grid = $('projectsGrid')
  if (!grid) return
  grid.innerHTML = projects.map(p => {
    const total = p.total_tasks || 0
    const done = p.completed_tasks || 0
    const pct = total > 0 ? Math.round((done / total) * 100) : p.progress || 0
    const hasOverdue = p.overdue_tasks > 0
    const typeColors = { building: '#0066CC', infrastructure: '#F59E0B', transport: '#8B5CF6', energy: '#EF4444' }
    return `<div class="card hover:shadow-md transition-shadow cursor-pointer" onclick="openProjectDetail(${p.id})">
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
}

function filterProjects() {
  const search = $('projectSearch').value.toLowerCase()
  const status = $('projectStatusFilter').value
  const type = $('projectTypeFilter').value
  const filtered = allProjects.filter(p =>
    (!search || p.name.toLowerCase().includes(search) || p.code.toLowerCase().includes(search) || (p.client||'').toLowerCase().includes(search)) &&
    (!status || p.status === status) &&
    (!type || p.project_type === type)
  )
  renderProjectsGrid(filtered)
}

async function openProjectDetail(id) {
  try {
    const project = await api(`/projects/${id}`)
    const categories = await api(`/projects/${id}/categories`)
    const tasks = await api(`/tasks?project_id=${id}`)

    $('projectDetailName').textContent = project.name
    $('projectDetailCode').textContent = `${project.code} • ${getProjectTypeName(project.project_type)}`
    $('projectDetailStatus').innerHTML = getStatusBadge(project.status)

    const canEdit = ['system_admin', 'project_admin'].includes(currentUser.role)
    const canDelete = currentUser.role === 'system_admin'

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
            ${canEdit ? `<button onclick="openAddMemberModal(${project.id})" class="btn-primary text-xs px-3 py-1.5"><i class="fas fa-plus mr-1"></i>Thêm</button>` : ''}
          </div>
          <div class="space-y-2 max-h-48 overflow-y-auto">
            ${project.members?.map(m => `
              <div class="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg">
                <div class="flex items-center gap-2">
                  <div class="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">${m.full_name?.split(' ').pop()?.charAt(0) || 'U'}</div>
                  <div>
                    <div class="text-sm font-medium text-gray-800">${m.full_name}</div>
                    <div class="text-xs text-gray-400">${m.department || ''}</div>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  ${getRoleBadge(m.role)}
                  ${canEdit ? `<button onclick="removeMember(${project.id}, ${m.user_id})" class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-times"></i></button>` : ''}
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
                  ${cat.discipline_code ? `<span class="badge ml-2 text-xs" style="background:#e0f2fe;color:#0369a1">${cat.discipline_code}</span>` : ''}
                  <span class="badge ml-1 text-xs" style="background:#f0fdf4;color:#15803d">${getPhaseName(cat.phase)}</span>
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

      <!-- Tasks Table -->
      <div class="card">
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-bold text-gray-800"><i class="fas fa-tasks text-primary mr-2"></i>Danh sách Task (${tasks.length})</h3>
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
            <tbody class="divide-y">
              ${tasks.map(t => `<tr class="${isOverdue(t) ? 'overdue-row' : 'table-row'}">
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
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `

    navigate('project-detail')
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
  $('projectName').value = project?.name || ''
  $('projectDesc').value = project?.description || ''
  $('projectClient').value = project?.client || ''
  $('projectType').value = project?.project_type || 'building'
  $('projectStartDate').value = project?.start_date || ''
  $('projectEndDate').value = project?.end_date || ''
  $('projectContractValue').value = project?.contract_value || ''
  // Show/hide contract value field based on role
  const contractRow = document.getElementById('contractValueRow')
  if (contractRow) contractRow.style.display = currentUser?.role === 'system_admin' ? '' : 'none'
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
  $('catPhase').value = cat?.phase || 'basic_design'
  $('catDiscipline').innerHTML = '<option value="">-- Chọn bộ môn --</option>' +
    allDisciplines.map(d => `<option value="${d.code}" ${cat?.discipline_code===d.code?'selected':''}>${d.code} - ${d.name}</option>`).join('')
  $('catDiscipline').value = cat?.discipline_code || ''
  openModal('categoryModal')
}

$('categoryForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('catId').value
  const data = {
    project_id: parseInt($('catProjectId').value),
    name: $('catName').value, code: $('catCode').value,
    discipline_code: $('catDiscipline').value, phase: $('catPhase').value,
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
// TASKS
// ================================================================
async function loadTasks() {
  try {
    if (!allProjects.length) allProjects = await api('/projects')
    if (!allUsers.length) allUsers = await api('/users')
    allTasks = await api('/tasks')

    // Fill project filter
    const pf = $('taskProjectFilter')
    if (pf) {
      pf.innerHTML = '<option value="">Tất cả dự án</option>' + allProjects.map(p => `<option value="${p.id}">${p.code}</option>`).join('')
    }

    // Fill discipline filter
    const df = $('taskDisciplineFilter')
    if (df && allDisciplines.length) {
      df.innerHTML = '<option value="">Tất cả bộ môn</option>' + allDisciplines.map(d => `<option value="${d.code}">${d.code} - ${d.name}</option>`).join('')
    }

    renderTasksTable(allTasks)
  } catch (e) { toast('Lỗi tải task: ' + e.message, 'error') }
}

function renderTasksTable(tasks) {
  const tbody = $('tasksTable')
  if (!tbody) return
  const canEditTask = ['system_admin', 'project_admin'].includes(currentUser?.role)
  const canDeleteTask = ['system_admin', 'project_admin'].includes(currentUser?.role)
  tbody.innerHTML = tasks.map(t => {
    const isAssigned = t.assigned_to === currentUser?.id
    const memberCanEdit = currentUser?.role === 'member' && isAssigned
    return `
    <tr class="table-row ${isOverdue(t) ? 'overdue-row' : ''}">
      <td class="py-2 pr-3">
        <div class="font-medium text-gray-800 text-sm cursor-pointer hover:text-primary" onclick="openTaskDetail(${t.id})">${t.title}</div>
        ${isOverdue(t) ? '<span class="badge badge-overdue text-xs">Trễ hạn!</span>' : ''}
        <div class="text-xs text-gray-400">${getPhaseName(t.phase)}</div>
      </td>
      <td class="py-2 pr-3 text-sm text-gray-600">${t.project_code || '-'}</td>
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
          ${(canEditTask || memberCanEdit) ? `<button onclick="openTaskModal(${t.id})" class="btn-secondary text-xs px-2 py-1" title="Sửa"><i class="fas fa-edit"></i></button>` : ''}
          ${canDeleteTask ? `<button onclick="confirmDeleteTask(${t.id}, '${t.title.replace(/'/g,"\\'")}' )" class="text-red-400 hover:text-red-600 px-2 py-1 text-sm" title="Xóa"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </td>
    </tr>`
  }).join('') || '<tr><td colspan="9" class="text-center py-8 text-gray-400">Không có task nào</td></tr>'
}

function filterTasks() {
  const search = $('taskSearch').value.toLowerCase()
  const status = $('taskStatusFilter').value
  const priority = $('taskPriorityFilter').value
  const project = $('taskProjectFilter').value
  const discipline = $('taskDisciplineFilter')?.value || ''
  const onlyOverdue = $('taskOverdueFilter').checked

  const filtered = allTasks.filter(t =>
    (!search || t.title.toLowerCase().includes(search) || (t.assigned_to_name||'').toLowerCase().includes(search)) &&
    (!status || t.status === status) &&
    (!priority || t.priority === priority) &&
    (!project || String(t.project_id) === project) &&
    (!discipline || t.discipline_code === discipline) &&
    (!onlyOverdue || isOverdue(t))
  )
  renderTasksTable(filtered)
}

async function openTaskModal(taskId = null, projectId = null) {
  if (!allProjects.length) allProjects = await api('/projects')
  if (!allUsers.length) allUsers = await api('/users')

  $('taskModalTitle').textContent = taskId ? 'Chỉnh sửa Task' : 'Tạo Task mới'
  $('taskId').value = taskId || ''
  const isMember = currentUser?.role === 'member'

  // Fill projects
  $('taskProject').innerHTML = '<option value="">-- Chọn dự án --</option>' +
    allProjects.map(p => `<option value="${p.id}">${p.code} - ${p.name}</option>`).join('')

  // Fill disciplines
  $('taskDiscipline').innerHTML = '<option value="">-- Chọn bộ môn --</option>' +
    allDisciplines.map(d => `<option value="${d.code}">${d.code} - ${d.name}</option>`).join('')

  // Fill assignees
  $('taskAssignee').innerHTML = '<option value="">-- Chọn người phụ trách --</option>' +
    allUsers.filter(u => u.is_active).map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')

  // For member: disable admin-only fields
  const adminOnlyFields = ['taskTitle','taskDesc','taskProject','taskCategory','taskDiscipline','taskPhase','taskPriority','taskAssignee','taskStartDate','taskDueDate','taskEstHours']
  adminOnlyFields.forEach(id => { const el = $(id); if(el) el.disabled = isMember })

  if (taskId) {
    try {
      const task = await api(`/tasks/${taskId}`)
      $('taskTitle').value = task.title || ''
      $('taskDesc').value = task.description || ''
      $('taskProject').value = task.project_id || ''
      $('taskDiscipline').value = task.discipline_code || ''
      $('taskPhase').value = task.phase || 'basic_design'
      $('taskPriority').value = task.priority || 'medium'
      $('taskStatus').value = task.status || 'todo'
      $('taskAssignee').value = task.assigned_to || ''
      $('taskStartDate').value = task.start_date || ''
      $('taskDueDate').value = task.due_date || ''
      $('taskEstHours').value = task.estimated_hours || 0
      $('taskProgress').value = task.progress || 0
      $('taskProgressLabel').textContent = task.progress || 0
      await loadTaskCategories(task.project_id, task.category_id)
    } catch (e) { toast('Lỗi tải task', 'error'); return }
  } else {
    $('taskTitle').value = ''
    $('taskDesc').value = ''
    $('taskProject').value = projectId || ''
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
    if (projectId) await loadTaskCategories(projectId)
  }

  openModal('taskModal')
}

async function loadTaskCategories(projectId = null, selectedCategoryId = null) {
  const projId = projectId || $('taskProject').value
  const catSelect = $('taskCategory')
  catSelect.innerHTML = '<option value="">-- Chọn hạng mục --</option>'
  if (projId) {
    try {
      const cats = await api(`/projects/${projId}/categories`)
      cats.forEach(c => {
        const opt = document.createElement('option')
        opt.value = c.id; opt.textContent = c.name
        if (selectedCategoryId && c.id === selectedCategoryId) opt.selected = true
        catSelect.appendChild(opt)
      })
    } catch (e) { /* silent */ }
  }
}

$('taskForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('taskId').value
  const data = {
    project_id: parseInt($('taskProject').value),
    category_id: parseInt($('taskCategory').value) || null,
    title: $('taskTitle').value,
    description: $('taskDesc').value,
    discipline_code: $('taskDiscipline').value || null,
    phase: $('taskPhase').value,
    priority: $('taskPriority').value,
    status: $('taskStatus').value,
    assigned_to: parseInt($('taskAssignee').value) || null,
    start_date: $('taskStartDate').value || null,
    due_date: $('taskDueDate').value || null,
    estimated_hours: parseFloat($('taskEstHours').value) || 0,
    progress: parseInt($('taskProgress').value) || 0
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

async function openTaskDetail(id) {
  try {
    const task = await api(`/tasks/${id}`)
    $('taskDetailTitle').textContent = task.title
    const overdue = isOverdue(task)

    $('taskDetailContent').innerHTML = `
      <div class="space-y-4">
        <div class="flex flex-wrap gap-2">
          ${getStatusBadge(task.status)} ${getPriorityBadge(task.priority)}
          <span class="badge" style="background:#e0f2fe;color:#0369a1">${task.discipline_code||'N/A'}</span>
          <span class="badge" style="background:#f0fdf4;color:#15803d">${getPhaseName(task.phase)}</span>
          ${overdue ? '<span class="badge badge-overdue">Trễ hạn!</span>' : ''}
        </div>
        ${task.description ? `<p class="text-gray-600 text-sm">${task.description}</p>` : ''}
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div><span class="text-gray-500">Dự án:</span> <span class="font-medium">${task.project_name||'-'}</span></div>
          <div><span class="text-gray-500">Phụ trách:</span> <span class="font-medium">${task.assigned_to_name||'-'}</span></div>
          <div><span class="text-gray-500">Bắt đầu:</span> <span class="font-medium">${fmtDate(task.start_date)}</span></div>
          <div><span class="text-gray-500 ${overdue?'text-red-500':''}">Hạn:</span> <span class="font-medium ${overdue?'text-red-600':''}">${fmtDate(task.due_date)}</span></div>
          <div><span class="text-gray-500">Giờ dự kiến:</span> <span class="font-medium">${task.estimated_hours||0}h</span></div>
          <div><span class="text-gray-500">Giờ thực tế:</span> <span class="font-medium">${task.actual_hours||0}h</span></div>
        </div>
        <div>
          <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-500">Tiến độ</span>
            <span class="font-bold">${task.progress||0}%</span>
          </div>
          <div class="progress-bar"><div class="progress-fill ${overdue?'danger':''}" style="width:${task.progress||0}%"></div></div>
        </div>
        
        ${task.history?.length > 0 ? `
        <div>
          <h4 class="font-bold text-gray-700 mb-2 text-sm"><i class="fas fa-history mr-2"></i>Lịch sử thay đổi</h4>
          <div class="space-y-1 max-h-40 overflow-y-auto">
            ${task.history.map(h => `
              <div class="flex gap-2 text-xs text-gray-500 py-1 border-b">
                <span class="text-gray-400">${dayjs(h.created_at).format('DD/MM HH:mm')}</span>
                <span class="font-medium text-gray-700">${h.changed_by_name}</span>
                <span>→ ${h.field_changed}: ${h.new_value || '-'}</span>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        <div class="flex justify-end gap-2 pt-2 border-t">
          <button onclick="closeModal('taskDetailModal')" class="btn-secondary text-sm">Đóng</button>
          <button onclick="closeModal('taskDetailModal'); openTaskModal(${task.id})" class="btn-primary text-sm">Chỉnh sửa</button>
        </div>
      </div>
    `
    openModal('taskDetailModal')
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
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
  const isProjAdmin = currentUser.role === 'project_admin' || currentUser.role === 'project_leader'
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
      if (i + 1 === new Date().getMonth() + 1) opt.selected = true
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
    const projSel = $('tsProjectFilter')
    if (projSel) {
      const savedVal = projSel.value  // preserve current selection
      const projects = await api('/timesheets/projects')
      _tsProjectsCache = projects
      // Backfill allProjects cache for other uses
      if (!allProjects.length) allProjects = projects
      projSel.innerHTML = '<option value="">📁 Tất cả dự án</option>' +
        projects.map(p => `<option value="${p.id}">${p.code} – ${p.name} (${p.total_hours || 0}h)</option>`).join('')
      // Restore selection after rebuild
      if (savedVal) projSel.value = savedVal
    }
  } catch (_) {
    // fallback to allProjects cache
    if (!allProjects.length) { try { allProjects = await api('/projects') } catch(__) {} }
    const projSel = $('tsProjectFilter')
    if (projSel && projSel.options.length <= 1) {
      projSel.innerHTML = '<option value="">📁 Tất cả dự án</option>' +
        allProjects.map(p => `<option value="${p.id}">${p.code} – ${p.name}</option>`).join('')
    }
  }

  // ------ Member dropdown — from /api/timesheets/members (admin/projAdmin only) ------
  const tsUserWrap = $('tsUserFilterWrap')
  const tsUserF    = $('tsUserFilter')
  const tsStatusW  = $('tsStatusFilterWrap')

  if (canSeeAll && tsUserWrap && tsUserF) {
    tsUserWrap.classList.remove('hidden'); tsUserWrap.classList.add('flex')
    try {
      const savedUserId = tsUserF.value
      const members = await api('/timesheets/members')
      _tsMembersCache = members
      // Backfill allUsers cache
      if (!allUsers.length) allUsers = members
      const membersForFilter = isAdmin ? members : members.filter(m => m.role !== 'system_admin')
      tsUserF.innerHTML = '<option value="">👤 Tất cả nhân viên</option>' +
        membersForFilter.map(m => `<option value="${m.id}">${m.full_name} (${m.total_hours || 0}h)</option>`).join('')
      // Restore selection
      if (savedUserId) tsUserF.value = savedUserId
    } catch (_) {
      if (!allUsers.length) { try { allUsers = await api('/users') } catch(__) {} }
      const usersForFilter = isAdmin ? allUsers : allUsers.filter(u => u.role !== 'system_admin')
      tsUserF.innerHTML = '<option value="">👤 Tất cả nhân viên</option>' +
        usersForFilter.map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')
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
    const isProjAdmin = currentUser.role === 'project_admin' || currentUser.role === 'project_leader'
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
    const projectId = $('tsProjectFilter')?.value || ''
    const memberId  = canSeeAll ? ($('tsUserFilter')?.value   || '') : ''
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
  const tsUserF = $('tsUserFilter')
  if (!tsUserF) return
  // userId can be a number or string
  const opt = Array.from(tsUserF.options).find(o => String(o.value) === String(userId))
  if (opt) { tsUserF.value = opt.value; loadTimesheets() }
}
function filterTsByProject(projectId) {
  const tsProj = $('tsProjectFilter')
  if (!tsProj) return
  const opt = Array.from(tsProj.options).find(o => String(o.value) === String(projectId))
  if (opt) { tsProj.value = opt.value; loadTimesheets() }
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
  const p = $('tsProjectFilter'); if (p) p.value = ''
  const u = $('tsUserFilter');    if (u) u.value = ''
  const s = $('tsStatusFilter');  if (s) s.value = ''
  // Force re-populate dropdowns with latest data on next load
  _tsDropdownsInitialised = false
  loadTimesheets()
}

function exportTimesheetExcel() {
  if (!allTimesheets.length) { toast('Không có dữ liệu để xuất', 'warning'); return }
  const isAdmin     = currentUser.role === 'system_admin'
  const isProjAdmin = currentUser.role === 'project_admin' || currentUser.role === 'project_leader'
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
  const isProjAdmin = currentUser.role === 'project_admin' || currentUser.role === 'project_leader'
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

async function openTimesheetModal(tsId = null) {
  if (!allProjects.length) allProjects = await api('/projects')

  const isAdmin     = currentUser.role === 'system_admin'
  const isProjAdmin = currentUser.role === 'project_admin' || currentUser.role === 'project_leader'

  $('tsModalTitle').textContent = tsId ? 'Sửa Timesheet' : 'Thêm Timesheet'
  $('tsId').value = tsId || ''

  const tsProj = $('tsProject')
  tsProj.innerHTML = '<option value="">-- Chọn dự án --</option>' +
    allProjects.map(p => `<option value="${p.id}">${p.code} - ${p.name}</option>`).join('')

  if (tsId) {
    const ts = allTimesheets.find(t => t.id === tsId)
    if (ts) {
      // Kiểm tra quyền sửa: member chỉ sửa draft/rejected của mình
      const isOwner = ts.user_id === currentUser.id
      if (!isAdmin && !isProjAdmin && !(isOwner && ['draft', 'rejected'].includes(ts.status))) {
        toast('Bạn không có quyền sửa timesheet này', 'warning')
        return
      }
      $('tsDate').value = ts.work_date || ''
      $('tsProject').value = ts.project_id || ''
      $('tsRegularHours').value = ts.regular_hours || 8
      $('tsOvertimeHours').value = ts.overtime_hours || 0
      $('tsDescription').value = ts.description || ''
      await loadTsTasks(ts.project_id, ts.task_id)

      // Disable fields nếu đã submitted (project_admin/system_admin có thể sửa)
      const locked = !isAdmin && !isProjAdmin && ts.status === 'submitted'
      ;['tsDate','tsProject','tsRegularHours','tsOvertimeHours','tsDescription','tsTask'].forEach(id => {
        const el = $(id); if (el) el.disabled = locked
      })
    }
  } else {
    $('tsDate').value = today()
    $('tsRegularHours').value = 8
    $('tsOvertimeHours').value = 0
    $('tsDescription').value = ''
    $('tsTask').innerHTML = '<option value="">-- Chọn task --</option>'
    ;['tsDate','tsProject','tsRegularHours','tsOvertimeHours','tsDescription','tsTask'].forEach(id => {
      const el = $(id); if (el) el.disabled = false
    })
  }

  openModal('timesheetModal')
}

async function loadTsTasks(projectId = null, selectedTaskId = null) {
  const projId = projectId || $('tsProject').value
  const taskSel = $('tsTask')
  taskSel.innerHTML = '<option value="">-- Không có task --</option>'
  if (projId) {
    try {
      const tasks = await api(`/tasks?project_id=${projId}`)
      tasks.forEach(t => {
        const opt = document.createElement('option')
        opt.value = t.id; opt.textContent = t.title
        if (selectedTaskId && t.id === selectedTaskId) opt.selected = true
        taskSel.appendChild(opt)
      })
    } catch (e) { /* silent */ }
  }
}

$('tsForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = $('tsId').value
  const data = {
    project_id: parseInt($('tsProject').value),
    task_id: parseInt($('tsTask').value) || null,
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
    }
    closeModal('timesheetModal')
    loadTimesheets()
  } catch (e) {
    const errMsg = e.response?.data?.error || e.message || 'Lỗi không xác định'
    // 409 with exists=true means it's approved, can't edit
    if (e.response?.status === 409 && e.response?.data?.exists) {
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
  const sel = $('ganttProjectSelect')
  if (sel) {
    sel.innerHTML = '<option value="">-- Chọn dự án --</option>' +
      allProjects.map(p => `<option value="${p.id}">${p.code} - ${p.name}</option>`).join('')
  }
}

async function renderGantt() {
  const projectId = $('ganttProjectSelect').value
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
  // Guard: prevent concurrent calls
  if (_costDashboardLoading) return
  _costDashboardLoading = true
  try {
    if (!allProjects.length) allProjects = await api('/projects')

    // Fill project filters
    const cpf = $('costProjectFilter')
    if (cpf) cpf.innerHTML = '<option value="">Tất cả dự án</option>' + allProjects.map(p => `<option value="${p.id}">${p.code}</option>`).join('')

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
  finally { _costDashboardLoading = false }
}

function renderCostProjectChart(revenues, costs) {
  destroyChart('costProject')
  const ctx = $('costProjectChart')
  if (!ctx) return
  const projects = revenues?.slice(0, 6) || []
  charts['costProject'] = new Chart(ctx, {
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

  // Aggregate monthly non-salary + labor costs
  const monthlyMap = {}
  data?.forEach(d => {
    if (!monthlyMap[d.month]) monthlyMap[d.month] = 0
    monthlyMap[d.month] += d.total_cost || 0
  })

  const months = Object.keys(monthlyMap).sort()
  charts['costMonthly'] = new Chart(ctx, {
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
    const projectId = $('costProjectFilter')?.value
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
  // Guard: prevent concurrent API calls
  if (_costAnalysisLoading) return
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
      if (ctx && breakdown.length) {
        const colors = ['#2196f3','#ff9800','#f44336','#9c27b0','#00bcd4','#4caf50','#795548']
        charts['anaDoughnut'] = new Chart(ctx, {
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
        <div class="flex gap-1">
          <button onclick="openUserModal(${u.id})" class="btn-secondary text-xs px-2 py-1"><i class="fas fa-edit"></i></button>
          ${u.id !== currentUser.id ? `<button onclick="toggleUserStatus(${u.id}, ${u.is_active})" class="${u.is_active ? 'text-red-400 hover:text-red-600' : 'text-green-400 hover:text-green-600'} px-1.5 text-sm" title="${u.is_active ? 'Vô hiệu hóa' : 'Kích hoạt'}"><i class="fas fa-${u.is_active ? 'ban' : 'check'}"></i></button>` : ''}
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

  const passwordField = $('userPassword').parentElement
  if (userId) {
    $('userPassword').required = false
    $('userPassword').placeholder = 'Để trống nếu không đổi'
  } else {
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
          // Try exact match first, else add custom option
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
  const data = {
    username: $('userUsername').value,
    full_name: $('userFullName').value,
    email: $('userEmail').value,
    phone: $('userPhone').value,
    role: $('userRole').value,
    department: ($('userDepartment')?.value) || '',
    salary_monthly: parseFloat($('userSalary').value) || 0
  }
  const password = $('userPassword').value
  if (!id && !password) { toast('Nhập mật khẩu', 'warning'); return }
  if (password) data.password = password

  try {
    if (id) await api(`/users/${id}`, { method: 'put', data })
    else await api('/users', { method: 'post', data })
    closeModal('userModal')
    toast(id ? 'Cập nhật tài khoản' : 'Tạo tài khoản thành công')
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
  _costAnalysisLoading = false
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
    charts['prodBar'] = new Chart(ctx1, {
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
      charts['prodPie'] = new Chart(ctx2, {
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
    const sel = $('finProjSelect')
    if (sel && sel.options.length <= 1) {
      allProjects.forEach(p => {
        const opt = document.createElement('option')
        opt.value = p.id; opt.textContent = p.code + ' - ' + p.name
        sel.appendChild(opt)
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
  const projectId = $('finProjSelect')?.value
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
        charts['finCostPie'] = new Chart(ctx1, {
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
          charts['finTimeline'] = new Chart(ctx2, {
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
        charts['labor'] = new Chart(ctx1, {
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
        charts['laborPie'] = new Chart(ctx2, {
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
      charts['labor'] = new Chart(ctx1, {
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
      charts['laborPie'] = new Chart(ctx2, {
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

  // Render project checkboxes
  const activeProjects = allProjects.filter(p => p.status !== 'cancelled')
  $('scProjectList').innerHTML = activeProjects.map(p => `
    <label class="flex items-center gap-2 p-2 hover:bg-white rounded cursor-pointer border border-transparent hover:border-gray-200 transition-colors">
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
