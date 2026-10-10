import { describe, expect, it } from 'vitest'
import { computeBookedRevenue } from './finance'
import {
  applyLegalSyncBundle,
  canPostLegalSyncFrom,
  contactEntryKey,
  contactLogKey,
  isLegalSyncRun2,
  legalSyncSecretOk,
  mergeContactBookJson,
  type LegalSyncBundle,
} from './legal-sync'

describe('legal-sync auth gates', () => {
  it('export requires matching secret (Bearer alone is not enough)', () => {
    expect(legalSyncSecretOk('', 'peer-secret')).toBe(false)
    expect(legalSyncSecretOk('peer-secret', 'peer-secret')).toBe(true)
    expect(legalSyncSecretOk('wrong', 'peer-secret')).toBe(false)
  })

  it('sync-from requires system_admin with project access', () => {
    expect(canPostLegalSyncFrom({ role: 'system_admin' }, true)).toBe(true)
    expect(canPostLegalSyncFrom({ role: 'member' }, true)).toBe(false)
    expect(canPostLegalSyncFrom({ role: 'system_admin' }, false)).toBe(false)
  })
})

describe('legal-sync run mode', () => {
  it('detects continuation when peer origin and source id match', () => {
    expect(isLegalSyncRun2('https://a.pages.dev/', 5, 'https://a.pages.dev', 5)).toBe(true)
    expect(isLegalSyncRun2('https://a.pages.dev', 5, 'https://a.pages.dev', 6)).toBe(false)
    expect(isLegalSyncRun2(null, 5, 'https://a.pages.dev', 5)).toBe(false)
  })
})

describe('contact book merge (run 2+)', () => {
  it('appends contacts and logs by stable keys only', () => {
    const merged = mergeContactBookJson(
      JSON.stringify([{ name: 'A', phone: '1' }]),
      JSON.stringify([{ date: '2026-01-01', content: 'Log cũ' }]),
      JSON.stringify([
        { name: 'A', phone: '1' },
        { name: 'B', phone: '2' },
      ]),
      JSON.stringify([
        { date: '2026-01-01', content: 'Log cũ' },
        { date: '2026-02-01', content: 'Log mới' },
      ])
    )
    const contacts = JSON.parse(merged.contacts_json)
    const logs = JSON.parse(merged.logs_json)
    expect(contacts).toHaveLength(2)
    expect(logs).toHaveLength(2)
    expect(contactEntryKey(contacts[1])).toBe(contactEntryKey({ name: 'B', phone: '2' }))
    expect(contactLogKey(logs[1])).toBe(contactLogKey({ date: '2026-02-01', content: 'Log mới' }))
  })
})

