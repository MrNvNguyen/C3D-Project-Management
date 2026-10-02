import { describe, expect, it } from 'vitest'
import {
  copyLegalPackageInnerContent,
  legalDocMatchKey,
  legalItemMatchKey,
  legalStageMatchKey,
  planLegalCopyFromBody,
} from './legal-copy'

type Row = Record<string, unknown>

function createLegalCopyTestDb() {
  let nextId = 100
  const tables: Record<string, Row[]> = {
    projects: [{ id: 1, code: 'A', project_code_letter: 'A' }, { id: 2, code: 'B', project_code_letter: 'B' }],
    legal_packages: [
      { id: 10, project_id: 1, name: 'Pkg A' },
      { id: 20, project_id: 2, name: 'Pkg B' },
    ],
    legal_stages: [
      { id: 101, project_id: 1, package_id: 10, code: 'A', name: 'Stage 1', sort_order: 1 },
      { id: 201, project_id: 2, package_id: 20, code: 'A', name: 'Stage 1', sort_order: 1 },
    ],
    legal_items: [
      {
        id: 1001,
        project_id: 1,
        stage_id: 101,
        parent_id: null,
        stt: '1',
        title: 'Hạng mục giữ',
        item_type: 'document',
        due_date: '2026-01-01',
        actual_completion_date: null,
        status: 'pending',
        notes: 'src',
        sort_order: 1,
      },
      {
        id: 2001,
        project_id: 2,
        stage_id: 201,
        parent_id: null,
        stt: '1',
        title: 'Hạng mục đích có sẵn',
        item_type: 'document',
        due_date: null,
        actual_completion_date: null,
        status: 'completed',
        notes: 'dest existing',
        sort_order: 1,
      },
      {
        id: 1002,
        project_id: 1,
        stage_id: 101,
        parent_id: null,
        stt: '2',
        title: 'Hạng mục mới',
        item_type: 'task',
        due_date: '2026-02-01',
        actual_completion_date: '2026-02-10',
        status: 'in_progress',
        notes: 'only on A',
        sort_order: 2,
      },
    ],
    legal_documents: [
      {
        id: 501,
        project_id: 1,
        legal_item_id: 1001,
        doc_type: 'contract',
        title: 'HĐ mẫu',
        file_name: 'hd.pdf',
        file_url: 'http://x',
        signed_date: '2026-01-05',
        notes: null,
        r2_key: 'k1',
      },
    ],
    outgoing_letters: [
      {
        id: 601,
        project_id: 1,
        legal_item_id: 1002,
        letter_number: '01-CV/A',
        letter_seq: 1,
        letter_year: 2026,
        letter_type: 'cv',
        letter_type_seq: 1,
        subject: 'CV nộp hồ sơ',
        recipient: 'CĐT',
        sent_date: '2026-02-02',
        status: 'sent',
        notes: null,
      },
    ],
    payment_requests: [
      {
        id: 701,
        project_id: 1,
        legal_item_id: 1001,
        package_id: 10,
        description: 'pay',
        amount: 1000,
      },
    ],
    tasks: [{ id: 801, project_id: 1, legal_item_id: 1002, title: 'Task A' }],
  }

  const db = {
    prepare(sql: string) {
      const state = { binds: [] as unknown[] }
      const stmt = {
        bind(...args: unknown[]) {
          state.binds.push(...args)
          return stmt
        },
        async first() {
          const s = sql.replace(/\s+/g, ' ').trim()
          if (s.includes('FROM legal_packages WHERE id')) {
            const id = state.binds[0] as number
            return tables.legal_packages.find((p) => p.id === id) ?? null
          }
          if (s.includes('FROM projects WHERE id')) {
            const id = state.binds[0] as number
            return tables.projects.find((p) => p.id === id) ?? null
          }
          if (s.includes('MAX(letter_type_seq)')) {
            const [projectId, letterType] = state.binds as [number, string]
            const max = tables.outgoing_letters
              .filter((l) => l.project_id === projectId && l.letter_type === letterType)
              .reduce((m, l) => Math.max(m, Number(l.letter_type_seq) || 0), 0)
            return { max_seq: max }
          }
          if (s.includes('MAX(letter_seq)')) {
            const projectId = state.binds[0] as number
            const max = tables.outgoing_letters
              .filter((l) => l.project_id === projectId)
              .reduce((m, l) => Math.max(m, Number(l.letter_seq) || 0), 0)
            return { max_seq: max }
          }
          if (s.includes('FROM legal_documents WHERE project_id') && s.includes('LOWER(TRIM(title))')) {
            const [projectId, itemId, docType, title] = state.binds as [number, number, string, string]
            const hit = tables.legal_documents.find(
              (d) =>
                d.project_id === projectId &&
                d.legal_item_id === itemId &&
                d.doc_type === docType &&
                String(d.title).trim().toLowerCase() === String(title).trim().toLowerCase(),
            )
            return hit ? { id: hit.id } : null
          }
          if (s.includes('FROM outgoing_letters WHERE project_id') && s.includes('LOWER(TRIM(subject))')) {
            const [projectId, itemId, letterType, subject] = state.binds as [number, number, string, string]
            const hit = tables.outgoing_letters.find(
              (l) =>
                l.project_id === projectId &&
                l.legal_item_id === itemId &&
                l.letter_type === letterType &&
                String(l.subject).trim().toLowerCase() === String(subject).trim().toLowerCase(),
            )
            return hit ? { id: hit.id } : null
          }
          return null
        },
        async all() {
          const s = sql.replace(/\s+/g, ' ').trim()
          if (s.includes('FROM legal_stages WHERE package_id')) {
            const packageId = state.binds[0] as number
            return {
              results: tables.legal_stages.filter((st) => st.package_id === packageId),
            }
          }
          if (s.includes('FROM legal_items WHERE stage_id IN')) {
            const stageIds = state.binds as number[]
            return {
              results: tables.legal_items.filter((it) => stageIds.includes(it.stage_id as number)),
            }
          }
          if (s.includes('FROM legal_documents WHERE project_id') && s.includes('legal_item_id IN')) {
            const projectId = state.binds[0] as number
            const itemIds = state.binds.slice(1) as number[]
            return {
              results: tables.legal_documents.filter(
                (d) => d.project_id === projectId && itemIds.includes(d.legal_item_id as number),
              ),
            }
          }
          if (s.includes('FROM outgoing_letters WHERE project_id') && s.includes('legal_item_id IN')) {
            const projectId = state.binds[0] as number
            const itemIds = state.binds.slice(1) as number[]
            return {
              results: tables.outgoing_letters.filter(
                (l) => l.project_id === projectId && itemIds.includes(l.legal_item_id as number),
              ),
            }
          }
          return { results: [] }
        },
        async run() {
          const s = sql.replace(/\s+/g, ' ').trim()
          if (s.startsWith('UPDATE legal_stages SET')) {
            const [name, sortOrder, id, packageId] = state.binds as [string, number, number, number]
            const st = tables.legal_stages.find((row) => row.id === id && row.package_id === packageId)
            if (st) {
              st.name = name
              st.sort_order = sortOrder
            }
            return { meta: { last_row_id: id } }
          }
          if (s.startsWith('UPDATE legal_items SET')) {
            const binds = state.binds as unknown[]
            const id = binds[8] as number
            const projectId = binds[9] as number
            const row = tables.legal_items.find((it) => it.id === id && it.project_id === projectId)
            if (row) {
              row.stt = binds[0]
              row.title = binds[1]
              row.item_type = binds[2]
              row.due_date = binds[3]
              row.actual_completion_date = binds[4]
              row.status = binds[5]
              row.notes = binds[6]
              row.sort_order = binds[7]
            }
            return { meta: { last_row_id: id } }
          }
          if (s.startsWith('INSERT INTO legal_stages')) {
            const id = ++nextId
            tables.legal_stages.push({
              id,
              project_id: state.binds[0],
              package_id: state.binds[1],
              code: state.binds[2],
              name: state.binds[3],
              sort_order: state.binds[4],
            })
            return { meta: { last_row_id: id } }
          }
          if (s.startsWith('INSERT INTO legal_items')) {
            const id = ++nextId
            tables.legal_items.push({
              id,
              project_id: state.binds[0],
              stage_id: state.binds[1],
              parent_id: state.binds[2],
              stt: state.binds[3],
              title: state.binds[4],
              item_type: state.binds[5],
              due_date: state.binds[6],
              actual_completion_date: state.binds[7],
              status: state.binds[8],
              notes: state.binds[9],
              sort_order: state.binds[10],
              created_by: state.binds[11],
            })
            return { meta: { last_row_id: id } }
          }
          if (s.startsWith('INSERT INTO legal_documents')) {
            const id = ++nextId
            tables.legal_documents.push({
              id,
              project_id: state.binds[0],
              legal_item_id: state.binds[1],
              doc_type: state.binds[2],
              title: state.binds[3],
              file_name: state.binds[4],
              file_url: null,
              signed_date: state.binds[5],
              notes: state.binds[6],
              created_by: state.binds[7],
            })
            return { meta: { last_row_id: id } }
          }
          if (s.startsWith('INSERT INTO outgoing_letters')) {
            const id = ++nextId
            tables.outgoing_letters.push({
              id,
              project_id: state.binds[0],
              legal_item_id: state.binds[1],
              letter_number: state.binds[2],
              letter_seq: state.binds[3],
              letter_year: state.binds[4],
              letter_type: state.binds[5],
              letter_type_seq: state.binds[6],
              subject: state.binds[7],
              recipient: state.binds[8],
              sent_date: state.binds[9],
              status: state.binds[10],
              notes: state.binds[11],
              created_by: state.binds[12],
            })
            return { meta: { last_row_id: id } }
          }
          return { meta: { last_row_id: 0 } }
        },
      }
      return stmt
    },
  }

  return { db: db as unknown as D1Database, tables }
}

