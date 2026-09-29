function renderTaskRows() {
  const tbody = $('tasksTable')
  if (!tbody) return

  const tasks = _taskAllData.length ? taskPaginatedData() : []
  tbody.innerHTML = tasks.map(t => _taskGridRenderGlobalDataRow(t)).join('') + _taskGridRenderGlobalNewRow()
  tbody.querySelectorAll('.task-grid-row').forEach(row => {
    _taskGridBindCellFocus(row)
    if (row.dataset.needsCb === '1') _taskGridInitRowComboboxes(row)
  })
  renderTasksMobileCards(tasks)
}

