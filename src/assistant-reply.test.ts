import { describe, expect, it } from 'vitest'
import {
  assistantDraftFromModel,
  assistantDraftFromQuestion,
  assistantModelMessages,
  assistantSystemPrompt,
  clampAssistantHistory,
  composeAssistantPlain,
  polishAssistantReply,
  renderAssistantPack,
  type AssistantFactPack,
} from './index'

function section(extra: Partial<AssistantFactPack['tasks']> = {}): AssistantFactPack['tasks'] {
  return { allowed: true, denial: null, total: 0, lines: [], ...extra }
}

function pack(extra: Partial<AssistantFactPack> = {}): AssistantFactPack {
  return {
    named: true,
    scopeLabel: 'BOD',
    scopeProjects: [{ id: 4, code: 'BOD', name: 'Tòa nhà A', status: 'active' }],
    deniedProject: null,
    projects: section({ total: 1, lines: ['BOD — Tòa nhà A — Đang chạy'] }),
    tasks: section({
      total: 2,
      overdueTotal: 2,
      lines: [
        '«Mô hình kiến trúc» của Nguyễn A, Đang làm, hạn 01/10, trễ hạn, dự án BOD',
        '«Bản vẽ MEP» của Trần B, Đang làm, hạn 03/10, trễ hạn, dự án BOD',
      ],
    }),
    timesheets: section(),
    leave: section(),
    legal: section(),
    money: section({ allowed: false, denial: 'Doanh thu chỉ System Admin xem được.' }),
    articles: section(),
    ...extra,
  }
}

