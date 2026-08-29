import { describe, it, expect } from 'vitest'
import { computeProjectBudget, monthDateRange, yearDateRange } from './finance'

/**
 * Authz / SSOT policy smoke tests (Tier 3).
 * Full route IDOR harness needs D1+Hono fixture — documented in evidence.
 */
describe('authz / finance SSOT policy', () => {
  it('computeProjectBudget matches legal overview SSOT (fee applied, rounded)', () => {
    expect(computeProjectBudget(100_000_000, 10)).toBe(90_000_000)
    expect(computeProjectBudget(58_790_000, 0)).toBe(58_790_000)
    expect(computeProjectBudget(0, 10)).toBe(0)
  })

  it('monthDateRange is half-open and index-friendly', () => {
    expect(monthDateRange(2026, 5)).toEqual({ start: '2026-05-01', endExclusive: '2026-06-01' })
    expect(monthDateRange(2026, 12)).toEqual({ start: '2026-12-01', endExclusive: '2027-01-01' })
  })

  it('yearDateRange is half-open calendar year', () => {
    expect(yearDateRange(2026)).toEqual({ start: '2026-01-01', endExclusive: '2027-01-01' })
  })
})
