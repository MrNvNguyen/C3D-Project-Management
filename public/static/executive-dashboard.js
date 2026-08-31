// ===================================================
// EXECUTIVE PMO DASHBOARD v3 - JavaScript
// OneCad BIM - Dành cho Lãnh Đạo
// Layout: Danh sách trái + Detail panel phải (tabs)
// Không có duplicate content
// ===================================================

// ─── Global state ───────────────────────────────
let execState = {
  projects: [],
  filter: 'all',
  search: '',
  currentProjectId: null,
  currentOverview: null,
  loading: false,
  detailLoading: false,
  activeTab: 'overview',
  legalDetail: null,       // full legal tree from /api/legal/:id/overview
  legalDetailLoading: false,
  legalCollapsed: {},      // { packageId_stageId: true/false }
  legalSubTab: 'items',   // 'items' | 'letters' | 'minutes'
}

// ─── Formatters ─────────────────────────────────
function exec_fmtMoney(val) {
  if (!val || val === 0) return '0 đ'
  const n = parseFloat(val)
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + ' Tỷ'
  if (n >= 1e6) return Math.round(n / 1e6).toLocaleString('vi') + ' Tr'
  return n.toLocaleString('vi') + ' đ'
}
function exec_fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) }
  catch { return d }
}
function exec_daysLeft(d) {
  if (!d) return null
  return Math.ceil((new Date(d) - new Date()) / 86400000)
}
function exec_fmtDaysLeft(d) {
  const n = exec_daysLeft(d)
  if (n === null) return ''
  if (n < 0)  return `<span class="text-red-500 font-bold text-xs">Trễ ${Math.abs(n)}d</span>`
  if (n === 0) return `<span class="text-red-500 font-bold text-xs">Hôm nay!</span>`
  if (n <= 7)  return `<span class="text-red-400 font-semibold text-xs">Còn ${n}d</span>`
  if (n <= 30) return `<span class="text-orange-400 font-semibold text-xs">Còn ${n}d</span>`
  return `<span class="text-gray-400 text-xs">Còn ${n}d</span>`
}

// ─── Badges ─────────────────────────────────────
function exec_healthDot(score) {
  if (!score && score !== 0) return '⚪'
  if (score >= 75) return '🟢'
  if (score >= 50) return '🟡'
  if (score >= 30) return '🟠'
  return '🔴'
}
function exec_riskBadge(risk) {
  const map = {
    low:      { label: 'Thấp',   cls: 'bg-green-100 text-green-700' },
    medium:   { label: 'TB',     cls: 'bg-yellow-100 text-yellow-700' },
    high:     { label: 'Cao',    cls: 'bg-orange-100 text-orange-700' },
    critical: { label: 'Khẩn',  cls: 'bg-red-100 text-red-700' },
  }
  const m = map[risk] || map.medium
  return `<span class="text-xs font-bold px-2 py-0.5 rounded-full ${m.cls}">⚠ ${m.label}</span>`
}
function exec_statusBadge(status) {
  const map = {
    active:    { label: 'Đang triển khai', cls: 'bg-blue-100 text-blue-700' },
    planning:  { label: 'Lập kế hoạch',   cls: 'bg-purple-100 text-purple-700' },
    on_hold:   { label: 'Tạm dừng',       cls: 'bg-gray-100 text-gray-600' },
    completed: { label: 'Hoàn thành',     cls: 'bg-green-100 text-green-700' },
    cancelled: { label: 'Huỷ',            cls: 'bg-red-100 text-red-600' },
  }
  const m = map[status] || { label: status, cls: 'bg-gray-100 text-gray-600' }
  return `<span class="text-xs font-semibold px-2 py-0.5 rounded-full ${m.cls}">${m.label}</span>`
}
function exec_legalStatusBadge(status) {
  const map = {
    completed: { label: '✓', cls: 'text-green-600' },
    approved:  { label: '✓', cls: 'text-green-600' },
    in_progress: { label: '⟳', cls: 'text-yellow-600' },
    pending:   { label: '○', cls: 'text-gray-400' },
  }
  const m = map[status] || { label: '○', cls: 'text-gray-300' }
  return `<span class="font-bold ${m.cls}">${m.label}</span>`
}
function exec_paymentStatusBadge(status) {
  const map = {
    paid:       { label: 'Đã thu',   cls: 'bg-green-100 text-green-700' },
    partial:    { label: 'Một phần', cls: 'bg-yellow-100 text-yellow-700' },
    processing: { label: 'Đang xử lý', cls: 'bg-blue-100 text-blue-700' },
    pending:    { label: 'Chờ',      cls: 'bg-gray-100 text-gray-600' },
    rejected:   { label: 'Từ chối', cls: 'bg-red-100 text-red-600' },
  }
  const m = map[status] || map.pending
  return `<span class="text-xs font-semibold px-2 py-0.5 rounded-full ${m.cls}">${m.label}</span>`
}
function exec_directiveBadge(status) {
  const map = {
    open:        { label: '⬤ Mới',          cls: 'bg-red-100 text-red-700' },
    in_progress: { label: '⟳ Đang thực hiện', cls: 'bg-yellow-100 text-yellow-700' },
    done:        { label: '✓ Xong',          cls: 'bg-green-100 text-green-700' },
  }
  const m = map[status] || map.open
  return `<span class="text-xs px-2 py-0.5 rounded-full font-medium ${m.cls}">${m.label}</span>`
}
function exec_priorityBadge(p) {
  const map = {
    urgent: 'bg-red-600 text-white',
    high:   'bg-orange-100 text-orange-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low:    'bg-gray-100 text-gray-500',
  }
  const labels = { urgent:'Khẩn', high:'Cao', medium:'TB', low:'Thấp' }
  return `<span class="text-xs px-1.5 py-0.5 rounded font-bold ${map[p]||map.medium}">${labels[p]||p}</span>`
}

// ─── API ──────────────────────────────────────────
async function execFetch(url, opts = {}, _retry = 0) {
  const token = localStorage.getItem('bim_token')
  let res
  try {
    res = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) }
    })
  } catch (networkErr) {
    // Network error (server down) — retry 1 lần sau 2s
    if (_retry < 1) {
      await new Promise(r => setTimeout(r, 2000))
      return execFetch(url, opts, _retry + 1)
    }
    throw new Error('Không kết nối được server. Vui lòng thử lại.')
  }
  // 502/503 — server đang khởi động lại, retry sau 3s
  if ((res.status === 502 || res.status === 503) && _retry < 2) {
    await new Promise(r => setTimeout(r, 3000))
    return execFetch(url, opts, _retry + 1)
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(errText || `HTTP ${res.status}`)
  }
  return res.json()
}

// ─── Load dữ liệu ────────────────────────────────
async function exec_loadProjects() {
  execState.loading = true
  exec_renderLeftPanel()
  try {
    const q = new URLSearchParams({ status: execState.filter, search: execState.search })
    execState.projects = await execFetch('/api/executive/projects?' + q)
  } catch (e) { console.error('exec_loadProjects:', e) }
  execState.loading = false
  exec_renderLeftPanel()

  if (execState.currentProjectId) {
    const still = execState.projects.find(p => p.id === execState.currentProjectId)
    if (still) exec_highlightProject(execState.currentProjectId)
    else { execState.currentProjectId = null; execState.currentOverview = null; exec_renderRightPanel() }
  } else if (execState.projects.length > 0) {
    exec_selectProject(execState.projects[0].id)
  }
}

async function exec_loadOverview(projectId) {
  execState.detailLoading = true
  exec_renderRightPanel()
  try {
    execState.currentOverview = await execFetch(`/api/executive/project-overview/${projectId}`)
  } catch (e) {
    console.error('exec_loadOverview:', e)
    execState.currentOverview = null
  }
  execState.detailLoading = false
  exec_renderRightPanel()
}

function exec_selectProject(projectId) {
  execState.currentProjectId = projectId
  execState.activeTab = 'overview'
  execState.legalDetail = null         // reset khi chuyển project
  execState.legalDetailLoading = false
  execState.legalSubTab = 'items'      // reset về tab đầu
  exec_highlightProject(projectId)
  exec_loadOverview(projectId)
}

function exec_highlightProject(projectId) {
  document.querySelectorAll('.exec-proj-item').forEach(el => {
    const active = parseInt(el.dataset.id) === projectId
    el.classList.toggle('ring-2', active)
    el.classList.toggle('ring-[#00A651]', active)
    el.classList.toggle('bg-green-50', active)
  })
}

// ─── Main Layout ─────────────────────────────────
function exec_renderLayout() {
  const el = document.getElementById('exec-main-layout')
  if (!el) return
  el.innerHTML = `
  <div class="exec-layout-row" style="display:flex;gap:12px;align-items:flex-start">
    <!-- CỘT TRÁI: danh sách dự án (cố định 280px desktop) -->
    <div class="exec-left-col" style="flex-shrink:0;width:280px">
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 mb-3">
        <input id="exec-search" type="text" placeholder="🔍 Tìm dự án..."
          value="${execState.search}" oninput="execOnSearch(this.value)"
          class="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-[#00A651]/30">
        <div class="flex gap-1 flex-wrap">
          ${['all','active','planning','on_hold','completed'].map(f => `
            <button onclick="execSetFilter('${f}')"
              class="text-xs px-2 py-1 rounded-lg font-medium transition-colors ${execState.filter===f?'bg-[#00A651] text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'}">
              ${f==='all'?'Tất cả':f==='active'?'Đang làm':f==='planning'?'Chờ ký':f==='on_hold'?'Tạm dừng':'HT'}
            </button>`).join('')}
        </div>
      </div>
      <div id="exec-left-list" class="space-y-2" style="max-height:calc(100vh - 240px);overflow-y:auto"></div>
    </div>

    <!-- CỘT PHẢI: detail panel -->
    <div class="exec-right-col" style="flex:1;min-width:0">
      <div id="exec-right-panel"></div>
    </div>
  </div>`
  exec_renderLeftPanel()
  exec_renderRightPanel()
}

