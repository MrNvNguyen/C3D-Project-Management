/** HSPL change log — field-level audit for legal module tabs. */

export type LegalAuditArea = 'project_info' | 'dossier' | 'payment' | 'fee_a' | 'contact'
export type LegalAuditAction = 'create' | 'update' | 'delete'

export type LegalAuditEntry = {
  area: LegalAuditArea
  entityLabel: string
  action: LegalAuditAction
  field: string
  oldValue: string
  newValue: string
}

export function auditTextValue(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

export function auditValuesEqual(oldVal: unknown, newVal: unknown): boolean {
  return auditTextValue(oldVal) === auditTextValue(newVal)
}

export function formatContractSignedForAudit(value: unknown): string {
  const signed = value === true || value === 1 || value === '1'
  return signed ? 'Đã ký' : 'Chưa ký'
}

export function formatSpendStatusForAudit(value: unknown): string {
  return value === 'spent' ? 'Đã chi' : 'Chưa chi'
}

export function buildFieldChangeEntries(opts: {
  area: LegalAuditArea
  entityLabel: string
  action: LegalAuditAction
  fields: Record<string, { old?: unknown; new?: unknown }>
}): LegalAuditEntry[] {
  const label = clipEntityLabel(opts.entityLabel)
  const out: LegalAuditEntry[] = []
  for (const [field, pair] of Object.entries(opts.fields)) {
    if (opts.action === 'create') {
      const nv = auditTextValue(pair.new)
      if (!nv) continue
      out.push({ area: opts.area, entityLabel: label, action: 'create', field, oldValue: '', newValue: nv })
      continue
    }
    if (opts.action === 'delete') {
      const ov = auditTextValue(pair.old)
      if (!ov && field !== '_record') continue
      out.push({
        area: opts.area,
        entityLabel: label,
        action: 'delete',
        field,
        oldValue: ov,
        newValue: '',
      })
      continue
    }
    if (auditValuesEqual(pair.old, pair.new)) continue
    out.push({
      area: opts.area,
      entityLabel: label,
      action: 'update',
      field,
      oldValue: auditTextValue(pair.old),
      newValue: auditTextValue(pair.new),
    })
  }
  return out
}

function clipEntityLabel(raw: string): string {
  return String(raw || '—').trim().slice(0, 200) || '—'
}

function clipFieldText(raw: string, max: number): string {
  return String(raw ?? '').slice(0, max)
}

export function diffContactBookEntries(
  oldContacts: Record<string, unknown>[],
  newContacts: Record<string, unknown>[],
  oldLogs: Record<string, unknown>[],
  newLogs: Record<string, unknown>[],
): LegalAuditEntry[] {
  const entries: LegalAuditEntry[] = []
  const contactFields = ['name', 'phone', 'email', 'role'] as const
  const contactFieldLabels: Record<string, string> = {
    name: 'Họ và tên',
    phone: 'Số điện thoại',
    email: 'Email',
    role: 'Chức vụ / Vai trò',
  }
  const logFields = ['date', 'person', 'content'] as const
  const logFieldLabels: Record<string, string> = {
    date: 'Ngày trao đổi',
    person: 'Trao đổi với ai',
    content: 'Nội dung',
  }

  const oldCMap = mapById(oldContacts)
  const newCMap = mapById(newContacts)
  for (const [id, row] of newCMap) {
    const name = auditTextValue(row.name) || id
    const prev = oldCMap.get(id)
    if (!prev) {
      entries.push(
        ...buildFieldChangeEntries({
          area: 'contact',
          entityLabel: name,
          action: 'create',
          fields: Object.fromEntries(contactFields.map(f => [contactFieldLabels[f], { new: row[f] }])),
        }),
      )
      continue
    }
    entries.push(
      ...buildFieldChangeEntries({
        area: 'contact',
        entityLabel: name,
        action: 'update',
        fields: Object.fromEntries(
          contactFields.map(f => [contactFieldLabels[f], { old: prev[f], new: row[f] }]),
        ),
      }),
    )
  }
  for (const [id, row] of oldCMap) {
    if (newCMap.has(id)) continue
    const name = auditTextValue(row.name) || id
    entries.push({
      area: 'contact',
      entityLabel: clipEntityLabel(name),
      action: 'delete',
      field: 'Người liên hệ',
      oldValue: name,
      newValue: '',
    })
  }

  const oldLMap = mapById(oldLogs)
  const newLMap = mapById(newLogs)
  for (const [id, row] of newLMap) {
    const person = auditTextValue(row.person || row.contactPerson) || id
    const prev = oldLMap.get(id)
    if (!prev) {
      entries.push(
        ...buildFieldChangeEntries({
          area: 'contact',
          entityLabel: `Nhật ký: ${person}`,
          action: 'create',
          fields: Object.fromEntries(
            logFields.map(f => [
              logFieldLabels[f],
              { new: f === 'person' ? row.person || row.contactPerson : row[f] },
            ]),
          ),
        }),
      )
      continue
    }
    entries.push(
      ...buildFieldChangeEntries({
        area: 'contact',
        entityLabel: `Nhật ký: ${person}`,
        action: 'update',
        fields: Object.fromEntries(
          logFields.map(f => [
            logFieldLabels[f],
            {
              old: f === 'person' ? prev.person || prev.contactPerson : prev[f],
              new: f === 'person' ? row.person || row.contactPerson : row[f],
            },
          ]),
        ),
      }),
    )
  }
  for (const [id, row] of oldLMap) {
    if (newLMap.has(id)) continue
    const person = auditTextValue(row.person || row.contactPerson) || id
    entries.push({
      area: 'contact',
      entityLabel: clipEntityLabel(`Nhật ký: ${person}`),
      action: 'delete',
      field: 'Nhật ký trao đổi',
      oldValue: person,
      newValue: '',
    })
  }

  return entries.filter(e => e.action !== 'update' || e.oldValue !== e.newValue)
}

function mapById(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const m = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const id = auditTextValue(row.id)
    if (!id) continue
    m.set(id, row)
  }
  return m
}

