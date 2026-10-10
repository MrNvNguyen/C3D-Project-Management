import { describe, expect, it } from 'vitest'
import {
  aggregatePaymentsBeforeVat,
  aggregateThreeMoney,
  amountExcludingVat,
  applyWorkDateFilter,
  computeBookedRevenue,
  contractValueBeforeVat,
  displayRevenuePaymentStatus,
  computeLegalCostA,
  legalCostAAmountInUse,
  legalCostAInFiscalRange,
  legalCostAFormulaLabel,
  resolveLegalCostAPct,
  sumSpentLegalCostA,
  computeProjectBudget,
  computeProjectLaborFromAggregates,
  computeRealtimeLaborFromAggregates,
  dayAfter,
  enrichPaymentMetrics,
  enrichRevenueRow,
  filterMlcMonths,
  monthDateRange,
  sumPendingBookedFromPayments,
  revenueSyncDate,
  syncPaymentToRevenue,
  taskComputedProgress,
  yearDateRange,
  yearMonthKey,
} from './finance'

/** Minimal D1 mock for syncPaymentToRevenue integration tests. */
function createSyncTestDb(feePct = 30, onPackage = true) {
  const revenues = new Map<number, Record<string, unknown>>()
  let nextRevenueId = 1
  const ops: string[] = []
  let paymentRevenueNulled = false
  let deletedRevenueIds: number[] = []

  const db = {
    prepare(sql: string) {
      const state = { binds: [] as unknown[] }
      const stmt = {
        bind(...args: unknown[]) {
          state.binds.push(...args)
          return stmt
        },
        async first() {
          if (sql.includes('management_fee_pct')) {
            return { management_fee_pct: feePct }
          }
          if (sql.includes('FROM payment_requests pr WHERE pr.id')) {
            return onPackage ? { ok: 1 } : null
          }
          return null
        },
        async run() {
          ops.push(sql.trim().slice(0, 40))
          if (sql.includes('DELETE FROM project_revenues')) {
            const id = state.binds[0] as number
            deletedRevenueIds.push(id)
            revenues.delete(id)
          } else if (sql.includes('UPDATE payment_requests SET revenue_id = NULL')) {
            paymentRevenueNulled = true
          } else if (sql.includes('INSERT INTO project_revenues')) {
            const id = nextRevenueId++
            revenues.set(id, {
              id,
              amount: state.binds[2],
              amount_original: state.binds[3],
              revenue_date: state.binds[5],
              payment_status: state.binds[7],
            })
            return { meta: { last_row_id: id } }
          } else if (sql.includes('UPDATE project_revenues')) {
            const id = state.binds[state.binds.length - 1] as number
            const row = revenues.get(id)
            if (row) {
              row.amount = state.binds[1]
              row.revenue_date = state.binds[4]
              row.payment_status = state.binds[6]
            }
          }
          return { meta: { last_row_id: 0 } }
        },
      }
      return stmt
    },
  }

  return {
    db: db as unknown as D1Database,
    revenues,
    get ops() {
      return ops
    },
    get paymentRevenueNulled() {
      return paymentRevenueNulled
    },
    get deletedRevenueIds() {
      return deletedRevenueIds
    },
    resetTracking() {
      paymentRevenueNulled = false
      deletedRevenueIds = []
    },
  }
}

const basePayment = {
  id: 42,
  project_id: 1,
  description: 'NT đợt 1',
  amount: 1_100_000,
  paid_amount: 0,
  currency: 'VND',
  paid_date: null as string | null,
  invoice_number: null as string | null,
  payment_phase: null as string | null,
  revenue_id: null as number | null,
  notes: null as string | null,
  vat_pct: 10,
  request_date: '2026-03-15',
}

