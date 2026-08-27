import { describe, expect, it } from 'vitest'
import {
  applyWorkDateFilter,
  computeBookedRevenue,
  computeProjectBudget,
  computeProjectLaborFromAggregates,
  computeRealtimeLaborFromAggregates,
  dayAfter,
  enrichPaymentMetrics,
  filterMlcMonths,
  monthDateRange,
  taskComputedProgress,
  yearDateRange,
  yearMonthKey,
} from './finance'

describe('computeBookedRevenue (migration 0037 example)', () => {
  it('VAT 10% only: 1_100_000 → 1_000_000 booked', () => {
    const r = computeBookedRevenue(1_100_000, 10, 0)
    expect(r.amountBeforeVat).toBe(1_000_000)
    expect(r.bookedRevenue).toBe(1_000_000)
  })

  it('fee 30% only: 1_000_000 → 700_000 booked', () => {
    const r = computeBookedRevenue(1_000_000, 0, 30)
    expect(r.amountBeforeVat).toBe(1_000_000)
    expect(r.bookedRevenue).toBe(700_000)
  })

  it('VAT 10% then fee 30%: 1_100_000 → 700_000 booked', () => {
    const r = computeBookedRevenue(1_100_000, 10, 30)
    expect(r.amountBeforeVat).toBe(1_000_000)
    expect(r.bookedRevenue).toBe(700_000)
  })

  it('zero acceptance yields zeros', () => {
    expect(computeBookedRevenue(0, 10, 30)).toEqual({ amountBeforeVat: 0, bookedRevenue: 0 })
  })
})

describe('computeProjectBudget', () => {
  it('applies management fee', () => {
    expect(computeProjectBudget(10_000_000, 30)).toBe(7_000_000)
  })
  it('zero contract is zero budget', () => {
    expect(computeProjectBudget(0, 30)).toBe(0)
  })
})

describe('date ranges (index-friendly)', () => {
  it('monthDateRange uses exclusive end', () => {
    expect(monthDateRange(2026, 8)).toEqual({ start: '2026-08-01', endExclusive: '2026-09-01' })
    expect(monthDateRange(2026, 12)).toEqual({ start: '2026-12-01', endExclusive: '2027-01-01' })
  })
  it('yearDateRange uses exclusive end', () => {
    expect(yearDateRange(2026)).toEqual({ start: '2026-01-01', endExclusive: '2027-01-01' })
  })
})

describe('enrichPaymentMetrics', () => {
  it('exposes the three money fields', () => {
    const m = enrichPaymentMetrics({ amount: 1_100_000, paid_amount: 500_000, vat_pct: 10 }, 30)
    expect(m.acceptance_amount).toBe(1_100_000)
    expect(m.amount_before_vat).toBe(1_000_000)
    expect(m.booked_revenue).toBe(700_000)
    expect(m.cash_collected).toBe(500_000)
  })
})

describe('applyWorkDateFilter', () => {
  it('uses a half-open month range', () => {
    expect(applyWorkDateFilter(2026, 8, 'ts.work_date')).toEqual({
      sql: ' AND ts.work_date >= ? AND ts.work_date < ?',
      params: ['2026-08-01', '2026-09-01'],
    })
  })
  it('uses a half-open year range', () => {
    expect(applyWorkDateFilter('2026', '', 'work_date')).toEqual({
      sql: ' AND work_date >= ? AND work_date < ?',
      params: ['2026-01-01', '2027-01-01'],
    })
  })
  it('month without year uses the current calendar year', () => {
    const y = new Date().getFullYear()
    expect(applyWorkDateFilter(null, 8, 'work_date')).toEqual({
      sql: ' AND work_date >= ? AND work_date < ?',
      params: [`${y}-08-01`, `${y}-09-01`],
    })
  })
})

describe('taskComputedProgress', () => {
  it('is done/open tasks, not projects.progress', () => {
    expect(taskComputedProgress(4, 1)).toBe(25)
    expect(taskComputedProgress(0, 0)).toBe(0)
  })
})

