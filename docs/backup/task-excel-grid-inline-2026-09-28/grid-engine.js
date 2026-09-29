let _taskGridInlineBusy = false

function _taskGridStatusRingClass(status) {
  const s = status === 'done' ? 'completed' : (status || 'todo')
  if (s === 'in_progress') return 'progress'
  if (s === 'completed' || s === 'review') return 'done'
  if (s === 'cancelled') return 'na'
  return 'pending'
}

function _taskGridStatusRingHtml(status, title) {
  const ring = _taskGridStatusRingClass(status)
  const tip = title || status || ''
  return `<span class="task-grid-status-ring legal-checklist-status-ring ${ring}" title="${escHtml(tip)}" aria-hidden="true"></span>`
}

function _taskGridDueInputClass(task, dueVal) {
  const d = dueVal ?? task?.due_date
  const st = task?.status
  const od = d && d < today() && !['completed', 'review', 'cancelled'].includes(st)
  return od ? 'task-grid-due-pill is-overdue' : 'task-grid-due-pill'
}

function _taskGridPermissions(task, projectId) {
  const pid = task?.project_id || projectId
  const isAssigned = task ? task.assigned_to === currentUser?.id : false
  const isCreatedByMe = task ? task.assigned_by === currentUser?.id : true
  const effForTask = getEffectiveRoleForProject(pid)
  const isAdminOrLeader = ['system_admin', 'project_admin', 'project_leader'].includes(effForTask)
  const canEdit = !task || isAdminOrLeader || isAssigned || isCreatedByMe
  const isMember = !['system_admin', 'project_admin', 'project_leader'].includes(
    getEffectiveRoleForProject(pid)
  )
  const isLimitedEdit = !!task && isMember && !isCreatedByMe
  return { canEdit, isLimitedEdit, isMember, isAdminOrLeader }
}

function buildTaskPayloadFromGrid(taskBase, gridFields, opts = {}) {
  const isNew = !!opts.isNew
  const projId = parseInt(gridFields.project_id || taskBase?.project_id, 10)
  const titleRaw = (gridFields.title != null ? gridFields.title : taskBase?.title) || ''
  const title = String(titleRaw).trim()
  if (isNew && !title) return null

  const pick = (key, fallback) =>
    gridFields[key] !== undefined && gridFields[key] !== null && gridFields[key] !== ''
      ? gridFields[key]
      : fallback

  const payload = {
    project_id: projId,
    category_id: parseInt(pick('category_id', taskBase?.category_id), 10) || null,
    title: title || taskBase?.title,
    description: pick('description', taskBase?.description ?? '') ?? '',
    discipline_code: (pick('discipline_code', taskBase?.discipline_code) || '').trim() || null,
    phase: pick('phase', taskBase?.phase || 'basic_design'),
    priority: pick('priority', taskBase?.priority || 'medium'),
    status: pick('status', taskBase?.status || 'todo'),
    assigned_to:
      gridFields.assigned_to !== undefined && gridFields.assigned_to !== ''
        ? parseInt(gridFields.assigned_to, 10) || null
        : taskBase?.assigned_to ?? null,
    start_date: pick('start_date', taskBase?.start_date || (isNew ? today() : null)) || null,
    due_date: (pick('due_date', taskBase?.due_date) || '').trim() || null,
    estimated_hours: parseFloat(pick('estimated_hours', taskBase?.estimated_hours)) || 0,
    progress: parseInt(pick('progress', taskBase?.progress), 10) || 0,
    work_notes: (pick('work_notes', taskBase?.work_notes) ? String(pick('work_notes', taskBase?.work_notes)).trim() : null) || null,
    cde_report:
      gridFields.cde_report !== undefined
        ? gridFields.cde_report
        : taskBase?.cde_report
          ? 1
          : 0,
    hstk_date: (pick('hstk_date', taskBase?.hstk_date) ? String(pick('hstk_date', taskBase?.hstk_date)).trim() : null) || null,
    task_type: pick('task_type', taskBase?.task_type || 'model'),
    model_filename: pick('model_filename', taskBase?.model_filename ?? null) || null,
  }

  const eff = getEffectiveRoleForProject(projId)
  const isMember = !['system_admin', 'project_admin', 'project_leader'].includes(eff)
  if (isNew && isMember) payload.assigned_to = currentUser?.id ?? null

  return payload
}

function _taskGridReadRow(row) {
  const o = {}
  row.querySelectorAll('[data-tfield]').forEach(el => {
    if (el.type === 'checkbox') o[el.dataset.tfield] = el.checked ? 1 : 0
    else o[el.dataset.tfield] = el.value
  })
  row.querySelectorAll('[data-tfield-cb]').forEach(el => {
    o[el.dataset.tfieldCb] = _cbGetValue(el.id) || ''
  })
  if (row.dataset.projectId) o.project_id = row.dataset.projectId
  return o
}

function _taskGridPayloadUnchanged(task, payload) {
  const norm = (k, v) => {
    if (k === 'category_id' || k === 'assigned_to' || k === 'project_id') return v == null || v === '' ? null : Number(v)
    if (k === 'progress') return parseInt(v, 10) || 0
    if (k === 'cde_report') return v ? 1 : 0
    return v == null ? '' : String(v)
  }
  for (const k of [
    'title', 'project_id', 'category_id', 'task_type', 'model_filename', 'discipline_code', 'phase', 'priority',
    'status', 'assigned_to', 'start_date', 'due_date', 'estimated_hours', 'progress',
    'work_notes', 'hstk_date', 'cde_report',
  ]) {
    if (norm(k, task[k]) !== norm(k, payload[k])) return false
  }
  return true
}