describe('syncPaymentToRevenue (Wave A sync gate)', () => {
  it('pending with amount does not create revenue', async () => {
    const { db, revenues } = createSyncTestDb()
    const id = await syncPaymentToRevenue(db, { ...basePayment, status: 'pending' }, 1)
    expect(id).toBeNull()
    expect(revenues.size).toBe(0)
  })

  it('paid revenue year follows acceptance date, not paid date', async () => {
    const { db, revenues } = createSyncTestDb(30)
    await syncPaymentToRevenue(db, {
      ...basePayment,
      status: 'processing',
      paid_date: '2026-09-30',
      request_date: '2026-06-15',
      created_at: '2026-09-30 02:00:00',
    }, 1)
    expect(revenues.get(1)!.revenue_date).toBe('2026-06-15')
  })

  it('blank acceptance date uses the payment entry date', async () => {
    const { db, revenues } = createSyncTestDb(30)
    await syncPaymentToRevenue(db, {
      ...basePayment,
      status: 'processing',
      request_date: null,
      paid_date: '2025-01-01',
      created_at: '2026-09-30 02:00:00',
    }, 1)
    expect(revenues.get(1)!.revenue_date).toBe('2026-09-30')
    expect(revenueSyncDate({ request_date: '', created_at: '2026-07-01T10:00:00Z' })).toBe('2026-07-01')
  })

  it('processing books 700_000 (1_100_000 VAT10 fee30) with request_date', async () => {
    const { db, revenues } = createSyncTestDb(30)
    const revId = await syncPaymentToRevenue(db, { ...basePayment, status: 'processing' }, 1)
    expect(revId).toBe(1)
    const row = revenues.get(1)!
    expect(row.amount).toBe(700_000)
    expect(row.revenue_date).toBe('2026-03-15')
    expect(row.payment_status).toBe('pending')
    expect(displayRevenuePaymentStatus('pending', 'processing')).toBe('processing')
  })

  it('lists a booked processing installment as processing, not as unpaid pending', () => {
    expect(displayRevenuePaymentStatus('pending', 'processing')).toBe('processing')
    expect(displayRevenuePaymentStatus('paid', 'paid')).toBe('paid')
    expect(displayRevenuePaymentStatus('pending', 'pending')).toBe('pending')
    expect(displayRevenuePaymentStatus('pending', null)).toBe('pending')
  })

  it('revert to pending deletes linked revenue and nulls payment link', async () => {
    const harness = createSyncTestDb(30)
    harness.revenues.set(99, { id: 99, amount: 700_000 })
    const id = await syncPaymentToRevenue(harness.db, {
      ...basePayment,
      status: 'pending',
      revenue_id: 99,
    }, 1)
    expect(id).toBeNull()
    expect(harness.deletedRevenueIds).toEqual([99])
    expect(harness.paymentRevenueNulled).toBe(true)
    expect(harness.revenues.has(99)).toBe(false)
  })

  it('installment not on a package drops its revenue row', async () => {
    const harness = createSyncTestDb(30, false)
    harness.revenues.set(77, { id: 77, amount: 700_000 })
    const id = await syncPaymentToRevenue(harness.db, {
      ...basePayment,
      status: 'paid',
      revenue_id: 77,
    }, 1)
    expect(id).toBeNull()
    expect(harness.deletedRevenueIds).toEqual([77])
    expect(harness.revenues.has(77)).toBe(false)
  })

  it('partial and paid book a revenue row', async () => {
    for (const status of ['partial', 'paid'] as const) {
      const { db, revenues } = createSyncTestDb(30)
      const id = await syncPaymentToRevenue(db, { ...basePayment, status }, 1)
      expect(id).toBe(1)
      expect(revenues.get(1)!.amount).toBe(700_000)
    }
  })

  it('rejected deletes linked revenue', async () => {
    const harness = createSyncTestDb(30)
    harness.revenues.set(88, { id: 88, amount: 700_000 })
    const id = await syncPaymentToRevenue(harness.db, {
      ...basePayment,
      status: 'rejected',
      revenue_id: 88,
    }, 1)
    expect(id).toBeNull()
    expect(harness.deletedRevenueIds).toEqual([88])
    expect(harness.paymentRevenueNulled).toBe(true)
  })
})