/** Minimal D1 mock for applyLegalSyncBundle payment run1/run2 tests. */
function createApplyTestDb() {
  let nextId = 1000
  const projects = [
    {
      id: 1,
      code: 'LOCAL',
      name: 'Local Project',
      client: 'Old client',
      description: 'Old',
      vat_pct: 10,
      management_fee_pct: 12,
      legal_sync_peer_origin: null as string | null,
      legal_sync_source_project_id: null as number | null,
    },
  ]
  const legal_packages: Record<string, unknown>[] = [
    { id: 50, project_id: 1, name: 'Old pkg', package_type: 'custom', sort_order: 1, contract_value: 0, contract_signed: 0 },
  ]
  const payment_requests: Record<string, unknown>[] = [
    {
      id: 60,
      project_id: 1,
      legal_item_id: null,
      package_id: 50,
      description: 'Old pay',
      amount: 999,
      paid_amount: 0,
      currency: 'VND',
      status: 'pending',
      vat_pct: 10,
      revenue_id: 900,
      request_date: '2026-01-01',
      created_at: '2026-01-01',
    },
  ]
  const project_revenues: Record<string, unknown>[] = [{ id: 900, project_id: 1, amount: 1 }]
  const legal_cost_a: Record<string, unknown>[] = []
  const legal_sync_id_map: { local_project_id: number; entity: string; source_id: number; local_id: number }[] = []
  const deletedRevenueIds: number[] = []

  const db = {
    prepare(sql: string) {
      const state = { binds: [] as unknown[] }
      const norm = sql.replace(/\s+/g, ' ').trim()
      const stmt = {
        bind(...args: unknown[]) {
          state.binds.push(...args)
          return stmt
        },
        async first() {
          if (norm.includes('FROM legal_sync_id_map WHERE')) {
            const [localProjectId, entity, sourceId] = state.binds as [number, string, number]
            const row = legal_sync_id_map.find(
              m => m.local_project_id === localProjectId && m.entity === entity && m.source_id === sourceId
            )
            return row ? { local_id: row.local_id } : null
          }
          if (norm.includes('legal_sync_peer_origin')) {
            return projects[0]
          }
          if (norm.includes('management_fee_pct')) {
            return { management_fee_pct: projects[0].management_fee_pct }
          }
          if (norm.includes('FROM payment_requests pr WHERE pr.id')) {
            return { ok: 1 }
          }
          if (norm.includes('SELECT * FROM payment_requests WHERE id = ?')) {
            const id = state.binds[0] as number
            return payment_requests.find(p => p.id === id) || null
          }
          if (norm.includes('FROM legal_letter_config')) return null
          if (norm.includes('FROM meeting_minutes_config')) return null
          if (norm.includes('FROM project_contact_books')) return null
          if (norm.includes('FROM legal_cost_a WHERE payment_request_id')) {
            const payId = state.binds[0]
            return legal_cost_a.find(r => r.payment_request_id === payId) || null
          }
          return null
        },
        async all() {
          if (norm.includes('FROM payment_requests WHERE project_id')) {
            return { results: payment_requests.filter(p => p.project_id === state.binds[0]) }
          }
          if (norm.includes('FROM legal_sync_id_map WHERE local_project_id')) {
            return {
              results: legal_sync_id_map.filter(m => m.local_project_id === state.binds[0]),
            }
          }
          return { results: [] }
        },
        async run() {
          if (norm.startsWith('DELETE FROM project_revenues')) {
            const id = state.binds[0] as number
            deletedRevenueIds.push(id)
            const idx = project_revenues.findIndex(r => r.id === id)
            if (idx >= 0) project_revenues.splice(idx, 1)
          } else if (norm.startsWith('DELETE FROM payment_requests')) {
            const pid = state.binds[0] as number
            for (let i = payment_requests.length - 1; i >= 0; i--) {
              if (payment_requests[i].project_id === pid) payment_requests.splice(i, 1)
            }
          } else if (norm.startsWith('DELETE FROM legal_packages')) {
            const pid = state.binds[0] as number
            for (let i = legal_packages.length - 1; i >= 0; i--) {
              if (legal_packages[i].project_id === pid) legal_packages.splice(i, 1)
            }
          } else if (norm.startsWith('DELETE FROM legal_sync_id_map')) {
            legal_sync_id_map.length = 0
          } else if (norm.includes('UPDATE projects SET legal_sync_peer_origin')) {
            Object.assign(projects[0], {
              legal_sync_peer_origin: state.binds[0],
              legal_sync_source_project_id: state.binds[1],
            })
          } else if (norm.startsWith('INSERT INTO legal_packages')) {
            const id = ++nextId
            legal_packages.push({
              id,
              project_id: state.binds[0],
              name: state.binds[1],
              package_type: state.binds[2],
              sort_order: state.binds[3],
              contract_value: state.binds[8],
              contract_signed: state.binds[9],
            })
            return { meta: { last_row_id: id } }
          } else if (norm.startsWith('INSERT INTO payment_requests')) {
            const id = ++nextId
            payment_requests.push({
              id,
              project_id: state.binds[0],
              legal_item_id: state.binds[1],
              package_id: state.binds[2],
              description: state.binds[4],
              amount: state.binds[6],
              currency: state.binds[7],
              status: state.binds[8],
              paid_amount: state.binds[9],
              vat_pct: state.binds[15],
              revenue_id: null,
              request_date: state.binds[5],
              created_at: state.binds[17],
            })
            return { meta: { last_row_id: id } }
          } else if (norm.startsWith('INSERT INTO legal_sync_id_map')) {
            legal_sync_id_map.push({
              local_project_id: state.binds[0] as number,
              entity: state.binds[1] as string,
              source_id: state.binds[2] as number,
              local_id: state.binds[3] as number,
            })
            return { meta: { last_row_id: 0 } }
          } else if (norm.startsWith('INSERT INTO project_revenues')) {
            const id = ++nextId
            project_revenues.push({ id, project_id: 1, amount: state.binds[2] })
            return { meta: { last_row_id: id } }
          } else if (norm.startsWith('INSERT INTO legal_cost_a')) {
            legal_cost_a.push({
              payment_request_id: state.binds[0],
              amount_override: state.binds[1],
              spend_status: state.binds[2],
              note: state.binds[3],
            })
          } else if (norm.startsWith('UPDATE payment_requests SET revenue_id')) {
            const revId = state.binds[0] as number | null
            const payId = state.binds[1] as number
            const pay = payment_requests.find(p => p.id === payId)
            if (pay) pay.revenue_id = revId
          }
          return { meta: { last_row_id: 0 } }
        },
      }
      return stmt
    },
  }

  const baseBundle = (): LegalSyncBundle => ({
    source_project_id: 99,
    project: { client: 'Peer client', description: 'Peer desc', vat_pct: 8, management_fee_pct: 40 },
    packages: [{
      id: 1,
      name: 'Peer pkg',
      package_type: 'custom',
      sort_order: 1,
      contract_value: 1_100_000,
      contract_signed: 1,
    }],
    stages: [],
    items: [],
    documents: [],
    letters: [],
    letter_config: null,
    meetings: [],
    meeting_config: null,
    payments: [{
      id: 10,
      package_id: 1,
      description: 'Peer NT',
      amount: 1_100_000,
      paid_amount: 0,
      currency: 'VND',
      status: 'processing',
      vat_pct: 10,
      request_date: '2026-03-15',
      created_at: '2026-03-15',
    }],
    cost_a: [],
    contact_book: null,
  })

  return {
    db: db as unknown as D1Database,
    projects,
    legal_packages,
    payment_requests,
    project_revenues,
    legal_cost_a,
    legal_sync_id_map,
    deletedRevenueIds,
    baseBundle,
  }
}

