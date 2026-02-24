// ===================================================
// BIM Project Management System - Main API
// ===================================================
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serveStatic } from 'hono/cloudflare-workers'

// ---- Types ----
type Bindings = {
  DB: D1Database
  JWT_SECRET: string
}

// ---- Base64 URL encoding for Unicode support ----
function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  bytes.forEach(b => binary += String.fromCharCode(b))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64UrlDecode(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - str.length % 4) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// ---- Simple JWT-like token using Web Crypto ----
async function createToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64UrlEncode(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 86400000 * 7 }))
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`))
  const sigBytes = new Uint8Array(signature)
  let binary = ''
  sigBytes.forEach(b => binary += String.fromCharCode(b))
  const sig = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `${header}.${body}.${sig}`
}

async function verifyToken(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const [header, body, sig] = token.split('.')
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const padded = sig.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - sig.length % 4) % 4)
    const sigBytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(`${header}.${body}`))
    if (!valid) return null
    const payload = JSON.parse(base64UrlDecode(body))
    if (payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

// Simple password hash (for demo - in production use bcrypt)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + '_bim_salt_2024')
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const computed = await hashPassword(password)
  return computed === hash
}

// ---- App ----
const app = new Hono<{ Bindings: Bindings }>()

app.use('*', logger())
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Auth middleware
const authMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const token = authHeader.slice(7)
  const secret = c.env.JWT_SECRET || 'bim_management_secret_2024'
  const payload = await verifyToken(token, secret)
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
  c.set('user', payload)
  await next()
}

const adminOnly = async (c: any, next: any) => {
  const user = c.get('user') as any
  if (user?.role !== 'system_admin') {
    return c.json({ error: 'Access denied. System Admin only.' }, 403)
  }
  await next()
}

// ===================================================
// AUTH ROUTES
// ===================================================
app.post('/api/auth/login', async (c) => {
  try {
    const { username, password } = await c.req.json()
    if (!username || !password) {
      return c.json({ error: 'Username and password required' }, 400)
    }

    const db = c.env.DB
    const user = await db.prepare(
      'SELECT * FROM users WHERE username = ? AND is_active = 1'
    ).bind(username).first() as any

    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401)
    }

    // For demo: accept 'Admin@123' for admin, 'Pass@123' for others
    let isValid = false
    if (user.role === 'system_admin' && password === 'Admin@123') {
      isValid = true
    } else if (password === 'Pass@123') {
      isValid = true
    } else {
      const hashedInput = await hashPassword(password)
      isValid = hashedInput === user.password_hash
    }

    if (!isValid) {
      return c.json({ error: 'Invalid credentials' }, 401)
    }

    const secret = c.env.JWT_SECRET || 'bim_management_secret_2024'
    const token = await createToken({
      id: user.id,
      username: user.username,
      role: user.role,
      full_name: user.full_name,
      department: user.department
    }, secret)

    return c.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        department: user.department,
        avatar: user.avatar
      }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/auth/change-password', authMiddleware, async (c) => {
  try {
    const user = c.get('user') as any
    const { old_password, new_password } = await c.req.json()
    const db = c.env.DB
    const dbUser = await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first() as any

    let isValid = false
    if (dbUser.role === 'system_admin' && old_password === 'Admin@123') isValid = true
    else if (old_password === 'Pass@123') isValid = true
    else {
      const hashedOld = await hashPassword(old_password)
      isValid = hashedOld === dbUser.password_hash
    }

    if (!isValid) return c.json({ error: 'Old password incorrect' }, 400)

    const newHash = await hashPassword(new_password)
    await db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(newHash, user.id).run()

    return c.json({ success: true, message: 'Password changed successfully' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.get('/api/auth/me', authMiddleware, async (c) => {
  const user = c.get('user') as any
  const db = c.env.DB
  const dbUser = await db.prepare('SELECT id, username, full_name, email, phone, role, department, avatar FROM users WHERE id = ?').bind(user.id).first()
  return c.json(dbUser)
})

// ===================================================
// USERS ROUTES
// ===================================================
app.get('/api/users', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    let query = 'SELECT id, username, full_name, email, phone, role, department, is_active, created_at FROM users'
    if (user.role !== 'system_admin') {
      query += ' WHERE is_active = 1'
    }
    const users = await db.prepare(query).all()
    return c.json(users.results)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/users', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const data = await c.req.json()
    const { username, password, full_name, email, phone, role, department, salary_monthly } = data

    if (!username || !password || !full_name || !role) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    // Auto-append @onecadvn.com if no domain provided
    let finalEmail = email || null
    if (finalEmail && !finalEmail.includes('@')) {
      finalEmail = `${finalEmail}@onecadvn.com`
    } else if (!finalEmail) {
      finalEmail = `${username}@onecadvn.com`
    }

    const hash = await hashPassword(password)
    const result = await db.prepare(
      `INSERT INTO users (username, password_hash, full_name, email, phone, role, department, salary_monthly) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(username, hash, full_name, finalEmail, phone || null, role, department || null, salary_monthly || 0).run()

    return c.json({ success: true, id: result.meta.last_row_id }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.put('/api/users/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const id = parseInt(c.req.param('id'))

    if (user.role !== 'system_admin' && user.id !== id) {
      return c.json({ error: 'Access denied' }, 403)
    }

    const data = await c.req.json()
    const { full_name, email, phone, department, salary_monthly, is_active, role } = data

    const updateFields = []
    const values = []
    if (full_name !== undefined) { updateFields.push('full_name = ?'); values.push(full_name) }
    if (email !== undefined) { updateFields.push('email = ?'); values.push(email) }
    if (phone !== undefined) { updateFields.push('phone = ?'); values.push(phone) }
    if (department !== undefined) { updateFields.push('department = ?'); values.push(department) }
    if (user.role === 'system_admin' && salary_monthly !== undefined) { updateFields.push('salary_monthly = ?'); values.push(salary_monthly) }
    if (user.role === 'system_admin' && is_active !== undefined) { updateFields.push('is_active = ?'); values.push(is_active) }
    if (user.role === 'system_admin' && role !== undefined) { updateFields.push('role = ?'); values.push(role) }
    updateFields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    await db.prepare(`UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.delete('/api/users/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    await db.prepare('UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// PROJECTS ROUTES
// ===================================================
app.get('/api/projects', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any

    let query = `
      SELECT p.*, 
        u1.full_name as admin_name, 
        u2.full_name as leader_name,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as total_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'completed') as completed_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.is_overdue = 1) as overdue_tasks,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as member_count
      FROM projects p
      LEFT JOIN users u1 ON p.admin_id = u1.id
      LEFT JOIN users u2 ON p.leader_id = u2.id
    `

    if (user.role !== 'system_admin') {
      query += ` WHERE p.id IN (SELECT project_id FROM project_members WHERE user_id = ?) OR p.admin_id = ? OR p.leader_id = ?`
      const result = await db.prepare(query).bind(user.id, user.id, user.id).all()
      // Hide financial data from non-system_admin
      const masked = (result.results as any[]).map(p => ({ ...p, contract_value: undefined, budget: undefined }))
      return c.json(masked)
    }

    const result = await db.prepare(query).all()
    return c.json(result.results)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.get('/api/projects/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))

    const project = await db.prepare(`
      SELECT p.*, 
        u1.full_name as admin_name, 
        u2.full_name as leader_name
      FROM projects p
      LEFT JOIN users u1 ON p.admin_id = u1.id
      LEFT JOIN users u2 ON p.leader_id = u2.id
      WHERE p.id = ?
    `).bind(id).first()

    if (!project) return c.json({ error: 'Project not found' }, 404)

    const members = await db.prepare(`
      SELECT pm.*, u.full_name, u.email, u.role as user_role, u.department
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ?
    `).bind(id).all()

    // Hide financial data from non-system_admin
    const user = c.get('user') as any
    if (user.role !== 'system_admin') {
      const { contract_value, budget, ...safeProject } = project as any
      return c.json({ ...safeProject, members: members.results })
    }
    return c.json({ ...project, members: members.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/projects', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    if (!['system_admin', 'project_admin'].includes(user.role)) {
      return c.json({ error: 'Access denied' }, 403)
    }

    const data = await c.req.json()
    const { code, name, description, client, project_type, status, start_date, end_date, budget, contract_value, location, admin_id, leader_id } = data

    if (!code || !name) return c.json({ error: 'Code and name required' }, 400)

    const result = await db.prepare(
      `INSERT INTO projects (code, name, description, client, project_type, status, start_date, end_date, budget, contract_value, location, admin_id, leader_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(code, name, description || null, client || null, project_type || 'building', status || 'planning',
      start_date || null, end_date || null, budget || 0, contract_value || 0, location || null,
      admin_id || user.id, leader_id || null, user.id).run()

    return c.json({ success: true, id: result.meta.last_row_id }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.put('/api/projects/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    const data = await c.req.json()
    const user = c.get('user') as any
    // Only system_admin or project admin_id can edit
    const proj = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first() as any
    if (!proj) return c.json({ error: 'Not found' }, 404)
    if (user.role !== 'system_admin' && proj.admin_id !== user.id)
      return c.json({ error: 'Không có quyền chỉnh sửa dự án này' }, 403)
    const allowedFields = user.role === 'system_admin'
      ? ['name','description','client','project_type','status','start_date','end_date','budget','contract_value','location','admin_id','leader_id','progress']
      : ['name','description','client','project_type','status','start_date','end_date','location','leader_id','progress']
    const updates = allowedFields.filter(f => data[f] !== undefined).map(f => `${f} = ?`)
    const values = allowedFields.filter(f => data[f] !== undefined).map(f => data[f])
    if (!updates.length) return c.json({ error: 'Nothing to update' }, 400)
    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)
    await db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// DELETE project (cascade) — system_admin only
app.delete('/api/projects/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    if (user.role !== 'system_admin') return c.json({ error: 'Chỉ System Admin mới có thể xóa dự án' }, 403)
    const id = parseInt(c.req.param('id'))
    const proj = await db.prepare('SELECT id, name FROM projects WHERE id = ?').bind(id).first()
    if (!proj) return c.json({ error: 'Dự án không tồn tại' }, 404)
    // Cascade delete
    const taskIds = await db.prepare('SELECT id FROM tasks WHERE project_id = ?').bind(id).all()
    for (const t of (taskIds.results as any[])) {
      await db.prepare('DELETE FROM task_history WHERE task_id = ?').bind(t.id).run()
      await db.prepare('DELETE FROM timesheets WHERE task_id = ?').bind(t.id).run()
    }
    await db.prepare('DELETE FROM tasks WHERE project_id = ?').bind(id).run()
    await db.prepare('DELETE FROM categories WHERE project_id = ?').bind(id).run()
    await db.prepare('DELETE FROM project_members WHERE project_id = ?').bind(id).run()
    await db.prepare('DELETE FROM timesheets WHERE project_id = ?').bind(id).run()
    await db.prepare('DELETE FROM project_costs WHERE project_id = ?').bind(id).run()
    await db.prepare('DELETE FROM project_revenues WHERE project_id = ?').bind(id).run()
    await db.prepare('DELETE FROM projects WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Project Members
app.post('/api/projects/:id/members', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const projectId = parseInt(c.req.param('id'))
    const { user_id, role } = await c.req.json()

    await db.prepare(
      'INSERT OR REPLACE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)'
    ).bind(projectId, user_id, role || 'member').run()

    // Create notification
    await db.prepare(
      'INSERT INTO notifications (user_id, title, message, type, related_type, related_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(user_id, 'Bạn đã được thêm vào dự án', `Bạn đã được thêm vào dự án với vai trò ${role || 'member'}`, 'info', 'project', projectId).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.delete('/api/projects/:id/members/:userId', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const projectId = parseInt(c.req.param('id'))
    const userId = parseInt(c.req.param('userId'))
    await db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').bind(projectId, userId).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// CATEGORIES ROUTES
// ===================================================
app.get('/api/projects/:id/categories', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const projectId = parseInt(c.req.param('id'))
    const categories = await db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM tasks t WHERE t.category_id = c.id) as task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.category_id = c.id AND t.status = 'completed') as completed_tasks
      FROM categories c WHERE c.project_id = ?
      ORDER BY c.created_at ASC
    `).bind(projectId).all()
    return c.json(categories.results)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/categories', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const data = await c.req.json()
    const { project_id, name, code, description, discipline_code, phase, start_date, end_date, parent_id } = data

    if (!project_id || !name) return c.json({ error: 'project_id and name required' }, 400)

    const result = await db.prepare(
      `INSERT INTO categories (project_id, name, code, description, discipline_code, phase, start_date, end_date, parent_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(project_id, name, code || null, description || null, discipline_code || null,
      phase || 'basic_design', start_date || null, end_date || null, parent_id || null, user.id).run()

    return c.json({ success: true, id: result.meta.last_row_id }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.put('/api/categories/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    const data = await c.req.json()
    const fields = ['name', 'code', 'description', 'discipline_code', 'phase', 'start_date', 'end_date', 'progress', 'status']
    const updates = fields.filter(f => data[f] !== undefined).map(f => `${f} = ?`)
    const values = fields.filter(f => data[f] !== undefined).map(f => data[f])
    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)
    await db.prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.delete('/api/categories/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    if (!['system_admin','project_admin'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    const id = parseInt(c.req.param('id'))
    // Check if any tasks use this category
    const taskCount = await db.prepare('SELECT COUNT(*) as cnt FROM tasks WHERE category_id = ?').bind(id).first() as any
    if (taskCount?.cnt > 0) return c.json({ error: `Không thể xóa vì còn ${taskCount.cnt} task sử dụng hạng mục này` }, 400)
    await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// TASKS ROUTES
// ===================================================
app.get('/api/tasks', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const { project_id, status, assigned_to, overdue } = c.req.query()

    let query = `
      SELECT t.*, 
        u1.full_name as assigned_to_name,
        u2.full_name as assigned_by_name,
        p.name as project_name, p.code as project_code,
        cat.name as category_name
      FROM tasks t
      LEFT JOIN users u1 ON t.assigned_to = u1.id
      LEFT JOIN users u2 ON t.assigned_by = u2.id
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN categories cat ON t.category_id = cat.id
      WHERE 1=1
    `
    const params: any[] = []

    if (user.role === 'member') {
      query += ` AND t.assigned_to = ?`
      params.push(user.id)
    } else if (user.role === 'project_leader') {
      query += ` AND t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)`
      params.push(user.id)
    }

    if (project_id) { query += ` AND t.project_id = ?`; params.push(parseInt(project_id)) }
    if (status) { query += ` AND t.status = ?`; params.push(status) }
    if (assigned_to) { query += ` AND t.assigned_to = ?`; params.push(parseInt(assigned_to)) }
    if (overdue === '1') { query += ` AND t.due_date < date('now') AND t.status != 'completed'` }

    query += ` ORDER BY t.due_date ASC, t.priority DESC`

    const result = await db.prepare(query).bind(...params).all()

    // Update overdue flag
    await db.prepare(
      `UPDATE tasks SET is_overdue = 1 WHERE due_date < date('now') AND status != 'completed' AND status != 'cancelled'`
    ).run()

    return c.json(result.results)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.get('/api/tasks/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))

    const task = await db.prepare(`
      SELECT t.*, 
        u1.full_name as assigned_to_name,
        u2.full_name as assigned_by_name,
        p.name as project_name,
        cat.name as category_name
      FROM tasks t
      LEFT JOIN users u1 ON t.assigned_to = u1.id
      LEFT JOIN users u2 ON t.assigned_by = u2.id
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN categories cat ON t.category_id = cat.id
      WHERE t.id = ?
    `).bind(id).first()

    const history = await db.prepare(`
      SELECT th.*, u.full_name as changed_by_name
      FROM task_history th
      JOIN users u ON th.user_id = u.id
      WHERE th.task_id = ?
      ORDER BY th.created_at DESC
    `).bind(id).all()

    return c.json({ ...task, history: history.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/tasks', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const data = await c.req.json()
    const { project_id, category_id, title, description, discipline_code, phase, priority, status, assigned_to, start_date, due_date, estimated_hours } = data

    if (!project_id || !title) return c.json({ error: 'project_id and title required' }, 400)

    const result = await db.prepare(
      `INSERT INTO tasks (project_id, category_id, title, description, discipline_code, phase, priority, status, assigned_to, assigned_by, start_date, due_date, estimated_hours)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(project_id, category_id || null, title, description || null, discipline_code || null,
      phase || 'basic_design', priority || 'medium', status || 'todo',
      assigned_to || null, user.id, start_date || null, due_date || null, estimated_hours || 0).run()

    const taskId = result.meta.last_row_id

    // Add history
    await db.prepare(
      'INSERT INTO task_history (task_id, user_id, field_changed, new_value) VALUES (?, ?, ?, ?)'
    ).bind(taskId, user.id, 'created', 'Task created').run()

    // Notify assigned user
    if (assigned_to) {
      await db.prepare(
        'INSERT INTO notifications (user_id, title, message, type, related_type, related_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(assigned_to, 'Task mới được giao', `Bạn được giao task: ${title}`, 'info', 'task', taskId).run()
    }

    return c.json({ success: true, id: taskId }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.put('/api/tasks/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const id = parseInt(c.req.param('id'))
    const data = await c.req.json()

    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first() as any
    if (!task) return c.json({ error: 'Task not found' }, 404)

    // RBAC: member chỉ được cập nhật progress và status của task được giao
    const isAdmin = user.role === 'system_admin'
    const isProjAdmin = user.role === 'project_admin' || user.role === 'project_leader'
    const isAssigned = task.assigned_to === user.id

    if (!isAdmin && !isProjAdmin && !isAssigned)
      return c.json({ error: 'Không có quyền chỉnh sửa task này' }, 403)

    // member chỉ được sửa progress/status/actual_hours
    const fields = (isAdmin || isProjAdmin)
      ? ['title', 'description', 'discipline_code', 'phase', 'priority', 'status', 'assigned_to', 'start_date', 'due_date', 'actual_start_date', 'actual_end_date', 'estimated_hours', 'actual_hours', 'progress', 'category_id']
      : ['status', 'progress', 'actual_hours', 'actual_end_date']
    const updates = fields.filter(f => data[f] !== undefined).map(f => `${f} = ?`)
    const values = fields.filter(f => data[f] !== undefined).map(f => data[f])

    // Auto-set overdue
    if (data.status === 'completed') {
      updates.push('is_overdue = ?')
      values.push(0)
      if (!data.actual_end_date) {
        updates.push('actual_end_date = ?')
        values.push(new Date().toISOString().split('T')[0])
      }
    }

    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    await db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()

    // Track history
    for (const field of fields.filter(f => data[f] !== undefined)) {
      if (task[field] != data[field]) {
        await db.prepare(
          'INSERT INTO task_history (task_id, user_id, field_changed, old_value, new_value) VALUES (?, ?, ?, ?, ?)'
        ).bind(id, user.id, field, String(task[field] ?? ''), String(data[field])).run()
      }
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.delete('/api/tasks/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    if (!['system_admin','project_admin'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    const id = parseInt(c.req.param('id'))
    // Cascade: delete related timesheets and history
    await db.prepare('DELETE FROM task_history WHERE task_id = ?').bind(id).run()
    await db.prepare('UPDATE timesheets SET task_id = NULL WHERE task_id = ?').bind(id).run()
    await db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// ===================================================
// TIMESHEET ROUTES  (role-based access control)
// system_admin : xem/sửa/xóa tất cả timesheets
// project_admin: xem/sửa/duyệt timesheets thuộc dự án mình quản lý
// project_leader: xem timesheets của dự án mình làm leader; sửa của chính mình
// member       : chỉ xem/tạo/sửa timesheets của chính mình
// ===================================================

// Helper: kiểm tra project_admin có quản lý project_id này không
async function isProjectAdmin(db: D1Database, userId: number, projectId: number): Promise<boolean> {
  const proj = await db.prepare(
    `SELECT id FROM projects WHERE id = ? AND (admin_id = ? OR leader_id = ?)`
  ).bind(projectId, userId, userId).first()
  if (proj) return true
  // cũng check trong bảng project_members với role project_admin
  const mem = await db.prepare(
    `SELECT id FROM project_members WHERE project_id = ? AND user_id = ? AND role IN ('project_admin','project_leader')`
  ).bind(projectId, userId).first()
  return !!mem
}

// ===================================================
// GET /api/members — list all non-admin active users (for dropdowns)
// ===================================================
app.get('/api/members', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const result = await db.prepare(
      `SELECT id, full_name, department, role, email
       FROM users
       WHERE is_active = 1 AND role != 'system_admin'
       ORDER BY full_name ASC`
    ).all()
    return c.json(result.results)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ===================================================
// POST /api/admin/dedup-timesheets — remove duplicate timesheet rows
// (same user_id, project_id, work_date) keeping earliest id
// ===================================================
app.post('/api/admin/dedup-timesheets', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    // Find duplicates
    const dups = await db.prepare(`
      SELECT user_id, project_id, work_date, COUNT(*) as cnt
      FROM timesheets
      GROUP BY user_id, project_id, work_date
      HAVING COUNT(*) > 1
    `).all()
    let removed = 0
    for (const row of (dups.results as any[])) {
      const del = await db.prepare(`
        DELETE FROM timesheets
        WHERE user_id = ? AND project_id = ? AND work_date = ?
          AND id NOT IN (
            SELECT MIN(id) FROM timesheets
            WHERE user_id = ? AND project_id = ? AND work_date = ?
          )
      `).bind(row.user_id, row.project_id, row.work_date,
               row.user_id, row.project_id, row.work_date).run()
      removed += (del.meta?.changes || 0)
    }
    const total = await db.prepare('SELECT COUNT(*) as cnt FROM timesheets').first() as any
    return c.json({ success: true, duplicates_found: dups.results.length, rows_removed: removed, total_remaining: total?.cnt || 0 })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ===================================================
// GET /api/timesheet-dashboard/:month/:year — monthly summary
// ===================================================
app.get('/api/timesheet-dashboard/:month/:year', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const m = c.req.param('month').padStart(2, '0')
    const y = c.req.param('year')

    // Total hours — simple SUM, no JOIN
    const totals = await db.prepare(`
      SELECT
        SUM(regular_hours)              AS total_regular_hours,
        SUM(IFNULL(overtime_hours, 0))  AS total_overtime_hours,
        SUM(regular_hours + IFNULL(overtime_hours, 0)) AS total_hours,
        COUNT(DISTINCT work_date)       AS working_days,
        COUNT(DISTINCT user_id)         AS active_members,
        COUNT(*)                        AS total_entries
      FROM timesheets
      WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
    `).bind(y, m).first() as any

    // Per-member breakdown
    const byMember = await db.prepare(`
      SELECT ts.user_id, u.full_name, u.department,
        SUM(ts.regular_hours)             AS regular_hours,
        SUM(IFNULL(ts.overtime_hours, 0)) AS overtime_hours,
        SUM(ts.regular_hours + IFNULL(ts.overtime_hours, 0)) AS total_hours,
        COUNT(DISTINCT ts.work_date)      AS working_days
      FROM timesheets ts
      JOIN users u ON u.id = ts.user_id
      WHERE strftime('%Y', ts.work_date) = ? AND strftime('%m', ts.work_date) = ?
      GROUP BY ts.user_id
      ORDER BY total_hours DESC
    `).bind(y, m).all()

    // Per-project breakdown
    const byProject = await db.prepare(`
      SELECT ts.project_id, p.code, p.name,
        SUM(ts.regular_hours)             AS regular_hours,
        SUM(IFNULL(ts.overtime_hours, 0)) AS overtime_hours,
        SUM(ts.regular_hours + IFNULL(ts.overtime_hours, 0)) AS total_hours,
        COUNT(DISTINCT ts.user_id)        AS member_count
      FROM timesheets ts
      JOIN projects p ON p.id = ts.project_id
      WHERE strftime('%Y', ts.work_date) = ? AND strftime('%m', ts.work_date) = ?
      GROUP BY ts.project_id
      ORDER BY total_hours DESC
    `).bind(y, m).all()

    // Duplicate check
    const dupCheck = await db.prepare(`
      SELECT COUNT(*) as dup_groups FROM (
        SELECT user_id, project_id, work_date
        FROM timesheets
        GROUP BY user_id, project_id, work_date
        HAVING COUNT(*) > 1
      )
    `).first() as any

    return c.json({
      month: `${y}-${m}`,
      summary: {
        total_regular_hours: totals?.total_regular_hours || 0,
        total_overtime_hours: totals?.total_overtime_hours || 0,
        total_hours: totals?.total_hours || 0,
        working_days: totals?.working_days || 0,
        active_members: totals?.active_members || 0,
        total_entries: totals?.total_entries || 0,
        duplicate_groups: dupCheck?.dup_groups || 0
      },
      by_member: byMember.results,
      by_project: byProject.results
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

app.get('/api/timesheets', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const { project_id, user_id, month, year, status } = c.req.query()

    let query = `
      SELECT ts.*,
        u.full_name as user_name, u.department,
        p.name as project_name, p.code as project_code,
        t.title as task_title
      FROM timesheets ts
      JOIN users u ON ts.user_id = u.id
      JOIN projects p ON ts.project_id = p.id
      LEFT JOIN tasks t ON ts.task_id = t.id
      WHERE 1=1
    `
    const params: any[] = []

    if (user.role === 'system_admin') {
      if (user_id) { query += ` AND ts.user_id = ?`; params.push(parseInt(user_id)) }
      if (project_id) { query += ` AND ts.project_id = ?`; params.push(parseInt(project_id)) }
    } else if (user.role === 'project_admin' || user.role === 'project_leader') {
      query += `
        AND ts.project_id IN (
          SELECT id FROM projects WHERE admin_id = ? OR leader_id = ?
          UNION
          SELECT project_id FROM project_members
          WHERE user_id = ? AND role IN ('project_admin','project_leader')
        )
      `
      params.push(user.id, user.id, user.id)
      if (user_id) { query += ` AND ts.user_id = ?`; params.push(parseInt(user_id)) }
      if (project_id) { query += ` AND ts.project_id = ?`; params.push(parseInt(project_id)) }
    } else {
      query += ` AND ts.user_id = ?`
      params.push(user.id)
      if (project_id) { query += ` AND ts.project_id = ?`; params.push(parseInt(project_id)) }
    }

    if (status) { query += ` AND ts.status = ?`; params.push(status) }
    if (month)  { query += ` AND strftime('%m', ts.work_date) = ?`; params.push(month.padStart(2, '0')) }
    if (year)   { query += ` AND strftime('%Y', ts.work_date) = ?`; params.push(year) }

    query += ' ORDER BY ts.work_date DESC, ts.id DESC'
    const result = await db.prepare(query).bind(...params).all()

    // Summary: simple SUM — no extra JOIN
    const sumQuery = `
      SELECT
        SUM(regular_hours)              AS total_regular_hours,
        SUM(IFNULL(overtime_hours, 0))  AS total_overtime_hours,
        SUM(regular_hours + IFNULL(overtime_hours, 0)) AS total_hours
      FROM timesheets ts
      WHERE 1=1
    `
    // Build identical WHERE conditions for summary
    let sumQ = sumQuery
    const sumParams: any[] = []
    if (user.role === 'system_admin') {
      if (user_id) { sumQ += ` AND ts.user_id = ?`; sumParams.push(parseInt(user_id)) }
      if (project_id) { sumQ += ` AND ts.project_id = ?`; sumParams.push(parseInt(project_id)) }
    } else if (user.role === 'project_admin' || user.role === 'project_leader') {
      sumQ += `
        AND ts.project_id IN (
          SELECT id FROM projects WHERE admin_id = ? OR leader_id = ?
          UNION
          SELECT project_id FROM project_members
          WHERE user_id = ? AND role IN ('project_admin','project_leader')
        )
      `
      sumParams.push(user.id, user.id, user.id)
      if (user_id) { sumQ += ` AND ts.user_id = ?`; sumParams.push(parseInt(user_id)) }
      if (project_id) { sumQ += ` AND ts.project_id = ?`; sumParams.push(parseInt(project_id)) }
    } else {
      sumQ += ` AND ts.user_id = ?`
      sumParams.push(user.id)
      if (project_id) { sumQ += ` AND ts.project_id = ?`; sumParams.push(parseInt(project_id)) }
    }
    if (status) { sumQ += ` AND ts.status = ?`; sumParams.push(status) }
    if (month)  { sumQ += ` AND strftime('%m', ts.work_date) = ?`; sumParams.push(month.padStart(2, '0')) }
    if (year)   { sumQ += ` AND strftime('%Y', ts.work_date) = ?`; sumParams.push(year) }

    const summary = sumParams.length
      ? await db.prepare(sumQ).bind(...sumParams).first() as any
      : await db.prepare(sumQ).first() as any

    return c.json({
      timesheets: result.results,
      summary: {
        total_regular_hours: summary?.total_regular_hours || 0,
        total_overtime_hours: summary?.total_overtime_hours || 0,
        total_hours: summary?.total_hours || 0
      }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/timesheets', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const data = await c.req.json()
    const { project_id, task_id, work_date, regular_hours, overtime_hours, description } = data

    if (!project_id || !work_date) return c.json({ error: 'project_id and work_date required' }, 400)

    // member chỉ được tạo timesheet cho chính mình
    // system_admin/project_admin có thể tạo cho user_id bất kỳ (nếu truyền vào)
    const targetUserId = (data.user_id && user.role !== 'member') ? data.user_id : user.id

    // project_admin/leader chỉ tạo được trong dự án mình quản lý
    if (user.role === 'project_admin' || user.role === 'project_leader') {
      const allowed = await isProjectAdmin(db, user.id, parseInt(project_id))
      if (!allowed) return c.json({ error: 'Bạn không có quyền tạo timesheet cho dự án này' }, 403)
    }

    const result = await db.prepare(
      `INSERT INTO timesheets (user_id, project_id, task_id, work_date, regular_hours, overtime_hours, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(targetUserId, project_id, task_id || null, work_date,
      regular_hours || 0, overtime_hours || 0, description || null).run()

    return c.json({ success: true, id: result.meta.last_row_id }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.put('/api/timesheets/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const id = parseInt(c.req.param('id'))
    const data = await c.req.json()

    const ts = await db.prepare('SELECT * FROM timesheets WHERE id = ?').bind(id).first() as any
    if (!ts) return c.json({ error: 'Timesheet not found' }, 404)

    // Kiểm tra quyền chỉnh sửa
    const isOwner = ts.user_id === user.id
    const isAdmin = user.role === 'system_admin'
    const isProjAdmin = (user.role === 'project_admin' || user.role === 'project_leader')
      && await isProjectAdmin(db, user.id, ts.project_id)

    if (!isOwner && !isAdmin && !isProjAdmin) {
      return c.json({ error: 'Bạn không có quyền chỉnh sửa timesheet này' }, 403)
    }

    // member chỉ sửa được timesheet ở trạng thái draft/rejected của chính mình
    if (isOwner && !isAdmin && !isProjAdmin) {
      if (!['draft', 'rejected'].includes(ts.status)) {
        return c.json({ error: 'Không thể sửa timesheet đã được duyệt hoặc đang chờ duyệt' }, 403)
      }
    }

    const { regular_hours, overtime_hours, description, status } = data
    const updates: string[] = []
    const values: any[] = []

    if (regular_hours !== undefined) { updates.push('regular_hours = ?'); values.push(regular_hours) }
    if (overtime_hours !== undefined) { updates.push('overtime_hours = ?'); values.push(overtime_hours) }
    if (description !== undefined) { updates.push('description = ?'); values.push(description) }

    if (status !== undefined) {
      if (isAdmin || isProjAdmin) {
        // project_admin/system_admin: được đổi mọi status (duyệt, từ chối...)
        updates.push('status = ?'); values.push(status)
        if (status === 'approved') {
          updates.push('approved_by = ?'); values.push(user.id)
          updates.push('approved_at = CURRENT_TIMESTAMP')
        }
        if (status === 'rejected') {
          updates.push('approved_by = ?'); values.push(user.id)
          updates.push('approved_at = CURRENT_TIMESTAMP')
        }
      } else if (isOwner) {
        // member chỉ được submit (draft → submitted) hoặc rút lại (submitted → draft)
        if ((ts.status === 'draft' && status === 'submitted') ||
            (ts.status === 'submitted' && status === 'draft')) {
          updates.push('status = ?'); values.push(status)
        }
      }
    }

    if (!updates.length && status === undefined) {
      return c.json({ error: 'Không có gì để cập nhật' }, 400)
    }
    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    await db.prepare(`UPDATE timesheets SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/timesheets/bulk-approve', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    if (!['system_admin', 'project_admin', 'project_leader'].includes(user.role)) {
      return c.json({ error: 'Access denied' }, 403)
    }
    const { ids } = await c.req.json()
    if (!ids?.length) return c.json({ error: 'No IDs provided' }, 400)

    let approved = 0
    for (const id of ids) {
      try {
        await db.prepare(
          `UPDATE timesheets SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'submitted'`
        ).bind(user.id, id).run()
        approved++
      } catch (_) { /* skip */ }
    }
    return c.json({ success: true, approved })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.delete('/api/timesheets/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const id = parseInt(c.req.param('id'))
    const ts = await db.prepare('SELECT * FROM timesheets WHERE id = ?').bind(id).first() as any
    if (!ts) return c.json({ error: 'Not found' }, 404)

    const isOwner = ts.user_id === user.id
    const isAdmin = user.role === 'system_admin'
    const isProjAdmin = (user.role === 'project_admin' || user.role === 'project_leader')
      && await isProjectAdmin(db, user.id, ts.project_id)

    if (!isAdmin && !isProjAdmin && !(isOwner && ['draft', 'rejected'].includes(ts.status))) {
      return c.json({ error: 'Không có quyền xóa timesheet này' }, 403)
    }

    await db.prepare('DELETE FROM timesheets WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// COST MANAGEMENT ROUTES (Admin Only)
// ===================================================
app.get('/api/costs', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { project_id, cost_type, year } = c.req.query()

    let query = `
      SELECT pc.*, p.name as project_name, p.code as project_code,
        u.full_name as created_by_name
      FROM project_costs pc
      JOIN projects p ON pc.project_id = p.id
      LEFT JOIN users u ON pc.created_by = u.id
      WHERE 1=1
    `
    const params: any[] = []
    if (project_id) { query += ` AND pc.project_id = ?`; params.push(parseInt(project_id)) }
    if (cost_type) { query += ` AND pc.cost_type = ?`; params.push(cost_type) }
    if (year) { query += ` AND strftime('%Y', pc.cost_date) = ?`; params.push(year) }
    query += ' ORDER BY pc.cost_date DESC'

    const result = await db.prepare(query).bind(...params).all()
    return c.json(result.results)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/costs', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const data = await c.req.json()
    const { project_id, cost_type, description, amount, currency, cost_date, invoice_number, vendor, notes } = data

    if (!project_id || !cost_type || !description || !amount) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    const result = await db.prepare(
      `INSERT INTO project_costs (project_id, cost_type, description, amount, currency, cost_date, invoice_number, vendor, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(project_id, cost_type, description, amount, currency || 'VND',
      cost_date || null, invoice_number || null, vendor || null, notes || null, user.id).run()

    return c.json({ success: true, id: result.meta.last_row_id }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.put('/api/costs/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    const data = await c.req.json()
    const fields = ['cost_type', 'description', 'amount', 'currency', 'cost_date', 'invoice_number', 'vendor', 'notes']
    const updates = fields.filter(f => data[f] !== undefined).map(f => `${f} = ?`)
    const values = fields.filter(f => data[f] !== undefined).map(f => data[f])
    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)
    await db.prepare(`UPDATE project_costs SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.delete('/api/costs/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    await db.prepare('DELETE FROM project_costs WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.put('/api/revenues/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    const data = await c.req.json()
    const fields = ['description', 'amount', 'currency', 'revenue_date', 'invoice_number', 'payment_status', 'notes']
    const updates = fields.filter(f => data[f] !== undefined).map(f => `${f} = ?`)
    const values = fields.filter(f => data[f] !== undefined).map(f => data[f])
    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)
    await db.prepare(`UPDATE project_revenues SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.delete('/api/revenues/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    await db.prepare('DELETE FROM project_revenues WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Revenue routes
app.get('/api/revenues', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { project_id, year } = c.req.query()
    let query = `
      SELECT pr.*, p.name as project_name, p.code as project_code
      FROM project_revenues pr
      JOIN projects p ON pr.project_id = p.id
      WHERE 1=1
    `
    const params: any[] = []
    if (project_id) { query += ` AND pr.project_id = ?`; params.push(parseInt(project_id)) }
    if (year) { query += ` AND strftime('%Y', pr.revenue_date) = ?`; params.push(year) }
    query += ' ORDER BY pr.revenue_date DESC'
    const result = await db.prepare(query).bind(...params).all()
    return c.json(result.results)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/revenues', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const data = await c.req.json()
    const { project_id, description, amount, currency, revenue_date, invoice_number, payment_status, notes } = data

    const result = await db.prepare(
      `INSERT INTO project_revenues (project_id, description, amount, currency, revenue_date, invoice_number, payment_status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(project_id, description, amount, currency || 'VND',
      revenue_date || null, invoice_number || null, payment_status || 'pending', notes || null, user.id).run()

    return c.json({ success: true, id: result.meta.last_row_id }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// PROJECT LABOR COSTS — link từ Chi Phí Lương → Chi Phí & Doanh Thu
// ===================================================

// ===================================================
// PROJECT LABOR COSTS APIs (FIX 1 + FIX 3)
// ===================================================

// GET /api/projects/:id/labor-costs
// Hỗ trợ: ?month=MM&year=YYYY (single), ?months=1,2,3&year=YYYY (multi), ?all_months=true&year=YYYY
app.get('/api/projects/:id/labor-costs', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const projectId = parseInt(c.req.param('id'))
    const { month, months, year, all_months } = c.req.query()
    const yInt = year ? parseInt(year) : new Date().getFullYear()
    const y = String(yInt)

    const proj = await db.prepare('SELECT id, code, name, contract_value FROM projects WHERE id = ?').bind(projectId).first() as any
    if (!proj) return c.json({ error: 'Project not found' }, 404)

    let queryType: string
    let laborCost = 0, totalHours = 0, costPerHourAvg = 0
    const monthlyBreakdown: any[] = []

    if (all_months === 'true') {
      // CASE 1: Tất cả tháng trong năm — aggregate từ project_labor_costs
      queryType = 'all_months'
      const rows = await db.prepare(
        `SELECT month, year, total_labor_cost, total_hours, cost_per_hour
         FROM project_labor_costs WHERE project_id = ? AND year = ? ORDER BY month`
      ).bind(projectId, yInt).all()
      const rArr = rows.results as any[]

      if (rArr.length > 0) {
        laborCost = rArr.reduce((s, r) => s + (r.total_labor_cost || 0), 0)
        totalHours = rArr.reduce((s, r) => s + (r.total_hours || 0), 0)
        costPerHourAvg = rArr.reduce((s, r) => s + (r.cost_per_hour || 0), 0) / rArr.length
        monthlyBreakdown.push(...rArr)
      } else {
        // Fallback: tính real-time từng tháng rồi cộng
        for (let mInt = 1; mInt <= 12; mInt++) {
          const m = String(mInt).padStart(2, '0')
          const { laborCostSource, totalHrs, costPerHour } = await computeMonthLaborCost(db, mInt, yInt)
          const projHrs = await db.prepare(
            `SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as total FROM timesheets
             WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
          ).bind(projectId, y, m).first() as any
          const hrs = projHrs?.total || 0
          if (hrs > 0) {
            const mc = Math.round(hrs * costPerHour)
            laborCost += mc; totalHours += hrs
            monthlyBreakdown.push({ month: mInt, year: yInt, total_hours: hrs, cost_per_hour: Math.round(costPerHour), total_labor_cost: mc })
          }
        }
        costPerHourAvg = monthlyBreakdown.length > 0
          ? monthlyBreakdown.reduce((s, r) => s + r.cost_per_hour, 0) / monthlyBreakdown.length : 0
      }

    } else if (months) {
      // CASE 2: Multiple months
      queryType = 'multiple_months'
      const monthArr = months.split(',').map((m: string) => parseInt(m.trim())).filter((m: number) => m >= 1 && m <= 12)
      for (const mInt of monthArr) {
        const m = String(mInt).padStart(2, '0')
        // Try cache first
        const cached = await db.prepare(
          `SELECT total_labor_cost, total_hours, cost_per_hour FROM project_labor_costs
           WHERE project_id = ? AND month = ? AND year = ?`
        ).bind(projectId, mInt, yInt).first() as any
        if (cached) {
          laborCost += cached.total_labor_cost; totalHours += cached.total_hours
          monthlyBreakdown.push({ month: mInt, year: yInt, ...cached })
        } else {
          const { costPerHour } = await computeMonthLaborCost(db, mInt, yInt)
          const projHrs = await db.prepare(
            `SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as total FROM timesheets
             WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
          ).bind(projectId, y, m).first() as any
          const hrs = projHrs?.total || 0
          const mc = Math.round(hrs * costPerHour)
          laborCost += mc; totalHours += hrs
          monthlyBreakdown.push({ month: mInt, year: yInt, total_hours: hrs, cost_per_hour: Math.round(costPerHour), total_labor_cost: mc })
        }
      }
      costPerHourAvg = monthlyBreakdown.length > 0
        ? monthlyBreakdown.reduce((s, r) => s + (r.cost_per_hour || 0), 0) / monthlyBreakdown.length : 0

    } else {
      // CASE 3: Single month (default)
      queryType = 'single_month'
      const mInt = month ? parseInt(month) : new Date().getMonth() + 1
      const m = String(mInt).padStart(2, '0')

      // Try cached project_labor_costs first
      const cached = await db.prepare(
        `SELECT total_labor_cost, total_hours, cost_per_hour FROM project_labor_costs
         WHERE project_id = ? AND month = ? AND year = ?`
      ).bind(projectId, mInt, yInt).first() as any

      if (cached) {
        laborCost = cached.total_labor_cost; totalHours = cached.total_hours
        costPerHourAvg = cached.cost_per_hour
      } else {
        const { laborCostSource, totalHrs, costPerHour } = await computeMonthLaborCost(db, mInt, yInt)
        const projHrs = await db.prepare(
          `SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as total FROM timesheets
           WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
        ).bind(projectId, y, m).first() as any
        totalHours = projHrs?.total || 0; costPerHourAvg = costPerHour
        laborCost = Math.round(totalHours * costPerHour)
      }
      monthlyBreakdown.push({ month: mInt, year: yInt, total_hours: totalHours, cost_per_hour: Math.round(costPerHourAvg), total_labor_cost: laborCost })
    }

    return c.json({
      project_id: projectId, project_code: proj.code, project_name: proj.name,
      year: yInt, query_type: queryType,
      total_hours: totalHours,
      cost_per_hour: Math.round(costPerHourAvg),
      total_labor_cost: Math.round(laborCost),
      monthly_breakdown: monthlyBreakdown,
      summary: {
        total_labor_cost: Math.round(laborCost),
        total_hours: totalHours,
        avg_cost_per_hour: Math.round(costPerHourAvg),
        months_with_data: monthlyBreakdown.filter(r => r.total_hours > 0).length
      }
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/projects/:id/labor-costs-yearly — full year breakdown
app.get('/api/projects/:id/labor-costs-yearly', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const projectId = parseInt(c.req.param('id'))
    const year = c.req.query('year') || String(new Date().getFullYear())
    const yInt = parseInt(year)

    const proj = await db.prepare('SELECT id, code, name FROM projects WHERE id = ?').bind(projectId).first() as any
    if (!proj) return c.json({ error: 'Project not found' }, 404)

    const cached = await db.prepare(
      `SELECT month, year, total_hours, cost_per_hour, total_labor_cost
       FROM project_labor_costs WHERE project_id = ? AND year = ? ORDER BY month`
    ).bind(projectId, yInt).all()

    let monthlyDetails = cached.results as any[]

    // For months not in cache, fill with real-time
    if (monthlyDetails.length < 12) {
      const cachedMonths = new Set(monthlyDetails.map((r: any) => r.month))
      for (let mInt = 1; mInt <= 12; mInt++) {
        if (!cachedMonths.has(mInt)) {
          const m = String(mInt).padStart(2, '0')
          const { costPerHour } = await computeMonthLaborCost(db, mInt, yInt)
          const projHrs = await db.prepare(
            `SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as total FROM timesheets
             WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
          ).bind(projectId, year, m).first() as any
          const hrs = projHrs?.total || 0
          monthlyDetails.push({ month: mInt, year: yInt, total_hours: hrs, cost_per_hour: Math.round(costPerHour), total_labor_cost: Math.round(hrs * costPerHour) })
        }
      }
      monthlyDetails.sort((a: any, b: any) => a.month - b.month)
    }

    const annualLaborCost = monthlyDetails.reduce((s: number, r: any) => s + (r.total_labor_cost || 0), 0)
    const annualHours = monthlyDetails.reduce((s: number, r: any) => s + (r.total_hours || 0), 0)
    const monthsWithData = monthlyDetails.filter((r: any) => r.total_hours > 0).length
    const avgCostPerHour = monthsWithData > 0
      ? monthlyDetails.filter((r: any) => r.total_hours > 0).reduce((s: number, r: any) => s + r.cost_per_hour, 0) / monthsWithData : 0

    return c.json({
      project_id: projectId, project_code: proj.code, project_name: proj.name,
      year: yInt,
      monthly_breakdown: monthlyDetails,
      yearly_total: {
        annual_labor_cost: Math.round(annualLaborCost),
        annual_hours: annualHours,
        avg_cost_per_hour: Math.round(avgCostPerHour),
        months_count: monthsWithData
      },
      summary: {
        total_labor_cost: Math.round(annualLaborCost),
        total_hours: annualHours,
        avg_cost_per_hour: Math.round(avgCostPerHour),
        months_with_data: monthsWithData
      }
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/projects/:id/labor-costs-check — FIX 3: check existence without creating
app.get('/api/projects/:id/labor-costs-check', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const projectId = parseInt(c.req.param('id'))
    const { month, year } = c.req.query()
    const mInt = month ? parseInt(month) : new Date().getMonth() + 1
    const yInt = year ? parseInt(year) : new Date().getFullYear()

    const existing = await db.prepare(
      `SELECT id, total_labor_cost, total_hours, cost_per_hour, created_at, updated_at
       FROM project_labor_costs WHERE project_id = ? AND month = ? AND year = ?`
    ).bind(projectId, mInt, yInt).first() as any

    return c.json({
      exists: !!existing,
      message: existing ? 'Chi phí lương đã tồn tại' : 'Chưa có dữ liệu chi phí lương',
      data: existing || null,
      month: mInt, year: yInt, project_id: projectId
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/projects/:id/labor-costs/sync — FIX 3: manual sync/create, no auto-create on load
app.post('/api/projects/:id/labor-costs/sync', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const projectId = parseInt(c.req.param('id'))
    const body = await c.req.json().catch(() => ({})) as any
    const { month, year, force_recalculate = false } = body
    const mInt = month ? parseInt(month) : new Date().getMonth() + 1
    const yInt = year ? parseInt(year) : new Date().getFullYear()
    const m = String(mInt).padStart(2, '0')
    const y = String(yInt)

    // Check existing
    const existing = await db.prepare(
      `SELECT id, total_labor_cost FROM project_labor_costs WHERE project_id = ? AND month = ? AND year = ?`
    ).bind(projectId, mInt, yInt).first() as any

    if (existing && !force_recalculate) {
      return c.json({ success: true, action: 'existing', data: existing, message: 'Chi phí đã tồn tại, dùng force_recalculate=true để tính lại' })
    }

    // Calculate
    const { laborCostSource, totalHrs, costPerHour } = await computeMonthLaborCost(db, mInt, yInt)
    if (totalHrs === 0) {
      return c.json({ success: false, error: `Không có dữ liệu timesheet tháng ${mInt}/${yInt}` }, 400)
    }

    const projHrs = await db.prepare(
      `SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as total FROM timesheets
       WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
    ).bind(projectId, y, m).first() as any
    const projectHours = projHrs?.total || 0
    const projectLaborCost = Math.round(projectHours * costPerHour)

    if (existing) {
      await db.prepare(
        `UPDATE project_labor_costs SET total_hours = ?, cost_per_hour = ?, total_labor_cost = ?, updated_at = CURRENT_TIMESTAMP
         WHERE project_id = ? AND month = ? AND year = ?`
      ).bind(projectHours, Math.round(costPerHour), projectLaborCost, projectId, mInt, yInt).run()
      return c.json({ success: true, action: 'updated', data: { total_hours: projectHours, cost_per_hour: Math.round(costPerHour), total_labor_cost: projectLaborCost }, message: `Đã cập nhật chi phí lương` })
    } else {
      await db.prepare(
        `INSERT INTO project_labor_costs (project_id, month, year, total_hours, cost_per_hour, total_labor_cost) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(projectId, mInt, yInt, projectHours, Math.round(costPerHour), projectLaborCost).run()
      return c.json({ success: true, action: 'created', data: { total_hours: projectHours, cost_per_hour: Math.round(costPerHour), total_labor_cost: projectLaborCost }, message: `Đã tạo chi phí lương` })
    }
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// DELETE /api/projects/:id/labor-costs/duplicates — FIX 3: cleanup duplicates
app.delete('/api/projects/:id/labor-costs/duplicates', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const projectId = parseInt(c.req.param('id'))

    const del = await db.prepare(
      `DELETE FROM project_labor_costs WHERE id NOT IN (
         SELECT MIN(id) FROM project_labor_costs WHERE project_id = ?
         GROUP BY project_id, month, year
       ) AND project_id = ?`
    ).bind(projectId, projectId).run()

    const remaining = await db.prepare(
      `SELECT COUNT(*) as cnt FROM project_labor_costs WHERE project_id = ?`
    ).bind(projectId).first() as any

    return c.json({ success: true, deleted_count: del.meta?.changes || 0, remaining_records: remaining?.cnt || 0, message: `Đã xóa ${del.meta?.changes || 0} bản ghi trùng` })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/financial-summary/labor-costs-all-projects — aggregate across projects
app.get('/api/financial-summary/labor-costs-all-projects', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { months, year, all_months } = c.req.query()
    const yInt = year ? parseInt(year) : new Date().getFullYear()

    let whereExtra = ''; const params: any[] = [yInt]
    if (all_months !== 'true' && months) {
      const monthArr = months.split(',').map((m: string) => parseInt(m.trim())).filter((m: number) => m >= 1 && m <= 12)
      if (monthArr.length > 0) {
        whereExtra = ` AND plc.month IN (${monthArr.map(() => '?').join(',')})`
        params.push(...monthArr)
      }
    }

    const rows = await db.prepare(`
      SELECT p.id as project_id, p.code as project_code, p.name as project_name,
             SUM(plc.total_labor_cost) as total_labor_cost,
             SUM(plc.total_hours) as total_hours,
             AVG(plc.cost_per_hour) as avg_cost_per_hour,
             COUNT(DISTINCT plc.month) as months_count
      FROM project_labor_costs plc
      JOIN projects p ON plc.project_id = p.id
      WHERE plc.year = ? ${whereExtra}
      GROUP BY p.id, p.code, p.name
      ORDER BY total_labor_cost DESC
    `).bind(...params).all()

    const projectsArr = rows.results as any[]
    const grandTotal = projectsArr.reduce((s, r) => s + (r.total_labor_cost || 0), 0)

    return c.json({
      year: yInt, period_type: all_months === 'true' ? 'full_year' : months ? 'selected_months' : 'all',
      projects: projectsArr,
      grand_total_labor_cost: Math.round(grandTotal),
      projects_count: projectsArr.length
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/projects/:id/costs-revenue-summary
// Tóm tắt tài chính dự án — hỗ trợ đầy đủ 3 chế độ:
//   ?month=M&year=Y           → single month
//   ?months=1,2,3&year=Y      → multiple months (SUM)
//   ?all_months=true&year=Y   → whole year (SUM tất cả tháng)
// Chi phí lương = SUM(project_labor_costs) cho kỳ chọn
// Nếu không có cached data → tính real-time TỪNG THÁNG rồi cộng dồn
app.get('/api/projects/:id/costs-revenue-summary', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const projectId = parseInt(c.req.param('id'))
    const { month, months, year, all_months } = c.req.query()
    const yInt = year ? parseInt(year) : new Date().getFullYear()
    const y = String(yInt)

    const proj = await db.prepare('SELECT id, code, name, contract_value FROM projects WHERE id = ?').bind(projectId).first() as any
    if (!proj) return c.json({ error: 'Project not found' }, 404)
    const contractValue = proj.contract_value || 0

    // ── Determine period type & month list ──────────────────────────
    let periodType = 'all_months'
    let periodLabel = `Toàn năm ${yInt}`
    let selectedMonths: number[] | null = null   // null = all 12 months

    if (all_months === 'true') {
      periodType = 'all_months'
      periodLabel = `Toàn năm ${yInt}`
      selectedMonths = null   // will sum all months in DB
    } else if (months) {
      const parsed = months.split(',').map((m: string) => parseInt(m.trim())).filter((m: number) => m >= 1 && m <= 12)
      if (parsed.length > 0) {
        selectedMonths = parsed
        periodType = 'multiple_months'
        periodLabel = `T${parsed.join(',')}/${yInt}`
      }
    } else if (month) {
      const mInt = parseInt(month)
      if (mInt >= 1 && mInt <= 12) {
        selectedMonths = [mInt]
        periodType = 'single_month'
        periodLabel = `T${mInt}/${yInt}`
      }
    }

    // ── Build SQL date filters for project_costs / project_revenues ──
    // Always filter by year; additionally filter by month(s) if not all_months
    let costDateFilter = `AND strftime('%Y', pc.cost_date) = '${y}'`
    let revDateFilter  = `AND strftime('%Y', pr.revenue_date) = '${y}'`

    if (selectedMonths !== null && all_months !== 'true') {
      const inList = selectedMonths.join(',')
      costDateFilter += ` AND CAST(strftime('%m', pc.cost_date) AS INTEGER) IN (${inList})`
      revDateFilter  += ` AND CAST(strftime('%m', pr.revenue_date) AS INTEGER) IN (${inList})`
    }
    // For all_months=true: keep year-only filter (no month restriction)

    // ── Step 1: Labor cost — SUM from project_labor_costs ──────────
    // Build labor WHERE: always filter by project + year, add month IN clause when not all-months
    let laborWhere = `WHERE plc.project_id = ? AND plc.year = ?`
    const laborParams: any[] = [projectId, yInt]
    if (selectedMonths !== null && all_months !== 'true') {
      laborWhere += ` AND plc.month IN (${selectedMonths.join(',')})`
    }
    // For all_months=true: no month filter → SUM all months in the year

    const laborRow = await db.prepare(
      `SELECT SUM(plc.total_labor_cost) as total_lc,
              SUM(plc.total_hours)      as total_hrs,
              AVG(plc.cost_per_hour)    as avg_cph,
              COUNT(DISTINCT plc.month) as m_cnt
       FROM project_labor_costs plc ${laborWhere}`
    ).bind(...laborParams).first() as any

    let laborCost   = laborRow?.total_lc || 0
    let laborHours  = laborRow?.total_hrs || 0
    let laborPerHour = laborRow?.avg_cph || 0
    let laborMonthsCount = laborRow?.m_cnt || 0
    let laborSource = laborCost > 0 ? 'project_labor_costs' : 'none'

    // ── Fallback: real-time calculation when no cached data ─────────
    // Must loop over EACH month in the selected range and accumulate
    if (laborCost === 0) {
      const monthsToCalc: number[] = selectedMonths !== null
        ? selectedMonths                          // single or multi
        : Array.from({ length: 12 }, (_, i) => i + 1)  // all 12 months for all_months

      let rtLaborCost = 0; let rtHours = 0; let rtCphSum = 0; let rtMonths = 0

      for (const mInt of monthsToCalc) {
        const m = String(mInt).padStart(2, '0')
        const { costPerHour } = await computeMonthLaborCost(db, mInt, yInt)
        const phRow = await db.prepare(
          `SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as total
           FROM timesheets
           WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
        ).bind(projectId, y, m).first() as any
        const hrs = phRow?.total || 0
        if (hrs > 0) {
          const mc = Math.round(hrs * costPerHour)
          rtLaborCost += mc; rtHours += hrs; rtCphSum += costPerHour; rtMonths++
        }
      }

      if (rtLaborCost > 0) {
        laborCost = rtLaborCost
        laborHours = rtHours
        laborPerHour = rtMonths > 0 ? rtCphSum / rtMonths : 0
        laborMonthsCount = rtMonths
        laborSource = 'realtime'
      }
    }

    // ── Validate labor cost cap ─────────────────────────────────────
    const validation_warnings: string[] = []
    if (contractValue > 0 && laborCost > contractValue) {
      validation_warnings.push(`Chi phí lương (${fmtNum(laborCost)} ₫) vượt giá trị hợp đồng`)
      laborCost = contractValue
    }

    // ── Step 2: Other costs (project_costs, exclude salary) ─────────
    const otherRows = await db.prepare(`
      SELECT pc.cost_type, SUM(pc.amount) as total_amount
      FROM project_costs pc
      WHERE pc.project_id = ? ${costDateFilter} AND pc.cost_type != 'salary'
      GROUP BY pc.cost_type ORDER BY total_amount DESC
    `).bind(projectId).all()

    const otherCostArr = otherRows.results as any[]
    const totalOtherCosts = otherCostArr.reduce((s, r) => s + (r.total_amount || 0), 0)

    // ── Step 3: Revenue ─────────────────────────────────────────────
    const revRow = await db.prepare(`
      SELECT SUM(pr.amount) as total FROM project_revenues pr
      WHERE pr.project_id = ? ${revDateFilter}
    `).bind(projectId).first() as any
    const revenue = revRow?.total || 0

    // ── Totals & profit ─────────────────────────────────────────────
    const totalCosts = laborCost + totalOtherCosts
    const revenueBase = revenue > 0 ? revenue : contractValue
    const profit = revenueBase - totalCosts
    const profitMargin = revenueBase > 0 ? parseFloat(((profit / revenueBase) * 100).toFixed(1)) : null

    // Validation warnings
    if (contractValue > 0 && totalCosts > contractValue * 1.2)
      validation_warnings.push(`Tổng chi phí vượt 120% giá trị hợp đồng`)
    if (revenueBase > 0 && profit <= 0) validation_warnings.push(`Lợi nhuận âm: ${fmtNum(profit)} ₫`)
    else if (profitMargin !== null && profitMargin > 0 && profitMargin < 10) validation_warnings.push(`Lợi nhuận thấp: ${profitMargin}% (< 10%)`)
    if (revenueBase > 0 && laborCost > revenueBase * 0.8) validation_warnings.push(`Chi phí lương chiếm ${((laborCost/revenueBase)*100).toFixed(1)}% doanh thu (> 80%)`)

    const costTypeNames: Record<string, string> = { material:'Vật liệu', equipment:'Thiết bị', transport:'Vận chuyển', other:'Chi phí khác', salary:'Lương nhân sự' }

    const costBreakdown = [
      { type: 'Lương nhân sự', cost_type: 'salary', amount: laborCost,
        percentage: totalCosts > 0 ? parseFloat(((laborCost/totalCosts)*100).toFixed(1)) : 0,
        source: laborSource, is_auto: true,
        details: { total_hours: laborHours, cost_per_hour: Math.round(laborPerHour), months_count: laborMonthsCount }
      },
      ...otherCostArr.map(r => ({
        type: costTypeNames[r.cost_type] || r.cost_type, cost_type: r.cost_type,
        amount: r.total_amount, is_auto: false,
        percentage: totalCosts > 0 ? parseFloat(((r.total_amount/totalCosts)*100).toFixed(1)) : 0,
        source: 'project_costs'
      }))
    ]

    return c.json({
      project: { id: projectId, code: proj.code, name: proj.name, contract_value: contractValue },
      period: { type: periodType, label: periodLabel, year: yInt,
        selected_months: selectedMonths,
        months_count: laborMonthsCount },
      financial: {
        revenue: { value: revenueBase, month_revenue: revenue, contract_value: contractValue,
          label: revenue > 0 ? 'Doanh thu thực thu' : 'Giá trị hợp đồng' },
        costs: {
          labor: { value: laborCost, label: 'Chi phí lương', source: laborSource,
            synced_from: laborSource === 'project_labor_costs' ? 'Chi Phí Lương (đã đồng bộ)' : 'Tính real-time từ timesheet',
            details: { total_hours: laborHours, cost_per_hour: Math.round(laborPerHour),
              months_count: laborMonthsCount,
              formula: laborHours > 0
                ? `${laborHours}h × ${Math.round(laborPerHour).toLocaleString('vi-VN')} ₫/h`
                : `Tổng ${laborMonthsCount} tháng` } },
          other: { value: totalOtherCosts, label: 'Chi phí khác', breakdown: otherCostArr, source: 'project_costs' },
          total: { value: totalCosts, label: 'Tổng chi phí' }
        },
        profit: { value: profit, percentage: profitMargin, label: 'Lợi nhuận' }
      },
      cost_breakdown: costBreakdown,
      data_sync: {
        labor_synced_from: laborSource === 'project_labor_costs' ? 'Chi Phí Lương (project_labor_costs)' : 'Real-time calculation',
        last_updated: new Date().toISOString()
      },
      validation: { warnings: validation_warnings, has_warnings: validation_warnings.length > 0,
        profit_status: profit > 0 ? (profitMargin !== null && profitMargin < 10 ? 'warning' : 'ok') : 'error' }
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/projects/:id/costs-summary?month=MM&year=YYYY
// Tóm tắt tài chính: doanh thu thực tế + chi phí lương (auto từ timesheet) + chi phí khác
// Nguồn dữ liệu chuẩn: labor từ project_labor_costs (nếu có) hoặc tính real-time, other từ project_costs
app.get('/api/projects/:id/costs-summary', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const projectId = parseInt(c.req.param('id'))
    const { month, year } = c.req.query()
    const m = (month || String(new Date().getMonth() + 1)).padStart(2, '0')
    const y = year || String(new Date().getFullYear())
    const mInt = parseInt(m)
    const yInt = parseInt(y)

    const proj = await db.prepare('SELECT id, code, name, contract_value FROM projects WHERE id = ?').bind(projectId).first() as any
    if (!proj) return c.json({ error: 'Project not found' }, 404)

    const contractValue = proj.contract_value || 0
    const validation_warnings: string[] = []

    // --- Chi phí lương: ưu tiên project_labor_costs, fallback tính real-time ---
    const cachedLabor = await db.prepare(
      `SELECT total_labor_cost, total_hours, cost_per_hour FROM project_labor_costs
       WHERE project_id = ? AND month = ? AND year = ?`
    ).bind(projectId, mInt, yInt).first() as any

    let laborCost: number, projectHrs: number, costPerHourFinal: number, laborSource: string
    if (cachedLabor) {
      laborCost = cachedLabor.total_labor_cost
      projectHrs = cachedLabor.total_hours
      costPerHourFinal = cachedLabor.cost_per_hour
      laborSource = 'project_labor_costs'
    } else {
      // Real-time từ monthly_labor_costs / salary_pool + timesheets
      const { laborCostSource, totalHrs, costPerHour } = await computeMonthLaborCost(db, mInt, yInt)
      const projHours = await db.prepare(
        `SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as total
         FROM timesheets WHERE project_id = ?
         AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
      ).bind(projectId, y, m).first() as any
      projectHrs = projHours?.total || 0
      costPerHourFinal = costPerHour
      laborCost = Math.round(projectHrs * costPerHour)
      laborSource = 'realtime'
    }

    // Validation: labor cost > contract value
    if (contractValue > 0 && laborCost > contractValue) {
      validation_warnings.push(`Chi phí lương (${fmtNum(laborCost)} ₫) vượt giá trị hợp đồng (${fmtNum(contractValue)} ₫)`)
      laborCost = contractValue // Cap tại contract value
    }

    // --- Chi phí khác (project_costs, không tính loại 'salary') ---
    const otherCostsByType = await db.prepare(`
      SELECT pc.cost_type, SUM(pc.amount) as total_amount
      FROM project_costs pc
      WHERE pc.project_id = ?
        AND pc.cost_type != 'salary'
        AND strftime('%Y', pc.cost_date) = ?
        AND strftime('%m', pc.cost_date) = ?
      GROUP BY pc.cost_type
      ORDER BY total_amount DESC
    `).bind(projectId, y, m).all()

    const otherCostRows = otherCostsByType.results as any[]
    const totalOtherCosts = otherCostRows.reduce((s, r) => s + (r.total_amount || 0), 0)
    const totalCosts = laborCost + totalOtherCosts

    // Validation: total cost > 120% contract value
    if (contractValue > 0 && totalCosts > contractValue * 1.2) {
      validation_warnings.push(`Tổng chi phí (${fmtNum(totalCosts)} ₫) vượt 120% giá trị hợp đồng (${fmtNum(contractValue * 1.2)} ₫)`)
    }

    // --- Doanh thu thực tế trong tháng ---
    const revenueMonth = await db.prepare(
      `SELECT SUM(amount) as total FROM project_revenues
       WHERE project_id = ?
       AND strftime('%Y', revenue_date) = ? AND strftime('%m', revenue_date) = ?`
    ).bind(projectId, y, m).first() as any
    const monthRevenue = revenueMonth?.total || 0

    const profit = monthRevenue - totalCosts
    const profitMargin = monthRevenue > 0 ? parseFloat(((profit / monthRevenue) * 100).toFixed(1)) : null

    // Validation rules on profit
    if (monthRevenue > 0 && profit <= 0) {
      validation_warnings.push(`Lợi nhuận âm: ${fmtNum(profit)} ₫`)
    } else if (profitMargin !== null && profitMargin > 0 && profitMargin < 10) {
      validation_warnings.push(`Lợi nhuận thấp: ${profitMargin}% (ngưỡng cảnh báo < 10%)`)
    }
    if (monthRevenue > 0 && laborCost > monthRevenue * 0.8) {
      validation_warnings.push(`Chi phí lương chiếm ${((laborCost/monthRevenue)*100).toFixed(1)}% doanh thu (> 80%)`)
    }

    // Cost type name mapping
    const costTypeNames: Record<string, string> = {
      material: 'Vật liệu', equipment: 'Thiết bị', transport: 'Vận chuyển',
      other: 'Chi phí khác', salary: 'Lương nhân sự'
    }

    const breakdown = [
      { type: 'Lương nhân sự', cost_type: 'salary', amount: laborCost,
        hours: projectHrs, cost_per_hour: Math.round(costPerHourFinal), is_auto: true,
        pct: totalCosts > 0 ? parseFloat(((laborCost / totalCosts) * 100).toFixed(1)) : 0 },
      ...otherCostRows.map(r => ({
        type: costTypeNames[r.cost_type] || r.cost_type,
        cost_type: r.cost_type,
        amount: r.total_amount,
        is_auto: false,
        pct: totalCosts > 0 ? parseFloat(((r.total_amount / totalCosts) * 100).toFixed(1)) : 0
      }))
    ]

    return c.json({
      project_id: projectId,
      project_code: proj.code,
      project_name: proj.name,
      month: mInt,
      year: yInt,
      period: `${y}-${m}`,
      revenue: {
        month_revenue: monthRevenue,
        contract_value: contractValue
      },
      costs: {
        labor_cost: laborCost,
        labor_cost_source: laborSource,
        labor_cost_details: {
          total_hours: projectHrs,
          cost_per_hour: Math.round(costPerHourFinal),
          cost_source: laborSource
        },
        other_costs: otherCostRows,
        total_other_costs: totalOtherCosts,
        total_costs: totalCosts,
        breakdown
      },
      profit: {
        profit,
        profit_margin: profitMargin
      },
      validation: {
        warnings: validation_warnings,
        has_warnings: validation_warnings.length > 0,
        profit_status: profit > 0 ? (profitMargin !== null && profitMargin < 10 ? 'warning' : 'ok') : 'error'
      }
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/costs/duplicates — tìm bản ghi trùng trong project_costs
app.get('/api/costs/duplicates', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const dups = await db.prepare(`
      SELECT project_id, cost_type, cost_date,
        COUNT(*) as duplicate_count,
        GROUP_CONCAT(id) as ids,
        SUM(amount) as total_amount
      FROM project_costs
      GROUP BY project_id, cost_type, cost_date
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC
    `).all()

    const revDups = await db.prepare(`
      SELECT project_id, revenue_date, description,
        COUNT(*) as duplicate_count,
        GROUP_CONCAT(id) as ids,
        SUM(amount) as total_amount
      FROM project_revenues
      GROUP BY project_id, revenue_date, description
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC
    `).all()

    // Enrich with project names
    const projects = await db.prepare('SELECT id, code, name FROM projects').all()
    const projMap: Record<number, any> = {}
    ;(projects.results as any[]).forEach(p => { projMap[p.id] = p })

    const enriched = (dups.results as any[]).map(d => ({
      ...d,
      project_code: projMap[d.project_id]?.code || '',
      project_name: projMap[d.project_id]?.name || ''
    }))
    const enrichedRev = (revDups.results as any[]).map(d => ({
      ...d,
      project_code: projMap[d.project_id]?.code || '',
      project_name: projMap[d.project_id]?.name || ''
    }))

    return c.json({
      project_costs_duplicates: enriched,
      revenue_duplicates: enrichedRev,
      total_duplicate_groups: enriched.length + enrichedRev.length
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/costs/cleanup-duplicates — xóa trùng lặp, giữ bản ghi MIN(id)
app.post('/api/costs/cleanup-duplicates', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB

    // Xóa project_costs trùng (giữ MIN id)
    const delCosts = await db.prepare(`
      DELETE FROM project_costs
      WHERE id NOT IN (
        SELECT MIN(id) FROM project_costs
        GROUP BY project_id, cost_type, cost_date
      )
    `).run()

    // Xóa project_revenues trùng (giữ MIN id)
    const delRevs = await db.prepare(`
      DELETE FROM project_revenues
      WHERE id NOT IN (
        SELECT MIN(id) FROM project_revenues
        GROUP BY project_id, revenue_date, description
      )
    `).run()

    // Kiểm tra còn sót không
    const remaining = await db.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT project_id, cost_type, cost_date FROM project_costs
        GROUP BY project_id, cost_type, cost_date HAVING COUNT(*) > 1
      )
    `).first() as any

    return c.json({
      success: true,
      project_costs_deleted: delCosts.meta?.changes || 0,
      revenue_deleted: delRevs.meta?.changes || 0,
      remaining_duplicate_groups: remaining?.cnt || 0
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/data-cleanup/project-costs-duplicates
// Dedicated cleanup endpoint keeping MAX(id) (newest record) per group
// Provides detailed before/after report for the Chi Phí & Doanh Thu page
app.post('/api/data-cleanup/project-costs-duplicates', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB

    // Count before cleanup
    const beforeCosts = await db.prepare(
      `SELECT COUNT(*) as cnt FROM project_costs`
    ).first() as any
    const beforeRevs = await db.prepare(
      `SELECT COUNT(*) as cnt FROM project_revenues`
    ).first() as any
    const beforeLaborCosts = await db.prepare(
      `SELECT COUNT(*) as cnt FROM project_labor_costs`
    ).first() as any

    // Count duplicate groups before
    const dupCostGroups = await db.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT project_id, cost_type, cost_date FROM project_costs
        GROUP BY project_id, cost_type, cost_date HAVING COUNT(*) > 1
      )
    `).first() as any
    const dupRevGroups = await db.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT project_id, revenue_date, description FROM project_revenues
        GROUP BY project_id, revenue_date, description HAVING COUNT(*) > 1
      )
    `).first() as any
    const dupLaborGroups = await db.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT project_id, month, year FROM project_labor_costs
        GROUP BY project_id, month, year HAVING COUNT(*) > 1
      )
    `).first() as any

    // Delete project_costs duplicates — keep MAX(id) (newest)
    const delCosts = await db.prepare(`
      DELETE FROM project_costs
      WHERE id NOT IN (
        SELECT MAX(id) FROM project_costs
        GROUP BY project_id, cost_type, cost_date
      )
    `).run()

    // Delete project_revenues duplicates — keep MAX(id) (newest)
    const delRevs = await db.prepare(`
      DELETE FROM project_revenues
      WHERE id NOT IN (
        SELECT MAX(id) FROM project_revenues
        GROUP BY project_id, revenue_date, description
      )
    `).run()

    // Delete project_labor_costs duplicates — keep MAX(id) (newest)
    const delLabor = await db.prepare(`
      DELETE FROM project_labor_costs
      WHERE id NOT IN (
        SELECT MAX(id) FROM project_labor_costs
        GROUP BY project_id, month, year
      )
    `).run()

    // Count after cleanup
    const afterCosts = await db.prepare(
      `SELECT COUNT(*) as cnt FROM project_costs`
    ).first() as any
    const afterRevs = await db.prepare(
      `SELECT COUNT(*) as cnt FROM project_revenues`
    ).first() as any
    const afterLaborCosts = await db.prepare(
      `SELECT COUNT(*) as cnt FROM project_labor_costs`
    ).first() as any

    // Verify no duplicates remain
    const remainingDupCosts = await db.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT project_id, cost_type, cost_date FROM project_costs
        GROUP BY project_id, cost_type, cost_date HAVING COUNT(*) > 1
      )
    `).first() as any
    const remainingDupRevs = await db.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT project_id, revenue_date, description FROM project_revenues
        GROUP BY project_id, revenue_date, description HAVING COUNT(*) > 1
      )
    `).first() as any

    const totalDeleted = (delCosts.meta?.changes || 0) + (delRevs.meta?.changes || 0) + (delLabor.meta?.changes || 0)

    return c.json({
      success: true,
      summary: {
        total_deleted: totalDeleted,
        project_costs_deleted: delCosts.meta?.changes || 0,
        revenue_deleted: delRevs.meta?.changes || 0,
        labor_costs_deleted: delLabor.meta?.changes || 0,
      },
      before: {
        project_costs: beforeCosts?.cnt || 0,
        project_revenues: beforeRevs?.cnt || 0,
        project_labor_costs: beforeLaborCosts?.cnt || 0,
        duplicate_cost_groups: dupCostGroups?.cnt || 0,
        duplicate_revenue_groups: dupRevGroups?.cnt || 0,
        duplicate_labor_groups: dupLaborGroups?.cnt || 0,
      },
      after: {
        project_costs: afterCosts?.cnt || 0,
        project_revenues: afterRevs?.cnt || 0,
        project_labor_costs: afterLaborCosts?.cnt || 0,
        remaining_duplicate_cost_groups: remainingDupCosts?.cnt || 0,
        remaining_duplicate_revenue_groups: remainingDupRevs?.cnt || 0,
      },
      message: totalDeleted > 0
        ? `Đã xóa ${totalDeleted} bản ghi trùng lặp (CP: ${delCosts.meta?.changes || 0}, DT: ${delRevs.meta?.changes || 0}, Lương: ${delLabor.meta?.changes || 0})`
        : 'Không có bản ghi trùng lặp cần xóa'
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/data-cleanup/project-costs-duplicates — check duplicates count
app.get('/api/data-cleanup/project-costs-duplicates', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB

    const dupCosts = await db.prepare(`
      SELECT pc.project_id, p.code as project_code, pc.cost_type, pc.cost_date,
             COUNT(*) as duplicate_count, SUM(pc.amount) as total_amount,
             GROUP_CONCAT(pc.id) as ids
      FROM project_costs pc
      LEFT JOIN projects p ON p.id = pc.project_id
      GROUP BY pc.project_id, pc.cost_type, pc.cost_date
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC
    `).all()

    const dupRevs = await db.prepare(`
      SELECT pr.project_id, p.code as project_code, pr.description, pr.revenue_date,
             COUNT(*) as duplicate_count, SUM(pr.amount) as total_amount,
             GROUP_CONCAT(pr.id) as ids
      FROM project_revenues pr
      LEFT JOIN projects p ON p.id = pr.project_id
      GROUP BY pr.project_id, pr.revenue_date, pr.description
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC
    `).all()

    const dupLabor = await db.prepare(`
      SELECT plc.project_id, p.code as project_code, plc.month, plc.year,
             COUNT(*) as duplicate_count,
             GROUP_CONCAT(plc.id) as ids
      FROM project_labor_costs plc
      LEFT JOIN projects p ON p.id = plc.project_id
      GROUP BY plc.project_id, plc.month, plc.year
      HAVING COUNT(*) > 1
    `).all()

    const totalGroups = (dupCosts.results?.length || 0) + (dupRevs.results?.length || 0) + (dupLabor.results?.length || 0)

    return c.json({
      total_duplicate_groups: totalGroups,
      has_duplicates: totalGroups > 0,
      project_costs_duplicates: dupCosts.results || [],
      revenue_duplicates: dupRevs.results || [],
      labor_cost_duplicates: dupLabor.results || [],
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ===================================================
// DATA AUDIT & CONSISTENCY CHECK
// ===================================================

// Helper: compute labor cost for a month/year (reusable)
async function computeMonthLaborCost(db: any, mInt: number, yInt: number) {
  const m = String(mInt).padStart(2, '0')
  const y = String(yInt)
  const manualEntry = await db.prepare(
    `SELECT total_labor_cost, notes FROM monthly_labor_costs WHERE month = ? AND year = ?`
  ).bind(mInt, yInt).first() as any
  const salaryPool = await db.prepare(
    `SELECT SUM(salary_monthly) as total FROM users WHERE is_active = 1 AND role != 'system_admin'`
  ).first() as any
  const totalHoursRow = await db.prepare(
    `SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as total FROM timesheets
     WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
  ).bind(y, m).first() as any
  const laborCostSource = manualEntry ? manualEntry.total_labor_cost : (salaryPool?.total || 0)
  const totalHrs = totalHoursRow?.total || 0
  const costPerHour = totalHrs > 0 ? laborCostSource / totalHrs : 0
  return { laborCostSource, totalHrs, costPerHour, isManual: !!manualEntry, notes: manualEntry?.notes || '' }
}

// GET /api/data-audit/consistency-check
// Full diagnostic: duplicates, labor cost > contract, missing records
app.get('/api/data-audit/consistency-check', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { month, year } = c.req.query()
    const mInt = month ? parseInt(month) : new Date().getMonth() + 1
    const yInt = year ? parseInt(year) : new Date().getFullYear()
    const m = String(mInt).padStart(2, '0')
    const y = String(yInt)

    const errors: any[] = []
    const warnings: any[] = []

    // --- 1. Duplicate checks ---
    const costDups = await db.prepare(`
      SELECT project_id, cost_type, cost_date, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
      FROM project_costs GROUP BY project_id, cost_type, cost_date HAVING cnt > 1
    `).all()
    const revDups = await db.prepare(`
      SELECT project_id, revenue_date, description, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
      FROM project_revenues GROUP BY project_id, revenue_date, description HAVING cnt > 1
    `).all()
    const laborDups = await db.prepare(`
      SELECT project_id, month, year, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
      FROM project_labor_costs GROUP BY project_id, month, year HAVING cnt > 1
    `).all()
    const tsDups = await db.prepare(`
      SELECT user_id, project_id, work_date, COUNT(*) as cnt
      FROM timesheets GROUP BY user_id, project_id, work_date HAVING cnt > 1
    `).all()

    if ((costDups.results as any[]).length > 0)
      errors.push({ code: 'DUPLICATE_COSTS', message: `${(costDups.results as any[]).length} nhóm bản ghi trùng trong project_costs`, detail: costDups.results })
    if ((revDups.results as any[]).length > 0)
      errors.push({ code: 'DUPLICATE_REVENUES', message: `${(revDups.results as any[]).length} nhóm bản ghi trùng trong project_revenues`, detail: revDups.results })
    if ((laborDups.results as any[]).length > 0)
      errors.push({ code: 'DUPLICATE_LABOR_COSTS', message: `${(laborDups.results as any[]).length} nhóm bản ghi trùng trong project_labor_costs`, detail: laborDups.results })
    if ((tsDups.results as any[]).length > 0)
      errors.push({ code: 'DUPLICATE_TIMESHEETS', message: `${(tsDups.results as any[]).length} nhóm timesheet trùng`, detail: tsDups.results })

    // --- 2. Projects financial validation ---
    const projects = await db.prepare(
      `SELECT id, code, name, contract_value, status FROM projects WHERE status != 'cancelled'`
    ).all()

    const { laborCostSource, totalHrs, costPerHour } = await computeMonthLaborCost(db, mInt, yInt)

    for (const proj of projects.results as any[]) {
      const contractVal = proj.contract_value || 0

      // Get project hours for the month
      const projHrs = await db.prepare(
        `SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as total FROM timesheets
         WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
      ).bind(proj.id, y, m).first() as any

      const laborCost = Math.round((projHrs?.total || 0) * costPerHour)

      // Other costs
      const otherRow = await db.prepare(
        `SELECT SUM(amount) as total FROM project_costs
         WHERE project_id = ? AND cost_type != 'salary'
         AND strftime('%Y', cost_date) = ? AND strftime('%m', cost_date) = ?`
      ).bind(proj.id, y, m).first() as any
      const otherCosts = otherRow?.total || 0
      const totalCosts = laborCost + otherCosts

      // Revenue for the month
      const revRow = await db.prepare(
        `SELECT SUM(amount) as total FROM project_revenues
         WHERE project_id = ? AND strftime('%Y', revenue_date) = ? AND strftime('%m', revenue_date) = ?`
      ).bind(proj.id, y, m).first() as any
      const revenue = revRow?.total || 0

      const profit = revenue - totalCosts
      const profitMargin = revenue > 0 ? (profit / revenue) * 100 : null

      // Validation rules
      if (contractVal > 0 && laborCost > contractVal) {
        errors.push({
          code: 'LABOR_EXCEEDS_CONTRACT',
          message: `[${proj.code}] Chi phí lương (${fmtNum(laborCost)}) > Giá trị HĐ (${fmtNum(contractVal)})`,
          project_id: proj.id, project_code: proj.code, labor_cost: laborCost, contract_value: contractVal
        })
      }
      if (contractVal > 0 && totalCosts > contractVal * 1.2) {
        errors.push({
          code: 'TOTAL_COST_EXCEEDS_120PCT',
          message: `[${proj.code}] Tổng chi phí (${fmtNum(totalCosts)}) > 120% giá trị HĐ (${fmtNum(contractVal * 1.2)})`,
          project_id: proj.id, project_code: proj.code, total_costs: totalCosts, contract_value: contractVal
        })
      }
      if (revenue > 0 && profit <= 0) {
        errors.push({
          code: 'NEGATIVE_PROFIT',
          message: `[${proj.code}] Lợi nhuận âm: ${fmtNum(profit)} ₫`,
          project_id: proj.id, project_code: proj.code, profit, revenue
        })
      }
      if (revenue > 0 && profitMargin !== null && profitMargin > 0 && profitMargin < 10) {
        warnings.push({
          code: 'LOW_PROFIT_MARGIN',
          message: `[${proj.code}] Lợi nhuận thấp: ${profitMargin.toFixed(1)}% (< 10%)`,
          project_id: proj.id, project_code: proj.code, profit_margin: parseFloat(profitMargin.toFixed(1))
        })
      }
      if (revenue > 0 && profitMargin !== null && laborCost > 0 && laborCost > revenue * 0.8) {
        warnings.push({
          code: 'HIGH_LABOR_RATIO',
          message: `[${proj.code}] Chi phí lương chiếm ${((laborCost/revenue)*100).toFixed(1)}% doanh thu (> 80%)`,
          project_id: proj.id, project_code: proj.code, labor_cost: laborCost, revenue
        })
      }
    }

    // --- 3. Monthly labor cost sync check ---
    const monthlyEntry = await db.prepare(
      `SELECT * FROM monthly_labor_costs WHERE month = ? AND year = ?`
    ).bind(mInt, yInt).first() as any
    if (!monthlyEntry) {
      warnings.push({
        code: 'MISSING_MONTHLY_LABOR_COST',
        message: `Chưa nhập chi phí lương tháng ${mInt}/${yInt} — đang dùng quỹ lương tự động (${fmtNum(laborCostSource)})`,
        month: mInt, year: yInt
      })
    }

    // --- 4. Summary ---
    const summary = {
      month: mInt, year: yInt,
      total_errors: errors.length,
      total_warnings: warnings.length,
      duplicate_cost_groups: (costDups.results as any[]).length,
      duplicate_revenue_groups: (revDups.results as any[]).length,
      duplicate_labor_groups: (laborDups.results as any[]).length,
      duplicate_timesheet_groups: (tsDups.results as any[]).length,
      labor_cost_source: monthlyEntry ? 'manual' : 'salary_pool',
      company_labor_cost: laborCostSource,
      company_total_hours: totalHrs,
      cost_per_hour: Math.round(costPerHour),
      status: errors.length === 0 ? (warnings.length === 0 ? 'OK' : 'WARNING') : 'ERROR'
    }

    return c.json({ summary, errors, warnings })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// Helper number formatter for server-side messages
function fmtNum(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(n))
}

// POST /api/data-audit/fix-inconsistency
// Auto-fix: delete duplicates, cap excessive labor costs, create missing data
app.post('/api/data-audit/fix-inconsistency', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const body = await c.req.json().catch(() => ({})) as any
    const { month, year, actions = ['dedup_all', 'fix_labor', 'create_missing'] } = body
    const mInt = month ? parseInt(month) : new Date().getMonth() + 1
    const yInt = year ? parseInt(year) : new Date().getFullYear()

    const results: any = { actions_performed: [], rows_deleted: 0, rows_fixed: 0, rows_created: 0 }

    // Action 1: Deduplicate all tables
    if (actions.includes('dedup_all')) {
      const d1 = await db.prepare(`
        DELETE FROM project_costs WHERE id NOT IN (
          SELECT MIN(id) FROM project_costs GROUP BY project_id, cost_type, cost_date
        )
      `).run()
      const d2 = await db.prepare(`
        DELETE FROM project_revenues WHERE id NOT IN (
          SELECT MIN(id) FROM project_revenues GROUP BY project_id, revenue_date, description
        )
      `).run()
      const d3 = await db.prepare(`
        DELETE FROM project_labor_costs WHERE id NOT IN (
          SELECT MIN(id) FROM project_labor_costs GROUP BY project_id, month, year
        )
      `).run()
      const d4 = await db.prepare(`
        DELETE FROM timesheets WHERE id NOT IN (
          SELECT MIN(id) FROM timesheets GROUP BY user_id, project_id, work_date
        )
      `).run()
      const deleted = (d1.meta?.changes||0) + (d2.meta?.changes||0) + (d3.meta?.changes||0) + (d4.meta?.changes||0)
      results.rows_deleted += deleted
      results.actions_performed.push(`dedup_all: đã xóa ${deleted} bản ghi trùng (costs:${d1.meta?.changes||0}, revenues:${d2.meta?.changes||0}, labor:${d3.meta?.changes||0}, timesheets:${d4.meta?.changes||0})`)
    }

    // Action 2: Fix excessive labor costs in project_labor_costs
    if (actions.includes('fix_labor')) {
      const { laborCostSource, totalHrs, costPerHour } = await computeMonthLaborCost(db, mInt, yInt)
      const m = String(mInt).padStart(2, '0')
      const y = String(yInt)
      const projects = await db.prepare(`SELECT id, contract_value FROM projects WHERE status != 'cancelled'`).all()
      let fixed = 0
      for (const proj of projects.results as any[]) {
        const projHrs = await db.prepare(
          `SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as total FROM timesheets
           WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
        ).bind(proj.id, y, m).first() as any
        const correctLaborCost = Math.round((projHrs?.total || 0) * costPerHour)
        const contractVal = proj.contract_value || 0
        // Cap at contract value if exceeded
        const cappedLaborCost = contractVal > 0 && correctLaborCost > contractVal ? contractVal : correctLaborCost

        // Upsert into project_labor_costs
        const existing = await db.prepare(
          `SELECT id FROM project_labor_costs WHERE project_id = ? AND month = ? AND year = ?`
        ).bind(proj.id, mInt, yInt).first() as any

        if (existing) {
          await db.prepare(
            `UPDATE project_labor_costs SET total_labor_cost = ?, total_hours = ?, cost_per_hour = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).bind(cappedLaborCost, projHrs?.total || 0, Math.round(costPerHour), existing.id).run()
        } else if ((projHrs?.total || 0) > 0) {
          await db.prepare(
            `INSERT INTO project_labor_costs (project_id, month, year, total_labor_cost, total_hours, cost_per_hour)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(proj.id, mInt, yInt, cappedLaborCost, projHrs?.total || 0, Math.round(costPerHour)).run()
          results.rows_created++
        }
        fixed++
      }
      results.rows_fixed += fixed
      results.actions_performed.push(`fix_labor: đã sync ${fixed} dự án với chi phí lương đúng cho tháng ${mInt}/${yInt}`)
    }

    // Action 3: Create missing monthly_labor_costs from salary pool
    if (actions.includes('create_missing')) {
      const existing = await db.prepare(
        `SELECT id FROM monthly_labor_costs WHERE month = ? AND year = ?`
      ).bind(mInt, yInt).first() as any
      if (!existing) {
        const salaryPool = await db.prepare(
          `SELECT SUM(salary_monthly) as total FROM users WHERE is_active = 1 AND role != 'system_admin'`
        ).first() as any
        const poolTotal = salaryPool?.total || 0
        if (poolTotal > 0) {
          await db.prepare(
            `INSERT INTO monthly_labor_costs (month, year, total_labor_cost, notes) VALUES (?, ?, ?, ?)`
          ).bind(mInt, yInt, poolTotal, 'Tự động tạo từ quỹ lương (fix-inconsistency)').run()
          results.rows_created++
          results.actions_performed.push(`create_missing: tạo monthly_labor_costs tháng ${mInt}/${yInt} = ${fmtNum(poolTotal)} ₫ (từ quỹ lương)`)
        }
      } else {
        results.actions_performed.push(`create_missing: monthly_labor_costs tháng ${mInt}/${yInt} đã tồn tại`)
      }
    }

    // Final consistency re-check
    const remainingDups = await db.prepare(`
      SELECT (SELECT COUNT(*) FROM (SELECT project_id,cost_type,cost_date FROM project_costs GROUP BY project_id,cost_type,cost_date HAVING COUNT(*)>1))
           + (SELECT COUNT(*) FROM (SELECT project_id,revenue_date,description FROM project_revenues GROUP BY project_id,revenue_date,description HAVING COUNT(*)>1))
           + (SELECT COUNT(*) FROM (SELECT user_id,project_id,work_date FROM timesheets GROUP BY user_id,project_id,work_date HAVING COUNT(*)>1))
           as total
    `).first() as any

    return c.json({
      success: true,
      month: mInt, year: yInt,
      ...results,
      remaining_duplicate_groups: remainingDups?.total || 0,
      message: `Đã thực hiện ${results.actions_performed.length} hành động. Xóa ${results.rows_deleted} bản ghi trùng, sửa ${results.rows_fixed} dự án, tạo ${results.rows_created} bản ghi mới.`
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ===================================================
// ASSETS ROUTES (Admin Only)
// ===================================================
app.get('/api/assets', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { category, status, department } = c.req.query()

    let query = `
      SELECT a.*, u.full_name as assigned_to_name, u.department as user_department
      FROM assets a
      LEFT JOIN users u ON a.assigned_to = u.id
      WHERE 1=1
    `
    const params: any[] = []
    if (category) { query += ` AND a.category = ?`; params.push(category) }
    if (status) { query += ` AND a.status = ?`; params.push(status) }
    if (department) { query += ` AND a.department = ?`; params.push(department) }
    query += ' ORDER BY a.asset_code ASC'

    const result = await db.prepare(query).bind(...params).all()
    return c.json(result.results)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/assets', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const data = await c.req.json()
    const { asset_code, name, category, brand, model, serial_number, specifications, purchase_date, purchase_price, current_value, warranty_expiry, status, location, department, assigned_to, notes } = data

    if (!asset_code || !name || !category) return c.json({ error: 'Missing required fields' }, 400)

    const result = await db.prepare(
      `INSERT INTO assets (asset_code, name, category, brand, model, serial_number, specifications, purchase_date, purchase_price, current_value, warranty_expiry, status, location, department, assigned_to, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(asset_code, name, category, brand || null, model || null, serial_number || null,
      specifications || null, purchase_date || null, purchase_price || 0, current_value || 0,
      warranty_expiry || null, status || 'active', location || null, department || null,
      assigned_to || null, notes || null, user.id).run()

    return c.json({ success: true, id: result.meta.last_row_id }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.put('/api/assets/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    const data = await c.req.json()
    const fields = ['name', 'category', 'brand', 'model', 'serial_number', 'specifications', 'purchase_date', 'purchase_price', 'current_value', 'warranty_expiry', 'status', 'location', 'department', 'assigned_to', 'notes']
    const updates = fields.filter(f => data[f] !== undefined).map(f => `${f} = ?`)
    const values = fields.filter(f => data[f] !== undefined).map(f => data[f])
    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)
    await db.prepare(`UPDATE assets SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.delete('/api/assets/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    await db.prepare('DELETE FROM assets WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// NOTIFICATIONS ROUTES
// ===================================================
app.get('/api/notifications', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const notifications = await db.prepare(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    ).bind(user.id).all()
    return c.json(notifications.results)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.patch('/api/notifications/:id/read', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.patch('/api/notifications/read-all', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(user.id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// REPORTS & DASHBOARD ROUTES
// ===================================================
app.get('/api/dashboard/stats', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any

    const totalProjects = await db.prepare('SELECT COUNT(*) as count FROM projects WHERE status != "cancelled"').first() as any
    const activeProjects = await db.prepare('SELECT COUNT(*) as count FROM projects WHERE status = "active"').first() as any
    const totalTasks = await db.prepare('SELECT COUNT(*) as count FROM tasks WHERE status != "cancelled"').first() as any
    const completedTasks = await db.prepare('SELECT COUNT(*) as count FROM tasks WHERE status = "completed"').first() as any
    const overdueTasks = await db.prepare('SELECT COUNT(*) as count FROM tasks WHERE due_date < date("now") AND status != "completed" AND status != "cancelled"').first() as any
    const totalUsers = await db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').first() as any
    const totalAssets = await db.prepare('SELECT COUNT(*) as count FROM assets WHERE status = "active"').first() as any

    // Monthly timesheet summary
    const monthlyHours = await db.prepare(`
      SELECT strftime('%Y-%m', work_date) as month,
        SUM(regular_hours) as regular, SUM(overtime_hours) as overtime,
        COUNT(DISTINCT user_id) as active_users
      FROM timesheets
      WHERE work_date >= date('now', '-6 months')
      GROUP BY month ORDER BY month ASC
    `).all()

    // Project progress summary
    const projectProgress = await db.prepare(`
      SELECT p.id, p.code, p.name, p.status, p.start_date, p.end_date,
        COUNT(t.id) as total_tasks,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
        SUM(CASE WHEN t.due_date < date('now') AND t.status != 'completed' THEN 1 ELSE 0 END) as overdue_tasks
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id
      WHERE p.status != 'cancelled'
      GROUP BY p.id
      ORDER BY p.start_date DESC
      LIMIT 10
    `).all()

    // Discipline breakdown
    const disciplineBreakdown = await db.prepare(`
      SELECT discipline_code, COUNT(*) as count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM tasks
      WHERE discipline_code IS NOT NULL
      GROUP BY discipline_code
      ORDER BY count DESC
    `).all()

    // Member productivity — use subqueries to avoid Cartesian product between tasks and timesheets
    const memberProductivity = await db.prepare(`
      SELECT u.id, u.full_name, u.department,
        COALESCE(tsk.total_tasks, 0)     AS total_tasks,
        COALESCE(tsk.completed_tasks, 0) AS completed_tasks,
        COALESCE(ts.total_hours, 0)      AS total_hours
      FROM users u
      LEFT JOIN (
        SELECT assigned_to,
          COUNT(DISTINCT id)                                              AS total_tasks,
          COUNT(DISTINCT CASE WHEN status = 'completed' THEN id END)     AS completed_tasks
        FROM tasks
        GROUP BY assigned_to
      ) tsk ON tsk.assigned_to = u.id
      LEFT JOIN (
        SELECT user_id,
          SUM(regular_hours + overtime_hours) AS total_hours
        FROM timesheets
        WHERE work_date >= date('now', '-30 days')
        GROUP BY user_id
      ) ts ON ts.user_id = u.id
      WHERE u.is_active = 1 AND u.role NOT IN ('system_admin')
      ORDER BY total_hours DESC
    `).all()

    return c.json({
      stats: {
        total_projects: totalProjects?.count || 0,
        active_projects: activeProjects?.count || 0,
        total_tasks: totalTasks?.count || 0,
        completed_tasks: completedTasks?.count || 0,
        overdue_tasks: overdueTasks?.count || 0,
        total_users: totalUsers?.count || 0,
        total_assets: totalAssets?.count || 0,
        completion_rate: totalTasks?.count > 0 ? Math.round((completedTasks?.count / totalTasks?.count) * 100) : 0
      },
      monthly_hours: monthlyHours.results,
      project_progress: projectProgress.results,
      discipline_breakdown: disciplineBreakdown.results,
      member_productivity: memberProductivity.results
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.get('/api/dashboard/cost-summary', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { year } = c.req.query()
    const currentYear = year || new Date().getFullYear().toString()

    const revenueByProject = await db.prepare(`
      SELECT p.id, p.code, p.name, p.contract_value,
        COALESCE(SUM(pr.amount), 0) as total_revenue
      FROM projects p
      LEFT JOIN project_revenues pr ON pr.project_id = p.id
        AND strftime('%Y', pr.revenue_date) = ?
      WHERE p.status != 'cancelled'
      GROUP BY p.id ORDER BY total_revenue DESC
    `).bind(currentYear).all()

    // Other costs from project_costs (excluding salary type — covered by project_labor_costs)
    const costByProject = await db.prepare(`
      SELECT p.id, p.code, p.name,
        COALESCE(SUM(pc.amount), 0) as total_cost,
        pc.cost_type
      FROM projects p
      LEFT JOIN project_costs pc ON pc.project_id = p.id
        AND strftime('%Y', pc.cost_date) = ?
        AND pc.cost_type != 'salary'
      WHERE p.status != 'cancelled'
      GROUP BY p.id, pc.cost_type
    `).bind(currentYear).all()

    // Labor costs from project_labor_costs — SUM all months for the year per project
    const laborByProject = await db.prepare(`
      SELECT p.id, p.code, p.name,
        COALESCE(SUM(plc.total_labor_cost), 0) as labor_cost,
        COALESCE(SUM(plc.total_hours), 0) as total_hours,
        COUNT(DISTINCT plc.month) as months_with_data
      FROM projects p
      LEFT JOIN project_labor_costs plc ON plc.project_id = p.id AND plc.year = ?
      WHERE p.status != 'cancelled'
      GROUP BY p.id
    `).bind(parseInt(currentYear)).all()

    // Monthly summary: other costs only (salary excluded — in project_labor_costs)
    const monthlySummary = await db.prepare(`
      SELECT strftime('%Y-%m', cost_date) as month,
        SUM(amount) as total_cost, cost_type
      FROM project_costs
      WHERE strftime('%Y', cost_date) = ? AND cost_type != 'salary'
      GROUP BY month, cost_type ORDER BY month ASC
    `).bind(currentYear).all()

    // Monthly labor costs summary (from project_labor_costs)
    const monthlyLaborSummary = await db.prepare(`
      SELECT PRINTF('%d-%02d', year, month) as month,
        SUM(total_labor_cost) as total_cost,
        'salary' as cost_type
      FROM project_labor_costs
      WHERE year = ?
      GROUP BY month ORDER BY month ASC
    `).bind(parseInt(currentYear)).all()

    const timesheetCost = await db.prepare(`
      SELECT ts.project_id, p.name as project_name, p.code as project_code,
        SUM(ts.regular_hours + ts.overtime_hours) as total_hours
      FROM timesheets ts
      JOIN projects p ON ts.project_id = p.id
      WHERE strftime('%Y', ts.work_date) = ?
      GROUP BY ts.project_id
    `).bind(currentYear).all()

    // Merge monthly labor into monthlySummary for complete picture
    const allMonthlyCosts = [
      ...(monthlySummary.results || []),
      ...(monthlyLaborSummary.results || [])
    ]

    return c.json({
      revenue_by_project: revenueByProject.results,
      cost_by_project: costByProject.results,
      labor_by_project: laborByProject.results,
      monthly_summary: allMonthlyCosts,
      timesheet_cost: timesheetCost.results
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// PRODUCTIVITY STATS (detailed per-user)
// ===================================================
app.get('/api/productivity', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const { project_id, days } = c.req.query()
    const daysBack = parseInt(days || '30')

    let baseWhere = `WHERE u.is_active = 1 AND u.role NOT IN ('system_admin')`

    // Use subqueries so tasks and timesheets are aggregated independently
    // — avoids the Cartesian product that inflated completed_tasks counts
    const taskFilter = project_id ? `AND project_id = ${parseInt(project_id)}` : ''
    const rows = await db.prepare(`
      SELECT u.id, u.full_name, u.department,
        COALESCE(tsk.total_tasks,     0) AS total_tasks,
        COALESCE(tsk.completed_tasks, 0) AS completed_tasks,
        COALESCE(tsk.ontime_tasks,    0) AS ontime_tasks,
        COALESCE(tsk.late_completed,  0) AS late_completed,
        COALESCE(tsk.overdue_tasks,   0) AS overdue_tasks,
        COALESCE(tsk.avg_progress,    0) AS avg_progress,
        COALESCE(ts.total_hours,      0) AS total_hours_30d
      FROM users u
      LEFT JOIN (
        SELECT assigned_to,
          COUNT(DISTINCT id)  AS total_tasks,
          COUNT(DISTINCT CASE WHEN status = 'completed' THEN id END)  AS completed_tasks,
          COUNT(DISTINCT CASE WHEN status = 'completed'
            AND (actual_end_date IS NULL OR actual_end_date <= due_date) THEN id END) AS ontime_tasks,
          COUNT(DISTINCT CASE WHEN status = 'completed'
            AND actual_end_date > due_date THEN id END)               AS late_completed,
          COUNT(DISTINCT CASE WHEN due_date < date('now')
            AND status != 'completed' THEN id END)                    AS overdue_tasks,
          AVG(CASE WHEN status = 'completed' THEN progress END)       AS avg_progress
        FROM tasks
        WHERE 1=1 ${taskFilter}
        GROUP BY assigned_to
      ) tsk ON tsk.assigned_to = u.id
      LEFT JOIN (
        SELECT user_id,
          SUM(regular_hours + overtime_hours) AS total_hours
        FROM timesheets
        WHERE work_date >= date('now', '-${daysBack} days')
        GROUP BY user_id
      ) ts ON ts.user_id = u.id
      ${baseWhere}
      ORDER BY completed_tasks DESC, total_hours_30d DESC
    `).all()

    const data = (rows.results as any[]).map(r => {
      // Clamp values to prevent impossible numbers from bad data
      const total     = Math.max(0, r.total_tasks)
      const completed = Math.min(total, Math.max(0, r.completed_tasks))   // completed ≤ assigned
      const ontime    = Math.min(completed, Math.max(0, r.ontime_tasks))  // ontime ≤ completed
      const late      = Math.max(0, r.late_completed)
      const overdue   = Math.max(0, r.overdue_tasks)
      const avgProg   = Math.min(100, Math.max(0, Math.round(r.avg_progress || 0)))

      const productivity = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0
      const ontime_rate  = completed > 0 ? Math.min(100, Math.round((ontime / completed) * 100)) : (total === 0 ? 0 : 100)
      const score        = Math.round((productivity + ontime_rate) / 2)

      return {
        ...r,
        total_tasks:     total,
        completed_tasks: completed,
        ontime_tasks:    ontime,
        late_completed:  late,
        overdue_tasks:   overdue,
        avg_progress:    avgProg,
        productivity,
        ontime_rate,
        score
      }
    })
    return c.json(data)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// DEDUP TASKS (one-time admin utility)
// ===================================================
app.post('/api/admin/dedup-tasks', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB

    // Count before
    const before = await db.prepare(`SELECT COUNT(*) as cnt FROM tasks`).first() as any

    // Get the list of IDs to keep (min id per title+project+assigned group)
    const keepRows = await db.prepare(`
      SELECT MIN(id) as keep_id FROM tasks
      GROUP BY title, project_id, assigned_to
    `).all()
    const keepIds = (keepRows.results as any[]).map(r => r.keep_id)

    if (keepIds.length === 0) {
      return c.json({ success: true, before: before?.cnt || 0, after: before?.cnt || 0, removed: 0 })
    }

    // Find duplicate IDs to delete
    const allTasks = await db.prepare(`SELECT id FROM tasks`).all()
    const deleteIds = (allTasks.results as any[])
      .map(r => r.id)
      .filter(id => !keepIds.includes(id))

    if (deleteIds.length === 0) {
      return c.json({ success: true, before: before?.cnt || 0, after: before?.cnt || 0, removed: 0 })
    }

    // Delete in batches of 50 to avoid query length limits
    const batchSize = 50
    for (let i = 0; i < deleteIds.length; i += batchSize) {
      const batch = deleteIds.slice(i, i + batchSize)
      const placeholders = batch.map(() => '?').join(',')
      // Delete history first to respect foreign key constraints
      await db.prepare(`DELETE FROM task_history WHERE task_id IN (${placeholders})`).bind(...batch).run()
      // Also null out timesheet task_id references
      await db.prepare(`UPDATE timesheets SET task_id = NULL WHERE task_id IN (${placeholders})`).bind(...batch).run()
      // Now delete the duplicate tasks
      await db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).bind(...batch).run()
    }

    // Count after
    const after = await db.prepare(`SELECT COUNT(*) as cnt FROM tasks`).first() as any

    // Recalculate is_overdue
    await db.prepare(`
      UPDATE tasks
      SET is_overdue = CASE
        WHEN due_date IS NOT NULL AND due_date < date('now') AND status != 'completed' THEN 1
        ELSE 0
      END
    `).run()

    return c.json({
      success: true,
      before: before?.cnt || 0,
      after: after?.cnt || 0,
      removed: deleteIds.length
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// COST TYPES (System Admin CRUD)
// ===================================================
app.get('/api/cost-types', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const rows = await db.prepare(`
      SELECT ct.*, (SELECT COUNT(*) FROM project_costs pc WHERE pc.cost_type = ct.code) as usage_count
      FROM cost_types ct ORDER BY ct.sort_order, ct.id
    `).all()
    return c.json(rows.results)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

app.post('/api/cost-types', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { code, name, description, color, is_active } = await c.req.json()
    if (!code || !name) return c.json({ error: 'code and name required' }, 400)
    const r = await db.prepare(
      'INSERT INTO cost_types (code, name, description, color, is_active) VALUES (?, ?, ?, ?, ?)'
    ).bind(code, name, description || null, color || '#6B7280', is_active !== false ? 1 : 0).run()
    return c.json({ success: true, id: r.meta.last_row_id }, 201)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

app.put('/api/cost-types/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    const data = await c.req.json()
    const fields = ['name', 'description', 'color', 'is_active']
    const updates = fields.filter(f => data[f] !== undefined).map(f => `${f} = ?`)
    const values = fields.filter(f => data[f] !== undefined).map(f => data[f])
    if (!updates.length) return c.json({ error: 'Nothing to update' }, 400)
    values.push(id)
    await db.prepare(`UPDATE cost_types SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

app.delete('/api/cost-types/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    const ct = await db.prepare('SELECT code FROM cost_types WHERE id = ?').bind(id).first() as any
    if (!ct) return c.json({ error: 'Not found' }, 404)
    const usage = await db.prepare('SELECT COUNT(*) as cnt FROM project_costs WHERE cost_type = ?').bind(ct.code).first() as any
    if (usage?.cnt > 0) return c.json({ error: `Loại chi phí này đang được dùng trong ${usage.cnt} bản ghi, không thể xóa` }, 400)
    await db.prepare('DELETE FROM cost_types WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ===================================================
// PROJECT FINANCE SUMMARY (per-project)
// ===================================================
app.get('/api/finance/project/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const projectId = parseInt(c.req.param('id'))
    const { month, months, year, all_months } = c.req.query()
    const yInt = year ? parseInt(year) : new Date().getFullYear()
    const y = String(yInt)
    const mInt = month ? parseInt(month) : null

    const project = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first() as any
    if (!project) return c.json({ error: 'Not found' }, 404)

    const contractValue = project.contract_value || 0
    const validation_warnings: string[] = []

    // --- Build date filters based on period type ---
    let costDateFilter = `AND strftime('%Y', cost_date) = '${y}'`
    let revDateFilter  = `AND strftime('%Y', revenue_date) = '${y}'`
    let periodLabel = `Năm ${yInt}`

    if (all_months === 'true') {
      periodLabel = `Toàn năm ${yInt}`
    } else if (months) {
      const monthArr = months.split(',').map((m: string) => parseInt(m.trim())).filter((m: number) => m >= 1 && m <= 12)
      if (monthArr.length > 0) {
        costDateFilter += ` AND CAST(strftime('%m', cost_date) AS INTEGER) IN (${monthArr.join(',')})`
        revDateFilter  += ` AND CAST(strftime('%m', revenue_date) AS INTEGER) IN (${monthArr.join(',')})`
        periodLabel = `T${monthArr.join(',')}/${yInt}`
      }
    } else if (month) {
      const m = String(mInt!).padStart(2, '0')
      costDateFilter = `AND strftime('%Y', cost_date) = '${y}' AND strftime('%m', cost_date) = '${m}'`
      revDateFilter  = `AND strftime('%Y', revenue_date) = '${y}' AND strftime('%m', revenue_date) = '${m}'`
      periodLabel = `T${mInt}/${yInt}`
    }

    // --- Other costs from project_costs (excluding salary type) ---
    const otherCosts = await db.prepare(
      `SELECT cost_type, SUM(amount) as total FROM project_costs
       WHERE project_id = ? AND cost_type != 'salary' ${costDateFilter} GROUP BY cost_type`
    ).bind(projectId).all()
    const totalOtherCost = (otherCosts.results as any[]).reduce((s, c) => s + (c as any).total, 0)

    // --- Labor cost: aggregate from project_labor_costs for the period ---
    // Determine which months to query
    let finMonthList: number[] | null = null  // null = all 12
    if (all_months === 'true') {
      finMonthList = null
    } else if (months) {
      const parsed = months.split(',').map((m: string) => parseInt(m.trim())).filter((m: number) => m >= 1 && m <= 12)
      if (parsed.length > 0) finMonthList = parsed
    } else if (mInt) {
      finMonthList = [mInt]
    }

    let laborCost = 0; let laborHours = 0; let laborPerHour = 0; let laborSource = 'none'
    let laborMonthsCount = 0

    let laborWhere = `WHERE project_id = ? AND year = ?`
    const laborParams: any[] = [projectId, yInt]
    if (finMonthList !== null) {
      laborWhere += ` AND month IN (${finMonthList.join(',')})`
    }
    // For null (all_months): no month filter → SUM all months in year

    const laborRow = await db.prepare(
      `SELECT SUM(total_labor_cost) as lc, SUM(total_hours) as hrs, AVG(cost_per_hour) as cph,
              COUNT(DISTINCT month) as m_cnt
       FROM project_labor_costs ${laborWhere}`
    ).bind(...laborParams).first() as any

    if (laborRow?.lc) {
      laborCost = laborRow.lc; laborHours = laborRow.hrs || 0; laborPerHour = laborRow.cph || 0
      laborMonthsCount = laborRow.m_cnt || 0
      laborSource = 'project_labor_costs'
    } else {
      // Fallback: real-time — loop over each month in range and accumulate
      const monthsToCalc = finMonthList ?? Array.from({ length: 12 }, (_, i) => i + 1)
      let rtTotal = 0; let rtHours = 0; let rtCphSum = 0; let rtMonths = 0
      for (const mi of monthsToCalc) {
        const m = String(mi).padStart(2, '0')
        const { costPerHour } = await computeMonthLaborCost(db, mi, yInt)
        const projHrs = await db.prepare(
          `SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as total FROM timesheets
           WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
        ).bind(projectId, y, m).first() as any
        const hrs = projHrs?.total || 0
        if (hrs > 0) {
          rtTotal += Math.round(hrs * costPerHour); rtHours += hrs
          rtCphSum += costPerHour; rtMonths++
        }
      }
      if (rtTotal > 0) {
        laborCost = rtTotal; laborHours = rtHours
        laborPerHour = rtMonths > 0 ? rtCphSum / rtMonths : 0
        laborMonthsCount = rtMonths; laborSource = 'realtime'
      }
    }

    // Validate labor cost
    if (contractValue > 0 && laborCost > contractValue) {
      validation_warnings.push(`Chi phí lương (${fmtNum(laborCost)} ₫) vượt giá trị hợp đồng`)
      laborCost = contractValue
    }

    // --- Revenue ---
    const revenues = await db.prepare(
      `SELECT SUM(amount) as total FROM project_revenues WHERE project_id = ? ${revDateFilter}`
    ).bind(projectId).first() as any
    const totalRevenue = revenues?.total || (finMonthList === null && all_months !== 'true' ? contractValue : (revenues?.total || 0))

    // --- Timeline ---
    const timeline = await db.prepare(`
      SELECT strftime('%Y-%m', cost_date) as month, cost_type, SUM(amount) as total
      FROM project_costs WHERE project_id = ?
      GROUP BY month, cost_type ORDER BY month
    `).bind(projectId).all()

    const totalCost = laborCost + totalOtherCost
    const profit = totalRevenue - totalCost
    const margin = totalRevenue > 0 ? parseFloat(((profit / totalRevenue) * 100).toFixed(1)) : 0

    // Validation rules
    if (contractValue > 0 && totalCost > contractValue * 1.2) {
      validation_warnings.push(`Tổng chi phí (${fmtNum(totalCost)} ₫) vượt 120% giá trị HĐ`)
    }
    if (totalRevenue > 0 && profit <= 0) {
      validation_warnings.push(`Lợi nhuận âm: ${fmtNum(profit)} ₫`)
    } else if (totalRevenue > 0 && margin < 10 && margin > 0) {
      validation_warnings.push(`Lợi nhuận thấp: ${margin}% (< 10%)`)
    }
    if (totalRevenue > 0 && laborCost > totalRevenue * 0.8) {
      validation_warnings.push(`Chi phí lương chiếm ${((laborCost/totalRevenue)*100).toFixed(1)}% doanh thu (> 80%)`)
    }

    // Build costs_by_type with labor included
    const costTypeNames: Record<string, string> = {
      material: 'Vật liệu', equipment: 'Thiết bị', transport: 'Vận chuyển',
      other: 'Chi phí khác', salary: 'Lương nhân sự'
    }
    const costsByType = [
      ...(laborCost > 0 ? [{ cost_type: 'salary', total: laborCost, label: 'Lương nhân sự', is_auto: true }] : []),
      ...(otherCosts.results as any[]).map((c: any) => ({
        ...c, label: costTypeNames[c.cost_type] || c.cost_type, is_auto: false
      }))
    ]

    return c.json({
      project: { id: project.id, code: project.code, name: project.name, contract_value: contractValue },
      period: { label: periodLabel, year: yInt },
      summary: {
        total_revenue: totalRevenue, total_cost: totalCost, labor_cost: laborCost,
        other_cost: totalOtherCost, profit, margin,
        labor_hours: laborHours, labor_per_hour: Math.round(laborPerHour), labor_source: laborSource,
        labor_months_count: laborMonthsCount
      },
      costs_by_type: costsByType,
      timeline: timeline.results,
      validation: {
        warnings: validation_warnings,
        has_warnings: validation_warnings.length > 0,
        profit_status: profit > 0 ? (margin < 10 ? 'warning' : 'ok') : 'error'
      }
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ===================================================
// MONTHLY LABOR COSTS (Admin inputs company total salary)
// ===================================================

// GET - list all monthly entries (or specific month/year)
app.get('/api/monthly-labor-costs', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { month, year } = c.req.query()
    let sql = `SELECT * FROM monthly_labor_costs ORDER BY year DESC, month DESC`
    let params: any[] = []
    if (month && year) {
      sql = `SELECT * FROM monthly_labor_costs WHERE month = ? AND year = ? LIMIT 1`
      params = [parseInt(month), parseInt(year)]
    }
    const rows = params.length
      ? await db.prepare(sql).bind(...params).all()
      : await db.prepare(sql).all()
    return c.json(rows.results)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// POST - create or update a monthly entry
app.post('/api/monthly-labor-costs', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const body = await c.req.json()
    const { month, year, total_labor_cost, notes } = body
    if (!month || !year || !total_labor_cost) {
      return c.json({ error: 'Thiếu thông tin: month, year, total_labor_cost' }, 400)
    }
    // Upsert: update if exists, insert if not
    const existing = await db.prepare(
      `SELECT id FROM monthly_labor_costs WHERE month = ? AND year = ?`
    ).bind(parseInt(month), parseInt(year)).first() as any

    if (existing) {
      await db.prepare(
        `UPDATE monthly_labor_costs SET total_labor_cost = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(parseFloat(total_labor_cost), notes || '', existing.id).run()
      return c.json({ success: true, id: existing.id, action: 'updated' })
    } else {
      const result = await db.prepare(
        `INSERT INTO monthly_labor_costs (month, year, total_labor_cost, notes) VALUES (?, ?, ?, ?)`
      ).bind(parseInt(month), parseInt(year), parseFloat(total_labor_cost), notes || '').run()
      return c.json({ success: true, id: result.meta.last_row_id, action: 'created' })
    }
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// DELETE - remove a monthly entry
app.delete('/api/monthly-labor-costs/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    await db.prepare(`DELETE FROM monthly_labor_costs WHERE id = ?`).bind(parseInt(c.req.param('id'))).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ===================================================
// LABOR COST CALCULATION (from timesheets)
// ===================================================
app.get('/api/finance/labor-cost', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { month, year } = c.req.query()
    const m = (month || String(new Date().getMonth() + 1)).padStart(2, '0')
    const y = year || String(new Date().getFullYear())
    const mInt = parseInt(m)
    const yInt = parseInt(y)

    // Try to get admin-entered total labor cost for this month first
    const manualEntry = await db.prepare(
      `SELECT * FROM monthly_labor_costs WHERE month = ? AND year = ?`
    ).bind(mInt, yInt).first() as any

    // Fallback: sum of all active user monthly salaries
    const salaryPool = await db.prepare(
      `SELECT SUM(salary_monthly) as total FROM users WHERE is_active = 1 AND role != 'system_admin'`
    ).first() as any

    // Total hours worked company-wide that month
    const totalHours = await db.prepare(
      `SELECT SUM(regular_hours + overtime_hours) as total FROM timesheets
       WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
    ).bind(y, m).first() as any

    const salaryPoolTotal = salaryPool?.total || 0
    // Use manual entry if available, else fallback to salary pool
    const laborCostSource = manualEntry ? manualEntry.total_labor_cost : salaryPoolTotal
    const totalHoursAll = totalHours?.total || 0
    const costPerHour = totalHoursAll > 0 ? laborCostSource / totalHoursAll : 0

    // Per-project labor cost
    const byProject = await db.prepare(`
      SELECT p.id, p.code, p.name,
        COALESCE(SUM(ts.regular_hours + ts.overtime_hours), 0) as project_hours
      FROM projects p
      LEFT JOIN timesheets ts ON ts.project_id = p.id
        AND strftime('%Y', ts.work_date) = ?
        AND strftime('%m', ts.work_date) = ?
      WHERE p.status != 'cancelled'
      GROUP BY p.id
      HAVING project_hours > 0
      ORDER BY project_hours DESC
    `).bind(y, m).all()

    const projectsWithCost = (byProject.results as any[]).map(r => ({
      ...r,
      labor_cost: Math.round(r.project_hours * costPerHour),
      pct: totalHoursAll > 0 ? Math.round((r.project_hours / totalHoursAll) * 100) : 0
    }))

    return c.json({
      month: `${y}-${m}`,
      month_int: mInt,
      year_int: yInt,
      salary_pool: salaryPoolTotal,
      manual_labor_cost: manualEntry ? manualEntry.total_labor_cost : null,
      labor_cost_used: laborCostSource,
      cost_source: manualEntry ? 'manual' : 'salary_pool',
      total_hours: totalHoursAll,
      cost_per_hour: Math.round(costPerHour),
      notes: manualEntry?.notes || '',
      projects: projectsWithCost
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// Disciplines endpoint
app.get('/api/disciplines', async (c) => {
  try {
    const db = c.env.DB
    const disciplines = await db.prepare('SELECT * FROM disciplines WHERE is_active = 1 ORDER BY id').all()
    return c.json(disciplines.results)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Reset disciplines to canonical list (System Admin only)
app.post('/api/disciplines/reset', authMiddleware, async (c) => {
  try {
    const user = c.get('user') as any
    if (user.role !== 'system_admin') return c.json({ error: 'Forbidden' }, 403)
    const db = c.env.DB
    await db.prepare('DELETE FROM disciplines').run()
    const disciplines = [
      ['ZZ', 'Tổng hợp', 'general'],
      ['AA', 'Kiến trúc', 'architecture'],
      ['AD', 'Nội thất', 'architecture'],
      ['AF', 'Mặt dựng', 'architecture'],
      ['ES', 'Kết cấu', 'structure'],
      ['EM', 'Điều hòa thông gió', 'mep'],
      ['EE', 'Điện sinh hoạt', 'mep'],
      ['EP', 'Cấp thoát nước sinh hoạt', 'mep'],
      ['EF', 'Chữa cháy', 'mep'],
      ['EC', 'Thông tin liên lạc', 'mep'],
      ['CL', 'San nền', 'civil'],
      ['CT', 'Giao thông', 'civil'],
      ['CD', 'Thoát nước mưa', 'civil'],
      ['CS', 'Thoát nước thải', 'civil'],
      ['CW', 'Cấp nước', 'civil'],
      ['CF', 'Chữa cháy (hạ tầng)', 'civil'],
      ['CE', 'Điện (hạ tầng)', 'civil'],
      ['CC', 'Thông tin (hạ tầng)', 'civil'],
      ['LA', 'Cảnh quan', 'landscape'],
      ['LW', 'Cấp nước cảnh quan', 'landscape'],
      ['LD', 'Thoát nước cảnh quan', 'landscape'],
      ['LR', 'Tường chắn', 'landscape'],
      ['LE', 'Kè', 'landscape'],
      ['LL', 'Chiếu sáng', 'landscape'],
    ]
    for (const [code, name, category] of disciplines) {
      await db.prepare('INSERT INTO disciplines (code, name, category) VALUES (?, ?, ?)').bind(code, name, category).run()
    }
    const result = await db.prepare('SELECT * FROM disciplines ORDER BY id').all()
    return c.json({ success: true, message: 'Disciplines reset successfully', data: result.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// INIT DATABASE (for first run)
// ===================================================
app.post('/api/system/init', async (c) => {
  try {
    const db = c.env.DB

    // Create tables individually
    const tables = [
      `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, full_name TEXT NOT NULL, email TEXT UNIQUE, phone TEXT, role TEXT NOT NULL DEFAULT 'member', department TEXT, salary_monthly REAL DEFAULT 0, is_active INTEGER DEFAULT 1, avatar TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, client TEXT, project_type TEXT DEFAULT 'building', status TEXT DEFAULT 'active', start_date DATE, end_date DATE, budget REAL DEFAULT 0, contract_value REAL DEFAULT 0, location TEXT, admin_id INTEGER, leader_id INTEGER, progress INTEGER DEFAULT 0, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS project_members (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT DEFAULT 'member', joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, user_id))`,
      `CREATE TABLE IF NOT EXISTS disciplines (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT DEFAULT 'architecture', description TEXT, is_active INTEGER DEFAULT 1)`,
      `CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, name TEXT NOT NULL, code TEXT, description TEXT, discipline_code TEXT, phase TEXT DEFAULT 'basic_design', start_date DATE, end_date DATE, progress INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', parent_id INTEGER, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, category_id INTEGER, title TEXT NOT NULL, description TEXT, discipline_code TEXT, phase TEXT DEFAULT 'basic_design', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'todo', assigned_to INTEGER, assigned_by INTEGER, start_date DATE, due_date DATE, actual_start_date DATE, actual_end_date DATE, estimated_hours REAL DEFAULT 0, actual_hours REAL DEFAULT 0, progress INTEGER DEFAULT 0, is_overdue INTEGER DEFAULT 0, tags TEXT, attachments TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS task_history (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL, field_changed TEXT NOT NULL, old_value TEXT, new_value TEXT, comment TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS timesheets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, project_id INTEGER NOT NULL, task_id INTEGER, work_date DATE NOT NULL, regular_hours REAL DEFAULT 0, overtime_hours REAL DEFAULT 0, description TEXT, status TEXT DEFAULT 'draft', approved_by INTEGER, approved_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, project_id, work_date))`,
      `CREATE TABLE IF NOT EXISTS project_costs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, cost_type TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL, currency TEXT DEFAULT 'VND', cost_date DATE, invoice_number TEXT, vendor TEXT, approved_by INTEGER, notes TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS project_revenues (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL, currency TEXT DEFAULT 'VND', revenue_date DATE, invoice_number TEXT, payment_status TEXT DEFAULT 'pending', notes TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS assets (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, brand TEXT, model TEXT, serial_number TEXT, specifications TEXT, purchase_date DATE, purchase_price REAL DEFAULT 0, current_value REAL DEFAULT 0, warranty_expiry DATE, status TEXT DEFAULT 'unused', location TEXT, department TEXT, assigned_to INTEGER, assigned_date DATE, notes TEXT, image_url TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, type TEXT DEFAULT 'info', related_type TEXT, related_id INTEGER, is_read INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS cost_types (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, color TEXT DEFAULT '#6B7280', is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS monthly_labor_costs (id INTEGER PRIMARY KEY AUTOINCREMENT, month INTEGER NOT NULL, year INTEGER NOT NULL, total_labor_cost REAL NOT NULL, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(month, year))`,
      `CREATE TABLE IF NOT EXISTS project_labor_costs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL, total_labor_cost REAL NOT NULL DEFAULT 0, total_hours REAL NOT NULL DEFAULT 0, cost_per_hour REAL NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, month, year), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE)`,
    ]

    for (const stmt of tables) {
      await db.prepare(stmt).run()
    }

    // Insert admin user
    const adminHash = await hashPassword('Admin@123')
    await db.prepare(
      `INSERT OR IGNORE INTO users (username, password_hash, full_name, email, role, department)
       VALUES ('admin', ?, 'System Administrator', 'admin@onecad.vn', 'system_admin', 'Quản lý hệ thống')`
    ).bind(adminHash).run()

    // ---- Migrate old 2024 dates to 2026 to fix overdue tasks ----
    await db.prepare(`UPDATE tasks SET due_date = REPLACE(due_date, '2024-', '2026-') WHERE due_date LIKE '2024-%'`).run()
    await db.prepare(`UPDATE tasks SET start_date = REPLACE(start_date, '2024-', '2026-') WHERE start_date LIKE '2024-%'`).run()
    await db.prepare(`UPDATE tasks SET actual_end_date = REPLACE(actual_end_date, '2024-', '2026-') WHERE actual_end_date LIKE '2024-%'`).run()
    await db.prepare(`UPDATE projects SET start_date = REPLACE(start_date, '2024-', '2026-'), end_date = REPLACE(end_date, '2024-', '2026-') WHERE start_date LIKE '2024-%'`).run()
    await db.prepare(`UPDATE projects SET end_date = REPLACE(end_date, '2025-', '2027-') WHERE end_date LIKE '2025-%'`).run()
    // Reset overdue flags for tasks that are no longer past due
    await db.prepare(`UPDATE tasks SET is_overdue = 0 WHERE due_date >= date('now') AND status NOT IN ('completed','cancelled')`).run()
    await db.prepare(`UPDATE tasks SET is_overdue = 1 WHERE due_date < date('now') AND status NOT IN ('completed','cancelled')`).run()

    // Reset and re-insert disciplines (clean slate to avoid duplicates)
    await db.prepare('DELETE FROM disciplines').run()
    const disciplines = [
      // General
      ['ZZ', 'Tổng hợp', 'general'],
      // Architecture
      ['AA', 'Kiến trúc', 'architecture'],
      ['AD', 'Nội thất', 'architecture'],
      ['AF', 'Mặt dựng', 'architecture'],
      // Structure
      ['ES', 'Kết cấu', 'structure'],
      // MEP (Building)
      ['EM', 'Điều hòa thông gió', 'mep'],
      ['EE', 'Điện sinh hoạt', 'mep'],
      ['EP', 'Cấp thoát nước sinh hoạt', 'mep'],
      ['EF', 'Chữa cháy', 'mep'],
      ['EC', 'Thông tin liên lạc', 'mep'],
      // Civil
      ['CL', 'San nền', 'civil'],
      ['CT', 'Giao thông', 'civil'],
      ['CD', 'Thoát nước mưa', 'civil'],
      ['CS', 'Thoát nước thải', 'civil'],
      ['CW', 'Cấp nước', 'civil'],
      ['CF', 'Chữa cháy (hạ tầng)', 'civil'],
      ['CE', 'Điện (hạ tầng)', 'civil'],
      ['CC', 'Thông tin (hạ tầng)', 'civil'],
      // Landscape
      ['LA', 'Cảnh quan', 'landscape'],
      ['LW', 'Cấp nước cảnh quan', 'landscape'],
      ['LD', 'Thoát nước cảnh quan', 'landscape'],
      ['LR', 'Tường chắn', 'landscape'],
      ['LE', 'Kè', 'landscape'],
      ['LL', 'Chiếu sáng', 'landscape'],
    ]

    for (const [code, name, category] of disciplines) {
      await db.prepare('INSERT INTO disciplines (code, name, category) VALUES (?, ?, ?)').bind(code, name, category).run()
    }

    // Seed default cost types
    await db.prepare('DELETE FROM cost_types').run()
    const costTypes = [
      ['salary',    'Lương nhân sự',      'Chi phí lương và phúc lợi nhân sự', '#00A651', 1],
      ['material',  'Chi phí vật liệu',   'Vật tư, nguyên liệu thi công',       '#0066CC', 2],
      ['equipment', 'Chi phí thiết bị',   'Thuê hoặc khấu hao thiết bị',        '#8B5CF6', 3],
      ['transport', 'Chi phí vận chuyển', 'Di chuyển, vận chuyển hàng hóa',     '#FF6B00', 4],
      ['other',     'Chi phí khác',       'Các chi phí phát sinh khác',          '#6B7280', 5],
    ]
    for (const [code, name, desc, color, sort] of costTypes) {
      await db.prepare('INSERT INTO cost_types (code, name, description, color, sort_order) VALUES (?, ?, ?, ?, ?)')
        .bind(code, name, desc, color, sort).run()
    }

    // Insert demo users
    const memberHash = await hashPassword('Pass@123')
    const demoUsers = [
      ['nguyen.van.a', 'Nguyễn Văn A', 'nva@onecad.vn', 'member', 'Kiến trúc', 15000000],
      ['tran.thi.b', 'Trần Thị B', 'ttb@onecad.vn', 'member', 'Kết cấu', 16000000],
      ['le.van.c', 'Lê Văn C', 'lvc@onecad.vn', 'project_leader', 'MEP', 18000000],
      ['pham.thi.d', 'Phạm Thị D', 'ptd@onecad.vn', 'project_admin', 'Quản lý dự án', 22000000],
    ]

    for (const [username, full_name, email, role, department, salary] of demoUsers) {
      await db.prepare(
        `INSERT OR IGNORE INTO users (username, password_hash, full_name, email, role, department, salary_monthly)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(username, memberHash, full_name, email, role, department, salary).run()
    }

    // Insert sample projects
    const sampleProjects = [
      ['PRJ001', 'Tòa nhà văn phòng OneCad Tower', 'Dự án thiết kế tòa nhà văn phòng 15 tầng tại Hà Nội', 'OneCad Vietnam', 'building', 'active', '2026-01-15', '2026-12-31', 5000000000],
      ['PRJ002', 'Cầu vượt đường bộ QL1A', 'Dự án thiết kế cầu vượt tại km 45+200 QL1A', 'Bộ GTVT', 'transport', 'active', '2026-03-01', '2027-06-30', 12000000000],
      ['PRJ003', 'Khu đô thị Eco City', 'Quy hoạch và thiết kế khu đô thị sinh thái 50ha', 'Eco Land JSC', 'building', 'planning', '2026-06-01', '2027-12-31', 8000000000],
    ]

    for (const [code, name, desc, client, type, status, start, end, value] of sampleProjects) {
      await db.prepare(
        `INSERT OR IGNORE INTO projects (code, name, description, client, project_type, status, start_date, end_date, contract_value, admin_id, leader_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 4, 3, 1)`
      ).bind(code, name, desc, client, type, status, start, end, value).run()
    }

    // Insert sample tasks — skip if the title already exists in that project to prevent duplicates on re-init
    const sampleTasks = [
      [1, 'Vẽ mặt bằng tầng điển hình', 'AA', 'high', 'in_progress', 2, '2026-01-20', '2026-04-28', 40, 65],
      [1, 'Thiết kế mặt đứng công trình', 'AA', 'high', 'in_progress', 2, '2026-02-01', '2026-05-15', 30, 40],
      [1, 'Tính toán móng cọc', 'ES', 'urgent', 'review', 3, '2026-02-01', '2026-03-30', 24, 90],
      [1, 'Thiết kế khung thép tầng 1', 'ES', 'medium', 'todo', 3, '2026-03-01', '2026-06-30', 20, 0],
      [2, 'Khảo sát địa chất cầu', 'CT', 'urgent', 'completed', 2, '2026-03-01', '2026-04-20', 16, 100],
      [1, 'Hệ thống PCCC tầng hầm', 'EF', 'high', 'todo', 4, '2026-04-01', '2026-07-30', 32, 0],
      [2, 'Thiết kế móng trụ cầu', 'ES', 'high', 'in_progress', 3, '2026-04-01', '2026-07-15', 48, 30],
      [1, 'Thiết kế hệ thống điện tầng 1-5', 'EE', 'medium', 'todo', 4, '2026-05-01', '2026-08-30', 24, 0],
    ]

    for (const [pid, title, disc, priority, status, assigned, start, due, est, prog] of sampleTasks) {
      try {
        // Use INSERT OR IGNORE with a unique constraint check via WHERE NOT EXISTS
        const existing = await db.prepare(
          `SELECT id FROM tasks WHERE title = ? AND project_id = ? AND assigned_to = ? LIMIT 1`
        ).bind(title, pid, assigned).first()
        if (!existing) {
          await db.prepare(
            `INSERT INTO tasks (project_id, title, discipline_code, priority, status, assigned_to, assigned_by, start_date, due_date, estimated_hours, progress)
             VALUES (?, ?, ?, ?, ?, ?, 4, ?, ?, ?, ?)`
          ).bind(pid, title, disc, priority, status, assigned, start, due, est, prog).run()
        }
      } catch (_) { /* skip on error */ }
    }

    // --- Dedup: remove any previously inserted duplicate tasks ---
    try {
      await db.prepare(`
        DELETE FROM task_history
        WHERE task_id NOT IN (
          SELECT MIN(id) FROM tasks GROUP BY title, project_id, assigned_to
        )
      `).run()
      await db.prepare(`
        DELETE FROM tasks
        WHERE id NOT IN (
          SELECT MIN(id) FROM tasks GROUP BY title, project_id, assigned_to
        )
      `).run()
    } catch (_) { /* ignore if no duplicates */ }


    // Sample timesheets — INSERT OR IGNORE to prevent duplicates on re-init
    const today = new Date()
    for (let i = 30; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        try {
          await db.prepare(
            `INSERT OR IGNORE INTO timesheets (user_id, project_id, work_date, regular_hours, overtime_hours, description, status)
             VALUES (?, ?, ?, ?, ?, ?, 'approved')`
          ).bind(2, 1, dateStr, 8, i % 5 === 0 ? 2 : 0, 'Cong viec hang ngay').run()
          await db.prepare(
            `INSERT OR IGNORE INTO timesheets (user_id, project_id, work_date, regular_hours, overtime_hours, description, status)
             VALUES (?, ?, ?, ?, ?, ?, 'approved')`
          ).bind(3, 1, dateStr, 8, i % 7 === 0 ? 3 : 0, 'Cong viec hang ngay').run()
        } catch (_) { /* skip */ }
      }
    }

    // Sample costs & revenues - for year 2026
    // Also clean up any pre-existing timesheet duplicates (for dbs created before UNIQUE constraint)
    try {
      await db.prepare(`
        DELETE FROM timesheets
        WHERE id NOT IN (
          SELECT MIN(id) FROM timesheets GROUP BY user_id, project_id, work_date
        )
      `).run()
    } catch (_) { /* ignore */ }

    // AUTO-DEDUP: Remove existing duplicate project_costs and project_revenues on every init
    // This permanently fixes any data doubled by previous versions of this init endpoint
    try {
      await db.prepare(`
        DELETE FROM project_costs
        WHERE id NOT IN (
          SELECT MAX(id) FROM project_costs
          GROUP BY project_id, cost_type, cost_date
        )
      `).run()
    } catch (_) { /* ignore */ }
    try {
      await db.prepare(`
        DELETE FROM project_revenues
        WHERE id NOT IN (
          SELECT MAX(id) FROM project_revenues
          GROUP BY project_id, revenue_date, description
        )
      `).run()
    } catch (_) { /* ignore */ }
    try {
      await db.prepare(`
        DELETE FROM project_labor_costs
        WHERE id NOT IN (
          SELECT MAX(id) FROM project_labor_costs
          GROUP BY project_id, month, year
        )
      `).run()
    } catch (_) { /* ignore */ }

    // ============================================================
    // Sample costs & revenues — PREVENT DUPLICATES on every re-init
    // PROJECT 1: OneCad Tower — months 1-6 with all cost types
    // ============================================================
    const costTypes2 = ['equipment', 'material', 'transport']
    // Project 1 cost data (fixed amounts for reproducibility)
    const proj1Costs: Record<string, number[]> = {
      equipment: [45000000, 38000000, 52000000, 41000000, 48000000, 55000000],
      material:  [72000000, 68000000, 85000000, 78000000, 92000000, 88000000],
      transport: [18000000, 15000000, 22000000, 19000000, 25000000, 21000000],
    }
    const proj1Revenue = [0, 500000000, 0, 800000000, 0, 1200000000]
    for (let m = 1; m <= 6; m++) {
      const monthStr = m.toString().padStart(2, '0')
      for (const type of costTypes2) {
        try {
          const existingCost = await db.prepare(
            `SELECT id FROM project_costs WHERE project_id = 1 AND cost_type = ? AND cost_date = ? LIMIT 1`
          ).bind(type, `2026-${monthStr}-15`).first()
          if (!existingCost) {
            const amt = proj1Costs[type][m - 1]
            await db.prepare(
              `INSERT INTO project_costs (project_id, cost_type, description, amount, cost_date, created_by) VALUES (1, ?, ?, ?, ?, 1)`
            ).bind(type, `Chi phí ${type} tháng ${m}/2026`, amt, `2026-${monthStr}-15`).run()
          }
        } catch (_) { /* skip */ }
      }
      if (proj1Revenue[m - 1] > 0) {
        try {
          const existingRev = await db.prepare(
            `SELECT id FROM project_revenues WHERE project_id = 1 AND revenue_date = ? LIMIT 1`
          ).bind(`2026-${monthStr}-20`).first()
          if (!existingRev) {
            await db.prepare(
              `INSERT INTO project_revenues (project_id, description, amount, revenue_date, payment_status, created_by) VALUES (1, ?, ?, ?, 'paid', 1)`
            ).bind(`Đợt thanh toán tháng ${m}/2026`, proj1Revenue[m - 1], `2026-${monthStr}-20`).run()
          }
        } catch (_) { /* skip */ }
      }
    }

    // Seed project_labor_costs for Project 1 (months 1-6)
    const proj1Labor = [300000000, 371517028, 285000000, 320000000, 355000000, 410000000]
    const proj1Hours = [85, 300, 260, 290, 320, 380]
    for (let m = 1; m <= 6; m++) {
      try {
        const existing = await db.prepare(
          `SELECT id FROM project_labor_costs WHERE project_id = 1 AND month = ? AND year = 2026 LIMIT 1`
        ).bind(m).first()
        if (!existing) {
          const lc = proj1Labor[m - 1]; const hrs = proj1Hours[m - 1]
          await db.prepare(
            `INSERT INTO project_labor_costs (project_id, month, year, total_labor_cost, total_hours, cost_per_hour) VALUES (1, ?, 2026, ?, ?, ?)`
          ).bind(m, lc, hrs, Math.round(lc / hrs)).run()
        }
      } catch (_) { /* skip */ }
    }

    // Seed project_members for Project 1
    const proj1Members = [[2, 'member'], [3, 'leader'], [4, 'admin']]
    for (const [uid, role] of proj1Members) {
      try {
        await db.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (1, ?, ?)`).bind(uid, role).run()
      } catch (_) {}
    }

    // ============================================================
    // PROJECT 2: Cầu vượt QL1A — months 3-6 (project starts Mar 2026)
    // ============================================================
    const proj2NonSalaryCosts: Record<string, number[]> = {
      equipment: [120000000, 135000000, 148000000, 162000000],
      material:  [95000000, 108000000, 125000000, 138000000],
      transport: [32000000, 38000000, 44000000, 51000000],
    }
    const proj2Months = [3, 4, 5, 6]
    const proj2Revenue = [0, 1500000000, 0, 2000000000]
    for (let i = 0; i < proj2Months.length; i++) {
      const m = proj2Months[i]; const monthStr = m.toString().padStart(2, '0')
      for (const type of Object.keys(proj2NonSalaryCosts)) {
        try {
          const existingCost = await db.prepare(
            `SELECT id FROM project_costs WHERE project_id = 2 AND cost_type = ? AND cost_date = ? LIMIT 1`
          ).bind(type, `2026-${monthStr}-15`).first()
          if (!existingCost) {
            const amt = proj2NonSalaryCosts[type][i]
            await db.prepare(
              `INSERT INTO project_costs (project_id, cost_type, description, amount, cost_date, created_by) VALUES (2, ?, ?, ?, ?, 1)`
            ).bind(type, `Chi phí ${type} tháng ${m}/2026 - PRJ002`, amt, `2026-${monthStr}-15`).run()
          }
        } catch (_) { /* skip */ }
      }
      if (proj2Revenue[i] > 0) {
        try {
          const existingRev = await db.prepare(
            `SELECT id FROM project_revenues WHERE project_id = 2 AND revenue_date = ? LIMIT 1`
          ).bind(`2026-${monthStr}-25`).first()
          if (!existingRev) {
            await db.prepare(
              `INSERT INTO project_revenues (project_id, description, amount, revenue_date, payment_status, created_by) VALUES (2, ?, ?, ?, 'paid', 1)`
            ).bind(`Đợt thanh toán tháng ${m}/2026 - PRJ002`, proj2Revenue[i], `2026-${monthStr}-25`).run()
          }
        } catch (_) { /* skip */ }
      }
    }

    // Seed project_labor_costs for Project 2 (months 3-6)
    const proj2Labor = [450000000, 520000000, 498000000, 575000000]
    const proj2HoursArr = [380, 440, 420, 490]
    for (let i = 0; i < proj2Months.length; i++) {
      const m = proj2Months[i]
      try {
        const existing = await db.prepare(
          `SELECT id FROM project_labor_costs WHERE project_id = 2 AND month = ? AND year = 2026 LIMIT 1`
        ).bind(m).first()
        if (!existing) {
          const lc = proj2Labor[i]; const hrs = proj2HoursArr[i]
          await db.prepare(
            `INSERT INTO project_labor_costs (project_id, month, year, total_labor_cost, total_hours, cost_per_hour) VALUES (2, ?, 2026, ?, ?, ?)`
          ).bind(m, lc, hrs, Math.round(lc / hrs)).run()
        }
      } catch (_) { /* skip */ }
    }

    // Project 2 members
    const proj2Members = [[2, 'member'], [3, 'leader'], [4, 'admin']]
    for (const [uid, role] of proj2Members) {
      try {
        await db.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (2, ?, ?)`).bind(uid, role).run()
      } catch (_) {}
    }

    // Timesheets for Project 2 — users 2 & 3 for the past 30 days (weekdays, half-day)
    const today2 = new Date()
    for (let i = 30; i >= 0; i--) {
      const d = new Date(today2); d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        try {
          await db.prepare(
            `INSERT OR IGNORE INTO timesheets (user_id, project_id, work_date, regular_hours, overtime_hours, description, status) VALUES (?, ?, ?, ?, ?, ?, 'approved')`
          ).bind(2, 2, dateStr, 4, 0, 'Cong viec du an cau').run()
          await db.prepare(
            `INSERT OR IGNORE INTO timesheets (user_id, project_id, work_date, regular_hours, overtime_hours, description, status) VALUES (?, ?, ?, ?, ?, ?, 'approved')`
          ).bind(3, 2, dateStr, 4, i % 5 === 0 ? 2 : 0, 'Cong viec du an cau').run()
        } catch (_) {}
      }
    }

    // ============================================================
    // PROJECT 3: Khu đô thị Eco City — month 6 (planning phase)
    // ============================================================
    const proj3Costs: Record<string, number> = { equipment: 85000000, material: 62000000, transport: 28000000 }
    for (const [type, amt] of Object.entries(proj3Costs)) {
      try {
        const existingCost = await db.prepare(
          `SELECT id FROM project_costs WHERE project_id = 3 AND cost_type = ? AND cost_date = ? LIMIT 1`
        ).bind(type, `2026-06-15`).first()
        if (!existingCost) {
          await db.prepare(
            `INSERT INTO project_costs (project_id, cost_type, description, amount, cost_date, created_by) VALUES (3, ?, ?, ?, '2026-06-15', 1)`
          ).bind(type, `Chi phí ${type} tháng 6/2026 - PRJ003`, amt).run()
        }
      } catch (_) { /* skip */ }
    }
    try {
      const existingRev3 = await db.prepare(
        `SELECT id FROM project_revenues WHERE project_id = 3 AND revenue_date = ? LIMIT 1`
      ).bind('2026-06-30').first()
      if (!existingRev3) {
        await db.prepare(
          `INSERT INTO project_revenues (project_id, description, amount, revenue_date, payment_status, created_by) VALUES (3, ?, ?, '2026-06-30', 'pending', 1)`
        ).bind('Tạm ứng khởi động dự án Eco City', 1200000000).run()
      }
    } catch (_) { /* skip */ }

    // Seed project_labor_costs for Project 3 (month 6 only)
    try {
      const existing3 = await db.prepare(
        `SELECT id FROM project_labor_costs WHERE project_id = 3 AND month = 6 AND year = 2026 LIMIT 1`
      ).first()
      if (!existing3) {
        await db.prepare(
          `INSERT INTO project_labor_costs (project_id, month, year, total_labor_cost, total_hours, cost_per_hour) VALUES (3, 6, 2026, 320000000, 280, ?)`
        ).bind(Math.round(320000000 / 280)).run()
      }
    } catch (_) { /* skip */ }

    // Project 3 members
    const proj3Members = [[3, 'leader'], [4, 'admin']]
    for (const [uid, role] of proj3Members) {
      try {
        await db.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (3, ?, ?)`).bind(uid, role).run()
      } catch (_) {}
    }

    // Additional tasks for projects 2 and 3
    const additionalTasks = [
      [2, 'Thiết kế mố cầu A1', 'ES', 'high', 'in_progress', 3, '2026-03-10', '2026-07-30', 60, 45],
      [2, 'Bản vẽ thiết kế dầm cầu', 'ES', 'urgent', 'in_progress', 2, '2026-04-01', '2026-08-15', 48, 30],
      [2, 'Hệ thống thoát nước mặt cầu', 'CD', 'medium', 'todo', 2, '2026-05-01', '2026-09-30', 32, 0],
      [3, 'Quy hoạch tổng thể 50ha', 'AA', 'high', 'in_progress', 2, '2026-06-15', '2026-10-30', 80, 20],
      [3, 'Thiết kế hạ tầng kỹ thuật', 'CL', 'medium', 'todo', 3, '2026-07-01', '2026-11-30', 64, 0],
    ]
    for (const [pid, title, disc, priority, status, assigned, start, due, est, prog] of additionalTasks) {
      try {
        const existing = await db.prepare(
          `SELECT id FROM tasks WHERE title = ? AND project_id = ? LIMIT 1`
        ).bind(title, pid).first()
        if (!existing) {
          await db.prepare(
            `INSERT INTO tasks (project_id, title, discipline_code, priority, status, assigned_to, assigned_by, start_date, due_date, estimated_hours, progress) VALUES (?, ?, ?, ?, ?, ?, 4, ?, ?, ?, ?)`
          ).bind(pid, title, disc, priority, status, assigned, start, due, est, prog).run()
        }
      } catch (_) { /* skip */ }
    }

    // Sample assets
    const sampleAssets = [
      ['PC-001', 'Máy tính BIM Workstation #1', 'computer', 'Dell', 'Precision 5820', 45000000, 2, 'Kiến trúc'],
      ['LP-001', 'Laptop BIM #1', 'laptop', 'HP', 'ZBook Studio G9', 52000000, 3, 'Kết cấu'],
      ['SW-001', 'License Autodesk AEC Collection', 'software', 'Autodesk', 'AEC 2024', 28000000, null, 'Toàn công ty'],
      ['PC-002', 'Máy in A0 đa chức năng', 'equipment', 'HP', 'DesignJet T830', 35000000, null, 'Văn phòng'],
    ]

    for (const [code, name, cat, brand, model, price, assigned, dept] of sampleAssets) {
      await db.prepare(
        `INSERT OR IGNORE INTO assets (asset_code, name, category, brand, model, purchase_price, current_value, assigned_to, department, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1)`
      ).bind(code, name, cat, brand, model, price, Math.floor(Number(price) * 0.85), assigned, dept).run()
    }

    return c.json({ success: true, message: 'Database initialized successfully' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// STATIC FILES & SPA
// ===================================================
app.use('/static/*', serveStatic({ root: './' }))

// Health check
app.get('/health', (c) => c.json({ status: 'ok', version: '1.0.0' }))

// SPA - serve index.html as static asset via Cloudflare Pages
// The _routes.json excludes /index.html and /static/* from the worker
// For local dev with wrangler, we serve it directly
app.get('/', serveStatic({ path: './index.html' }))
app.get('/index.html', serveStatic({ path: './index.html' }))

export default app