describe('computeLegalCostA (Wave D2 Chi phí A)', () => {
  it('1_395_000_000 gross, VAT 8%, fee 30% → 387_500_000', () => {
    expect(computeLegalCostA(1_395_000_000, 8, 30)).toBe(387_500_000)
  })

  it('155_000_000 gross, VAT 8%, fee 30% → 43_055_556', () => {
    expect(computeLegalCostA(155_000_000, 8, 30)).toBe(43_055_556)
  })

  it('blank percent uses 30', () => {
    expect(resolveLegalCostAPct(null)).toBe(30)
    expect(resolveLegalCostAPct(undefined)).toBe(30)
    expect(resolveLegalCostAPct(60)).toBe(60)
  })

  it('formula label is percent over the VAT divisor', () => {
    expect(legalCostAFormulaLabel(30, 8)).toBe('30%/1.08')
    expect(legalCostAFormulaLabel(60, 10)).toBe('60%/1.1')
    expect(legalCostAFormulaLabel(30, 0)).toBe('30%')
  })

  it('override replaces the formula', () => {
    expect(legalCostAAmountInUse(155_000_000, 8, 30, 10_000)).toBe(10_000)
    expect(legalCostAAmountInUse(155_000_000, 8, 30, null)).toBe(43_055_556)
  })

  it('totals count only spent rows', () => {
    expect(sumSpentLegalCostA([
      { spend_status: 'spent', amount_in_use: 5_108_000_000 },
      { spend_status: 'unspent', amount_in_use: 1_277_000_000 },
      { spend_status: null, amount_in_use: 100 },
    ])).toBe(5_108_000_000)
  })

  it('fiscal year uses paid date, lifetime is the caller’s unfiltered set', () => {
    const inYear = { status: 'paid', request_date: '2025-06-01', paid_date: '2026-03-15' }
    const otherYear = { status: 'paid', request_date: '2026-03-01', paid_date: '2025-11-01' }
    const pending = { status: 'pending', request_date: '2026-04-01', paid_date: null }
    const undated = { status: 'paid', request_date: null, paid_date: null }
    expect(legalCostAInFiscalRange(inYear, '2026-02-01', '2027-01-31')).toBe(true)
    expect(legalCostAInFiscalRange(otherYear, '2026-02-01', '2027-01-31')).toBe(false)
    expect(legalCostAInFiscalRange(pending, '2026-02-01', '2027-01-31')).toBe(true)
    expect(legalCostAInFiscalRange(undated, '2026-02-01', '2027-01-31')).toBe(false)
  })
})

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
    expect(m.cash_before_vat).toBe(454_545) // 500_000 / 1.1
    expect(enrichPaymentMetrics({ amount: 1_100_000, status: 'processing', vat_pct: 10 }, 30).booked_revenue).toBe(700_000)
    expect(enrichPaymentMetrics({ amount: 1_100_000, status: 'paid', vat_pct: 10 }, 30).booked_revenue).toBe(700_000)
    expect(enrichPaymentMetrics({ amount: 1_100_000, status: 'partial', vat_pct: 10 }, 30).booked_revenue).toBe(700_000)
    expect(enrichPaymentMetrics({ amount: 1_100_000, status: 'pending', vat_pct: 10 }, 30).booked_revenue).toBeNull()
    expect(enrichPaymentMetrics({ amount: 1_100_000, status: 'rejected', vat_pct: 10 }, 30).booked_revenue).toBeNull()
  })
})

describe('amountExcludingVat / aggregatePaymentsBeforeVat', () => {
  it('strips VAT from acceptance and cash', () => {
    expect(amountExcludingVat(544_000_000, 8)).toBe(503_703_704)
    const { acceptanceByProject, cashByProject } = aggregatePaymentsBeforeVat([
      { project_id: 1, amount: 544_000_000, paid_amount: 544_000_000, vat_pct: 8 },
    ])
    expect(acceptanceByProject[1]).toBe(503_703_704)
    expect(cashByProject[1]).toBe(503_703_704)
  })
})

describe('aggregateThreeMoney', () => {
  it('VAT 10%: nghiệm thu is processing+partial+paid; chờ thanh toán stays out of the total', () => {
    const r = aggregateThreeMoney([
      { status: 'pending', amount: 1_100_000, paid_amount: 0, vat_pct: 10 },
      { status: 'processing', amount: 1_100_000, paid_amount: 0, vat_pct: 10 },
      { status: 'partial', amount: 1_100_000, paid_amount: 550_000, vat_pct: 10 },
      { status: 'paid', amount: 1_100_000, paid_amount: 1_100_000, vat_pct: 10 },
      { status: 'rejected', amount: 1_100_000, paid_amount: 0, vat_pct: 10 },
      { status: 'cancelled', amount: 9_999_000, paid_amount: 9_999_000, vat_pct: 10 },
    ])
    expect(r.acceptanceBeforeVat).toBe(3_000_000)
    expect(r.pendingAcceptanceBeforeVat).toBe(1_000_000)
    // cash: 550k + 1.1M gross → before VAT 500_000 + 1_000_000
    expect(r.cashGross).toBe(1_650_000)
    expect(r.cashBeforeVat).toBe(1_500_000)
  })

  it('VAT 8%: 544M → 503_703_704 NT; cash only paid/partial', () => {
    const r = aggregateThreeMoney([
      { status: 'paid', amount: 544_000_000, paid_amount: 544_000_000, vat_pct: 8 },
      { status: 'pending', amount: 544_000_000, paid_amount: 0, vat_pct: 8 },
    ])
    expect(r.acceptanceBeforeVat).toBe(503_703_704)
    expect(r.pendingAcceptanceBeforeVat).toBe(503_703_704)
    expect(r.cashBeforeVat).toBe(503_703_704)
    expect(r.cashGross).toBe(544_000_000)
  })
})

