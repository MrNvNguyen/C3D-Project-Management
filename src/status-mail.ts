/** Giờ Việt Nam (UTC+7) cho mail tình trạng. Không dùng date('now') của D1 vì đó là UTC. */

const VN_OFFSET_MS = 7 * 3600 * 1000

export function vnClock(nowMs = Date.now()) {
  const vn = new Date(nowMs + VN_OFFSET_MS)
  const isoDate = `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${String(vn.getUTCDate()).padStart(2, '0')}`
  return {
    isoDate,
    hour: vn.getUTCHours(),
    weekday: vn.getUTCDay(),
  }
}

/** Số ngày quá hạn so với hôm nay theo giờ VN. Hạn trong hôm nay = 0. */
export function daysOverdueOf(dueDate: string, nowMs = Date.now()) {
  const due = Date.parse(`${dueDate}T00:00:00Z`)
  if (!Number.isFinite(due)) return 0
  const today = Date.parse(`${vnClock(nowMs).isoDate}T00:00:00Z`)
  return Math.max(0, Math.floor((today - due) / 86400000))
}

export type FridayMailConfig = {
  weekly_report_enabled?: string
  weekly_report_day?: string
  weekly_report_hour?: string
  status_mail_last_sent?: string
}

/**
 * Gửi khi đúng thứ, từ giờ cấu hình trở đi, và hôm nay chưa ghi nhận gửi thành công.
 * Giờ >= cấu hình để lần gọi sau trong cùng ngày còn gửi lại nếu lần trước lỗi.
 */
export function shouldSendFridayStatusMails(map: FridayMailConfig, nowMs = Date.now()) {
  const clock = vnClock(nowMs)
  const today = clock.isoDate
  if (map.weekly_report_enabled === '0') return { send: false as const, today, reason: 'disabled' as const }
  const day = map.weekly_report_day || '5'
  const hour = Number(map.weekly_report_hour || '9')
  if (String(clock.weekday) !== day) return { send: false as const, today, reason: 'day' as const }
  if (!Number.isFinite(hour) || clock.hour < hour) return { send: false as const, today, reason: 'hour' as const }
  if (map.status_mail_last_sent === today) return { send: false as const, today, reason: 'already' as const }
  return { send: true as const, today, reason: 'due' as const }
}

/** Chỉ system_admin thấy cả công ty. project_admin trên bảng users không được phạm vi này. */
export function isCompanyWideStatusRecipient(role: string) {
  return role === 'system_admin'
}

export const STATUS_MAIL_RECIPIENTS_SQL = `
  SELECT DISTINCT u.id, u.full_name, u.email, u.role
  FROM users u
  WHERE u.is_active = 1 AND u.email IS NOT NULL AND TRIM(u.email) != ''
    AND (
      u.role = 'system_admin'
      OR u.id IN (SELECT admin_id FROM projects WHERE admin_id IS NOT NULL)
      OR u.id IN (SELECT leader_id FROM projects WHERE leader_id IS NOT NULL)
      OR u.id IN (
        SELECT user_id FROM project_members
        WHERE role IN ('project_admin', 'admin', 'project_leader', 'leader')
      )
    )
`

export const STATUS_MAIL_SCOPE_SQL = `
  SELECT admin_id AS user_id, id AS project_id FROM projects WHERE admin_id IS NOT NULL
  UNION
  SELECT leader_id AS user_id, id AS project_id FROM projects WHERE leader_id IS NOT NULL
  UNION
  SELECT user_id, project_id FROM project_members
  WHERE role IN ('project_admin', 'admin', 'project_leader', 'leader')
`

export function buildStatusMailScope(rows: Array<{ user_id: number, project_id: number }>) {
  const scope = new Map<number, Set<number>>()
  for (const row of rows) {
    const uid = Number(row.user_id)
    const pid = Number(row.project_id)
    if (!Number.isInteger(uid) || !Number.isInteger(pid)) continue
    if (!scope.has(uid)) scope.set(uid, new Set())
    scope.get(uid)!.add(pid)
  }
  return scope
}

/** null = toàn công ty. Set rỗng = không có dự án, người gọi bỏ qua. */
export function projectsInStatusMailScope(
  userId: number,
  role: string,
  scope: Map<number, Set<number>>,
): Set<number> | null {
  if (isCompanyWideStatusRecipient(role)) return null
  return scope.get(Number(userId)) ?? new Set()
}

export type WeeklyStatRow = {
  id: number
  name: string
  email?: string
  project_id: number
  total: number
  done: number
  inprogress: number
  todo: number
  overdue: number
}

export function aggregateWeeklyMemberStats(rows: WeeklyStatRow[], projectIds: Set<number> | null) {
  const byUser = new Map<number, {
    id: number
    name: string
    email: string
    total: number
    done: number
    inprogress: number
    todo: number
    overdue: number
  }>()
  for (const row of rows) {
    if (projectIds && !projectIds.has(Number(row.project_id))) continue
    const id = Number(row.id)
    let acc = byUser.get(id)
    if (!acc) {
      acc = {
        id,
        name: row.name,
        email: row.email || '',
        total: 0,
        done: 0,
        inprogress: 0,
        todo: 0,
        overdue: 0,
      }
      byUser.set(id, acc)
    }
    acc.total += Number(row.total) || 0
    acc.done += Number(row.done) || 0
    acc.inprogress += Number(row.inprogress) || 0
    acc.todo += Number(row.todo) || 0
    acc.overdue += Number(row.overdue) || 0
  }
  return [...byUser.values()].sort((a, b) => b.done - a.done || b.total - a.total)
}

export function cronSecretMatches(provided: string, expected: string) {
  if (!provided || !expected || provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}
