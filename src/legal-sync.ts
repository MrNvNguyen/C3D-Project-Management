import { syncPaymentToRevenue } from './finance'
import { cronSecretMatches } from './status-mail'
import type { FileEnv } from './storage'
import { isR2Ref, parseDataUri, putR2, r2KeyFromRef } from './storage'

export const LEGAL_SYNC_SECRET_HEADER = 'X-Legal-Sync-Secret'

export type LegalSyncEntity =
  | 'package'
  | 'stage'
  | 'item'
  | 'document'
  | 'letter'
  | 'meeting'
  | 'payment'

export type LegalSyncProjectListRow = {
  id: number
  code: string
  name: string
  client: string | null
}

export type LegalSyncBundle = {
  source_project_id: number
  project: {
    client: string | null
    description: string | null
    vat_pct: number
    management_fee_pct: number
  }
  packages: Record<string, unknown>[]
  stages: Record<string, unknown>[]
  items: Record<string, unknown>[]
  documents: Record<string, unknown>[]
  letters: Record<string, unknown>[]
  letter_config: Record<string, unknown> | null
  meetings: Record<string, unknown>[]
  meeting_config: Record<string, unknown> | null
  payments: Record<string, unknown>[]
  cost_a: Record<string, unknown>[]
  contact_book: { contacts_json: string; logs_json: string } | null
}

export function normalizePeerOrigin(origin: string): string {
  return origin.replace(/\/+$/, '')
}

export function legalSyncSecretFromRequest(getHeader: (name: string) => string | undefined): string {
  return String(getHeader(LEGAL_SYNC_SECRET_HEADER) || '').trim()
}

export function canPostLegalSyncFrom(user: { role?: string } | null, hasProjectAccess: boolean): boolean {
  return user?.role === 'system_admin' && hasProjectAccess
}

export function legalSyncSecretOk(provided: string, expected: string | undefined): boolean {
  const exp = String(expected || '').trim()
  if (!exp) return false
  return cronSecretMatches(provided, exp)
}

export function isLegalSyncRun2(
  storedPeer: string | null | undefined,
  storedSourceId: number | null | undefined,
  peerOrigin: string,
  sourceProjectId: number
): boolean {
  if (!storedPeer || storedSourceId == null) return false
  return (
    normalizePeerOrigin(String(storedPeer)) === normalizePeerOrigin(peerOrigin) &&
    Number(storedSourceId) === Number(sourceProjectId)
  )
}

export function contactEntryKey(entry: { name?: unknown; phone?: unknown }): string {
  const name = String(entry.name ?? '').trim().toLowerCase()
  const phone = String(entry.phone ?? '').trim().toLowerCase()
  return `${name}|${phone}`
}

export function contactLogKey(entry: { date?: unknown; content?: unknown }): string {
  const date = String(entry.date ?? '').trim()
  const content = String(entry.content ?? '').trim().toLowerCase()
  return `${date}|${content}`
}

export function mergeContactBookJson(
  existingContactsJson: string,
  existingLogsJson: string,
  sourceContactsJson: string,
  sourceLogsJson: string
): { contacts_json: string; logs_json: string } {
  let contacts: unknown[] = []
  let logs: unknown[] = []
  try { contacts = JSON.parse(existingContactsJson || '[]') } catch { contacts = [] }
  try { logs = JSON.parse(existingLogsJson || '[]') } catch { logs = [] }
  let srcContacts: unknown[] = []
  let srcLogs: unknown[] = []
  try { srcContacts = JSON.parse(sourceContactsJson || '[]') } catch { srcContacts = [] }
  try { srcLogs = JSON.parse(sourceLogsJson || '[]') } catch { srcLogs = [] }

  const contactKeys = new Set(
    contacts.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object').map(c => contactEntryKey(c as { name?: unknown; phone?: unknown }))
  )
  for (const raw of srcContacts) {
    if (!raw || typeof raw !== 'object') continue
    const key = contactEntryKey(raw as { name?: unknown; phone?: unknown })
    if (contactKeys.has(key)) continue
    contactKeys.add(key)
    contacts.push(raw)
  }

  const logKeys = new Set(
    logs.filter((l): l is Record<string, unknown> => !!l && typeof l === 'object').map(l => contactLogKey(l as { date?: unknown; content?: unknown }))
  )
  for (const raw of srcLogs) {
    if (!raw || typeof raw !== 'object') continue
    const key = contactLogKey(raw as { date?: unknown; content?: unknown })
    if (logKeys.has(key)) continue
    logKeys.add(key)
    logs.push(raw)
  }

  return { contacts_json: JSON.stringify(contacts), logs_json: JSON.stringify(logs) }
}

