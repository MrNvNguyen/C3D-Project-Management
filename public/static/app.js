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
  return task.due_date && task.due_date < today() && task.status !== 'completed' && task.status !== 'cancelled'
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
    'labor-cost': 'Chi phí lương', 'cost-types': 'Loại chi phí'
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

  // Show admin nav and new project button
  if (currentUser.role === 'system_admin') {
    $('adminNav').style.display = 'block'
    $('btnNewProject').classList.remove('hidden')
  } else if (currentUser.role === 'project_admin') {
    // project_admin can create projects but no access to financial/asset/user admin
    $('btnNewProject').classList.remove('hidden')
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
  charts['productivity'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top10.map(u => u.full_name?.split(' ').slice(-1)[0] || u.full_name),
      datasets: [
        { label: 'Task hoàn thành', data: top10.map(u => u.completed_tasks || 0), backgroundColor: '#00A651', borderRadius: 4 },
        { label: 'Tổng giờ (30d)', data: top10.map(u => u.total_hours || 0), backgroundColor: '#dbeafe', borderRadius: 4, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Tasks' } },
        y1: { beginAtZero: true, position: 'right', title: { display: true, text: 'Giờ' }, grid: { drawOnChartArea: false } }
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
    const done = tasks.filter(t => t.status === 'completed').length
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
async function loadTimesheets() {
  try {
    if (!allProjects.length) allProjects = await api('/projects')
    if (!allUsers.length) allUsers = await api('/users')

    const isAdmin  = currentUser.role === 'system_admin'
    const isProjAdmin = currentUser.role === 'project_admin' || currentUser.role === 'project_leader'
    const canSeeAll = isAdmin || isProjAdmin

    // Subtitle theo role
    const subtitle = $('tsPageSubtitle')
    if (subtitle) {
      if (isAdmin)       subtitle.textContent = 'Xem toàn bộ timesheet tất cả thành viên, tất cả dự án'
      else if (isProjAdmin) subtitle.textContent = 'Xem & duyệt timesheet của các thành viên trong dự án bạn quản lý'
      else               subtitle.textContent = 'Timesheet cá nhân của bạn'
    }

    // Summary cards — chỉ admin / project_admin
    const summaryCards = $('tsSummaryCards')
    if (summaryCards) summaryCards.classList.toggle('hidden', !canSeeAll)

    // Init month filter
    const monthSel = $('tsMonthFilter')
    if (monthSel && monthSel.options.length <= 1) {
      const monthNames = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12']
      monthNames.forEach((name, i) => {
        const opt = document.createElement('option')
        opt.value = String(i + 1).padStart(2, '0')
        opt.textContent = name
        if (i + 1 === new Date().getMonth() + 1) opt.selected = true
        monthSel.appendChild(opt)
      })
    }

    // Init year filter
    const yearSel = $('tsYearFilter')
    if (yearSel && yearSel.options.length <= 1) {
      ;[2023, 2024, 2025, 2026].forEach(y => {
        const opt = document.createElement('option')
        opt.value = y; opt.textContent = y
        if (y === new Date().getFullYear()) opt.selected = true
        yearSel.appendChild(opt)
      })
    }

    // Project filter — tất cả đều có
    const tsProj = $('tsProjectFilter')
    if (tsProj) {
      tsProj.innerHTML = '<option value="">Tất cả dự án</option>' +
        allProjects.map(p => `<option value="${p.id}">${p.code} - ${p.name}</option>`).join('')
    }

    // User filter — chỉ hiện với project_admin / system_admin
    const tsUserF = $('tsUserFilter')
    if (tsUserF) {
      if (canSeeAll) {
        tsUserF.classList.remove('hidden')
        // system_admin thấy tất cả user; project_admin chỉ thấy member trong dự án mình
        const usersForFilter = isAdmin
          ? allUsers
          : allUsers.filter(u => u.role !== 'system_admin')
        tsUserF.innerHTML = '<option value="">Tất cả nhân viên</option>' +
          usersForFilter.map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')
      } else {
        tsUserF.classList.add('hidden')
      }
    }

    // Status filter — chỉ hiện với admin / project_admin
    const tsStatusF = $('tsStatusFilter')
    if (tsStatusF) tsStatusF.classList.toggle('hidden', !canSeeAll)

    // Build query URL
    const month     = $('tsMonthFilter')?.value
    const year      = $('tsYearFilter')?.value
    const projectId = $('tsProjectFilter')?.value
    const userId    = canSeeAll ? ($('tsUserFilter')?.value || '') : ''
    const status    = canSeeAll ? ($('tsStatusFilter')?.value || '') : ''

    let url = '/timesheets?'
    if (month)     url += `month=${month}&`
    if (year)      url += `year=${year}&`
    if (projectId) url += `project_id=${projectId}&`
    if (userId)    url += `user_id=${userId}&`
    if (status)    url += `status=${status}&`

    allTimesheets = await api(url)
    renderTimesheetTable(allTimesheets)

    // Cập nhật summary cards
    if (canSeeAll && allTimesheets.length) {
      const pending  = allTimesheets.filter(t => t.status === 'submitted').length
      const approved = allTimesheets.filter(t => t.status === 'approved').length
      const totalH   = allTimesheets.reduce((s, t) => s + (t.regular_hours||0) + (t.overtime_hours||0), 0)
      if ($('tsCardTotal'))    $('tsCardTotal').textContent   = allTimesheets.length
      if ($('tsCardPending'))  $('tsCardPending').textContent = pending
      if ($('tsCardApproved')) $('tsCardApproved').textContent = approved
      if ($('tsCardHours'))    $('tsCardHours').textContent   = totalH + 'h'

      // Show bulk approve button if there are pending timesheets
      const bulkBtn = $('tsBulkApproveBtn')
      if (bulkBtn) {
        if (pending > 0) {
          bulkBtn.classList.remove('hidden')
          bulkBtn.innerHTML = `<i class="fas fa-check-double mr-1"></i>Duyệt tất cả (${pending})`
        } else {
          bulkBtn.classList.add('hidden')
        }
      }
    } else {
      const bulkBtn = $('tsBulkApproveBtn')
      if (bulkBtn) bulkBtn.classList.add('hidden')
    }
  } catch (e) { toast('Lỗi tải timesheet: ' + e.message, 'error') }
}

function renderTimesheetTable(timesheets) {
  const tbody = $('timesheetTable')
  if (!tbody) return

  const isAdmin     = currentUser.role === 'system_admin'
  const isProjAdmin = currentUser.role === 'project_admin' || currentUser.role === 'project_leader'
  const canSeeAll   = isAdmin || isProjAdmin
  const canApprove  = isAdmin || isProjAdmin

  let totalReg = 0, totalOT = 0
  timesheets.forEach(t => { totalReg += t.regular_hours || 0; totalOT += t.overtime_hours || 0 })
  $('tsTotalRegular').textContent = totalReg + 'h'
  $('tsTotalOvertime').textContent = totalOT + 'h'
  $('tsTotalHours').textContent = (totalReg + totalOT) + 'h'

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
    if (id) await api(`/timesheets/${id}`, { method: 'put', data })
    else await api('/timesheets', { method: 'post', data })
    closeModal('timesheetModal')
    toast(id ? 'Cập nhật timesheet' : 'Thêm timesheet thành công')
    loadTimesheets()
  } catch (e) { toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error') }
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
      const barColor = t.status === 'completed' ? '#00A651' : overdue ? '#EF4444' : t.status === 'in_progress' ? '#0066CC' : '#9CA3AF'

      return `<div class="flex items-center gap-3 py-1.5 border-b border-gray-100 hover:bg-gray-50">
        <div class="w-56 flex-shrink-0 text-xs truncate">
          <span class="font-medium text-gray-800">${t.title}</span>
          <div class="text-gray-400">${t.discipline_code||''} • ${t.assigned_to_name||''}</div>
        </div>
        <div class="flex-1 relative h-7" style="min-width:200px">
          <div class="gantt-today" style="left:${todayPct}%"></div>
          <div class="gantt-bar absolute top-1 flex items-center" 
               style="left:${startPct}%;width:${widthPct}%;background:${barColor};opacity:${t.status==='completed'?1:0.8}"
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
  try {
    if (!allProjects.length) allProjects = await api('/projects')

    // Fill project filter
    const cpf = $('costProjectFilter')
    if (cpf) cpf.innerHTML = '<option value="">Tất cả dự án</option>' + allProjects.map(p => `<option value="${p.id}">${p.code}</option>`).join('')

    const year = $('costYearFilter')?.value || new Date().getFullYear().toString()
    const summary = await api(`/dashboard/cost-summary?year=${year}`)

    let totalRevenue = 0, totalCost = 0
    summary.revenue_by_project?.forEach(p => totalRevenue += p.total_revenue || 0)

    // Aggregate cost by project
    const costByProject = {}
    summary.cost_by_project?.forEach(item => {
      if (!costByProject[item.id]) costByProject[item.id] = { id: item.id, code: item.code, name: item.name, total_cost: 0 }
      costByProject[item.id].total_cost += item.total_cost || 0
    })
    Object.values(costByProject).forEach(p => totalCost += p.total_cost)
    const profit = totalRevenue - totalCost
    const margin = totalRevenue > 0 ? (profit / totalRevenue * 100).toFixed(1) : 0

    $('costKpiRevenue').textContent = fmtMoney(totalRevenue)
    $('costKpiCost').textContent = fmtMoney(totalCost)
    $('costKpiProfit').textContent = fmtMoney(profit)
    $('costKpiMargin').textContent = margin + '%'

    renderCostProjectChart(summary.revenue_by_project, Object.values(costByProject))
    renderCostMonthlyChart(summary.monthly_summary)

    loadCosts()
  } catch (e) { toast('Lỗi tải dữ liệu tài chính: ' + e.message, 'error') }
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

function renderCostMonthlyChart(data) {
  destroyChart('costMonthly')
  const ctx = $('costMonthlyChart')
  if (!ctx) return

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
  $('tabCosts').className = 'tab-btn ' + (tab === 'costs' ? 'active' : '')
  $('tabRevenues').className = 'tab-btn ' + (tab === 'revenues' ? 'active' : '')
  renderCostTable()
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
    cost_date: $('costDate').value,
    invoice_number: $('costInvoice').value,
    notes: $('costNotes').value
  }
  if (mode === 'cost') {
    data.cost_type = $('costType').value
    data.vendor = $('costVendor').value
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
  const sorted = [...allProductivityData].sort((a, b) => (b[key] || 0) - (a[key] || 0))
  renderProductivityPage(sorted)
}

function renderProductivityPage(data) {
  // Bar chart: scores
  destroyChart('prodBar')
  const ctx1 = $('prodBarChart')
  if (ctx1 && data.length) {
    const top = data.slice(0, 10)
    charts['prodBar'] = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: top.map(u => u.full_name?.split(' ').slice(-1)[0] || u.full_name),
        datasets: [
          { label: 'Năng suất (%)', data: top.map(u => u.productivity || 0), backgroundColor: '#00A651', borderRadius: 4 },
          { label: 'Chính xác (%)', data: top.map(u => u.ontime_rate || 0), backgroundColor: '#0066CC', borderRadius: 4 },
          { label: 'Điểm TB', data: top.map(u => u.score || 0), backgroundColor: '#8B5CF6', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
        scales: { y: { beginAtZero: true, max: 100 } }
      }
    })
  }

  // Pie chart: completed tasks distribution
  destroyChart('prodPie')
  const ctx2 = $('prodPieChart')
  if (ctx2 && data.length) {
    const topP = data.filter(u => u.completed_tasks > 0).slice(0, 8)
    const colors = ['#00A651','#0066CC','#FF6B00','#8B5CF6','#F59E0B','#EF4444','#10B981','#3B82F6']
    charts['prodPie'] = new Chart(ctx2, {
      type: 'pie',
      data: {
        labels: topP.map(u => u.full_name?.split(' ').slice(-1)[0]),
        datasets: [{ data: topP.map(u => u.completed_tasks), backgroundColor: colors }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } }
      }
    })
  }

  // Table
  const tbody = $('productivityTable')
  if (!tbody) return
  const getScoreColor = (s) => s >= 80 ? 'text-green-600' : s >= 60 ? 'text-yellow-600' : 'text-red-600'
  tbody.innerHTML = data.map((u, i) => `
    <tr class="table-row">
      <td class="py-2 pr-3">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">${(u.full_name||'?').split(' ').pop()?.charAt(0)}</div>
          <div>
            <div class="font-medium text-gray-800 text-sm">${u.full_name}</div>
          </div>
        </div>
      </td>
      <td class="py-2 pr-3 text-xs text-gray-500">${u.department || '-'}</td>
      <td class="py-2 pr-3 text-center font-medium">${u.total_tasks || 0}</td>
      <td class="py-2 pr-3 text-center font-medium text-green-600">${u.completed_tasks || 0}</td>
      <td class="py-2 pr-3 text-center">${Math.round(u.avg_progress || 0)}%</td>
      <td class="py-2 pr-3 text-center text-green-600">${u.ontime_tasks || 0}</td>
      <td class="py-2 pr-3 text-center text-red-500">${u.late_completed || 0}</td>
      <td class="py-2 pr-3 text-center">
        <div class="flex items-center gap-1 justify-center">
          <div class="progress-bar w-12"><div class="progress-fill" style="width:${u.productivity||0}%"></div></div>
          <span class="text-xs ${getScoreColor(u.productivity||0)}">${u.productivity||0}%</span>
        </div>
      </td>
      <td class="py-2 pr-3 text-center">
        <div class="flex items-center gap-1 justify-center">
          <div class="progress-bar w-12"><div class="progress-fill" style="width:${u.ontime_rate||0}%;background:#0066CC"></div></div>
          <span class="text-xs text-blue-600">${u.ontime_rate||0}%</span>
        </div>
      </td>
      <td class="py-2 text-center">
        <span class="badge font-bold text-sm px-3 ${u.score>=80?'badge-completed':u.score>=60?'badge-review':'badge-overdue'}">${u.score||0}</span>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="10" class="text-center py-8 text-gray-400">Không có dữ liệu</td></tr>'
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
  } catch(e) { console.error(e) }
}

async function loadFinanceProject() {
  const projectId = $('finProjSelect')?.value
  if (!projectId) return
  try {
    const data = await api(`/finance/project/${projectId}`)
    const el = $('financeProjectContent')
    if (!el) return
    const { project, summary, costs_by_type, timeline } = data

    // KPI cards
    el.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="kpi-card" style="border-color:#00A651">
          <p class="text-xs text-gray-500">DOANH THU (Giá trị HĐ)</p>
          <p class="text-lg font-bold text-green-600 mt-1">${fmtMoney(summary.total_revenue)}</p>
        </div>
        <div class="kpi-card" style="border-color:#EF4444">
          <p class="text-xs text-gray-500">TỔNG CHI PHÍ</p>
          <p class="text-lg font-bold text-red-600 mt-1">${fmtMoney(summary.total_cost)}</p>
        </div>
        <div class="kpi-card" style="border-color:${summary.profit>=0?'#8B5CF6':'#EF4444'}">
          <p class="text-xs text-gray-500">LỢI NHUẬN</p>
          <p class="text-lg font-bold ${summary.profit>=0?'text-purple-600':'text-red-600'} mt-1">${fmtMoney(summary.profit)}</p>
        </div>
        <div class="kpi-card" style="border-color:#F59E0B">
          <p class="text-xs text-gray-500">TỶ SUẤT LN</p>
          <p class="text-lg font-bold text-amber-600 mt-1">${summary.margin}%</p>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div class="card">
          <h3 class="font-bold text-sm mb-3"><i class="fas fa-chart-pie text-primary mr-2"></i>Chi phí theo loại</h3>
          <canvas id="finCostPie" height="260"></canvas>
        </div>
        <div class="card">
          <h3 class="font-bold text-sm mb-3"><i class="fas fa-chart-line text-accent mr-2"></i>Chi phí theo thời gian</h3>
          <canvas id="finTimeline" height="260"></canvas>
        </div>
      </div>
      <div class="card">
        <h3 class="font-bold text-sm mb-3"><i class="fas fa-table text-primary mr-2"></i>Chi tiết chi phí theo loại</h3>
        <table class="w-full text-sm">
          <thead><tr class="text-left text-gray-500 border-b text-xs uppercase">
            <th class="pb-2 pr-3">Loại chi phí</th>
            <th class="pb-2 pr-3 text-right">Số tiền</th>
            <th class="pb-2 text-right">% Tổng</th>
          </tr></thead>
          <tbody>
            ${costs_by_type.map(c => `
              <tr class="table-row border-b">
                <td class="py-2 pr-3">${getCostTypeName(c.cost_type)}</td>
                <td class="py-2 pr-3 text-right font-medium text-red-600">${fmt(c.total)} VNĐ</td>
                <td class="py-2 text-right text-gray-500">${summary.total_cost > 0 ? Math.round(c.total/summary.total_cost*100) : 0}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `

    // Render charts
    setTimeout(() => {
      destroyChart('finCostPie')
      const ctx1 = $('finCostPie')
      if (ctx1 && costs_by_type.length) {
        const colors = ['#00A651','#0066CC','#FF6B00','#8B5CF6','#F59E0B','#EF4444']
        charts['finCostPie'] = new Chart(ctx1, {
          type: 'doughnut',
          data: {
            labels: costs_by_type.map(c => getCostTypeName(c.cost_type)),
            datasets: [{ data: costs_by_type.map(c => c.total), backgroundColor: colors }]
          },
          options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } } }
        })
      }
      destroyChart('finTimeline')
      const ctx2 = $('finTimeline')
      if (ctx2 && timeline.length) {
        const months = [...new Set(timeline.map(t => t.month))].sort()
        charts['finTimeline'] = new Chart(ctx2, {
          type: 'bar',
          data: {
            labels: months,
            datasets: [{ label: 'Chi phí', data: months.map(m => timeline.filter(t=>t.month===m).reduce((s,t)=>s+t.total,0)), backgroundColor: '#EF4444', borderRadius: 4 }]
          },
          options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { callback: v => fmtMoney(v) } } } }
        })
      }
    }, 100)

  } catch(e) { toast('Lỗi tải tài chính dự án: ' + e.message, 'error') }
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
  // Init month filter
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

  try {
    const month = $('laborMonthFilter')?.value
    const year  = $('laborYearFilter')?.value
    let url = '/finance/labor-cost?'
    if (month) url += `month=${month}&`
    if (year)  url += `year=${year}`
    const data = await api(url)

    // KPI cards
    const laborUsed = data.manual_labor_cost ?? data.salary_pool
    if ($('laborKpiPool'))     $('laborKpiPool').textContent     = fmtMoney(laborUsed)
    if ($('laborKpiSource'))   $('laborKpiSource').textContent   = data.cost_source === 'manual' ? '✏️ Đã nhập thủ công' : '⚙️ Tự động từ bảng lương'
    if ($('laborKpiHours'))    $('laborKpiHours').textContent    = fmt(data.total_hours) + 'h'
    if ($('laborKpiRate'))     $('laborKpiRate').textContent     = fmtMoney(data.cost_per_hour) + '/h'
    if ($('laborKpiProjects')) $('laborKpiProjects').textContent = data.projects?.length || 0

    // Source badge
    const badge = $('laborCostSourceBadge')
    if (badge) {
      badge.innerHTML = data.cost_source === 'manual'
        ? `<span class="badge" style="background:#dcfce7;color:#166534;font-size:11px">✏️ Chi phí đã nhập tháng ${data.month_int}/${data.year_int}</span>`
        : `<span class="badge" style="background:#fef9c3;color:#713f12;font-size:11px">⚠️ Chưa nhập — đang dùng quỹ lương từ bảng lương</span>`
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
      fd.textContent = `${fmtMoney(laborUsed)} ÷ ${fmt(data.total_hours)}h = ${fmtMoney(data.cost_per_hour)}/h`
        + (data.cost_source === 'manual' ? ` (nguồn: nhập thủ công tháng ${data.month_int}/${data.year_int})` : ' (nguồn: tổng lương nhân sự)')
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

