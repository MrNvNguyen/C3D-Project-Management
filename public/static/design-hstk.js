/** QLy HSTK tab + Dashboard dự án */
;(function () {
  const HSTK_PKG_TYPES = { issue: 'Phát hành', revise: 'Sửa đổi', response: 'Phản hồi góp ý' }
  const HSTK_EXECUTION_PHASES_FALLBACK = [
    { key: 'basic_design', short_code: 'TKCS', name: 'TKCS — Thiết kế cơ sở' },
    { key: 'technical_design', short_code: 'TKKT', name: 'TKKT — Thiết kế kỹ thuật' },
    { key: 'construction_design', short_code: 'TKTC', name: 'TKTC — Thiết kế thi công' },
    { key: 'as_built', short_code: 'AsBuilt', name: 'Hoàn công' },
  ]
  const HSTK_REVIEW = { pending: 'Chờ soát', commented: 'Đã góp ý', approved: 'Chấp thuận' }
  const HSTK_SOURCE = { TVTK: 'TVTK', CDT: 'CĐT', internal: 'Nội bộ' }

  /** Nhãn giai đoạn: tránh lặp mã khi name đã chứa short_code (vd. TKCS — Thiết kế cơ sở). */
  function formatExecutionPhaseDisplayLabel(code, name) {
    const c = String(code || '').trim()
    const n = String(name || '').trim()
    if (!n) return c
    if (!c || c === n) return n
    const prefix = `${c} — `
    if (n.startsWith(prefix) || n === c) return n
    return `${c} — ${n}`
  }

  window._designPackageSuggestions = {}
  window._taskDesignPackageId = null
  window._taskDesignPackageName = ''

  window.markRequiredField = function markRequiredField(container, field, message, active) {
    if (!container) return
    const el = container.querySelector ? container.querySelector(`[data-tfield="${field}"], #task${field.charAt(0).toUpperCase() + field.slice(1)}`) : null
    const target = el || (field === 'hstk_date' ? document.getElementById('taskHstkDate') : null)
    if (!target) return
    let hint = container.querySelector?.(`.field-hint-${field}`) || document.getElementById('taskHstkRequiredHint')
    if (active) {
      target.classList.add('ring-2', 'ring-red-500', 'border-red-500')
      target.setAttribute('aria-invalid', 'true')
      if (!hint && field === 'hstk_date') {
        hint = document.createElement('p')
        hint.id = 'taskHstkRequiredHint'
        hint.className = 'text-xs text-red-600 mt-1 field-hint-hstk_date'
        target.parentElement?.appendChild(hint)
      }
      if (hint) {
        hint.textContent = message || 'Phải điền Theo HSTK nào để so sánh với hồ sơ phát sinh task'
        hint.style.display = ''
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.focus()
    } else {
      target.classList.remove('ring-2', 'ring-red-500', 'border-red-500')
      target.removeAttribute('aria-invalid')
      if (hint) hint.style.display = 'none'
    }
  }

  function applyHstkRequiredUi() {
    const pkgId = window._taskDesignPackageId || document.getElementById('taskDesignPackageId')?.value
    const lbl = document.querySelector('#taskHstkGroup label')
    const inp = document.getElementById('taskHstkDate')
    const hint = document.getElementById('taskHstkPkgHint')
    if (!inp) return
    if (pkgId) {
      if (lbl && !lbl.querySelector('.hstk-req-star')) {
        lbl.insertAdjacentHTML('afterbegin', '<span class="hstk-req-star text-red-600 mr-1">*</span>')
      }
      inp.placeholder = 'Bắt buộc: chọn gói HSTK…'
      if (hint) {
        hint.textContent = `Bắt buộc với task tạo từ hồ sơ ${window._taskDesignPackageName || ''}`
        hint.style.display = ''
      }
    } else {
      lbl?.querySelector('.hstk-req-star')?.remove()
      inp.placeholder = 'VD: tên folder YYMMDD-Mô tả hoặc R2…'
      if (hint) hint.style.display = 'none'
      markRequiredField(document.getElementById('taskModal'), 'hstk_date', '', false)
    }
  }
  window.applyHstkRequiredUi = applyHstkRequiredUi

  /** Gộp `\` trùng (giữ UNC `\\server\share`, không đụng `\\?\`). */
  function normalizeWindowsPath(p) {
    if (p === undefined || p === null) return ''
    let s = String(p).trim().replace(/\//g, '\\')
    if (!s) return ''
    if (s.startsWith('\\\\') && !s.startsWith('\\\\?\\')) {
      const tail = s.slice(2).replace(/\\+/g, '\\').replace(/\\+$/, '')
      return '\\\\' + tail
    }
    return s.replace(/\\+/g, '\\').replace(/\\+$/, '')
  }

  function bimfolderNasQuery(nasRoot) {
    const nas = nasRoot !== undefined ? nasRoot : window._lastDesignData?.nas_root
    if (nas === undefined || nas === null) return ''
    return `&nas_root=${encodeURIComponent(normalizeWindowsPath(String(nas)))}`
  }

  const BIMFOLDER_HTTP = 'http://127.0.0.1:8765'

  function bimfolderLink(path, nasRoot) {
    if (!path) return '#'
    const norm = normalizeWindowsPath(path)
    return `bimfolder:open?path=${encodeURIComponent(norm)}${bimfolderNasQuery(nasRoot)}`
  }

  function nasRootForHelper() {
    const nas = window._lastDesignData?.nas_root
    if (nas === undefined || nas === null) return ''
    return normalizeWindowsPath(String(nas))
  }

  async function bimfolderHealth() {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 800)
    try {
      const r = await fetch(`${BIMFOLDER_HTTP}/health`, { signal: ctrl.signal })
      clearTimeout(timer)
      return r.ok
    } catch {
      clearTimeout(timer)
      return false
    }
  }

  const BIMFOLDER_HELPER_MSG =
    'Không kết nối được bimfolder trên máy này (127.0.0.1:8765). Nếu Windows báo Smart App Control: chuột phải CaiDat-MayUser.bat → Properties → tick Unblock (Bỏ chặn), chạy lại và bấm Yes ở UAC. Trình duyệt hỏi mạng nội bộ thì chọn Cho phép, rồi Ctrl+F5.'

  function isBimfolderNetworkError(e) {
    if (!e) return false
    if (e.name === 'AbortError') return true
    const m = String(e.message || '')
    return e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(m)
  }

  async function bimfolderPostJson(path, body) {
    let r
    try {
      r = await fetch(`${BIMFOLDER_HTTP}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (e) {
      if (isBimfolderNetworkError(e)) throw new Error(BIMFOLDER_HELPER_MSG)
      throw e
    }
    if (!r.ok) {
      let msg = r.statusText
      try {
        const j = await r.json()
        if (j?.error) msg = j.error
      } catch (_) { /* ignore */ }
      throw new Error(msg)
    }
  }

  window.designOpenFolder = function (ev) {
    void (async () => {
      if (ev) ev.preventDefault()
      const el = ev?.currentTarget
      const path = normalizeWindowsPath(el?.getAttribute?.('data-folder-path') || '')
      if (!path) return
      const nas = nasRootForHelper()
      try {
        if (!(await bimfolderHealth())) {
          toast(BIMFOLDER_HELPER_MSG, 'warning')
          return
        }
        await bimfolderPostJson('/open', { path, nas_root: nas })
      } catch (e) {
        toast(e.message || 'Không mở được folder', 'warning')
      }
    })()
    return false
  }

  function copyPathBtn(path) {
    const norm = normalizeWindowsPath(path)
    return `<button type="button" class="text-gray-400 hover:text-primary ml-1" title="Copy đường dẫn" onclick="navigator.clipboard.writeText('${norm.replace(/'/g, "\\'")}');toast('Đã copy','success')"><i class="fas fa-copy text-xs"></i></button>`
  }

  function pollScanToken(token, onDone) {
    const start = Date.now()
    const tick = async () => {
      if (Date.now() - start > 120000) {
        onDone(new Error('Hết thời gian chờ quét. Kiểm tra helper bimfolder và bấm Quét lại.'))
        return
      }
      try {
        const st = await api(`/design/scan-token/${encodeURIComponent(token)}/status`)
        if (st.expired) {
          onDone(new Error('Mã quét đã hết hạn — bấm Quét lại.'))
          return
        }
        if (st.used) {
          if (st.error) onDone(new Error(st.error))
          else onDone(null)
          return
        }
      } catch (_) { /* retry */ }
      setTimeout(tick, 1500)
    }
    tick()
  }

  function pollScanTokenAsync(token) {
    return new Promise((resolve, reject) => pollScanToken(token, err => (err ? reject(err) : resolve())))
  }

  function captureQlyHstkUiState(container) {
    if (!container) return null
    const scrollers = [{ el: null, x: window.scrollX, y: window.scrollY }]
    let node = container.parentElement
    while (node && node !== document.documentElement) {
      const oy = getComputedStyle(node).overflowY
      const o = getComputedStyle(node).overflow
      if (/(auto|scroll|overlay)/.test(oy) || /(auto|scroll|overlay)/.test(o)) {
        scrollers.push({ el: node, x: node.scrollLeft, y: node.scrollTop })
      }
      node = node.parentElement
    }
    const openScanLogs = [...container.querySelectorAll('[id^="scanLog_"]:not(.hidden)')].map(el =>
      el.id.replace(/^scanLog_/, ''),
    )
    const active = document.activeElement
    const focusInputId =
      active?.id &&
      (String(active.id).startsWith('designCatFolder_') ||
        String(active.id).startsWith('designDiscBulkFolder_'))
        ? active.id
        : null
    const inputCaret =
      focusInputId && typeof active.selectionStart === 'number'
        ? { start: active.selectionStart, end: active.selectionEnd }
        : null
    return { scrollers, openScanLogs, focusInputId, inputCaret }
  }

  function restoreQlyHstkUiState(state) {
    if (!state) return
    const apply = () => {
      for (const s of state.scrollers) {
        if (s.el) {
          s.el.scrollLeft = s.x
          s.el.scrollTop = s.y
        } else {
          window.scrollTo(s.x, s.y)
        }
      }
    }
    apply()
    requestAnimationFrame(() => {
      apply()
      requestAnimationFrame(() => {
        apply()
        if (state.focusInputId) {
          const inp = document.getElementById(state.focusInputId)
          if (inp) {
            try {
              inp.focus({ preventScroll: true })
            } catch (_) {
              inp.focus()
            }
            if (state.inputCaret) inp.setSelectionRange(state.inputCaret.start, state.inputCaret.end)
          }
        }
      })
    })
  }

  function repaintScanLogPanel(phaseKey, code) {
    const el = document.getElementById(`scanLog_${phaseKey}_${code}`)
    if (!el || !window._lastDesignData) return
    const rows = (window._lastDesignData.scan_logs || []).filter(l => l.discipline_code === code)
    el.innerHTML = rows.length
      ? `<table class="w-full mt-2"><tr><th>Ngày</th><th>Người quét</th><th>Thêm</th><th>Mất</th><th>Tổng</th></tr>
      ${rows.map(r => `<tr><td>${escHtml(r.scanned_at)}</td><td>${escHtml(r.scanned_by_name || '')}</td><td>${r.new_count}</td><td>${r.missing_count}</td><td>${r.total_count}</td></tr>`).join('')}</table>`
      : '<p>Chưa có lịch sử quét.</p>'
  }

  function restoreOpenScanLogPanels(openKeys) {
    if (!openKeys?.length) return
    for (const key of openKeys) {
      const el = document.getElementById(`scanLog_${key}`)
      if (!el) continue
      const parts = String(key).split('_')
      const code = parts.pop()
      const phaseKey = parts.join('_') || qlyHstkPhaseSheetKey(window._lastDesignData?.project_id)
      repaintScanLogPanel(phaseKey, code)
      el.classList.remove('hidden')
    }
  }

  async function designScanSavedPath(projectId, code, path, opts = {}) {
    const quiet = opts.quiet === true
    const normPath = normalizeWindowsPath(path)
    if (!normPath) return { ok: false, reason: 'no_path' }
    if (!(await bimfolderHealth())) {
      if (!quiet) toast(BIMFOLDER_HELPER_MSG, 'warning')
      return { ok: false, reason: 'helper_down' }
    }
    try {
      const phaseId = qlyHstkActivePhaseId(projectId)
      const { link } = await api(`/projects/${projectId}/design/disciplines/${encodeURIComponent(code)}/scan-token`, {
        method: 'post',
        data: { mode: 'rescan', phase_id: phaseId },
      })
      const rawToken = decodeURIComponent((link.match(/token=([^&]+)/) || [])[1] || '')
      const nas = nasRootForHelper()
      await bimfolderPostJson('/scan', { token: rawToken, path: normPath, nas_root: nas })
      await pollScanTokenAsync(rawToken)
      if (!quiet) toast('Quét folder xong', 'success')
      return { ok: true }
    } catch (e) {
      const msg = e.response?.data?.error || e.message || 'Lỗi quét'
      if (!quiet) toast(msg.startsWith('Lỗi quét:') ? msg : `Lỗi quét: ${msg}`, 'warning')
      return { ok: false, reason: 'error', error: msg }
    }
  }

  window._qlyHstkUi = window._qlyHstkUi || {}

  function qlyHstkGetUi(projectId) {
    if (!window._qlyHstkUi[projectId]) {
      window._qlyHstkUi[projectId] = { activeSheet: 'legacy', discFilter: 'all', collapsed: {} }
    }
    return window._qlyHstkUi[projectId]
  }

  function qlyHstkPhaseQuery(projectId) {
    const sheet = qlyHstkGetUi(projectId).activeSheet
    if (sheet === 'legacy') return 'legacy'
    return String(sheet)
  }

  function qlyHstkPhaseSheetKey(projectId) {
    const sheet = qlyHstkGetUi(projectId).activeSheet
    return sheet === 'legacy' ? 'legacy' : String(sheet)
  }

  function qlyHstkActivePhaseId(projectId) {
    const sheet = qlyHstkGetUi(projectId).activeSheet
    return sheet === 'legacy' ? null : sheet
  }

  function qlyHstkExecutionPhaseCatalog(data) {
    return data?.execution_phase_catalog?.length ? data.execution_phase_catalog : HSTK_EXECUTION_PHASES_FALLBACK
  }

  function qlyHstkActiveTaskPhaseKey(projectId) {
    const sheet = qlyHstkGetUi(projectId).activeSheet
    if (sheet === 'legacy') return null
    const phases = window._lastDesignData?.phases || []
    const row = phases.find(p => p.id === sheet)
    if (!row) return null
    return row.execution_phase_key || row.code || null
  }

  window.qlyHstkSelectSheet = function (projectId, sheet) {
    const ui = qlyHstkGetUi(projectId)
    ui.activeSheet = sheet === 'legacy' ? 'legacy' : parseInt(String(sheet), 10) || sheet
    ui.discFilter = 'all'
    const c = document.getElementById(`qlyHstkContainer_${projectId}`)
    if (c) void initQlyHstkTab(c, projectId, { preserveScroll: true })
  }

  window.qlyHstkSetDiscFilter = function (projectId, code) {
    qlyHstkGetUi(projectId).discFilter = code || 'all'
    const c = document.getElementById(`qlyHstkContainer_${projectId}`)
    if (c && window._lastDesignData) renderQlyHstk(c, projectId, window._lastDesignData)
  }

  window.qlyHstkToggleDiscCollapse = function (projectId, code) {
    const ui = qlyHstkGetUi(projectId)
    const key = `${qlyHstkPhaseSheetKey(projectId)}:${code}`
    ui.collapsed[key] = !ui.collapsed[key]
    const c = document.getElementById(`qlyHstkContainer_${projectId}`)
    if (c && window._lastDesignData) renderQlyHstk(c, projectId, window._lastDesignData)
  }

  function qlyHstkDiscCollapsed(projectId, code) {
    const ui = qlyHstkGetUi(projectId)
    const key = `${qlyHstkPhaseSheetKey(projectId)}:${code}`
    return ui.collapsed[key] === true
  }

  window.initQlyHstkTab = async function initQlyHstkTab(container, projectId, opts = {}) {
    const preserveScroll = opts.preserveScroll === true
    const hadContent =
      preserveScroll &&
      !!container.querySelector('.design-hstk-model-matrix, .border.rounded-xl.mb-4')
    const uiState = hadContent ? captureQlyHstkUiState(container) : null
    if (!hadContent) {
      container.innerHTML = `<div class="py-8 text-center text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>Đang tải QLy HSTK…</div>`
    }
    try {
      const phaseQ = qlyHstkPhaseQuery(projectId)
      const data = await api(`/projects/${projectId}/design?phase_id=${encodeURIComponent(phaseQ)}`)
      const ui = qlyHstkGetUi(projectId)
      if (data.phases?.length && !data.legacy_sheet && ui.activeSheet === 'legacy') {
        ui.activeSheet = data.phases[0].id
        return initQlyHstkTab(container, projectId, opts)
      }
      window._designPackageSuggestions = data.package_suggestions || {}
      renderQlyHstk(container, projectId, data)
      if (uiState) {
        restoreOpenScanLogPanels(uiState.openScanLogs)
        restoreQlyHstkUiState(uiState)
      }
      container._qlyHstkLoaded = true
    } catch (e) {
      container.innerHTML = `<div class="text-red-600 text-sm">Lỗi: ${escHtml(e.message)}</div>`
    }
  }

  function canConfigureDesignDisciplinesUi(data, projectId) {
    if (data?.can_configure_disciplines === true) return true
    if (data?.disciplines?.some(d => d.can_configure)) return true
    if (currentUser?.role === 'system_admin') return true
    const eff = typeof getEffectiveRoleForProject === 'function' ? getEffectiveRoleForProject(projectId) : null
    return eff === 'project_admin'
  }

  function hstkCompareBadge(flag) {
    if (flag === 'match_latest') return '<span class="text-green-700 whitespace-nowrap">Đúng HS mới nhất</span>'
    if (flag === 'match_old') return '<span class="text-amber-700 whitespace-nowrap">Chậm HS</span>'
    return '<span class="text-gray-500 whitespace-nowrap">Chưa khớp gói</span>'
  }

  function formatHstkCompareCell(row) {
    const ref = row.hstk_reference
    const badge = hstkCompareBadge(row.hstk_compare)
    if (ref) {
      return `<div class="leading-snug"><span class="text-gray-800">${escHtml(ref)}</span><div class="mt-0.5">${badge}</div></div>`
    }
    if (row.tasks?.length) return badge
    return '<span class="text-gray-500 whitespace-nowrap">Chưa đối chiếu</span>'
  }

  function formatIsoDateVi(iso) {
    if (!iso) return '—'
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (!m) return String(iso)
    return `${m[3]}/${m[2]}/${m[1]}`
  }

  function formatLatestPackageLabel(pkg) {
    if (!pkg) return '—'
    const label = pkg.description || pkg.folder_name || '—'
    return `${formatIsoDateVi(pkg.package_date)} — ${label}`
  }

  function formatTaskCreateDescriptionFromLatestPkg(pkg) {
    if (!pkg?.package_date) return ''
    const d = formatIsoDateVi(pkg.package_date)
    if (d === '—') return ''
    return `Cập nhật HS ${d}`
  }

  function matrixTasksForActiveSheet(tasks, projectId) {
    const list = tasks || []
    const sheet = qlyHstkGetUi(projectId).activeSheet
    if (sheet === 'legacy') {
      return list.filter(t => !String(t.phase ?? '').trim())
    }
    const phaseKey = qlyHstkActiveTaskPhaseKey(projectId)
    if (!phaseKey) return []
    return list.filter(t => String(t.phase ?? '').trim() === phaseKey)
  }

  function pickPrimaryMatrixTask(tasks) {
    if (!tasks?.length) return null
    return [...tasks].sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0))[0]
  }

  function formatDesignTaskCell(tasks) {
    if (!tasks?.length) return '<span class="text-gray-400">—</span>'
    return tasks
      .map(t => {
        const raw = String(t.title || '').trim()
        const title = raw ? escHtml(raw) : '<span class="text-gray-400">—</span>'
        if (t.id && raw) {
          return `<div class="leading-snug"><button type="button" class="text-primary underline text-left" onclick="openTaskModal(${t.id})">${title}</button></div>`
        }
        return `<div class="leading-snug">${title}</div>`
      })
      .join('')
  }

  function formatDesignAssigneeCell(row, projectId) {
    const sheetTasks = matrixTasksForActiveSheet(row.tasks, projectId)
    const name =
      (row.task_assignee_name && String(row.task_assignee_name).trim()) ||
      pickPrimaryMatrixTask(sheetTasks)?.assigned_to_name ||
      ''
    if (!name) return '<span class="text-gray-400">—</span>'
    return `<span class="text-gray-200 whitespace-nowrap">${escHtml(String(name).trim())}</span>`
  }

  function revMatrixSideLabel(v) {
    if (v == null || v === '') return '—'
    const s = String(v).trim()
    return s || '—'
  }

  function revisionMatrixCell(row) {
    const upd = revMatrixSideLabel(row.revision_updated)
    const cur = revMatrixSideLabel(row.revision_current)
    let html = `<span class="whitespace-nowrap">${escHtml(upd)} / ${escHtml(cur)}</span>`
    if ((row.revision_lag || 0) >= 1) {
      html += ` <span class="text-red-600 whitespace-nowrap">(chậm ${row.revision_lag})</span>`
    }
    return html
  }

  /** Same status labels as tab Tổng hợp CV (work summary). */
  function matrixCvStatusCell(status) {
    if (status == null || status === '') return '<span class="text-gray-400">—</span>'
    const cfg = {
      todo: { cls: 'bg-gray-700/80 text-gray-200', label: 'Chờ TH' },
      pending: { cls: 'bg-gray-700/80 text-gray-200', label: 'Chờ TH' },
      in_progress: { cls: 'bg-blue-900/50 text-blue-200', label: 'Đang TH' },
      review: { cls: 'bg-amber-900/40 text-amber-200', label: 'Duyệt' },
      completed: { cls: 'bg-green-900/40 text-green-200', label: 'Hoàn thành' },
      cancelled: { cls: 'bg-gray-800 text-gray-400', label: 'Huỷ' },
    }
    const c = cfg[status] || { cls: 'bg-gray-800 text-gray-300', label: status }
    return `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${c.cls}">${escHtml(c.label)}</span>`
  }

  function matrixCvProgressCell(pct) {
    if (pct == null) return '<span class="text-gray-400">—</span>'
    return `<span class="tabular-nums text-gray-200">${escHtml(String(pct))}%</span>`
  }

  function matrixCvCdeCell(flag) {
    if (flag == null) return '<span class="text-gray-400">—</span>'
    if (flag) {
      return '<span class="text-green-400 text-[10px] font-medium whitespace-nowrap">Đã tạo</span>'
    }
    return '<span class="text-gray-500 text-[10px] whitespace-nowrap">Chưa</span>'
  }

  function registerAssignRow(disciplineCode, row) {
    const rowKey = `${disciplineCode}__${row.model_id}`
    window._designAssignRows[rowKey] = { row, disciplineCode }
    return rowKey
  }

  const MODEL_MATRIX_COLGROUP =
    `<colgroup>
      <col style="width:142px">
      <col style="width:min(200px,18vw)">
      <col style="width:172px">
      <col style="width:min(280px,26vw)">
      <col style="width:100px">
      <col style="width:88px">
      <col style="width:72px">
      <col style="width:64px">
      <col style="width:min(176px,16vw)">
      <col style="width:72px">
    </colgroup>`

  const MODEL_MATRIX_TABLE_CLASS =
    'design-hstk-model-matrix w-full text-xs min-w-[1380px] bg-gray-950/90 rounded-lg overflow-hidden'

  function designTaskMatrixCell(projectId, rowKey, tasks, canAssign) {
    const phaseTasks = matrixTasksForActiveSheet(tasks, projectId)
    const assignBtn = canAssign
      ? `<button type="button" class="btn-primary text-[10px] px-2 py-0.5 whitespace-nowrap shrink-0 self-start" onclick="assignDesignTask(${projectId},'${rowKey}')"><i class="fas fa-user-plus mr-1"></i>Giao task</button>`
      : ''
    const taskHtml = phaseTasks.length ? formatDesignTaskCell(phaseTasks) : ''
    return `<div class="dh-task-cell">${taskHtml}${assignBtn}</div>`
  }

  function formatCategoryDossierStatusHtml(row) {
    const headline =
      row.category_latest_headline != null && String(row.category_latest_headline).trim()
        ? String(row.category_latest_headline).trim()
        : row.latest_package
          ? formatLatestPackageLabel(row.latest_package)
          : '—'
    const rev = row.revision_current || '—'
    const revChanges = row.category_revision_change_count ?? 0
    const pkgUpdated = row.category_package_updated_at || row.latest_package?.updated_at || null
    let html = `<div class="mt-1.5 space-y-0.5 text-[10px] leading-snug text-gray-400">
      <div><span class="text-gray-500">HSTK mới nhất:</span> ${escHtml(headline)}</div>
      <div class="font-semibold text-indigo-300/90">${escHtml(rev)} · ${revChanges} lần sửa đổi</div>`
    if (pkgUpdated) {
      html += `<div><span class="text-gray-500">Cập nhật gói:</span> ${escHtml(pkgUpdated)}</div>`
    }
    html += '</div>'
    return html
  }

  function categoryFolderPathCell(projectId, disciplineCode, row, canScan) {
    if (!row.category_id) return '<td class="py-1.5 px-2 text-xs text-gray-500 align-top">—</td>'
    const cid = row.category_id
    const fp = normalizeWindowsPath(row.category_folder_path || '')
    const dossierHtml = formatCategoryDossierStatusHtml(row)
    if (!canScan) {
      const pathBlock = fp
        ? `<a href="#" data-folder-path="${escHtml(fp)}" class="text-primary underline font-mono text-[10px] break-all" onclick="return designOpenFolder(event)">${escHtml(fp)}</a>`
        : '—'
      return `<td class="py-1.5 px-2 text-xs align-top"><div>${pathBlock}</div>${dossierHtml}</td>`
    }
    const inputId = `designCatFolder_${escHtml(disciplineCode)}_${cid}`
    const openLink = fp
      ? `<a href="#" data-folder-path="${escHtml(fp)}" class="text-primary text-[10px] whitespace-nowrap shrink-0 hover:underline" title="Mở folder trong Explorer" onclick="return designOpenFolder(event)"><i class="fas fa-folder-open mr-0.5"></i>Mở folder</a>`
      : ''
    return `<td class="py-1.5 px-2 text-xs align-top">
      <div class="flex items-center gap-1.5 flex-wrap min-w-[160px]">
        <input type="text" id="${inputId}" class="flex-1 min-w-[120px] text-[10px] border border-gray-600 rounded px-1.5 py-1 font-mono bg-gray-900 text-gray-100" placeholder="Z:\\DuAn\\…\\hạng mục" value="${escHtml(fp)}" title="Dán đường dẫn folder hạng mục trên NAS — Enter để lưu" onkeydown="designCategoryFolderInputKeydown(event,${projectId},'${escHtml(disciplineCode)}',${cid})" />
        ${openLink}
      </div>
      ${dossierHtml}
    </td>`
  }

  function modelMatrixHeadHtml() {
    return `<thead class="bg-gray-900 text-gray-300"><tr>
      <th class="text-left py-1.5 px-2 font-semibold">Hạng mục</th>
      <th class="text-left py-1.5 px-2 font-semibold">Đường dẫn folder</th>
      <th class="text-left py-1.5 px-2 font-semibold">Model</th>
      <th class="text-left py-1.5 px-2 font-semibold">Task</th>
      <th class="text-left py-1.5 px-2 font-semibold whitespace-nowrap">Người phụ trách</th>
      <th class="text-center py-1.5 px-2 font-semibold whitespace-nowrap">Trạng thái</th>
      <th class="text-center py-1.5 px-2 font-semibold whitespace-nowrap">% hoàn thành</th>
      <th class="text-center py-1.5 px-2 font-semibold whitespace-nowrap">BC CDE</th>
      <th class="text-left py-1.5 px-2 font-semibold">Đối chiếu HS</th>
      <th class="text-left py-1.5 px-1 font-semibold leading-tight max-w-[4.75rem]"><span class="block">Rev đã cập nhật /</span><span class="block">Hiện tại</span></th>
    </tr></thead>`
  }

  function renderModelMatrixRows(projectId, disciplineCode, rows, canAssign, canScan) {
    if (!rows?.length) return ''
    let body = ''
    for (const row of rows) {
      const rowKey = registerAssignRow(disciplineCode, row)
      const catLabel = row.category_code
        ? `${escHtml(row.category_code)} — ${escHtml(row.category_name || '')}`
        : '—'
      const codeFlag = row.project_code_mismatch
        ? ' <span class="text-amber-600 text-[10px]" title="Mã dự án trong tên khác mã dự án">Mã DA khác</span>'
        : ''
      body += `<tr class="border-b border-gray-700/50 hover:bg-gray-800/40">
        <td class="py-1.5 px-2 text-xs text-gray-200 align-top">${catLabel}</td>
        ${categoryFolderPathCell(projectId, disciplineCode, row, canScan)}
        <td class="py-1.5 px-2 text-xs font-mono text-gray-100 align-top dh-cell-wrap">${escHtml(row.model_name)}${codeFlag}</td>
        <td class="py-1.5 px-2 text-xs text-gray-300 align-top dh-cell-wrap">${designTaskMatrixCell(projectId, rowKey, row.tasks, canAssign)}</td>
        <td class="py-1.5 px-2 text-xs text-gray-300 align-top dh-cell-nowrap">${formatDesignAssigneeCell(row, projectId)}</td>
        <td class="py-1.5 px-2 text-xs text-center align-top dh-cell-nowrap">${matrixCvStatusCell(row.task_status)}</td>
        <td class="py-1.5 px-2 text-xs text-center align-top dh-cell-nowrap">${matrixCvProgressCell(row.task_progress_percent)}</td>
        <td class="py-1.5 px-2 text-xs text-center align-top dh-cell-nowrap">${matrixCvCdeCell(row.task_cde_report)}</td>
        <td class="py-1.5 px-2 text-xs text-gray-300 align-top dh-cell-wrap">${formatHstkCompareCell(row)}</td>
        <td class="py-1.5 px-2 text-xs text-gray-300 align-top dh-cell-nowrap">${revisionMatrixCell(row)}</td>
      </tr>`
    }
    return body
  }

  function renderDisciplineModelMatrix(d, projectId, canAssign) {
    const matrix = d.model_matrix || []
    const unassigned = d.unassigned_models || []
    if (!matrix.length && !unassigned.length) {
      return `<div class="px-4 py-3 text-xs text-gray-500 border-t border-gray-100">Chưa có model khớp bộ môn này (theo quy tắc tên BEP).</div>`
    }
    const head = modelMatrixHeadHtml()
    let html = `<div class="px-4 py-3 border-t border-gray-100 overflow-x-auto">
      <table class="${MODEL_MATRIX_TABLE_CLASS}">${MODEL_MATRIX_COLGROUP}${head}<tbody>`
    html += renderModelMatrixRows(projectId, d.discipline_code, matrix, canAssign, d.can_scan)
    html += `</tbody></table>`
    if (unassigned.length) {
      html += `<p class="text-xs font-semibold text-gray-600 mt-3 mb-1">Chưa gán hạng mục</p>
        <table class="${MODEL_MATRIX_TABLE_CLASS}">${MODEL_MATRIX_COLGROUP}${head}<tbody>`
      const pseudo = unassigned.map(u => ({
        model_id: u.model_id,
        model_name: u.name,
        category_id: null,
        category_code: null,
        category_name: null,
        project_code_mismatch: false,
        tasks: [],
        task_status: null,
        task_progress_percent: null,
        task_cde_report: null,
        task_assignee_name: null,
        hstk_compare: 'unmatched',
        hstk_reference: null,
        revision_updated: null,
        revision_current: d.current_revision,
        revision_lag: 0,
      }))
      html += renderModelMatrixRows(projectId, d.discipline_code, pseudo, canAssign, d.can_scan)
      html += `</tbody></table>`
    }
    html += `</div>`
    return html
  }

  function renderGlobalInvalidModels(invalidById) {
    if (!invalidById.size) return ''
    const rows = [...invalidById.values()]
    return `<div class="border border-amber-200 rounded-xl mb-4 p-4 bg-amber-50/50">
      <p class="text-sm font-bold text-amber-900 mb-2">Sai quy tắc đặt tên</p>
      <p class="text-xs text-amber-800 mb-2">Sửa tên trong thẻ <strong>Danh sách model</strong> trên trang dự án (cần ≥7 trường, trường 7 là số 4–6 chữ số).</p>
      <table class="w-full text-xs"><thead><tr><th class="text-left py-1">Tên file</th><th class="text-left py-1">Lý do</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="border-t border-amber-100"><td class="py-1 font-mono break-all">${escHtml(r.name)}</td><td class="py-1 text-gray-600">${escHtml(r.reason || 'invalid')}</td></tr>`).join('')}
      </tbody></table></div>`
  }

  window.refreshQlyHstkIfVisible = async function refreshQlyHstkIfVisible(projectId) {
    const panel = document.getElementById('projPanel-qlydesign')
    if (!panel || panel.style.display === 'none') return
    const c = document.getElementById(`qlyHstkContainer_${projectId}`)
    if (c) await initQlyHstkTab(c, projectId, { preserveScroll: true })
  }

  function renderQlyHstkPhaseSheets(projectId, data) {
    const ui = qlyHstkGetUi(projectId)
    const active = ui.activeSheet
    const tabs = []
    if (data.legacy_sheet || (!data.phases?.length && (data.disciplines?.length || active === 'legacy'))) {
      tabs.push({ id: 'legacy', label: data.phases?.length ? 'Hiện tại (dữ liệu cũ)' : 'Hiện tại' })
    }
    for (const p of data.phases || []) {
      const short = p.short_code || p.code
      tabs.push({ id: p.id, label: formatExecutionPhaseDisplayLabel(short, p.name) })
    }
    if (!tabs.length) return ''
    return `<div class="hstk-phase-sheets mb-3" role="tablist" aria-label="Giai đoạn QLy HSTK">
      ${tabs.map(t => {
        const sel = (t.id === 'legacy' && active === 'legacy') || t.id === active
        return `<button type="button" role="tab" aria-selected="${sel ? 'true' : 'false'}"
          class="hstk-phase-sheet${sel ? ' active' : ''}"
          onclick="qlyHstkSelectSheet(${projectId}, ${t.id === 'legacy' ? "'legacy'" : t.id})">${escHtml(t.label)}</button>`
      }).join('')}
    </div>`
  }

  function renderQlyHstkDiscFilter(projectId, disciplines) {
    const ui = qlyHstkGetUi(projectId)
    const active = ui.discFilter || 'all'
    const chips = [{ code: 'all', label: 'Tất cả' }].concat(
      (disciplines || []).map(d => ({ code: d.discipline_code, label: d.discipline_name || d.discipline_code })),
    )
    return `<div class="hstk-disc-filter mb-3 flex flex-wrap gap-1 items-center">
      <span class="text-xs text-gray-500 mr-1">Lọc bộ môn:</span>
      ${chips.map(c => {
        const sel = c.code === active
        return `<button type="button" class="hstk-disc-chip${sel ? ' active' : ''}"
          onclick="qlyHstkSetDiscFilter(${projectId}, '${escHtml(c.code)}')">${escHtml(c.label)}</button>`
      }).join('')}
    </div>`
  }

  function renderQlyHstk(container, projectId, data) {
    const canCfg = canConfigureDesignDisciplinesUi(data, projectId)
    const cfgBtns = canCfg
      ? `<button class="btn-secondary text-xs" onclick="openDesignPhaseConfig(${projectId})"><i class="fas fa-layer-group mr-1"></i>Khai báo giai đoạn</button>
         <button class="btn-secondary text-xs" onclick="openDesignDisciplineConfig(${projectId})"><i class="fas fa-cog mr-1"></i>Khai báo bộ môn</button>`
      : ''
    let html = `<div class="flex flex-wrap justify-between items-center gap-2 mb-4">
      <div>
        <h3 class="font-bold text-gray-800">QLy HSTK — quét folder NAS</h3>
        <p class="text-xs text-gray-500">Gốc NAS: ${escHtml(data.nas_root || '(chưa cấu hình nas_root_path)')}</p>
      </div>
      <div class="flex flex-wrap gap-2">${cfgBtns}</div>
    </div>`

    html += renderQlyHstkPhaseSheets(projectId, data)

    const ui = qlyHstkGetUi(projectId)
    const hasPhases = (data.phases || []).length > 0
    const onLegacy = ui.activeSheet === 'legacy'
    if (hasPhases && onLegacy && !data.legacy_sheet) {
      html += `<div class="text-sm text-gray-600 border border-dashed rounded-xl p-4 bg-gray-50 mb-3">
        <p>Chọn giai đoạn ở sheet phía trên để quản lý bộ môn và folder.</p>
      </div>`
      container.innerHTML = html
      window._lastDesignData = data
      return
    }

    if (!data.disciplines?.length) {
      html += `<div class="text-sm text-gray-600 border border-dashed rounded-xl p-4 bg-gray-50">
        <p class="mb-2">${hasPhases && !onLegacy ? 'Chưa khai báo bộ môn cho giai đoạn này.' : 'Chưa khai báo bộ môn — cần khai báo trước khi dán đường dẫn folder và quét.'}</p>
        ${canCfg && (!hasPhases || !onLegacy) ? `<button class="btn-primary text-xs" onclick="openDesignDisciplineConfig(${projectId})"><i class="fas fa-plus mr-1"></i>Khai báo bộ môn</button>` : ''}
        ${canCfg && hasPhases && onLegacy ? `<button class="btn-secondary text-xs" onclick="openDesignPhaseConfig(${projectId})"><i class="fas fa-layer-group mr-1"></i>Khai báo giai đoạn</button>` : ''}
      </div>`
      container.innerHTML = html
      window._lastDesignData = data
      return
    }

    html += renderQlyHstkDiscFilter(projectId, data.disciplines)

    window._designAssignRows = {}
    const canAssign = canAssignDesignTask(projectId)
    const globalInvalid = new Map()
    const discFilter = ui.discFilter || 'all'
    const phaseKey = qlyHstkPhaseSheetKey(projectId)

    for (const d of data.disciplines) {
      if (discFilter !== 'all' && d.discipline_code !== discFilter) continue
      for (const inv of d.invalid_names || []) {
        if (!globalInvalid.has(inv.model_id)) globalInvalid.set(inv.model_id, inv)
      }
      const collapsed = qlyHstkDiscCollapsed(projectId, d.discipline_code)
      const headline = formatLatestPackageLabel(d.latest_package)
      const collapseBtn = `<button type="button" class="text-gray-500 hover:text-primary mr-2" title="${collapsed ? 'Mở rộng' : 'Thu nhỏ'}" onclick="qlyHstkToggleDiscCollapse(${projectId},'${escHtml(d.discipline_code)}')"><i class="fas fa-chevron-${collapsed ? 'right' : 'down'}"></i></button>`
      const bulkFolderInput =
        !collapsed && d.can_scan
          ? renderDisciplineBulkFolderInput(projectId, d.discipline_code, d.model_matrix, d.can_scan)
          : ''
      html += `<div class="border rounded-xl mb-4 overflow-hidden hstk-disc-block" data-disc="${escHtml(d.discipline_code)}">
        <div class="bg-gray-50 dark:bg-gray-900/40 px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
          <div class="min-w-0 flex-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            <div class="font-bold text-sm flex items-start gap-1 shrink-0">${collapseBtn}
              <span>${escHtml(d.discipline_name || d.discipline_code)} <span class="text-gray-400 font-normal">(${escHtml(d.discipline_code)})</span></span>
            </div>
            ${bulkFolderInput}
            ${collapsed ? `<p class="text-xs text-gray-600 mt-1 ml-6 w-full">HSTK mới nhất: ${escHtml(headline)}</p>` : ''}
          </div>
          <div class="flex flex-wrap gap-2">
            ${d.can_scan ? `<button class="btn-secondary text-xs" onclick="designRescan(${projectId},'${escHtml(d.discipline_code)}')"><i class="fas fa-sync mr-1"></i>Quét lại</button>` : ''}
            <button class="btn-secondary text-xs" onclick="toggleDesignScanLog('${phaseKey}','${d.discipline_code}')"><i class="fas fa-history mr-1"></i>Lịch sử quét</button>
          </div>
        </div>
        <div id="scanLog_${phaseKey}_${d.discipline_code}" class="hidden px-4 pb-3 text-xs"></div>
        ${collapsed ? '' : renderDisciplineModelMatrix(d, projectId, canAssign)}</div>`
    }

    html += renderGlobalInvalidModels(globalInvalid)

    container.innerHTML = html
    window._lastDesignData = data
  }

  window.toggleDesignScanLog = function (phaseKey, code) {
    const el = document.getElementById(`scanLog_${phaseKey}_${code}`)
    if (!el || !window._lastDesignData) return
    if (!el.classList.contains('hidden')) {
      el.classList.add('hidden')
      return
    }
    repaintScanLogPanel(phaseKey, code)
    el.classList.remove('hidden')
  }

  window.designCategoryFolderInputKeydown = function (ev, projectId, code, categoryId) {
    if (ev.key !== 'Enter' || ev.isComposing) return
    ev.preventDefault()
    void designSaveCategoryFolderPath(projectId, code, categoryId)
  }

  window.designSaveCategoryFolderPath = async function (projectId, code, categoryId) {
    const input = document.getElementById(`designCatFolder_${code}_${categoryId}`)
    const path = normalizeWindowsPath((input?.value ?? '').trim())
    const disc = window._lastDesignData?.disciplines?.find(d => d.discipline_code === code)
    const matrixRow = disc?.model_matrix?.find(r => r.category_id === categoryId)
    const prevPath = normalizeWindowsPath(matrixRow?.category_folder_path || '')
    const pathChanged = path !== prevPath
    try {
      const phaseQ = encodeURIComponent(qlyHstkPhaseQuery(projectId))
      await api(
        `/projects/${projectId}/design/disciplines/${encodeURIComponent(code)}/categories/${categoryId}/folder-path?phase_id=${phaseQ}`,
        { method: 'put', data: { folder_path: path || null } },
      )
      toast(path ? 'Đã lưu đường dẫn hạng mục' : 'Đã xóa đường dẫn hạng mục', 'success')
      const c = document.getElementById(`qlyHstkContainer_${projectId}`)
      if (path && pathChanged) await designScanSavedPath(projectId, code, path, { quiet: false })
      if (c) await initQlyHstkTab(c, projectId, { preserveScroll: true })
    } catch (e) {
      toast(e.response?.data?.error || e.message, 'error')
    }
  }

  function disciplineCommonCategoryFolderPath(matrix) {
    const byCat = new Map()
    for (const row of matrix || []) {
      if (!row.category_id) continue
      if (byCat.has(row.category_id)) continue
      byCat.set(row.category_id, normalizeWindowsPath(row.category_folder_path || ''))
    }
    if (byCat.size === 0) return ''
    const paths = [...byCat.values()]
    const first = paths[0]
    for (const p of paths) {
      if (p !== first) return ''
    }
    return first
  }

  function categoryIdsForDisciplineBulkPath(matrix, newPath) {
    const target = normalizeWindowsPath(newPath)
    const byCat = new Map()
    for (const row of matrix || []) {
      if (!row.category_id) continue
      if (byCat.has(row.category_id)) continue
      byCat.set(row.category_id, normalizeWindowsPath(row.category_folder_path || ''))
    }
    const ids = []
    for (const [catId, prev] of byCat) {
      if (prev !== target) ids.push(catId)
    }
    return ids
  }

  function renderDisciplineBulkFolderInput(projectId, disciplineCode, matrix, canScan) {
    if (!canScan) return ''
    const common = disciplineCommonCategoryFolderPath(matrix)
    const inputId = `designDiscBulkFolder_${disciplineCode}`
    return `<input type="text" id="${inputId}" class="hstk-disc-bulk-folder-input flex-1 min-w-[200px] max-w-xl text-[11px] border border-gray-600 rounded px-2 py-1 font-mono bg-gray-900 text-gray-100" placeholder="Đường dẫn chung mọi hạng mục" value="${escHtml(common)}" title="Áp dụng cho mọi hạng mục trên sheet này — Enter để lưu" onkeydown="designDiscBulkFolderInputKeydown(event,${projectId},'${escHtml(disciplineCode)}')" />`
  }

  window.designDiscBulkFolderInputKeydown = function (ev, projectId, code) {
    if (ev.key !== 'Enter' || ev.isComposing) return
    ev.preventDefault()
    void designSaveDisciplineBulkCategoryFolderPath(projectId, code)
  }

  window.designSaveDisciplineBulkCategoryFolderPath = async function (projectId, code) {
    const input = document.getElementById(`designDiscBulkFolder_${code}`)
    const path = normalizeWindowsPath((input?.value ?? '').trim())
    const disc = window._lastDesignData?.disciplines?.find(d => d.discipline_code === code)
    const matrix = disc?.model_matrix || []
    const categoryIds = categoryIdsForDisciplineBulkPath(matrix, path)
    if (!categoryIds.length) {
      toast(path ? 'Đường dẫn đã đúng cho mọi hạng mục' : 'Không có hạng mục để cập nhật', 'info')
      return
    }
    const willChange = categoryIds.length
    try {
      const phaseQ = encodeURIComponent(qlyHstkPhaseQuery(projectId))
      await api(
        `/projects/${projectId}/design/disciplines/${encodeURIComponent(code)}/category-folder-paths?phase_id=${phaseQ}`,
        { method: 'put', data: { folder_path: path || null, category_ids: categoryIds } },
      )
      toast(path ? 'Đã lưu đường dẫn chung cho mọi hạng mục' : 'Đã xóa đường dẫn chung', 'success')
      const c = document.getElementById(`qlyHstkContainer_${projectId}`)
      if (path && willChange) await designScanSavedPath(projectId, code, path, { quiet: false })
      if (c) await initQlyHstkTab(c, projectId, { preserveScroll: true })
    } catch (e) {
      toast(e.response?.data?.error || e.message, 'error')
    }
  }

  function uniqueCategoryPathsForDiscipline(code) {
    const d = window._lastDesignData?.disciplines?.find(x => x.discipline_code === code)
    const seen = new Set()
    const paths = []
    for (const row of d?.model_matrix || []) {
      const input = document.getElementById(`designCatFolder_${code}_${row.category_id}`)
      const fromInput = (input?.value ?? '').trim()
      const p = normalizeWindowsPath(fromInput || row.category_folder_path || '')
      if (!p || seen.has(p)) continue
      seen.add(p)
      paths.push(p)
    }
    return paths
  }

  window.designRescan = async function (projectId, code) {
    const paths = uniqueCategoryPathsForDiscipline(code)
    if (!paths.length) {
      toast('Dán và lưu đường dẫn ít nhất một hạng mục trước', 'warning')
      return
    }
    let anyOk = false
    for (const path of paths) {
      const r = await designScanSavedPath(projectId, code, path, { quiet: paths.length > 1 })
      if (r.ok) anyOk = true
    }
    if (anyOk) {
      const c = document.getElementById(`qlyHstkContainer_${projectId}`)
      if (c) await initQlyHstkTab(c, projectId, { preserveScroll: true })
    }
  }

  function canAssignDesignTask(projectId) {
    if (['system_admin', 'project_admin', 'project_leader'].includes(currentUser?.role)) return true
    const eff = typeof getEffectiveRoleForProject === 'function' ? getEffectiveRoleForProject(projectId) : 'member'
    return eff === 'project_admin' || eff === 'project_leader'
  }

  window.updateDesignPackage = async function (projectId, pkgId, field, value) {
    try {
      await api(`/projects/${projectId}/design/packages/${pkgId}`, { method: 'put', data: { [field]: value } })
      toast('Đã lưu gói HSTK', 'success')
    } catch (e) {
      toast(e.response?.data?.error || e.message, 'error')
    }
  }

  window.assignDesignTask = async function (projectId, rowKey) {
    const bundle = window._designAssignRows?.[rowKey]
    if (!bundle) return
    const row = bundle.row
    const disciplineCode = bundle.disciplineCode
    const pkgs = window._designPackageSuggestions?.[disciplineCode] || []
    const disc = window._lastDesignData?.disciplines?.find(x => x.discipline_code === disciplineCode)
    const latest = row.latest_package || disc?.latest_package || null
    window._taskFromQlyHstk = true
    window._taskDesignPackageId = latest?.id || null
    window._taskDesignPackageName = latest?.folder_name || ''
    await openTaskModal(null, projectId)
    if (typeof _cbSetValue === 'function') _cbSetValue('taskDisciplineCombobox', disciplineCode)
    if ($('taskDiscipline')) $('taskDiscipline').value = disciplineCode
    if ($('taskType')) {
      $('taskType').value = row.default_task_type || 'model'
      if (typeof updateTaskTypeUI === 'function') updateTaskTypeUI()
    }
    if (typeof _loadAndInitTaskCategoryCombobox === 'function') {
      await _loadAndInitTaskCategoryCombobox(projectId, row.category_id || null, false)
    } else if ($('taskCategory') && row.category_id) {
      $('taskCategory').value = row.category_id
    }
    if (typeof _loadAndInitTaskFilenameCombobox === 'function') {
      await _loadAndInitTaskFilenameCombobox(projectId, row.model_name || '')
    } else if ($('taskFilename')) {
      $('taskFilename').value = row.model_name || ''
    }
    const hid = document.getElementById('taskDesignPackageId')
    if (hid) hid.value = window._taskDesignPackageId || ''
    if (latest?.folder_name && $('taskHstkDate')) $('taskHstkDate').value = latest.folder_name
    if ($('taskDesc')) {
      $('taskDesc').value = formatTaskCreateDescriptionFromLatestPkg(latest)
    }
    populateHstkDatalist(disciplineCode)
    applyHstkRequiredUi()
    const phaseKey = qlyHstkActiveTaskPhaseKey(projectId)
    if (phaseKey && $('taskPhase')) $('taskPhase').value = phaseKey
    if (typeof syncTaskTitle === 'function') syncTaskTitle()
  }

  function populateHstkDatalist(disciplineCode) {
    const dl = document.getElementById('taskHstkPackagesList')
    if (!dl) return
    const pkgs = window._designPackageSuggestions?.[disciplineCode] || []
    dl.innerHTML = pkgs.map(p => `<option value="${escHtml(p.folder_name)}">${escHtml(p.label)} — ${escHtml(p.folder_name)}</option>`).join('')
  }

  window.openDesignPhaseConfig = async function (projectId) {
    const phaseQ = qlyHstkPhaseQuery(projectId)
    const cur = await api(`/projects/${projectId}/design?phase_id=${encodeURIComponent(phaseQ)}`)
    const catalog = qlyHstkExecutionPhaseCatalog(cur)
    const selected = new Set((cur.phases || []).map(p => p.execution_phase_key || p.code).filter(Boolean))
    const modalId = `designPhaseModal_${projectId}`
    let old = document.getElementById(modalId)
    if (old) old.remove()
    const checkHtml = catalog
      .map(
        def => `<label class="flex items-start gap-2 py-2 border-b border-gray-100 cursor-pointer design-phase-check">
      <input type="checkbox" class="mt-1 design-phase-key" value="${escHtml(def.key)}" ${selected.has(def.key) ? 'checked' : ''} />
      <span class="font-medium text-sm text-gray-800">${escHtml(formatExecutionPhaseDisplayLabel(def.short_code, def.name))}</span></span>
    </label>`,
      )
      .join('')
    const wrap = document.createElement('div')
    wrap.id = modalId
    wrap.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4'
    wrap.innerHTML = `<div class="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-4">
      <h4 class="font-bold text-gray-800 mb-1">Khai báo giai đoạn</h4>
      <p class="text-xs text-gray-500 mb-3">Chọn giai đoạn thực hiện (cùng danh mục với task). Mỗi giai đoạn là một sheet QLy HSTK. Lần lưu đầu sẽ gắn bộ môn hiện có vào giai đoạn đầu tiên đã chọn.</p>
      <div id="${modalId}_rows" class="mb-2">${checkHtml}</div>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary text-xs" id="${modalId}_cancel">Hủy</button>
        <button type="button" class="btn-primary text-xs" id="${modalId}_save">Lưu</button>
      </div>
    </div>`
    document.body.appendChild(wrap)
    wrap.querySelector(`#${modalId}_cancel`)?.addEventListener('click', () => wrap.remove())
    wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove() })
    wrap.querySelector(`#${modalId}_save`)?.addEventListener('click', async () => {
      const payload = []
      wrap.querySelectorAll('.design-phase-key:checked').forEach(inp => {
        payload.push({ execution_phase_key: inp.value })
      })
      if (!payload.length) {
        toast('Chọn ít nhất một giai đoạn', 'warning')
        return
      }
      try {
        await api(`/projects/${projectId}/design/phases?phase_id=${encodeURIComponent(phaseQ)}`, {
          method: 'put',
          data: { phases: payload },
        })
        toast('Đã lưu giai đoạn', 'success')
        wrap.remove()
        const c = document.getElementById(`qlyHstkContainer_${projectId}`)
        if (c) await initQlyHstkTab(c, projectId, { preserveScroll: true })
      } catch (e) {
        toast(e.response?.data?.error || e.message, 'error')
      }
    })
  }

  window.openDesignDisciplineConfig = async function (projectId) {
    const ui = qlyHstkGetUi(projectId)
    const phaseQ = qlyHstkPhaseQuery(projectId)
    if (ui.activeSheet === 'legacy' && window._lastDesignData?.phases?.length && !window._lastDesignData?.legacy_sheet) {
      toast('Chọn giai đoạn trước khi khai báo bộ môn', 'warning')
      return
    }
    const phaseId = qlyHstkActivePhaseId(projectId)
    const discs = await api('/disciplines')
    const cur = await api(`/projects/${projectId}/design?phase_id=${encodeURIComponent(phaseQ)}`)
    let members = window._currentProjectDetailId === projectId ? window._currentProjectDetailMembers : null
    if (!members?.length) {
      try {
        const proj = await api(`/projects/${projectId}`)
        members = proj.members || []
        if (window._currentProjectDetailId === projectId) window._currentProjectDetailMembers = members
      } catch (_) { members = [] }
    }
    members = members || []
    function leaderSelectHtml(code, leaderId) {
      const lid = leaderId != null ? String(leaderId) : ''
      const opts = members.map(m => {
        const uid = String(m.user_id)
        const sel = uid === lid ? ' selected' : ''
        return `<option value="${uid}"${sel}>${escHtml(m.full_name || m.name || '')}</option>`
      }).join('')
      return `<select class="select-field text-xs design-disc-leader w-44" data-code="${escHtml(code)}" title="Leader bộ môn (tùy chọn)"><option value="">— Leader (tùy chọn) —</option>${opts}</select>`
    }
    const existing = new Map((cur.disciplines || []).map(d => [d.discipline_code, d]))
    const modalId = `designDiscModal_${projectId}`
    let old = document.getElementById(modalId)
    if (old) old.remove()
    const rows = discs.map(d => {
      const ex = existing.get(d.code)
      const checked = ex ? 'checked' : ''
      const roleCodes = escHtml(ex?.role_codes || d.code)
      return `<label class="flex flex-wrap items-center gap-2 py-2 border-b border-gray-100 design-disc-row" data-code="${escHtml(d.code)}">
        <input type="checkbox" class="design-disc-pick" value="${escHtml(d.code)}" ${checked} />
        <span class="font-semibold text-sm w-20">${escHtml(d.code)}</span>
        <span class="text-sm text-gray-700 flex-1 min-w-[8rem]">${escHtml(d.name)}</span>
        <input type="text" class="input-field text-xs design-disc-roles w-36 font-mono" data-code="${escHtml(d.code)}" value="${roleCodes}" title="Mã BEP (Vai trò/Bộ môn), cách nhau dấu phẩy — vd HVAC,EM hoặc AA,A" placeholder="${escHtml(d.code)}" />
        ${leaderSelectHtml(d.code, ex?.leader_id)}
      </label>`
    }).join('')
    const wrap = document.createElement('div')
    wrap.id = modalId
    wrap.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4'
    wrap.innerHTML = `<div class="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-4">
      <h4 class="font-bold text-gray-800 mb-1">Khai báo bộ môn HSTK</h4>
      <p class="text-xs text-gray-500 mb-3">Chọn bộ môn (danh mục hệ thống). Cột <strong>role_codes</strong>: mã BEP khớp file model (vd <code>HVAC,EM</code>, <code>AA,A</code>). Gán leader tùy chọn.</p>
      <div class="mb-4">${rows || '<p class="text-sm text-gray-500">Chưa có danh mục bộ môn hệ thống.</p>'}</div>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary text-xs" id="${modalId}_cancel">Hủy</button>
        <button type="button" class="btn-primary text-xs" id="${modalId}_save">Lưu</button>
      </div>
    </div>`
    document.body.appendChild(wrap)
    wrap.querySelector(`#${modalId}_cancel`)?.addEventListener('click', () => wrap.remove())
    wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove() })
    wrap.querySelector(`#${modalId}_save`)?.addEventListener('click', async () => {
      const payload = []
      wrap.querySelectorAll('.design-disc-pick:checked').forEach(cb => {
        const code = cb.value
        const leadEl = wrap.querySelector(`.design-disc-leader[data-code="${CSS.escape(code)}"]`)
        const rolesEl = wrap.querySelector(`.design-disc-roles[data-code="${CSS.escape(code)}"]`)
        const leaderRaw = leadEl?.value?.trim()
        const roleRaw = (rolesEl?.value ?? code).trim() || code
        payload.push({
          discipline_code: code,
          role_codes: roleRaw,
          leader_id: leaderRaw ? parseInt(leaderRaw, 10) || null : null,
        })
      })
      if (!payload.length) {
        toast('Chọn ít nhất một bộ môn', 'warning')
        return
      }
      try {
        await api(`/projects/${projectId}/design/disciplines?phase_id=${encodeURIComponent(phaseQ)}`, {
          method: 'put',
          data: { disciplines: payload, phase_id: phaseId },
        })
        toast('Đã lưu bộ môn', 'success')
        wrap.remove()
        const c = document.getElementById(`qlyHstkContainer_${projectId}`)
        if (c) await initQlyHstkTab(c, projectId, { preserveScroll: true })
      } catch (e) {
        toast(e.response?.data?.error || e.message, 'error')
      }
    })
  }

  window._pdState = window._pdState || { tab: 'project', selectedProjectId: null }
  window._pdLastData = window._pdLastData || null
  window._pdProjectSearch = window._pdProjectSearch || ''
  window._pdProjectStatusFilter = window._pdProjectStatusFilter || 'all'

  const PD_PROJECT_STATUS_CHIPS = [
    { id: 'all', label: 'Tất cả' },
    { id: 'active', label: 'Đang làm' },
    { id: 'on_hold', label: 'Tạm dừng' },
    { id: 'completed', label: 'HT' },
  ]

  function pdFoldText(s) {
    if (typeof _foldVn === 'function') return _foldVn(s)
    return String(s || '').toLowerCase()
  }

  function pdProjectMatchesStatusChip(p) {
    const chip = window._pdProjectStatusFilter || 'all'
    if (chip === 'all') return true
    const status = String(p.status || 'active').toLowerCase()
    if (chip === 'active') return status === 'active'
    if (chip === 'completed') return status === 'completed'
    if (chip === 'on_hold') return status === 'on_hold'
    return true
  }

  function pdFilteredProjects(projects) {
    const q = pdFoldText(window._pdProjectSearch)
    return (projects || []).filter(p => {
      if (!pdProjectMatchesStatusChip(p)) return false
      if (q) {
        const hay = pdFoldText(`${p.code || ''} ${p.name || ''}`)
        if (!hay.includes(q)) return false
      }
      return true
    })
  }

  function pdRenderProjectStatusChips() {
    const host = document.getElementById('pdProjectStatusChips')
    if (!host) return
    const active = window._pdProjectStatusFilter || 'all'
    host.innerHTML = PD_PROJECT_STATUS_CHIPS.map(chip => {
      const sel = chip.id === active
      return `<button type="button" role="tab" aria-selected="${sel ? 'true' : 'false'}"
        class="pd-project-status-chip${sel ? ' active' : ''}"
        onclick="pdOnProjectStatusFilter('${chip.id}')">${escHtml(chip.label)}</button>`
    }).join('')
  }

  function pdListToolbarHtml() {
    const q = escHtml(window._pdProjectSearch || '')
    return `<div class="pd-list-toolbar">
      <input type="text" id="pdProjectSearch" class="input-field" placeholder="🔍 Tìm dự án…" value="${q}" oninput="pdOnProjectSearch(this.value)" autocomplete="off">
      <div id="pdProjectStatusChips" class="pd-project-status-chips" role="tablist" aria-label="Lọc trạng thái dự án"></div>
    </div>`
  }

  function pdApplyClientFilters() {
    const root = document.getElementById('projectDashboardRoot')
    if (!root || !window._pdLastData) return
    const tab = window._pdState?.tab || 'project'
    const memberId = tab === 'member' ? (document.getElementById('pdMemberFilter')?.value || '') : ''
    if (tab === 'member' && !memberId) return

    const allProjects = window._pdLastData.projects || []
    const filtered = pdFilteredProjects(allProjects)
    let selId = window._pdState.selectedProjectId
    if (!filtered.some(p => p.id === selId)) {
      selId = filtered.length ? filtered[0].id : null
      window._pdState.selectedProjectId = selId
    }

    const listItemsEl = root.querySelector('.pd-list-items')
    const detailEl = root.querySelector('.pd-project-detail')
    const listScroll = listItemsEl ? listItemsEl.scrollTop : 0

    if (listItemsEl) {
      listItemsEl.innerHTML = filtered.length
        ? filtered.map(p => renderProjectListItem(p, selId)).join('')
        : '<p class="pd-empty-hint text-xs">Không có dự án phù hợp bộ lọc.</p>'
      listItemsEl.scrollTop = listScroll
    }

    pdRenderProjectStatusChips()

    if (detailEl) {
      const workloadHtml = tab === 'member' && window._pdLastData.workload ? renderMemberWorkloadBanner(window._pdLastData.workload) : ''
      if (!selId || !filtered.length) {
        detailEl.innerHTML = `${workloadHtml}<div class="pd-empty-hint">Chọn dự án ở danh sách bên trái.</div>`
      } else {
        const selected = filtered.find(p => p.id === selId) || filtered[0]
        detailEl.innerHTML = renderProjectDetailPanel(selected, workloadHtml)
      }
    }

    if (selId) {
      const proj = allProjects.find(p => p.id === selId)
      if (proj && !proj.detail_loaded) void loadProjectDashboardDetail(selId)
    }
  }

  window.pdOnProjectSearch = function pdOnProjectSearch(q) {
    window._pdProjectSearch = (q || '').trim()
    pdApplyClientFilters()
  }

  window.pdOnProjectStatusFilter = function pdOnProjectStatusFilter(chipId) {
    const next = chipId || 'all'
    if (window._pdProjectStatusFilter === next) return
    window._pdProjectStatusFilter = next
    pdApplyClientFilters()
  }

  window.setProjectDashboardTab = function setProjectDashboardTab(tab) {
    const canStatus = currentUser?.role === 'system_admin'
    const next = tab === 'member' ? 'member' : (tab === 'status' && canStatus ? 'status' : 'project')
    window._pdState.tab = next
    const wrap = document.getElementById('pdMemberFilterWrap')
    const root = document.getElementById('projectDashboardRoot')
    const statusPanel = document.getElementById('pdStatusPanel')
    const stuck = document.getElementById('pdStuckOnlyWrap')
    const statusBtn = document.getElementById('pdTabStatus')
    if (wrap) wrap.classList.toggle('hidden', next !== 'member')
    if (root) root.classList.toggle('hidden', next === 'status')
    if (statusPanel) statusPanel.classList.toggle('hidden', next !== 'status')
    if (stuck) stuck.classList.toggle('hidden', next === 'status')
    if (statusBtn) statusBtn.classList.toggle('hidden', !canStatus)
    ;[['pdTabProject', 'project'], ['pdTabMember', 'member'], ['pdTabStatus', 'status']].forEach(([id, name]) => {
      const btn = document.getElementById(id)
      if (!btn) return
      const on = next === name
      btn.classList.toggle('pd-tab-active', on)
      btn.setAttribute('aria-selected', on ? 'true' : 'false')
    })
    if (next === 'status') {
      if (typeof loadWeeklyReportConfig === 'function') loadWeeklyReportConfig()
      if (typeof loadZaloOverdueConfig === 'function') loadZaloOverdueConfig()
      return
    }
    if (typeof loadProjectDashboardPage === 'function') loadProjectDashboardPage()
  }

  function projectDashboardQueryParams() {
    const tab = window._pdState?.tab || 'project'
    const memberId = tab === 'member' ? (document.getElementById('pdMemberFilter')?.value || '') : ''
    const stuck = document.getElementById('pdStuckOnly')?.checked ? '1' : ''
    const q = new URLSearchParams()
    if (memberId) q.set('member_id', memberId)
    if (stuck) q.set('stuck', stuck)
    return q
  }

  function mergeProjectDashboardDetail(projectId, detail) {
    if (!window._pdLastData?.projects) return
    const idx = window._pdLastData.projects.findIndex(p => p.id === projectId)
    if (idx >= 0) {
      window._pdLastData.projects[idx] = { ...window._pdLastData.projects[idx], ...detail, detail_loaded: true }
    }
  }

  window._pdDetailLoading = window._pdDetailLoading || null

  async function loadProjectDashboardDetail(projectId) {
    const root = document.getElementById('projectDashboardRoot')
    if (!root || !projectId) return
    const detailEl = root.querySelector('.pd-project-detail')
    if (detailEl) {
      detailEl.innerHTML = `<div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin"></i> Đang tải chi tiết…</div>`
    }
    const q = projectDashboardQueryParams()
    q.set('project_id', String(projectId))
    const reqId = (window._pdDetailLoading = Symbol('pd-detail'))
    try {
      const data = await api(`/project-dashboard?${q.toString()}`)
      if (window._pdDetailLoading !== reqId) return
      if (data.project) {
        mergeProjectDashboardDetail(projectId, data.project)
        const listEl = root.querySelector('.pd-list-items') || root.querySelector('.pd-project-list')
        const listScroll = listEl ? listEl.scrollTop : 0
        renderProjectDashboard(root, window._pdLastData, { preserveListScroll: listScroll })
      }
    } catch (e) {
      if (window._pdDetailLoading !== reqId) return
      if (detailEl) {
        detailEl.innerHTML = `<p class="text-red-600 text-sm p-4">Không tải được chi tiết dự án: ${escHtml(e.message)}</p>`
      }
    }
  }

  window.selectProjectDashboard = function selectProjectDashboard(projectId) {
    const root = document.getElementById('projectDashboardRoot')
    const listEl = root?.querySelector('.pd-list-items') || root?.querySelector('.pd-project-list')
    const listScroll = listEl ? listEl.scrollTop : 0
    window._pdState.selectedProjectId = projectId
    if (window._pdLastData && root) {
      renderProjectDashboard(root, window._pdLastData, { preserveListScroll: listScroll })
      const proj = window._pdLastData.projects?.find(p => p.id === projectId)
      if (!proj?.detail_loaded) void loadProjectDashboardDetail(projectId)
    }
  }

  window.loadProjectDashboardPage = async function loadProjectDashboardPage() {
    const root = document.getElementById('projectDashboardRoot')
    if (!root) return
    root.innerHTML = `<div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin"></i> Đang tải…</div>`
    const q = projectDashboardQueryParams()
    try {
      const data = await api(`/project-dashboard?${q.toString()}`)
      window._pdLastData = data
      renderProjectDashboard(root, data)
      const selId = window._pdState.selectedProjectId
      if (selId) void loadProjectDashboardDetail(selId)
    } catch (e) {
      window._pdLastData = null
      root.innerHTML = `<p class="text-red-600">${escHtml(e.message)}</p>`
    }
  }

  const PD_TASK_STATUS = {
    todo: 'Chờ làm',
    in_progress: 'Đang làm',
    review: 'Review',
    completed: 'Hoàn thành',
    cancelled: 'Đã hủy',
  }

  function countCategoryMatrixByStatus(p, status) {
    const matrix = p.category_matrix || {}
    let n = 0
    for (const cat of Object.keys(matrix)) {
      for (const dc of Object.keys(matrix[cat] || {})) {
        if (matrix[cat][dc]?.status === status) n += 1
      }
    }
    return n
  }

  function formatHstkHeadline(lh) {
    if (!lh) return '—'
    const parts = [lh.package_date, lh.description || lh.folder_name].filter(Boolean)
    return parts.join(' · ') || lh.folder_name || '—'
  }

  function renderMatrixRevCell(cell) {
    if (!cell) return '<td class="pd-matrix-cell text-gray-400">—</td>'
    const up = cell.revision_updated || '—'
    const cur = cell.revision_current || '—'
    if (up === '—' && cur === '—') return '<td class="pd-matrix-cell text-gray-400">—</td>'
    const match = up !== '—' && cur !== '—' && up === cur
    const lag = cell.status === 'lagging'
    const pillClass = match ? 'pd-rev-ok' : (lag ? 'pd-rev-warn' : '')
    const bar = match ? '<span class="pd-rev-bar" title="Revision khớp"></span>' : ''
    return `<td class="pd-matrix-cell"><span class="pd-rev-pill ${pillClass}">${bar}${escHtml(up)} / ${escHtml(cur)}</span></td>`
  }

  function renderCategoryMatrix(p) {
    const matrix = p.category_matrix || {}
    const catCodes = Object.keys(matrix).sort()
    const discCodes = catCodes.length
      ? [...new Set(catCodes.flatMap(c => Object.keys(matrix[c] || {})))].sort()
      : []
    if (!catCodes.length || !discCodes.length) {
      return `<p class="pd-section-title">Hạng mục × bộ môn (rev đã cập nhật / hiện tại)</p><p class="pd-empty-hint text-sm">Chưa có dữ liệu ma trận hạng mục.</p>`
    }
    let tbl = '<table class="pd-table pd-matrix"><thead><tr><th>Hạng mục</th>'
    for (const dc of discCodes) tbl += `<th class="font-mono">${escHtml(dc)}</th>`
    tbl += '</tr></thead><tbody>'
    for (const cat of catCodes) {
      tbl += `<tr><td class="font-semibold">${escHtml(cat)}</td>`
      for (const dc of discCodes) tbl += renderMatrixRevCell(matrix[cat]?.[dc])
      tbl += '</tr>'
    }
    tbl += '</tbody></table>'
    return `<p class="pd-section-title">Hạng mục × bộ môn (rev đã cập nhật / hiện tại)</p><div class="pd-table-wrap">${tbl}</div>`
  }

  function renderRecentHstkPackages(p) {
    const discs = p.disciplines || []
    let timelineRows = ''
    for (const d of discs) {
      const pkgs = (d.packages_timeline || []).slice(0, 3)
      if (!pkgs.length) continue
      timelineRows += `<tr><td class="font-mono font-semibold align-top">${escHtml(d.discipline_code)}</td><td colspan="5" class="text-xs">`
      timelineRows += pkgs.map(pkg => {
        const line = [pkg.package_date, pkg.revision, pkg.folder_name, pkg.review_status ? HSTK_REVIEW[pkg.review_status] || pkg.review_status : ''].filter(Boolean).join(' · ')
        const folderLink = pkg.open_path
          ? ` <a href="#" data-folder-path="${escHtml(normalizeWindowsPath(pkg.open_path))}" class="text-primary" onclick="return designOpenFolder(event)">Mở folder</a>`
          : ''
        return `<div class="py-0.5">${escHtml(line)}${folderLink}</div>`
      }).join('')
      timelineRows += '</td></tr>'
    }
    const body = timelineRows
      ? `<table class="pd-table"><tbody>${timelineRows}</tbody></table>`
      : `<p class="pd-empty-hint text-sm">Chưa có hồ sơ HSTK gần đây.</p>`
    return `<p class="pd-section-title pd-recent-hstk">3 hồ sơ HSTK gần nhất / đã cập nhật (theo bộ môn)</p><div class="pd-table-wrap">${body}</div>`
  }

  function renderDisciplineHstkSection(p) {
    const discs = p.disciplines || []
    if (!discs.length) {
      return `<p class="pd-section-title">Hồ sơ theo bộ môn</p><p class="pd-empty-hint text-sm">Chưa khai báo bộ môn HSTK trên dự án.</p>`
    }
    let rows = ''
    for (const d of discs) {
      const hasPkg = (d.packages_timeline || []).length > 0 || !!d.latest_hstk
      const latest = formatHstkHeadline(d.latest_hstk)
      rows += `<tr>
        <td class="font-mono font-semibold">${escHtml(d.discipline_code)}</td>
        <td>${escHtml(d.leader_name || '—')}</td>
        <td class="font-mono">${escHtml(d.current_revision || '—')}</td>
        <td>${d.revision_change_count || 0} lần</td>
        <td>${hasPkg ? '<span class="text-primary">Có gói</span>' : '<span class="text-gray-400">—</span>'}</td>
        <td class="text-xs">${escHtml(latest)}</td>
      </tr>`
    }
    const tbl = `<table class="pd-table"><thead><tr>
      <th>BM</th><th>Leader</th><th>Rev hiện tại</th><th>Lần sửa</th><th>Gói HSTK</th><th>HSTK mới nhất</th>
    </thead><tbody>${rows}</tbody></table>`
    return `<p class="pd-section-title">Hồ sơ theo bộ môn</p><div class="pd-table-wrap">${tbl}</div>`
  }

  function renderOpenTasksTable(p) {
    const tasks = p.open_tasks_preview || []
    if (!tasks.length) {
      const hint =
        (p.open_tasks || 0) > 0
          ? 'Có task mở trên dự án nhưng chưa có dòng hiển thị (kiểm tra quyền hoặc tải lại).'
          : 'Không có task model chưa xong.'
      return `<p class="pd-section-title">Model / task chưa xong</p><p class="pd-empty-hint text-sm">${escHtml(hint)}</p>`
    }
    const rows = tasks.map(t => {
      const hstk = t.hstk_date || '—'
      const status = PD_TASK_STATUS[t.status] || t.status || '—'
      return `<tr>
        <td><button type="button" class="text-primary underline text-left" onclick="openTaskModal(${t.id})">${escHtml(t.title)}</button></td>
        <td class="font-mono">${escHtml(t.discipline_code || '—')}</td>
        <td>${escHtml(t.category_name || '—')}</td>
        <td>${escHtml(t.assigned_to_name || '—')}</td>
        <td><span class="badge badge-${t.status || 'todo'} text-xs">${escHtml(status)}</span></td>
        <td class="whitespace-nowrap">${escHtml(hstk)}</td>
      </tr>`
    }).join('')
    return `<p class="pd-section-title">Model / task chưa xong</p>
      <div class="pd-table-wrap"><table class="pd-table">
        <thead><tr><th>Tên task</th><th>Bộ môn</th><th>Hạng mục</th><th>Người phụ trách</th><th>Trạng thái</th><th>HSTK</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`
  }

  function projectStatusPill(p) {
    const stuck = (p.blockers || []).length > 0
    return stuck
      ? '<span class="pd-status-pill pd-status-stuck">Đang vướng</span>'
      : '<span class="pd-status-pill pd-status-ok">Ổn</span>'
  }

  function groupBlockers(blockers) {
    const scanNever = []
    const scanStale = []
    const noPkg = []
    const noTaskByCat = new Map()
    const noLatestTaskByCat = new Map()
    const lagRev = []
    const slowHs = []
    const other = []
    for (const b of blockers || []) {
      let m
      if ((m = b.match(/^(.+): chưa quét lần nào$/))) scanNever.push(m[1])
      else if ((m = b.match(/^(.+): chưa quét >14 ngày$/))) scanStale.push(m[1])
      else if ((m = b.match(/^(.+): chưa có gói HSTK$/))) noPkg.push(m[1])
      else if ((m = b.match(/^Hạng mục (.+) chưa giao task \((.+)\)$/))) {
        const cat = m[1]
        const dc = m[2]
        if (!noTaskByCat.has(cat)) noTaskByCat.set(cat, new Set())
        noTaskByCat.get(cat).add(dc)
      } else if ((m = b.match(/^Hạng mục (.+) chưa có task theo gói mới nhất \((.+)\)$/))) {
        const cat = m[1]
        const dc = m[2]
        if (!noLatestTaskByCat.has(cat)) noLatestTaskByCat.set(cat, new Set())
        noLatestTaskByCat.get(cat).add(dc)
      } else if (/^Hạng mục .+ chậm \d+ revision/.test(b)) lagRev.push(b)
      else if (/^Task chậm HS/.test(b)) slowHs.push(b)
      else other.push(b)
    }
    const lines = []
    const uniqSort = arr => [...new Set(arr)].sort()
    const scanCodes = uniqSort([...scanNever, ...scanStale])
    if (scanCodes.length) lines.push(`Chưa quét: ${scanCodes.join(', ')}`)
    if (noPkg.length) lines.push(`Chưa có gói HSTK: ${uniqSort(noPkg).join(', ')}`)
    if (noTaskByCat.size) {
      const parts = [...noTaskByCat.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cat, discs]) => {
        return `${cat} (${uniqSort([...discs]).join(', ')})`
      })
      lines.push(`Chưa giao task: ${parts.join('; ')}`)
    }
    if (noLatestTaskByCat.size) {
      const parts = [...noLatestTaskByCat.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cat, discs]) => {
        return `${cat} (${uniqSort([...discs]).join(', ')})`
      })
      lines.push(`Chưa có task theo gói mới nhất: ${parts.join('; ')}`)
    }
    for (const x of lagRev) lines.push(x)
    for (const x of slowHs) lines.push(x)
    for (const x of other) lines.push(x)
    return lines
  }

  function renderGroupedAlerts(p) {
    const lines = groupBlockers(p.blockers || [])
    if (!lines.length) return '<p class="pd-alert-quiet">Không có điểm vướng</p>'
    return `<ul class="pd-alert-grouped">${lines.map(l => `<li>${escHtml(l)}</li>`).join('')}</ul>`
  }

  function pdTaskIsOverdue(t) {
    if (!t || !t.due_date) return false
    const due = String(t.due_date).slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)
    return due < today
  }

  function renderMemberWorkloadBanner(w) {
    if (!w) return ''
    const taskPayload = w.tasks || {}
    const visibleTasks = taskPayload.tasks || []
    const hidden = taskPayload.hidden_counts_by_project || {}
    const summaryLine = `${w.project_count} dự án tham gia · ${w.open_tasks} task mở · ${w.overdue_tasks} trễ · ${Math.round(w.open_hours || 0)}h dự kiến · Hạn gần: ${escHtml(w.nearest_due || '—')}`

    const taskRows = visibleTasks.map(t => {
      const pct = t.progress != null ? Math.round(Number(t.progress)) : 0
      const status = PD_TASK_STATUS[t.status] || t.status || '—'
      const overdue = pdTaskIsOverdue(t)
      const duePart = t.due_date ? escHtml(String(t.due_date).slice(0, 10)) : '—'
      const stat = `${pct}% · ${escHtml(status)}${overdue ? ' · Trễ' : ''} · Hạn ${duePart}`
      return `<tr>
        <td class="pd-workload-proj">${escHtml(t.project_name)}</td>
        <td class="pd-workload-task"><button type="button" class="text-primary underline text-left" onclick="openTaskModal(${t.id})">${escHtml(t.title)}</button></td>
        <td class="pd-workload-stat">${stat}</td>
      </tr>`
    }).join('')

    const hiddenRows = Object.entries(hidden).map(([pid, cnt]) => {
      return `<tr class="pd-workload-hidden-row">
        <td class="pd-workload-proj">Dự án #${escHtml(pid)}</td>
        <td class="pd-workload-task">${cnt} task (ẩn tên theo quyền)</td>
        <td class="pd-workload-stat">—</td>
      </tr>`
    }).join('')

    const emptyRow = !taskRows && !hiddenRows
      ? '<tr><td colspan="3" class="text-center pd-empty-hint" style="padding:0.75rem">Không có task đang mở.</td></tr>'
      : ''

    return `<div class="pd-workload-card">
      <div class="pd-workload-head">
        <h3 class="pd-workload-title">Tải việc thành viên</h3>
        <p class="pd-workload-summary">${summaryLine}</p>
      </div>
      <div class="pd-workload-body pd-table-wrap">
        <table class="pd-table pd-workload-table">
          <thead><tr><th>Dự án</th><th>Task</th><th>% / trạng thái</th></tr></thead>
          <tbody>${taskRows}${hiddenRows}${emptyRow}</tbody>
        </table>
      </div>
    </div>`
  }

  function renderProjectListItem(p, selectedId) {
    const active = p.id === selectedId ? ' pd-list-item-active' : ''
    const pill = projectStatusPill(p)
    return `<button type="button" class="pd-list-item${active}" onclick="selectProjectDashboard(${p.id})">
      <div class="pd-list-item-name">${escHtml(p.name)}</div>
      <div class="pd-list-item-meta pd-list-item-meta-code"><span class="font-mono">${escHtml(p.code)}</span></div>
      <div class="pd-list-item-meta pd-list-item-meta-foot">
        ${pill}
        <span class="pd-list-item-progress">Tiến độ ${p.progress ?? 0}%</span>
      </div>
    </button>`
  }

  function renderProjectDetailPanel(p, workloadHtml) {
    if (p.detail_loaded === false) {
      return `${workloadHtml || ''}<div class="text-center py-12 text-gray-400"><i class="fas fa-spinner fa-spin"></i> Đang tải chi tiết…</div>`
    }
    const discCount = (p.disciplines || []).length
    const lagCount = countCategoryMatrixByStatus(p, 'lagging')
    const noTaskCount = countCategoryMatrixByStatus(p, 'none')
    return `${workloadHtml || ''}<div class="pd-detail-panel">
      <div class="pd-detail-header">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="font-bold text-lg m-0">${escHtml(p.name)}</h2>
            <span class="text-xs text-gray-400 font-mono">${escHtml(p.code)}</span>
            ${projectStatusPill(p)}
          </div>
          <p class="pd-detail-sub">Tiến độ <strong>${p.progress ?? 0}%</strong> · Task mở ${p.open_tasks ?? 0} · Trễ ${p.overdue_tasks ?? 0} · ${p.total_revision_changes || 0} lần sửa HSTK</p>
        </div>
        <button type="button" class="btn-secondary text-xs shrink-0" onclick="openProjectDetail(${p.id})">Mở dự án</button>
      </div>
      <div class="pd-kpi-row">
        <div class="pd-kpi"><div class="pd-kpi-label">Bộ môn</div><div class="pd-kpi-value">${discCount}</div></div>
        <div class="pd-kpi"><div class="pd-kpi-label">HM chậm hồ sơ</div><div class="pd-kpi-value">${lagCount}</div></div>
        <div class="pd-kpi"><div class="pd-kpi-label">Task chưa xong</div><div class="pd-kpi-value">${p.open_tasks ?? 0}</div></div>
        <div class="pd-kpi"><div class="pd-kpi-label">HM chưa giao task</div><div class="pd-kpi-value">${noTaskCount}</div></div>
      </div>
      ${renderGroupedAlerts(p)}
      ${renderRecentHstkPackages(p)}
      ${renderDisciplineHstkSection(p)}
      ${renderCategoryMatrix(p)}
      ${renderOpenTasksTable(p)}
    </div>`
  }

  function renderProjectDashboard(root, data, opts) {
    opts = opts || {}
    const tab = window._pdState?.tab || 'project'
    const memberId = tab === 'member' ? (document.getElementById('pdMemberFilter')?.value || '') : ''
    const allProjects = data.projects || []

    if (tab === 'member' && !memberId) {
      root.innerHTML = `<div class="pd-master-detail">
        <div class="pd-project-list"><div class="pd-empty-hint">Chọn thành viên ở trên để xem danh sách dự án.</div></div>
        <div class="pd-project-detail"><div class="pd-empty-hint">Dashboard dự án sẽ hiển thị tại đây.</div></div>
      </div>`
      return
    }

    if (!allProjects.length) {
      root.innerHTML = '<p class="text-gray-500 text-sm">Không có dự án phù hợp bộ lọc.</p>'
      return
    }

    const projects = pdFilteredProjects(allProjects)
    let selId = window._pdState.selectedProjectId
    if (!projects.some(p => p.id === selId)) selId = projects.length ? projects[0].id : null
    window._pdState.selectedProjectId = selId
    const selected = selId ? (projects.find(p => p.id === selId) || projects[0]) : null

    const listHtml = projects.length
      ? projects.map(p => renderProjectListItem(p, selId)).join('')
      : '<p class="pd-empty-hint text-xs">Không có dự án phù hợp bộ lọc.</p>'
    const workloadHtml = tab === 'member' && data.workload ? renderMemberWorkloadBanner(data.workload) : ''
    const detailHtml = selected
      ? renderProjectDetailPanel(selected, workloadHtml)
      : `${workloadHtml}<div class="pd-empty-hint">Chọn dự án ở danh sách bên trái.</div>`

    root.innerHTML = `<div class="pd-master-detail">
      <div class="pd-project-list" role="listbox" aria-label="Danh sách dự án">
        ${pdListToolbarHtml()}
        <div class="pd-list-items">${listHtml}</div>
      </div>
      <div class="pd-project-detail">${detailHtml}</div>
    </div>`

    pdRenderProjectStatusChips()

    if (opts.preserveListScroll != null) {
      const listEl = root.querySelector('.pd-list-items')
      if (listEl) listEl.scrollTop = opts.preserveListScroll
    }
  }

  window.initProjectDashboardFilters = async function () {
    const sel = document.getElementById('pdMemberFilter')
    if (!sel || sel.dataset.loaded) return
    try {
      const members = await api('/members')
      sel.innerHTML = '<option value="">— Chọn thành viên —</option>' + members.map(m => `<option value="${m.id}">${escHtml(m.full_name)}</option>`).join('')
      sel.dataset.loaded = '1'
    } catch (_) { /* ignore */ }
    const wrap = document.getElementById('pdMemberFilterWrap')
    if (wrap) wrap.classList.toggle('hidden', (window._pdState?.tab || 'project') !== 'member')
  }
})()