// ─── LEFT PANEL: Danh sách dự án ─────────────────
function exec_renderLeftPanel() {
  const el = document.getElementById('exec-left-list')
  if (!el) return
  if (execState.loading) {
    el.innerHTML = `<div class="text-center py-8 text-gray-400 text-sm">Đang tải...</div>`
    return
  }
  if (!execState.projects.length) {
    el.innerHTML = `<div class="text-center py-8 text-gray-400 text-sm">Không có dự án</div>`
    return
  }
  const borderMap = { low:'border-l-green-400', medium:'border-l-yellow-400', high:'border-l-orange-400', critical:'border-l-red-500' }
  el.innerHTML = execState.projects.map(p => {
    const isActive = p.id === execState.currentProjectId
    const bc = borderMap[p.risk_level] || 'border-l-gray-200'
    return `
    <div class="exec-proj-item bg-white rounded-xl border border-gray-100 border-l-4 ${bc} p-3 cursor-pointer hover:shadow-md transition-all ${isActive?'ring-2 ring-[#00A651] bg-green-50':''}"
         data-id="${p.id}" onclick="exec_selectProject(${p.id})">
      <div class="flex items-start justify-between gap-1 mb-1">
        <div class="flex-1 min-w-0">
          <p class="text-xs text-gray-400 font-mono leading-none mb-0.5">${p.code||''}</p>
          <p class="text-sm font-bold text-gray-800 leading-snug line-clamp-2">${p.name}</p>
        </div>
        ${p.health_score!=null?`<span class="text-base flex-shrink-0">${exec_healthDot(p.health_score)}</span>`:''}
      </div>
      <p class="text-xs text-gray-500 truncate mb-2">${p.client||'—'}</p>
      <div class="flex items-center justify-between gap-1">
        ${exec_statusBadge(p.status)}
        ${exec_fmtDaysLeft(p.end_date)}
      </div>
    </div>`
  }).join('')
}