export function auditPackageUpdateEntries(
  entityLabel: string,
  before: Record<string, unknown>,
  body: Record<string, unknown>,
  contractFromBody: (data: Record<string, unknown>) => {
    code: string | null
    start_date: string | null
    end_date: string | null
    contract_value: number
    contract_signed: number
  },
): LegalAuditEntry[] {
  const fields: Record<string, { old?: unknown; new?: unknown }> = {}
  if (Object.prototype.hasOwnProperty.call(body, 'name') && auditTextValue(body.name)) {
    fields['Tên gói thầu'] = { old: before.name, new: body.name }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'code')) {
    fields['Mã gói'] = { old: before.code, new: body.code }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'start_date')) {
    fields['Ngày ký'] = { old: before.start_date, new: body.start_date }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'end_date')) {
    fields['Kết thúc'] = { old: before.end_date, new: body.end_date }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'contract_value')) {
    const c = contractFromBody(body)
    fields['Giá trị HĐ'] = { old: before.contract_value, new: c.contract_value }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'contract_signed')) {
    const c = contractFromBody(body)
    fields['Ký hợp đồng'] = {
      old: formatContractSignedForAudit(before.contract_signed),
      new: formatContractSignedForAudit(c.contract_signed),
    }
  }
  return buildFieldChangeEntries({
    area: 'project_info',
    entityLabel,
    action: 'update',
    fields,
  })
}