describe('sumPendingBookedFromPayments', () => {
  it('pending VAT 8% fee 60%: 2_203_000_000 → NT 2_039_814_815, DT 815_925_926', () => {
    const r = sumPendingBookedFromPayments(
      [{ status: 'pending', amount: 2_203_000_000, vat_pct: 8, request_date: '2026-05-20' }],
      60
    )
    expect(r.pendingAcceptanceBeforeVat).toBe(2_039_814_815)
    expect(r.pendingBooked).toBe(815_925_926)
  })

  it('respects inclusive date range; skips non-pending', () => {
    const r = sumPendingBookedFromPayments(
      [
        { status: 'pending', amount: 1_100_000, vat_pct: 10, request_date: '2026-01-15' },
        { status: 'pending', amount: 1_100_000, vat_pct: 10, request_date: '2026-03-01' },
        { status: 'paid', amount: 1_100_000, vat_pct: 10, request_date: '2026-02-01' },
      ],
      30,
      { dateFrom: '2026-02-01', dateTo: '2026-02-28' }
    )
    expect(r.pendingBooked).toBe(0)
    expect(r.pendingAcceptanceBeforeVat).toBe(0)
  })
})

describe('enrichRevenueRow', () => {
  it('pending 1.1tr / VAT 10% / fee 30% → NT 1M, DT_NS 700k, GTTT 0', () => {
    const m = enrichRevenueRow({
      source: 'payment_request',
      payment_status: 'pending',
      amount: 1_100_000,
      paid_amount_original: 1_100_000,
      paid_amount: 0,
      vat_pct: 10,
      fee_pct: 30,
    })
    expect(m.amount_before_vat).toBe(1_000_000)
    expect(m.booked_revenue).toBe(700_000)
    expect(m.cash_collected).toBe(0)
    expect(m.cash_before_vat).toBe(0)
  })

  it('paid: NT from paid_amount_original; booked from row.amount; cash from paid_amount', () => {
    const m = enrichRevenueRow({
      source: 'revenue',
      payment_status: 'paid',
      amount: 700_000,
      paid_amount_original: 1_100_000,
      paid_amount: 1_100_000,
      vat_pct: 10,
      fee_pct: 30,
    })
    expect(m.acceptance_amount).toBe(1_100_000)
    expect(m.amount_before_vat).toBe(1_000_000)
    expect(m.booked_revenue).toBe(700_000)
    expect(m.cash_collected).toBe(1_100_000)
    expect(m.cash_before_vat).toBe(1_000_000)
  })

  it('orphan booked amount must not be re-VATed as gross NT', () => {
    const m = enrichRevenueRow({
      source: 'revenue',
      payment_status: 'paid',
      amount: 700_000,
      paid_amount_original: 0,
      paid_amount: 0,
      vat_pct: 10,
      fee_pct: 30,
    })
    expect(m.acceptance_amount).toBe(0)
    expect(m.amount_before_vat).toBe(0)
    expect(m.booked_revenue).toBe(700_000)
  })

  it('amount=0 yields zero derived money', () => {
    const m = enrichRevenueRow({
      source: 'payment_request',
      payment_status: 'pending',
      amount: 0,
      paid_amount_original: 0,
      paid_amount: 0,
      vat_pct: 10,
      fee_pct: 30,
    })
    expect(m.acceptance_amount).toBe(0)
    expect(m.amount_before_vat).toBe(0)
    expect(m.booked_revenue).toBe(0)
    expect(m.cash_collected).toBe(0)
    expect(m.cash_before_vat).toBe(0)
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

  it('contract value is package gross before the project VAT', () => {
    expect(contractValueBeforeVat(1_700_000_000, 0)).toBe(1_700_000_000)
    expect(contractValueBeforeVat(1_700_000_000, 8)).toBe(Math.round(1_700_000_000 / 1.08))
  })

  it('dayAfter converts inclusive NTC end to half-open exclusive', () => {
    expect(dayAfter('2027-01-31')).toBe('2027-02-01')
    expect(dayAfter('2026-12-31')).toBe('2027-01-01')
  })
})
