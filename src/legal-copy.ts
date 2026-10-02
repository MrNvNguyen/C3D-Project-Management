/** HSPL: copy inner package content (items, docs, letters) — not payments/tasks. */

const LETTER_TYPE_CODE: Record<string, string> = {
  cv: 'CV',
  bc: 'BC',
  bb: 'BB',
  tb: 'TB',
  qd: 'QĐ',
  tt: 'TT',
  kh: 'KH',
  yc: 'YC',
  pl: 'PL',
  contract: 'HĐ',
  appendix: 'PHỤ LỤC',
  acceptance: 'BBNT',
  payment: 'TT',
  other: 'VB',
}

export function legalStageMatchKey(code: string, name: string): string {
  return `${String(code || '').trim().toLowerCase()}|${String(name || '').trim().toLowerCase()}`
}

export function legalItemMatchKey(
  stageId: number,
  parentId: number | null,
  title: string,
  itemType: string,
): string {
  return `${stageId}|${parentId ?? 0}|${String(title || '').trim().toLowerCase()}|${String(itemType || 'task').trim().toLowerCase()}`
}

export function legalDocMatchKey(itemId: number, docType: string, title: string): string {
  return `${itemId}|${String(docType || '').trim().toLowerCase()}|${String(title || '').trim().toLowerCase()}`
}

export function legalLetterMatchKey(itemId: number, letterType: string, subject: string): string {
  return `${itemId}|${String(letterType || 'cv').trim().toLowerCase()}|${String(subject || '').trim().toLowerCase()}`
}

async function generateLetterNumber(
  db: D1Database,
  projectId: number,
  letterType: string,
): Promise<{ number: string; seq: number; typeSeq: number }> {
  const proj = (await db
    .prepare('SELECT code, project_code_letter FROM projects WHERE id = ?')
    .bind(projectId)
    .first()) as { code?: string; project_code_letter?: string } | null
  const projCode =
    proj?.project_code_letter && proj.project_code_letter.trim() !== ''
      ? proj.project_code_letter.trim()
      : proj?.code || `P${projectId}`

  const typeCode = LETTER_TYPE_CODE[letterType] || letterType.toUpperCase()

  const lastRow = (await db
    .prepare(
      'SELECT MAX(letter_type_seq) as max_seq FROM outgoing_letters WHERE project_id = ? AND letter_type = ?',
    )
    .bind(projectId, letterType)
    .first()) as { max_seq?: number } | null
  const typeSeq = (lastRow?.max_seq || 0) + 1

  const lastTotal = (await db
    .prepare('SELECT MAX(letter_seq) as max_seq FROM outgoing_letters WHERE project_id = ?')
    .bind(projectId)
    .first()) as { max_seq?: number } | null
  const seq = (lastTotal?.max_seq || 0) + 1

  const sttStr = String(typeSeq).padStart(2, '0')
  const number = `${sttStr}-${typeCode}/OneCAD-BIM(${projCode})`

  return { number, seq, typeSeq }
}

export type LegalCopyNameConflictMode = 'skip' | 'overwrite'

export type CopyLegalPackageInnerContentParams = {
  sourceProjectId: number
  destProjectId: number
  sourcePackageId: number
  destPackageId: number
  userId: number
  onNameConflict?: LegalCopyNameConflictMode
}

export type PlanLegalCopyFromBodyResult = {
  runShellCopy: boolean
  innerRequested: boolean
  innerSourcePackageId: number
  innerDestPackageId: number
  packageIdsFilter: number[] | null
  onNameConflict: LegalCopyNameConflictMode
}