function taskGridSyncFilenameVisibility(selectEl) {
  const row = selectEl?.closest?.('.task-grid-row')
  if (!row) return
  const isModel = selectEl.value === 'model'
  row.querySelectorAll('.task-grid-filename-cell').forEach(cell => {
    cell.classList.toggle('task-grid-filename-skip', !isModel)
    const inp = cell.querySelector('[data-tfield="model_filename"]')
    if (inp) inp.disabled = !isModel
  })
}

function _taskGridFocusableInRow(row) {
  const out = []
  row.querySelectorAll('.task-grid-cell').forEach(cell => {
    if (cell.classList.contains('task-grid-filename-skip')) return
    const cb = cell.querySelector('[data-cb-trigger]')
    if (cb && !cb.closest('[style*="pointer-events: none"]')) {
      out.push(cb)
      return
    }
    const el = cell.querySelector('[data-tfield]:not([disabled])')
    if (el) out.push(el)
  })
  return out
}

function _taskGridTabNavigate(ev) {
  const row = ev.target.closest('.task-grid-row')
  if (!row) return
  _cbCloseAll()
  const fields = _taskGridFocusableInRow(row)
  let active = ev.target.closest('[data-tfield], [data-cb-trigger]')
  if (!active) return
  let idx = fields.indexOf(active)
  if (idx < 0) idx = fields.findIndex(f => f.contains(active))
  const next = ev.shiftKey ? idx - 1 : idx + 1
  if (next >= 0 && next < fields.length) {
    ev.preventDefault()
    fields[next].focus()
    if (fields[next].matches('[data-cb-trigger]')) fields[next].click()
  } else if (!ev.shiftKey && row.classList.contains('is-new')) {
    const title = row.querySelector('[data-tfield="title"]')?.value?.trim()
    if (title) {
      ev.preventDefault()
      const ctx = row.dataset.gridContext || 'project'
      taskGridCommitRow(ev, null, ctx).then(() => taskGridFocusNewRow(ctx))
    }
  }
}

function taskGridCancelCell(ev) {
  const el = ev.target
  const snap = el.dataset.taskGridOrig
  if (snap != null) el.value = snap
  else if (el.hasAttribute('contenteditable')) el.innerText = el.dataset.taskGridOrig || ''
  el.blur()
}

function taskGridCellKeydown(ev, taskId, context) {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    taskGridCancelCell(ev)
    return
  }
  if (ev.key === 'Tab') {
    _taskGridTabNavigate(ev)
    return
  }
  if (ev.key === 'Enter') {
    ev.preventDefault()
    taskGridCommitRow(ev, taskId || null, context)
  }
}

async function taskGridTitlePaste(ev, taskId, context) {
  const row = ev.target.closest('.task-grid-row')
  if (!row || !row.classList.contains('is-new')) return
  const text = ev.clipboardData?.getData('text') || ''
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length <= 1) return
  ev.preventDefault()
  for (let i = 0; i < lines.length; i++) {
    const titleEl = row.querySelector('[data-tfield="title"]')
    if (titleEl) titleEl.value = lines[i]
    await taskGridCommitRow({ target: titleEl || ev.target, preventDefault() {} }, null, context)
    if (i < lines.length - 1) {
      await new Promise(r => setTimeout(r, 50))
      const newRow = document.querySelector(`.task-grid-row.is-new[data-grid-context="${context}"]`)
      if (!newRow) break
    }
  }
}

async function _taskGridReloadProjectTasks(projectId) {
  const pid = parseInt(projectId, 10)
  const prevCats = _projectDetailFetchCache.projectId === pid ? _projectDetailFetchCache.categories : []
  _invalidateProjectDetailCache()
  const tasks = await api(`/tasks?project_id=${pid}&limit=${TASK_PROJECT_LIMIT}`)
  _projectDetailFetchCache = { projectId: pid, tasks, categories: prevCats }
  _projTaskAllData = tasks
  renderProjTaskRows()
  renderProjTaskPagination()
}

async function taskGridCommitRow(ev, taskId, context) {
  if (_taskGridInlineBusy) return
  const row = ev?.target?.closest?.('.task-grid-row')
  if (!row) return
  const isNew = !taskId || row.classList.contains('is-new')
  const gridFields = _taskGridReadRow(row)
  const taskBase = isNew
    ? {}
    : (_projTaskAllData.find(t => t.id === taskId) || allTasks.find(t => t.id === taskId) || {})

  const payload = buildTaskPayloadFromGrid(taskBase, gridFields, { isNew })
  if (!payload) return
  if (!payload.project_id) {
    toast('Vui lòng chọn dự án', 'warning')
    return
  }
  if (!payload.title) {
    if (isNew) return
    toast('Tên task không được để trống', 'error')
    return
  }
  if (!isNew && _taskGridPayloadUnchanged(taskBase, payload)) return

  _taskGridInlineBusy = true
  try {
    if (isNew) await api('/tasks', { method: 'post', data: payload })
    else await api(`/tasks/${taskId}`, { method: 'put', data: payload })
    toast(isNew ? 'Tạo task thành công' : 'Cập nhật task thành công')
    if (context === 'project' && window._currentProjectDetailId) {
      await _taskGridReloadProjectTasks(window._currentProjectDetailId)
    } else {
      await loadTasks()
    }
  } catch (e) {
    toast('Lỗi: ' + (e.response?.data?.error || e.message), 'error')
  } finally {
    _taskGridInlineBusy = false
  }
}

