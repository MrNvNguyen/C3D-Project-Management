import { describe, expect, it } from 'vitest'
import { createAiGateway } from './ai-gateway'
const key = 'mcp-test-key-abcdefghijklmnopqrstuvwxyz-123456'
const DB = { prepare() { return { bind() { return this }, async first() { return { id: 1, role: 'system_admin', is_active: 1 } }, async all() { return { results: [] } } } }, async batch() { return [{ results: [] }, { results: [{}] }, { results: [] }] } }
const env = { DB, AI_GATEWAY_KEY: key, AI_GATEWAY_USER_ID: '1' } as any
async function rpc(method: string, params = {}, extra = {}) {
  return createAiGateway().request('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...extra }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, env)
}
describe('DDCN MCP', () => {
  it('requires gateway authentication', async () => expect((await rpc('tools/call', { name: 'ddcn_overview', arguments: {} }, { Authorization: '' })).status).toBe(401))
  it('rejects untrusted origins', async () => expect((await rpc('tools/list', {}, { Origin: 'https://evil.example' })).status).toBe(403))
  it('initializes stateless transport', async () => { const r = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }); expect(r.status).toBe(200); expect((await r.json()).result.serverInfo.name).toBe('onecad-ddcn'); expect(r.headers.get('mcp-session-id')).toBeNull() })
  it('lists exactly four read-only tools', async () => { const r = await rpc('tools/list'); const tools = (await r.json()).result.tools; expect(tools).toHaveLength(4); expect(tools.every((t: any) => t.annotations.readOnlyHint && !t.annotations.destructiveHint)).toBe(true) })
  it('calls all tools through the authenticated existing reads', async () => { for (const name of ['ddcn_overview','ddcn_projects','ddcn_tasks','ddcn_workload']) { const r = await rpc('tools/call', { name, arguments: {} }); const result = (await r.json()).result; expect(result.isError).not.toBe(true); expect(result.structuredContent.source).toBe('DDCN'); expect(r.headers.get('Cache-Control')).toBe('no-store') } })
  it('rejects invalid pagination and unknown tools', async () => { for (const params of [{ name: 'ddcn_tasks', arguments: { limit: 101 } }, { name: 'write_project', arguments: {} }]) { const r = await rpc('tools/call', params); const body = await r.json(); expect(Boolean(body.error || body.result?.isError)).toBe(true) } })
  it('rejects non-POST requests', async () => expect((await createAiGateway().request('/mcp', { headers: { Authorization: `Bearer ${key}` } }, env)).status).toBe(405))
})