async function mapGetLocalId(
  db: D1Database,
  localProjectId: number,
  entity: LegalSyncEntity,
  sourceId: number
): Promise<number | null> {
  const row = await db.prepare(
    'SELECT local_id FROM legal_sync_id_map WHERE local_project_id = ? AND entity = ? AND source_id = ?'
  ).bind(localProjectId, entity, sourceId).first() as { local_id?: number } | null
  return row?.local_id != null ? Number(row.local_id) : null
}

async function mapRemember(
  db: D1Database,
  localProjectId: number,
  entity: LegalSyncEntity,
  sourceId: number,
  localId: number
): Promise<void> {
  await db.prepare(
    `INSERT INTO legal_sync_id_map (local_project_id, entity, source_id, local_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(local_project_id, entity, source_id) DO UPDATE SET local_id = excluded.local_id`
  ).bind(localProjectId, entity, sourceId, localId).run()
}

export async function buildLegalSyncProjectList(db: D1Database): Promise<LegalSyncProjectListRow[]> {
  const rows = await db.prepare(
    'SELECT id, code, name, client FROM projects ORDER BY code ASC'
  ).all()
  return (rows.results || []) as LegalSyncProjectListRow[]
}

export async function buildLegalSyncBundle(db: D1Database, projectId: number): Promise<LegalSyncBundle> {
  const proj = await db.prepare(
    `SELECT id, client, description, COALESCE(vat_pct, 0) AS vat_pct,
            COALESCE(management_fee_pct, 0) AS management_fee_pct
     FROM projects WHERE id = ?`
  ).bind(projectId).first() as Record<string, unknown> | null
  if (!proj) throw new Error('Project not found')

  const packages = await db.prepare(
    'SELECT * FROM legal_packages WHERE project_id = ? ORDER BY sort_order, id'
  ).bind(projectId).all()
  const stages = await db.prepare(
    'SELECT * FROM legal_stages WHERE project_id = ? ORDER BY sort_order, id'
  ).bind(projectId).all()
  const items = await db.prepare(
    'SELECT * FROM legal_items WHERE project_id = ? ORDER BY sort_order, id'
  ).bind(projectId).all()
  const documents = await db.prepare(
    `SELECT id, project_id, legal_item_id, doc_type, title, file_name, file_url,
            signed_date, notes, r2_key, content_type, byte_length, created_by, created_at, updated_at,
            CASE WHEN r2_key IS NOT NULL AND r2_key != '' THEN 1
                 WHEN file_url LIKE 'r2:%' THEN 1
                 WHEN file_url LIKE 'data:%' THEN 1
                 ELSE 0 END AS has_file
     FROM legal_documents WHERE project_id = ? ORDER BY id`
  ).bind(projectId).all()
  const letters = await db.prepare(
    'SELECT * FROM outgoing_letters WHERE project_id = ? ORDER BY id'
  ).bind(projectId).all()
  const letter_config = await db.prepare(
    'SELECT * FROM legal_letter_config WHERE project_id = ?'
  ).bind(projectId).first() as Record<string, unknown> | null
  const meetings = await db.prepare(
    'SELECT * FROM meeting_minutes WHERE project_id = ? ORDER BY id'
  ).bind(projectId).all()
  const meeting_config = await db.prepare(
    'SELECT * FROM meeting_minutes_config WHERE project_id = ?'
  ).bind(projectId).first() as Record<string, unknown> | null
  const payments = await db.prepare(
    'SELECT id, project_id, legal_item_id, package_id, request_number, description, request_date, amount, currency, status, paid_amount, paid_date, invoice_number, invoice_date, payment_phase, notes, vat_pct, created_by, created_at, updated_at FROM payment_requests WHERE project_id = ? ORDER BY id'
  ).bind(projectId).all()
  const cost_a = await db.prepare(
    `SELECT c.* FROM legal_cost_a c
     JOIN payment_requests p ON p.id = c.payment_request_id
     WHERE p.project_id = ?`
  ).bind(projectId).all()
  const contactRow = await db.prepare(
    'SELECT contacts_json, logs_json FROM project_contact_books WHERE project_id = ?'
  ).bind(projectId).first() as { contacts_json?: string; logs_json?: string } | null

  return {
    source_project_id: projectId,
    project: {
      client: (proj.client as string) ?? null,
      description: (proj.description as string) ?? null,
      vat_pct: Number(proj.vat_pct) || 0,
      management_fee_pct: Number(proj.management_fee_pct) || 0,
    },
    packages: (packages.results || []) as Record<string, unknown>[],
    stages: (stages.results || []) as Record<string, unknown>[],
    items: (items.results || []) as Record<string, unknown>[],
    documents: (documents.results || []) as Record<string, unknown>[],
    letters: (letters.results || []) as Record<string, unknown>[],
    letter_config: letter_config ? { ...letter_config, id: undefined, project_id: undefined } as Record<string, unknown> : null,
    meetings: (meetings.results || []) as Record<string, unknown>[],
    meeting_config: meeting_config ? { ...meeting_config, id: undefined, project_id: undefined } as Record<string, unknown> : null,
    payments: (payments.results || []) as Record<string, unknown>[],
    cost_a: (cost_a.results || []) as Record<string, unknown>[],
    contact_book: contactRow
      ? { contacts_json: contactRow.contacts_json || '[]', logs_json: contactRow.logs_json || '[]' }
      : null,
  }
}

