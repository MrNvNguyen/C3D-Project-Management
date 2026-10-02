import { describe, it, expect } from 'vitest'
import {
  isLegalSupportMember,
  hasLegalGlobalWriteRole,
  canBrowseAllLegalProjects,
  LEGAL_SUPPORT_DEPARTMENT,
} from './legal-auth'

describe('legal-auth — Support member HSPL', () => {
  it('member + Support department can manage legal (global write + browse all)', () => {
    const user = { role: 'member', department: LEGAL_SUPPORT_DEPARTMENT }
    expect(isLegalSupportMember(user)).toBe(true)
    expect(hasLegalGlobalWriteRole(user)).toBe(true)
    expect(canBrowseAllLegalProjects(user)).toBe(true)
  })

  it('member + Support with surrounding whitespace matches', () => {
    expect(isLegalSupportMember({ role: 'member', department: '  support  ' })).toBe(true)
  })

  it('member + other department cannot manage legal', () => {
    const user = { role: 'member', department: 'BIM' }
    expect(isLegalSupportMember(user)).toBe(false)
    expect(hasLegalGlobalWriteRole(user)).toBe(false)
    expect(canBrowseAllLegalProjects(user)).toBe(false)
  })

  it('project_leader behavior unchanged (global legal write, not Support browse-all)', () => {
    const user = { role: 'project_leader', department: 'BIM' }
    expect(isLegalSupportMember(user)).toBe(false)
    expect(hasLegalGlobalWriteRole(user)).toBe(true)
    expect(canBrowseAllLegalProjects(user)).toBe(false)
  })

  it('global project_admin retains legal write without Support department', () => {
    const user = { role: 'project_admin', department: 'Sales' }
    expect(hasLegalGlobalWriteRole(user)).toBe(true)
    expect(isLegalSupportMember(user)).toBe(false)
  })
})