/** Route planning for POST /api/legal/:projectId/copy-from (testable, no I/O). */
export function planLegalCopyFromBody(
  body: Record<string, unknown>,
):
  | PlanLegalCopyFromBodyResult
  | { error: string; status: 400 } {
  const onNameConflict: LegalCopyNameConflictMode =
    body.on_name_conflict === 'overwrite' ? 'overwrite' : 'skip'

  const packageIdsFilter: number[] | null = Array.isArray(body.package_ids)
    ? (body.package_ids as unknown[])
        .map((x) => parseInt(String(x), 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    : null
  const hasShellPackages = packageIdsFilter != null && packageIdsFilter.length > 0

  const innerRaw = body.inner_content as Record<string, unknown> | undefined
  const innerSourcePackageId = innerRaw
    ? parseInt(String(innerRaw.source_package_id), 10)
    : NaN
  const innerDestPackageId = innerRaw
    ? parseInt(String(innerRaw.dest_package_id), 10)
    : NaN
  const innerSourceSet = Number.isFinite(innerSourcePackageId) && innerSourcePackageId > 0
  const innerDestSet = Number.isFinite(innerDestPackageId) && innerDestPackageId > 0

  if (innerSourceSet && !innerDestSet) {
    return { error: 'Chọn gói đích', status: 400 }
  }
  if (innerDestSet && !innerSourceSet) {
    return { error: 'Chọn gói nguồn', status: 400 }
  }

  const innerRequested = innerSourceSet && innerDestSet
  if (!hasShellPackages && !innerRequested) {
    return { error: 'Chọn gói thầu hoặc sao chép nội dung gói', status: 400 }
  }

  return {
    runShellCopy: hasShellPackages,
    innerRequested,
    innerSourcePackageId,
    innerDestPackageId,
    packageIdsFilter,
    onNameConflict,
  }
}

export type CopyLegalPackageInnerContentResult = {
  copied_items: number
  skipped_items: number
  copied_documents: number
  skipped_documents: number
  copied_letters: number
  skipped_letters: number
  new_stages: number
  affected_stage_ids: number[]
}

export async function copyLegalPackageInnerContent(
  db: D1Database,
  params: CopyLegalPackageInnerContentParams,
): Promise<CopyLegalPackageInnerContentResult> {
  const {
    sourceProjectId,
    destProjectId,
    sourcePackageId,
    destPackageId,
    userId,
    onNameConflict = 'skip',
  } = params

  const srcPkg = (await db
    .prepare('SELECT id, project_id FROM legal_packages WHERE id = ?')
    .bind(sourcePackageId)
    .first()) as { id: number; project_id: number } | null
  if (!srcPkg || srcPkg.project_id !== sourceProjectId) {
    throw new Error('Gói nguồn không thuộc dự án nguồn')
  }
  const destPkg = (await db
    .prepare('SELECT id, project_id FROM legal_packages WHERE id = ?')
    .bind(destPackageId)
    .first()) as { id: number; project_id: number } | null
  if (!destPkg || destPkg.project_id !== destProjectId) {
    throw new Error('Gói đích không thuộc dự án đang mở')
  }
  if (sourcePackageId === destPackageId && sourceProjectId === destProjectId) {
    throw new Error('Gói nguồn và gói đích phải khác nhau')
  }

  const result: CopyLegalPackageInnerContentResult = {
    copied_items: 0,
    skipped_items: 0,
    copied_documents: 0,
    skipped_documents: 0,
    copied_letters: 0,
    skipped_letters: 0,
    new_stages: 0,
    affected_stage_ids: [],
  }

  const srcStagesRes = await db
    .prepare('SELECT * FROM legal_stages WHERE package_id = ? ORDER BY sort_order, id')
    .bind(sourcePackageId)
    .all()
  const srcStages = srcStagesRes.results as any[]

  const destStagesRes = await db
    .prepare('SELECT * FROM legal_stages WHERE package_id = ? ORDER BY sort_order, id')
    .bind(destPackageId)
    .all()
  const destStages = destStagesRes.results as any[]

  const destStageByKey = new Map<string, number>()
  const destStageByCode = new Map<string, number>()
  for (const st of destStages) {
    destStageByKey.set(legalStageMatchKey(st.code, st.name), st.id)
    const codeKey = String(st.code || '').trim().toLowerCase()
    if (codeKey && !destStageByCode.has(codeKey)) {
      destStageByCode.set(codeKey, st.id)
    }
  }

  const stageMap = new Map<number, number>()
  for (const st of srcStages) {
    const key = legalStageMatchKey(st.code, st.name)
    const codeKey = String(st.code || '').trim().toLowerCase()
    let existing = destStageByKey.get(key) ?? (codeKey ? destStageByCode.get(codeKey) : undefined)
    if (existing) {
      stageMap.set(st.id, existing)
      if (onNameConflict === 'overwrite') {
        await db
          .prepare(
            'UPDATE legal_stages SET name = ?, sort_order = ? WHERE id = ? AND package_id = ?',
          )
          .bind(st.name, st.sort_order ?? 0, existing, destPackageId)
          .run()
        if (!result.affected_stage_ids.includes(existing)) {
          result.affected_stage_ids.push(existing)
        }
      }
    } else {
      const ins = await db
        .prepare(
          'INSERT INTO legal_stages (project_id, package_id, code, name, sort_order) VALUES (?,?,?,?,?)',
        )
        .bind(destProjectId, destPackageId, st.code, st.name, st.sort_order ?? 0)
        .run()
      const newId = ins.meta.last_row_id as number
      stageMap.set(st.id, newId)
      destStageByKey.set(key, newId)
      if (codeKey) destStageByCode.set(codeKey, newId)
      result.new_stages += 1
      result.affected_stage_ids.push(newId)
    }
  }

  const srcStageIds = [...stageMap.keys()]
  if (srcStageIds.length === 0) {
    return result
  }

  const destStageIds = [...new Set(stageMap.values())]
  const destPlaceholders = destStageIds.map(() => '?').join(',')
  const destItemsRes = await db
    .prepare(`SELECT * FROM legal_items WHERE stage_id IN (${destPlaceholders}) ORDER BY stage_id, sort_order, id`)
    .bind(...destStageIds)
    .all()
  const destItems = destItemsRes.results as any[]
  const destItemByKey = new Map<string, number>()
  for (const it of destItems) {
    destItemByKey.set(
      legalItemMatchKey(it.stage_id, it.parent_id, it.title, it.item_type),
      it.id,
    )
  }

  const srcPlaceholders = srcStageIds.map(() => '?').join(',')
  const srcItemsRes = await db
    .prepare(
      `SELECT * FROM legal_items WHERE stage_id IN (${srcPlaceholders}) ORDER BY stage_id, parent_id IS NOT NULL, sort_order, id`,
    )
    .bind(...srcStageIds)
    .all()
  const srcItems = srcItemsRes.results as any[]
  const itemMap = new Map<number, number>()

  for (const it of srcItems.filter((i) => i.parent_id == null)) {
    const destStageId = stageMap.get(it.stage_id)
    if (!destStageId) continue
    const key = legalItemMatchKey(destStageId, null, it.title, it.item_type)
    const existingId = destItemByKey.get(key)
    if (existingId) {
      itemMap.set(it.id, existingId)
      if (onNameConflict === 'overwrite') {
        await db
          .prepare(
            `UPDATE legal_items SET stt = ?, title = ?, item_type = ?, due_date = ?, actual_completion_date = ?, status = ?, notes = ?, sort_order = ?
             WHERE id = ? AND project_id = ?`,
          )
          .bind(
            it.stt || '1',
            it.title,
            it.item_type || 'task',
            it.due_date || null,
            it.actual_completion_date || null,
            it.status || 'pending',
            it.notes || null,
            it.sort_order ?? 0,
            existingId,
            destProjectId,
          )
          .run()
        result.copied_items += 1
        if (!result.affected_stage_ids.includes(destStageId)) {
          result.affected_stage_ids.push(destStageId)
        }
      } else {
        result.skipped_items += 1
      }
      continue
    }
    const ins = await db
      .prepare(
        `INSERT INTO legal_items (project_id, stage_id, parent_id, stt, title, item_type, due_date, actual_completion_date, status, notes, sort_order, created_by)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        destProjectId,
        destStageId,
        it.stt || '1',
        it.title,
        it.item_type || 'task',
        it.due_date || null,
        it.actual_completion_date || null,
        it.status || 'pending',
        it.notes || null,
        it.sort_order ?? 0,
        userId,
      )
      .run()
    const newId = ins.meta.last_row_id as number
    itemMap.set(it.id, newId)
    destItemByKey.set(key, newId)
    result.copied_items += 1
    if (!result.affected_stage_ids.includes(destStageId)) {
      result.affected_stage_ids.push(destStageId)
    }
  }

  for (const it of srcItems.filter((i) => i.parent_id != null)) {
    const destStageId = stageMap.get(it.stage_id)
    const destParentId = itemMap.get(it.parent_id)
    if (!destStageId || !destParentId) continue
    const key = legalItemMatchKey(destStageId, destParentId, it.title, it.item_type)
    const existingId = destItemByKey.get(key)
    if (existingId) {
      itemMap.set(it.id, existingId)
      if (onNameConflict === 'overwrite') {
        await db
          .prepare(
            `UPDATE legal_items SET stt = ?, title = ?, item_type = ?, due_date = ?, actual_completion_date = ?, status = ?, notes = ?, sort_order = ?
             WHERE id = ? AND project_id = ?`,
          )
          .bind(
            it.stt || '1',
            it.title,
            it.item_type || 'task',
            it.due_date || null,
            it.actual_completion_date || null,
            it.status || 'pending',
            it.notes || null,
            it.sort_order ?? 0,
            existingId,
            destProjectId,
          )
          .run()
        result.copied_items += 1
        if (!result.affected_stage_ids.includes(destStageId)) {
          result.affected_stage_ids.push(destStageId)
        }
      } else {
        result.skipped_items += 1
      }
      continue
    }
    const ins = await db
      .prepare(
        `INSERT INTO legal_items (project_id, stage_id, parent_id, stt, title, item_type, due_date, actual_completion_date, status, notes, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        destProjectId,
        destStageId,
        destParentId,
        it.stt || '1',
        it.title,
        it.item_type || 'task',
        it.due_date || null,
        it.actual_completion_date || null,
        it.status || 'pending',
        it.notes || null,
        it.sort_order ?? 0,
        userId,
      )
      .run()
    const newId = ins.meta.last_row_id as number
    itemMap.set(it.id, newId)
    destItemByKey.set(key, newId)
    result.copied_items += 1
    if (!result.affected_stage_ids.includes(destStageId)) {
      result.affected_stage_ids.push(destStageId)
    }
  }

  const srcItemIds = [...itemMap.keys()]
  if (srcItemIds.length === 0) {
    return result
  }

  const docPlaceholders = srcItemIds.map(() => '?').join(',')
  const docsRes = await db
    .prepare(
      `SELECT * FROM legal_documents WHERE project_id = ? AND legal_item_id IN (${docPlaceholders})`,
    )
    .bind(sourceProjectId, ...srcItemIds)
    .all()
  const docs = docsRes.results as any[]

  for (const doc of docs) {
    const destItemId = itemMap.get(doc.legal_item_id)
    if (!destItemId) continue
    const dup = await db
      .prepare(
        `SELECT id FROM legal_documents WHERE project_id = ? AND legal_item_id = ? AND doc_type = ? AND LOWER(TRIM(title)) = LOWER(TRIM(?)) LIMIT 1`,
      )
      .bind(destProjectId, destItemId, doc.doc_type, doc.title)
      .first()
    if (dup) {
      result.skipped_documents += 1
      continue
    }
    await db
      .prepare(
        `INSERT INTO legal_documents (project_id, legal_item_id, doc_type, title, file_name, file_url, signed_date, notes, created_by)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      )
      .bind(
        destProjectId,
        destItemId,
        doc.doc_type,
        doc.title,
        doc.file_name || null,
        doc.signed_date || null,
        doc.notes || null,
        userId,
      )
      .run()
    result.copied_documents += 1
  }

  const lettersRes = await db
    .prepare(
      `SELECT * FROM outgoing_letters WHERE project_id = ? AND legal_item_id IN (${docPlaceholders})`,
    )
    .bind(sourceProjectId, ...srcItemIds)
    .all()
  const letters = lettersRes.results as any[]

  for (const letter of letters) {
    const destItemId = itemMap.get(letter.legal_item_id)
    if (!destItemId) continue
    const letterType = letter.letter_type || 'cv'
    const dup = await db
      .prepare(
        `SELECT id FROM outgoing_letters WHERE project_id = ? AND legal_item_id = ? AND letter_type = ? AND LOWER(TRIM(subject)) = LOWER(TRIM(?)) LIMIT 1`,
      )
      .bind(destProjectId, destItemId, letterType, letter.subject)
      .first()
    if (dup) {
      result.skipped_letters += 1
      continue
    }
    const year = letter.sent_date
      ? parseInt(String(letter.sent_date).split('-')[0], 10)
      : new Date().getFullYear()
    const { number, seq, typeSeq } = await generateLetterNumber(db, destProjectId, letterType)
    await db
      .prepare(
        `INSERT INTO outgoing_letters (project_id, legal_item_id, letter_number, letter_seq, letter_year, letter_type, letter_type_seq, subject, recipient, sent_date, status, notes, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        destProjectId,
        destItemId,
        number,
        seq,
        year,
        letterType,
        typeSeq,
        letter.subject,
        letter.recipient || null,
        letter.sent_date || null,
        letter.status || 'draft',
        letter.notes || null,
        userId,
      )
      .run()
    result.copied_letters += 1
  }

  return result
}