export async function fetchPeerLegalSyncBundle(
  peerOrigin: string,
  secret: string,
  sourceProjectId: number
): Promise<LegalSyncBundle> {
  const url = `${normalizePeerOrigin(peerOrigin)}/api/legal-sync/projects/${sourceProjectId}`
  const res = await fetch(url, {
    headers: { [LEGAL_SYNC_SECRET_HEADER]: secret },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Peer export failed (${res.status}): ${text.slice(0, 200)}`)
  }
  return await res.json() as LegalSyncBundle
}

export async function fetchPeerLegalSyncProjectList(
  peerOrigin: string,
  secret: string
): Promise<LegalSyncProjectListRow[]> {
  const url = `${normalizePeerOrigin(peerOrigin)}/api/legal-sync/projects`
  const res = await fetch(url, {
    headers: { [LEGAL_SYNC_SECRET_HEADER]: secret },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Peer project list failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const data = await res.json() as { projects?: LegalSyncProjectListRow[] }
  return data.projects || []
}

async function clearLocalLegalDossier(db: D1Database, localProjectId: number): Promise<void> {
  const payments = await db.prepare(
    'SELECT id, revenue_id FROM payment_requests WHERE project_id = ?'
  ).bind(localProjectId).all()
  for (const p of (payments.results || []) as { id: number; revenue_id?: number | null }[]) {
    if (p.revenue_id) {
      await db.prepare('DELETE FROM project_revenues WHERE id = ?').bind(p.revenue_id).run()
    }
  }
  await db.prepare(
    `DELETE FROM legal_cost_a WHERE payment_request_id IN (
       SELECT id FROM payment_requests WHERE project_id = ?
     )`
  ).bind(localProjectId).run()
  await db.prepare('DELETE FROM payment_requests WHERE project_id = ?').bind(localProjectId).run()
  await db.prepare('DELETE FROM legal_documents WHERE project_id = ?').bind(localProjectId).run()
  await db.prepare('DELETE FROM outgoing_letters WHERE project_id = ?').bind(localProjectId).run()
  await db.prepare('DELETE FROM meeting_minutes WHERE project_id = ?').bind(localProjectId).run()
  await db.prepare('DELETE FROM legal_items WHERE project_id = ?').bind(localProjectId).run()
  await db.prepare('DELETE FROM legal_stages WHERE project_id = ?').bind(localProjectId).run()
  await db.prepare('DELETE FROM legal_packages WHERE project_id = ?').bind(localProjectId).run()
  await db.prepare('DELETE FROM legal_letter_config WHERE project_id = ?').bind(localProjectId).run()
  await db.prepare('DELETE FROM meeting_minutes_config WHERE project_id = ?').bind(localProjectId).run()
  await db.prepare('DELETE FROM legal_sync_id_map WHERE local_project_id = ?').bind(localProjectId).run()
}

async function downloadPeerDocumentBytes(
  peerOrigin: string,
  secret: string,
  sourceDocumentId: number
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const url = `${normalizePeerOrigin(peerOrigin)}/api/legal-sync/files/${sourceDocumentId}`
  const res = await fetch(url, { headers: { [LEGAL_SYNC_SECRET_HEADER]: secret } })
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Peer file download failed (${res.status}): ${text.slice(0, 120)}`)
  }
  const contentType = res.headers.get('Content-Type') || 'application/octet-stream'
  const buf = await res.arrayBuffer()
  return { bytes: new Uint8Array(buf), contentType }
}