describe('labor allocation (Wave 1a parity)', () => {
  const OT = 1.5
  const months = [
    { year: 2026, month: 8, pool: 100_000_000 },
    { year: 2026, month: 9, pool: 100_000_000 },
  ]

  it('rounds per calendar month then sums (not round at total)', () => {
    const projByMonth = new Map([
      [yearMonthKey(2026, 8), { proj_raw: 10, proj_eff: 10 }],
      [yearMonthKey(2026, 9), { proj_raw: 15, proj_eff: 15 }],
    ])
    const compEffByMonth = new Map([
      [yearMonthKey(2026, 8), 100],
      [yearMonthKey(2026, 9), 100],
    ])
    // month 8: round(10 * 1M) = 10M; month 9: round(15 * 1M) = 15M
    expect(computeProjectLaborFromAggregates(months, projByMonth, compEffByMonth)).toBe(25_000_000)
  })

  it('applies OT factor on effective hours only', () => {
    // regular=8, OT=2 → proj_raw=10, proj_eff=8+2*1.5=11
    const projByMonth = new Map([
      [yearMonthKey(2026, 8), { proj_raw: 10, proj_eff: 8 + 2 * OT }],
    ])
    const compEffByMonth = new Map([
      [yearMonthKey(2026, 8), 100],
    ])
    expect(computeProjectLaborFromAggregates([months[0]], projByMonth, compEffByMonth)).toBe(
      Math.round(11 * (100_000_000 / 100))
    )
  })

  it('includes leave hours in company denominator (no day_type filter)', () => {
    // project 10h raw; company 100h includes 8h leave → smaller share
    const projByMonth = new Map([
      [yearMonthKey(2026, 8), { proj_raw: 10, proj_eff: 10 }],
    ])
    const compEffByMonth = new Map([
      [yearMonthKey(2026, 8), 100], // leave rows counted in comp_eff
    ])
    expect(computeProjectLaborFromAggregates([months[0]], projByMonth, compEffByMonth)).toBe(10_000_000)
  })

  it('skips month when proj_raw <= 0 or comp_eff <= 0', () => {
    const projByMonth = new Map([
      [yearMonthKey(2026, 8), { proj_raw: 0, proj_eff: 0 }],
    ])
    const compEffByMonth = new Map([
      [yearMonthKey(2026, 8), 100],
    ])
    expect(computeProjectLaborFromAggregates([months[0]], projByMonth, compEffByMonth)).toBe(0)
  })

  it('realtime map aggregates multiple projects and skips null project_id', () => {
    const projRows = [
      { project_id: 1, year: 2026, month: 8, raw_hours: 10, eff_hours: 10 },
      { project_id: 2, year: 2026, month: 8, raw_hours: 20, eff_hours: 20 },
      { project_id: null as unknown as number, year: 2026, month: 8, raw_hours: 8, eff_hours: 8 },
    ]
    const compEffByMonth = new Map([[yearMonthKey(2026, 8), 100]])
    const map = computeRealtimeLaborFromAggregates([months[0]], projRows, compEffByMonth)
    expect(map.get(1)).toEqual({ labor_cost: 10_000_000, labor_hours: 10 })
    expect(map.get(2)).toEqual({ labor_cost: 20_000_000, labor_hours: 20 })
    expect(map.has(null as unknown as number)).toBe(false)
  })

  it('filterMlcMonths respects NTC inclusive end date year-month', () => {
    const rows = [
      { year: 2026, month: 2, total_labor_cost: 50_000_000 },
      { year: 2027, month: 1, total_labor_cost: 50_000_000 },
      { year: 2025, month: 12, total_labor_cost: 50_000_000 },
    ]
    const filtered = filterMlcMonths(rows, '2026-02-01', '2027-01-31')
    expect(filtered.map(m => m.year * 100 + m.month).sort()).toEqual([202602, 202701])
  })

  it('dayAfter converts inclusive NTC end to half-open exclusive', () => {
    expect(dayAfter('2027-01-31')).toBe('2027-02-01')
    expect(dayAfter('2026-12-31')).toBe('2027-01-01')
  })
})
