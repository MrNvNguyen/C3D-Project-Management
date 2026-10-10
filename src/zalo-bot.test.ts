import { describe, expect, it } from 'vitest'
import { addZaloGroupLink, assignZaloGroupChat, canonicalZaloGroupUrl, collectZaloChats, inspectZaloWebhook, latestZaloGroupChatId, latestZaloPrivateChatId, zaloUpdatesBlocked } from './zalo-bot'

describe('zalo bot chat id', () => {
  it('does not treat a private bot chat as the group', () => {
    const payload = {
      message: {
        text: 'Hi',
        from: { id: 'user-1', type: 'private' },
        chat: { id: '3d682723576abe34e77b', chat_type: 'PRIVATE' },
      },
    }
    expect(latestZaloGroupChatId(payload)).toBeNull()
    expect(latestZaloPrivateChatId(payload)).toBe('3d682723576abe34e77b')
    expect(collectZaloChats(payload).map((c) => c.id)).not.toContain('user-1')
  })

  it('keeps the latest group chat when updates also contain a private chat', () => {
    const payload = {
      ok: true,
      result: [
        { message: { chat: { id: 'priv', type: 'private' }, text: 'test' } },
        { message: { chat: { id: 'group-a', chat_type: 'GROUP' }, text: 'trong nhóm' } },
        { message: { chat: { id: 'group-b', type: 'group' }, text: 'tin sau' } },
      ],
    }
    expect(latestZaloGroupChatId(payload)).toBe('group-b')
  })

  it('treats getUpdates as blocked while a webhook URL is set', () => {
    expect(zaloUpdatesBlocked({ ok: false, description: 'Conflict: webhook is active' }, 'https://ddcn.bimonecadvn.com/api/zalo/webhook')).toBe(true)
    expect(zaloUpdatesBlocked({ ok: false, description: 'unauthorized' }, '')).toBe(false)
    expect(zaloUpdatesBlocked({ ok: true, result: [] }, 'https://example.com/hook')).toBe(false)
  })

  it('accepts a pasted zalo group link and keeps several groups', () => {
    expect(canonicalZaloGroupUrl('zalo.me/g/bvk8cticxyywemhdpvqx')).toBe('https://zalo.me/g/bvk8cticxyywemhdpvqx')
    expect(canonicalZaloGroupUrl('https://example.com/g/abc')).toBeNull()
    const first = addZaloGroupLink([], 'https://zalo.me/g/one')
    const both = addZaloGroupLink(first || [], 'zalo.me/g/two')
    expect(both?.map((g) => g.url)).toEqual(['https://zalo.me/g/one', 'https://zalo.me/g/two'])
    const assigned = assignZaloGroupChat(both || [], 'https://zalo.me/g/two', 'chat-2')
    expect(assigned.find((g) => g.url.endsWith('/two'))?.chatId).toBe('chat-2')
    const inserted = assignZaloGroupChat([], 'https://zalo.me/g/bvk8cticxyywemhdpvqx', 'group-chat')
    expect(inserted).toEqual([{ url: 'https://zalo.me/g/bvk8cticxyywemhdpvqx', chatId: 'group-chat' }])
  })

  it('reads a webhook event that is the update itself', () => {
    const payload = {
      event_name: 'message.text.received',
      message: { chat: { id: 'nhom-1', chat_type: 'Group' }, text: 'xin chào nhóm' },
    }
    expect(latestZaloGroupChatId(payload)).toBe('nhom-1')
  })

  it('unwraps a stringified webhook and does not keep the message text', () => {
    const raw = JSON.stringify({
      ok: true,
      result: JSON.stringify({
        event_name: 'message.text.received',
        message: { chat: { id: 'nhom-9', chat_type: 'GROUP' }, text: 'noi dung bi mat' },
      }),
    })
    const inspected = inspectZaloWebhook(raw)
    expect(inspected.event).toBe('message.text.received')
    expect(latestZaloGroupChatId(inspected.body)).toBe('nhom-9')
    expect(inspected.shape).not.toMatch(/noi dung/)
    expect(inspectZaloWebhook('').empty).toBe(true)
  })
})
