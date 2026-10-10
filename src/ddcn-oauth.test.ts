import { describe, expect, it } from 'vitest'
import { createDdcnOAuth, MCP_RESOURCE, CHATGPT_CALLBACK, oauthHash, oauthPrincipal, pkceChallenge, OAUTH_ISSUER } from './ddcn-oauth'
import { createAiGateway } from './ai-gateway'
function fixture() {
  const clients = new Map<string, any>(), codes = new Map<string, any>(), tokens = new Map<string, any>(), refreshTokens = new Map<string, any>()
  const user = { id: 1, role: 'system_admin', is_active: 1 }
  const DB = { prepare(sql: string) { let args: any[] = []; return { bind(...a: any[]) { args = a; return this }, async run() {
    if (sql.startsWith('INSERT') && sql.includes('WHERE EXISTS') && !clients.has(args[args.length-1])) return {success:true,meta:{changes:0}}
    if (sql.startsWith('DELETE FROM ddcn_oauth_clients')) {
      const matches=[...refreshTokens].some(([hash,row])=>row.client_id===args[0] && (hash===args[2] || row.access_token_hash===args[3])) || [...tokens].some(([hash,row])=>row.client_id===args[0] && hash===args[5])
      if(matches) clients.delete(args[0])
    }
    if(sql.startsWith('DELETE FROM ddcn_oauth_tokens WHERE client_id') && !clients.has(args[0])) for(const [hash,row] of tokens) if(row.client_id===args[0]) tokens.delete(hash)
    if(sql.startsWith('DELETE FROM ddcn_oauth_refresh_tokens WHERE client_id') && !clients.has(args[0])) for(const [hash,row] of refreshTokens) if(row.client_id===args[0]) refreshTokens.delete(hash)
    if (sql.startsWith('INSERT INTO ddcn_oauth_clients')) clients.set(args[0], { redirect_uri: args[1] })
    if (sql.startsWith('INSERT INTO ddcn_oauth_codes')) codes.set(args[0], { client_id: args[1], redirect_uri: args[2], challenge: args[3], resource: args[4], scope: args[5], user_id: args[6], expires_at: args[7] })
    if (sql.startsWith('INSERT INTO ddcn_oauth_refresh_tokens')) refreshTokens.set(args[0], { client_id: args[1], resource: args[2], scope: args[3], user_id: args[4], expires_at: args[5], access_token_hash: args[6] })
    if (sql.startsWith('INSERT INTO ddcn_oauth_tokens')) tokens.set(args[0], { client_id: args[1], resource: args[2], scope: args[3], user_id: args[4], expires_at: args[5] })
    if (sql.startsWith('DELETE FROM ddcn_oauth_tokens WHERE token_hash') && (args.length === 1 || tokens.get(args[0])?.client_id === args[1])) tokens.delete(args[0])
    return { success: true, meta: {changes:1} }
  }, async first() {
    if (sql.startsWith('UPDATE ddcn_oauth_refresh_tokens')) {
      if (sql.includes('OR access_token_hash')) { for (const [hash, row] of refreshTokens) if ((hash === args[0] || row.access_token_hash === args[1]) && row.client_id === args[2]) { refreshTokens.delete(hash); return row } return null }
      const row = refreshTokens.get(args[0]); if (row && row.client_id === args[1] && row.resource === args[2] && row.expires_at > args[3]) { refreshTokens.set(args[0], {...row,expires_at:-row.expires_at}); return row } return null
    }
    if (sql.includes('FROM users')) return user
    if (sql.includes('FROM ddcn_oauth_clients')) return clients.get(args[0]) || null
    if (sql.startsWith('DELETE FROM ddcn_oauth_codes')) { const row = codes.get(args[0]); if (row && row.client_id === args[1] && row.redirect_uri === args[2] && row.challenge === args[3] && row.resource === args[4] && row.expires_at > args[5]) { codes.delete(args[0]); return row } return null }
    if (sql.includes('FROM ddcn_oauth_tokens')) { const row = tokens.get(args[0]); return row?.expires_at > args[1] && clients.has(row.client_id) ? row : null }
    return null
  }, async all() { return { results: [] } } } }, async batch(statements: any[]) { const results=[];for(const statement of statements) results.push({...await statement.run(),results:[{}]});return results } }
  const env = { DB, JWT_SECRET: 'test-secret', AI_GATEWAY_USER_ID: '1', AI_GATEWAY_KEY: 'abcdefghijklmnopqrstuvwxyz1234567890' } as any
  const app = createDdcnOAuth(async token => token === 'valid-session' ? { id: 1, exp: Date.now() + 60000 } : null)
  const request = (path: string, options = {}) => app.request(path, options, env)
  return { env, request, user, clients, codes, tokens, refreshTokens }
}
async function authorize(f: ReturnType<typeof fixture>) {
  const registration = await f.request('/oauth/ddcn/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CHATGPT_CALLBACK], token_endpoint_auth_method: 'none' }) })
  const client = await registration.json()
  const verifier = 'v'.repeat(64)
  const params = { client_id: client.client_id, redirect_uri: CHATGPT_CALLBACK, response_type: 'code', scope: 'ddcn:read', resource: MCP_RESOURCE, state: 'client-state', code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256' }
  const response = await f.request('/oauth/ddcn/authorize', { method: 'POST', headers: { Origin: OAUTH_ISSUER, Authorization: 'Bearer valid-session', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, consent: true }) })
  const redirect = new URL((await response.json()).redirect)
  return { params, verifier, code: redirect.searchParams.get('code')!, redirect }
}
function exchange(f: ReturnType<typeof fixture>, a: Awaited<ReturnType<typeof authorize>>, extra = {}) {
  return f.request('/oauth/ddcn/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: a.params.client_id, redirect_uri: CHATGPT_CALLBACK, resource: MCP_RESOURCE, code: a.code, code_verifier: a.verifier, ...extra }).toString() })
}
describe('DDCN OAuth', () => {
  it('publishes matching discovery and S256', async () => { const f = fixture(); const m = await (await f.request('/.well-known/oauth-authorization-server')).json(); expect(m.code_challenge_methods_supported).toEqual(['S256']); expect(m.issuer).toBe(OAUTH_ISSUER); const r = await (await f.request('/.well-known/oauth-protected-resource/api/ai/v1/mcp')).json(); expect(r.resource).toBe(MCP_RESOURCE); expect(r.authorization_servers).toEqual([m.issuer]) })
  it('rejects arbitrary registration callbacks', async () => { const f = fixture(); expect((await f.request('/oauth/ddcn/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://evil.test/callback'] }) })).status).toBe(400) })
  it('renders consent with CSP and never embeds session credentials', async () => { const f = fixture(), a = await authorize(f); const r = await f.request('/oauth/ddcn/authorize?' + new URLSearchParams(a.params)); expect(r.status).toBe(200); expect(r.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'"); expect(await r.text()).not.toContain('valid-session') })
  it('rejects consent without same-origin and valid session', async () => { const f = fixture(), a = await authorize(f); for (const headers of [{ Origin: 'https://evil.test', Authorization: 'Bearer valid-session' }, { Origin: OAUTH_ISSUER, Authorization: 'Bearer invalid' }]) expect((await f.request('/oauth/ddcn/authorize', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...a.params, consent: true }) })).status).toBeGreaterThanOrEqual(400) })
  it('binds PKCE, audience, callback and client then prevents replay', async () => { const f = fixture(), a = await authorize(f); expect(a.redirect.searchParams.get('iss')).toBe(OAUTH_ISSUER); expect(a.redirect.searchParams.get('state')).toBe('client-state'); for (const extra of [{ code_verifier: 'x'.repeat(64) }, { resource: 'https://other.test' }, { client_id: 'wrong' }, { redirect_uri: 'https://evil.test' }]) expect((await exchange(f, a, extra)).status).toBe(400); const r = await exchange(f, a); expect(r.status).toBe(200); expect(r.headers.get('Cache-Control')).toBe('no-store'); expect((await exchange(f, a)).status).toBe(400) })
  it('rejects concurrent code replay', async () => { const f = fixture(), a = await authorize(f); const r = await Promise.all([exchange(f, a), exchange(f, a)]); expect(r.map(x => x.status).sort()).toEqual([200,400]) })
  it('stores only token hashes, enforces expiry/audience/scope and revocation', async () => { const f = fixture(), a = await authorize(f); const token = (await (await exchange(f, a)).json()).access_token; const hash = await oauthHash(token); expect(f.tokens.has(token)).toBe(false); expect(await oauthPrincipal(token, f.env)).toBe(1); const row = f.tokens.get(hash); for (const change of [{ resource: 'wrong' }, { scope: 'write' }, { expires_at: 0 }]) { f.tokens.set(hash, { ...row, ...change }); expect(await oauthPrincipal(token, f.env)).toBeNull() } f.tokens.set(hash, row); await f.request('/oauth/ddcn/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: a.params.client_id, token }).toString() }); expect(await oauthPrincipal(token, f.env)).toBeNull() })
  it('enforces live user role on gateway reads with OAuth token', async () => { const f = fixture(), a = await authorize(f); const token = (await (await exchange(f, a)).json()).access_token; const app = createAiGateway(), headers = { Authorization: 'Bearer ' + token }; expect((await app.request('/overview', { headers }, f.env)).status).toBe(200); f.user.role = 'member'; expect((await app.request('/overview', { headers }, f.env)).status).toBe(403) })
  it('allows public tool discovery but challenges data calls', async () => { const f = fixture(), app = createAiGateway(); const rpc = (method: string) => app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} }) }, f.env); expect((await rpc('tools/list')).status).toBe(200); const r = await rpc('tools/call'); expect(r.status).toBe(401); expect(r.headers.get('WWW-Authenticate')).toContain('resource_metadata') })
  it('rotates refresh tokens once, preserves absolute expiry and invalidates old access', async () => {
    const f = fixture(), a = await authorize(f), initial = await (await exchange(f,a)).json()
    const hash = await oauthHash(initial.refresh_token), originalExpiry = f.refreshTokens.get(hash).expires_at
    expect(f.refreshTokens.has(initial.refresh_token)).toBe(false)
    const refresh = (extra = {}) => f.request('/oauth/ddcn/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: a.params.client_id, resource: MCP_RESOURCE, refresh_token: initial.refresh_token, ...extra }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    for (const extra of [{client_id:'wrong'}, {resource:'wrong'}, {scope:'write'}]) expect((await refresh(extra)).status).toBe(400)
    const results = await Promise.all([refresh(),refresh()]); expect(results.map(r=>r.status).sort()).toEqual([200,400])
    const next = await results.find(r=>r.status===200)!.json()
    expect(next.refresh_token).not.toBe(initial.refresh_token)
    expect(f.refreshTokens.get(await oauthHash(next.refresh_token)).expires_at).toBe(originalExpiry)
    expect(await oauthPrincipal(initial.access_token,f.env)).toBeNull()
    expect(await oauthPrincipal(next.access_token,f.env)).toBe(1)
    await f.request('/oauth/ddcn/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:a.params.client_id,token:next.refresh_token})})
    expect(await oauthPrincipal(next.access_token,f.env)).toBeNull(); expect(f.refreshTokens.size).toBe(0)
  })
  it('rejects expired refresh and disabled or demoted principals', async () => {
    for (const change of ['expired','disabled','role','principal']) {
      const f=fixture(), a=await authorize(f), pair=await (await exchange(f,a)).json()
      if(change==='expired') f.refreshTokens.get(await oauthHash(pair.refresh_token)).expires_at=0
      if(change==='disabled') f.user.is_active=0
      if(change==='role') f.user.role='member'
      if(change==='principal') f.env.AI_GATEWAY_USER_ID='2'
      const r=await f.request('/oauth/ddcn/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:a.params.client_id,resource:MCP_RESOURCE,refresh_token:pair.refresh_token})})
      expect(r.status).toBe(400)
    }
  })
  it('advertises refresh and accepts DCR requesting both grants', async () => {
    const f=fixture(); const metadata=await (await f.request('/.well-known/oauth-authorization-server')).json()
    expect(metadata.grant_types_supported).toContain('refresh_token')
    const r=await f.request('/oauth/ddcn/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:[CHATGPT_CALLBACK],grant_types:['authorization_code','refresh_token'],token_endpoint_auth_method:'none'})});expect(r.status).toBe(201)
  })

  it('revoking a consumed credential blocks successor issuance', async () => {
    const f=fixture(),a=await authorize(f),pair=await (await exchange(f,a)).json()
    const originalBatch=f.env.DB.batch
    f.env.DB.batch=async (statements:any[])=>{
      f.env.DB.batch=originalBatch
      await f.request('/oauth/ddcn/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:a.params.client_id,token:pair.refresh_token})})
      return originalBatch(statements)
    }
    const r=await f.request('/oauth/ddcn/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:a.params.client_id,resource:MCP_RESOURCE,refresh_token:pair.refresh_token})})
    expect(r.status).toBe(400);expect(f.clients.has(a.params.client_id)).toBe(false);expect(f.tokens.size).toBe(0);expect(f.refreshTokens.size).toBe(0)
  })
  it('revoking an old token invalidates already issued successors but not other clients', async () => {
    const f=fixture(),a=await authorize(f),pair=await (await exchange(f,a)).json(),b=await authorize(f),other=await (await exchange(f,b)).json()
    const next=await (await f.request('/oauth/ddcn/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:a.params.client_id,resource:MCP_RESOURCE,refresh_token:pair.refresh_token})})).json()
    await f.request('/oauth/ddcn/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:a.params.client_id,token:pair.access_token})})
    expect(await oauthPrincipal(next.access_token,f.env)).toBeNull();expect(await oauthPrincipal(other.access_token,f.env)).toBe(1)
  })

})