describe('applyLegalSyncBundle payments', () => {
  it('run 1 replaces payments, clears old revenue, books new revenue', async () => {
    const h = createApplyTestDb()
    const result = await applyLegalSyncBundle({
      db: h.db,
      env: {},
      localProjectId: 1,
      bundle: h.baseBundle(),
      peerOrigin: 'https://peer.example',
      secret: 's',
      actorUserId: 7,
      run2: false,
    })
    expect(result.mode).toBe('run1')
    expect(h.projects[0].code).toBe('LOCAL')
    expect(h.projects[0].name).toBe('Local Project')
    expect(h.projects[0].client).toBe('Old client')
    expect(h.projects[0].description).toBe('Old')
    expect(h.projects[0].vat_pct).toBe(10)
    expect(h.projects[0].management_fee_pct).toBe(12)
    expect(h.projects[0].legal_sync_source_project_id).toBe(99)
    expect(h.deletedRevenueIds).toContain(900)
    expect(h.payment_requests.some(p => p.description === 'Old pay')).toBe(false)
    const peerPay = h.payment_requests.find(p => p.description === 'Peer NT')
    expect(peerPay).toBeTruthy()
    expect(peerPay?.amount).toBe(1_100_000)
    expect(h.project_revenues.length).toBeGreaterThan(0)
    const { bookedRevenue } = computeBookedRevenue(1_100_000, 10, 12)
    expect(Number(h.project_revenues[h.project_revenues.length - 1].amount)).toBe(bookedRevenue)
  })

  it('run 2 keeps local amount when source payment changed', async () => {
    const h = createApplyTestDb()
    h.projects[0].legal_sync_peer_origin = 'https://peer.example'
    h.projects[0].legal_sync_source_project_id = 99
    h.legal_sync_id_map.push({ local_project_id: 1, entity: 'package', source_id: 1, local_id: 50 })
    h.legal_sync_id_map.push({
      local_project_id: 1,
      entity: 'payment',
      source_id: 10,
      local_id: 60,
    })
    h.payment_requests[0].description = 'Local locked'
    h.payment_requests[0].amount = 500_000

    const bundle = h.baseBundle()
    bundle.payments[0].amount = 9_999_999
    bundle.payments.push({
      id: 11,
      package_id: 1,
      description: 'Peer new pay',
      amount: 2_200_000,
      paid_amount: 0,
      currency: 'VND',
      status: 'processing',
      vat_pct: 10,
      request_date: '2026-04-01',
      created_at: '2026-04-01',
    })

    const result = await applyLegalSyncBundle({
      db: h.db,
      env: {},
      localProjectId: 1,
      bundle,
      peerOrigin: 'https://peer.example',
      secret: 's',
      actorUserId: 7,
      run2: true,
    })
    expect(result.mode).toBe('run2')
    expect(result.payments_skipped).toBe(1)
    expect(result.payments_inserted).toBe(1)
    const locked = h.payment_requests.find(p => p.id === 60)
    expect(locked?.amount).toBe(500_000)
    expect(h.payment_requests.some(p => p.description === 'Peer new pay')).toBe(true)
  })

  it('run 2 inserts a missing cost A row and does not change an existing one', async () => {
    const h = createApplyTestDb()
    h.projects[0].legal_sync_peer_origin = 'https://peer.example'
    h.projects[0].legal_sync_source_project_id = 99
    h.legal_sync_id_map.push({ local_project_id: 1, entity: 'package', source_id: 1, local_id: 50 })
    h.legal_sync_id_map.push({
      local_project_id: 1,
      entity: 'payment',
      source_id: 10,
      local_id: 60,
    })
    h.legal_cost_a.push({
      payment_request_id: 60,
      amount_override: 111,
      spend_status: 'spent',
      note: 'giữ',
    })

    const bundle = h.baseBundle()
    bundle.payments.push({
      id: 11,
      package_id: 1,
      description: 'Peer new pay',
      amount: 2_200_000,
      paid_amount: 0,
      currency: 'VND',
      status: 'pending',
      vat_pct: 10,
      request_date: '2026-04-01',
      created_at: '2026-04-01',
    })
    bundle.cost_a = [
      { payment_request_id: 10, amount_override: 999, spend_status: 'unspent', note: 'đổi' },
      { payment_request_id: 11, amount_override: 222, spend_status: 'unspent', note: 'mới' },
    ]

    await applyLegalSyncBundle({
      db: h.db,
      env: {},
      localProjectId: 1,
      bundle,
      peerOrigin: 'https://peer.example',
      secret: 's',
      actorUserId: 7,
      run2: true,
    })

    const kept = h.legal_cost_a.find(r => r.payment_request_id === 60)
    expect(kept?.amount_override).toBe(111)
    expect(kept?.note).toBe('giữ')
    const added = h.legal_cost_a.find(r => r.note === 'mới')
    expect(added?.amount_override).toBe(222)
    expect(h.legal_cost_a.filter(r => r.note === 'đổi')).toHaveLength(0)
  })
})