describe('legal-copy match keys', () => {
  it('builds stable stage and item keys', () => {
    expect(legalStageMatchKey('A', 'Stage 1')).toBe('a|stage 1')
    expect(legalItemMatchKey(1, null, 'Doc', 'document')).toBe('1|0|doc|document')
    expect(legalDocMatchKey(5, 'contract', 'HĐ')).toBe('5|contract|hđ')
  })
})

describe('planLegalCopyFromBody', () => {
  it('allows content-only copy when no package_ids', () => {
    const plan = planLegalCopyFromBody({
      inner_content: { source_package_id: 10, dest_package_id: 20 },
    })
    expect('error' in plan).toBe(false)
    if ('error' in plan) return
    expect(plan.runShellCopy).toBe(false)
    expect(plan.innerRequested).toBe(true)
  })

  it('returns 400 Chọn gói đích when source set without dest (not 500 path)', () => {
    const plan = planLegalCopyFromBody({
      inner_content: { source_package_id: 10, dest_package_id: 0 },
    })
    expect(plan).toEqual({ error: 'Chọn gói đích', status: 400 })
  })
})

describe('copyLegalPackageInnerContent', () => {
  it('maps stages by package code when names differ (UNIQUE package_id+code)', async () => {
    const { db, tables } = createLegalCopyTestDb()
    const destStage = tables.legal_stages.find((st) => st.id === 201)
    if (destStage) destStage.name = 'Tên đích khác'

    const result = await copyLegalPackageInnerContent(db, {
      sourceProjectId: 1,
      destProjectId: 2,
      sourcePackageId: 10,
      destPackageId: 20,
      userId: 99,
      onNameConflict: 'overwrite',
    })

    expect(result.new_stages).toBe(0)
    expect(destStage?.name).toBe('Stage 1')
    expect(result.copied_items).toBeGreaterThan(0)
  })

  it('copies inner rows onto dest package without payments/tasks and keeps dest rows', async () => {
    const { db, tables } = createLegalCopyTestDb()
    const destItemsBefore = tables.legal_items.filter((i) => i.project_id === 2).length
    const paymentsBefore = tables.payment_requests.length
    const tasksBefore = tables.tasks.length

    const result = await copyLegalPackageInnerContent(db, {
      sourceProjectId: 1,
      destProjectId: 2,
      sourcePackageId: 10,
      destPackageId: 20,
      userId: 99,
    })

    expect(result.copied_items).toBe(2)
    expect(result.skipped_items).toBe(0)
    expect(result.copied_documents).toBe(1)
    expect(result.copied_letters).toBe(1)

    const destItemsAfter = tables.legal_items.filter((i) => i.project_id === 2)
    expect(destItemsAfter.length).toBe(destItemsBefore + 2)
    expect(destItemsAfter.some((i) => i.id === 2001 && i.notes === 'dest existing')).toBe(true)

    expect(tables.payment_requests.length).toBe(paymentsBefore)
    expect(tables.tasks.length).toBe(tasksBefore)

    const newDoc = tables.legal_documents.find(
      (d) => d.project_id === 2 && d.title === 'HĐ mẫu',
    )
    expect(newDoc).toBeTruthy()
    expect(newDoc?.file_url).toBeNull()

    const newLetter = tables.outgoing_letters.find(
      (l) => l.project_id === 2 && l.subject === 'CV nộp hồ sơ',
    )
    expect(newLetter).toBeTruthy()
    expect(String(newLetter?.letter_number)).toContain('OneCAD-BIM')
  })
})