async function storeSyncedDocumentFile(
  env: FileEnv,
  peerOrigin: string,
  secret: string,
  localProjectId: number,
  localDocumentId: number,
  doc: Record<string, unknown>
): Promise<{ file_url: string | null; r2_key: string | null; content_type: string | null; byte_length: number | null }> {
  const sourceId = Number(doc.id)
  const hasFile = Number(doc.has_file) === 1 || !!doc.r2_key || (typeof doc.file_url === 'string' && (doc.file_url.startsWith('data:') || isR2Ref(doc.file_url)))

  if (hasFile && sourceId > 0) {
    const downloaded = await downloadPeerDocumentBytes(peerOrigin, secret, sourceId)
    if (downloaded) {
      const key = `legal/${localProjectId}/${localDocumentId}`
      const ok = await putR2(env, key, downloaded.bytes, downloaded.contentType)
      if (ok) {
        return {
          file_url: `r2:${key}`,
          r2_key: key,
          content_type: downloaded.contentType,
          byte_length: downloaded.bytes.length,
        }
      }
    }
  }

  const fileUrl = doc.file_url
  if (typeof fileUrl === 'string' && fileUrl.startsWith('data:')) {
    const parsed = parseDataUri(fileUrl)
    if (parsed) {
      const key = `legal/${localProjectId}/${localDocumentId}`
      const ok = await putR2(env, key, parsed.bytes, parsed.contentType)
      if (ok) {
        return {
          file_url: `r2:${key}`,
          r2_key: key,
          content_type: parsed.contentType,
          byte_length: parsed.bytes.length,
        }
      }
      return { file_url: fileUrl, r2_key: null, content_type: parsed.contentType, byte_length: parsed.bytes.length }
    }
  }

  if (typeof fileUrl === 'string' && !/^https?:/i.test(fileUrl)) {
    return {
      file_url: fileUrl || null,
      r2_key: typeof doc.r2_key === 'string' ? doc.r2_key : (isR2Ref(String(fileUrl)) ? r2KeyFromRef(fileUrl) : null),
      content_type: (doc.content_type as string) || null,
      byte_length: doc.byte_length != null ? Number(doc.byte_length) : null,
    }
  }

  return { file_url: null, r2_key: null, content_type: null, byte_length: null }
}

export type ApplyLegalSyncOptions = {
  db: D1Database
  env: FileEnv
  localProjectId: number
  bundle: LegalSyncBundle
  peerOrigin: string
  secret: string
  actorUserId: number
  run2: boolean
}

