import { describe, expect, it } from 'vitest'
import {
  aggregateWeeklyMemberStats,
  buildStatusMailScope,
  cronSecretMatches,
  daysOverdueOf,
  projectsInStatusMailScope,
  shouldSendFridayStatusMails,
  vnClock,
} from './status-mail'

describe('status mail VN clock', () => {
  it('treats 06:00 VN as the next calendar day versus UTC', () => {
    const at0600Vn = Date.parse('2026-10-06T23:00:00Z')
    expect(vnClock(at0600Vn).isoDate).toBe('2026-10-07')
    expect(daysOverdueOf('2026-10-06', at0600Vn)).toBe(1)
  })

  it('does not count a task due today as overdue', () => {
    const at2300Vn = Date.parse('2026-10-06T16:00:00Z')
    expect(vnClock(at2300Vn).isoDate).toBe('2026-10-06')
    expect(daysOverdueOf('2026-10-06', at2300Vn)).toBe(0)
  })
})

describe('friday status mail gate', () => {
  const friday9 = Date.parse('2026-10-09T02:00:00Z')
  const friday8 = Date.parse('2026-10-09T01:00:00Z')
  const friday15 = Date.parse('2026-10-09T08:00:00Z')

  it('sends on the configured weekday from that hour onward', () => {
    expect(shouldSendFridayStatusMails({}, friday9).send).toBe(true)
    expect(shouldSendFridayStatusMails({}, friday8).reason).toBe('hour')
    expect(shouldSendFridayStatusMails({}, friday15).send).toBe(true)
  })

  it('does not send again after a successful mark the same day', () => {
    const gate = shouldSendFridayStatusMails({ status_mail_last_sent: '2026-10-09' }, friday15)
    expect(gate.send).toBe(false)
    expect(gate.reason).toBe('already')
  })

  it('stays off when the weekly report is disabled', () => {
    expect(shouldSendFridayStatusMails({ weekly_report_enabled: '0' }, friday9).reason).toBe('disabled')
  })
})

describe('status mail recipient scope', () => {
  const scope = buildStatusMailScope([
    { user_id: 2, project_id: 10 },
    { user_id: 3, project_id: 11 },
  ])

  it('keeps company-wide mail to system_admin', () => {
    expect(projectsInStatusMailScope(1, 'system_admin', scope)).toBeNull()
  })

  it('limits a global project_admin to assigned projects', () => {
    expect(projectsInStatusMailScope(9, 'project_admin', scope)).toEqual(new Set())
    expect(projectsInStatusMailScope(2, 'project_admin', scope)).toEqual(new Set([10]))
  })

  it('aggregates weekly stats only inside the project set', () => {
    const rows = [
      { id: 7, name: 'An', project_id: 10, total: 2, done: 1, inprogress: 1, todo: 0, overdue: 1 },
      { id: 7, name: 'An', project_id: 11, total: 4, done: 4, inprogress: 0, todo: 0, overdue: 0 },
      { id: 8, name: 'Binh', project_id: 11, total: 1, done: 0, inprogress: 0, todo: 1, overdue: 0 },
    ]
    const scoped = aggregateWeeklyMemberStats(rows, new Set([10]))
    expect(scoped).toEqual([
      expect.objectContaining({ id: 7, name: 'An', total: 2, done: 1, overdue: 1 }),
    ])
    expect(aggregateWeeklyMemberStats(rows, null)).toHaveLength(2)
  })
})

describe('cron secret', () => {
  it('matches only the full secret', () => {
    expect(cronSecretMatches('abc', 'abc')).toBe(true)
    expect(cronSecretMatches('abd', 'abc')).toBe(false)
    expect(cronSecretMatches('ab', 'abc')).toBe(false)
    expect(cronSecretMatches('', 'abc')).toBe(false)
  })
})