// ─── RIGHT PANEL: Detail theo tab ────────────────
function exec_renderRightPanel() {
  const el = document.getElementById('exec-right-panel')
  if (!el) return

  // Không có project được chọn
  if (!execState.currentProjectId) {
    el.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center" style="min-height:400px">
      <div class="text-center text-gray-400">
        <i class="fas fa-mouse-pointer text-4xl mb-3 block opacity-30"></i>
        <p class="font-medium">Chọn dự án để xem chi tiết</p>
      </div>
    </div>`
    return
  }

  // Đang tải
  if (execState.detailLoading) {
    el.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center" style="min-height:400px">
      <div class="text-center">
        <i class="fas fa-spinner fa-spin text-3xl text-[#00A651] mb-3 block"></i>
        <p class="text-sm text-gray-400">Đang tải dữ liệu...</p>
      </div>
    </div>`
    return
  }

  if (!execState.currentOverview) {
    el.innerHTML = `<div class="bg-white rounded-2xl p-8 text-center text-red-500"><i class="fas fa-exclamation-triangle mr-2"></i>Lỗi tải dữ liệu</div>`
    return
  }

  const ov = execState.currentOverview
  const p  = ov.project

  // Đếm directives chưa xong
  const openDirectives = (ov.directives||[]).filter(d => d.status !== 'done').length

  el.innerHTML = `
  <div class="space-y-3">

    <!-- ── HEADER DỰ ÁN ── -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <span class="text-xs text-gray-400 font-mono bg-gray-100 px-2 py-0.5 rounded">${p.code||''}</span>
            ${exec_statusBadge(p.status)}
            ${p.risk_level && p.risk_level !== 'low' ? exec_riskBadge(p.risk_level) : ''}
          </div>
          <h2 class="text-lg font-bold text-gray-800 leading-snug">${p.name}</h2>
          <p class="text-xs text-gray-500 mt-0.5">${p.client||'—'} · ${exec_fmtDate(p.start_date)} → ${exec_fmtDate(p.end_date)}</p>
        </div>
        <div class="flex gap-2 flex-shrink-0">
          <button onclick="exec_openHealthEdit(${p.id})"
            class="text-xs bg-[#00A651] hover:bg-[#007a3d] text-white px-3 py-2 rounded-xl font-medium transition-colors">
            <i class="fas fa-edit mr-1"></i>Cập nhật
          </button>
          <button onclick="exec_openDirectiveModal(${p.id}, '${(p.name||'').replace(/'/g,'&#39;')}')"
            class="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-xl font-medium transition-colors">
            <i class="fas fa-bullhorn mr-1"></i>Chỉ đạo
          </button>
        </div>
      </div>

      <!-- Hàng 1: 4 KPI hợp đồng / thanh toán -->
      <div class="grid grid-cols-4 gap-2 mt-3">
        <div class="bg-blue-50 rounded-xl p-2 text-center">
          <p class="text-xs text-gray-500">Giá trị HĐ</p>
          <p class="text-sm font-bold text-blue-700 truncate">${exec_fmtMoney(ov.finance.contract_value)}</p>
        </div>
        <div class="bg-yellow-50 rounded-xl p-2 text-center">
          <p class="text-xs text-gray-500">Giá trị nghiệm thu</p>
          <p class="text-sm font-bold text-yellow-700 truncate">${exec_fmtMoney(ov.finance.total_invoiced)}</p>
          <p class="text-xs text-yellow-600">${ov.finance.invoiced_pct}%</p>
        </div>
        <div class="bg-green-50 rounded-xl p-2 text-center">
          <p class="text-xs text-gray-500">Giá trị thanh toán</p>
          <p class="text-sm font-bold text-green-700 truncate">${exec_fmtMoney(ov.finance.total_paid)}</p>
          <p class="text-xs text-green-600">${ov.finance.collected_pct}%</p>
        </div>
        <div class="bg-red-50 rounded-xl p-2 text-center">
          <p class="text-xs text-gray-500">Công nợ</p>
          <p class="text-sm font-bold text-red-600 truncate">${exec_fmtMoney(ov.finance.debt_amount)}</p>
        </div>
      </div>
      <!-- Hàng 2: 4 KPI ngân sách / doanh thu / chi phí -->
      ${(() => {
        const f = ov.finance
        const budgetOk   = f.budget > 0
        const budgetDebt = f.budget_debt ?? (f.budget - (f.total_revenue || 0))
        const budgetDebtPct = budgetOk ? Math.round(budgetDebt / f.budget * 100) : 0
        const budgetPositive = budgetDebt >= 0
        return `
        <div class="grid grid-cols-4 gap-2 mt-2">
          <div class="bg-indigo-50 rounded-xl p-2 text-center border border-indigo-100">
            <p class="text-xs text-gray-500 flex items-center justify-center gap-1">
              <i class="fas fa-wallet text-indigo-400"></i> Ngân sách
            </p>
            <p class="text-sm font-bold text-indigo-700 truncate">${exec_fmtMoney(f.budget || 0)}</p>
            ${budgetOk ? `<p class="text-xs text-indigo-400">Kế hoạch</p>` : `<p class="text-xs text-gray-400 italic">Chưa cập nhật</p>`}
          </div>
          <div class="bg-teal-50 rounded-xl p-2 text-center border border-teal-100">
            <p class="text-xs text-gray-500 flex items-center justify-center gap-1">
              <i class="fas fa-arrow-trend-up text-teal-500"></i> Doanh thu
            </p>
            <p class="text-sm font-bold text-teal-700 truncate">${exec_fmtMoney(f.total_revenue || 0)}</p>
            ${budgetOk && (f.total_revenue||0)>0 ? `<p class="text-xs text-teal-600">${f.revenue_pct||0}% ngân sách</p>` : `<p class="text-xs text-gray-400">—</p>`}
          </div>
          <div class="bg-orange-50 rounded-xl p-2 text-center border border-orange-100">
            <p class="text-xs text-gray-500 flex items-center justify-center gap-1">
              <i class="fas fa-receipt text-orange-400"></i> Chi phí
            </p>
            <p class="text-sm font-bold text-orange-700 truncate">${exec_fmtMoney(f.total_cost || 0)}</p>
            ${budgetOk && (f.total_cost||0)>0 ? `<p class="text-xs text-orange-600">${f.cost_pct||0}% ngân sách</p>` : `<p class="text-xs text-gray-400">—</p>`}
          </div>
          <div class="${budgetPositive ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'} rounded-xl p-2 text-center border">
            <p class="text-xs text-gray-500 flex items-center justify-center gap-1">
              <i class="fas fa-scale-balanced ${budgetPositive ? 'text-emerald-500' : 'text-rose-500'}"></i> Công nợ NS
            </p>
            <p class="text-sm font-bold ${budgetPositive ? 'text-emerald-700' : 'text-rose-600'} truncate">
              ${budgetPositive ? '' : '−'}${exec_fmtMoney(Math.abs(budgetDebt))}
            </p>
            ${budgetOk ? `<p class="text-xs ${budgetPositive ? 'text-emerald-500' : 'text-rose-500'}">${budgetPositive ? 'Còn lại' : 'Vượt'} ${Math.abs(budgetDebtPct)}%</p>` : `<p class="text-xs text-gray-400">—</p>`}
          </div>
        </div>`
      })()}
      <!-- Progress thanh toán -->
      <div class="mt-2">
        <div class="flex justify-between text-xs text-gray-400 mb-1">
          <span>Tiến độ thu tiền</span>
          <span>${ov.finance.collected_pct}% / 100%</span>
        </div>
        <div class="w-full bg-gray-100 rounded-full h-2">
          <div class="bg-green-500 h-2 rounded-full transition-all" style="width:${Math.min(ov.finance.collected_pct,100)}%"></div>
        </div>
      </div>
    </div>

    <!-- ── TAB BAR + CONTENT ── -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <!-- Tab navigation -->
      <div class="flex border-b border-gray-100">
        ${[
          { id:'overview',   icon:'fa-th-large',      label:'Tổng quan' },
          { id:'legal',      icon:'fa-folder-open',   label:'Hồ sơ pháp lý' },
          { id:'finance',    icon:'fa-coins',         label:'Tài chính' },
          { id:'directives', icon:'fa-bullhorn',      label:`Chỉ đạo${openDirectives>0?` <span class="ml-1 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">${openDirectives}</span>`:''}` },
        ].map(tab => `
          <button onclick="exec_switchTab('${tab.id}')" id="exec-tab-btn-${tab.id}"
            class="flex-1 flex items-center justify-center gap-1.5 px-2 py-3 text-xs font-semibold transition-colors border-b-2
              ${execState.activeTab === tab.id
                ? 'border-[#00A651] text-[#00A651] bg-green-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}">
            <i class="fas ${tab.icon}"></i>
            <span>${tab.label}</span>
          </button>`).join('')}
      </div>
      <!-- Tab content -->
      <div id="exec-tab-body" class="p-4">
        ${exec_renderTabContent(ov)}
      </div>
    </div>

  </div>`
}

// ─── Tab router ──────────────────────────────────
function exec_renderTabContent(ov) {
  switch (execState.activeTab) {
    case 'overview':   return exec_tab_overview(ov)
    case 'legal':      return exec_tab_legal(ov)
    case 'finance':    return exec_tab_finance(ov)
    case 'directives': return exec_tab_directives(ov)
    default:           return exec_tab_overview(ov)
  }
}

function exec_switchTab(tabId) {
  // Reset legalDetail when switching away from legal tab
  if (tabId !== 'legal') {
    execState.legalDetail = null
    execState.legalDetailLoading = false
  }
  execState.activeTab = tabId
  // Cập nhật style tab buttons
  ;['overview','legal','finance','directives'].forEach(id => {
    const btn = document.getElementById(`exec-tab-btn-${id}`)
    if (!btn) return
    if (id === tabId) {
      btn.className = btn.className.replace('border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50','')
      btn.classList.add('border-[#00A651]','text-[#00A651]','bg-green-50')
      btn.classList.remove('border-transparent','text-gray-500','hover:text-gray-700','hover:bg-gray-50')
    } else {
      btn.classList.remove('border-[#00A651]','text-[#00A651]','bg-green-50')
      btn.classList.add('border-transparent','text-gray-500','hover:text-gray-700','hover:bg-gray-50')
    }
  })
  // Cập nhật content
  const body = document.getElementById('exec-tab-body')
  if (body && execState.currentOverview) {
    body.innerHTML = exec_renderTabContent(execState.currentOverview)
    // If switching to legal tab, trigger async load
    if (tabId === 'legal' && execState.currentProjectId) {
      exec_loadLegalDetail(execState.currentProjectId)
    }
  }
}

// ═══════════════════════════════════════════════════
// TAB 1: TỔNG QUAN
// Nội dung: Tasks | Vướng mắc | Đầu mối | Hồ sơ summary | Văn bản gần đây
// ═══════════════════════════════════════════════════
function exec_tab_overview(ov) {
  const p = ov.project
  const t = ov.tasks || {}

  return `<div class="space-y-4">

    <!-- Row 1: Tasks + Vướng mắc -->
    <div class="grid grid-cols-2 gap-3">

      <!-- Tasks -->
      <div class="bg-gray-50 rounded-xl p-3">
        <p class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">
          <i class="fas fa-tasks mr-1 text-blue-400"></i> Tiến độ công việc
        </p>
        <div class="grid grid-cols-4 gap-1 text-center mb-2">
          <div class="bg-white rounded-lg p-2">
            <p class="text-xl font-bold text-gray-700">${t.total||0}</p>
            <p class="text-xs text-gray-400">Tổng</p>
          </div>
          <div class="bg-blue-50 rounded-lg p-2">
            <p class="text-xl font-bold text-blue-600">${t.in_progress||0}</p>
            <p class="text-xs text-gray-400">Đang làm</p>
          </div>
          <div class="bg-green-50 rounded-lg p-2">
            <p class="text-xl font-bold text-green-600">${t.done||0}</p>
            <p class="text-xs text-gray-400">Xong</p>
          </div>
          <div class="bg-red-50 rounded-lg p-2">
            <p class="text-xl font-bold text-red-600">${t.overdue||0}</p>
            <p class="text-xs text-gray-400">Trễ</p>
          </div>
        </div>
        ${p.current_phase ? `<div class="text-xs text-blue-700 bg-blue-50 rounded-lg px-2 py-1.5 font-medium">📍 ${p.current_phase}</div>` : ''}
        ${p.next_milestone ? `
        <div class="mt-1.5 bg-white border border-blue-100 rounded-lg px-2 py-1.5">
          <p class="text-xs text-gray-400">Mốc kế tiếp · ${exec_fmtDate(p.next_milestone_date)}</p>
          <p class="text-xs font-semibold text-blue-700">${p.next_milestone}</p>
        </div>` : ''}
        ${p.health_score != null ? `
        <div class="mt-1.5 flex items-center gap-2">
          <span class="text-base">${exec_healthDot(p.health_score)}</span>
          <span class="text-xs text-gray-600">Sức khỏe DA: <strong>${p.health_score}/100</strong></span>
        </div>` : ''}
      </div>

      <!-- Vướng mắc -->
      <div class="bg-red-50 rounded-xl p-3 border border-red-100">
        <p class="text-xs font-bold text-red-500 uppercase tracking-wide mb-3">
          <i class="fas fa-exclamation-triangle mr-1"></i> Vướng mắc cần theo dõi
        </p>
        ${p.major_issues
          ? `<div class="text-xs text-red-800 leading-relaxed whitespace-pre-line">${p.major_issues}</div>`
          : `<p class="text-xs text-gray-400 italic">Không có vướng mắc lớn</p>`}
        ${p.pm_report ? `
        <div class="mt-2 pt-2 border-t border-red-200">
          <p class="text-xs font-semibold text-gray-500 mb-1">📝 BC Leader (${exec_fmtDate(p.pm_report_date)}):</p>
          <p class="text-xs text-gray-700 leading-relaxed">${p.pm_report}</p>
        </div>` : ''}
        ${p.risk_notes ? `
        <div class="mt-2 pt-2 border-t border-red-200">
          <p class="text-xs font-semibold text-orange-600">⚠ Rủi ro: ${p.risk_notes}</p>
        </div>` : ''}
      </div>
    </div>

    <!-- Row 2: Đầu mối liên hệ (4 parties) -->
    <div class="bg-white rounded-xl border border-gray-100 p-3">
      <p class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">
        <i class="fas fa-address-book mr-1 text-[#00A651]"></i> Đầu mối liên hệ
      </p>
      <div class="grid grid-cols-4 gap-2">
        ${exec_contactCard('TVTK', 'fa-pencil-ruler', 'blue',   p.tvtk_name, p.tvtk_contact, p.tvtk_phone)}
        ${exec_contactCard('CĐT',  'fa-building',     'purple', p.cdt_name||p.client, p.cdt_contact||p.client_contact_name, p.cdt_phone||p.client_contact_phone)}
        ${exec_contactCard('QLDA', 'fa-user-tie',     'orange', p.qlda_name, p.qlda_contact, p.qlda_phone)}
        ${exec_contactCard('Nhà thầu','fa-hard-hat',  'red',    p.nthau_name, p.nthau_contact, p.nthau_phone)}
      </div>
      ${(p.leader_name||p.pm_name) ? `
      <div class="mt-2 pt-2 border-t border-gray-100 flex gap-4 flex-wrap text-xs text-gray-600">
        ${p.leader_name ? `<span><span class="text-gray-400">Leader DA:</span> <strong>${p.leader_name}</strong>${p.leader_phone?` · <a href="tel:${p.leader_phone}" class="text-[#00A651]">${p.leader_phone}</a>`:''}</span>` : ''}
        ${p.admin_name  ? `<span><span class="text-gray-400">Phụ trách:</span> <strong>${p.admin_name}</strong></span>` : ''}
      </div>` : ''}
    </div>

    <!-- Row 3: Hồ sơ summary + Văn bản/Họp gần đây -->
    <div class="grid grid-cols-2 gap-3">

      <!-- Hồ sơ pháp lý tóm tắt -->
      <div class="bg-white rounded-xl border border-gray-100 p-3">
        <div class="flex items-center justify-between mb-2">
          <p class="text-xs font-bold text-gray-400 uppercase tracking-wide">
            <i class="fas fa-folder-open mr-1 text-yellow-500"></i> Hồ sơ pháp lý
          </p>
          <button onclick="exec_switchTab('legal')" class="text-xs text-[#00A651] hover:underline">Xem →</button>
        </div>
        <div class="flex items-center gap-3 mb-2">
          <div class="text-center flex-shrink-0">
            <p class="text-2xl font-bold text-gray-700">${ov.legal.done_items}</p>
            <p class="text-xs text-gray-400">/ ${ov.legal.total_items}</p>
          </div>
          <div class="flex-1">
            <div class="w-full bg-gray-100 rounded-full h-2.5 mb-1">
              <div class="bg-[#00A651] h-2.5 rounded-full" style="width:${ov.legal.total_items>0?Math.round(ov.legal.done_items/ov.legal.total_items*100):0}%"></div>
            </div>
            <p class="text-xs text-gray-500">${ov.legal.total_items>0?Math.round(ov.legal.done_items/ov.legal.total_items*100):0}% xong · ${ov.legal.pending_items} chưa làm</p>
          </div>
        </div>
        ${ov.legal.packages.slice(0,4).map(pkg => `
        <div class="flex items-center gap-2 mb-1">
          <p class="text-xs text-gray-600 flex-1 truncate">${pkg.name}</p>
          <div class="w-16 bg-gray-100 rounded-full h-1.5 flex-shrink-0">
            <div class="${pkg.pct>=80?'bg-green-500':pkg.pct>=50?'bg-yellow-400':'bg-red-400'} h-1.5 rounded-full" style="width:${pkg.pct}%"></div>
          </div>
          <span class="text-xs text-gray-500 w-7 text-right">${pkg.pct}%</span>
        </div>`).join('')}
      </div>

      <!-- Văn bản & Họp gần đây -->
      <div class="bg-white rounded-xl border border-gray-100 p-3">
        <div class="flex items-center justify-between mb-2">
          <p class="text-xs font-bold text-gray-400 uppercase tracking-wide">
            <i class="fas fa-envelope-open-text mr-1 text-indigo-400"></i> Văn bản & Họp gần đây
          </p>
          <button onclick="exec_switchTab('legal')" class="text-xs text-[#00A651] hover:underline">Xem →</button>
        </div>
        ${ov.letters.length===0 && ov.minutes.length===0
          ? `<p class="text-xs text-gray-400 italic">Chưa có văn bản / biên bản họp</p>`
          : `<div class="space-y-2">
            ${ov.letters.slice(0,3).map(l=>`
            <div class="flex gap-2 text-xs border-l-2 border-indigo-200 pl-2">
              <div class="min-w-0">
                <p class="font-medium text-gray-700 truncate">${l.subject||l.letter_number}</p>
                <p class="text-gray-400">${exec_fmtDate(l.sent_date)} · ${l.recipient||'—'}</p>
              </div>
            </div>`).join('')}
            ${ov.minutes.slice(0,2).map(m=>`
            <div class="flex gap-2 text-xs border-l-2 border-green-200 pl-2">
              <div class="min-w-0">
                <p class="font-medium text-gray-700 truncate"><i class="fas fa-users text-green-400 mr-1"></i>${m.title||'Biên bản họp'}</p>
                <p class="text-gray-400">${exec_fmtDate(m.meeting_date)}${m.location?` · ${m.location}`:''}</p>
              </div>
            </div>`).join('')}
          </div>`}
      </div>
    </div>

    <!-- Row 4: Chỉ đạo mới nhất (preview) -->
    ${(ov.directives||[]).filter(d=>d.status!=='done').length > 0 ? `
    <div class="bg-white rounded-xl border border-gray-100 p-3">
      <div class="flex items-center justify-between mb-2">
        <p class="text-xs font-bold text-gray-400 uppercase tracking-wide">
          <i class="fas fa-bullhorn mr-1 text-blue-500"></i> Chỉ đạo đang mở
          <span class="ml-1 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">${(ov.directives||[]).filter(d=>d.status!=='done').length}</span>
        </p>
        <button onclick="exec_switchTab('directives')" class="text-xs text-[#00A651] hover:underline">Xem tất cả →</button>
      </div>
      <div class="space-y-2">
        ${(ov.directives||[]).filter(d=>d.status!=='done').slice(0,3).map(d=>`
        <div class="flex gap-2 items-start bg-gray-50 rounded-lg px-2 py-1.5">
          ${exec_priorityBadge(d.priority)}
          <p class="text-xs text-gray-700 flex-1 leading-relaxed">${d.content}</p>
          ${d.due_date?`<span class="text-xs ${new Date(d.due_date)<new Date()?'text-red-500 font-bold':'text-gray-400'} flex-shrink-0">${exec_fmtDate(d.due_date)}</span>`:''}
        </div>`).join('')}
      </div>
    </div>` : ''}

  </div>`
}

// ─── Contact Card helper ──────────────────────────
function exec_contactCard(role, icon, color, org, contact, phone) {
  const colors = {
    blue:   { bg:'bg-blue-50',   lbl:'text-blue-700'   },
    purple: { bg:'bg-purple-50', lbl:'text-purple-700' },
    orange: { bg:'bg-orange-50', lbl:'text-orange-700' },
    red:    { bg:'bg-red-50',    lbl:'text-red-700'    },
  }[color] || { bg:'bg-gray-50', lbl:'text-gray-700' }

  return `
  <div class="${colors.bg} rounded-xl p-2.5">
    <p class="text-xs font-bold ${colors.lbl} mb-1.5"><i class="fas ${icon} mr-1"></i>${role}</p>
    ${org ? `<p class="text-xs font-semibold text-gray-800 leading-tight mb-1">${org}</p>`
           : `<p class="text-xs text-gray-400 italic mb-1">Chưa cập nhật</p>`}
    ${contact ? `<p class="text-xs text-gray-600 truncate">👤 ${contact}</p>` : ''}
    ${phone   ? `<a href="tel:${phone}" class="text-xs font-mono text-[#00A651] hover:underline">📞 ${phone}</a>` : ''}
  </div>`
}

// ═══════════════════════════════════════════════════
// TAB 2: HỒ SƠ PHÁP LÝ
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
// TAB 2: HỒ SƠ PHÁP LÝ — Excel-style inline editing
// ═══════════════════════════════════════════════════

// Load full legal detail from dedicated API
async function exec_loadLegalDetail(projectId) {
  execState.legalDetailLoading = true
  const body = document.getElementById('exec-tab-body')
  if (body) body.innerHTML = exec_tab_legal_loading()
  try {
    const data = await execFetch(`/api/legal/${projectId}/overview`)
    execState.legalDetail = data
  } catch (e) {
    console.error('exec_loadLegalDetail:', e)
    execState.legalDetail = null
  }
  execState.legalDetailLoading = false
  // Re-render the legal tab body with loaded data
  const bodyEl = document.getElementById('exec-tab-body')
  if (bodyEl && execState.activeTab === 'legal') {
    bodyEl.innerHTML = execState.legalDetail
      ? exec_renderLegalDetail(execState.legalDetail)
      : `<p class="text-center text-gray-400 py-8 text-sm">Không thể tải dữ liệu hồ sơ pháp lý.</p>`
  }
}

function exec_tab_legal_loading() {
  return `<div class="flex items-center justify-center py-12 text-gray-400">
    <i class="fas fa-spinner fa-spin mr-2"></i>
    <span class="text-sm">Đang tải hồ sơ pháp lý...</span>
  </div>`
}

function exec_tab_legal(ov) {
  // If detail already loaded, render it directly
  if (execState.legalDetail) {
    return exec_renderLegalDetail(execState.legalDetail)
  }
  // Otherwise show loading shell; exec_loadLegalDetail will be called by exec_switchTab
  return exec_tab_legal_loading()
}

// ─── KPI summary bar ─────────────────────────────
function exec_legal_kpi(packages) {
  let total = 0, done = 0, inprog = 0
  packages.forEach(pkg => {
    pkg.stages.forEach(st => {
      st.items.forEach(item => {
        total++
        if (item.status === 'completed') done++
        else if (item.status === 'in_progress') inprog++
        ;(item.children||[]).forEach(ch => {
          total++
          if (ch.status === 'completed') done++
          else if (ch.status === 'in_progress') inprog++
        })
      })
    })
  })
  const pending = total - done - inprog
  const pct = total > 0 ? Math.round(done / total * 100) : 0
  return `<div class="flex items-center gap-3 mb-4 flex-wrap">
    <div class="flex items-center gap-2 bg-green-50 rounded-lg px-3 py-1.5">
      <i class="fas fa-check-circle text-green-500 text-xs"></i>
      <span class="text-xs font-bold text-green-700">${done} Hoàn thành</span>
    </div>
    <div class="flex items-center gap-2 bg-yellow-50 rounded-lg px-3 py-1.5">
      <i class="fas fa-spinner text-yellow-500 text-xs"></i>
      <span class="text-xs font-bold text-yellow-700">${inprog} Đang thực hiện</span>
    </div>
    <div class="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5">
      <i class="fas fa-circle text-gray-300 text-xs"></i>
      <span class="text-xs font-bold text-gray-500">${pending} Chưa thực hiện</span>
    </div>
    <div class="ml-auto flex items-center gap-2">
      <div class="w-24 bg-gray-200 rounded-full h-2">
        <div class="h-2 rounded-full ${pct>=80?'bg-green-500':pct>=50?'bg-yellow-400':'bg-red-400'}" style="width:${pct}%"></div>
      </div>
      <span class="text-sm font-bold ${pct>=80?'text-green-600':pct>=50?'text-yellow-600':'text-red-600'}">${pct}%</span>
    </div>
  </div>`
}

// ─── Excel-style item row ─────────────────────────
function exec_legal_row(item, stageId, isChild) {
  const isDone = item.status === 'completed'
  const isInprog = item.status === 'in_progress'
  const cbCls = isDone
    ? 'w-4 h-4 rounded cursor-pointer accent-green-600'
    : 'w-4 h-4 rounded cursor-pointer accent-green-600'
  const rowCls = isDone
    ? 'bg-green-50 opacity-80'
    : isInprog
    ? 'bg-yellow-50'
    : 'bg-white hover:bg-gray-50'
  const indentCls = isChild ? 'pl-6' : ''
  // Status badge small
  const statusBadge = isDone
    ? `<span class="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold whitespace-nowrap">✓ Xong</span>`
    : isInprog
    ? `<span class="text-xs px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-semibold whitespace-nowrap">⟳ Đang làm</span>`
    : `<span class="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold whitespace-nowrap">○ Chưa</span>`

  return `<tr class="border-b border-gray-100 ${rowCls} group transition-colors" data-item-id="${item.id}">
    <!-- Checkbox toggle hoàn thành -->
    <td class="px-2 py-1.5 w-8 text-center align-middle">
      <input type="checkbox"
        class="${cbCls}"
        ${isDone ? 'checked' : ''}
        onchange="exec_legalToggleStatus(${item.id}, this.checked)"
        title="${isDone ? 'Bỏ hoàn thành' : 'Đánh dấu hoàn thành'}"
      />
    </td>
    <!-- STT -->
    <td class="px-2 py-1.5 w-10 text-center align-middle">
      <span class="text-xs text-gray-400 font-mono ${isChild?'opacity-50':'font-semibold'}">${item.stt||''}</span>
    </td>
    <!-- Title inline edit -->
    <td class="px-2 py-1.5 align-middle ${indentCls}" style="min-width:180px">
      <span
        class="text-xs text-gray-800 block w-full focus:outline-none focus:ring-1 focus:ring-green-400 rounded px-1 py-0.5 ${isDone?'line-through text-gray-400':''} cursor-text"
        contenteditable="true"
        data-field="title"
        data-id="${item.id}"
        onblur="exec_legalSaveCell(${item.id},'title',this.innerText.trim())"
        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"
        title="Click để chỉnh sửa tên hồ sơ"
      >${exec_escapeHtml(item.title||'')}</span>
    </td>
    <!-- Due date inline edit -->
    <td class="px-2 py-1.5 w-28 align-middle">
      <input type="date"
        class="text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-green-400 rounded px-1 py-0.5 w-full cursor-pointer text-gray-600"
        value="${item.due_date||''}"
        onchange="exec_legalSaveCell(${item.id},'due_date',this.value)"
        title="Ngày hết hạn"
      />
    </td>
    <!-- Actual completion date -->
    <td class="px-2 py-1.5 w-28 align-middle">
      <input type="date"
        class="text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-green-400 rounded px-1 py-0.5 w-full cursor-pointer text-gray-600"
        value="${item.actual_completion_date||''}"
        onchange="exec_legalSaveCell(${item.id},'actual_completion_date',this.value)"
        title="Ngày hoàn thành thực tế"
      />
    </td>
    <!-- Notes inline edit -->
    <td class="px-2 py-1.5 align-middle" style="min-width:120px">
      <span
        class="text-xs text-gray-500 block w-full focus:outline-none focus:ring-1 focus:ring-green-400 rounded px-1 py-0.5 cursor-text italic"
        contenteditable="true"
        data-field="notes"
        data-id="${item.id}"
        onblur="exec_legalSaveCell(${item.id},'notes',this.innerText.trim())"
        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"
        title="Click để thêm ghi chú"
      >${exec_escapeHtml(item.notes||'')}</span>
    </td>
    <!-- Status badge -->
    <td class="px-2 py-1.5 w-24 text-center align-middle">
      ${statusBadge}
    </td>
  </tr>`
}

// ─── Stage table block ────────────────────────────
function exec_legal_stageTable(stage, pkgId) {
  const collapseKey = `${pkgId}_${stage.id}`
  const isCollapsed = !!execState.legalCollapsed[collapseKey]
  const doneCount = stage.items.reduce((n,item) => {
    let cnt = item.status==='completed' ? 1 : 0
    ;(item.children||[]).forEach(ch => { if(ch.status==='completed') cnt++ })
    return n + cnt
  }, 0)
  const totalCount = stage.items.reduce((n,item) => n + 1 + (item.children||[]).length, 0)
  const pct = totalCount > 0 ? Math.round(doneCount/totalCount*100) : 0
  const pctCls = pct>=80?'text-green-600':pct>=50?'text-yellow-600':'text-red-500'

  return `<div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-3">
    <!-- Stage header (collapsible) -->
    <div class="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100 cursor-pointer select-none"
         onclick="exec_legalToggleCollapse('${collapseKey}')">
      <div class="flex items-center gap-2">
        <i class="fas fa-chevron-${isCollapsed?'right':'down'} text-gray-400 text-xs w-3"></i>
        <span class="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">${exec_escapeHtml(stage.code||'')}</span>
        <span class="text-sm font-semibold text-gray-800">${exec_escapeHtml(stage.name||'')}</span>
        <span class="text-xs text-gray-400">(${doneCount}/${totalCount})</span>
      </div>
      <span class="text-sm font-bold ${pctCls}">${pct}%</span>
    </div>
    ${isCollapsed ? '' : `
    <!-- Excel-style table -->
    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
            <th class="px-2 py-1.5 w-8 text-center font-medium">✓</th>
            <th class="px-2 py-1.5 w-10 text-center font-medium">STT</th>
            <th class="px-2 py-1.5 font-medium">Tên hồ sơ / hạng mục</th>
            <th class="px-2 py-1.5 w-28 font-medium whitespace-nowrap">Hạn nộp</th>
            <th class="px-2 py-1.5 w-28 font-medium whitespace-nowrap">Ngày XH</th>
            <th class="px-2 py-1.5 font-medium">Ghi chú</th>
            <th class="px-2 py-1.5 w-24 text-center font-medium">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          ${stage.items.length === 0
            ? `<tr><td colspan="7" class="text-center text-xs text-gray-300 italic py-4">Chưa có hạng mục</td></tr>`
            : stage.items.map(item => `
              ${exec_legal_row(item, stage.id, false)}
              ${(item.children||[]).map(ch => exec_legal_row(ch, stage.id, true)).join('')}
            `).join('')}
        </tbody>
      </table>
    </div>`}
  </div>`
}

// ─── Full legal detail renderer ───────────────────
function exec_renderLegalDetail(data) {
  const packages = data.packages || []
  const letters  = data.letters  || []
  const minutes  = data.minutes  || []

  if (packages.length === 0 && letters.length === 0 && minutes.length === 0) {
    return `<div class="text-center py-10 text-gray-400">
      <i class="fas fa-folder-open text-3xl mb-3 block opacity-30"></i>
      <p class="text-sm">Chưa có hồ sơ pháp lý nào</p>
    </div>`
  }

  // ── KPI tổng (luôn hiện) ──
  const kpiBar = exec_legal_kpi(packages)

  // ── Content từng tab ──
  const tabItems = `
    <div id="exec-legal-panel-items">
      ${packages.length === 0
        ? `<div style="text-align:center;padding:32px;color:#9ca3af;font-size:13px"><i class="fas fa-folder-open" style="font-size:24px;display:block;margin-bottom:8px;opacity:.3"></i>Chưa có hạng mục hồ sơ</div>`
        : packages.map(pkg => `
          <div style="margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
              <i class="fas fa-folder" style="color:#00A651;font-size:12px"></i>
              <span style="font-weight:700;color:#1e293b;font-size:13px">${exec_escapeHtml(pkg.name||'Gói hồ sơ')}</span>
            </div>
            ${(pkg.stages||[]).map(st => exec_legal_stageTable(st, pkg.id)).join('')}
          </div>`).join('')
      }
    </div>`

  const tabLetters = `
    <div id="exec-legal-panel-letters">
      ${letters.length === 0
        ? `<div style="text-align:center;padding:32px;color:#9ca3af;font-size:13px"><i class="fas fa-paper-plane" style="font-size:24px;display:block;margin-bottom:8px;opacity:.3"></i>Chưa có văn bản gửi đi</div>`
        : exec_legal_lettersTable(letters)
      }
    </div>`

  const tabMinutes = `
    <div id="exec-legal-panel-minutes">
      ${minutes.length === 0
        ? `<div style="text-align:center;padding:32px;color:#9ca3af;font-size:13px"><i class="fas fa-handshake" style="font-size:24px;display:block;margin-bottom:8px;opacity:.3"></i>Chưa có biên bản họp</div>`
        : exec_legal_minutesTable(minutes)
      }
    </div>`

  // ── Tab definitions ──
  const tabs = [
    { id:'items',   icon:'fa-layer-group', label:'Theo dõi hồ sơ', color:'#00A651', activeBg:'#f0fdf4', activeBorder:'#00A651', count: packages.reduce((n,p)=>n+(p.stages||[]).reduce((m,s)=>m+s.items.length+(s.items.reduce((x,i)=>x+(i.children||[]).length,0)),0),0) },
    { id:'letters', icon:'fa-paper-plane', label:'Văn bản gửi đi', color:'#1d4ed8', activeBg:'#eff6ff', activeBorder:'#3b82f6', count: letters.length },
    { id:'minutes', icon:'fa-handshake',   label:'Biên bản họp',   color:'#7c3aed', activeBg:'#f5f3ff', activeBorder:'#7c3aed', count: minutes.length },
  ]

  // Active tab = tab đầu có data, fallback items
  const activeTab = execState.legalSubTab || 'items'

  const tabNav = tabs.map(t => {
    const isActive = activeTab === t.id
    return `<button
      onclick="exec_legalSwitchSubTab('${t.id}')"
      style="
        display:inline-flex;align-items:center;gap:6px;
        padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;
        border:none;border-bottom:2.5px solid ${isActive ? t.color : 'transparent'};
        background:${isActive ? t.activeBg : 'transparent'};
        color:${isActive ? t.color : '#6b7280'};
        border-radius:8px 8px 0 0;
        transition:all .15s;white-space:nowrap;
      "
      onmouseover="if('${activeTab}'!=='${t.id}'){this.style.background='#f9fafb';this.style.color='#374151'}"
      onmouseout="if('${activeTab}'!=='${t.id}'){this.style.background='transparent';this.style.color='#6b7280'}"
    >
      <i class="fas ${t.icon}" style="font-size:11px"></i>
      ${t.label}
      ${t.count > 0 ? `<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;background:${isActive?t.color+'22':'#f3f4f6'};color:${isActive?t.color:'#9ca3af'}">${t.count}</span>` : ''}
    </button>`
  }).join('')

  return `<div>
    <!-- KPI bar tổng quan -->
    ${kpiBar}

    <!-- Tab navigation -->
    <div style="border-bottom:1.5px solid #e5e7eb;margin-bottom:14px;display:flex;gap:2px;flex-wrap:wrap">
      ${tabNav}
    </div>

    <!-- Tab panels (chỉ hiện panel active) -->
    ${activeTab === 'items'   ? tabItems   : ''}
    ${activeTab === 'letters' ? tabLetters : ''}
    ${activeTab === 'minutes' ? tabMinutes : ''}
  </div>`
}

// ─── Switch sub-tab trong Legal detail ────────────
function exec_legalSwitchSubTab(tabId) {
  execState.legalSubTab = tabId
  const bodyEl = document.getElementById('exec-tab-body')
  if (bodyEl && execState.legalDetail) {
    bodyEl.innerHTML = exec_renderLegalDetail(execState.legalDetail)
  }
}
window.exec_legalSwitchSubTab = exec_legalSwitchSubTab

// ─── Toggle collapse for stage ────────────────────
function exec_legalToggleCollapse(key) {
  execState.legalCollapsed[key] = !execState.legalCollapsed[key]
  const bodyEl = document.getElementById('exec-tab-body')
  if (bodyEl && execState.legalDetail) {
    bodyEl.innerHTML = exec_renderLegalDetail(execState.legalDetail)
  }
}

// ─── Toggle item status via checkbox ─────────────
async function exec_legalToggleStatus(itemId, isChecked) {
  const newStatus = isChecked ? 'completed' : 'pending'
  try {
    // Optimistically update local data
    exec_legalUpdateItemField(itemId, 'status', newStatus)
    // Save to server
    await execFetch(`/api/legal/items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    })
    // Re-render to reflect status badge change
    const bodyEl = document.getElementById('exec-tab-body')
    if (bodyEl && execState.legalDetail) {
      bodyEl.innerHTML = exec_renderLegalDetail(execState.legalDetail)
    }
  } catch (e) {
    console.error('exec_legalToggleStatus:', e)
    alert('Lỗi khi cập nhật trạng thái. Vui lòng thử lại.')
    // Revert checkbox
    exec_legalUpdateItemField(itemId, 'status', isChecked ? 'pending' : 'completed')
    const bodyEl = document.getElementById('exec-tab-body')
    if (bodyEl && execState.legalDetail) {
      bodyEl.innerHTML = exec_renderLegalDetail(execState.legalDetail)
    }
  }
}