export type ApplyLegalSyncResult = {
  mode: 'run1' | 'run2'
  payments_inserted: number
  payments_skipped: number
}

export async function applyLegalSyncBundle(opts: ApplyLegalSyncOptions): Promise<ApplyLegalSyncResult> {
  const { db, env, localProjectId, bundle, peerOrigin, secret, actorUserId, run2 } = opts
  const idMap = new Map<string, number>()

  const mapKey = (entity: LegalSyncEntity, sourceId: number) => `${entity}:${sourceId}`
  const remember = async (entity: LegalSyncEntity, sourceId: number, localId: number) => {
    idMap.set(mapKey(entity, sourceId), localId)
    await mapRemember(db, localProjectId, entity, sourceId, localId)
  }
  const resolve = (entity: LegalSyncEntity, sourceId: number | null | undefined): number | null => {
    if (sourceId == null) return null
    const cached = idMap.get(mapKey(entity, Number(sourceId)))
    if (cached != null) return cached
    return null
  }

  if (!run2) {
    await clearLocalLegalDossier(db, localProjectId)
    await db.prepare(
      `UPDATE projects SET client = ?, description = ?, vat_pct = ?, management_fee_pct = ?,
              legal_sync_peer_origin = ?, legal_sync_source_project_id = ?,
              updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(
      bundle.project.client,
      bundle.project.description,
      bundle.project.vat_pct,
      bundle.project.management_fee_pct,
      normalizePeerOrigin(peerOrigin),
      bundle.source_project_id,
      localProjectId
    ).run()
  } else {
    const existing = await db.prepare(
      'SELECT legal_sync_peer_origin, legal_sync_source_project_id FROM projects WHERE id = ?'
    ).bind(localProjectId).first() as { legal_sync_peer_origin?: string; legal_sync_source_project_id?: number } | null
    const rows = await db.prepare(
      'SELECT entity, source_id, local_id FROM legal_sync_id_map WHERE local_project_id = ?'
    ).bind(localProjectId).all()
    for (const row of (rows.results || []) as { entity: string; source_id: number; local_id: number }[]) {
      idMap.set(mapKey(row.entity as LegalSyncEntity, Number(row.source_id)), Number(row.local_id))
    }
    if (!isLegalSyncRun2(existing?.legal_sync_peer_origin, existing?.legal_sync_source_project_id, peerOrigin, bundle.source_project_id)) {
      throw new Error('Sync pair mismatch — chọn lại dự án nguồn hoặc chạy đồng bộ đầy đủ')
    }
  }

  let paymentsInserted = 0
  let paymentsSkipped = 0

  const shouldInsert = async (entity: LegalSyncEntity, sourceId: number): Promise<boolean> => {
    if (!run2) return true
    const existing = await mapGetLocalId(db, localProjectId, entity, sourceId)
    return existing == null
  }

  for (const raw of bundle.packages) {
    const sourceId = Number(raw.id)
    if (!(await shouldInsert('package', sourceId))) continue
    const r = await db.prepare(
      `INSERT INTO legal_packages (project_id, name, package_type, sort_order, notes, code, start_date, end_date, contract_value, contract_signed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(
      localProjectId,
      raw.name,
      raw.package_type || 'custom',
      raw.sort_order ?? 0,
      raw.notes ?? null,
      raw.code ?? null,
      raw.start_date ?? null,
      raw.end_date ?? null,
      raw.contract_value ?? 0,
      raw.contract_signed ?? 0
    ).run()
    await remember('package', sourceId, Number(r.meta.last_row_id))
  }

  for (const raw of bundle.stages) {
    const sourceId = Number(raw.id)
    if (!(await shouldInsert('stage', sourceId))) continue
    const pkgLocal = resolve('package', raw.package_id as number)
    const r = await db.prepare(
      `INSERT INTO legal_stages (project_id, package_id, code, name, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(localProjectId, pkgLocal, raw.code, raw.name, raw.sort_order ?? 0).run()
    await remember('stage', sourceId, Number(r.meta.last_row_id))
  }

  const pendingItems = bundle.items.slice()
  let deferBudget = pendingItems.length
  while (pendingItems.length) {
    const raw = pendingItems.shift()!
    const parentSource = raw.parent_id != null ? Number(raw.parent_id) : null
    const parentWaiting = parentSource != null
      && resolve('item', parentSource) == null
      && pendingItems.some((row) => Number(row.id) === parentSource)
    if (parentWaiting && deferBudget > 0) {
      deferBudget -= 1
      pendingItems.push(raw)
      continue
    }
    deferBudget = pendingItems.length
    const sourceId = Number(raw.id)
    if (!(await shouldInsert('item', sourceId))) continue
    const stageLocal = resolve('stage', raw.stage_id as number)
    if (!stageLocal) continue
    const parentLocal = raw.parent_id != null ? resolve('item', raw.parent_id as number) : null
    const r = await db.prepare(
      `INSERT INTO legal_items (project_id, stage_id, parent_id, stt, title, item_type, due_date, actual_completion_date, status, notes, sort_order, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(
      localProjectId,
      stageLocal,
      parentLocal,
      raw.stt,
      raw.title,
      raw.item_type || 'task',
      raw.due_date ?? null,
      raw.actual_completion_date ?? null,
      raw.status || 'pending',
      raw.notes ?? null,
      raw.sort_order ?? 0,
      actorUserId
    ).run()
    await remember('item', sourceId, Number(r.meta.last_row_id))
  }

  for (const raw of bundle.documents) {
    const sourceId = Number(raw.id)
    if (!(await shouldInsert('document', sourceId))) continue
    const itemLocal = raw.legal_item_id != null ? resolve('item', raw.legal_item_id as number) : null
    const ins = await db.prepare(
      `INSERT INTO legal_documents (project_id, legal_item_id, doc_type, title, file_name, file_url, signed_date, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(
      localProjectId,
      itemLocal,
      raw.doc_type || 'attachment',
      raw.title,
      raw.file_name ?? null,
      null,
      raw.signed_date ?? null,
      raw.notes ?? null,
      actorUserId
    ).run()
    const localDocId = Number(ins.meta.last_row_id)
    const stored = await storeSyncedDocumentFile(env, peerOrigin, secret, localProjectId, localDocId, raw)
    await db.prepare(
      `UPDATE legal_documents SET file_url = ?, r2_key = ?, content_type = ?, byte_length = ? WHERE id = ?`
    ).bind(stored.file_url, stored.r2_key, stored.content_type, stored.byte_length, localDocId).run()
    await remember('document', sourceId, localDocId)
  }

  for (const raw of bundle.letters) {
    const sourceId = Number(raw.id)
    if (!(await shouldInsert('letter', sourceId))) continue
    const itemLocal = raw.legal_item_id != null ? resolve('item', raw.legal_item_id as number) : null
    const r = await db.prepare(
      `INSERT INTO outgoing_letters (project_id, legal_item_id, letter_number, letter_seq, letter_year, letter_type, letter_type_seq, subject, recipient, sent_date, status, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(
      localProjectId,
      itemLocal,
      raw.letter_number,
      raw.letter_seq,
      raw.letter_year,
      raw.letter_type || 'cv',
      raw.letter_type_seq ?? raw.letter_seq ?? 1,
      raw.subject,
      raw.recipient ?? null,
      raw.sent_date ?? null,
      raw.status || 'draft',
      raw.notes ?? null,
      actorUserId
    ).run()
    await remember('letter', sourceId, Number(r.meta.last_row_id))
  }

  if (!run2 && bundle.letter_config) {
    const cfg = bundle.letter_config
    await db.prepare(
      `INSERT INTO legal_letter_config (project_id, prefix, include_project_code, seq_reset_yearly, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(project_id) DO UPDATE SET
         prefix = excluded.prefix,
         include_project_code = excluded.include_project_code,
         seq_reset_yearly = excluded.seq_reset_yearly,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(
      localProjectId,
      cfg.prefix || 'OC',
      cfg.include_project_code ?? 1,
      cfg.seq_reset_yearly ?? 1
    ).run()
  } else if (run2 && bundle.letter_config) {
    const exists = await db.prepare('SELECT 1 FROM legal_letter_config WHERE project_id = ?').bind(localProjectId).first()
    if (!exists) {
      const cfg = bundle.letter_config
      await db.prepare(
        `INSERT INTO legal_letter_config (project_id, prefix, include_project_code, seq_reset_yearly, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(localProjectId, cfg.prefix || 'OC', cfg.include_project_code ?? 1, cfg.seq_reset_yearly ?? 1).run()
    }
  }

  for (const raw of bundle.meetings) {
    const sourceId = Number(raw.id)
    if (!(await shouldInsert('meeting', sourceId))) continue
    const itemLocal = raw.legal_item_id != null ? resolve('item', raw.legal_item_id as number) : null
    const r = await db.prepare(
      `INSERT INTO meeting_minutes (project_id, legal_item_id, meeting_number, meeting_date, meeting_time, location, subject, chair_person, secretary, attendees, absent_members, agenda, discussion, decisions, action_items, attachments, status, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(
      localProjectId,
      itemLocal,
      raw.meeting_number ?? null,
      raw.meeting_date,
      raw.meeting_time ?? null,
      raw.location ?? null,
      raw.subject,
      raw.chair_person ?? null,
      raw.secretary ?? null,
      raw.attendees ?? null,
      raw.absent_members ?? null,
      raw.agenda ?? null,
      raw.discussion ?? null,
      raw.decisions ?? null,
      raw.action_items ?? null,
      raw.attachments ?? null,
      raw.status || 'draft',
      raw.notes ?? null,
      actorUserId
    ).run()
    await remember('meeting', sourceId, Number(r.meta.last_row_id))
  }

  if (!run2 && bundle.meeting_config) {
    const cfg = bundle.meeting_config
    await db.prepare(
      `INSERT INTO meeting_minutes_config (project_id, prefix, include_project_code, seq_reset_yearly, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(project_id) DO UPDATE SET
         prefix = excluded.prefix,
         include_project_code = excluded.include_project_code,
         seq_reset_yearly = excluded.seq_reset_yearly,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(localProjectId, cfg.prefix || 'BB', cfg.include_project_code ?? 1, cfg.seq_reset_yearly ?? 1).run()
  } else if (run2 && bundle.meeting_config) {
    const exists = await db.prepare('SELECT 1 FROM meeting_minutes_config WHERE project_id = ?').bind(localProjectId).first()
    if (!exists) {
      const cfg = bundle.meeting_config
      await db.prepare(
        `INSERT INTO meeting_minutes_config (project_id, prefix, include_project_code, seq_reset_yearly, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(localProjectId, cfg.prefix || 'BB', cfg.include_project_code ?? 1, cfg.seq_reset_yearly ?? 1).run()
    }
  }

  for (const raw of bundle.payments) {
    const sourceId = Number(raw.id)
    if (run2) {
      const existingLocal = await mapGetLocalId(db, localProjectId, 'payment', sourceId)
      if (existingLocal != null) {
        paymentsSkipped++
        continue
      }
    }
    const itemLocal = raw.legal_item_id != null ? resolve('item', raw.legal_item_id as number) : null
    const pkgLocal = raw.package_id != null ? resolve('package', raw.package_id as number) : null
    const r = await db.prepare(
      `INSERT INTO payment_requests (project_id, legal_item_id, package_id, request_number, description, request_date, amount, currency, status, paid_amount, paid_date, invoice_number, invoice_date, payment_phase, notes, vat_pct, created_by, created_at, updated_at, revenue_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, NULL)`
    ).bind(
      localProjectId,
      itemLocal,
      pkgLocal,
      raw.request_number ?? null,
      raw.description,
      raw.request_date ?? null,
      raw.amount ?? 0,
      raw.currency || 'VND',
      raw.status || 'pending',
      raw.paid_amount ?? 0,
      raw.paid_date ?? null,
      raw.invoice_number ?? null,
      raw.invoice_date ?? null,
      raw.payment_phase ?? null,
      raw.notes ?? null,
      raw.vat_pct ?? bundle.project.vat_pct ?? 0,
      actorUserId,
      raw.created_at ?? null
    ).run()
    const localPayId = Number(r.meta.last_row_id)
    await remember('payment', sourceId, localPayId)
    paymentsInserted++

    const payRow = await db.prepare('SELECT * FROM payment_requests WHERE id = ?').bind(localPayId).first() as Record<string, unknown>
    const revenueId = await syncPaymentToRevenue(db, {
      id: localPayId,
      project_id: localProjectId,
      description: String(payRow.description || ''),
      amount: Number(payRow.amount) || 0,
      paid_amount: Number(payRow.paid_amount) || 0,
      currency: String(payRow.currency || 'VND'),
      paid_date: (payRow.paid_date as string) || null,
      invoice_number: (payRow.invoice_number as string) || null,
      payment_phase: (payRow.payment_phase as string) || null,
      status: String(payRow.status || 'pending'),
      revenue_id: null,
      notes: (payRow.notes as string) || null,
      vat_pct: payRow.vat_pct != null ? Number(payRow.vat_pct) : null,
      request_date: (payRow.request_date as string) || null,
      created_at: (payRow.created_at as string) || null,
    }, actorUserId)
    await db.prepare('UPDATE payment_requests SET revenue_id = ? WHERE id = ?').bind(revenueId || null, localPayId).run()
  }

  for (const costRow of bundle.cost_a) {
    const localPayId = resolve('payment', Number(costRow.payment_request_id))
    if (!localPayId) continue
    const exists = await db.prepare(
      'SELECT id FROM legal_cost_a WHERE payment_request_id = ?'
    ).bind(localPayId).first()
    if (exists) continue
    await db.prepare(
      `INSERT INTO legal_cost_a (payment_request_id, amount_override, spend_status, note, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).bind(
      localPayId,
      costRow.amount_override ?? null,
      costRow.spend_status || 'unspent',
      costRow.note ?? null
    ).run()
  }

  if (bundle.contact_book) {
    if (!run2) {
      await db.prepare(
        `INSERT INTO project_contact_books (project_id, contacts_json, logs_json, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(project_id) DO UPDATE SET
           contacts_json = excluded.contacts_json,
           logs_json = excluded.logs_json,
           updated_at = CURRENT_TIMESTAMP`
      ).bind(localProjectId, bundle.contact_book.contacts_json, bundle.contact_book.logs_json).run()
    } else {
      const row = await db.prepare(
        'SELECT contacts_json, logs_json FROM project_contact_books WHERE project_id = ?'
      ).bind(localProjectId).first() as { contacts_json?: string; logs_json?: string } | null
      const merged = mergeContactBookJson(
        row?.contacts_json || '[]',
        row?.logs_json || '[]',
        bundle.contact_book.contacts_json,
        bundle.contact_book.logs_json
      )
      await db.prepare(
        `INSERT INTO project_contact_books (project_id, contacts_json, logs_json, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(project_id) DO UPDATE SET
           contacts_json = excluded.contacts_json,
           logs_json = excluded.logs_json,
           updated_at = CURRENT_TIMESTAMP`
      ).bind(localProjectId, merged.contacts_json, merged.logs_json).run()
    }
  }

  return {
    mode: run2 ? 'run2' : 'run1',
    payments_inserted: paymentsInserted,
    payments_skipped: paymentsSkipped,
  }
}

export async function resolveLegalSyncDocumentFile(
  db: D1Database,
  env: FileEnv,
  documentId: number
): Promise<{ row: Record<string, unknown>; key: string | null } | null> {
  const row = await db.prepare('SELECT * FROM legal_documents WHERE id = ?').bind(documentId).first() as Record<string, unknown> | null
  if (!row) return null
  const key = (row.r2_key as string) || (isR2Ref(String(row.file_url || '')) ? r2KeyFromRef(String(row.file_url)) : null)
  return { row, key }
}
