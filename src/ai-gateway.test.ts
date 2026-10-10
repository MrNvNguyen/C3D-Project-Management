import { describe, expect, it } from 'vitest'
import { webcrypto } from 'node:crypto'
import { createAiGateway, pageParams, vnDate } from './ai-gateway'
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
const key = 'test-key-abcdefghijklmnopqrstuvwxyz-0123456789'
function env(role = 'system_admin', active = 1) {
  const calls: string[] = []
  const DB = { prepare(sql: string) { calls.push(sql); return { bind() { return this }, async first() { return { id: 1, role, is_active: active } }, async all() { return { results: [] } } } }, async batch() { return [{ results: [] }, { results: [{}] }, { results: [] }] } }
  return { bindings: { DB, AI_GATEWAY_KEY: key, AI_GATEWAY_USER_ID: '1' } as any, calls }
}
describe('AI read gateway', () => {
  it('uses Vietnam date around midnight', () => expect(vnDate(new Date('2026-10-08T18:00:00Z'))).toBe('2026-10-09'))
  it('bounds pagination', () => { for (const limit of ['0','101','NaN','1.5']) expect(pageParams({ limit })).toBeNull(); expect(pageParams({})).toEqual({ limit: 50, offset: 0 }) })
  it('defaults to disabled', async () => expect((await createAiGateway().request('/overview', {}, { DB: {} } as any)).status).toBe(503))
  it('rejects missing, wrong and query-string credentials before database reads', async () => {
    for (const [url, headers] of [['/overview', {}], ['/overview', { Authorization: 'Bearer wrong' }], ['/overview?token=' + key, {}]] as const) {
      const e = env(); expect((await createAiGateway().request(url, { headers }, e.bindings)).status).toBe(401); expect(e.calls).toHaveLength(0)
    }
  })
  it('rejects demoted or inactive account', async () => {
    for (const [role, active] of [['member',1], ['system_admin',0]] as const) { const e = env(role, active); expect((await createAiGateway().request('/projects', { headers: { Authorization: `Bearer ${key}` } }, e.bindings)).status).toBe(403) }
  })
  it('supports all reads without selecting sensitive user fields', async () => {
    for (const path of ['/overview','/projects','/tasks','/workload']) { const e = env(); const res = await createAiGateway().request(path, { headers: { Authorization: `Bearer ${key}` } }, e.bindings); expect(res.status).toBe(200); expect(res.headers.get('Cache-Control')).toBe('no-store'); expect(e.calls.join(' ')).not.toMatch(/password|salary|email|phone|SELECT \*/) }
  })
  it('rejects writes and malformed filters', async () => {
    const e = env(); const app = createAiGateway(); const headers = { Authorization: `Bearer ${key}` }
    expect((await app.request('/tasks', { method: 'POST', headers }, e.bindings)).status).toBe(405)
    for (const url of ['/tasks?project_id=abc','/tasks?overdue=foo','/projects?limit=101']) expect((await app.request(url, { headers }, e.bindings)).status).toBe(400)
  })
})
