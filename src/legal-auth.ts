/** HSPL module: phòng Support (users.department) + global role member → quản trị HSPL toàn hệ thống. */

export const LEGAL_SUPPORT_DEPARTMENT = 'Support'

export function normalizeDepartmentName(raw: unknown): string {
  return String(raw ?? '').trim()
}

/** Global app role `member` + department Support (trim, case-insensitive exact name). */
export function isLegalSupportMember(user: { role?: string; department?: string | null } | null | undefined): boolean {
  if (!user || user.role !== 'member') return false
  const dept = normalizeDepartmentName(user.department)
  return dept.toLowerCase() === LEGAL_SUPPORT_DEPARTMENT.toLowerCase()
}

/** Same global write band as existing HSPL handlers (system / project admin / leader + Support member). */
export function hasLegalGlobalWriteRole(user: { role?: string; department?: string | null } | null | undefined): boolean {
  if (!user) return false
  if (['system_admin', 'project_admin', 'project_leader'].includes(String(user.role))) return true
  return isLegalSupportMember(user)
}

export function canBrowseAllLegalProjects(user: { role?: string; department?: string | null } | null | undefined): boolean {
  if (!user) return false
  if (user.role === 'system_admin') return true
  return isLegalSupportMember(user)
}

export function canMigrateLegalPackages(user: { role?: string; department?: string | null } | null | undefined): boolean {
  if (!user) return false
  if (user.role === 'system_admin' || user.role === 'project_admin') return true
  return isLegalSupportMember(user)
}