function taskGridFocusNewRow(context) {
  const row = document.querySelector(`.task-grid-row.is-new[data-grid-context="${context}"]`)
  if (!row) return
  const title = row.querySelector('[data-tfield="title"]')
  if (title) {
    title.focus()
    title.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

function _taskGridStatusSelectHtml(status, disabled, taskId, ctx) {
  const opts = [
    ['todo', 'Chờ làm'],
    ['in_progress', 'Đang làm'],
    ['review', 'Đang duyệt'],
    ['completed', 'Hoàn thành'],
    ['cancelled', 'Đã hủy'],
  ]
  const cur = status === 'done' ? 'completed' : (status || 'todo')
  const idArg = taskId ? taskId : 'null'
  return `<select data-tfield="status" class="task-grid-inline-select" ${disabled ? 'disabled' : ''} onblur="taskGridCommitRow(event, ${idArg}, '${ctx}')" onkeydown="taskGridCellKeydown(event, ${idArg}, '${ctx}')">${opts.map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`
}

function _taskGridPrioritySelectHtml(priority, disabled) {
  const opts = [['urgent', 'Khẩn'], ['high', 'Cao'], ['medium', 'TB'], ['low', 'Thấp']]
  const cur = priority || 'medium'
  return `<select data-tfield="priority" class="task-grid-inline-select task-grid-priority-select" ${disabled ? 'disabled' : ''} onblur="taskGridCommitRow(event, this.closest('.task-grid-row').dataset.taskId, this.closest('.task-grid-row').dataset.gridContext)" onkeydown="taskGridCellKeydown(event, this.closest('.task-grid-row').dataset.taskId, this.closest('.task-grid-row').dataset.gridContext)">${opts.map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`
}

function _taskGridDisciplineSelectHtml(code, disabled) {
  const items = (allDisciplines || []).map(d => d.code)
  return `<select data-tfield="discipline_code" class="task-grid-inline-select" ${disabled ? 'disabled' : ''} onblur="taskGridCommitRow(event, this.closest('.task-grid-row').dataset.taskId, this.closest('.task-grid-row').dataset.gridContext)" onkeydown="taskGridCellKeydown(event, this.closest('.task-grid-row').dataset.taskId, this.closest('.task-grid-row').dataset.gridContext)"><option value="">—</option>${items.map(c => `<option value="${c}"${c === code ? ' selected' : ''}>${c}</option>`).join('')}</select>`
}

function _taskGridTypeSelectHtml(taskType, disabled, taskId, ctx) {
  const opts = [
    ['model', 'Mô hình'],
    ['check_hs', 'Kiểm HS'],
    ['other', 'Khác'],
  ]
  const cur = taskType || 'model'
  const idArg = taskId ? taskId : 'null'
  const dis = disabled ? 'disabled' : ''
  const commit = `onblur="taskGridCommitRow(event, ${idArg}, '${ctx}')" onkeydown="taskGridCellKeydown(event, ${idArg}, '${ctx}')"`
  return `<select data-tfield="task_type" class="task-grid-inline-select" ${dis} onchange="taskGridSyncFilenameVisibility(this)" ${commit}>${opts.map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`
}

function _taskGridPhaseSelectHtml(phase, disabled, taskId, ctx) {
  const opts = [
    ['basic_design', 'TKCS'],
    ['technical_design', 'TKKT'],
    ['construction_design', 'TKTC'],
    ['as_built', 'Hoàn công'],
  ]
  const cur = phase || 'basic_design'
  const idArg = taskId ? taskId : 'null'
  const dis = disabled ? 'disabled' : ''
  const commit = `onblur="taskGridCommitRow(event, ${idArg}, '${ctx}')" onkeydown="taskGridCellKeydown(event, ${idArg}, '${ctx}')"`
  return `<select data-tfield="phase" class="task-grid-inline-select" ${dis} ${commit}>${opts.map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`
}

function _taskGridFilenameOptionsHtml(projectId, selected) {
  const items = _taskFilenameCache[projectId] || []
  const val = selected || ''
  const known = items.some(i => i.value === val)
  let html = '<option value="">—</option>'
  if (val && !known) html += `<option value="${escHtml(val)}" selected>${escHtml(val)}</option>`
  html += items.map(i => `<option value="${escHtml(i.value)}"${i.value === val ? ' selected' : ''}>${escHtml(i.label)}</option>`).join('')
  return html
}

function _taskGridApplyModelOptions(row) {
  const sel = row?.querySelector?.('select[data-tfield="model_filename"]')
  if (!sel) return
  const cur = sel.value
  sel.innerHTML = _taskGridFilenameOptionsHtml(row.dataset.projectId, cur)
}

async function _taskGridLoadModelCache(projectId) {
  if (!projectId || _taskFilenameCache[projectId]) return
  try {
    const models = await api(`/projects/${projectId}/models`)
    _taskFilenameCache[projectId] = (models || []).map(m => ({ value: m.name, label: m.name }))
  } catch (_) {
    _taskFilenameCache[projectId] = []
  }
}

function _taskGridFilenameCellHtml(t, canEdit, isLimitedEdit, disAll, commitAttr, py = 'py-1.5') {
  const isModel = (t?.task_type || 'model') === 'model'
  const skip = isModel ? '' : ' task-grid-filename-skip'
  const val = t?.model_filename || ''
  if (!canEdit || isLimitedEdit) {
    return `<td class="task-grid-cell ${py} pr-3 task-grid-filename-cell${skip}"><span class="text-xs">${isModel ? escHtml(val || '—') : '—'}</span></td>`
  }
  const dis = disAll || !isModel ? 'disabled' : ''
  return `<td class="task-grid-cell ${py} pr-3 task-grid-filename-cell${skip}"><select data-tfield="model_filename" class="task-grid-inline-select task-grid-filename-select" title="Chọn từ Danh sách model" ${dis} ${commitAttr}>${_taskGridFilenameOptionsHtml(t?.project_id, val)}</select></td>`
}

function _taskGridFilenameCellHtmlGlobal(t, canEdit, isLimitedEdit, disAll, commitAttr) {
  return _taskGridFilenameCellHtml(t, canEdit, isLimitedEdit, disAll, commitAttr, 'py-2')
}

function _taskGridFilenameNewCellHtml(projectId, commitAttr, py) {
  return `<td class="task-grid-cell ${py} pr-3 task-grid-filename-cell"><select data-tfield="model_filename" class="task-grid-inline-select task-grid-filename-select" title="Chọn từ Danh sách model" ${commitAttr}>${_taskGridFilenameOptionsHtml(projectId, '')}</select></td>`
}

function _taskGridProgressCellHtml(value, disabled, commitAttr, py) {
  const dis = disabled ? 'disabled' : ''
  return `<td class="task-grid-cell ${py} pr-3"><div class="task-grid-progress-wrap"><input type="number" min="0" max="100" data-tfield="progress" class="task-grid-inline-input task-grid-progress-input" value="${value || 0}" title="% hoàn thành" ${dis} ${commitAttr}><span class="task-grid-progress-unit">%</span></div></td>`
}

function _taskGridAssigneeItems(projectId, isNew) {
  const eff = getEffectiveRoleForProject(projectId)
  const isMember = !['system_admin', 'project_admin', 'project_leader'].includes(eff)
  if (isMember && isNew) {
    return [{ value: String(currentUser.id), label: currentUser.full_name }]
  }
  const mems = window._currentProjectDetailMembers || []
  if (mems.length) {
    return mems
      .filter(m => m.user_id)
      .map(m => ({ value: String(m.user_id), label: m.full_name || m.name || `#${m.user_id}` }))
  }
  return (allUsers || [])
    .filter(u => u.is_active !== 0)
    .map(u => ({ value: String(u.id), label: u.full_name }))
}

async function _taskGridInitRowComboboxes(row) {
  const taskId = row.dataset.taskId || 'new'
  const projectId = parseInt(row.dataset.projectId, 10)
  const isNew = row.classList.contains('is-new')
  const { isLimitedEdit, isMember } = _taskGridPermissions(isNew ? null : { project_id: projectId }, projectId)

  const catHost = row.querySelector(`[id^="taskGridCat_"]`)
  if (catHost) {
    let catItems = []
    if (projectId && _projectDetailFetchCache.projectId === projectId) {
      catItems = (_projectDetailFetchCache.categories || []).map(c => ({ value: String(c.id), label: c.name }))
    } else if (projectId) {
      try {
        const cats = await api(`/projects/${projectId}/categories`)
        catItems = (cats || []).map(c => ({ value: String(c.id), label: c.name }))
      } catch (_) {}
    }
    const catId = row.dataset.categoryId || ''
    createCombobox(catHost.id, {
      placeholder: 'Hạng mục',
      items: catItems,
      value: catId,
      fullWidth: true,
      teleport: true,
      onchange: () => taskGridCommitRow({ target: catHost }, taskId === 'new' ? null : parseInt(taskId, 10), row.dataset.gridContext),
    })
    if (isLimitedEdit) _applyComboboxLock(catHost.id)
  }

  const asgHost = row.querySelector(`[id^="taskGridAsg_"]`)
  if (asgHost) {
    const items = _taskGridAssigneeItems(projectId, isNew)
    const val = row.dataset.assignedTo || (isNew && isMember ? String(currentUser.id) : '')
    createCombobox(asgHost.id, {
      placeholder: 'Phụ trách',
      items,
      value: val,
      fullWidth: true,
      teleport: true,
      onchange: () => taskGridCommitRow({ target: asgHost }, taskId === 'new' ? null : parseInt(taskId, 10), row.dataset.gridContext),
    })
    if (isLimitedEdit || (isNew && isMember)) _applyComboboxLock(asgHost.id)
  }

  const modelProjectId = row.dataset.projectId
  if (modelProjectId && row.querySelector('select[data-tfield="model_filename"]')) {
    _taskGridLoadModelCache(modelProjectId).then(() => { if (row.isConnected) _taskGridApplyModelOptions(row) })
  }

  const projHost = row.querySelector(`[id^="taskGridProj_"]`)
  if (projHost) {
    const items = (allProjects || []).map(p => ({ value: String(p.id), label: `${p.code} - ${p.name}` }))
    const filt = isNew
      ? (_cbGetValue('taskProjectCombobox') || row.dataset.projectId || '')
      : String(row.dataset.projectId || '')
    createCombobox(projHost.id, {
      placeholder: 'Dự án *',
      items,
      value: filt,
      fullWidth: true,
      teleport: true,
      onchange: (val) => {
        row.dataset.projectId = val || ''
        _taskGridLoadModelCache(val).then(() => { if (row.isConnected) _taskGridApplyModelOptions(row) })
        if (!isNew) {
          taskGridCommitRow({ target: projHost }, parseInt(taskId, 10), row.dataset.gridContext)
        }
      },
    })
  }
}

function _taskGridBindCellFocus(row) {
  row.querySelectorAll('[data-tfield]').forEach(el => {
    el.addEventListener('focus', () => {
      el.dataset.taskGridOrig = el.value
    })
  })
}

function _taskGridRenderProjectDataRow(t) {
  const { canEdit, isLimitedEdit } = _taskGridPermissions(t, t.project_id)
  const od = isOverdue(t)
  const disLimited = isLimitedEdit ? 'disabled' : ''
  const disAll = !canEdit ? 'disabled' : ''
  const ctx = 'project'
  const commitAttr = (f) =>
    `onblur="taskGridCommitRow(event, ${t.id}, '${ctx}')" onkeydown="taskGridCellKeydown(event, ${t.id}, '${ctx}')"`

  const catReadonly = t.category_name
    ? `<span class="text-xs font-medium">${escHtml(t.category_name)}</span>`
    : '<span class="text-xs text-gray-300">—</span>'
  const typeLabel = { model: 'Mô hình', check_hs: 'Kiểm HS', other: 'Khác' }[t.task_type] || t.task_type || '—'

  if (!canEdit) {
    return `
    <tr class="task-grid-row table-row ${od ? 'overdue-row is-overdue' : ''}" data-task-id="${t.id}" data-grid-context="${ctx}" data-project-id="${t.project_id}">
      <td class="task-grid-cell py-1.5 pr-3">
        <div class="task-grid-title-wrap">${_taskGridStatusRingHtml(t.status)}<span class="task-grid-title-readonly">${escHtml(t.title)}</span></div>
      </td>
      <td class="py-1.5 pr-3">${catReadonly}</td>
      <td class="py-1.5 pr-3 text-xs">${escHtml(typeLabel)}</td>
      ${_taskGridFilenameCellHtml(t, false, true, true, '')}
      <td class="py-1.5 pr-3"><span class="badge" style="background:#e0f2fe;color:#0369a1">${escHtml(t.discipline_code || '—')}</span></td>
      <td class="py-1.5 pr-3 text-xs">${escHtml(getPhaseName(t.phase) || '—')}</td>
      <td class="py-1.5 pr-3">${getPriorityBadge(t.priority)}</td>
      <td class="py-1.5 pr-3">${escHtml(t.assigned_to_name || 'Chưa giao')}</td>
      <td class="py-1.5 pr-3 text-xs">${fmtDate(t.start_date)}</td>
      <td class="py-1.5 pr-3"><span class="${_taskGridDueInputClass(t)}">${fmtDate(t.due_date)}</span></td>
      <td class="py-1.5 pr-3"><span class="text-xs">${t.progress || 0}%</span></td>
      <td class="py-1.5 pr-3">${getStatusBadge(t.status)}</td>
      <td class="py-1.5 pr-3 text-xs max-w-[120px] truncate" title="${escHtml(t.hstk_date || '')}">${escHtml(t.hstk_date || '—')}</td>
      <td class="py-1.5 pr-3 text-xs max-w-[100px] truncate" title="${escHtml(t.work_notes || '')}">${escHtml(t.work_notes || '—')}</td>
      <td class="py-1.5 pr-3 text-center">${t.cde_report ? '✓' : '—'}</td>
    </tr>`
  }

  const cdeCommit = `onchange="taskGridCommitRow(event, ${t.id}, '${ctx}')"`
  return `
    <tr class="task-grid-row table-row ${od ? 'overdue-row is-overdue' : ''}" data-task-id="${t.id}" data-grid-context="${ctx}" data-project-id="${t.project_id}" data-category-id="${t.category_id || ''}" data-assigned-to="${t.assigned_to || ''}" data-needs-cb="1">
      <td class="task-grid-cell py-1.5 pr-3">
        <div class="task-grid-title-wrap">
          ${_taskGridStatusRingHtml(t.status, getStatusBadge(t.status).replace(/<[^>]+>/g, ''))}
          <input type="text" data-tfield="title" class="task-grid-inline-input task-grid-title-input" value="${escHtml(t.title)}" ${disLimited || disAll} ${commitAttr('title')}>
          <button type="button" class="task-grid-detail-btn" title="Chi tiết" onclick="openTaskDetail(${t.id})"><i class="fas fa-external-link-alt text-xs"></i></button>
        </div>
      </td>
      <td class="task-grid-cell py-1.5 pr-3">${isLimitedEdit ? catReadonly : `<div id="taskGridCat_${ctx}_${t.id}" data-tfield-cb="category_id" class="task-grid-cb-host"></div>`}</td>
      <td class="task-grid-cell py-1.5 pr-3">${isLimitedEdit ? `<span class="text-xs">${escHtml(typeLabel)}</span>` : _taskGridTypeSelectHtml(t.task_type, false, t.id, ctx)}</td>
      ${_taskGridFilenameCellHtml(t, true, isLimitedEdit, disAll, commitAttr())}
      <td class="task-grid-cell py-1.5 pr-3">${isLimitedEdit ? `<span class="badge" style="background:#e0f2fe;color:#0369a1">${escHtml(t.discipline_code || '—')}</span>` : _taskGridDisciplineSelectHtml(t.discipline_code, false)}</td>
      <td class="task-grid-cell py-1.5 pr-3">${isLimitedEdit ? `<span class="text-xs">${escHtml(getPhaseName(t.phase) || '—')}</span>` : _taskGridPhaseSelectHtml(t.phase, false, t.id, ctx)}</td>
      <td class="task-grid-cell py-1.5 pr-3">${isLimitedEdit ? getPriorityBadge(t.priority) : _taskGridPrioritySelectHtml(t.priority, false)}</td>
      <td class="task-grid-cell py-1.5 pr-3">${isLimitedEdit ? `<span>${escHtml(t.assigned_to_name || 'Chưa giao')}</span>` : `<div id="taskGridAsg_${ctx}_${t.id}" data-tfield-cb="assigned_to" class="task-grid-cb-host"></div>`}</td>
      <td class="task-grid-cell py-1.5 pr-3"><input type="date" data-tfield="start_date" class="task-grid-due-pill" value="${escHtml(t.start_date || '')}" ${disLimited || disAll} ${commitAttr()}></td>
      <td class="task-grid-cell py-1.5 pr-3"><input type="date" data-tfield="due_date" class="${_taskGridDueInputClass(t)}" value="${escHtml(t.due_date || '')}" ${disLimited || disAll} ${commitAttr()}></td>
      ${_taskGridProgressCellHtml(t.progress, !!disAll, commitAttr(), 'py-1.5')}
      <td class="task-grid-cell py-1.5 pr-3">${_taskGridStatusSelectHtml(t.status, !!disAll, t.id, ctx)}</td>
      <td class="task-grid-cell py-1.5 pr-3"><input type="text" data-tfield="hstk_date" class="task-grid-inline-input" value="${escHtml(t.hstk_date || '')}" placeholder="Theo HSTK…" ${disLimited || disAll} ${commitAttr()}></td>
      <td class="task-grid-cell py-1.5 pr-3"><input type="text" data-tfield="work_notes" class="task-grid-inline-input" value="${escHtml(t.work_notes || '')}" placeholder="Ghi chú…" ${disAll} ${commitAttr()}></td>
      <td class="task-grid-cell py-1.5 pr-3 text-center"><input type="checkbox" data-tfield="cde_report" class="task-grid-cde-check" ${t.cde_report ? 'checked' : ''} ${disAll} ${cdeCommit} onkeydown="taskGridCellKeydown(event, ${t.id}, '${ctx}')"></td>
    </tr>`
}

function _taskGridRenderGlobalDataRow(t) {
  const { canEdit, isLimitedEdit } = _taskGridPermissions(t, t.project_id)
  const od = isOverdue(t)
  const ctx = 'global'
  const disLimited = isLimitedEdit ? 'disabled' : ''
  const disAll = !canEdit ? 'disabled' : ''
  const commitAttr = `onblur="taskGridCommitRow(event, ${t.id}, '${ctx}')" onkeydown="taskGridCellKeydown(event, ${t.id}, '${ctx}')"`
  const subCount = t.subtask_count || 0
  const subDone = t.subtask_done_count || 0
  const hasSubtasks = subCount > 0
  const subBadgeColor = subCount === 0 ? '#e5e7eb' : subDone === subCount ? '#dcfce7' : '#fef9c3'
  const subTextColor = subCount === 0 ? '#9ca3af' : subDone === subCount ? '#16a34a' : '#92400e'
  const canDeleteThisTask =
    ['system_admin', 'project_admin'].includes(currentUser?.role) ||
    getEffectiveRoleForProject(t.project_id) === 'project_admin'

  const titleCell = !canEdit
    ? `<span class="font-medium text-gray-800 text-sm cursor-pointer hover:text-primary" onclick="openTaskDetail(${t.id})">${escHtml(t.title)}</span>`
    : `<div class="task-grid-title-wrap">${_taskGridStatusRingHtml(t.status)}<input type="text" data-tfield="title" class="task-grid-inline-input task-grid-title-input" value="${escHtml(t.title)}" ${disLimited} ${commitAttr}><button type="button" class="task-grid-detail-btn" title="Chi tiết" onclick="openTaskDetail(${t.id})"><i class="fas fa-external-link-alt text-xs"></i></button></div>`

  const catCell = !canEdit || isLimitedEdit
    ? (t.category_name
      ? `<span class="text-xs text-gray-700 font-medium bg-slate-100 px-2 py-0.5 rounded max-w-32 truncate block">${escHtml(t.category_name)}</span>`
      : '<span class="text-xs text-gray-300">—</span>')
    : `<div id="taskGridCat_${ctx}_${t.id}" data-tfield-cb="category_id" class="task-grid-cb-host"></div>`

  const asgCell =
    !canEdit || isLimitedEdit
      ? `<span class="text-sm text-gray-600">${escHtml(t.assigned_to_name || 'Chưa giao')}</span>`
      : `<div id="taskGridAsg_${ctx}_${t.id}" data-tfield-cb="assigned_to" class="task-grid-cb-host"></div>`

  return `
    <tr class="task-grid-row task-main-row table-row ${od ? 'overdue-row is-overdue' : ''}" data-task-id="${t.id}" data-grid-context="${ctx}" data-project-id="${t.project_id}" data-category-id="${t.category_id || ''}" data-assigned-to="${t.assigned_to || ''}" data-needs-cb="${canEdit && !isLimitedEdit ? '1' : ''}">
      <td class="py-2 pl-2 pr-1" style="width:32px">
        ${hasSubtasks
          ? `<button onclick="toggleSubtasks(${t.id}, this)" class="subtask-toggle w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 transition-transform" title="Mở rộng/thu gọn subtask"><i class="fas fa-chevron-right text-xs"></i></button>`
          : `<button onclick="openSubtaskModal(${t.id})" class="w-6 h-6 flex items-center justify-center rounded hover:bg-indigo-50 text-gray-300 hover:text-indigo-400 transition-colors" title="Thêm subtask"><i class="fas fa-plus text-xs"></i></button>`}
      </td>
      <td class="task-grid-cell py-2 pr-3">
        <div class="task-name-wrap flex items-center gap-1.5 flex-wrap">
          ${titleCell}
          ${(_chatUnreadMap[`task_${t.id}`] || 0) > 0 ? `<span class="chat-unread-badge">${_chatUnreadMap[`task_${t.id}`]}</span>` : ''}
        </div>
        ${od ? '<span class="badge badge-overdue text-xs">Trễ hạn!</span>' : ''}
        ${hasSubtasks ? `<span class="subtask-badge inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full mt-0.5" style="background:${subBadgeColor};color:${subTextColor}"><i class="fas fa-list-check" style="font-size:9px"></i>${subDone}/${subCount}</span>` : ''}
      </td>
      <td class="${canEdit && !isLimitedEdit ? 'task-grid-cell ' : ''}py-2 pr-3 text-sm">${canEdit && !isLimitedEdit ? `<div id="taskGridProj_${ctx}_${t.id}" data-tfield-cb="project_id" class="task-grid-cb-host" style="min-width:140px"></div>` : escHtml(t.project_code || '—')}</td>
      <td class="task-grid-cell py-2 pr-3">${catCell}</td>
      <td class="task-grid-cell py-2 pr-3">${!canEdit || isLimitedEdit ? `<span class="text-xs">${escHtml(({ model: 'Mô hình', check_hs: 'Kiểm HS', other: 'Khác' }[t.task_type] || t.task_type || '—'))}</span>` : _taskGridTypeSelectHtml(t.task_type, false, t.id, ctx)}</td>
      ${_taskGridFilenameCellHtmlGlobal(t, canEdit, isLimitedEdit, disAll, commitAttr)}
      <td class="task-grid-cell py-2 pr-3">${isLimitedEdit ? `<span class="badge text-xs" style="background:#e0f2fe;color:#0369a1">${escHtml(t.discipline_code || '—')}</span>` : canEdit ? _taskGridDisciplineSelectHtml(t.discipline_code, false) : `<span class="badge text-xs" style="background:#e0f2fe;color:#0369a1">${escHtml(t.discipline_code || '—')}</span>`}</td>
      <td class="task-grid-cell py-2 pr-3">${!canEdit || isLimitedEdit ? `<span class="text-xs">${escHtml(getPhaseName(t.phase) || '—')}</span>` : _taskGridPhaseSelectHtml(t.phase, false, t.id, ctx)}</td>
      <td class="task-grid-cell py-2 pr-3">${isLimitedEdit ? getPriorityBadge(t.priority) : canEdit ? _taskGridPrioritySelectHtml(t.priority, false) : getPriorityBadge(t.priority)}</td>
      <td class="task-grid-cell py-2 pr-3">${asgCell}</td>
      <td class="task-grid-cell py-2 pr-3">${canEdit ? `<input type="date" data-tfield="start_date" class="task-grid-due-pill" value="${escHtml(t.start_date || '')}" ${disLimited || disAll} ${commitAttr}>` : `<span class="text-xs">${fmtDate(t.start_date)}</span>`}</td>
      <td class="task-grid-cell py-2 pr-3"><input type="date" data-tfield="due_date" class="${_taskGridDueInputClass(t)}" value="${escHtml(t.due_date || '')}" ${disLimited || disAll} ${commitAttr}></td>
      ${_taskGridProgressCellHtml(t.progress, !!disAll, commitAttr, 'py-2')}
      <td class="task-grid-cell py-2 pr-3">${canEdit ? _taskGridStatusSelectHtml(t.status, false, t.id, ctx) : getStatusBadge(t.status)}</td>
      <td class="task-grid-cell py-2 pr-3">${canEdit ? `<input type="text" data-tfield="hstk_date" class="task-grid-inline-input" value="${escHtml(t.hstk_date || '')}" placeholder="Theo HSTK…" ${disLimited || disAll} ${commitAttr}>` : `<span class="text-xs max-w-[120px] truncate block">${escHtml(t.hstk_date || '—')}</span>`}</td>
      <td class="task-grid-cell py-2 pr-3">${canEdit ? `<input type="text" data-tfield="work_notes" class="task-grid-inline-input" value="${escHtml(t.work_notes || '')}" placeholder="Ghi chú…" ${disAll} ${commitAttr}>` : `<span class="text-xs max-w-[100px] truncate block">${escHtml(t.work_notes || '—')}</span>`}</td>
      <td class="task-grid-cell py-2 pr-3 text-center">${canEdit ? `<input type="checkbox" data-tfield="cde_report" class="task-grid-cde-check" ${t.cde_report ? 'checked' : ''} ${disAll} onchange="taskGridCommitRow(event, ${t.id}, '${ctx}')" onkeydown="taskGridCellKeydown(event, ${t.id}, '${ctx}')">` : (t.cde_report ? '✓' : '—')}</td>
      <td class="py-2">
        <div class="flex gap-1">
          ${canEdit ? `<button type="button" onclick="openTaskModal(${t.id})" class="btn-secondary text-xs px-2 py-1" title="Mở rộng / subtask / đính kèm"><i class="fas fa-ellipsis-h"></i></button>` : ''}
          ${canDeleteThisTask ? `<button onclick="confirmDeleteTask(${t.id}, '${String(t.title).replace(/'/g, "\\'")}' )" class="text-red-400 hover:text-red-600 px-2 py-1 text-sm" title="Xóa"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </td>
    </tr>
    <tr id="subtask-rows-${t.id}" class="subtask-container-row" style="display:none">
      <td colspan="18" class="p-0"><div id="subtask-panel-${t.id}" class="subtask-panel"></div></td>
    </tr>`
}

function _taskGridRenderGlobalNewRow() {
  const ctx = 'global'
  const filtProj = _cbGetValue('taskProjectCombobox') || ''
  const commitAttr = `onblur="taskGridCommitRow(event, null, '${ctx}')" onkeydown="taskGridCellKeydown(event, null, '${ctx}')"`
  const projCell = filtProj
    ? `<input type="hidden" data-tfield="project_id" value="${escHtml(filtProj)}">`
    : `<div id="taskGridProj_${ctx}_new" data-tfield-cb="project_id" class="task-grid-cb-host" style="min-width:140px"></div>`
  return `
    <tr class="task-grid-row is-new task-main-row" data-task-id="" data-grid-context="${ctx}" data-project-id="${filtProj || ''}" data-needs-cb="1">
      <td class="py-2 pl-2 pr-1"></td>
      <td class="task-grid-cell py-2 pr-3">
        <div class="task-grid-title-wrap">${_taskGridStatusRingHtml('todo', 'Hàng mới')}<input type="text" data-tfield="title" class="task-grid-inline-input task-grid-title-input" placeholder="Tên task…" ${commitAttr} onpaste="taskGridTitlePaste(event, null, '${ctx}')"></div>
      </td>
      <td class="task-grid-cell py-2 pr-3">${projCell}</td>
      <td class="task-grid-cell py-2 pr-3"><div id="taskGridCat_${ctx}_new" data-tfield-cb="category_id" class="task-grid-cb-host"></div></td>
      <td class="task-grid-cell py-2 pr-3">${_taskGridTypeSelectHtml('model', false, null, ctx)}</td>
      ${_taskGridFilenameNewCellHtml(filtProj, commitAttr, 'py-2')}
      <td class="task-grid-cell py-2 pr-3">${_taskGridDisciplineSelectHtml('', false)}</td>
      <td class="task-grid-cell py-2 pr-3">${_taskGridPhaseSelectHtml('basic_design', false, null, ctx)}</td>
      <td class="task-grid-cell py-2 pr-3">${_taskGridPrioritySelectHtml('medium', false)}</td>
      <td class="task-grid-cell py-2 pr-3"><div id="taskGridAsg_${ctx}_new" data-tfield-cb="assigned_to" class="task-grid-cb-host"></div></td>
      <td class="task-grid-cell py-2 pr-3"><input type="date" data-tfield="start_date" class="task-grid-due-pill" ${commitAttr}></td>
      <td class="task-grid-cell py-2 pr-3"><input type="date" data-tfield="due_date" class="task-grid-due-pill" ${commitAttr}></td>
      ${_taskGridProgressCellHtml(0, false, commitAttr, 'py-2')}
      <td class="task-grid-cell py-2 pr-3">${_taskGridStatusSelectHtml('todo', false, null, ctx)}</td>
      <td class="task-grid-cell py-2 pr-3"><input type="text" data-tfield="hstk_date" class="task-grid-inline-input" placeholder="Theo HSTK…" ${commitAttr}></td>
      <td class="task-grid-cell py-2 pr-3"><input type="text" data-tfield="work_notes" class="task-grid-inline-input" placeholder="Ghi chú…" ${commitAttr}></td>
      <td class="task-grid-cell py-2 pr-3 text-center"><input type="checkbox" data-tfield="cde_report" class="task-grid-cde-check" onchange="taskGridCommitRow(event, null, '${ctx}')" onkeydown="taskGridCellKeydown(event, null, '${ctx}')"></td>
      <td class="py-2"></td>
    </tr>`
}

function _taskGridRenderProjectNewRow(projectId) {
  const ctx = 'project'
  const { isMember } = _taskGridPermissions(null, projectId)
  const commitAttr = `onblur="taskGridCommitRow(event, null, '${ctx}')" onkeydown="taskGridCellKeydown(event, null, '${ctx}')"`
  return `
    <tr class="task-grid-row is-new" data-task-id="" data-grid-context="${ctx}" data-project-id="${projectId}" data-needs-cb="1">
      <td class="task-grid-cell py-1.5 pr-3">
        <div class="task-grid-title-wrap">
          ${_taskGridStatusRingHtml('todo', 'Hàng mới')}
          <input type="text" data-tfield="title" class="task-grid-inline-input task-grid-title-input" placeholder="Tên task (Enter lưu, Esc huỷ)…" ${commitAttr} onpaste="taskGridTitlePaste(event, null, '${ctx}')">
        </div>
      </td>
      <td class="task-grid-cell py-1.5 pr-3"><div id="taskGridCat_${ctx}_new" data-tfield-cb="category_id" class="task-grid-cb-host"></div></td>
      <td class="task-grid-cell py-1.5 pr-3">${_taskGridTypeSelectHtml('model', false, null, ctx)}</td>
      ${_taskGridFilenameNewCellHtml(projectId, commitAttr, 'py-1.5')}
      <td class="task-grid-cell py-1.5 pr-3">${_taskGridDisciplineSelectHtml('', false)}</td>
      <td class="task-grid-cell py-1.5 pr-3">${_taskGridPhaseSelectHtml('basic_design', false, null, ctx)}</td>
      <td class="task-grid-cell py-1.5 pr-3">${_taskGridPrioritySelectHtml('medium', false)}</td>
      <td class="task-grid-cell py-1.5 pr-3"><div id="taskGridAsg_${ctx}_new" data-tfield-cb="assigned_to" class="task-grid-cb-host"></div></td>
      <td class="task-grid-cell py-1.5 pr-3"><input type="date" data-tfield="start_date" class="task-grid-due-pill" ${commitAttr}></td>
      <td class="task-grid-cell py-1.5 pr-3"><input type="date" data-tfield="due_date" class="task-grid-due-pill" ${commitAttr}></td>
      ${_taskGridProgressCellHtml(0, false, commitAttr, 'py-1.5')}
      <td class="task-grid-cell py-1.5 pr-3">${_taskGridStatusSelectHtml('todo', false, null, ctx)}</td>
      <td class="task-grid-cell py-1.5 pr-3"><input type="text" data-tfield="hstk_date" class="task-grid-inline-input" placeholder="Theo HSTK…" ${commitAttr}></td>
      <td class="task-grid-cell py-1.5 pr-3"><input type="text" data-tfield="work_notes" class="task-grid-inline-input" placeholder="Ghi chú…" ${commitAttr}></td>
      <td class="task-grid-cell py-1.5 pr-3 text-center"><input type="checkbox" data-tfield="cde_report" class="task-grid-cde-check" onchange="taskGridCommitRow(event, null, '${ctx}')" onkeydown="taskGridCellKeydown(event, null, '${ctx}')"></td>
    </tr>`
}

// ── Project detail task pagination ──────────────────────────────
const PROJ_TASK_PAGE_SIZE = 20
let _projTaskPage = 1
let _projTaskAllData = []

function projTaskPaginatedData() {
  const start = (_projTaskPage - 1) * PROJ_TASK_PAGE_SIZE
  return _projTaskAllData.slice(start, start + PROJ_TASK_PAGE_SIZE)
}

