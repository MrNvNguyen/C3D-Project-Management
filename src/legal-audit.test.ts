import { describe, expect, it } from 'vitest'
import {
  auditValuesEqual,
  buildFieldChangeEntries,
  diffContactBookEntries,
} from './legal-audit'

describe('legal-audit — field changes', () => {
  it('records old and new on update when values differ', () => {
    const entries = buildFieldChangeEntries({
      area: 'payment',
      entityLabel: 'thanh toán đợt 1',
      action: 'update',
      fields: {
        'Trạng thái': { old: 'pending', new: 'paid' },
        'Mô tả': { old: 'thanh toán đợt 1', new: 'thanh toán đợt 1' },
      },
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      field: 'Trạng thái',
      oldValue: 'pending',
      newValue: 'paid',
      action: 'update',
    })
  })

  it('does not insert a row when old and new are the same', () => {
    const entries = buildFieldChangeEntries({
      area: 'project_info',
      entityLabel: 'yyyy',
      action: 'update',
      fields: {
        'Tên gói thầu': { old: 'yyyy', new: 'yyyy' },
        'Giá trị HĐ': { old: '1000', new: '1000' },
      },
    })
    expect(entries).toHaveLength(0)
  })

  it('diffs contact create without touching unchanged contacts', () => {
    const entries = diffContactBookEntries(
      [{ id: 'c1', name: 'A', phone: '1', email: '', role: '' }],
      [
        { id: 'c1', name: 'A', phone: '1', email: '', role: '' },
        { id: 'c2', name: 'B', phone: '2', email: '', role: '' },
      ],
      [],
      [],
    )
    expect(entries.some(e => e.action === 'create' && e.entityLabel === 'B')).toBe(true)
    expect(entries.filter(e => e.entityLabel === 'A')).toHaveLength(0)
  })
})

describe('legal-audit — helpers', () => {
  it('treats blank and null as equal', () => {
    expect(auditValuesEqual(null, '')).toBe(true)
    expect(auditValuesEqual('  x ', 'x')).toBe(true)
  })
})
