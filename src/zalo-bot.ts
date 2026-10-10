/** Chat Zalo Bot: chỉ nhóm mới là đích gửi nhắc quá hạn. Chat riêng với bot thì bỏ. */

export type ZaloChatKind = 'group' | 'private'

export type ZaloChatRef = { id: string; kind: ZaloChatKind }

export function zaloChatKind(chat: { chat_type?: unknown; type?: unknown }): ZaloChatKind | null {
  const raw = String(chat?.chat_type ?? chat?.type ?? '').trim().toLowerCase()
  if (raw === 'group' || raw === 'supergroup') return 'group'
  if (raw === 'private' || raw === 'user' || raw === 'personal') return 'private'
  return null
}

/** Lấy mọi chat có loại rõ ràng. Bỏ qua object không phải chat (tránh nhận nhầm id người dùng). */
export function collectZaloChats(node: unknown, parentKey = ''): ZaloChatRef[] {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap((item) => collectZaloChats(item, parentKey))
  const obj = node as Record<string, unknown>
  const found: ZaloChatRef[] = []
  const looksLikeChat = parentKey === 'chat' || obj.chat_type != null
  if (looksLikeChat && obj.id != null && obj.id !== '') {
    const kind = zaloChatKind(obj)
    if (kind) found.push({ id: String(obj.id).trim(), kind })
  }
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object') found.push(...collectZaloChats(value, key))
  }
  return found
}

/** Nhóm xuất hiện cuối cùng trong payload (getUpdates xếp cũ trước). */
export function latestZaloGroupChatId(payload: unknown): string | null {
  const chats = collectZaloChats(payload)
  for (let i = chats.length - 1; i >= 0; i--) {
    if (chats[i].kind === 'group') return chats[i].id
  }
  return null
}

function unwrapZaloValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return value
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.startsWith('{') || text.startsWith('[')) {
      try { return unwrapZaloValue(JSON.parse(text), depth + 1) } catch { return value }
    }
    return value
  }
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => unwrapZaloValue(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = unwrapZaloValue(item, depth + 1)
  return out
}

function zaloEventIn(node: unknown, depth = 0): string {
  if (!node || typeof node !== 'object' || depth > 5) return ''
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = zaloEventIn(item, depth + 1)
      if (found) return found
    }
    return ''
  }
  const obj = node as Record<string, unknown>
  for (const key of ['event_name', 'eventName', 'event']) {
    if (typeof obj[key] === 'string' && obj[key]) return String(obj[key]).slice(0, 80)
  }
  for (const item of Object.values(obj)) {
    const found = zaloEventIn(item, depth + 1)
    if (found) return found
  }
  return ''
}

/** Chỉ tên trường, không lưu nội dung tin nhắn hay token. */
export function zaloPayloadShape(value: unknown): string {
  const keys: string[] = []
  const walk = (node: unknown, prefix: string, depth: number) => {
    if (depth > 4 || keys.length > 24 || !node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      keys.push(`${prefix}[]`)
      if (node.length) walk(node[0], `${prefix}[]`, depth + 1)
      return
    }
    for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
      if (/token|secret|text|caption|display_name|photo|url/i.test(key)) continue
      const path = prefix ? `${prefix}.${key}` : key
      if (item && typeof item === 'object') walk(item, path, depth + 1)
      else keys.push(path)
    }
  }
  walk(value, '', 0)
  return keys.join(',').slice(0, 240)
}

/** Đọc body webhook. Chuỗi JSON lồng nhau được mở ra trước khi tìm chat. */
export function inspectZaloWebhook(raw: string): { body: unknown; event: string; shape: string; empty: boolean } {
  const text = String(raw || '').trim()
  if (!text) return { body: {}, event: '', shape: '', empty: true }
  let parsed: unknown = {}
  if (text.startsWith('{') || text.startsWith('[')) {
    try { parsed = JSON.parse(text) } catch { parsed = {} }
  }
  const body = unwrapZaloValue(parsed)
  const event = zaloEventIn(body)
  const shape = zaloPayloadShape(body)
  const empty = !event && !shape
  return { body, event, shape, empty }
}

/** getUpdates không chạy khi webhook còn URL. Tài liệu Zalo: gọi deleteWebhook trước. */
export function zaloUpdatesBlocked(json: { ok?: boolean; description?: unknown; message?: unknown } | null, webhookUrl: string) {
  if (!json || json.ok !== false) return false
  const desc = String(json.description || json.message || '').toLowerCase()
  return !!String(webhookUrl || '').trim() || desc.includes('webhook')
}

export type ZaloOverdueGroup = { url: string; chatId: string }

/** Chỉ nhận link mời nhóm zalo.me/g/... Admin dán link, không gắn sẵn một nhóm. */
export function canonicalZaloGroupUrl(input: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try { url = new URL(withScheme) } catch { return null }
  if (!/^(www\.)?zalo\.me$/i.test(url.hostname)) return null
  const match = url.pathname.match(/^\/g\/([A-Za-z0-9_-]+)/)
  if (!match) return null
  return `https://zalo.me/g/${match[1]}`
}

export function parseZaloOverdueGroups(raw: string): ZaloOverdueGroup[] {
  try {
    const data = JSON.parse(raw || '[]')
    if (!Array.isArray(data)) return []
    const out: ZaloOverdueGroup[] = []
    for (const row of data) {
      const url = canonicalZaloGroupUrl(String(row?.url || '')) || ''
      const chatId = String(row?.chatId || row?.chat_id || '').trim()
      if (!url && !chatId) continue
      if (url && out.some((g) => g.url === url)) continue
      out.push({ url, chatId })
    }
    return out
  } catch {
    return []
  }
}

export function addZaloGroupLink(groups: ZaloOverdueGroup[], input: string): ZaloOverdueGroup[] | null {
  const url = canonicalZaloGroupUrl(input)
  if (!url) return null
  if (groups.some((g) => g.url === url)) return groups
  if (groups.length === 1 && groups[0].chatId && !groups[0].url) return [{ url, chatId: groups[0].chatId }]
  return [...groups, { url, chatId: '' }]
}

export function assignZaloGroupChat(groups: ZaloOverdueGroup[], targetUrl: string, chatId: string): ZaloOverdueGroup[] {
  const url = canonicalZaloGroupUrl(targetUrl) || ''
  const id = String(chatId || '').trim()
  if (!url || !id) return groups
  const base = groups.some((g) => g.url === url) ? groups : [...groups, { url, chatId: '' }]
  return base.map((g) => {
    if (g.url === url) return { ...g, chatId: id }
    if (g.chatId === id) return { ...g, chatId: '' }
    return g
  })
}

export function latestZaloPrivateChatId(payload: unknown): string | null {
  const chats = collectZaloChats(payload)
  for (let i = chats.length - 1; i >= 0; i--) {
    if (chats[i].kind === 'private') return chats[i].id
  }
  return null
}
