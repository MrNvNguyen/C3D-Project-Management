/** Single source of truth for money, dates, and labor allocation. */

export const TASK_OVERDUE_SQL =
  `due_date IS NOT NULL AND due_date < date('now') AND status NOT IN ('completed','review','cancelled')`

export const TASK_DONE_SQL = `status IN ('completed','review')`
export const TASK_OPEN_TOTAL_SQL = `status != 'cancelled'`

export function computeBookedRevenue(
  acceptanceAmount: number,
  vatPct: number,
  feePct: number
): { amountBeforeVat: number; bookedRevenue: number } {
  const rawAmount = Number(acceptanceAmount) || 0
  const vat = Number(vatPct) || 0
  const fee = Number(feePct) || 0
  const amountBeforeVat = vat > 0 ? Math.round(rawAmount / (1 + vat / 100)) : rawAmount
  const bookedRevenue = fee > 0 ? Math.round(amountBeforeVat * (1 - fee / 100)) : amountBeforeVat
  return { amountBeforeVat, bookedRevenue }
}

export function computeProjectBudget(contractValue: number, feePct: number): number {
  const cv = Number(contractValue) || 0
  const fee = Number(feePct) || 0
  return cv > 0 ? Math.round(cv * (1 - fee / 100)) : 0
}

export function monthDateRange(year: number, month: number): { start: string; endExclusive: string } {
  const y = Number(year)
  const m = Number(month)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const nextM = m === 12 ? 1 : m + 1
  const nextY = m === 12 ? y + 1 : y
  return { start, endExclusive: `${nextY}-${String(nextM).padStart(2, '0')}-01` }
}

export function yearDateRange(year: number): { start: string; endExclusive: string } {
  const y = Number(year)
  return { start: `${y}-01-01`, endExclusive: `${y + 1}-01-01` }
}

/** Index-friendly date predicate. Prefer this over strftime('%Y'/'%m'). */
export function applyWorkDateFilter(
  year?: string | number | null,
  month?: string | number | null,
  col = 'work_date'
): { sql: string; params: string[] } {
  const y = year != null && year !== '' ? Number(year) : 0
  const m = month != null && month !== '' ? Number(month) : 0
  if (m && !y) {
    return applyWorkDateFilter(new Date().getFullYear(), m, col)
  }
  if (y && m) {
    const { start, endExclusive } = monthDateRange(y, m)
    return { sql: ` AND ${col} >= ? AND ${col} < ?`, params: [start, endExclusive] }
  }
  if (y) {
    const { start, endExclusive } = yearDateRange(y)
    return { sql: ` AND ${col} >= ? AND ${col} < ?`, params: [start, endExclusive] }
  }
  return { sql: '', params: [] }
}

export function taskComputedProgress(totalTasks: number, doneTasks: number): number {
  const total = Number(totalTasks) || 0
  const done = Number(doneTasks) || 0
  return total > 0 ? Math.round((done / total) * 100) : 0
}

export function paymentStatusToRevenue(status: string): string {
  if (status === 'paid') return 'paid'
  if (status === 'partial') return 'partial'
  return 'pending'
}

export function enrichPaymentMetrics(payment: {
  amount?: number
  paid_amount?: number
  vat_pct?: number | null
}, feePct: number) {
  const acceptance = Number(payment.amount) || 0
  const { amountBeforeVat, bookedRevenue } = computeBookedRevenue(
    acceptance,
    payment.vat_pct ?? 0,
    feePct
  )
  return {
    acceptance_amount: acceptance,
    amount_before_vat: amountBeforeVat,
    booked_revenue: bookedRevenue,
    cash_collected: Number(payment.paid_amount) || 0,
  }
}

