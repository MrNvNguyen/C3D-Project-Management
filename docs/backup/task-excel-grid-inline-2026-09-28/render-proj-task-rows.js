function renderProjTaskRows() {
  const tbody = document.getElementById('projTasksTbody')
  if (!tbody) return
  const projectId = window._currentProjectDetailId
  const data = projTaskPaginatedData()
  const rowsHtml = data.map(t => _taskGridRenderProjectDataRow(t)).join('')
  const newRow = projectId ? _taskGridRenderProjectNewRow(projectId) : ''
  tbody.innerHTML = rowsHtml + newRow
  if (!data.length && !projectId) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-gray-400 text-sm">Chưa có task — chọn dự án để thêm</td></tr>`
    return
  }
  tbody.querySelectorAll('.task-grid-row').forEach(row => {
    _taskGridBindCellFocus(row)
    if (row.dataset.needsCb === '1') _taskGridInitRowComboboxes(row)
  })
}