// ─── Save inline cell edit ────────────────────────
async function exec_legalSaveCell(itemId, field, value) {
  // Update local state immediately
  const oldVal = exec_legalGetItemField(itemId, field)
  if (value === (oldVal||'')) return // no change
  exec_legalUpdateItemField(itemId, field, value)
  try {
    // Build update payload from current item state
    const item = exec_legalFindItem(itemId)
    if (!item) return
    await execFetch(`/api/legal/items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: item.title,
        item_type: item.item_type,
        due_date: item.due_date || null,
        actual_completion_date: item.actual_completion_date || null,
        status: item.status,
        notes: item.notes || null,
      })
    })
  } catch (e) {
    console.error('exec_legalSaveCell:', e)
    // Revert
    exec_legalUpdateItemField(itemId, field, oldVal)
  }
}

// ─── Local data helpers ───────────────────────────
function exec_legalFindItem(itemId) {
  if (!execState.legalDetail) return null
  for (const pkg of execState.legalDetail.packages||[]) {
    for (const st of pkg.stages||[]) {
      for (const item of st.items||[]) {
        if (item.id === itemId) return item
        for (const ch of item.children||[]) {
          if (ch.id === itemId) return ch
        }
      }
    }
  }
  return null
}
function exec_legalGetItemField(itemId, field) {
  const item = exec_legalFindItem(itemId)
  return item ? item[field] : null
}
function exec_legalUpdateItemField(itemId, field, value) {
  if (!execState.legalDetail) return
  for (const pkg of execState.legalDetail.packages||[]) {
    for (const st of pkg.stages||[]) {
      for (const item of st.items||[]) {
        if (item.id === itemId) { item[field] = value; return }
        for (const ch of item.children||[]) {
          if (ch.id === itemId) { ch[field] = value; return }
        }
      }
    }
  }
}

// ─── HTML escape helper ───────────────────────────
function exec_escapeHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ─── Letter type labels ───────────────────────────
const EXEC_LETTER_TYPE_LABELS = {
  cv:'Công văn', bc:'Báo cáo', bb:'Biên bản', tb:'Thông báo',
  qd:'Quyết định', tt:'Tờ trình', kh:'Kế hoạch', yc:'Yêu cầu',
  pl:'Phụ lục', contract:'Hợp đồng', appendix:'Phụ lục HĐ',
  acceptance:'Nghiệm thu', payment:'Thanh toán', other:'Khác'
}
const EXEC_LETTER_TYPE_COLORS = {
  cv:'#0066CC', bc:'#0891b2', bb:'#059669', tb:'#7c3aed',
  qd:'#dc2626', tt:'#ea580c', kh:'#16a34a', yc:'#ca8a04',
  pl:'#9333ea', contract:'#3b82f6', appendix:'#a855f7',
  acceptance:'#22c55e', payment:'#f97316', other:'#6b7280'
}
const EXEC_LETTER_STATUS = {
  draft:   { label:'Nháp',       bg:'#f3f4f6', color:'#6b7280' },
  sent:    { label:'Đã gửi',     bg:'#dbeafe', color:'#1d4ed8' },
  received:{ label:'Đã nhận',    bg:'#d1fae5', color:'#065f46' },
  pending: { label:'Chờ phản hồi',bg:'#fef3c7', color:'#92400e' },
  approved:{ label:'Đã duyệt',   bg:'#d1fae5', color:'#065f46' },
  rejected:{ label:'Bị từ chối', bg:'#fee2e2', color:'#991b1b' },
}

// ─── Văn bản gửi đi table ─────────────────────────
function exec_legal_lettersTable(letters) {
  if (!letters || letters.length === 0) return ''
  // Nhóm theo letter_type để hiển thị badge màu
  const typeColor = (t) => EXEC_LETTER_TYPE_COLORS[t] || '#6b7280'
  const typeLabel = (t) => EXEC_LETTER_TYPE_LABELS[t] || t
  const statusBadge = (s) => {
    const st = EXEC_LETTER_STATUS[s] || { label: s, bg:'#f3f4f6', color:'#6b7280' }
    return `<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;background:${st.bg};color:${st.color};white-space:nowrap">${st.label}</span>`
  }

  const rows = letters.map(l => {
    const tColor = typeColor(l.letter_type)
    const tLabel = typeLabel(l.letter_type)
    const linkedItem = l.item_stt
      ? `<span style="font-size:10px;color:#6b7280;white-space:nowrap">${exec_escapeHtml(l.stage_code||'')} ${l.item_stt}</span>`
      : `<span style="font-size:10px;color:#d1d5db">—</span>`
    return `<tr style="border-bottom:1px solid #f3f4f6;transition:background .15s" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background=''">
      <td style="padding:7px 10px;white-space:nowrap;font-size:12px;font-weight:700;color:${tColor}">${exec_escapeHtml(l.letter_number||'')}</td>
      <td style="padding:7px 8px">
        <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;background:${tColor}18;color:${tColor};white-space:nowrap">${tLabel}</span>
      </td>
      <td style="padding:7px 10px;font-size:12px;color:#1e293b;max-width:260px">
        <span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden" title="${exec_escapeHtml(l.subject||'')}">${exec_escapeHtml(l.subject||'')}</span>
      </td>
      <td style="padding:7px 10px;font-size:12px;color:#475569;white-space:nowrap">${exec_escapeHtml(l.recipient||'—')}</td>
      <td style="padding:7px 10px;text-align:center">${linkedItem}</td>
      <td style="padding:7px 10px;font-size:12px;color:#64748b;white-space:nowrap">${l.sent_date||'—'}</td>
      <td style="padding:7px 10px;text-align:center">${statusBadge(l.status||'draft')}</td>
      <td style="padding:7px 10px;font-size:11px;color:#9ca3af;max-width:140px">
        <span style="display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden">${exec_escapeHtml(l.notes||'')}</span>
      </td>
    </tr>`
  }).join('')

  return `
  <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-3">
    <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:#f8fafc;border-bottom:1px solid #e5e7eb">
      <i class="fas fa-paper-plane" style="color:#0066CC;font-size:13px"></i>
      <span style="font-weight:700;font-size:13px;color:#1e293b">Văn bản gửi đi</span>
      <span style="font-size:11px;font-weight:600;padding:1px 8px;border-radius:10px;background:#dbeafe;color:#1d4ed8">${letters.length}</span>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e5e7eb">
            <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;white-space:nowrap">Số VB</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Loại</th>
            <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Trích yếu</th>
            <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Người nhận</th>
            <th style="padding:6px 10px;text-align:center;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;white-space:nowrap">Hạng mục</th>
            <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;white-space:nowrap">Ngày gửi</th>
            <th style="padding:6px 10px;text-align:center;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;white-space:nowrap">Trạng thái</th>
            <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Ghi chú</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`
}

// ─── Biên bản họp table ───────────────────────────
const EXEC_MINUTE_STATUS = {
  draft:    { label:'Nháp',     bg:'#f3f4f6', color:'#6b7280' },
  confirmed:{ label:'Đã xác nhận', bg:'#d1fae5', color:'#065f46' },
  approved: { label:'Đã duyệt', bg:'#dbeafe', color:'#1d4ed8' },
}

function exec_legal_minutesTable(minutes) {
  if (!minutes || minutes.length === 0) return ''

  const statusBadge = (s) => {
    const st = EXEC_MINUTE_STATUS[s] || { label: s, bg:'#f3f4f6', color:'#6b7280' }
    return `<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;background:${st.bg};color:${st.color};white-space:nowrap">${st.label}</span>`
  }

  const rows = minutes.map(m => {
    const linkedItem = m.legal_item_title
      ? `<span style="font-size:10px;color:#6b7280" title="${exec_escapeHtml(m.legal_item_title)}">${exec_escapeHtml(m.legal_item_title.slice(0,20))}${m.legal_item_title.length>20?'…':''}</span>`
      : `<span style="font-size:10px;color:#d1d5db">—</span>`
    const attendeeCount = m.attendees
      ? `<span style="font-size:11px;color:#475569">${m.attendees.split('\n').filter(a=>a.trim()).length} người</span>`
      : `<span style="font-size:11px;color:#d1d5db">—</span>`
    return `<tr style="border-bottom:1px solid #f3f4f6;transition:background .15s" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background=''">
      <td style="padding:7px 10px;white-space:nowrap;font-size:12px;font-weight:700;color:#7c3aed">${exec_escapeHtml(m.meeting_number||'—')}</td>
      <td style="padding:7px 10px;font-size:12px;color:#1e293b;max-width:240px">
        <div style="font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden" title="${exec_escapeHtml(m.subject||'')}">${exec_escapeHtml(m.subject||'')}</div>
        ${m.location ? `<div style="font-size:10px;color:#94a3b8;margin-top:2px"><i class="fas fa-map-marker-alt" style="font-size:9px"></i> ${exec_escapeHtml(m.location)}</div>` : ''}
      </td>
      <td style="padding:7px 10px;font-size:12px;color:#64748b;white-space:nowrap">${m.meeting_date||'—'}${m.meeting_time?`<br><span style="font-size:10px;color:#94a3b8">${m.meeting_time}</span>`:''}</td>
      <td style="padding:7px 10px;font-size:12px;color:#475569">${exec_escapeHtml(m.chair_person||'—')}</td>
      <td style="padding:7px 10px;text-align:center">${attendeeCount}</td>
      <td style="padding:7px 10px;text-align:center">${linkedItem}</td>
      <td style="padding:7px 10px;text-align:center">${statusBadge(m.status||'draft')}</td>
      <td style="padding:7px 10px;font-size:11px;color:#9ca3af;max-width:140px">
        <span style="display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden">${exec_escapeHtml(m.notes||'')}</span>
      </td>
    </tr>`
  }).join('')

  return `
  <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-3">
    <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:#f8fafc;border-bottom:1px solid #e5e7eb">
      <i class="fas fa-handshake" style="color:#7c3aed;font-size:13px"></i>
      <span style="font-weight:700;font-size:13px;color:#1e293b">Biên bản họp</span>
      <span style="font-size:11px;font-weight:600;padding:1px 8px;border-radius:10px;background:#ede9fe;color:#7c3aed">${minutes.length}</span>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e5e7eb">
            <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;white-space:nowrap">Số BB</th>
            <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Chủ đề</th>
            <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;white-space:nowrap">Ngày họp</th>
            <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;white-space:nowrap">Chủ trì</th>
            <th style="padding:6px 10px;text-align:center;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;white-space:nowrap">Tham dự</th>
            <th style="padding:6px 10px;text-align:center;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;white-space:nowrap">Hạng mục</th>
            <th style="padding:6px 10px;text-align:center;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;white-space:nowrap">Trạng thái</th>
            <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Ghi chú</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`
}

// ═══════════════════════════════════════════════════
// TAB 3: TÀI CHÍNH
// ═══════════════════════════════════════════════════
function exec_tab_finance(ov) {
  const f = ov.finance
  const p = ov.project

  return `<div class="space-y-4">

    <!-- 4 KPI -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div class="bg-blue-50 rounded-xl p-3 text-center">
        <p class="text-xs text-gray-500 mb-1">Giá trị HĐ</p>
        <p class="text-lg font-bold text-blue-700">${exec_fmtMoney(f.contract_value)}</p>
      </div>
      <div class="bg-yellow-50 rounded-xl p-3 text-center">
        <p class="text-xs text-gray-500 mb-1">Giá trị nghiệm thu</p>
        <p class="text-lg font-bold text-yellow-700">${exec_fmtMoney(f.total_invoiced)}</p>
        <p class="text-xs text-yellow-600 font-semibold">${f.invoiced_pct}% HĐ</p>
      </div>
      <div class="bg-green-50 rounded-xl p-3 text-center">
        <p class="text-xs text-gray-500 mb-1">Giá trị thanh toán</p>
        <p class="text-lg font-bold text-green-700">${exec_fmtMoney(f.total_paid)}</p>
        <p class="text-xs text-green-600 font-semibold">${f.collected_pct}% HĐ</p>
      </div>
      <div class="bg-red-50 rounded-xl p-3 text-center">
        <p class="text-xs text-gray-500 mb-1">Công nợ (chưa thu)</p>
        <p class="text-lg font-bold text-red-600">${exec_fmtMoney(f.debt_amount)}</p>
      </div>
    </div>

    <!-- Progress bars -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div class="space-y-3">
        <div>
          <div class="flex justify-between text-xs text-gray-500 mb-1">
            <span>Tỉ lệ nghiệm thu / HĐ</span>
            <span class="font-semibold">${f.invoiced_pct}%</span>
          </div>
          <div class="w-full bg-gray-100 rounded-full h-3">
            <div class="bg-yellow-400 h-3 rounded-full" style="width:${Math.min(f.invoiced_pct,100)}%"></div>
          </div>
        </div>
        <div>
          <div class="flex justify-between text-xs text-gray-500 mb-1">
            <span>Tỉ lệ thanh toán / HĐ</span>
            <span class="font-semibold text-green-600">${f.collected_pct}%</span>
          </div>
          <div class="w-full bg-gray-100 rounded-full h-3">
            <div class="bg-green-500 h-3 rounded-full" style="width:${Math.min(f.collected_pct,100)}%"></div>
          </div>
        </div>
      </div>
      ${p.next_payment_phase ? `
      <div class="mt-3 bg-yellow-50 rounded-lg p-3 border border-yellow-200">
        <p class="text-xs text-gray-500 font-medium">💡 Đợt thanh toán tiếp theo:</p>
        <p class="text-sm font-bold text-yellow-700">${p.next_payment_phase} — ${exec_fmtMoney(p.next_payment_amount)}</p>
        ${p.next_payment_note?`<p class="text-xs text-gray-500 mt-1">${p.next_payment_note}</p>`:''}
      </div>` : ''}
    </div>

    <!-- Lịch sử ĐNTT -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div class="px-4 py-2.5 border-b border-gray-100">
        <p class="font-bold text-gray-700 text-sm"><i class="fas fa-receipt mr-2 text-green-500"></i>Lịch sử nghiệm thu &amp; thanh toán</p>
      </div>
      ${f.recent_payments.length===0
        ? `<p class="text-sm text-gray-400 italic text-center py-4">Chưa có đề nghị thanh toán</p>`
        : `<div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th class="px-3 py-2 text-left">Đợt / Nội dung</th>
                <th class="px-3 py-2 text-left">Gói thầu</th>
                <th class="px-3 py-2 text-right">Số tiền</th>
                <th class="px-3 py-2 text-right">Đã thanh toán</th>
                <th class="px-3 py-2 text-center">Trạng thái</th>
                <th class="px-3 py-2 text-center">Ngày</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              ${f.recent_payments.map(pay=>`
              <tr class="hover:bg-gray-50">
                <td class="px-3 py-2">
                  <p class="font-medium text-gray-800 truncate max-w-[200px]">${pay.payment_phase||pay.description}</p>
                  ${pay.request_number?`<p class="text-xs text-gray-400 font-mono">${pay.request_number}</p>`:''}
                </td>
                <td class="px-3 py-2">
                  <p class="text-sm text-gray-700 truncate max-w-[160px]" title="${(pay.package_name||'').replace(/"/g,'&quot;')}">${pay.package_name || '—'}</p>
                </td>
                <td class="px-3 py-2 text-right font-bold text-gray-800 whitespace-nowrap">${exec_fmtMoney(pay.amount)}</td>
                <td class="px-3 py-2 text-right font-bold text-green-600 whitespace-nowrap">${exec_fmtMoney(pay.paid_amount)}</td>
                <td class="px-3 py-2 text-center">${exec_paymentStatusBadge(pay.status)}</td>
                <td class="px-3 py-2 text-center text-xs text-gray-500 whitespace-nowrap">${exec_fmtDate(pay.request_date)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </div>

  </div>`
}

// ═══════════════════════════════════════════════════
// TAB 4: CHỈ ĐẠO
// ═══════════════════════════════════════════════════
function exec_tab_directives(ov) {
  const directives = ov.directives || []
  const open = directives.filter(d => d.status !== 'done')
  const done = directives.filter(d => d.status === 'done')

  return `<div class="space-y-4">

    <div class="flex justify-end">
      <button onclick="exec_openDirectiveModal(${ov.project.id}, '${(ov.project.name||'').replace(/'/g,"&#39;")}')"
        class="bg-[#00A651] hover:bg-[#007a3d] text-white px-4 py-2 rounded-xl font-semibold text-sm transition-colors flex items-center gap-2">
        <i class="fas fa-plus"></i> Thêm chỉ đạo mới
      </button>
    </div>

    <!-- Đang mở -->
    <div>
      <p class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">
        Chỉ đạo đang theo dõi (${open.length})
      </p>
      ${open.length===0
        ? `<div class="bg-green-50 rounded-xl p-6 text-center"><p class="text-green-600 font-medium">✓ Không có chỉ đạo nào đang mở</p></div>`
        : `<div class="space-y-3">${open.map(d=>exec_directiveCard(d, ov.project.id)).join('')}</div>`}
    </div>

    <!-- Đã xong -->
    ${done.length>0 ? `
    <div>
      <p class="text-xs font-bold text-gray-300 uppercase tracking-wide mb-3">Đã hoàn thành (${done.length})</p>
      <div class="space-y-2 opacity-60">${done.map(d=>exec_directiveCard(d, ov.project.id)).join('')}</div>
    </div>` : ''}
  </div>`
}

function exec_directiveCard(d, projectId) {
  const isOverdue = d.due_date && d.status !== 'done' && new Date(d.due_date) < new Date()
  return `
  <div class="bg-white rounded-xl border ${isOverdue?'border-red-200':d.status==='done'?'border-gray-100':'border-gray-100'} shadow-sm p-3">
    <div class="flex items-start justify-between gap-2 mb-2">
      <div class="flex items-center gap-1.5 flex-wrap">
        ${exec_directiveBadge(d.status)}
        ${exec_priorityBadge(d.priority)}
        ${isOverdue?`<span class="text-xs text-red-600 font-bold">⚠ Trễ hạn</span>`:''}
      </div>
      <div class="flex gap-1.5 flex-shrink-0">
        ${d.status!=='done'?`
        <button onclick="exec_markDirectiveDone(${d.id}, ${projectId})" title="Hoàn thành"
          class="text-xs text-green-600 hover:bg-green-50 px-2 py-1 rounded-lg border border-green-200">
          <i class="fas fa-check"></i>
        </button>`:''}
        <button onclick="exec_deleteDirective(${d.id}, ${projectId})" title="Xoá"
          class="text-xs text-red-400 hover:bg-red-50 px-2 py-1 rounded-lg border border-red-200">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
    <p class="text-sm text-gray-800 font-medium leading-relaxed mb-1.5">${d.content}</p>
    <div class="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
      ${d.assignee_name||d.assignee_full_name?`<span><i class="fas fa-user mr-1"></i>${d.assignee_name||d.assignee_full_name}</span>`:''}
      ${d.due_date?`<span class="${isOverdue?'text-red-500 font-semibold':''}"><i class="fas fa-calendar mr-1"></i>Hạn: ${exec_fmtDate(d.due_date)}</span>`:''}
      <span><i class="fas fa-clock mr-1"></i>${exec_fmtDate(d.created_at)}</span>
    </div>
    ${d.response?`
    <div class="mt-2 bg-blue-50 rounded-lg px-2.5 py-1.5">
      <p class="text-xs text-blue-700">Phản hồi: ${d.response}</p>
    </div>`:''}
  </div>`
}

// ─── Filter & Search ─────────────────────────────
function execSetFilter(f) {
  execState.filter = f
  // Re-render filter buttons
  const leftPanel = document.getElementById('exec-main-layout')
  if (leftPanel) {
    ;['all','active','planning','on_hold','completed'].forEach(fid => {
      const btns = leftPanel.querySelectorAll(`button[onclick="execSetFilter('${fid}')"]`)
      btns.forEach(btn => {
        if (fid === f) {
          btn.className = btn.className.replace('bg-gray-100 text-gray-600 hover:bg-gray-200','')
          btn.classList.add('bg-[#00A651]','text-white')
          btn.classList.remove('bg-gray-100','text-gray-600','hover:bg-gray-200')
        } else {
          btn.classList.remove('bg-[#00A651]','text-white')
          btn.classList.add('bg-gray-100','text-gray-600','hover:bg-gray-200')
        }
      })
    })
  }
  exec_loadProjects()
}
let _execSearchTimer = null
function execOnSearch(v) {
  clearTimeout(_execSearchTimer)
  execState.search = v
  _execSearchTimer = setTimeout(() => exec_loadProjects(), 350)
}

// ─── Directive actions ───────────────────────────
async function exec_markDirectiveDone(directiveId, projectId) {
  try {
    await execFetch(`/api/executive/directives/${directiveId}`, {
      method: 'PUT', body: JSON.stringify({ status: 'done' })
    })
    exec_showToast('Đã đánh dấu hoàn thành ✓', 'success')
    await exec_loadOverview(projectId)
  } catch (e) { exec_showToast('Lỗi: ' + e.message, 'error') }
}
async function exec_deleteDirective(directiveId, projectId) {
  if (!confirm('Xoá chỉ đạo này?')) return
  try {
    await execFetch(`/api/executive/directives/${directiveId}`, { method: 'DELETE' })
    exec_showToast('Đã xoá ✓', 'success')
    await exec_loadOverview(projectId)
  } catch (e) { exec_showToast('Lỗi: ' + e.message, 'error') }
}

// ─── Directive Modal ─────────────────────────────
function exec_openDirectiveModal(projectId, projectName) {
  document.getElementById('exec-directive-modal-wrapper')?.remove()
  const div = document.createElement('div')
  div.id = 'exec-directive-modal-wrapper'
  div.innerHTML = `
  <div class="fixed inset-0 bg-black/50 z-[9998] flex items-center justify-center p-4" onclick="if(event.target===this)exec_closeDirectiveModal()">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
      <div class="flex items-center justify-between p-4 border-b border-gray-100">
        <h3 class="font-bold text-gray-800"><i class="fas fa-bullhorn text-[#00A651] mr-2"></i>Thêm Chỉ Đạo</h3>
        <button onclick="exec_closeDirectiveModal()" class="text-gray-400 hover:text-gray-600 w-8 h-8 rounded-lg hover:bg-gray-100"><i class="fas fa-times"></i></button>
      </div>
      <div class="p-4 space-y-3">
        <div>
          <label class="text-xs text-gray-500 font-medium block mb-1">Nội dung chỉ đạo *</label>
          <textarea id="exec-dir-content" rows="3" placeholder="Nhập nội dung chỉ đạo..."
            class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00A651]/30 resize-none"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-gray-500 font-medium block mb-1">Mức ưu tiên</label>
            <select id="exec-dir-priority" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none bg-white">
              <option value="urgent">🔴 Khẩn cấp</option>
              <option value="high" selected>🟠 Cao</option>
              <option value="medium">🟡 Trung bình</option>
              <option value="low">⚪ Thấp</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500 font-medium block mb-1">Hạn thực hiện</label>
            <input type="date" id="exec-dir-due" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
          </div>
        </div>
        <div>
          <label class="text-xs text-gray-500 font-medium block mb-1">Giao cho</label>
          <input type="text" id="exec-dir-assignee" placeholder="Tên người thực hiện"
            class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
        </div>
      </div>
      <div class="flex gap-3 p-4 border-t border-gray-100">
        <button onclick="exec_submitDirective(${projectId})"
          class="flex-1 bg-[#00A651] hover:bg-[#007a3d] text-white py-2.5 rounded-xl font-semibold text-sm">
          <i class="fas fa-save mr-2"></i>Lưu chỉ đạo
        </button>
        <button onclick="exec_closeDirectiveModal()"
          class="px-5 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl font-medium text-sm">Huỷ</button>
      </div>
    </div>
  </div>`
  document.body.appendChild(div)
}
function exec_closeDirectiveModal() { document.getElementById('exec-directive-modal-wrapper')?.remove() }
async function exec_submitDirective(projectId) {
  const content = document.getElementById('exec-dir-content')?.value?.trim()
  if (!content) { exec_showToast('Nhập nội dung chỉ đạo', 'warning'); return }
  try {
    await execFetch('/api/executive/directives', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId, content,
        priority:  document.getElementById('exec-dir-priority')?.value || 'high',
        due_date:  document.getElementById('exec-dir-due')?.value || null,
        assignee_name: document.getElementById('exec-dir-assignee')?.value?.trim() || null,
        status: 'open',
      })
    })
    exec_showToast('Đã thêm chỉ đạo ✓', 'success')
    exec_closeDirectiveModal()
    await exec_loadOverview(projectId)
    execState.activeTab = 'directives'
    exec_renderRightPanel()
  } catch (e) { exec_showToast('Lỗi: ' + e.message, 'error') }
}