describe('assistant model contract', () => {
  it('prompt buộc giọng tiếng Việt và cấm mã trạng thái', () => {
    const prompt = assistantSystemPrompt('2026-10-08')
    expect(prompt).toContain('xưng "bạn"')
    expect(prompt).toContain('Không để mã in_progress, todo, processing')
    expect(prompt).toContain('01/10')
    expect(prompt).toContain('Chưa thấy việc nào khớp trong phần bạn được xem.')
    expect(prompt).toContain('Chưa có tài liệu.')
    expect(prompt).toContain('Số liệu lấy từ gói lần này')
    expect(prompt).toContain('"kind":"answer"')
    expect(prompt).toContain('timesheet')
    expect(prompt).toContain('Hôm nay là 2026-10-08')
    expect(prompt).not.toContain('password_hash')
    expect(prompt).not.toContain('salary_monthly')
  })

  it('gói gửi cho model có từ chối tiền và không có cột nhạy cảm', () => {
    const facts = pack()
    facts.tasks.lines.push('dòng password_hash salary_monthly')
    const text = renderAssistantPack(facts)
    expect(text).toContain('Doanh thu chỉ System Admin xem được.')
    expect(text).toContain('tổng 2')
    expect(text).toContain('trễ hạn: 2')
    expect(text).not.toMatch(/password_hash|salary_monthly|contract_value/)
    expect(text).not.toMatch(/\d[\d.\s]*đ/)
  })

  it('tin nhắn model gồm gói, lịch sử đã cắt, và câu hỏi', () => {
    const history = clampAssistantHistory([
      ...Array.from({ length: 8 }, (_, i) => ({ role: 'user', content: `câu ${i} ` + 'x'.repeat(900) })),
    ])
    expect(history).toHaveLength(6)
    expect(history[0].content.startsWith('câu 2')).toBe(true)
    expect(history[0].content.length).toBeLessThanOrEqual(800)
    const messages = assistantModelMessages('task trễ của dự án BOD', pack(), history, '2026-10-08')
    expect(messages[0].role).toBe('system')
    expect(messages).toHaveLength(8)
    const user = messages[messages.length - 1].content
    expect(user).toContain('«Mô hình kiến trúc»')
    expect(user).toContain('task trễ của dự án BOD')
    expect(user).not.toContain('in_progress')
    expect(user).not.toContain('2026-10-01')
  })

  it('câu ghép không khóa AI mở bằng số việc trễ và hạn ngày/tháng', () => {
    const reply = composeAssistantPlain('task trễ của dự án BOD', pack())
    expect(reply.startsWith('Bạn có 2 việc trễ hạn ở BOD.')).toBe(true)
    expect(reply).toContain('«Mô hình kiến trúc» của Nguyễn A')
    expect(reply).toContain('hạn 01/10')
    expect(reply).toContain('Đang làm')
    expect(reply).not.toMatch(/in_progress|todo|processing|2026-10-01/)
  })

  it('từ chối doanh thu không kèm số tiền', () => {
    const reply = composeAssistantPlain('doanh thu dự án BOD', pack())
    expect(reply).toContain('Doanh thu chỉ System Admin xem được.')
    expect(reply).toContain('task của mình hoặc phép của mình')
    expect(reply).not.toMatch(/\d[\d.\s]*đ/)
  })

  it('đánh bóng câu model: bỏ mã trạng thái, ngày ISO và tên cột', () => {
    const raw = '- [BOD] Mô hình kiến trúc — Nguyễn A — in_progress — hạn 2026-10-01 — trễ password_hash'
    const reply = polishAssistantReply(raw)
    expect(reply).toContain('đang làm')
    expect(reply).toContain('01/10')
    expect(reply).not.toMatch(/in_progress|2026-10-01|password_hash/)
  })

  it('JSON timesheet của model thành bản nháp, chưa ghi', () => {
    const shaped = assistantDraftFromModel(
      {
        kind: 'timesheet',
        reply: 'in_progress 2026-10-08',
        project_code: 'BOD',
        work_date: '2026-10-08',
        regular_hours: 8,
        description: 'họp',
      },
      [{ id: 4, code: 'BOD', name: 'Tòa nhà A' }],
      'fallback',
    )
    expect(shaped.draft?.kind).toBe('timesheet')
    expect(shaped.draft?.payload).toMatchObject({
      project_id: 4,
      work_date: '2026-10-08',
      regular_hours: 8,
    })
    expect(shaped.reply).toContain('ngày 08/10')
    expect(shaped.reply).toContain('8 giờ')
    expect(shaped.reply).toContain('Bấm xác nhận để ghi.')
    expect(shaped.reply).not.toMatch(/in_progress|2026-10-08/)
    expect(shaped).not.toHaveProperty('result')
  })

  it('mã dự án ngoài gói không tạo nháp', () => {
    const shaped = assistantDraftFromModel(
      { kind: 'task', project_code: 'HIDDEN', title: 'Vẽ', regular_hours: 0 },
      [{ id: 4, code: 'BOD', name: 'Tòa nhà A' }],
      'Không thấy dự án đó trong các dự án bạn được vào.',
    )
    expect(shaped.draft).toBeUndefined()
    expect(shaped.reply).toContain('Không thấy dự án')
  })

  it('câu chấm công đủ mã, ngày và giờ thành bản nháp khi model không trả JSON', () => {
    const shaped = assistantDraftFromQuestion(
      'Chấm công hôm nay dự án BOD 8 giờ',
      [{ id: 4, code: 'BOD', name: 'Tòa nhà A' }],
      '2026-10-09',
    )
    expect(shaped?.draft?.kind).toBe('timesheet')
    expect(shaped?.draft?.payload).toMatchObject({
      project_id: 4,
      work_date: '2026-10-09',
      regular_hours: 8,
    })
    expect(shaped?.reply).toContain('Bấm xác nhận để ghi.')
    expect(shaped?.reply).toContain('ngày 09/10')
  })

  it('câu tạo task đủ mã thành bản nháp, thiếu giờ chấm công thì hỏi lại', () => {
    const task = assistantDraftFromQuestion(
      'Tạo task trong BOD Kiểm tra mô hình',
      [{ id: 4, code: 'BOD', name: 'Tòa nhà A' }],
      '2026-10-09',
    )
    expect(task?.draft?.kind).toBe('task')
    expect(task?.draft?.payload).toMatchObject({ project_id: 4, title: 'Kiểm tra mô hình' })
    const incomplete = assistantDraftFromQuestion(
      'Chấm công hôm nay dự án BOD',
      [{ id: 4, code: 'BOD', name: 'Tòa nhà A' }],
      '2026-10-09',
    )
    expect(incomplete?.draft).toBeUndefined()
    expect(incomplete?.reply).toContain('mã dự án, ngày và số giờ')
  })
})
