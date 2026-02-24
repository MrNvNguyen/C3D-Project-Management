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

    const hash = await hashPassword(password)
    const result = await db.prepare(
      `INSERT INTO users (username, password_hash, full_name, email, phone, role, department, salary_monthly) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(username, hash, full_name, email || null, phone || null, role, department || null, salary_monthly || 0).run()

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

    const fields = ['name', 'description', 'client', 'project_type', 'status', 'start_date', 'end_date', 'budget', 'contract_value', 'location', 'admin_id', 'leader_id', 'progress']
    const updates = fields.filter(f => data[f] !== undefined).map(f => `${f} = ?`)
    const values = fields.filter(f => data[f] !== undefined).map(f => data[f])

    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    await db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
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
    const id = parseInt(c.req.param('id'))
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

    const fields = ['title', 'description', 'discipline_code', 'phase', 'priority', 'status', 'assigned_to', 'start_date', 'due_date', 'actual_start_date', 'actual_end_date', 'estimated_hours', 'actual_hours', 'progress', 'category_id']
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
    const id = parseInt(c.req.param('id'))
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
      // Xem tất cả — chỉ lọc thêm nếu client yêu cầu
      if (user_id) { query += ` AND ts.user_id = ?`; params.push(parseInt(user_id)) }
      if (project_id) { query += ` AND ts.project_id = ?`; params.push(parseInt(project_id)) }
    } else if (user.role === 'project_admin' || user.role === 'project_leader') {
      // Xem toàn bộ timesheets của dự án mình quản lý/làm leader
      query += `
        AND ts.project_id IN (
          SELECT id FROM projects WHERE admin_id = ? OR leader_id = ?
          UNION
          SELECT project_id FROM project_members
          WHERE user_id = ? AND role IN ('project_admin','project_leader')
        )
      `
      params.push(user.id, user.id, user.id)
      // Cho phép lọc thêm theo user_id hoặc project_id cụ thể
      if (user_id) { query += ` AND ts.user_id = ?`; params.push(parseInt(user_id)) }
      if (project_id) { query += ` AND ts.project_id = ?`; params.push(parseInt(project_id)) }
    } else {
      // member: chỉ xem của chính mình
      query += ` AND ts.user_id = ?`
      params.push(user.id)
      if (project_id) { query += ` AND ts.project_id = ?`; params.push(parseInt(project_id)) }
    }

    if (status) { query += ` AND ts.status = ?`; params.push(status) }
    if (month)  { query += ` AND strftime('%m', ts.work_date) = ?`; params.push(month.padStart(2, '0')) }
    if (year)   { query += ` AND strftime('%Y', ts.work_date) = ?`; params.push(year) }

    query += ' ORDER BY ts.work_date DESC, ts.id DESC'
    const result = await db.prepare(query).bind(...params).all()
    return c.json(result.results)
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

    // Member productivity
    const memberProductivity = await db.prepare(`
      SELECT u.id, u.full_name, u.department,
        COUNT(DISTINCT t.id) as total_tasks,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
        COALESCE(SUM(ts.regular_hours + ts.overtime_hours), 0) as total_hours
      FROM users u
      LEFT JOIN tasks t ON t.assigned_to = u.id
      LEFT JOIN timesheets ts ON ts.user_id = u.id AND ts.work_date >= date('now', '-30 days')
      WHERE u.is_active = 1 AND u.role NOT IN ('system_admin')
      GROUP BY u.id
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

    const costByProject = await db.prepare(`
      SELECT p.id, p.code, p.name,
        COALESCE(SUM(pc.amount), 0) as total_cost,
        pc.cost_type
      FROM projects p
      LEFT JOIN project_costs pc ON pc.project_id = p.id
        AND strftime('%Y', pc.cost_date) = ?
      WHERE p.status != 'cancelled'
      GROUP BY p.id, pc.cost_type
    `).bind(currentYear).all()

    const monthlySummary = await db.prepare(`
      SELECT strftime('%Y-%m', cost_date) as month,
        SUM(amount) as total_cost, cost_type
      FROM project_costs
      WHERE strftime('%Y', cost_date) = ?
      GROUP BY month, cost_type ORDER BY month ASC
    `).bind(currentYear).all()

    const timesheetCost = await db.prepare(`
      SELECT ts.project_id, p.name as project_name, p.code as project_code,
        SUM(ts.regular_hours + ts.overtime_hours) as total_hours
      FROM timesheets ts
      JOIN projects p ON ts.project_id = p.id
      WHERE strftime('%Y', ts.work_date) = ?
      GROUP BY ts.project_id
    `).bind(currentYear).all()

    return c.json({
      revenue_by_project: revenueByProject.results,
      cost_by_project: costByProject.results,
      monthly_summary: monthlySummary.results,
      timesheet_cost: timesheetCost.results
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
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
      `CREATE TABLE IF NOT EXISTS timesheets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, project_id INTEGER NOT NULL, task_id INTEGER, work_date DATE NOT NULL, regular_hours REAL DEFAULT 0, overtime_hours REAL DEFAULT 0, description TEXT, status TEXT DEFAULT 'draft', approved_by INTEGER, approved_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS project_costs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, cost_type TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL, currency TEXT DEFAULT 'VND', cost_date DATE, invoice_number TEXT, vendor TEXT, approved_by INTEGER, notes TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS project_revenues (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL, currency TEXT DEFAULT 'VND', revenue_date DATE, invoice_number TEXT, payment_status TEXT DEFAULT 'pending', notes TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS assets (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, brand TEXT, model TEXT, serial_number TEXT, specifications TEXT, purchase_date DATE, purchase_price REAL DEFAULT 0, current_value REAL DEFAULT 0, warranty_expiry DATE, status TEXT DEFAULT 'active', location TEXT, department TEXT, assigned_to INTEGER, assigned_date DATE, notes TEXT, image_url TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, type TEXT DEFAULT 'info', related_type TEXT, related_id INTEGER, is_read INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
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
      ['PRJ001', 'Tòa nhà văn phòng OneCad Tower', 'Dự án thiết kế tòa nhà văn phòng 15 tầng tại Hà Nội', 'OneCad Vietnam', 'building', 'active', '2024-01-15', '2024-12-31', 5000000000],
      ['PRJ002', 'Cầu vượt đường bộ QL1A', 'Dự án thiết kế cầu vượt tại km 45+200 QL1A', 'Bộ GTVT', 'transport', 'active', '2024-03-01', '2025-06-30', 12000000000],
      ['PRJ003', 'Khu đô thị Eco City', 'Quy hoạch và thiết kế khu đô thị sinh thái 50ha', 'Eco Land JSC', 'building', 'planning', '2024-06-01', '2025-12-31', 8000000000],
    ]

    for (const [code, name, desc, client, type, status, start, end, value] of sampleProjects) {
      await db.prepare(
        `INSERT OR IGNORE INTO projects (code, name, description, client, project_type, status, start_date, end_date, contract_value, admin_id, leader_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 4, 3, 1)`
      ).bind(code, name, desc, client, type, status, start, end, value).run()
    }

    // Insert sample tasks
    const sampleTasks = [
      [1, 'Vẽ mặt bằng tầng điển hình', 'AA', 'high', 'in_progress', 2, '2024-01-20', '2024-02-28', 40, 65],
      [1, 'Thiết kế mặt đứng công trình', 'AA', 'high', 'in_progress', 2, '2024-02-01', '2024-03-15', 30, 40],
      [1, 'Tính toán móng cọc', 'ES', 'urgent', 'review', 3, '2024-02-01', '2024-02-20', 24, 90],
      [1, 'Thiết kế khung thép tầng 1', 'ES', 'medium', 'todo', 3, '2024-03-01', '2024-03-30', 20, 0],
      [2, 'Khảo sát địa chất cầu', 'CT', 'urgent', 'completed', 2, '2024-03-01', '2024-03-20', 16, 100],
    ]

    for (const [pid, title, disc, priority, status, assigned, start, due, est, prog] of sampleTasks) {
      try {
        await db.prepare(
          `INSERT INTO tasks (project_id, title, discipline_code, priority, status, assigned_to, assigned_by, start_date, due_date, estimated_hours, progress)
           VALUES (?, ?, ?, ?, ?, ?, 4, ?, ?, ?, ?)`
        ).bind(pid, title, disc, priority, status, assigned, start, due, est, prog).run()
      } catch (_) { /* skip duplicates */ }
    }

    // Sample timesheets
    const today = new Date()
    for (let i = 30; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        try {
          await db.prepare(
            `INSERT INTO timesheets (user_id, project_id, work_date, regular_hours, overtime_hours, description, status)
             VALUES (?, ?, ?, ?, ?, ?, 'approved')`
          ).bind(2, 1, dateStr, 8, i % 5 === 0 ? 2 : 0, 'Cong viec hang ngay').run()
          await db.prepare(
            `INSERT INTO timesheets (user_id, project_id, work_date, regular_hours, overtime_hours, description, status)
             VALUES (?, ?, ?, ?, ?, ?, 'approved')`
          ).bind(3, 1, dateStr, 8, i % 7 === 0 ? 3 : 0, 'Cong viec hang ngay').run()
        } catch (_) { /* skip */ }
      }
    }

    // Sample costs & revenues
    const costTypes = ['salary', 'equipment', 'material', 'travel']
    for (let m = 1; m <= 12; m++) {
      const monthStr = m.toString().padStart(2, '0')
      for (const type of costTypes) {
        try {
          await db.prepare(
            `INSERT INTO project_costs (project_id, cost_type, description, amount, cost_date, created_by)
             VALUES (1, ?, ?, ?, ?, 1)`
          ).bind(type, `Chi phi ${type} thang ${m}/2024`, Math.floor(Math.random() * 50000000) + 5000000, `2024-${monthStr}-15`).run()
        } catch (_) { /* skip */ }
      }
      if (m % 3 === 0) {
        try {
          await db.prepare(
            `INSERT INTO project_revenues (project_id, description, amount, revenue_date, payment_status, created_by)
             VALUES (1, ?, ?, ?, 'paid', 1)`
          ).bind(`Dot thanh toan Q${Math.ceil(m/3)}/2024`, Math.floor(Math.random() * 500000000) + 100000000, `2024-${monthStr}-20`).run()
        } catch (_) { /* skip */ }
      }
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