export function auditPackageCreateEntries(
  name: string,
  contract: {
    code: string | null
    start_date: string | null
    end_date: string | null
    contract_value: number
    contract_signed: number
  },
): LegalAuditEntry[] {
  return buildFieldChangeEntries({
    area: 'project_info',
    entityLabel: name,
    action: 'create',
    fields: {
      'Tên gói thầu': { new: name },
      'Mã gói': { new: contract.code },
      'Ngày ký': { new: contract.start_date },
      'Kết thúc': { new: contract.end_date },
      'Giá trị HĐ': { new: contract.contract_value },
      'Ký hợp đồng': { new: formatContractSignedForAudit(contract.contract_signed) },
    },
  })
}

export function auditLegalItemFields(
  entityLabel: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): LegalAuditEntry[] {
  const fieldMap: Record<string, string> = {
    title: 'Hạng mục',
    due_date: 'Hạn',
    status: 'Trạng thái',
    notes: 'Ghi chú',
    item_type: 'Loại',
  }
  const fields: Record<string, { old?: unknown; new?: unknown }> = {}
  for (const [key, label] of Object.entries(fieldMap)) {
    if (before) {
      fields[label] = { old: before[key], new: after[key] }
    } else {
      fields[label] = { new: after[key] }
    }
  }
  return buildFieldChangeEntries({
    area: 'dossier',
    entityLabel,
    action: before ? 'update' : 'create',
    fields,
  })
}

export function auditPaymentFields(
  entityLabel: string,
  before: Record<string, unknown> | null,
  merged: Record<string, unknown>,
): LegalAuditEntry[] {
  const fieldMap: Record<string, string> = {
    description: 'Mô tả',
    request_date: 'Ngày nghiệm thu',
    status: 'Trạng thái',
    amount: 'Nghiệm thu',
    paid_amount: 'Đã thu',
    payment_phase: 'Đợt số',
    request_number: 'STT',
  }
  const fields: Record<string, { old?: unknown; new?: unknown }> = {}
  for (const [key, label] of Object.entries(fieldMap)) {
    if (before) {
      if (merged[key] === undefined && before[key] === undefined) continue
      fields[label] = { old: before[key], new: merged[key] }
    } else {
      fields[label] = { new: merged[key] }
    }
  }
  return buildFieldChangeEntries({
    area: 'payment',
    entityLabel,
    action: before ? 'update' : 'create',
    fields,
  })
}

export function auditCostAFields(
  entityLabel: string,
  before: Record<string, unknown> | null,
  after: {
    amount_override: number | null
    cost_a_pct: number | null
    spend_status: string
    note: string | null
  },
): LegalAuditEntry[] {
  const fields: Record<string, { old?: unknown; new?: unknown }> = {
    'Ghi đè số tiền': {
      old: before?.amount_override ?? '',
      new: after.amount_override ?? '',
    },
    '% Chi phí A': {
      old: before?.cost_a_pct ?? '',
      new: after.cost_a_pct ?? '',
    },
    'Trạng thái chi': {
      old: formatSpendStatusForAudit(before?.spend_status ?? 'unspent'),
      new: formatSpendStatusForAudit(after.spend_status),
    },
    'Ghi chú': { old: before?.note ?? '', new: after.note ?? '' },
  }
  return buildFieldChangeEntries({
    area: 'fee_a',
    entityLabel,
    action: before ? 'update' : 'create',
    fields,
  })
}

export async function insertLegalAuditLogs(
  db: D1Database,
  projectId: number,
  actorUserId: number,
  entries: LegalAuditEntry[],
): Promise<void> {
  const rows = entries.filter(e => e.action !== 'update' || e.oldValue !== e.newValue)
  if (!rows.length) return
  const stmt = db.prepare(
    `INSERT INTO legal_change_logs
      (project_id, actor_user_id, area, entity_label, action, field, old_value, new_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const batch = rows.map(e =>
    stmt.bind(
      projectId,
      actorUserId,
      e.area,
      clipEntityLabel(e.entityLabel),
      e.action,
      clipFieldText(e.field, 80),
      clipFieldText(e.oldValue, 2000),
      clipFieldText(e.newValue, 2000),
    ),
  )
  await db.batch(batch)
}