export function enrichRevenueRow(row: {
  amount?: number
  paid_amount_original?: number
  paid_amount?: number
  vat_pct?: number
  fee_pct?: number
  payment_status?: string
  source?: string
}) {
  const feePct = Number(row.fee_pct) || 0
  const vatPct = Number(row.vat_pct) || 0
  const isPendingPayment = row.source === 'payment_request' || row.payment_status === 'pending'
  const acceptance = Number(row.paid_amount_original ?? (isPendingPayment ? row.amount : row.paid_amount_original)) || 0
  const fallbackAcceptance = acceptance || Number(row.amount) || 0
  const { amountBeforeVat, bookedRevenue } = computeBookedRevenue(fallbackAcceptance, vatPct, feePct)
  return {
    ...row,
    acceptance_amount: fallbackAcceptance,
    amount_before_vat: amountBeforeVat,
    booked_revenue: isPendingPayment ? bookedRevenue : (Number(row.amount) || bookedRevenue),
    cash_collected: Number(row.paid_amount) || 0,
  }
}

export async function syncPaymentToRevenue(
  db: D1Database,
  payment: {
    id: number
    project_id: number
    description: string
    amount: number
    paid_amount: number
    currency: string
    paid_date: string | null
    invoice_number: string | null
    payment_phase: string | null
    status: string
    revenue_id: number | null
    notes: string | null
    vat_pct?: number | null
  },
  userId: number
): Promise<number | null> {
  const rawAmount = payment.amount || 0
  const shouldSync = rawAmount > 0

  const projRow = await db.prepare(
    'SELECT management_fee_pct FROM projects WHERE id = ?'
  ).bind(payment.project_id).first() as { management_fee_pct?: number } | null
  const feePct = (projRow?.management_fee_pct || 0) as number
  const vatPct = (payment.vat_pct != null ? payment.vat_pct : 0) as number
  const { amountBeforeVat, bookedRevenue: syncAmount } = computeBookedRevenue(rawAmount, vatPct, feePct)

  if (!shouldSync) {
    if (payment.revenue_id) {
      await db.prepare('DELETE FROM project_revenues WHERE id = ?').bind(payment.revenue_id).run()
      await db.prepare('UPDATE payment_requests SET revenue_id = NULL WHERE id = ?').bind(payment.id).run()
    }
    return null
  }

  const revenueDesc = payment.payment_phase
    ? `[${payment.payment_phase}] ${payment.description}`
    : payment.description
  const revenueStatus = paymentStatusToRevenue(payment.status)
  const revenueDate = payment.status === 'pending' ? null : (payment.paid_date || null)

  let calcNote = ''
  if (vatPct > 0 && feePct > 0) {
    calcNote = `\n[NT: ${rawAmount.toLocaleString('vi-VN')} VNĐ ÷ ${(100 + vatPct)}% = ${amountBeforeVat.toLocaleString('vi-VN')} VNĐ trước thuế → Phí QL ${feePct}%: × ${(100 - feePct)}% = ${syncAmount.toLocaleString('vi-VN')} VNĐ doanh thu]`
  } else if (vatPct > 0) {
    calcNote = `\n[NT: ${rawAmount.toLocaleString('vi-VN')} VNĐ ÷ ${(100 + vatPct)}% = ${syncAmount.toLocaleString('vi-VN')} VNĐ trước thuế]`
  } else if (feePct > 0) {
    calcNote = `\n[NT: ${rawAmount.toLocaleString('vi-VN')} VNĐ × ${(100 - feePct)}% = ${syncAmount.toLocaleString('vi-VN')} VNĐ]`
  }
  const paidRef = payment.paid_amount > 0
    ? `\n[Dòng tiền thực thu: ${payment.paid_amount.toLocaleString('vi-VN')} VNĐ]`
    : ''
  const revenueNotes = `[Đồng bộ từ Hồ Sơ Pháp Lý - Giá trị nghiệm thu]${calcNote}${paidRef}${payment.notes ? '\n' + payment.notes : ''}`

  if (payment.revenue_id) {
    await db.prepare(`
      UPDATE project_revenues
      SET description = ?, amount = ?, amount_original = ?, currency = ?, revenue_date = ?,
          invoice_number = ?, payment_status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      revenueDesc, syncAmount, rawAmount, payment.currency || 'VND',
      revenueDate, payment.invoice_number || null,
      revenueStatus, revenueNotes, payment.revenue_id
    ).run()
    return payment.revenue_id
  }

  const result = await db.prepare(`
    INSERT INTO project_revenues
      (project_id, description, amount, amount_original, currency, revenue_date, invoice_number, payment_status, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(
    payment.project_id, revenueDesc, syncAmount, rawAmount, payment.currency || 'VND',
    revenueDate, payment.invoice_number || null,
    revenueStatus, revenueNotes, userId
  ).run()
  return result.meta.last_row_id as number
}

/** Calendar month key for joining MLC rows with aggregated timesheet hours. */
export function yearMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

/** YYYY-MM from date string → sortable integer (matches legacy MLC range filter). */
export function parseYearMonthFromDate(dateStr: string): number {
  const [y, m] = dateStr.split('-')
  return Number(y) * 100 + Number(m)
}

/** Inclusive end date → exclusive bound for half-open SQL ranges. */
export function dayAfter(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + 1))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export type MlcMonth = { year: number; month: number; pool: number }

export function filterMlcMonths(
  rows: Array<{ year: number; month: number; total_labor_cost: number }>,
  dateFrom?: string,
  dateTo?: string
): MlcMonth[] {
  let months = rows.map(r => ({
    year: r.year,
    month: r.month,
    pool: r.total_labor_cost || 0,
  }))
  if (dateFrom && dateTo) {
    const fromYm = parseYearMonthFromDate(dateFrom)
    const toYm = parseYearMonthFromDate(dateTo)
    months = months.filter(m => {
      const ym = m.year * 100 + m.month
      return ym >= fromYm && ym <= toYm
    })
  }
  return months
}

/** Pure allocation: round per calendar month, then sum (TU-DIEN SSOT). */
export function computeProjectLaborFromAggregates(
  months: MlcMonth[],
  projByMonth: Map<string, { proj_raw: number; proj_eff: number }>,
  compEffByMonth: Map<string, number>
): number {
  let laborCost = 0
  for (const { year, month, pool } of months) {
    if (pool <= 0) continue
    const key = yearMonthKey(year, month)
    const proj = projByMonth.get(key)
    const projRaw = proj?.proj_raw || 0
    const projEff = proj?.proj_eff || 0
    const compEff = compEffByMonth.get(key) || 0
    if (projRaw <= 0 || compEff <= 0) continue
    laborCost += Math.round(projEff * (pool / compEff))
  }
  return laborCost
}

export type ProjectMonthHours = {
  project_id: number
  year: number
  month: number
  raw_hours: number
  eff_hours: number
}

/** Pure allocation for all projects (realtime labor map). */
export function computeRealtimeLaborFromAggregates(
  months: MlcMonth[],
  projRows: ProjectMonthHours[],
  compEffByMonth: Map<string, number>
): Map<number, { labor_cost: number; labor_hours: number }> {
  const result = new Map<number, { labor_cost: number; labor_hours: number }>()
  const poolByKey = new Map(months.map(m => [yearMonthKey(m.year, m.month), m.pool]))

  for (const pr of projRows) {
    if (pr.project_id == null) continue
    const key = yearMonthKey(pr.year, pr.month)
    const pool = poolByKey.get(key) || 0
    if (pool <= 0) continue
    const compEff = compEffByMonth.get(key) || 0
    if (compEff <= 0) continue
    const cph = pool / compEff
    const laborCost = Math.round((pr.eff_hours || 0) * cph)
    const rawHours = pr.raw_hours || 0
    const prev = result.get(pr.project_id) || { labor_cost: 0, labor_hours: 0 }
    result.set(pr.project_id, {
      labor_cost: prev.labor_cost + laborCost,
      labor_hours: prev.labor_hours + rawHours,
    })
  }
  return result
}

export async function fetchCompanyEffHoursByMonth(
  db: D1Database,
  overtimeFactor: number,
  start: string,
  endExclusive: string
): Promise<Map<string, number>> {
  const rows = await db.prepare(`
    SELECT CAST(substr(work_date, 1, 4) AS INTEGER) as year,
           CAST(substr(work_date, 6, 2) AS INTEGER) as month,
           SUM(regular_hours + IFNULL(overtime_hours, 0) * ?) as comp_eff,
           SUM(regular_hours + IFNULL(overtime_hours, 0)) as comp_raw
    FROM timesheets
    WHERE work_date >= ? AND work_date < ?
    GROUP BY year, month
  `).bind(overtimeFactor, start, endExclusive).all()
  const map = new Map<string, number>()
  for (const r of (rows.results || []) as { year: number; month: number; comp_eff?: number }[]) {
    map.set(yearMonthKey(r.year, r.month), r.comp_eff || 0)
  }
  return map
}

/** Company hours with both raw and eff (for monthly_totals UI). */
export async function fetchCompanyHoursByMonthFull(
  db: D1Database,
  overtimeFactor: number,
  start: string,
  endExclusive: string
): Promise<Map<string, { comp_eff: number; comp_raw: number }>> {
  const rows = await db.prepare(`
    SELECT CAST(substr(work_date, 1, 4) AS INTEGER) as year,
           CAST(substr(work_date, 6, 2) AS INTEGER) as month,
           SUM(regular_hours + IFNULL(overtime_hours, 0) * ?) as comp_eff,
           SUM(regular_hours + IFNULL(overtime_hours, 0)) as comp_raw
    FROM timesheets
    WHERE work_date >= ? AND work_date < ?
    GROUP BY year, month
  `).bind(overtimeFactor, start, endExclusive).all()
  const map = new Map<string, { comp_eff: number; comp_raw: number }>()
  for (const r of (rows.results || []) as { year: number; month: number; comp_eff?: number; comp_raw?: number }[]) {
    map.set(yearMonthKey(r.year, r.month), {
      comp_eff: r.comp_eff || 0,
      comp_raw: r.comp_raw || 0,
    })
  }
  return map
}

export async function fetchProjectHoursByMonth(
  db: D1Database,
  projectId: number,
  overtimeFactor: number,
  start: string,
  endExclusive: string
): Promise<Map<string, { proj_raw: number; proj_eff: number }>> {
  const rows = await db.prepare(`
    SELECT CAST(substr(work_date, 1, 4) AS INTEGER) as year,
           CAST(substr(work_date, 6, 2) AS INTEGER) as month,
           SUM(regular_hours + IFNULL(overtime_hours, 0)) as proj_raw,
           SUM(regular_hours + IFNULL(overtime_hours, 0) * ?) as proj_eff
    FROM timesheets
    WHERE project_id = ? AND work_date >= ? AND work_date < ?
    GROUP BY year, month
  `).bind(overtimeFactor, projectId, start, endExclusive).all()
  const map = new Map<string, { proj_raw: number; proj_eff: number }>()
  for (const r of (rows.results || []) as { year: number; month: number; proj_raw?: number; proj_eff?: number }[]) {
    map.set(yearMonthKey(r.year, r.month), {
      proj_raw: r.proj_raw || 0,
      proj_eff: r.proj_eff || 0,
    })
  }
  return map
}

export async function fetchAllProjectsHoursByMonth(
  db: D1Database,
  overtimeFactor: number,
  start: string,
  endExclusive: string
): Promise<ProjectMonthHours[]> {
  const rows = await db.prepare(`
    SELECT project_id,
           CAST(substr(work_date, 1, 4) AS INTEGER) as year,
           CAST(substr(work_date, 6, 2) AS INTEGER) as month,
           SUM(regular_hours + IFNULL(overtime_hours, 0)) as raw_hours,
           SUM(regular_hours + IFNULL(overtime_hours, 0) * ?) as eff_hours
    FROM timesheets
    WHERE project_id IS NOT NULL AND work_date >= ? AND work_date < ?
    GROUP BY project_id, year, month
  `).bind(overtimeFactor, start, endExclusive).all()
  return (rows.results || []) as ProjectMonthHours[]
}

export function calendarPairsSpan(
  pairs: Array<{ year: number; month: number }>
): { start: string; endExclusive: string } | null {
  if (pairs.length === 0) return null
  const sorted = [...pairs].sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  return {
    start: monthDateRange(first.year, first.month).start,
    endExclusive: monthDateRange(last.year, last.month).endExclusive,
  }
}

/** Half-open OR filter for selected calendar months (index-friendly). */
export function calendarMonthsOrFilter(
  pairs: Array<{ year: number; month: number }>,
  col: string
): string {
  if (pairs.length === 0) return '0'
  const parts = pairs.map(({ year, month }) => {
    const { start, endExclusive } = monthDateRange(year, month)
    return `(${col} >= '${start}' AND ${col} < '${endExclusive}')`
  })
  return parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`
}

export type ProjectLaborAllocation = {
  laborCost: number
  laborHours: number
  laborEffHours: number
  laborMonthsCount: number
  /** Per-month allocated cost for timeline UI */
  byMonth: Map<string, number>
}

/** Allocate one project's labor for explicit calendar month pairs (full months, no FY clip). */
export async function allocateProjectLaborForCalendarMonths(
  db: D1Database,
  overtimeFactor: number,
  projectId: number,
  pairs: Array<{ year: number; month: number }>
): Promise<ProjectLaborAllocation> {
  const empty: ProjectLaborAllocation = {
    laborCost: 0, laborHours: 0, laborEffHours: 0, laborMonthsCount: 0, byMonth: new Map(),
  }
  if (pairs.length === 0) return empty
  const span = calendarPairsSpan(pairs)
  if (!span) return empty

  const pairKeys = new Set(pairs.map(p => yearMonthKey(p.year, p.month)))
  const mlc = await db.prepare(
    `SELECT month, year, total_labor_cost FROM monthly_labor_costs WHERE total_labor_cost > 0`
  ).all()
  const months = ((mlc.results || []) as { month: number; year: number; total_labor_cost: number }[])
    .filter(r => pairKeys.has(yearMonthKey(r.year, r.month)))
    .map(r => ({ year: r.year, month: r.month, pool: r.total_labor_cost || 0 }))

  if (months.length === 0) return empty

  const [projByMonth, compEffByMonth] = await Promise.all([
    fetchProjectHoursByMonth(db, projectId, overtimeFactor, span.start, span.endExclusive),
    fetchCompanyEffHoursByMonth(db, overtimeFactor, span.start, span.endExclusive),
  ])

  let laborCost = 0
  let laborHours = 0
  let laborEffHours = 0
  let laborMonthsCount = 0
  const byMonth = new Map<string, number>()

  for (const { year, month, pool } of months) {
    if (pool <= 0) continue
    const key = yearMonthKey(year, month)
    const proj = projByMonth.get(key)
    const projRaw = proj?.proj_raw || 0
    const projEff = proj?.proj_eff || 0
    const compEff = compEffByMonth.get(key) || 0
    if (projRaw <= 0 || compEff <= 0) continue
    const mc = Math.round(projEff * (pool / compEff))
    laborCost += mc
    laborHours += projRaw
    laborEffHours += projEff
    laborMonthsCount++
    byMonth.set(key, mc)
  }

  return { laborCost, laborHours, laborEffHours, laborMonthsCount, byMonth }
}

function mlcDateSpan(
  mlcRows: Array<{ year: number; month: number }>,
  dateFrom?: string,
  dateTo?: string
): { start: string; endExclusive: string } {
  if (dateFrom && dateTo) {
    return { start: dateFrom, endExclusive: dayAfter(dateTo) }
  }
  const sorted = [...mlcRows].sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  return {
    start: monthDateRange(first.year, first.month).start,
    endExclusive: monthDateRange(last.year, last.month).endExclusive,
  }
}

/** Labor KPI: monthly_labor_costs allocated by timesheet hours. Not project_labor_costs cache. */
export async function computeProjectLaborFromTimesheets(
  db: D1Database,
  projectId: number,
  overtimeFactor: number
): Promise<number> {
  const mlc = await db.prepare(
    `SELECT month, year, total_labor_cost FROM monthly_labor_costs WHERE total_labor_cost > 0 ORDER BY year, month`
  ).all()
  const mlcRows = (mlc.results || []) as { month: number; year: number; total_labor_cost: number }[]
  if (mlcRows.length === 0) return 0

  const months = filterMlcMonths(mlcRows)
  const { start, endExclusive } = mlcDateSpan(mlcRows)

  const [projByMonth, compEffByMonth] = await Promise.all([
    fetchProjectHoursByMonth(db, projectId, overtimeFactor, start, endExclusive),
    fetchCompanyEffHoursByMonth(db, overtimeFactor, start, endExclusive),
  ])

  return computeProjectLaborFromAggregates(months, projByMonth, compEffByMonth)
}

/** Realtime labor per project; optional inclusive dateFrom/dateTo (NTC range). */
export async function computeRealtimeLaborByProject(
  db: D1Database,
  otFactor: number,
  dateFrom?: string,
  dateTo?: string
): Promise<Map<number, { labor_cost: number; labor_hours: number }>> {
  let mlcRows: { year: number; month: number; total_labor_cost: number }[]
  if (dateFrom && dateTo) {
    const fromYm = parseYearMonthFromDate(dateFrom)
    const toYm = parseYearMonthFromDate(dateTo)
    const mlc = await db.prepare(`
      SELECT year, month, total_labor_cost FROM monthly_labor_costs
      WHERE (year * 100 + month) >= ? AND (year * 100 + month) <= ?
      ORDER BY year, month
    `).bind(fromYm, toYm).all()
    mlcRows = (mlc.results || []) as typeof mlcRows
  } else {
    const mlc = await db.prepare(`
      SELECT year, month, total_labor_cost FROM monthly_labor_costs ORDER BY year, month
    `).all()
    mlcRows = (mlc.results || []) as typeof mlcRows
  }

  const months = filterMlcMonths(mlcRows, dateFrom, dateTo)
  if (months.length === 0) return new Map()

  const { start, endExclusive } = mlcDateSpan(mlcRows, dateFrom, dateTo)

  const [projRows, compEffByMonth] = await Promise.all([
    fetchAllProjectsHoursByMonth(db, otFactor, start, endExclusive),
    fetchCompanyEffHoursByMonth(db, otFactor, start, endExclusive),
  ])

  return computeRealtimeLaborFromAggregates(months, projRows, compEffByMonth)
}

/** Month-level labor pool stats (admin monthly entry + company hours). */
export async function computeMonthLaborCost(
  db: D1Database,
  mInt: number,
  yInt: number,
  overtimeFactor: number
) {
  const { start, endExclusive } = monthDateRange(yInt, mInt)
  const manualEntry = await db.prepare(
    `SELECT total_labor_cost, notes FROM monthly_labor_costs WHERE month = ? AND year = ?`
  ).bind(mInt, yInt).first() as { total_labor_cost?: number; notes?: string } | null
  const salaryPool = await db.prepare(
    `SELECT SUM(salary_monthly) as total FROM users WHERE is_active = 1 AND role != 'system_admin'`
  ).first() as { total?: number } | null
  const totalHoursRow = await db.prepare(
    `SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as raw_hours,
            SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as effective_hours
     FROM timesheets
     WHERE work_date >= ? AND work_date < ?`
  ).bind(overtimeFactor, start, endExclusive).first() as { raw_hours?: number; effective_hours?: number } | null
  const totalHrs = totalHoursRow?.raw_hours || 0
  const totalEffectHrs = totalHoursRow?.effective_hours || 0
  const laborCostSource = manualEntry ? (manualEntry.total_labor_cost || 0) : 0
  const costPerHour = (totalEffectHrs > 0 && laborCostSource > 0) ? laborCostSource / totalEffectHrs : 0
  return {
    laborCostSource,
    totalHrs,
    totalEffectHrs,
    costPerHour,
    isManual: !!manualEntry,
    notes: manualEntry?.notes || '',
    salaryPoolRef: salaryPool?.total || 0,
  }
}

export async function resolveAssigneeNames(db: D1Database, idsJson: string | null): Promise<string> {
  let ids: number[] = []
  try { ids = JSON.parse(idsJson || '[]') } catch { ids = [] }
  if (!Array.isArray(ids) || ids.length === 0) return ''
  const placeholders = ids.map(() => '?').join(',')
  const rows = await db.prepare(
    `SELECT id, full_name FROM users WHERE id IN (${placeholders})`
  ).bind(...ids).all()
  const nameById = new Map((rows.results as { id: number; full_name: string }[]).map(u => [u.id, u.full_name]))
  return ids.map(id => nameById.get(id) || `#${id}`).join(', ')
}
