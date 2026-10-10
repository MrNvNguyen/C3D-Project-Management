import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { handleDdcnMcp } from './ddcn-mcp'
import { oauthChallenge, oauthPrincipal } from './ddcn-oauth'

export type GatewayBindings = {
  DB: D1Database
  AI_GATEWAY_KEY?: string
  AI_GATEWAY_USER_ID?: string
}
const OPEN = "status NOT IN ('completed','review','cancelled')"
export function vnDate(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10)
}
export async function keyMatches(value: string, expected: string) {
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [a, b] = await Promise.all([hash(value), hash(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
export function pageParams(query: Record<string, string>) {
  const limit = query.limit === undefined ? 50 : Number(query.limit)
  const offset = query.offset === undefined ? 0 : Number(query.offset)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return null
  return { limit, offset }
}
export function createAiGateway() {
  const app = new Hono<{ Bindings: GatewayBindings }>()
  app.use('/mcp', bodyLimit({ maxSize: 65536 }))
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    const key = c.env.AI_GATEWAY_KEY
    const id = Number(c.env.AI_GATEWAY_USER_ID)
    if (!key || key.length < 32 || !Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'AI gateway disabled' }, 503)
    const auth = c.req.header('Authorization') || ''
    // Public protocol discovery contains tool descriptions only, never DDCN data.
    if (c.req.path.endsWith('/mcp') && c.req.method === 'POST' && !auth) {
      const rpc = await c.req.raw.clone().json().catch(() => null) as any
      if (['initialize', 'tools/list', 'notifications/initialized'].includes(rpc?.method)) {
        return handleDdcnMcp(c.req.raw, async () => new Response(null, { status: 401 }))
      }
    }
    c.header('WWW-Authenticate', oauthChallenge)
    if (!auth.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
    const token = auth.slice(7)
    const authenticated = token.startsWith('ddcn_oauth_')
      ? (await oauthPrincipal(token, c.env)) === id
      : await keyMatches(token, key)
    if (!authenticated) return c.json({ error: 'Unauthorized' }, 401)
    c.header('WWW-Authenticate', undefined)
    const user = await c.env.DB.prepare('SELECT id, role, is_active FROM users WHERE id = ?').bind(id).first<any>()
    // First release is an executive connection. Reject a removed, disabled or demoted principal.
    if (!user || user.is_active !== 1 || user.role !== 'system_admin') return c.json({ error: 'Access denied' }, 403)
    const requestId = crypto.randomUUID()
    c.header('X-Request-ID', requestId)
    const started = Date.now()
    await next()
    console.log(JSON.stringify({ event: 'ai_gateway_read', request_id: requestId, user_id: id, path: c.req.path, method: c.req.method, status: c.res.status, duration_ms: Date.now() - started }))
  })
  app.onError((_, c) => c.json({ error: 'Unable to read DDCN data' }, 500))
  const envelope = (data: unknown) => ({ source: 'DDCN', generated_at: new Date().toISOString(), timezone: 'Asia/Ho_Chi_Minh', data })
  app.get('/overview', async c => {
    const today = vnDate()
    const results = await c.env.DB.batch([
      c.env.DB.prepare('SELECT status, COUNT(*) AS count FROM projects GROUP BY status'),
      c.env.DB.prepare(`SELECT COUNT(*) AS open_tasks, SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS overdue_tasks, SUM(CASE WHEN assigned_to IS NULL THEN 1 ELSE 0 END) AS unassigned_tasks FROM tasks WHERE ${OPEN}`).bind(today),
      c.env.DB.prepare('SELECT department, COUNT(*) AS active_staff FROM users WHERE is_active = 1 GROUP BY department'),
    ])
    return c.json(envelope({ projects: results[0].results, tasks: results[1].results[0], departments: results[2].results }))
  })
  app.get('/projects', async c => {
    const page = pageParams(c.req.query())
    if (!page) return c.json({ error: 'limit must be 1..100; offset must be 0..100000' }, 400)
    const today = vnDate()
    const rows = await c.env.DB.prepare(`SELECT p.id, p.code, p.name, p.status, p.start_date, p.end_date, p.progress AS reported_progress,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'cancelled') AS task_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status IN ('completed','review')) AS completed_or_review_tasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.${OPEN} AND t.due_date < ?) AS overdue_tasks
      FROM projects p ORDER BY p.id LIMIT ? OFFSET ?`).bind(today, page.limit, page.offset).all()
    return c.json({ ...envelope(rows.results), ...page, next_offset: rows.results.length === page.limit ? page.offset + page.limit : null })
  })
  app.get('/tasks', async c => {
    const page = pageParams(c.req.query())
    if (!page) return c.json({ error: 'Invalid pagination' }, 400)
    const projectId = c.req.query('project_id')
    if (projectId !== undefined && (!/^\d+$/.test(projectId) || Number(projectId) < 1 || !Number.isSafeInteger(Number(projectId)))) return c.json({ error: 'Invalid project_id' }, 400)
    const overdue = c.req.query('overdue')
    if (overdue !== undefined && !['true','false'].includes(overdue)) return c.json({ error: 'Invalid overdue' }, 400)
    const rows = await c.env.DB.prepare(`SELECT t.id, t.project_id, p.code AS project_code, t.title, t.status, t.priority, t.due_date, t.progress, u.full_name AS assignee,
      CASE WHEN t.due_date < ? AND t.${OPEN} THEN 1 ELSE 0 END AS is_overdue
      FROM tasks t JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.${OPEN} AND (? IS NULL OR t.project_id = ?) AND (? != 'true' OR t.due_date < ?)
      ORDER BY t.due_date IS NULL, t.due_date, t.id LIMIT ? OFFSET ?`).bind(vnDate(), projectId ?? null, projectId ?? null, overdue ?? 'false', vnDate(), page.limit, page.offset).all()
    return c.json({ ...envelope(rows.results), ...page, next_offset: rows.results.length === page.limit ? page.offset + page.limit : null })
  })
  app.get('/workload', async c => {
    const page = pageParams(c.req.query())
    if (!page) return c.json({ error: 'Invalid pagination' }, 400)
    const today = vnDate()
    const from = vnDate(new Date(Date.now() - 6 * 86400000))
    const rows = await c.env.DB.prepare(`SELECT u.id, u.full_name, u.department,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = u.id AND t.${OPEN}) AS open_tasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = u.id AND t.${OPEN} AND t.due_date < ?) AS overdue_tasks,
      (SELECT COALESCE(SUM(ts.regular_hours + ts.overtime_hours),0) FROM timesheets ts WHERE ts.user_id = u.id AND ts.work_date BETWEEN ? AND ? AND ts.status != 'rejected') AS recorded_hours_7_days
      FROM users u WHERE u.is_active = 1 ORDER BY u.id LIMIT ? OFFSET ?`).bind(today, from, today, page.limit, page.offset).all()
    return c.json({ ...envelope(rows.results), period: { from, to: today }, hours_note: 'Giờ khai báo, có thể chưa được duyệt; không phải kết luận hiệu suất.', ...page, next_offset: rows.results.length === page.limit ? page.offset + page.limit : null })
  })
  app.all('/mcp', c => handleDdcnMcp(c.req.raw, async (path, query) => {
    const url = new URL(path, 'https://ddcn.internal')
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value))
    return app.request(url.toString(), { headers: { Authorization: c.req.header('Authorization')! } }, c.env)
  }))
  app.all('*', c => c.json({ error: 'Read-only gateway: unsupported operation' }, 405))
  return app
}
