import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

export const OAUTH_ISSUER = 'https://ddcn.bimonecadvn.com'
export const MCP_RESOURCE = `${OAUTH_ISSUER}/api/ai/v1/mcp`
export const READ_SCOPE = 'ddcn:read'
export const CHATGPT_CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect'
export type OAuthBindings = { DB: D1Database; JWT_SECRET?: string; AI_GATEWAY_USER_ID?: string }
type VerifySession = (token: string, secret: string) => Promise<Record<string, unknown> | null>
const now = () => Math.floor(Date.now() / 1000)
export async function oauthHash(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
export async function pkceChallenge(verifier: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
export const oauthChallenge = `Bearer resource_metadata="${OAUTH_ISSUER}/.well-known/oauth-protected-resource/api/ai/v1/mcp", scope="${READ_SCOPE}"`
export async function oauthPrincipal(token: string, env: OAuthBindings): Promise<number | null> {
  if (!token.startsWith('ddcn_oauth_')) return null
  const row = await env.DB.prepare('SELECT t.user_id, t.resource, t.scope FROM ddcn_oauth_tokens t JOIN ddcn_oauth_clients c ON c.client_id = t.client_id WHERE t.token_hash = ? AND t.expires_at > ?').bind(await oauthHash(token), now()).first<any>()
  if (!row || row.resource !== MCP_RESOURCE || row.scope !== READ_SCOPE || row.user_id !== Number(env.AI_GATEWAY_USER_ID)) return null
  return row.user_id
}
export function createDdcnOAuth(verifySession: VerifySession) {
  const app = new Hono<{ Bindings: OAuthBindings }>()
  app.use('/oauth/ddcn/*', bodyLimit({ maxSize: 8192 }))
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer'); await next() })
  app.onError((_, c) => c.json({ error: 'server_error', error_description: 'Unable to complete DDCN authorization' }, 500))
  const metadata = () => ({ resource: MCP_RESOURCE, authorization_servers: [OAUTH_ISSUER], scopes_supported: [READ_SCOPE], bearer_methods_supported: ['header'] })
  app.get('/.well-known/oauth-protected-resource', c => c.json(metadata()))
  app.get('/.well-known/oauth-protected-resource/api/ai/v1/mcp', c => c.json(metadata()))
  app.get('/.well-known/oauth-authorization-server', c => c.json({
    issuer: OAUTH_ISSUER, authorization_endpoint: `${OAUTH_ISSUER}/oauth/ddcn/authorize`, token_endpoint: `${OAUTH_ISSUER}/oauth/ddcn/token`,
    registration_endpoint: `${OAUTH_ISSUER}/oauth/ddcn/register`, revocation_endpoint: `${OAUTH_ISSUER}/oauth/ddcn/revoke`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'], scopes_supported: [READ_SCOPE], authorization_response_iss_parameter_supported: true,
  }))
  app.post('/oauth/ddcn/register', async c => {
    if (Number(c.req.header('Content-Length') || 0) > 4096) return c.json({ error: 'invalid_client_metadata' }, 400)
    const body = await c.req.json().catch(() => null)
    // Closed internal integration: never register arbitrary callback destinations.
    if (!body || !Array.isArray(body.redirect_uris) || body.redirect_uris.length !== 1 || body.redirect_uris[0] !== CHATGPT_CALLBACK ||
      (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none') ||
      (body.grant_types && (!Array.isArray(body.grant_types) || !body.grant_types.includes('authorization_code') || body.grant_types.some((g: unknown) => !['authorization_code', 'refresh_token'].includes(g as string)))) ||
      (body.response_types && JSON.stringify(body.response_types) !== '["code"]')) return c.json({ error: 'invalid_client_metadata' }, 400)
    const client_id = crypto.randomUUID()
    await c.env.DB.prepare('INSERT INTO ddcn_oauth_clients (client_id, redirect_uri, created_at) VALUES (?, ?, ?)').bind(client_id, CHATGPT_CALLBACK, now()).run()
    return c.json({ client_id, client_id_issued_at: now(), redirect_uris: [CHATGPT_CALLBACK], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }, 201)
  })
  async function validRequest(env: OAuthBindings, p: Record<string, string>) {
    if (p.response_type !== 'code' || p.redirect_uri !== CHATGPT_CALLBACK || p.resource !== MCP_RESOURCE || p.scope !== READ_SCOPE ||
      p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge || '') || !p.state || p.state.length > 1024 || !p.client_id || p.client_id.length > 100) return false
    const client = await env.DB.prepare('SELECT redirect_uri FROM ddcn_oauth_clients WHERE client_id = ?').bind(p.client_id).first<any>()
    return client?.redirect_uri === p.redirect_uri
  }
  app.get('/oauth/ddcn/authorize', async c => {
    const p = c.req.query()
    if (!(await validRequest(c.env, p))) return c.text('Yêu cầu OAuth không hợp lệ. Hãy bắt đầu lại từ ChatGPT.', 400)
    const nonce = randomSecret()
    c.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`)
    c.header('X-Frame-Options', 'DENY')
    const params = JSON.stringify(p).replace(/</g, '\\u003c')
    return c.html(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cấp quyền OneCAD DDCN</title>
<style>body{font:16px system-ui;background:#f3f5f7;color:#172b40;margin:0}main{max-width:580px;margin:8vh auto;padding:32px;background:white;border-radius:16px}button,a{display:inline-block;margin:8px 8px 8px 0;padding:12px}button{cursor:pointer}#message{white-space:pre-wrap}</style>
<main><h1>Kết nối DDCN với ChatGPT</h1><p>Cấp quyền đọc tổng quan, dự án, công việc và tải công việc của phòng ban. ChatGPT sẽ nhận dữ liệu này để phân tích theo yêu cầu của anh.</p><p>Chỉ tài khoản quản trị đã được cấu hình cho kết nối AI được cấp quyền. Kết nối không ghi dữ liệu và không bao gồm R&D.</p><p>Đăng nhập DDCN trong tab bên cạnh, sau đó quay lại đây bấm Cho phép.</p><a href="/" target="_blank" rel="noopener">Mở DDCN để đăng nhập</a><div><button id="allow">Cho phép đọc dữ liệu</button><button id="deny">Từ chối</button></div><p id="message" role="status"></p></main>
<script nonce="${nonce}">const params=${params};const message=document.getElementById('message');async function submit(consent){const token=localStorage.getItem('bim_token');if(!token){message.textContent='Anh cần đăng nhập DDCN ở tab bên cạnh trước.';return}document.getElementById('allow').disabled=true;try{const r=await fetch('/oauth/ddcn/authorize',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({...params,consent})});const data=await r.json();if(!r.ok)throw new Error(data.error_description||'Không thể cấp quyền. Kiểm tra tài khoản DDCN.');location.assign(data.redirect)}catch(e){message.textContent=e.message;document.getElementById('allow').disabled=false}}document.getElementById('allow').onclick=()=>submit(true);document.getElementById('deny').onclick=()=>{const u=new URL(params.redirect_uri);u.searchParams.set('error','access_denied');u.searchParams.set('state',params.state);u.searchParams.set('iss',${JSON.stringify(OAUTH_ISSUER)});location.assign(u.href)};</script></html>`)
  })
  app.post('/oauth/ddcn/authorize', async c => {
    if (c.req.header('Origin') !== OAUTH_ISSUER) return c.json({ error: 'access_denied' }, 403)
    if (Number(c.req.header('Content-Length') || 0) > 8192) return c.json({ error: 'invalid_request' }, 400)
    const body = await c.req.json().catch(() => null)
    if (!body || !(await validRequest(c.env, body))) return c.json({ error: 'invalid_request' }, 400)
    const auth = c.req.header('Authorization') || ''
    if (!auth.startsWith('Bearer ') || !c.env.JWT_SECRET) return c.json({ error: 'access_denied' }, 401)
    const session = await verifySession(auth.slice(7), c.env.JWT_SECRET)
    if (!session || typeof session.exp !== 'number' || !Number.isFinite(session.exp) || session.exp <= Date.now()) return c.json({ error: 'access_denied' }, 401)
    const id = Number(session.id)
    if (!Number.isSafeInteger(id) || id <= 0 || id !== Number(c.env.AI_GATEWAY_USER_ID)) return c.json({ error: 'access_denied', error_description: 'Tài khoản này chưa được cấp quyền kết nối AI.' }, 403)
    const user = await c.env.DB.prepare('SELECT role, is_active FROM users WHERE id = ?').bind(id).first<any>()
    if (user?.role !== 'system_admin' || user.is_active !== 1) return c.json({ error: 'access_denied' }, 403)
    const redirect = new URL(body.redirect_uri)
    redirect.searchParams.set('state', body.state)
    redirect.searchParams.set('iss', OAUTH_ISSUER)
    if (body.consent !== true) { redirect.searchParams.set('error', 'access_denied'); return c.json({ redirect: redirect.href }) }
    const code = randomSecret()
    await c.env.DB.prepare('INSERT INTO ddcn_oauth_codes (code_hash, client_id, redirect_uri, challenge, resource, scope, user_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(await oauthHash(code), body.client_id, body.redirect_uri, body.code_challenge, MCP_RESOURCE, READ_SCOPE, id, now() + 300).run()
    redirect.searchParams.set('code', code)
    return c.json({ redirect: redirect.href })
  })
  async function ensureRefreshTable(env: OAuthBindings) {
    // Idempotent, additive bootstrap also protects deployments made before manual migration.
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS ddcn_oauth_refresh_tokens (token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL, access_token_hash TEXT NOT NULL)').run()
  }
  app.post('/oauth/ddcn/token', async c => {
    const p = await c.req.parseBody()
    if (typeof p.client_id !== 'string' || !p.client_id || p.client_id.length > 100 || p.resource !== MCP_RESOURCE ||
      (p.scope !== undefined && p.scope !== READ_SCOPE)) return c.json({ error: 'invalid_grant' }, 400)
    await ensureRefreshTable(c.env)
    let row: any
    let refreshExpires = now() + 30 * 86400
    if (p.grant_type === 'refresh_token') {
      if (typeof p.refresh_token !== 'string' || !/^ddcn_refresh_[a-f0-9]{64}$/.test(p.refresh_token)) return c.json({ error: 'invalid_grant' }, 400)
      // Consume once atomically: only one concurrent refresh may succeed.
      row = await c.env.DB.prepare('UPDATE ddcn_oauth_refresh_tokens SET expires_at = -expires_at WHERE token_hash = ? AND client_id = ? AND resource = ? AND expires_at > ? RETURNING user_id, scope, -expires_at AS expires_at, access_token_hash')
        .bind(await oauthHash(p.refresh_token), p.client_id, MCP_RESOURCE, now()).first<any>()
      if (row) {
        refreshExpires = row.expires_at
        await c.env.DB.prepare('DELETE FROM ddcn_oauth_tokens WHERE token_hash = ?').bind(row.access_token_hash).run()
      }
    } else if (p.grant_type === 'authorization_code') {
      if (typeof p.code !== 'string' || p.code.length !== 64 || typeof p.code_verifier !== 'string' ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier) || p.redirect_uri !== CHATGPT_CALLBACK) return c.json({ error: 'invalid_grant' }, 400)
      row = await c.env.DB.prepare('DELETE FROM ddcn_oauth_codes WHERE code_hash = ? AND client_id = ? AND redirect_uri = ? AND challenge = ? AND resource = ? AND expires_at > ? RETURNING user_id, scope')
        .bind(await oauthHash(p.code), p.client_id, p.redirect_uri, await pkceChallenge(p.code_verifier), MCP_RESOURCE, now()).first<any>()
    } else return c.json({ error: 'unsupported_grant_type' }, 400)
    if (!row || row.scope !== READ_SCOPE || row.user_id !== Number(c.env.AI_GATEWAY_USER_ID)) return c.json({ error: 'invalid_grant' }, 400)
    const user = await c.env.DB.prepare('SELECT role, is_active FROM users WHERE id = ?').bind(row.user_id).first<any>()
    if (user?.role !== 'system_admin' || user.is_active !== 1) return c.json({ error: 'invalid_grant' }, 400)
    const access_token = 'ddcn_oauth_' + randomSecret()
    const refresh_token = 'ddcn_refresh_' + randomSecret()
    const accessHash = await oauthHash(access_token)
    // D1 batch is transactional: never publish a partially persisted token pair.
    const issued = await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO ddcn_oauth_tokens (token_hash, client_id, resource, scope, user_id, expires_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ddcn_oauth_clients WHERE client_id = ?)')
        .bind(accessHash, p.client_id, MCP_RESOURCE, READ_SCOPE, row.user_id, now() + 28800, p.client_id),
      c.env.DB.prepare('INSERT INTO ddcn_oauth_refresh_tokens (token_hash, client_id, resource, scope, user_id, expires_at, access_token_hash) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ddcn_oauth_clients WHERE client_id = ?)')
        .bind(await oauthHash(refresh_token), p.client_id, MCP_RESOURCE, READ_SCOPE, row.user_id, refreshExpires, accessHash, p.client_id),
      c.env.DB.prepare('DELETE FROM ddcn_oauth_codes WHERE expires_at <= ?').bind(now()),
      c.env.DB.prepare('DELETE FROM ddcn_oauth_tokens WHERE expires_at <= ?').bind(now()),
      c.env.DB.prepare('DELETE FROM ddcn_oauth_refresh_tokens WHERE ABS(expires_at) <= ?').bind(now()),
    ])
    if (issued[0].meta.changes !== 1 || issued[1].meta.changes !== 1) return c.json({ error: 'invalid_grant' }, 400)
    return c.json({ access_token, refresh_token, token_type: 'Bearer', expires_in: 28800, scope: READ_SCOPE })
  })
  app.post('/oauth/ddcn/revoke', async c => {
    const p = await c.req.parseBody()
    if (typeof p.token !== 'string' || typeof p.client_id !== 'string') return c.json({ error: 'invalid_request' }, 400)
    const hash = await oauthHash(p.token)
    await ensureRefreshTable(c.env)
    // Invalidate the dedicated OAuth client. Retained spent-token hashes let an
    // old credential revoke successors even while rotation is in flight.
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM ddcn_oauth_clients WHERE client_id = ? AND (EXISTS (SELECT 1 FROM ddcn_oauth_refresh_tokens WHERE client_id = ? AND (token_hash = ? OR access_token_hash = ?)) OR EXISTS (SELECT 1 FROM ddcn_oauth_tokens WHERE client_id = ? AND token_hash = ?))')
        .bind(p.client_id, p.client_id, hash, hash, p.client_id, hash),
      c.env.DB.prepare('DELETE FROM ddcn_oauth_tokens WHERE client_id = ? AND NOT EXISTS (SELECT 1 FROM ddcn_oauth_clients WHERE client_id = ?)').bind(p.client_id, p.client_id),
      c.env.DB.prepare('DELETE FROM ddcn_oauth_refresh_tokens WHERE client_id = ? AND NOT EXISTS (SELECT 1 FROM ddcn_oauth_clients WHERE client_id = ?)').bind(p.client_id, p.client_id),
    ])
    return c.body(null, 200)
  })
  return app
}