// ─── Health Edit Modal ────────────────────────────
function exec_openHealthEdit(projectId) {
  document.getElementById('exec-health-modal-wrapper')?.remove()
  const p = execState.currentOverview?.project || {}

  const f = (id, label, val, type='text', placeholder='') => `
    <div>
      <label class="text-xs text-gray-500 font-medium block mb-1">${label}</label>
      <input type="${type}" id="${id}" value="${val||''}" placeholder="${placeholder}"
        class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00A651]/30">
    </div>`
  const ta = (id, label, val, rows=2) => `
    <div>
      <label class="text-xs text-gray-500 font-medium block mb-1">${label}</label>
      <textarea id="${id}" rows="${rows}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00A651]/30 resize-none">${val||''}</textarea>
    </div>`

  const div = document.createElement('div')
  div.id = 'exec-health-modal-wrapper'
  div.innerHTML = `
  <div class="fixed inset-0 bg-black/50 z-[9998] flex items-start justify-center p-4 overflow-y-auto" onclick="if(event.target===this)exec_closeHealthEdit()">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4">
      <div class="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
        <h3 class="font-bold text-gray-800"><i class="fas fa-edit text-[#00A651] mr-2"></i>Cập nhật — ${p.name||'Dự án'}</h3>
        <button onclick="exec_closeHealthEdit()" class="text-gray-400 hover:text-gray-600 w-8 h-8 rounded-lg hover:bg-gray-100"><i class="fas fa-times"></i></button>
      </div>
      <div class="p-4 space-y-5">

        <!-- Sức khỏe & Tiến độ -->
        <div>
          <p class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">📊 Sức khỏe & Tiến độ</p>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="text-xs text-gray-500 font-medium block mb-1">Sức khỏe (0-100)</label>
              <input type="number" min="0" max="100" id="hlt-health" value="${p.health_score??50}"
                class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00A651]/30">
            </div>
            <div>
              <label class="text-xs text-gray-500 font-medium block mb-1">Mức độ rủi ro</label>
              <select id="hlt-risk" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none bg-white">
                ${['low','medium','high','critical'].map(r=>`<option value="${r}" ${p.risk_level===r?'selected':''}>${{low:'🟢 Thấp',medium:'🟡 Trung bình',high:'🟠 Cao',critical:'🔴 Khẩn cấp'}[r]}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            ${f('hlt-phase','Giai đoạn đang triển khai',p.current_phase,'text','VD: Giai đoạn 2 - Thi công')}
            ${f('hlt-milestone','Mốc kế tiếp',p.next_milestone,'text','VD: Nộp thẩm duyệt')}
            ${f('hlt-milestone-date','Ngày đạt mốc',p.next_milestone_date,'date')}
          </div>
        </div>

        <!-- Báo cáo & Vướng mắc -->
        <div>
          <p class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">📝 Báo cáo & Vướng mắc</p>
          <div class="space-y-3">
            ${f('hlt-report-date','Ngày báo cáo',p.pm_report_date,'date')}
            ${ta('hlt-report','Báo cáo từ Leader / PM',p.pm_report,3)}
            ${ta('hlt-issues','Vướng mắc lớn cần sếp theo dõi',p.major_issues,3)}
            ${ta('hlt-risk-notes','Rủi ro / Điểm nghẽn',p.risk_notes,2)}
          </div>
        </div>

        <!-- Đầu mối liên hệ -->
        <div>
          <p class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">📋 Đầu mối liên hệ</p>
          <div class="space-y-3">
            <div class="bg-blue-50 rounded-xl p-3">
              <p class="text-xs font-bold text-blue-700 mb-2">🖊 TVTK (Tư vấn thiết kế)</p>
              <div class="grid grid-cols-3 gap-2">${f('hlt-tvtk-name','Tên đơn vị',p.tvtk_name)}${f('hlt-tvtk-contact','Người liên hệ',p.tvtk_contact)}${f('hlt-tvtk-phone','Điện thoại',p.tvtk_phone)}</div>
            </div>
            <div class="bg-purple-50 rounded-xl p-3">
              <p class="text-xs font-bold text-purple-700 mb-2">🏢 CĐT (Chủ đầu tư)</p>
              <div class="grid grid-cols-3 gap-2">${f('hlt-cdt-name','Tên CĐT',p.cdt_name||p.client)}${f('hlt-cdt-contact','Người liên hệ',p.cdt_contact||p.client_contact_name)}${f('hlt-cdt-phone','Điện thoại',p.cdt_phone||p.client_contact_phone)}</div>
            </div>
            <div class="bg-orange-50 rounded-xl p-3">
              <p class="text-xs font-bold text-orange-700 mb-2">👔 QLDA (Quản lý dự án)</p>
              <div class="grid grid-cols-3 gap-2">${f('hlt-qlda-name','Tên đơn vị',p.qlda_name)}${f('hlt-qlda-contact','Người liên hệ',p.qlda_contact)}${f('hlt-qlda-phone','Điện thoại',p.qlda_phone)}</div>
            </div>
            <div class="bg-red-50 rounded-xl p-3">
              <p class="text-xs font-bold text-red-700 mb-2">🏗 Nhà thầu thi công</p>
              <div class="grid grid-cols-3 gap-2">${f('hlt-nthau-name','Tên nhà thầu',p.nthau_name)}${f('hlt-nthau-contact','Người liên hệ',p.nthau_contact)}${f('hlt-nthau-phone','Điện thoại',p.nthau_phone)}</div>
            </div>
          </div>
        </div>

        <!-- Thanh toán tiếp theo -->
        <div>
          <p class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">💰 Đợt thanh toán tiếp theo</p>
          <div class="grid grid-cols-3 gap-3">
            ${f('hlt-pay-phase','Đợt thanh toán',p.next_payment_phase,'text','VD: Đợt 3')}
            ${f('hlt-pay-amount','Số tiền (VNĐ)',p.next_payment_amount,'number')}
            ${f('hlt-pay-note','Ghi chú',p.next_payment_note)}
          </div>
        </div>
      </div>

      <div class="flex gap-3 p-4 border-t border-gray-100 sticky bottom-0 bg-white rounded-b-2xl">
        <button onclick="exec_saveHealthEdit(${projectId})"
          class="flex-1 bg-[#00A651] hover:bg-[#007a3d] text-white py-2.5 rounded-xl font-semibold text-sm">
          <i class="fas fa-save mr-2"></i>Lưu thông tin
        </button>
        <button onclick="exec_closeHealthEdit()"
          class="px-5 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl font-medium text-sm">Huỷ</button>
      </div>
    </div>
  </div>`
  document.body.appendChild(div)
}
function exec_closeHealthEdit() { document.getElementById('exec-health-modal-wrapper')?.remove() }
async function exec_saveHealthEdit(projectId) {
  const g = id => document.getElementById(id)?.value
  const data = {
    health_score:        parseInt(g('hlt-health')) || null,
    risk_level:          g('hlt-risk'),
    current_phase:       g('hlt-phase')           || null,
    next_milestone:      g('hlt-milestone')        || null,
    next_milestone_date: g('hlt-milestone-date')   || null,
    pm_report:           g('hlt-report')           || null,
    pm_report_date:      g('hlt-report-date')      || null,
    major_issues:        g('hlt-issues')           || null,
    risk_notes:          g('hlt-risk-notes')       || null,
    tvtk_name:           g('hlt-tvtk-name')        || null,
    tvtk_contact:        g('hlt-tvtk-contact')     || null,
    tvtk_phone:          g('hlt-tvtk-phone')       || null,
    cdt_name:            g('hlt-cdt-name')         || null,
    cdt_contact:         g('hlt-cdt-contact')      || null,
    cdt_phone:           g('hlt-cdt-phone')        || null,
    qlda_name:           g('hlt-qlda-name')        || null,
    qlda_contact:        g('hlt-qlda-contact')     || null,
    qlda_phone:          g('hlt-qlda-phone')       || null,
    nthau_name:          g('hlt-nthau-name')       || null,
    nthau_contact:       g('hlt-nthau-contact')    || null,
    nthau_phone:         g('hlt-nthau-phone')      || null,
    client_contact_name:  g('hlt-cdt-contact')    || null,
    client_contact_phone: g('hlt-cdt-phone')       || null,
    next_payment_phase:  g('hlt-pay-phase')        || null,
    next_payment_amount: parseFloat(g('hlt-pay-amount')) || null,
    next_payment_note:   g('hlt-pay-note')         || null,
  }

  // Disable save button + show loading state
  const saveBtn = document.querySelector('#exec-health-modal-wrapper button[onclick^="exec_saveHealthEdit"]')
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Đang lưu...' }

  try {
    await execFetch(`/api/executive/project-health/${projectId}`, {
      method: 'PUT', body: JSON.stringify(data)
    })
    exec_showToast('Đã lưu thông tin ✓', 'success')
    exec_closeHealthEdit()
    await exec_loadOverview(projectId)
    await exec_loadProjects()
  } catch (e) {
    exec_showToast('Lỗi lưu: ' + e.message, 'error')
    // Re-enable save button
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Lưu thông tin' }
  }
}

// ─── Toast ────────────────────────────────────────
function exec_showToast(msg, type = 'info') {
  const t = document.createElement('div')
  const colors = { success:'bg-green-600', error:'bg-red-600', warning:'bg-yellow-500', info:'bg-blue-600' }
  t.className = `fixed bottom-6 right-6 ${colors[type]||colors.info} text-white px-4 py-3 rounded-xl shadow-lg text-sm z-[9999] flex items-center gap-2`
  t.innerHTML = `<i class="fas ${type==='success'?'fa-check-circle':type==='error'?'fa-times-circle':'fa-info-circle'}"></i>${msg}`
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 3500)
}

// ─── Init ─────────────────────────────────────────
async function initExecutiveDashboard() {
  const el = document.getElementById('exec-main-layout')
  if (!el) {
    const page = document.getElementById('page-executive-dashboard')
    if (page) {
      const d = document.createElement('div')
      d.id = 'exec-main-layout'
      page.appendChild(d)
    }
  }
  exec_renderLayout()
  await exec_loadProjects()
}

// ─── Window exports ───────────────────────────────
window.initExecutiveDashboard     = initExecutiveDashboard
window.execSetFilter              = execSetFilter
window.execOnSearch               = execOnSearch
window.exec_selectProject         = exec_selectProject
window.exec_switchTab             = exec_switchTab
window.exec_openHealthEdit        = exec_openHealthEdit
window.exec_closeHealthEdit       = exec_closeHealthEdit
window.exec_saveHealthEdit        = exec_saveHealthEdit
window.exec_openDirectiveModal    = exec_openDirectiveModal
window.exec_closeDirectiveModal   = exec_closeDirectiveModal
window.exec_submitDirective       = exec_submitDirective
window.exec_markDirectiveDone     = exec_markDirectiveDone
window.exec_deleteDirective       = exec_deleteDirective
// Legal inline editing exports
window.exec_legalToggleCollapse   = exec_legalToggleCollapse
window.exec_legalToggleStatus     = exec_legalToggleStatus
window.exec_legalSaveCell         = exec_legalSaveCell
