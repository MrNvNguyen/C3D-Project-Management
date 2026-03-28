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
  RESEND_API_KEY: string
}

// ===================================================
// EMAIL SERVICE (Resend API)
// ===================================================

// ---- Email Templates ----
function emailBase(title: string, body: string): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="vi">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
<!-- Outer wrapper -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <!-- Email card -->
      <table width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">

        <!-- HEADER -->
        <tr>
          <td style="background-color:#00A651;padding:28px 36px;" bgcolor="#00A651">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <!-- Logo badge -->
                  <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
                    <tr>
                      <td style="background-color:#007a3d;border-radius:6px;padding:4px 12px;">
                        <span style="color:#ffffff;font-size:11px;font-weight:bold;letter-spacing:1.5px;font-family:Arial,Helvetica,sans-serif;">ONECAD BIM</span>
                      </td>
                    </tr>
                  </table>
                  <!-- Title -->
                  <p style="margin:0 0 4px 0;color:#ffffff;font-size:22px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;line-height:1.3;">${title}</p>
                  <p style="margin:0;color:#ccf0dd;font-size:13px;font-family:Arial,Helvetica,sans-serif;">Hệ thống quản lý dự án BIM chuyên nghiệp</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:32px 36px;background-color:#ffffff;" bgcolor="#ffffff">
            ${body}
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:20px 36px 28px;background-color:#f8fafb;border-top:1px solid #e5e7eb;" bgcolor="#f8fafb">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">
              Email này được gửi tự động từ <strong style="color:#6b7280;">OneCad BIM System</strong>.<br/>
              Để thay đổi cài đặt thông báo, vui lòng truy cập <a href="#" style="color:#00A651;text-decoration:none;">Hồ sơ cá nhân → Cài đặt Email</a>.<br/>
              © 2024 OneCad Vietnam. All rights reserved.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

function statusBadge(status: string): string {
  const map: Record<string, [string, string, string]> = {
    'todo':        ['#f3f4f6','#4b5563', '📋 Chờ làm'],
    'in_progress': ['#dbeafe','#1d4ed8', '🔄 Đang làm'],
    'review':      ['#ffedd5','#c2410c', '👀 Đang review'],
    'done':        ['#dcfce7','#16a34a', '✅ Hoàn thành'],
    'overdue':     ['#fee2e2','#dc2626', '⚠️ Quá hạn'],
    'approved':    ['#dcfce7','#16a34a', '✅ Đã duyệt'],
    'rejected':    ['#fee2e2','#dc2626', '❌ Từ chối'],
    'pending':     ['#ffedd5','#c2410c', '⏳ Chờ duyệt'],
  }
  const [bg, color, label] = map[status] || ['#f3f4f6','#4b5563', status]
  return `<span style="display:inline-block;background-color:${bg};color:${color};padding:3px 10px;border-radius:4px;font-size:12px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${label}</span>`
}

// Helper: render card block (Outlook-safe)
function emailCard(label: string, value: string, borderColor: string = '#00A651'): string {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
    <tr>
      <td style="background-color:#f8fafb;border-left:4px solid ${borderColor};border-radius:0 6px 6px 0;padding:14px 18px;" bgcolor="#f8fafb">
        <p style="margin:0 0 4px 0;font-size:11px;color:#888888;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,Helvetica,sans-serif;">${label}</p>
        <p style="margin:0;font-size:15px;color:#1a1a1a;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${value}</p>
      </td>
    </tr>
  </table>`
}

// Helper: render meta tags row (Outlook-safe, using table instead of flex)
function emailMeta(items: Array<{label: string; value: string}>): string {
  const cells = items.map(it => `
    <td style="padding:0 6px 8px 0;vertical-align:top;">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="background-color:#f3f4f6;border-radius:5px;padding:6px 10px;font-size:12px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">
            <strong style="color:#374151;">${it.label}:</strong> ${it.value}
          </td>
        </tr>
      </table>
    </td>`).join('')
  return `
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
    <tr>${cells}</tr>
  </table>`
}

// Helper: divider
function emailDivider(): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</td></tr></table>`
}

function emailTemplates(type: string, data: Record<string, any>): { subject: string; html: string } {
  switch (type) {

    case 'task_assigned': {
      const metaItems = [
        { label: 'Dự án', value: data.projectName || 'N/A' },
        { label: 'Bộ môn', value: data.discipline || 'N/A' },
        { label: 'Ưu tiên', value: data.priority || 'Normal' },
        ...(data.deadline ? [{ label: 'Hạn', value: '📅 ' + data.deadline }] : []),
      ]
      const body = `
        <p style="margin:0 0 8px 0;color:#374151;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Xin chào <strong>${data.recipientName}</strong>,</p>
        <p style="margin:0 0 4px 0;color:#6b7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Bạn vừa được giao một task mới trong hệ thống OneCad BIM.</p>
        ${emailCard('Tên Task', '📌 ' + data.taskTitle)}
        ${emailMeta(metaItems)}
        ${data.description ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr><td style="background-color:#f9fafb;border-radius:6px;padding:12px 16px;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;font-style:italic;">${data.description}</td></tr></table>` : ''}
        <p style="color:#6b7280;font-size:13px;font-family:Arial,Helvetica,sans-serif;margin-top:12px;">Người giao: <strong style="color:#374151;">${data.assignedBy || 'N/A'}</strong></p>
        ${emailDivider()}
        <p style="margin:0;color:#374151;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Vui lòng đăng nhập hệ thống để xem chi tiết và bắt đầu thực hiện task.</p>`
      return {
        subject: `[OneCad BIM] 📌 Task mới: ${data.taskTitle}`,
        html: emailBase(`📌 Bạn được giao task mới`, body)
      }
    }

    case 'task_status_updated': {
      const metaItems = [
        { label: 'Trạng thái mới', value: statusBadge(data.newStatus) },
        ...(data.oldStatus ? [{ label: 'Trước đó', value: statusBadge(data.oldStatus) }] : []),
        { label: 'Dự án', value: data.projectName || 'N/A' },
        { label: 'Cập nhật bởi', value: data.updatedBy || 'N/A' },
      ]
      const body = `
        <p style="margin:0 0 8px 0;color:#374151;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Xin chào <strong>${data.recipientName}</strong>,</p>
        <p style="margin:0 0 4px 0;color:#6b7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Trạng thái task của bạn vừa được cập nhật.</p>
        ${emailCard('Task', '📌 ' + data.taskTitle)}
        ${emailMeta(metaItems)}
        ${data.comment ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr><td style="background-color:#f9fafb;border-radius:6px;padding:12px 16px;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;font-style:italic;">Ghi chú: ${data.comment}</td></tr></table>` : ''}
        ${emailDivider()}
        <p style="margin:0;color:#374151;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Đăng nhập để xem chi tiết task.</p>`
      return {
        subject: `[OneCad BIM] 🔄 Task cập nhật: ${data.taskTitle}`,
        html: emailBase(`🔄 Cập nhật trạng thái Task`, body)
      }
    }

    case 'task_overdue': {
      const metaItems = [
        { label: 'Dự án', value: data.projectName || 'N/A' },
        { label: 'Hạn chót', value: '📅 ' + data.deadline },
        { label: 'Quá hạn', value: `<span style="color:#dc2626;font-weight:bold;">${data.daysOverdue} ngày</span>` },
        { label: 'Trạng thái', value: statusBadge(data.status || 'in_progress') },
      ]
      const body = `
        <p style="margin:0 0 8px 0;color:#374151;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Xin chào <strong>${data.recipientName}</strong>,</p>
        <p style="margin:0 0 4px 0;color:#dc2626;font-size:14px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">⚠️ Task sau đây đã quá hạn và cần được xử lý ngay!</p>
        ${emailCard('Task quá hạn', '⏰ ' + data.taskTitle, '#dc2626')}
        ${emailMeta(metaItems)}
        ${emailDivider()}
        <p style="margin:0;color:#dc2626;font-size:13px;font-family:Arial,Helvetica,sans-serif;">Vui lòng cập nhật tiến độ hoặc liên hệ Project Leader để điều chỉnh deadline.</p>`
      return {
        subject: `[OneCad BIM] ⚠️ TASK QUÁ HẠN: ${data.taskTitle}`,
        html: emailBase(`⚠️ Cảnh báo Task Quá Hạn`, body)
      }
    }

    case 'project_added': {
      const metaItems = [
        { label: 'Vai trò', value: data.role || 'Member' },
        ...(data.projectCode ? [{ label: 'Mã dự án', value: data.projectCode }] : []),
        ...(data.startDate ? [{ label: 'Bắt đầu', value: data.startDate }] : []),
        ...(data.endDate ? [{ label: 'Kết thúc', value: data.endDate }] : []),
      ]
      const body = `
        <p style="margin:0 0 8px 0;color:#374151;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Xin chào <strong>${data.recipientName}</strong>,</p>
        <p style="margin:0 0 4px 0;color:#6b7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Bạn vừa được thêm vào một dự án mới trên hệ thống OneCad BIM.</p>
        ${emailCard('Tên Dự án', '🏗️ ' + data.projectName)}
        ${emailMeta(metaItems)}
        ${data.description ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr><td style="background-color:#f9fafb;border-radius:6px;padding:12px 16px;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;font-style:italic;">${data.description}</td></tr></table>` : ''}
        ${emailDivider()}
        <p style="margin:0;color:#374151;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Đăng nhập hệ thống để xem thông tin dự án và các task được giao.</p>`
      return {
        subject: `[OneCad BIM] 🏗️ Bạn được thêm vào dự án: ${data.projectName}`,
        html: emailBase(`🏗️ Tham gia Dự án Mới`, body)
      }
    }

    case 'timesheet_reviewed': {
      const isApproved = data.action === 'approved'
      const metaItems = [
        { label: 'Dự án', value: data.projectName || 'N/A' },
        { label: 'Giờ HC', value: (data.hoursHC || 0) + 'h' },
        { label: 'Tổng giờ', value: (data.totalHours || 0) + 'h' },
        { label: 'Trạng thái', value: statusBadge(isApproved ? 'approved' : 'rejected') },
      ]
      const body = `
        <p style="margin:0 0 8px 0;color:#374151;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Xin chào <strong>${data.recipientName}</strong>,</p>
        <p style="margin:0 0 4px 0;color:#6b7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Timesheet của bạn vừa được ${isApproved ? '<strong style="color:#16a34a;">phê duyệt ✅</strong>' : '<strong style="color:#dc2626;">từ chối ❌</strong>'}.</p>
        ${emailCard('Ngày chấm công', '📅 ' + data.date, isApproved ? '#16a34a' : '#dc2626')}
        ${emailMeta(metaItems)}
        ${data.note ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr><td style="background-color:#f9fafb;border-radius:6px;padding:12px 16px;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;font-style:italic;">Ghi chú từ quản lý: ${data.note}</td></tr></table>` : ''}
        ${emailDivider()}
        <p style="margin:0;color:#6b7280;font-size:13px;font-family:Arial,Helvetica,sans-serif;">Duyệt bởi: <strong style="color:#374151;">${data.reviewedBy || 'N/A'}</strong></p>`
      return {
        subject: `[OneCad BIM] ${isApproved ? '✅ Timesheet được duyệt' : '❌ Timesheet bị từ chối'} - ${data.date}`,
        html: emailBase(`${isApproved ? '✅ Timesheet được phê duyệt' : '❌ Timesheet bị từ chối'}`, body)
      }
    }

    case 'payment_request_new': {
      const metaItems = [
        { label: 'Dự án', value: data.projectName || 'N/A' },
        { label: 'Số tiền', value: `<span style="color:#00A651;font-weight:bold;">${data.amount}</span>` },
        { label: 'Người đề nghị', value: data.requestedBy || 'N/A' },
        { label: 'Ngày', value: data.date || 'N/A' },
      ]
      const body = `
        <p style="margin:0 0 8px 0;color:#374151;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Xin chào <strong>${data.recipientName}</strong>,</p>
        <p style="margin:0 0 4px 0;color:#6b7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Có một đề nghị thanh toán mới cần xem xét.</p>
        ${emailCard('Tiêu đề', '💰 ' + data.title)}
        ${emailMeta(metaItems)}
        ${data.description ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr><td style="background-color:#f9fafb;border-radius:6px;padding:12px 16px;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;font-style:italic;">${data.description}</td></tr></table>` : ''}
        ${emailDivider()}
        <p style="margin:0;color:#374151;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Vui lòng đăng nhập để xem xét và phê duyệt đề nghị thanh toán này.</p>`
      return {
        subject: `[OneCad BIM] 💰 Đề nghị thanh toán mới: ${data.title}`,
        html: emailBase(`💰 Đề Nghị Thanh Toán Mới`, body)
      }
    }

    case 'chat_message': {
      const body = `
        <p style="margin:0 0 8px 0;color:#374151;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Xin chào <strong>${data.recipientName}</strong>,</p>
        <p style="margin:0 0 4px 0;color:#6b7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;"><strong style="color:#374151;">${data.senderName}</strong> vừa gửi tin nhắn ${data.contextType === 'task' ? 'trong task' : 'trong dự án'}:</p>
        ${emailCard(data.contextType === 'task' ? '📌 Task' : '🏗️ Dự án', data.contextName)}
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">
          <tr>
            <td style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px 18px;">
              <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">"${data.message}"</p>
            </td>
          </tr>
        </table>
        ${emailDivider()}
        <p style="margin:0;color:#374151;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Đăng nhập để xem và phản hồi tin nhắn này.</p>`
      return {
        subject: `[OneCad BIM] 💬 ${data.senderName}: "${data.message?.slice(0,40)}${data.message?.length > 40 ? '…' : ''}"`,
        html: emailBase(`💬 Tin nhắn mới`, body)
      }
    }

    case 'chat_mention': {
      const body = `
        <p style="margin:0 0 8px 0;color:#374151;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Xin chào <strong>${data.recipientName}</strong>,</p>
        <p style="margin:0 0 4px 0;color:#6b7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;"><strong style="color:#374151;">${data.senderName}</strong> đã nhắc đến bạn trong một cuộc trò chuyện.</p>
        ${emailCard(data.contextType === 'task' ? '📌 Task' : '🏗️ Dự án', data.contextName)}
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">
          <tr>
            <td style="background-color:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:14px 18px;">
              <p style="margin:0;color:#15803d;font-size:14px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;font-style:italic;">"${data.message}"</p>
            </td>
          </tr>
        </table>
        ${emailDivider()}
        <p style="margin:0;color:#374151;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Đăng nhập để phản hồi tin nhắn này.</p>`
      return {
        subject: `[OneCad BIM] 💬 ${data.senderName} đã nhắc đến bạn`,
        html: emailBase(`💬 Bạn được @mention`, body)
      }
    }

    case 'project_created': {
      const statusLabels: Record<string, string> = {
        planning: 'Lên kế hoạch', active: 'Đang triển khai', on_hold: 'Tạm dừng', completed: 'Hoàn thành', cancelled: 'Đã hủy'
      }
      const metaItems = [
        ...(data.projectCode ? [{ label: 'Mã DA', value: data.projectCode }] : []),
        ...(data.projectType ? [{ label: 'Loại', value: data.projectType }] : []),
        ...(data.client ? [{ label: 'Chủ đầu tư', value: data.client }] : []),
        ...(data.status ? [{ label: 'Trạng thái', value: statusLabels[data.status] || data.status }] : []),
        ...(data.startDate ? [{ label: 'Bắt đầu', value: '📅 ' + data.startDate }] : []),
        ...(data.endDate ? [{ label: 'Kết thúc', value: '📅 ' + data.endDate }] : []),
        ...(data.location ? [{ label: 'Địa điểm', value: '📍 ' + data.location }] : []),
      ]
      const body = `
        <p style="margin:0 0 8px 0;color:#374151;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Xin chào <strong>${data.recipientName}</strong>,</p>
        <p style="margin:0 0 4px 0;color:#6b7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Một dự án mới vừa được tạo trên hệ thống OneCad BIM.</p>
        ${emailCard('Tên Dự án', '🏗️ ' + data.projectName)}
        ${metaItems.length ? emailMeta(metaItems) : ''}
        ${data.description ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr><td style="background-color:#f9fafb;border-radius:6px;padding:12px 16px;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;font-style:italic;">${data.description}</td></tr></table>` : ''}
        <p style="color:#6b7280;font-size:13px;font-family:Arial,Helvetica,sans-serif;margin-top:8px;">Người tạo: <strong style="color:#374151;">${data.createdBy || 'N/A'}</strong></p>
        ${emailDivider()}
        <p style="margin:0;color:#374151;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Đăng nhập hệ thống để xem chi tiết và quản lý dự án.</p>`
      return {
        subject: `[OneCad BIM] 🏗️ Dự án mới: ${data.projectName}`,
        html: emailBase(`🏗️ Dự án Mới Được Tạo`, body)
      }
    }

    case 'project_status_changed': {
      const pStatusLabels: Record<string, [string, string, string]> = {
        planning:   ['#f3f4f6','#4b5563', '📋 Lên kế hoạch'],
        active:     ['#dcfce7','#16a34a', '🚀 Đang triển khai'],
        on_hold:    ['#ffedd5','#c2410c', '⏸️ Tạm dừng'],
        completed:  ['#dcfce7','#16a34a', '✅ Hoàn thành'],
        cancelled:  ['#fee2e2','#dc2626', '❌ Đã hủy'],
      }
      const [, , newLabel] = pStatusLabels[data.newStatus] || ['#f3f4f6','#4b5563', data.newStatus]
      const [, , oldLabel] = pStatusLabels[data.oldStatus] || ['#f3f4f6','#4b5563', data.oldStatus]
      const [nb, nc] = pStatusLabels[data.newStatus] || ['#f3f4f6','#4b5563']
      const [ob, oc] = pStatusLabels[data.oldStatus] || ['#f3f4f6','#4b5563']
      const isCompleted = data.newStatus === 'completed'
      const metaItems = [
        { label: 'Trạng thái mới', value: `<span style="display:inline-block;background-color:${nb};color:${nc};padding:3px 10px;border-radius:4px;font-size:12px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${newLabel}</span>` },
        ...(data.oldStatus ? [{ label: 'Trước đó', value: `<span style="display:inline-block;background-color:${ob};color:${oc};padding:3px 10px;border-radius:4px;font-size:12px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${oldLabel}</span>` }] : []),
        { label: 'Cập nhật bởi', value: data.updatedBy || 'N/A' },
      ]
      const body = `
        <p style="margin:0 0 8px 0;color:#374151;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Xin chào <strong>${data.recipientName}</strong>,</p>
        <p style="margin:0 0 4px 0;color:#6b7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Trạng thái dự án bạn tham gia vừa được thay đổi.</p>
        ${emailCard('Dự án', '🏗️ ' + data.projectName, isCompleted ? '#16a34a' : '#00A651')}
        ${emailMeta(metaItems)}
        ${data.note ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr><td style="background-color:#f9fafb;border-radius:6px;padding:12px 16px;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;font-style:italic;">Ghi chú: ${data.note}</td></tr></table>` : ''}
        ${emailDivider()}
        <p style="margin:0;color:#374151;font-size:14px;font-family:Arial,Helvetica,sans-serif;">${isCompleted ? '🎉 Chúc mừng dự án đã hoàn thành! Cảm ơn sự đóng góp của tất cả thành viên.' : 'Đăng nhập hệ thống để xem chi tiết dự án.'}</p>`
      return {
        subject: `[OneCad BIM] 🔄 Dự án "${data.projectName}" chuyển sang ${newLabel}`,
        html: emailBase(`🔄 Thay đổi Trạng thái Dự án`, body)
      }
    }

    case 'payment_status_changed': {
      const payStatusLabels: Record<string, [string, string, string]> = {
        pending:    ['#ffedd5','#c2410c', '⏳ Chờ xử lý'],
        processing: ['#dbeafe','#1d4ed8', '🔄 Đang xử lý'],
        partial:    ['#ffedd5','#c2410c', '💰 Thanh toán một phần'],
        paid:       ['#dcfce7','#16a34a', '✅ Đã thanh toán'],
        rejected:   ['#fee2e2','#dc2626', '❌ Từ chối'],
      }
      const [nb2, nc2, newLabel2] = payStatusLabels[data.newStatus] || ['#f3f4f6','#4b5563', data.newStatus]
      const [ob2, oc2, oldLabel2] = payStatusLabels[data.oldStatus] || ['#f3f4f6','#4b5563', data.oldStatus]
      const isPaid = data.newStatus === 'paid'
      const borderColor = isPaid ? '#16a34a' : data.newStatus === 'rejected' ? '#dc2626' : '#00A651'
      const metaItems = [
        { label: 'Dự án', value: data.projectName || 'N/A' },
        { label: 'Số tiền', value: `<span style="color:#00A651;font-weight:bold;">${data.amount || 'N/A'}</span>` },
        { label: 'Trạng thái mới', value: `<span style="display:inline-block;background-color:${nb2};color:${nc2};padding:3px 10px;border-radius:4px;font-size:12px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${newLabel2}</span>` },
        ...(data.oldStatus ? [{ label: 'Trước đó', value: `<span style="display:inline-block;background-color:${ob2};color:${oc2};padding:3px 10px;border-radius:4px;font-size:12px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${oldLabel2}</span>` }] : []),
        ...(data.paidAmount ? [{ label: 'Đã thanh toán', value: data.paidAmount }] : []),
        ...(data.paidDate ? [{ label: 'Ngày TT', value: '📅 ' + data.paidDate }] : []),
        { label: 'Cập nhật bởi', value: data.updatedBy || 'N/A' },
      ]
      const body = `
        <p style="margin:0 0 8px 0;color:#374151;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Xin chào <strong>${data.recipientName}</strong>,</p>
        <p style="margin:0 0 4px 0;color:#6b7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Trạng thái đề nghị thanh toán của bạn vừa được cập nhật.</p>
        ${emailCard('Đề nghị thanh toán', '💰 ' + data.description, borderColor)}
        ${emailMeta(metaItems)}
        ${data.notes ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr><td style="background-color:#f9fafb;border-radius:6px;padding:12px 16px;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;font-style:italic;">Ghi chú: ${data.notes}</td></tr></table>` : ''}
        ${emailDivider()}
        <p style="margin:0;color:#374151;font-size:14px;font-family:Arial,Helvetica,sans-serif;">${isPaid ? '✅ Thanh toán đã được xác nhận.' : 'Đăng nhập hệ thống để theo dõi tiến trình thanh toán.'}</p>`
      return {
        subject: `[OneCad BIM] 💰 Thanh toán "${data.description}" → ${newLabel2}`,
        html: emailBase(`💰 Cập nhật Tình trạng Thanh toán`, body)
      }
    }

    case 'member_added_to_project': {
      const metaItems = [
        { label: 'Thành viên mới', value: '👤 ' + data.memberName },
        { label: 'Vai trò', value: data.role || 'Thành viên' },
        { label: 'Phòng ban', value: data.department || 'N/A' },
        { label: 'Thêm bởi', value: data.addedBy || 'N/A' },
      ]
      const body = `
        <p style="margin:0 0 8px 0;color:#374151;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Xin chào <strong>${data.recipientName}</strong>,</p>
        <p style="margin:0 0 4px 0;color:#6b7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Một thành viên mới vừa được thêm vào dự án của bạn.</p>
        ${emailCard('Dự án', '🏗️ ' + data.projectName)}
        ${emailMeta(metaItems)}
        ${emailDivider()}
        <p style="margin:0;color:#374151;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Đăng nhập để xem danh sách thành viên và phân công nhiệm vụ.</p>`
      return {
        subject: `[OneCad BIM] 👤 Thành viên mới trong dự án: ${data.memberName}`,
        html: emailBase(`👤 Thành viên Mới Tham Gia Dự án`, body)
      }
    }

    case 'timesheet_bulk_approved': {
      const metaItems = [
        ...(data.period ? [{ label: 'Kỳ', value: '📅 ' + data.period }] : []),
        { label: 'Duyệt bởi', value: data.reviewedBy || 'N/A' },
      ]
      const body = `
        <p style="margin:0 0 8px 0;color:#374151;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Xin chào <strong>${data.recipientName}</strong>,</p>
        <p style="margin:0 0 4px 0;color:#6b7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Timesheet của bạn vừa được phê duyệt hàng loạt bởi quản lý.</p>
        ${emailCard('Kết quả duyệt', '✅ ' + data.approvedCount + ' timesheet được duyệt', '#16a34a')}
        ${emailMeta(metaItems)}
        ${emailDivider()}
        <p style="margin:0;color:#374151;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Đăng nhập để xem chi tiết timesheet đã được duyệt.</p>`
      return {
        subject: `[OneCad BIM] ✅ ${data.approvedCount} Timesheet được phê duyệt`,
        html: emailBase(`✅ Timesheet Được Phê Duyệt Hàng Loạt`, body)
      }
    }

    default:
      return { subject: '[OneCad BIM] Thông báo mới', html: emailBase('Thông báo', '<p>Bạn có thông báo mới từ OneCad BIM.</p>') }
  }
}

// ---- Core sendEmail function ----
async function sendEmail(env: Bindings, opts: {
  to: string
  toName: string
  eventType: string
  data: Record<string, any>
  db: D1Database
  userId?: number
  relatedType?: string
  relatedId?: number
}): Promise<void> {
  // Try env var first, then fall back to DB config
  let apiKey = env.RESEND_API_KEY
  console.log(`[sendEmail] eventType=${opts.eventType} to=${opts.to} apiKey_env=${apiKey ? 'SET' : 'EMPTY'}`)
  if (!apiKey) {
    const dbConfig = await opts.db.prepare("SELECT value FROM system_config WHERE key = 'resend_api_key'").first() as any
    apiKey = dbConfig?.value || ''
    console.log(`[sendEmail] apiKey from DB: ${apiKey ? 'SET' : 'EMPTY'}`)
  }
  // 4 mandatory events — always send email regardless of user preference
  const MANDATORY_EVENTS = new Set(['task_assigned', 'task_overdue', 'project_added', 'chat_mention'])

  if (!apiKey) {
    console.log(`[sendEmail] ABORT — no RESEND_API_KEY`)
    return
  }

  if (opts.userId && !MANDATORY_EVENTS.has(opts.eventType)) {
    const pref = await opts.db.prepare(
      'SELECT email_enabled, notify_task_updated, notify_project_updated, notify_project_created, notify_timesheet_approved, notify_payment_request, notify_payment_status, notify_member_added FROM email_settings WHERE user_id = ?'
    ).bind(opts.userId).first() as any

    if (pref) {
      if (!pref.email_enabled) return
      const prefMap: Record<string, string> = {
        task_status_updated:      'notify_task_updated',
        project_updated:          'notify_project_updated',
        project_created:          'notify_project_created',
        project_status_changed:   'notify_project_updated',
        timesheet_reviewed:       'notify_timesheet_approved',
        timesheet_bulk_approved:  'notify_timesheet_approved',
        payment_request_new:      'notify_payment_request',
        payment_status_changed:   'notify_payment_status',
        member_added_to_project:  'notify_member_added',
      }
      const prefKey = prefMap[opts.eventType]
      if (prefKey && pref[prefKey] === 0) return   // user turned this off
    }
    // No pref row → use defaults (all enabled)
  }

  const { subject, html } = emailTemplates(opts.eventType, { ...opts.data, recipientName: opts.toName })

  let status = 'sent'
  let errorMsg: string | null = null

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'OneCad BIM <no-reply@bimonecadvn.com>',
        to: [opts.to],
        subject,
        html,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      status = 'failed'
      errorMsg = err.slice(0, 500)
      console.log(`[sendEmail] FAILED HTTP ${res.status}: ${errorMsg}`)
    } else {
      console.log(`[sendEmail] SUCCESS to=${opts.to} event=${opts.eventType}`)
    }
  } catch (e: any) {
    status = 'failed'
    errorMsg = e.message?.slice(0, 500) || 'Unknown error'
    console.log(`[sendEmail] EXCEPTION: ${errorMsg}`)
  }

  // Log to DB (fire and forget)
  try {
    await opts.db.prepare(
      `INSERT INTO email_logs (user_id, to_email, subject, event_type, related_type, related_id, status, error_msg) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(opts.userId || null, opts.to, subject, opts.eventType, opts.relatedType || null, opts.relatedId || null, status, errorMsg).run()
  } catch { /* ignore log error */ }

  // Web Push — fire and forget for mandatory events (requires userId)
  if (opts.userId) {
    const eventIconMap: Record<string, string> = {
      task_assigned:   '📋',
      task_overdue:    '⏰',
      project_added:   '🏗️',
      chat_mention:    '💬',
      chat_message:    '💬',
    }
    const icon = eventIconMap[opts.eventType] || '🔔'
    sendWebPush(opts.db, opts.userId, {
      title:       `${icon} ${subject}`,
      body:        opts.data?.taskTitle || opts.data?.projectName || opts.data?.message || opts.toName,
      tag:         `${opts.eventType}-${opts.relatedId || opts.userId}`,
      url:         '/',
      notifId:     null,
      relatedType: opts.relatedType || null,
      relatedId:   opts.relatedId   || null,
    }).catch(() => { /* silent */ })
  }
}

// ---- Helper: get user email info ----
async function getUserEmailInfo(db: D1Database, userId: number): Promise<{ email: string; full_name: string } | null> {
  const user = await db.prepare('SELECT email, full_name FROM users WHERE id = ? AND is_active = 1').bind(userId).first() as any
  if (!user?.email) return null
  return { email: user.email, full_name: user.full_name }
}

// ---- Ensure email_settings row exists (lazy init) ----
async function ensureEmailSettings(db: D1Database, userId: number): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO email_settings (user_id) VALUES (?)`
  ).bind(userId).run()
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
    // show_inactive=1 only for system_admin (e.g. from the Users management page)
    const showInactive = user.role === 'system_admin' && c.req.query('show_inactive') === '1'
    let query = 'SELECT id, username, full_name, email, phone, role, department, is_active, created_at FROM users'
    if (!showInactive) {
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
    const { username, full_name, email, phone, department, salary_monthly, is_active, role, password } = data

    const updateFields: string[] = []
    const values: any[] = []

    if (full_name !== undefined) { updateFields.push('full_name = ?'); values.push(full_name) }
    if (email !== undefined) { updateFields.push('email = ?'); values.push(email) }
    if (phone !== undefined) { updateFields.push('phone = ?'); values.push(phone) }
    if (department !== undefined) { updateFields.push('department = ?'); values.push(department) }

    // Chỉ system_admin mới được đổi username, role, salary, status
    if (user.role === 'system_admin') {
      if (username !== undefined && username.trim() !== '') {
        // Kiểm tra username chưa tồn tại ở user khác
        const existing = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?')
          .bind(username.trim(), id).first()
        if (existing) return c.json({ error: 'Tên đăng nhập đã tồn tại' }, 400)
        updateFields.push('username = ?'); values.push(username.trim())
      }
      if (role !== undefined) { updateFields.push('role = ?'); values.push(role) }
      if (salary_monthly !== undefined) { updateFields.push('salary_monthly = ?'); values.push(salary_monthly) }
      if (is_active !== undefined) { updateFields.push('is_active = ?'); values.push(is_active) }
    }

    // Đổi mật khẩu (cả admin và user tự đổi)
    if (password && password.trim() !== '') {
      const hashed = await hashPassword(password.trim())
      updateFields.push('password_hash = ?'); values.push(hashed)
    }

    if (updateFields.length === 0) return c.json({ error: 'Không có gì để cập nhật' }, 400)
    updateFields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    await db.prepare(`UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// DELETE /api/users/:id — hard delete: xóa hoàn toàn tài khoản và tất cả dữ liệu liên quan
app.delete('/api/users/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const id = parseInt(c.req.param('id'))

    // Không được tự xóa chính mình
    if (user.id === id) return c.json({ error: 'Không thể tự xóa tài khoản của mình' }, 400)

    // Kiểm tra user tồn tại
    const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first() as any
    if (!target) return c.json({ error: 'Không tìm thấy tài khoản' }, 404)

    // Cascade xóa dữ liệu liên quan — NULL-ify trước, xóa sau để tránh FK constraint

    // 1. NULL-ify các FK trỏ tới user này (các bảng không có ON DELETE CASCADE)
    await db.prepare('UPDATE tasks SET assigned_to = NULL WHERE assigned_to = ?').bind(id).run()
    await db.prepare('UPDATE tasks SET assigned_by = NULL WHERE assigned_by = ?').bind(id).run()
    await db.prepare('UPDATE projects SET admin_id = NULL WHERE admin_id = ?').bind(id).run()
    await db.prepare('UPDATE projects SET leader_id = NULL WHERE leader_id = ?').bind(id).run()
    await db.prepare('UPDATE projects SET created_by = NULL WHERE created_by = ?').bind(id).run()
    await db.prepare('UPDATE categories SET created_by = NULL WHERE created_by = ?').bind(id).run()
    await db.prepare('UPDATE project_costs SET approved_by = NULL WHERE approved_by = ?').bind(id).run()
    await db.prepare('UPDATE project_costs SET created_by = NULL WHERE created_by = ?').bind(id).run()
    await db.prepare('UPDATE project_revenues SET created_by = NULL WHERE created_by = ?').bind(id).run()
    await db.prepare('UPDATE timesheets SET approved_by = NULL WHERE approved_by = ?').bind(id).run()
    await db.prepare('UPDATE assets SET assigned_to = NULL WHERE assigned_to = ?').bind(id).run()
    await db.prepare('UPDATE assets SET created_by = NULL WHERE created_by = ?').bind(id).run()
    await db.prepare('UPDATE asset_history SET from_user = NULL WHERE from_user = ?').bind(id).run()
    await db.prepare('UPDATE asset_history SET to_user = NULL WHERE to_user = ?').bind(id).run()

    // 2. Xóa các bản ghi trực tiếp của user này
    await db.prepare('DELETE FROM timesheets WHERE user_id = ?').bind(id).run()
    await db.prepare('DELETE FROM project_members WHERE user_id = ?').bind(id).run()
    await db.prepare('DELETE FROM notifications WHERE user_id = ?').bind(id).run()
    await db.prepare('DELETE FROM task_history WHERE user_id = ?').bind(id).run()
    await db.prepare('DELETE FROM asset_history WHERE user_id = ?').bind(id).run()

    // 3. Xóa user
    await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run()

    return c.json({ success: true, message: `Đã xóa tài khoản "${target.full_name}"` })
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

    // Trả về my_project_role: role của user hiện tại trong từng project (từ project_members)
    // Dùng để frontend populate _projectRoleCache mà không cần gọi thêm API
    let query = `
      SELECT p.*, 
        u1.full_name as admin_name, 
        u2.full_name as leader_name,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as total_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'completed') as completed_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.is_overdue = 1) as overdue_tasks,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as member_count,
        (SELECT pm2.role FROM project_members pm2 WHERE pm2.project_id = p.id AND pm2.user_id = ${user.id} LIMIT 1) as my_project_role
      FROM projects p
      LEFT JOIN users u1 ON p.admin_id = u1.id
      LEFT JOIN users u2 ON p.leader_id = u2.id
    `

    if (user.role !== 'system_admin') {
      query += ` WHERE p.id IN (SELECT project_id FROM project_members WHERE user_id = ?) OR p.admin_id = ? OR p.leader_id = ?`
      const result = await db.prepare(query).bind(user.id, user.id, user.id).all()
      // Tính effective my_project_role (bao gồm admin_id / leader_id)
      const masked = (result.results as any[]).map(p => {
        let myRole = (p as any).my_project_role || null
        if ((p as any).admin_id === user.id) myRole = higherRole(myRole || 'member', 'project_admin')
        if ((p as any).leader_id === user.id) myRole = higherRole(myRole || 'member', 'project_leader')
        return { ...p, contract_value: undefined, budget: undefined, my_project_role: myRole }
      })
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
    // Chỉ system_admin mới có quyền tạo dự án mới
    if (user.role !== 'system_admin') {
      return c.json({ error: 'Chỉ System Admin mới có thể tạo dự án mới.' }, 403)
    }

    const data = await c.req.json()
    const { code, name, description, client, project_type, status, start_date, end_date, budget, contract_value, location, admin_id, leader_id, project_code_letter } = data

    if (!code || !name) return c.json({ error: 'Code and name required' }, 400)

    const result = await db.prepare(
      `INSERT INTO projects (code, name, description, client, project_type, status, start_date, end_date, budget, contract_value, location, admin_id, leader_id, project_code_letter, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(code, name, description || null, client || null, project_type || 'building', status || 'planning',
      start_date || null, end_date || null, budget || 0, contract_value || 0, location || null,
      admin_id || user.id, leader_id || null, project_code_letter || code, user.id).run()

    const projectId = result.meta.last_row_id

    // ── Email: project_created → thông báo cho tất cả system_admin + project_admin ──
    try {
      const projectTypeLabels: Record<string, string> = {
        building: 'Tòa nhà', infrastructure: 'Hạ tầng', transportation: 'Giao thông',
        energy: 'Năng lượng', landscape: 'Cảnh quan', other: 'Khác'
      }
      const emailData = {
        projectName: name, projectCode: code, description: description || null,
        client: client || null, status: status || 'planning',
        projectType: projectTypeLabels[project_type || 'building'] || project_type || 'building',
        startDate: start_date || null, endDate: end_date || null,
        location: location || null, createdBy: user.full_name
      }
      // Gửi cho các system_admin (không phải người tạo)
      const admins = await db.prepare(
        `SELECT id, email, full_name FROM users WHERE role = 'system_admin' AND is_active = 1`
      ).all()
      for (const admin of admins.results as any[]) {
        if (admin.id !== user.id && admin.email) {
          sendEmail(c.env, {
            to: admin.email, toName: admin.full_name,
            eventType: 'project_created', data: emailData,
            db, userId: admin.id, relatedType: 'project', relatedId: projectId as number
          })
        }
      }
      // Nếu project_admin được chỉ định và khác người tạo
      if (admin_id && admin_id !== user.id) {
        const adminUser = await getUserEmailInfo(db, admin_id)
        if (adminUser) {
          sendEmail(c.env, {
            to: adminUser.email, toName: adminUser.full_name,
            eventType: 'project_created', data: emailData,
            db, userId: admin_id, relatedType: 'project', relatedId: projectId as number
          })
        }
      }
      // Nếu project_leader được chỉ định
      if (leader_id && leader_id !== user.id && leader_id !== admin_id) {
        const leaderUser = await getUserEmailInfo(db, leader_id)
        if (leaderUser) {
          sendEmail(c.env, {
            to: leaderUser.email, toName: leaderUser.full_name,
            eventType: 'project_created', data: emailData,
            db, userId: leader_id, relatedType: 'project', relatedId: projectId as number
          })
        }
      }
    } catch (_) { /* ignore email errors */ }

    return c.json({ success: true, id: projectId }, 201)
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
      ? ['code','name','description','client','project_type','status','start_date','end_date','budget','contract_value','location','admin_id','leader_id','progress','project_code_letter']
      : ['name','description','client','project_type','status','start_date','end_date','location','leader_id','progress','project_code_letter']
    const updates = allowedFields.filter(f => data[f] !== undefined).map(f => `${f} = ?`)
    const values = allowedFields.filter(f => data[f] !== undefined).map(f => data[f])
    if (!updates.length) return c.json({ error: 'Nothing to update' }, 400)
    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)
    await db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()

    // ── Email: project_status_changed → thông báo tất cả thành viên dự án ──
    if (data.status && data.status !== proj.status) {
      try {
        const allMemberIds: Set<number> = new Set()
        // Lấy thành viên từ project_members
        const members = await db.prepare(
          'SELECT user_id FROM project_members WHERE project_id = ?'
        ).bind(id).all()
        for (const m of members.results as any[]) allMemberIds.add(m.user_id)
        // Thêm admin và leader
        if (proj.admin_id) allMemberIds.add(proj.admin_id)
        if (proj.leader_id) allMemberIds.add(proj.leader_id)

        const emailData = {
          projectName: proj.name, oldStatus: proj.status,
          newStatus: data.status, updatedBy: user.full_name,
          note: data.description || null
        }
        for (const uid of allMemberIds) {
          if (uid === user.id) continue  // không gửi cho người thực hiện
          const emailUser = await getUserEmailInfo(db, uid)
          if (emailUser) {
            sendEmail(c.env, {
              to: emailUser.email, toName: emailUser.full_name,
              eventType: 'project_status_changed', data: emailData,
              db, userId: uid, relatedType: 'project', relatedId: id
            })
          }
        }
      } catch (_) { /* ignore email errors */ }
    }

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

    // ── Email: project_added → gửi cho thành viên được thêm ──
    const proj = await db.prepare('SELECT name, code, description, start_date, end_date, admin_id, leader_id FROM projects WHERE id = ?').bind(projectId).first() as any
    const emailUser = await getUserEmailInfo(db, user_id)
    if (emailUser && proj) {
      const roleLabels: Record<string, string> = { member: 'Thành viên', project_leader: 'Trưởng dự án', project_admin: 'Quản lý dự án' }
      await sendEmail(c.env, {
        to: emailUser.email, toName: emailUser.full_name,
        eventType: 'project_added',
        data: { projectName: proj.name, projectCode: proj.code, description: proj.description, startDate: proj.start_date, endDate: proj.end_date, role: roleLabels[role] || role },
        db, userId: user_id, relatedType: 'project', relatedId: projectId
      })
    }

    // ── Email: member_added_to_project → thông báo cho PM và Leader ──
    try {
      const addedUserInfo = await db.prepare(
        'SELECT full_name, department FROM users WHERE id = ?'
      ).bind(user_id).first() as any
      if (addedUserInfo && proj) {
        const roleLabels2: Record<string, string> = { member: 'Thành viên', project_leader: 'Trưởng dự án', project_admin: 'Quản lý dự án' }
        const memberData = {
          projectName: proj.name, memberName: addedUserInfo.full_name,
          department: addedUserInfo.department || 'N/A',
          role: roleLabels2[role] || role, addedBy: user.full_name
        }
        // Thông báo cho Project Admin
        if (proj.admin_id && proj.admin_id !== user.id && proj.admin_id !== user_id) {
          const adminInfo = await getUserEmailInfo(db, proj.admin_id)
          if (adminInfo) {
            sendEmail(c.env, {
              to: adminInfo.email, toName: adminInfo.full_name,
              eventType: 'member_added_to_project', data: memberData,
              db, userId: proj.admin_id, relatedType: 'project', relatedId: projectId
            })
          }
        }
        // Thông báo cho Project Leader
        if (proj.leader_id && proj.leader_id !== user.id && proj.leader_id !== user_id && proj.leader_id !== proj.admin_id) {
          const leaderInfo = await getUserEmailInfo(db, proj.leader_id)
          if (leaderInfo) {
            sendEmail(c.env, {
              to: leaderInfo.email, toName: leaderInfo.full_name,
              eventType: 'member_added_to_project', data: memberData,
              db, userId: proj.leader_id, relatedType: 'project', relatedId: projectId
            })
          }
        }
      }
    } catch (_) { /* ignore email errors */ }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// PUT /api/projects/:id/members/:userId — cập nhật vai trò thành viên trong dự án
app.put('/api/projects/:id/members/:userId', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const projectId = parseInt(c.req.param('id'))
    const targetUserId = parseInt(c.req.param('userId'))
    const { role } = await c.req.json()

    // Chỉ system_admin hoặc project admin của dự án này mới được đổi role
    const canEdit = user.role === 'system_admin' || await isProjectAdmin(db, user.id, projectId)
    if (!canEdit) return c.json({ error: 'Không có quyền thay đổi vai trò thành viên' }, 403)

    const validRoles = ['member', 'project_leader', 'project_admin']
    if (!validRoles.includes(role)) return c.json({ error: 'Vai trò không hợp lệ' }, 400)

    // 1. Cập nhật role trong project_members
    await db.prepare(
      'UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?'
    ).bind(role, projectId, targetUserId).run()

    // 2. Đồng bộ projects.leader_id và projects.admin_id
    //    Nếu đổi xuống member/không phải leader → clear leader_id nếu đang trỏ tới user này
    //    Nếu đổi xuống member/không phải admin  → clear admin_id nếu đang trỏ tới user này
    if (role !== 'project_leader') {
      // Xóa leader_id nếu đang là user này
      await db.prepare(
        'UPDATE projects SET leader_id = NULL WHERE id = ? AND leader_id = ?'
      ).bind(projectId, targetUserId).run()
    } else {
      // Đặt leader_id = user này (nếu lên project_leader)
      await db.prepare(
        'UPDATE projects SET leader_id = ? WHERE id = ?'
      ).bind(targetUserId, projectId).run()
    }

    if (role !== 'project_admin') {
      // Xóa admin_id nếu đang là user này (nhưng không xóa nếu đây là creator/system admin)
      const proj = await db.prepare('SELECT admin_id, created_by FROM projects WHERE id = ?').bind(projectId).first() as any
      if (proj && proj.admin_id === targetUserId && proj.created_by !== targetUserId) {
        await db.prepare(
          'UPDATE projects SET admin_id = NULL WHERE id = ? AND admin_id = ?'
        ).bind(projectId, targetUserId).run()
      }
    } else {
      // Đặt admin_id = user này (nếu lên project_admin)
      await db.prepare(
        'UPDATE projects SET admin_id = ? WHERE id = ?'
      ).bind(targetUserId, projectId).run()
    }

    // Thông báo cho user được đổi role
    const roleLabels: Record<string, string> = {
      member: 'Thành viên',
      project_leader: 'Trưởng dự án',
      project_admin: 'Quản lý dự án'
    }
    await db.prepare(
      'INSERT INTO notifications (user_id, title, message, type, related_type, related_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(targetUserId, 'Vai trò dự án được cập nhật',
      `Vai trò của bạn trong dự án đã được cập nhật thành: ${roleLabels[role] || role}`,
      'info', 'project', projectId).run()

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

    // Xóa khỏi project_members
    await db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').bind(projectId, userId).run()

    // Đồng bộ: clear leader_id / admin_id nếu đang trỏ tới user này
    await db.prepare(
      'UPDATE projects SET leader_id = NULL WHERE id = ? AND leader_id = ?'
    ).bind(projectId, userId).run()
    // Chỉ clear admin_id nếu không phải người tạo dự án
    const proj = await db.prepare('SELECT created_by FROM projects WHERE id = ?').bind(projectId).first() as any
    if (proj && proj.created_by !== userId) {
      await db.prepare(
        'UPDATE projects SET admin_id = NULL WHERE id = ? AND admin_id = ?'
      ).bind(projectId, userId).run()
    }

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

// POST /api/categories/bulk — tạo nhiều hạng mục cùng lúc
app.post('/api/categories/bulk', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const { project_id, categories } = await c.req.json()

    if (!project_id) return c.json({ error: 'project_id required' }, 400)
    if (!Array.isArray(categories) || categories.length === 0)
      return c.json({ error: 'categories array required' }, 400)
    if (categories.length > 200)
      return c.json({ error: 'Tối đa 200 hạng mục mỗi lần' }, 400)

    // Permission check
    const proj = await db.prepare('SELECT admin_id FROM projects WHERE id = ?').bind(project_id).first() as any
    if (!proj) return c.json({ error: 'Project not found' }, 404)
    if (user.role !== 'system_admin' && proj.admin_id !== user.id) {
      // Check if project member with leader role
      const member = await db.prepare(
        'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
      ).bind(project_id, user.id).first() as any
      if (!member || !['project_admin','project_leader'].includes(member.role))
        return c.json({ error: 'Không có quyền thêm hạng mục' }, 403)
    }

    const results: any[] = []
    const errors: any[] = []

    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i]
      if (!cat.name || !cat.name.trim()) {
        errors.push({ row: i + 1, error: 'Tên hạng mục không được trống' })
        continue
      }
      try {
        const r = await db.prepare(
          `INSERT INTO categories (project_id, name, code, description, discipline_code, phase, start_date, end_date, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          project_id,
          cat.name.trim(),
          cat.code?.trim() || null,
          cat.description?.trim() || null,
          cat.discipline_code?.trim() || null,
          cat.phase || 'basic_design',
          cat.start_date || null,
          cat.end_date || null,
          user.id
        ).run()
        results.push({ row: i + 1, id: r.meta.last_row_id, name: cat.name.trim() })
      } catch (rowErr: any) {
        errors.push({ row: i + 1, name: cat.name, error: rowErr.message })
      }
    }

    return c.json({
      success: true,
      created: results.length,
      failed: errors.length,
      results,
      errors
    }, 201)
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
        cat.name as category_name,
        (SELECT COUNT(*) FROM subtasks st WHERE st.task_id = t.id) as subtask_count,
        (SELECT COUNT(*) FROM subtasks st WHERE st.task_id = t.id AND st.status = 'done') as subtask_done_count
      FROM tasks t
      LEFT JOIN users u1 ON t.assigned_to = u1.id
      LEFT JOIN users u2 ON t.assigned_by = u2.id
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN categories cat ON t.category_id = cat.id
      WHERE 1=1
    `
    const params: any[] = []

    // ─── PHÂN QUYỀN FILTER TASK ───────────────────────────────────────────────
    // Logic đúng:
    //  - system_admin / project_admin (global): thấy TẤT CẢ task
    //  - project_leader (global): thấy task thuộc project mình là leader/admin
    //  - member (global role):
    //      + Nếu có project_id cụ thể: kiểm tra role trong project đó
    //          → nếu là leader/admin trong project đó → thấy tất cả task của project
    //          → nếu là member trong project đó → chỉ thấy task của mình
    //      + Nếu KHÔNG có project_id (global list):
    //          → Dùng UNION: task được giao cho mình
    //                      + task thuộc project mà mình là leader/admin
    //          KHÔNG dùng role cao nhất chung vì sẽ bị leak task project khác

    if (user.role === 'system_admin') {
      // System admin: thấy tất cả, không filter thêm
    } else if (user.role === 'project_admin') {
      // Project admin global: thấy task trong project mình quản lý + task được giao cho mình
      const sub = projectAccessSubquery(user.id)
      query += ` AND (t.assigned_to = ? OR t.project_id IN ${sub.sql})`
      params.push(user.id, ...sub.params)
    } else if (user.role === 'project_leader') {
      // Project leader global: thấy task trong project mình là leader/admin + task được giao cho mình
      const sub = projectAccessSubquery(user.id)
      query += ` AND (t.assigned_to = ? OR t.project_id IN ${sub.sql})`
      params.push(user.id, ...sub.params)
    } else {
      // Global role = member → cần kiểm tra per-project
      if (project_id) {
        // Có project_id cụ thể: kiểm tra đúng role trong project này
        const effectiveRole = await getEffectiveRole(db, user, parseInt(project_id))
        if (['project_admin', 'project_leader'].includes(effectiveRole)) {
          // Là leader/admin trong project này → thấy tất cả task của project
          // (project_id filter sẽ được thêm bên dưới)
        } else {
          // Là member thuần trong project này → thấy task được giao cho mình
          // HOẶC task do chính mình tạo (assigned_by = user.id, kể cả chưa giao cho ai)
          query += ` AND (t.assigned_to = ? OR t.assigned_by = ?)`
          params.push(user.id, user.id)
        }
      } else {
        // Không có project_id → global list: UNION các tập
        //   1. Task được giao cho mình (ở bất kỳ project nào)
        //   2. Task do mình tạo (assigned_by = user.id, kể cả chưa giao cho ai)
        //   3. Task thuộc project mà mình là leader/admin
        query += ` AND (
          t.assigned_to = ?
          OR t.assigned_by = ?
          OR t.project_id IN (
            SELECT id FROM projects WHERE admin_id = ? OR leader_id = ?
            UNION
            SELECT project_id FROM project_members WHERE user_id = ? AND role IN ('project_admin','project_leader','admin','leader')
          )
        )`
        params.push(user.id, user.id, user.id, user.id, user.id)
      }
    }

    if (project_id) { query += ` AND t.project_id = ?`; params.push(parseInt(project_id)) }
    if (status) { query += ` AND t.status = ?`; params.push(status) }
    if (assigned_to) { query += ` AND t.assigned_to = ?`; params.push(parseInt(assigned_to)) }
    if (overdue === '1') { query += ` AND t.due_date < date('now') AND t.status NOT IN ('completed','review','cancelled')` }

    query += ` ORDER BY t.due_date ASC, t.priority DESC`

    const result = await db.prepare(query).bind(...params).all()

    // Update overdue flag
    await db.prepare(
      `UPDATE tasks SET is_overdue = 1 WHERE due_date < date('now') AND status NOT IN ('completed','review','cancelled')`
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
    const { project_id, category_id, legal_item_id, title, description, discipline_code, phase, priority, status, assigned_to, start_date, due_date, estimated_hours } = data

    if (!project_id || !title) return c.json({ error: 'project_id and title required' }, 400)

    // RBAC: mọi thành viên project đều được tạo task (kể cả member)
    // system_admin được tạo task ở mọi project
    const isAdmin = user.role === 'system_admin'
    const isProjAdminOrLeader = await isProjectLeaderOrAdmin(db, user, project_id)
    if (!isAdmin && !isProjAdminOrLeader) {
      // Kiểm tra member có thuộc project không
      const membership = await db.prepare(
        'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?'
      ).bind(project_id, user.id).first()
      if (!membership) return c.json({ error: 'Bạn không phải thành viên của dự án này' }, 403)
    }

    const result = await db.prepare(
      `INSERT INTO tasks (project_id, category_id, legal_item_id, title, description, discipline_code, phase, priority, status, assigned_to, assigned_by, start_date, due_date, estimated_hours)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(project_id, category_id || null, legal_item_id || null, title, description || null, discipline_code || null,
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

      // ── Email: task_assigned ──
      const emailUser = await getUserEmailInfo(db, assigned_to)
      const projInfo = await db.prepare('SELECT name FROM projects WHERE id = ?').bind(project_id).first() as any
      if (emailUser) {
        const disciplineInfo = discipline_code ? await db.prepare('SELECT name FROM disciplines WHERE code = ?').bind(discipline_code).first() as any : null
        await sendEmail(c.env, {
          to: emailUser.email, toName: emailUser.full_name,
          eventType: 'task_assigned',
          data: { taskTitle: title, projectName: projInfo?.name, discipline: disciplineInfo?.name || discipline_code, priority: priority || 'medium', deadline: due_date, description, assignedBy: user.full_name },
          db, userId: assigned_to, relatedType: 'task', relatedId: taskId
        })
      }
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
    const isProjAdmin = await isProjectLeaderOrAdmin(db, user, task.project_id)
    const isAssigned = task.assigned_to === user.id
    const isCreator = task.assigned_by === user.id  // người tạo task (member tự tạo)

    if (!isAdmin && !isProjAdmin && !isAssigned && !isCreator)
      return c.json({ error: 'Không có quyền chỉnh sửa task này' }, 403)

    // - Admin/Project admin/leader: sửa toàn bộ fields
    // - Member tự tạo task (assigned_by = user.id): sửa toàn bộ fields (task của mình)
    // - Member được giao task nhưng không phải người tạo: chỉ sửa status/progress/actual_hours
    const isFullAccess = isAdmin || isProjAdmin || isCreator
    const fields = isFullAccess
      ? ['title', 'description', 'discipline_code', 'phase', 'priority', 'status', 'assigned_to', 'start_date', 'due_date', 'actual_start_date', 'actual_end_date', 'estimated_hours', 'actual_hours', 'progress', 'category_id']
      : ['status', 'progress', 'actual_hours', 'actual_end_date']
    // Normalize legacy status 'done' → 'completed' (tasks table không có 'done')
    if (data.status === 'done') data.status = 'completed'

    const updates = fields.filter(f => data[f] !== undefined).map(f => `${f} = ?`)
    const values = fields.filter(f => data[f] !== undefined).map(f => data[f])

    // Auto-set actual_end_date và xóa overdue khi chuyển sang review hoặc completed
    // Lý do: 'review' nghĩa là member đã hoàn thành phần công việc, đang chờ QA/PM duyệt
    // → cần ghi nhận ngày hoàn thành thực tế để tính đúng ontime_rate
    if (data.status === 'completed' || data.status === 'review') {
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

    // ── Email: task_status_updated → chỉ gửi cho người tạo task (assigned_by) ──
    if (data.status && data.status !== task.status && task.assigned_by && task.assigned_by !== user.id) {
      const projInfo = await db.prepare('SELECT name FROM projects WHERE id = ?').bind(task.project_id).first() as any
      const creator = await getUserEmailInfo(db, task.assigned_by)
      if (creator?.email) {
        await sendEmail(c.env, {
          to: creator.email, toName: creator.full_name,
          eventType: 'task_status_updated',
          data: {
            taskTitle:   task.title,
            projectName: projInfo?.name,
            oldStatus:   task.status,
            newStatus:   data.status,
            updatedBy:   user.full_name
          },
          db, userId: task.assigned_by, relatedType: 'task', relatedId: id
        })
      }
    }

    // ── Email: task_assigned (khi đổi người được giao) ──
    if (data.assigned_to && data.assigned_to !== task.assigned_to) {
      const emailUser = await getUserEmailInfo(db, data.assigned_to)
      const projInfo = await db.prepare('SELECT name FROM projects WHERE id = ?').bind(task.project_id).first() as any
      if (emailUser) {
        await sendEmail(c.env, {
          to: emailUser.email, toName: emailUser.full_name,
          eventType: 'task_assigned',
          data: { taskTitle: task.title, projectName: projInfo?.name, priority: task.priority, deadline: task.due_date, assignedBy: user.full_name },
          db, userId: data.assigned_to, relatedType: 'task', relatedId: id
        })
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
    `SELECT id FROM project_members WHERE project_id = ? AND user_id = ? AND role IN ('project_admin','project_leader','admin','leader')`
  ).bind(projectId, userId).first()
  return !!mem
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: lấy role hiệu quả cho user trong ngữ cảnh project.
//
// Ý tưởng: một user có global role = 'member' vẫn có thể được giao vai trò
// 'project_leader' hoặc 'project_admin' trong project_members cho từng dự án.
// Hàm này trả về role CAO NHẤT trong số:
//   1. Global role (users.role)
//   2. Project-member role (project_members.role cho projectId, nếu có)
//   3. Nếu không có projectId: kiểm tra xem user có bất kỳ project nào với
//      role cao không (dùng cho danh sách toàn cục)
//
// Thứ tự ưu tiên: system_admin > project_admin > project_leader > member
// ─────────────────────────────────────────────────────────────────────────────
const ROLE_PRIORITY: Record<string, number> = {
  system_admin: 4,
  project_admin: 3,
  project_leader: 2,
  member: 1
}
function higherRole(a: string, b: string): string {
  return (ROLE_PRIORITY[a] || 0) >= (ROLE_PRIORITY[b] || 0) ? a : b
}

async function getEffectiveRole(db: D1Database, user: any, projectId?: number): Promise<string> {
  // system_admin: luôn là system_admin
  if (user.role === 'system_admin') return 'system_admin'

  let effectiveRole = user.role as string

  if (projectId) {
    // Kiểm tra role trong project_members cho dự án cụ thể
    const mem = await db.prepare(
      `SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`
    ).bind(projectId, user.id).first() as any
    // Normalize legacy role values ('admin' → 'project_admin', 'leader' → 'project_leader')
    const normalizedMemRole = mem?.role === 'admin' ? 'project_admin'
      : mem?.role === 'leader' ? 'project_leader'
      : mem?.role
    if (normalizedMemRole) effectiveRole = higherRole(effectiveRole, normalizedMemRole)

    // Kiểm tra projects.admin_id / projects.leader_id
    const proj = await db.prepare(
      `SELECT admin_id, leader_id FROM projects WHERE id = ?`
    ).bind(projectId).first() as any
    if (proj) {
      if (proj.admin_id === user.id) effectiveRole = higherRole(effectiveRole, 'project_admin')
      if (proj.leader_id === user.id) effectiveRole = higherRole(effectiveRole, 'project_leader')
    }
  } else {
    // Không có projectId cụ thể: lấy role cao nhất từ tất cả project_members
    const bestMem = await db.prepare(
      `SELECT role FROM project_members WHERE user_id = ?
       ORDER BY CASE role
         WHEN 'project_admin'  THEN 3
         WHEN 'admin'          THEN 3
         WHEN 'project_leader' THEN 2
         WHEN 'leader'         THEN 2
         WHEN 'member'         THEN 1
         ELSE 0 END DESC LIMIT 1`
    ).bind(user.id).first() as any
    // Normalize legacy role values
    const normalizedBestRole = bestMem?.role === 'admin' ? 'project_admin'
      : bestMem?.role === 'leader' ? 'project_leader'
      : bestMem?.role
    if (normalizedBestRole) effectiveRole = higherRole(effectiveRole, normalizedBestRole)

    // Cũng kiểm tra projects.admin_id / leader_id
    const projRole = await db.prepare(
      `SELECT CASE WHEN admin_id = ? THEN 'project_admin'
                   WHEN leader_id = ? THEN 'project_leader'
                   ELSE NULL END as role
       FROM projects WHERE admin_id = ? OR leader_id = ? LIMIT 1`
    ).bind(user.id, user.id, user.id, user.id).first() as any
    if (projRole?.role) effectiveRole = higherRole(effectiveRole, projRole.role)
  }

  return effectiveRole
}

// Helper nhanh: user có phải là project_leader/admin (cho project bất kỳ) không?
// Dùng để thay thế: user.role === 'project_admin' || user.role === 'project_leader'
async function isProjectLeaderOrAdmin(db: D1Database, user: any, projectId?: number): Promise<boolean> {
  if (['system_admin', 'project_admin', 'project_leader'].includes(user.role)) return true
  const role = await getEffectiveRole(db, user, projectId)
  return ['system_admin', 'project_admin', 'project_leader'].includes(role)
}

// SQL subquery dùng trong WHERE clause để lọc project cho user có thể xem
// (bao gồm cả project-level role)
function projectAccessSubquery(userId: number): { sql: string; params: number[] } {
  return {
    sql: `(
      SELECT id FROM projects WHERE admin_id = ? OR leader_id = ?
      UNION
      SELECT project_id FROM project_members WHERE user_id = ? AND role IN ('project_admin','project_leader','admin','leader')
    )`,
    params: [userId, userId, userId]
  }
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

// GET /api/timesheets/cleanup-duplicates — check & report duplicate timesheets
app.get('/api/timesheets/cleanup-duplicates', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const dups = await db.prepare(`
      SELECT ts.user_id, u.full_name, ts.project_id, p.code as project_code,
        ts.work_date, COUNT(*) as dup_count,
        GROUP_CONCAT(ts.id) as ids
      FROM timesheets ts
      JOIN users u ON u.id = ts.user_id
      JOIN projects p ON p.id = ts.project_id
      GROUP BY ts.user_id, ts.project_id, ts.work_date
      HAVING COUNT(*) > 1
      ORDER BY ts.work_date DESC
    `).all()
    const total = await db.prepare('SELECT COUNT(*) as cnt FROM timesheets').first() as any
    return c.json({
      duplicate_groups: dups.results.length,
      duplicates: dups.results,
      total_timesheets: total?.cnt || 0,
      has_duplicates: dups.results.length > 0
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/timesheets/cleanup-duplicates — delete duplicate timesheets keeping newest (MAX id)
app.post('/api/timesheets/cleanup-duplicates', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    // Count before
    const before = await db.prepare('SELECT COUNT(*) as cnt FROM timesheets').first() as any
    const dupsBefore = await db.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT user_id, project_id, work_date FROM timesheets
        GROUP BY user_id, project_id, work_date HAVING COUNT(*) > 1
      )
    `).first() as any

    // Delete duplicates keeping MAX(id) per group
    const del = await db.prepare(`
      DELETE FROM timesheets
      WHERE id NOT IN (
        SELECT MAX(id) FROM timesheets
        GROUP BY user_id, project_id, work_date
      )
    `).run()

    const after = await db.prepare('SELECT COUNT(*) as cnt FROM timesheets').first() as any
    const dupsAfter = await db.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT user_id, project_id, work_date FROM timesheets
        GROUP BY user_id, project_id, work_date HAVING COUNT(*) > 1
      )
    `).first() as any

    return c.json({
      success: true,
      before_count: before?.cnt || 0,
      after_count: after?.cnt || 0,
      rows_deleted: del.meta?.changes || 0,
      duplicate_groups_before: dupsBefore?.cnt || 0,
      duplicate_groups_after: dupsAfter?.cnt || 0
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ===================================================
// GET /api/timesheets/summary — aggregated totals for current filters
// Accepts: project_id, user_id/member_id, month, year, status
// ===================================================
app.get('/api/timesheets/summary', authMiddleware, async (c) => {
  try {
    const db   = c.env.DB
    const user  = c.get('user') as any
    const qp   = c.req.query()
    const { project_id, month, year, status } = qp
    const user_id = qp.user_id || qp.member_id || ''

    let query = `
      SELECT
        COUNT(*)                              AS record_count,
        SUM(regular_hours)                    AS total_regular_hours,
        SUM(IFNULL(overtime_hours, 0))        AS total_overtime_hours,
        SUM(regular_hours + IFNULL(overtime_hours, 0)) AS total_hours,
        COUNT(DISTINCT ts.user_id)            AS member_count,
        COUNT(DISTINCT ts.project_id)         AS project_count,
        COUNT(DISTINCT ts.work_date)          AS working_days
      FROM timesheets ts
      WHERE 1=1
    `
    const params: any[] = []

    const effRole = await getEffectiveRole(db, user, project_id ? parseInt(project_id) : undefined)
    if (effRole === 'system_admin') {
      if (user_id)    { query += ` AND ts.user_id = ?`;    params.push(parseInt(user_id)) }
      if (project_id) { query += ` AND ts.project_id = ?`; params.push(parseInt(project_id)) }
    } else if (effRole === 'project_admin' || effRole === 'project_leader') {
      const sub = projectAccessSubquery(user.id)
      query += ` AND ts.project_id IN ${sub.sql}`
      params.push(...sub.params)
      if (user_id)    { query += ` AND ts.user_id = ?`;    params.push(parseInt(user_id)) }
      if (project_id) { query += ` AND ts.project_id = ?`; params.push(parseInt(project_id)) }
    } else {
      query += ` AND ts.user_id = ?`
      params.push(user.id)
      if (project_id) { query += ` AND ts.project_id = ?`; params.push(parseInt(project_id)) }
    }

    if (status) { query += ` AND ts.status = ?`;                  params.push(status) }
    if (month)  { query += ` AND strftime('%m', ts.work_date) = ?`; params.push(month.padStart(2,'0')) }
    if (year)   { query += ` AND strftime('%Y', ts.work_date) = ?`; params.push(year) }

    const row = params.length
      ? await db.prepare(query).bind(...params).first() as any
      : await db.prepare(query).first() as any

    return c.json({
      record_count:         row?.record_count          || 0,
      total_regular_hours:  row?.total_regular_hours   || 0,
      total_overtime_hours: row?.total_overtime_hours  || 0,
      total_hours:          row?.total_hours           || 0,
      member_count:         row?.member_count          || 0,
      project_count:        row?.project_count         || 0,
      working_days:         row?.working_days          || 0
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ===================================================
// GET /api/timesheets/members — list of members who have timesheets
// Role-scoped: system_admin sees all; project_admin/leader sees their projects;
// member sees only themselves
// ===================================================
app.get('/api/timesheets/members', authMiddleware, async (c) => {
  try {
    const db  = c.env.DB
    const user = c.get('user') as any
    const { project_id, month, year } = c.req.query()

    let query = `
      SELECT DISTINCT u.id, u.full_name, u.department, u.role,
        COUNT(ts.id) as timesheet_count,
        SUM(ts.regular_hours) as total_regular_hours,
        SUM(IFNULL(ts.overtime_hours,0)) as total_overtime_hours,
        SUM(ts.regular_hours + IFNULL(ts.overtime_hours,0)) as total_hours
      FROM users u
      JOIN timesheets ts ON ts.user_id = u.id
      WHERE 1=1
    `
    const params: any[] = []

    // Scope to projects the requester can see
    const effRoleM = await getEffectiveRole(db, user, project_id ? parseInt(project_id) : undefined)
    if (effRoleM === 'system_admin') {
      // no extra restriction
    } else if (effRoleM === 'project_admin' || effRoleM === 'project_leader') {
      const sub = projectAccessSubquery(user.id)
      query += ` AND ts.project_id IN ${sub.sql}`
      params.push(...sub.params)
    } else {
      // member: only their own row
      query += ` AND ts.user_id = ?`
      params.push(user.id)
    }

    if (project_id) { query += ` AND ts.project_id = ?`; params.push(parseInt(project_id)) }
    if (month)      { query += ` AND strftime('%m', ts.work_date) = ?`; params.push(month.padStart(2, '0')) }
    if (year)       { query += ` AND strftime('%Y', ts.work_date) = ?`; params.push(year) }

    query += ' GROUP BY u.id, u.full_name, u.department, u.role ORDER BY total_hours DESC'

    const result = params.length
      ? await db.prepare(query).bind(...params).all()
      : await db.prepare(query).all()

    return c.json(result.results)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ===================================================
// GET /api/timesheets/projects — list of projects that have timesheets
// Role-scoped similarly to /api/timesheets
// ===================================================
app.get('/api/timesheets/projects', authMiddleware, async (c) => {
  try {
    const db   = c.env.DB
    const user  = c.get('user') as any
    const { user_id, month, year } = c.req.query()

    let query = `
      SELECT DISTINCT p.id, p.code, p.name, p.status,
        COUNT(ts.id) as timesheet_count,
        COUNT(DISTINCT ts.user_id) as member_count,
        SUM(ts.regular_hours) as total_regular_hours,
        SUM(IFNULL(ts.overtime_hours,0)) as total_overtime_hours,
        SUM(ts.regular_hours + IFNULL(ts.overtime_hours,0)) as total_hours
      FROM projects p
      JOIN timesheets ts ON ts.project_id = p.id
      WHERE 1=1
    `
    const params: any[] = []

    const effRoleP = await getEffectiveRole(db, user, undefined)
    if (effRoleP === 'system_admin') {
      // no extra restriction
    } else if (effRoleP === 'project_admin' || effRoleP === 'project_leader') {
      const sub = projectAccessSubquery(user.id)
      query += ` AND p.id IN ${sub.sql}`
      params.push(...sub.params)
    } else {
      query += ` AND ts.user_id = ?`
      params.push(user.id)
    }

    if (user_id) { query += ` AND ts.user_id = ?`; params.push(parseInt(user_id)) }
    if (month)   { query += ` AND strftime('%m', ts.work_date) = ?`; params.push(month.padStart(2, '0')) }
    if (year)    { query += ` AND strftime('%Y', ts.work_date) = ?`; params.push(year) }

    query += ' GROUP BY p.id, p.code, p.name, p.status ORDER BY total_hours DESC'

    const result = params.length
      ? await db.prepare(query).bind(...params).all()
      : await db.prepare(query).all()

    return c.json(result.results)
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
    // Support both user_id and member_id (alias) for backwards compat
    const qp = c.req.query()
    const { project_id, month, year, status } = qp
    const user_id = qp.user_id || qp.member_id || ''

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

    const effRoleTS = await getEffectiveRole(db, user, project_id ? parseInt(project_id) : undefined)
    if (effRoleTS === 'system_admin') {
      if (user_id) { query += ` AND ts.user_id = ?`; params.push(parseInt(user_id)) }
      if (project_id) { query += ` AND ts.project_id = ?`; params.push(parseInt(project_id)) }
    } else if (effRoleTS === 'project_admin' || effRoleTS === 'project_leader') {
      // Thấy timesheets trong project mình quản lý + LUÔN thấy timesheet của chính mình
      const sub = projectAccessSubquery(user.id)
      query += ` AND (ts.user_id = ? OR ts.project_id IN ${sub.sql})`
      params.push(user.id, ...sub.params)
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
    // Build identical WHERE conditions for summary (using same effRoleTS)
    let sumQ = sumQuery
    const sumParams: any[] = []
    if (effRoleTS === 'system_admin') {
      if (user_id) { sumQ += ` AND ts.user_id = ?`; sumParams.push(parseInt(user_id)) }
      if (project_id) { sumQ += ` AND ts.project_id = ?`; sumParams.push(parseInt(project_id)) }
    } else if (effRoleTS === 'project_admin' || effRoleTS === 'project_leader') {
      const sub = projectAccessSubquery(user.id)
      sumQ += ` AND (ts.user_id = ? OR ts.project_id IN ${sub.sql})`
      sumParams.push(user.id, ...sub.params)
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

// ── Helper: kiểm tra ngày có nằm trong tuần làm việc hiện tại không ──
// Tuần làm việc: Thứ Hai → Chủ Nhật (ISO week, timezone UTC+7)
function isWithinCurrentWeek(workDateStr: string): boolean {
  // Parse work_date (YYYY-MM-DD)
  const [y, m, d] = workDateStr.split('-').map(Number)
  const workDate = new Date(Date.UTC(y, m - 1, d))

  // Lấy "hôm nay" theo UTC+7
  const nowUtc7 = new Date(Date.now() + 7 * 60 * 60 * 1000)
  const todayUtc7 = new Date(Date.UTC(
    nowUtc7.getUTCFullYear(),
    nowUtc7.getUTCMonth(),
    nowUtc7.getUTCDate()
  ))

  // Thứ trong tuần: 0=CN, 1=T2 ... 6=T7 — chuyển sang ISO: T2=0 ... CN=6
  const dow = (todayUtc7.getUTCDay() + 6) % 7  // 0=T2, 6=CN
  const weekStart = new Date(todayUtc7)
  weekStart.setUTCDate(todayUtc7.getUTCDate() - dow)   // Thứ Hai
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6)       // Chủ Nhật

  return workDate >= weekStart && workDate <= weekEnd
}

// ── POST /api/timesheets/bulk-import — Nhập tổng giờ theo năm/tháng (system_admin only) ──
app.post('/api/timesheets/bulk-import', authMiddleware, adminOnly, async (c) => {
  try {
    const db   = c.env.DB
    const data = await c.req.json()
    const { user_id, year, entries, mode } = data

    if (!user_id || !year || !Array.isArray(entries) || !entries.length) {
      return c.json({ error: 'user_id, year, entries required' }, 400)
    }

    let saved = 0
    for (const entry of entries) {
      const { project_id, work_date, regular_hours = 0, overtime_hours = 0 } = entry
      if (!project_id) continue
      if (!regular_hours && !overtime_hours) continue

      // work_date phải được truyền từ frontend (01/<month>/<year>)
      if (!work_date) continue

      // Xác định mô tả từ work_date
      const [wy, wm] = work_date.split('-')
      const descLabel = mode === 'month'
        ? `Tổng hợp giờ tháng ${parseInt(wm)}/${wy}`
        : `Tổng hợp giờ năm ${wy}`

      // Upsert: nếu đã tồn tại bản ghi cùng user/project/date → ghi đè giờ
      const existing = await db.prepare(
        `SELECT id FROM timesheets WHERE user_id = ? AND project_id = ? AND work_date = ? LIMIT 1`
      ).bind(user_id, project_id, work_date).first() as any

      if (existing) {
        await db.prepare(
          `UPDATE timesheets
           SET regular_hours  = ?,
               overtime_hours = ?,
               description    = ?,
               updated_at     = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(regular_hours, overtime_hours, descLabel, existing.id).run()
      } else {
        await db.prepare(
          `INSERT INTO timesheets (user_id, project_id, work_date, regular_hours, overtime_hours, description, status)
           VALUES (?, ?, ?, ?, ?, ?, 'approved')`
        ).bind(user_id, project_id, work_date, regular_hours, overtime_hours, descLabel).run()
      }
      saved++
    }

    return c.json({ success: true, saved })
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

    // ── Giới hạn tuần: member & project_admin/leader chỉ khai báo trong tuần hiện tại ──
    const effRoleGlobalCheck = await getEffectiveRole(db, user)
    if (effRoleGlobalCheck !== 'system_admin' && !isWithinCurrentWeek(work_date)) {
      return c.json({
        error: 'Chỉ được khai báo timesheet trong tuần làm việc hiện tại (Thứ Hai – Chủ Nhật). Tuần đã qua không thể khai báo lại.',
        week_limit: true
      }, 422)
    }

    // member chỉ được tạo timesheet cho chính mình
    // system_admin/project_admin/project_leader có thể tạo cho user_id bất kỳ (nếu truyền vào)
    const effRoleGlobal = await getEffectiveRole(db, user)
    const targetUserId = (data.user_id && effRoleGlobal !== 'member') ? data.user_id : user.id

    // Kiểm tra quyền tạo timesheet:
    // - system_admin: được tạo cho mọi dự án, mọi user
    // - project_admin/project_leader của dự án này: được tạo timesheet cho user khác (targetUserId != user.id)
    // - member (kể cả global role cao hơn) tạo timesheet CHO CHÍNH MÌNH: luôn được phép
    //   nếu họ là thành viên của dự án (project_members hoặc admin_id/leader_id)
    // - Tạo timesheet CHO NGƯỜI KHÁC mà không phải admin/leader của dự án: bị từ chối

    if (effRoleGlobal !== 'system_admin') {
      if (targetUserId !== user.id) {
        // Đang tạo timesheet cho người khác → phải là admin/leader của dự án này
        const allowed = await isProjectAdmin(db, user.id, parseInt(project_id))
        if (!allowed) return c.json({ error: 'Bạn không có quyền tạo timesheet cho người khác trong dự án này' }, 403)
      } else {
        // Tạo timesheet cho chính mình → kiểm tra có là thành viên của dự án không
        const isMember = await db.prepare(
          `SELECT id FROM project_members WHERE project_id = ? AND user_id = ?`
        ).bind(parseInt(project_id), user.id).first()
        const isAdminOrLeader = await db.prepare(
          `SELECT id FROM projects WHERE id = ? AND (admin_id = ? OR leader_id = ?)`
        ).bind(parseInt(project_id), user.id, user.id).first()
        if (!isMember && !isAdminOrLeader) {
          return c.json({ error: 'Bạn không phải thành viên của dự án này' }, 403)
        }
      }
    }

    // === CREATE-OR-UPDATE: check for existing record before inserting ===
    const existing = await db.prepare(
      `SELECT id, status FROM timesheets WHERE user_id = ? AND project_id = ? AND work_date = ? LIMIT 1`
    ).bind(targetUserId, parseInt(project_id), work_date).first() as any

    if (existing) {
      // Prevent editing approved timesheets (unless system_admin)
      if (existing.status === 'approved' && user.role !== 'system_admin') {
        return c.json({ error: 'Timesheet ngày này đã được duyệt. Không thể cập nhật.', exists: true, id: existing.id, status: existing.status }, 409)
      }
      // Update existing record instead of creating a duplicate
      await db.prepare(
        `UPDATE timesheets SET task_id = ?, regular_hours = ?, overtime_hours = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(task_id || null, regular_hours || 0, overtime_hours || 0, description || null, existing.id).run()
      return c.json({ success: true, id: existing.id, action: 'updated' }, 200)
    }

    const result = await db.prepare(
      `INSERT INTO timesheets (user_id, project_id, task_id, work_date, regular_hours, overtime_hours, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(targetUserId, project_id, task_id || null, work_date,
      regular_hours || 0, overtime_hours || 0, description || null).run()

    return c.json({ success: true, id: result.meta.last_row_id, action: 'created' }, 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Timesheet cho ngày này đã tồn tại. Vui lòng chỉnh sửa bản ghi hiện có.', duplicate: true }, 409)
    }
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
    const isProjAdmin = await isProjectLeaderOrAdmin(db, user, ts.project_id)

    if (!isOwner && !isAdmin && !isProjAdmin) {
      return c.json({ error: 'Bạn không có quyền chỉnh sửa timesheet này' }, 403)
    }

    // member chỉ sửa được timesheet ở trạng thái draft/rejected của chính mình
    if (isOwner && !isAdmin && !isProjAdmin) {
      if (!['draft', 'rejected'].includes(ts.status)) {
        return c.json({ error: 'Không thể sửa timesheet đã được duyệt hoặc đang chờ duyệt' }, 403)
      }
    }

    const { project_id, task_id, work_date, regular_hours, overtime_hours, description, status } = data
    const updates: string[] = []
    const values: any[] = []

    // ── Giới hạn tuần cho member/project_admin khi sửa nội dung timesheet ──
    // Kiểm tra ngày gốc của timesheet: nếu nằm ngoài tuần hiện tại → không cho sửa
    // (chỉ system_admin được phép sửa timesheet tuần cũ)
    if (!isAdmin && !isProjAdmin && !isWithinCurrentWeek(ts.work_date)) {
      // Chỉ chặn sửa nội dung (không chặn admin phê duyệt/từ chối)
      const isContentEdit = project_id !== undefined || task_id !== undefined || work_date !== undefined ||
                            regular_hours !== undefined || overtime_hours !== undefined ||
                            description !== undefined
      if (isContentEdit) {
        return c.json({
          error: 'Timesheet này thuộc tuần đã qua, không thể chỉnh sửa nữa.',
          week_limit: true
        }, 422)
      }
    }

    // task_id và work_date: chỉ admin/projAdmin hoặc owner ở trạng thái draft/rejected mới được sửa
    const canEditContent = isAdmin || isProjAdmin || (isOwner && ['draft', 'rejected'].includes(ts.status))
    if (canEditContent) {
      // project_id: cho phép đổi sang dự án khác
      if (project_id !== undefined && project_id !== null) {
        // Kiểm tra dự án tồn tại
        const proj = await db.prepare('SELECT id FROM projects WHERE id = ?').bind(project_id).first()
        if (!proj) return c.json({ error: 'Dự án không tồn tại' }, 400)
        updates.push('project_id = ?'); values.push(project_id)
        // Khi đổi project, task_id liên quan đến project cũ không còn hợp lệ → reset nếu không có task_id mới
        if (task_id === undefined) { updates.push('task_id = ?'); values.push(null) }
      }
      // task_id: cho phép set null (xóa task) hoặc set id mới
      if (task_id !== undefined) { updates.push('task_id = ?'); values.push(task_id || null) }
      if (work_date !== undefined) {
        // Kiểm tra ngày mới cũng phải trong tuần hiện tại (trừ admin)
        if (!isAdmin && !isProjAdmin && !isWithinCurrentWeek(work_date)) {
          return c.json({
            error: 'Chỉ được cập nhật ngày làm việc trong tuần hiện tại (Thứ Hai – Chủ Nhật).',
            week_limit: true
          }, 422)
        }
        updates.push('work_date = ?'); values.push(work_date)
      }
      if (regular_hours !== undefined) { updates.push('regular_hours = ?'); values.push(regular_hours) }
      if (overtime_hours !== undefined) { updates.push('overtime_hours = ?'); values.push(overtime_hours) }
      if (description !== undefined) { updates.push('description = ?'); values.push(description) }
    } else {
      // member thường không được sửa nội dung (chỉ submit/rút lại)
      if (project_id !== undefined || regular_hours !== undefined || overtime_hours !== undefined ||
          description !== undefined || task_id !== undefined || work_date !== undefined) {
        return c.json({ error: 'Không thể sửa nội dung timesheet đã được duyệt hoặc đang chờ duyệt' }, 403)
      }
    }

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

    if (!updates.length) {
      return c.json({ error: 'Không có gì để cập nhật' }, 400)
    }
    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    await db.prepare(`UPDATE timesheets SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()

    // ── Email: timesheet_reviewed (khi admin duyệt/từ chối) ──
    if (status && (status === 'approved' || status === 'rejected') && (isAdmin || isProjAdmin)) {
      const emailUser = await getUserEmailInfo(db, ts.user_id)
      if (emailUser) {
        const projInfo = await db.prepare('SELECT name FROM projects WHERE id = ?').bind(ts.project_id).first() as any
        await sendEmail(c.env, {
          to: emailUser.email, toName: emailUser.full_name,
          eventType: 'timesheet_reviewed',
          data: { date: ts.work_date, action: status, projectName: projInfo?.name, hoursHC: ts.hours_hc, totalHours: ts.total_hours, reviewedBy: user.full_name },
          db, userId: ts.user_id, relatedType: 'timesheet', relatedId: id
        })
      }
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/timesheets/bulk-approve', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    if (!['system_admin', 'project_admin', 'project_leader'].includes(user.role) &&
        !(await isProjectLeaderOrAdmin(db, user))) {
      return c.json({ error: 'Access denied' }, 403)
    }
    const { ids } = await c.req.json()
    if (!ids?.length) return c.json({ error: 'No IDs provided' }, 400)

    let approved = 0
    // Track per-user approved count + period for email grouping
    const userApprovedMap: Map<number, { count: number; dates: string[] }> = new Map()

    for (const id of ids) {
      try {
        // Lấy thông tin timesheet trước khi approve
        const ts = await db.prepare(
          'SELECT user_id, work_date, status FROM timesheets WHERE id = ? AND status = \'submitted\''
        ).bind(id).first() as any
        const r = await db.prepare(
          `UPDATE timesheets SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'submitted'`
        ).bind(user.id, id).run()
        if ((r.meta?.changes || 0) > 0 && ts) {
          approved++
          const uid = ts.user_id
          if (!userApprovedMap.has(uid)) userApprovedMap.set(uid, { count: 0, dates: [] })
          const entry = userApprovedMap.get(uid)!
          entry.count++
          if (ts.work_date) entry.dates.push(ts.work_date)
        }
      } catch (_) { /* skip */ }
    }

    // ── Email: timesheet_bulk_approved → gửi 1 email tổng hợp cho mỗi user ──
    try {
      for (const [uid, info] of userApprovedMap.entries()) {
        if (uid === user.id) continue
        const emailUser = await getUserEmailInfo(db, uid)
        if (emailUser && info.count > 0) {
          // Xác định kỳ từ dates
          let period = ''
          if (info.dates.length > 0) {
            const sorted = info.dates.sort()
            if (sorted.length === 1) {
              period = sorted[0]
            } else {
              period = `${sorted[0]} → ${sorted[sorted.length - 1]}`
            }
          }
          sendEmail(c.env, {
            to: emailUser.email, toName: emailUser.full_name,
            eventType: 'timesheet_bulk_approved',
            data: { approvedCount: info.count, period, reviewedBy: user.full_name },
            db, userId: uid, relatedType: 'timesheet', relatedId: ids[0]
          })
        }
      }
    } catch (_) { /* ignore email errors */ }

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

    const isOwner2 = ts.user_id === user.id
    const isAdmin2 = user.role === 'system_admin'
    const isProjAdmin2 = await isProjectLeaderOrAdmin(db, user, ts.project_id)

    if (!isAdmin2 && !isProjAdmin2 && !(isOwner2 && ['draft', 'rejected'].includes(ts.status))) {
      return c.json({ error: 'Không có quyền xóa timesheet này' }, 403)
    }

    await db.prepare('DELETE FROM timesheets WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// SUBTASK ROUTES
// Quyền:
//   - Tất cả members trong project đều có thể TẠO subtask cho task được giao cho mình
//   - System admin / project admin / project leader: xem + sửa + xóa tất cả
//   - Member: chỉ sửa + xóa subtask do chính mình tạo (hoặc được giao)
// ===================================================

// GET /api/tasks/:id/subtasks
app.get('/api/tasks/:id/subtasks', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const taskId = parseInt(c.req.param('id'))
    const subtasks = await db.prepare(`
      SELECT st.*,
        u1.full_name as assigned_to_name,
        u2.full_name as created_by_name
      FROM subtasks st
      LEFT JOIN users u1 ON st.assigned_to = u1.id
      LEFT JOIN users u2 ON st.created_by = u2.id
      WHERE st.task_id = ?
      ORDER BY st.created_at ASC
    `).bind(taskId).all()
    return c.json(subtasks.results)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/tasks/:id/subtasks — tạo subtask (mọi member trong project đều được)
app.post('/api/tasks/:id/subtasks', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const taskId = parseInt(c.req.param('id'))

    // Kiểm tra task tồn tại
    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first() as any
    if (!task) return c.json({ error: 'Task không tồn tại' }, 404)

    // Tất cả mọi người có thể tạo subtask (kể cả member)
    const data = await c.req.json()
    const { title, description, status, priority, assigned_to, due_date, estimated_hours, notes } = data
    if (!title?.trim()) return c.json({ error: 'Tên subtask không được để trống' }, 400)

    const result = await db.prepare(`
      INSERT INTO subtasks (task_id, title, description, status, priority, assigned_to, due_date, estimated_hours, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      taskId, title.trim(), description || null,
      status || 'todo', priority || 'medium',
      assigned_to || user.id,
      due_date || null, estimated_hours || 0, notes || null, user.id
    ).run()

    return c.json({ success: true, id: result.meta.last_row_id }, 201)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/tasks/:id/subtasks/bulk — tạo nhiều subtask cùng lúc
app.post('/api/tasks/:id/subtasks/bulk', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const taskId = parseInt(c.req.param('id'))

    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first() as any
    if (!task) return c.json({ error: 'Task không tồn tại' }, 404)

    const { subtasks } = await c.req.json()
    if (!Array.isArray(subtasks) || subtasks.length === 0) {
      return c.json({ error: 'Danh sách subtask không được để trống' }, 400)
    }

    const results: number[] = []
    for (const item of subtasks) {
      const title = (item.title || '').trim()
      if (!title) continue  // bỏ qua dòng trống
      const r = await db.prepare(`
        INSERT INTO subtasks (task_id, title, description, status, priority, assigned_to, due_date, estimated_hours, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        taskId, title, item.description || null,
        item.status || 'todo', item.priority || 'medium',
        item.assigned_to || user.id,
        item.due_date || null, item.estimated_hours || 0, item.notes || null, user.id
      ).run()
      if (r.meta?.last_row_id) results.push(r.meta.last_row_id as number)
    }

    return c.json({ success: true, created: results.length, ids: results }, 201)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// PUT /api/subtasks/:id — cập nhật subtask
app.put('/api/subtasks/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const id = parseInt(c.req.param('id'))

    const st = await db.prepare('SELECT * FROM subtasks WHERE id = ?').bind(id).first() as any
    if (!st) return c.json({ error: 'Subtask không tồn tại' }, 404)

    // Lấy task cha để kiểm tra quyền project + task assignee
    const task = await db.prepare('SELECT project_id, assigned_to FROM tasks WHERE id = ?').bind(st.task_id).first() as any
    const isAdmin = user.role === 'system_admin'
    const isProjAdminOrLeader = await isProjectLeaderOrAdmin(db, user, task?.project_id)
    const isCreator = st.created_by === user.id
    const isAssigned = st.assigned_to === user.id
    // Member được gán vào task cha cũng có quyền cập nhật subtask (status, actual_hours, notes)
    const isTaskAssignee = task?.assigned_to === user.id

    if (!isAdmin && !isProjAdminOrLeader && !isCreator && !isAssigned && !isTaskAssignee) {
      return c.json({ error: 'Không có quyền sửa subtask này' }, 403)
    }

    const data = await c.req.json()
    const allowedFields = (isAdmin || isProjAdminOrLeader)
      ? ['title', 'description', 'status', 'priority', 'assigned_to', 'due_date', 'estimated_hours', 'actual_hours', 'notes']
      : ['status', 'actual_hours', 'notes']  // member (kể cả task assignee) chỉ cập nhật trạng thái, giờ thực tế, ghi chú

    const updates: string[] = []
    const values: any[] = []
    allowedFields.forEach(f => {
      if (data[f] !== undefined) { updates.push(`${f} = ?`); values.push(data[f]) }
    })
    if (!updates.length) return c.json({ error: 'Không có gì để cập nhật' }, 400)
    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)
    await db.prepare(`UPDATE subtasks SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// DELETE /api/subtasks/:id — xóa subtask
app.delete('/api/subtasks/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const id = parseInt(c.req.param('id'))

    const st = await db.prepare('SELECT * FROM subtasks WHERE id = ?').bind(id).first() as any
    if (!st) return c.json({ error: 'Subtask không tồn tại' }, 404)

    const task = await db.prepare('SELECT project_id FROM tasks WHERE id = ?').bind(st.task_id).first() as any
    const isAdmin = user.role === 'system_admin'
    const isProjAdminOrLeader = await isProjectLeaderOrAdmin(db, user, task?.project_id)
    const isCreator = st.created_by === user.id

    if (!isAdmin && !isProjAdminOrLeader && !isCreator) {
      return c.json({ error: 'Không có quyền xóa subtask này' }, 403)
    }

    await db.prepare('DELETE FROM subtasks WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ===================================================
// CHAT / MESSAGES ROUTES
// GET    /api/messages?context_type=task|project&context_id=X
// POST   /api/messages
// DELETE /api/messages/:id
// ===================================================

// GET messages for a context (task or project)
app.get('/api/messages', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const { context_type, context_id } = c.req.query()
    if (!context_type || !context_id) return c.json({ error: 'context_type and context_id required' }, 400)

    const messages = await db.prepare(`
      SELECT m.*,
        u.full_name as sender_name,
        u.role as sender_role,
        (SELECT json_group_array(json_object(
          'id', a.id, 'file_name', a.file_name, 'file_type', a.file_type,
          'file_size', a.file_size, 'data', a.data
        )) FROM message_attachments a WHERE a.message_id = m.id) as attachments
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.context_type = ? AND m.context_id = ?
      ORDER BY m.created_at ASC
    `).bind(context_type, parseInt(context_id)).all()

    // Parse attachments JSON string
    const result = messages.results.map((msg: any) => ({
      ...msg,
      mentions: JSON.parse(msg.mentions || '[]'),
      attachments: JSON.parse(msg.attachments || '[]').filter((a: any) => a.id !== null)
    }))
    return c.json(result)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// POST new message with optional attachments
app.post('/api/messages', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const body = await c.req.json()
    const { context_type, context_id, content, mentions = [], attachments = [] } = body

    if (!context_type || !context_id || !content?.trim()) {
      return c.json({ error: 'context_type, context_id and content required' }, 400)
    }
    if (!['task', 'project'].includes(context_type)) {
      return c.json({ error: 'context_type must be task or project' }, 400)
    }
    // Check total attachment size (max 10MB total per message)
    const totalSize = attachments.reduce((s: number, a: any) => s + (a.file_size || 0), 0)
    if (totalSize > 10 * 1024 * 1024) return c.json({ error: 'Tổng file đính kèm không vượt quá 10MB' }, 400)

    const msgResult = await db.prepare(
      `INSERT INTO messages (context_type, context_id, sender_id, content, mentions) VALUES (?, ?, ?, ?, ?)`
    ).bind(context_type, parseInt(context_id), user.id, content.trim(), JSON.stringify(mentions)).run()

    const msgId = msgResult.meta.last_row_id

    // Insert attachments
    for (const att of attachments) {
      if (!att.file_name || !att.data) continue
      await db.prepare(
        `INSERT INTO message_attachments (message_id, file_name, file_type, file_size, data) VALUES (?, ?, ?, ?, ?)`
      ).bind(msgId, att.file_name, att.file_type || 'application/octet-stream', att.file_size || 0, att.data).run()
    }

    // ── Send notifications ──────────────────────────────────────────────
    // Collect recipients: @mentioned users (priority) + all participants
    const snippet = content.trim().length > 60 ? content.trim().slice(0, 60) + '…' : content.trim()
    const notifiedIds = new Set<number>()

    // Resolve context name (task title or project name)
    let contextName = ''
    let projectId = 0
    if (context_type === 'task') {
      const task = await db.prepare('SELECT title, project_id FROM tasks WHERE id = ?').bind(parseInt(context_id)).first() as any
      contextName = task?.title || `Task #${context_id}`
      projectId = task?.project_id || 0
    } else {
      const proj = await db.prepare('SELECT name, id FROM projects WHERE id = ?').bind(parseInt(context_id)).first() as any
      contextName = proj?.name || `Dự án #${context_id}`
      projectId = parseInt(context_id)
    }

    // 1. Notify @mentioned users first (high priority)
    console.log(`[MENTION] mentions array received:`, JSON.stringify(mentions))
    if (mentions && mentions.length > 0) {
      for (const m of mentions) {
        console.log(`[MENTION] processing mention:`, JSON.stringify(m))
        // Prefer lookup by id (reliable for Unicode names), fallback to full_name
        let mentionedUser: any = null
        if (m.id) {
          mentionedUser = await db.prepare(
            `SELECT id, email, full_name FROM users WHERE id = ? AND is_active = 1`
          ).bind(parseInt(m.id)).first()
          console.log(`[MENTION] lookup by id=${m.id} →`, mentionedUser ? `${mentionedUser.full_name} <${mentionedUser.email}>` : 'NOT FOUND')
        } else if (m.name) {
          mentionedUser = await db.prepare(
            `SELECT id, email, full_name FROM users WHERE full_name = ? AND is_active = 1`
          ).bind(m.name).first()
          console.log(`[MENTION] lookup by name="${m.name}" →`, mentionedUser ? `found id=${mentionedUser.id}` : 'NOT FOUND')
        }
        if (!mentionedUser) { console.log(`[MENTION] skip — user not found`); continue }
        if (mentionedUser && mentionedUser.id !== user.id) {
          notifiedIds.add(mentionedUser.id)
          const title = context_type === 'task'
            ? `💬 @Bạn được nhắc trong task`
            : `💬 @Bạn được nhắc trong dự án`
          await db.prepare(
            `INSERT INTO notifications (user_id, title, message, type, related_type, related_id) VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(
            mentionedUser.id,
            title,
            `${user.full_name} đã nhắc đến bạn trong "${contextName}": ${snippet}`,
            'chat_mention',
            context_type,
            parseInt(context_id)
          ).run()

          // ── Email: chat_mention ──
          console.log(`[MENTION] sending email to ${mentionedUser.email} (id=${mentionedUser.id})`)
          if (mentionedUser.email) {
            await sendEmail(c.env, {
              to: mentionedUser.email, toName: mentionedUser.full_name,
              eventType: 'chat_mention',
              data: { senderName: user.full_name, contextType: context_type, contextName, message: snippet },
              db, userId: mentionedUser.id, relatedType: context_type, relatedId: parseInt(context_id)
            })
            console.log(`[MENTION] sendEmail called for ${mentionedUser.email}`)
          } else {
            console.log(`[MENTION] skip email — mentionedUser has no email`)
          }
        } else {
          console.log(`[MENTION] skip — same sender or id mismatch (mentionedUser.id=${mentionedUser?.id}, sender=${user.id})`)
        }
      }
    } else {
      console.log(`[MENTION] no mentions in message`)
    }

    // 2. Notify other participants (task assigned user + ALL project members + admin/leader)
    let participantIds: number[] = []

    // Helper: collect ALL people involved in a project (members table + admin_id + leader_id)
    const collectProjectParticipants = async (projId: number) => {
      const ids: number[] = []
      // All project_members rows
      const projMembers = await db.prepare(
        `SELECT user_id FROM project_members WHERE project_id = ?`
      ).bind(projId).all()
      projMembers.results.forEach((r: any) => ids.push(r.user_id))
      // Also admin_id and leader_id from projects table
      const proj = await db.prepare('SELECT admin_id, leader_id FROM projects WHERE id = ?').bind(projId).first() as any
      if (proj?.admin_id) ids.push(proj.admin_id)
      if (proj?.leader_id) ids.push(proj.leader_id)
      return ids
    }

    if (context_type === 'task') {
      // Task: notify assigned_to + assigned_by + ALL project participants
      const taskInfo = await db.prepare('SELECT assigned_to, assigned_by, project_id FROM tasks WHERE id = ?').bind(parseInt(context_id)).first() as any
      if (taskInfo?.assigned_to) participantIds.push(taskInfo.assigned_to)
      if (taskInfo?.assigned_by) participantIds.push(taskInfo.assigned_by)
      const taskProjectId = taskInfo?.project_id || projectId
      const projParticipants = await collectProjectParticipants(taskProjectId)
      participantIds.push(...projParticipants)
    } else {
      // Project chat: notify ALL project participants
      const projParticipants = await collectProjectParticipants(parseInt(context_id))
      participantIds.push(...projParticipants)
    }

    // Deduplicate & exclude sender and already-notified (mentioned) users
    const uniqueParticipants = [...new Set(participantIds)].filter(
      uid => uid !== user.id && !notifiedIds.has(uid)
    )
    for (const uid of uniqueParticipants) {
      const title = context_type === 'task'
        ? `💬 Tin nhắn mới trong task`
        : `💬 Tin nhắn mới trong dự án`
      const msgBody = `${user.full_name} đã gửi tin trong "${contextName}": ${snippet}`

      // In-app notification
      await db.prepare(
        `INSERT INTO notifications (user_id, title, message, type, related_type, related_id) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(uid, title, msgBody, 'chat_message', context_type, parseInt(context_id)).run()
      notifiedIds.add(uid)

      // Browser push only — NO email for normal chat messages
      sendWebPush(db, uid, {
        title,
        body:        msgBody,
        tag:         `chat_message-${context_type}-${context_id}`,
        url:         '/',
        notifId:     null,
        relatedType: context_type,
        relatedId:   parseInt(context_id),
      }).catch(() => {})
    }
    // ── End notifications ──────────────────────────────────────────────────

    // Fetch created message
    const msg = await db.prepare(`
      SELECT m.*, u.full_name as sender_name, u.role as sender_role
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `).bind(msgId).first() as any

    const atts = await db.prepare(`SELECT id, file_name, file_type, file_size, data FROM message_attachments WHERE message_id = ?`).bind(msgId).all()

    return c.json({
      ...msg,
      mentions: JSON.parse(msg.mentions || '[]'),
      attachments: atts.results
    }, 201)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET unread chat message count per context (for badge display)
app.get('/api/messages/unread', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    // Return count of chat_message + chat_mention notifications unread per context
    const rows = await db.prepare(`
      SELECT related_type as context_type, related_id as context_id, COUNT(*) as count
      FROM notifications
      WHERE user_id = ? AND is_read = 0 AND type IN ('chat_message','chat_mention')
      GROUP BY related_type, related_id
    `).bind(user.id).all()
    return c.json(rows.results)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// DELETE message (only sender or system_admin)
app.delete('/api/messages/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const id = parseInt(c.req.param('id'))
    const msg = await db.prepare('SELECT sender_id FROM messages WHERE id = ?').bind(id).first() as any
    if (!msg) return c.json({ error: 'Không tìm thấy tin nhắn' }, 404)
    if (msg.sender_id !== user.id && user.role !== 'system_admin') {
      return c.json({ error: 'Không có quyền xóa tin nhắn này' }, 403)
    }
    await db.prepare('DELETE FROM messages WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ===================================================
// COST MANAGEMENT ROUTES (Admin + Project Admin/Leader)
// ===================================================
app.get('/api/costs', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
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

    // Non system_admin chỉ xem được chi phí của dự án họ quản lý
    if (user.role !== 'system_admin') {
      query += ` AND (p.admin_id = ? OR EXISTS (
        SELECT 1 FROM project_members pm WHERE pm.project_id = pc.project_id AND pm.user_id = ? AND pm.role IN ('project_admin','project_leader')
      ))`
      params.push(user.id, user.id)
    }

    if (project_id) { query += ` AND pc.project_id = ?`; params.push(parseInt(project_id)) }
    if (cost_type) { query += ` AND pc.cost_type = ?`; params.push(cost_type) }
    if (year) {
      const fySettings = await getFiscalYearSettings(db)
      const { startDate, endDate } = getFiscalYearDateRange(parseInt(year), fySettings)
      query += ` AND pc.cost_date >= ? AND pc.cost_date <= ?`
      params.push(startDate, endDate)
    }
    query += ' ORDER BY pc.cost_date DESC'

    const result = await db.prepare(query).bind(...params).all()
    return c.json(result.results)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/costs', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const data = await c.req.json()
    const { project_id, cost_type, description, amount, currency, cost_date, invoice_number, vendor, notes } = data

    if (!project_id || !cost_type || !description || !amount) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    // Kiểm tra quyền: system_admin hoặc project_admin/leader của dự án này
    if (user.role !== 'system_admin') {
      const canManage = await isProjectAdmin(db, user.id, project_id)
      if (!canManage) return c.json({ error: 'Chỉ System Admin hoặc Quản lý dự án mới được thêm chi phí' }, 403)
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

app.put('/api/costs/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const id = parseInt(c.req.param('id'))

    // Kiểm tra quyền
    if (user.role !== 'system_admin') {
      const cost = await db.prepare('SELECT project_id FROM project_costs WHERE id = ?').bind(id).first() as any
      if (!cost) return c.json({ error: 'Not found' }, 404)
      const canManage = await isProjectAdmin(db, user.id, cost.project_id)
      if (!canManage) return c.json({ error: 'Chỉ System Admin hoặc Quản lý dự án mới được sửa chi phí' }, 403)
    }

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

app.delete('/api/costs/:id', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const id = parseInt(c.req.param('id'))

    // Kiểm tra quyền
    if (user.role !== 'system_admin') {
      const cost = await db.prepare('SELECT project_id FROM project_costs WHERE id = ?').bind(id).first() as any
      if (!cost) return c.json({ error: 'Not found' }, 404)
      const canManage = await isProjectAdmin(db, user.id, cost.project_id)
      if (!canManage) return c.json({ error: 'Chỉ System Admin hoặc Quản lý dự án mới được xóa chi phí' }, 403)
    }

    await db.prepare('DELETE FROM project_costs WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Revenue routes (read-only — doanh thu chỉ được tạo tự động từ Tình trạng thanh toán)
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
    if (year) {
      // Dùng fiscal year date range thay vì calendar year
      const fySettings = await getFiscalYearSettings(db)
      const { startDate, endDate } = getFiscalYearDateRange(parseInt(year), fySettings)
      query += ` AND pr.revenue_date >= ? AND pr.revenue_date <= ?`
      params.push(startDate, endDate)
    }
    query += ' ORDER BY pr.revenue_date DESC'
    const result = await db.prepare(query).bind(...params).all()
    return c.json(result.results)
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
// Overtime x1.5: effective_hours = regular + overtime*1.5 (chỉ dùng trong tính toán nội bộ)
app.get('/api/projects/:id/labor-costs', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const OVERTIME_FACTOR = await getOvertimeFactor(db)
    const projectId = parseInt(c.req.param('id'))
    const { month, months, year, all_months } = c.req.query()
    const yInt = year ? parseInt(year) : new Date().getFullYear()
    const y = String(yInt)

    const proj = await db.prepare('SELECT id, code, name, contract_value FROM projects WHERE id = ?').bind(projectId).first() as any
    if (!proj) return c.json({ error: 'Project not found' }, 404)

    let queryType: string
    let laborCost = 0, totalHours = 0, costPerHourAvg = 0
    const monthlyBreakdown: any[] = []

    if (all_months === 'true' || months) {
      // CASE 1 & 2: Tất cả tháng hoặc nhiều tháng
      // Dùng SQL JOIN một lần thay vì vòng lặp sequential (tránh D1 concurrent bug)
      queryType = all_months === 'true' ? 'all_months' : 'multiple_months'

      // Xác định danh sách tháng cần tính
      let monthList: number[] = []
      if (all_months === 'true') {
        monthList = Array.from({ length: 12 }, (_, i) => i + 1)
      } else {
        monthList = (months as string).split(',').map((m: string) => parseInt(m.trim())).filter((m: number) => m >= 1 && m <= 12)
      }
      if (monthList.length === 0) return c.json({ error: 'No valid months provided' }, 400)

      // Thử lấy từ project_labor_costs cache trước (đã sync)
      const monthInClause = monthList.join(',')
      const cachedRows = await db.prepare(
        `SELECT month, year, total_labor_cost, total_hours, cost_per_hour
         FROM project_labor_costs
         WHERE project_id = ? AND year = ? AND month IN (${monthInClause})
         ORDER BY month`
      ).bind(projectId, yInt).all()
      const cachedArr = cachedRows.results as any[]
      const cachedMonthSet = new Set(cachedArr.map((r: any) => r.month))

      // Thêm tháng đã cache vào breakdown
      cachedArr.forEach((r: any) => {
        laborCost  += r.total_labor_cost || 0
        totalHours += r.total_hours      || 0
        monthlyBreakdown.push(r)
      })

      // Tháng chưa có cache → tính real-time bằng SQL JOIN (không dùng vòng lặp DB)
      const uncachedMonths = monthList.filter(m => !cachedMonthSet.has(m))
      if (uncachedMonths.length > 0) {
        const uncachedInClause = uncachedMonths.join(',')
        // Một query lấy: monthly_labor_costs × proj timesheets × company timesheets
        // Effective hours = regular + overtime*1.5
        const rtRows = await db.prepare(`
          SELECT
            mlc.month,
            mlc.year,
            mlc.total_labor_cost as monthly_budget,
            COALESCE(proj_ts.proj_reg  , 0)                                       as proj_regular,
            COALESCE(proj_ts.proj_ot   , 0)                                       as proj_overtime,
            COALESCE(proj_ts.proj_reg + proj_ts.proj_ot * ?, 0)                   as proj_eff_hours,
            COALESCE(proj_ts.proj_raw  , 0)                                       as proj_raw_hours,
            COALESCE(comp_ts.comp_eff  , 0)                                       as comp_eff_hours
          FROM monthly_labor_costs mlc
          LEFT JOIN (
            SELECT CAST(strftime('%m', work_date) AS INTEGER) as ts_month,
                   SUM(regular_hours)              as proj_reg,
                   SUM(IFNULL(overtime_hours, 0))  as proj_ot,
                   SUM(regular_hours + IFNULL(overtime_hours, 0)) as proj_raw,
                   SUM(regular_hours + IFNULL(overtime_hours, 0) * ?) as proj_eff
            FROM timesheets
            WHERE project_id = ? AND strftime('%Y', work_date) = ?
              AND CAST(strftime('%m', work_date) AS INTEGER) IN (${uncachedInClause})
            GROUP BY ts_month
          ) proj_ts ON proj_ts.ts_month = mlc.month
          LEFT JOIN (
            SELECT CAST(strftime('%m', work_date) AS INTEGER) as ts_month,
                   SUM(regular_hours + IFNULL(overtime_hours, 0) * ?) as comp_eff
            FROM timesheets
            WHERE strftime('%Y', work_date) = ?
              AND CAST(strftime('%m', work_date) AS INTEGER) IN (${uncachedInClause})
            GROUP BY ts_month
          ) comp_ts ON comp_ts.ts_month = mlc.month
          WHERE mlc.year = ? AND mlc.month IN (${uncachedInClause})
        `).bind(
          OVERTIME_FACTOR,   // proj_eff_hours
          OVERTIME_FACTOR, projectId, y,   // proj subquery
          OVERTIME_FACTOR, y,              // comp subquery
          yInt               // mlc.year
        ).all()

        ;(rtRows.results as any[]).forEach((r: any) => {
          const cph = r.comp_eff_hours > 0 ? r.monthly_budget / r.comp_eff_hours : 0
          const mc  = Math.round((r.proj_eff_hours || 0) * cph)
          laborCost  += mc
          totalHours += r.proj_raw_hours || 0
          monthlyBreakdown.push({
            month: r.month, year: r.year,
            total_hours: r.proj_raw_hours || 0,
            cost_per_hour: Math.round(cph),
            total_labor_cost: mc
          })
        })
        // Tháng có timesheet nhưng không có monthly_labor_costs → ghi nhận 0
        uncachedMonths.forEach(mi => {
          if (!(rtRows.results as any[]).find((r: any) => r.month === mi)) {
            monthlyBreakdown.push({ month: mi, year: yInt, total_hours: 0, cost_per_hour: 0, total_labor_cost: 0 })
          }
        })
      }

      monthlyBreakdown.sort((a: any, b: any) => a.month - b.month)
      const withData = monthlyBreakdown.filter((r: any) => r.total_hours > 0)
      costPerHourAvg = withData.length > 0 ? withData.reduce((s: number, r: any) => s + r.cost_per_hour, 0) / withData.length : 0

    } else {
      // CASE 3: Single month
      queryType = 'single_month'
      const mInt = month ? parseInt(month) : new Date().getMonth() + 1
      const m = String(mInt).padStart(2, '0')

      const cached = await db.prepare(
        `SELECT total_labor_cost, total_hours, cost_per_hour FROM project_labor_costs
         WHERE project_id = ? AND month = ? AND year = ?`
      ).bind(projectId, mInt, yInt).first() as any

      if (cached) {
        laborCost = cached.total_labor_cost; totalHours = cached.total_hours
        costPerHourAvg = cached.cost_per_hour
      } else {
        const { costPerHour, totalEffectHrs } = await computeMonthLaborCost(db, mInt, yInt)
        // Giờ quy đổi của dự án (OT x1.5)
        const projRow = await db.prepare(
          `SELECT SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as eff_hours,
                  SUM(regular_hours + IFNULL(overtime_hours,0))     as raw_hours
           FROM timesheets
           WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
        ).bind(OVERTIME_FACTOR, projectId, y, m).first() as any
        const projEff = projRow?.eff_hours || 0
        totalHours    = projRow?.raw_hours || 0
        costPerHourAvg = costPerHour
        laborCost = Math.round(projEff * costPerHour)
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
        months_with_data: monthlyBreakdown.filter((r: any) => r.total_hours > 0).length
      }
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/projects/:id/labor-costs-yearly — full year breakdown
// Overtime x1.5: dùng effective_hours trong tính toán, hiển thị raw_hours ra ngoài
app.get('/api/projects/:id/labor-costs-yearly', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const OVERTIME_FACTOR = await getOvertimeFactor(db)
    const projectId = parseInt(c.req.param('id'))
    const year = c.req.query('year') || String(new Date().getFullYear())
    const yInt = parseInt(year)

    const proj = await db.prepare('SELECT id, code, name FROM projects WHERE id = ?').bind(projectId).first() as any
    if (!proj) return c.json({ error: 'Project not found' }, 404)

    // Lấy tháng đã sync trong project_labor_costs
    const cached = await db.prepare(
      `SELECT month, year, total_hours, cost_per_hour, total_labor_cost
       FROM project_labor_costs WHERE project_id = ? AND year = ? ORDER BY month`
    ).bind(projectId, yInt).all()

    const cachedArr   = cached.results as any[]
    const cachedMonths = new Set(cachedArr.map((r: any) => r.month))

    // Tháng chưa cache → tính real-time bằng SQL JOIN (overtime x1.5, không vòng lặp)
    const uncached = Array.from({ length: 12 }, (_, i) => i + 1).filter(m => !cachedMonths.has(m))
    let rtArr: any[] = []

    if (uncached.length > 0) {
      const inClause = uncached.join(',')
      const rtRows = await db.prepare(`
        SELECT
          mlc.month, mlc.year, mlc.total_labor_cost as monthly_budget,
          COALESCE(proj_ts.proj_raw, 0)                           as proj_raw_hours,
          COALESCE(proj_ts.proj_eff, 0)                           as proj_eff_hours,
          COALESCE(comp_ts.comp_eff, 0)                           as comp_eff_hours
        FROM monthly_labor_costs mlc
        LEFT JOIN (
          SELECT CAST(strftime('%m', work_date) AS INTEGER) as ts_month,
                 SUM(regular_hours + IFNULL(overtime_hours, 0))       as proj_raw,
                 SUM(regular_hours + IFNULL(overtime_hours, 0) * ?)   as proj_eff
          FROM timesheets
          WHERE project_id = ? AND strftime('%Y', work_date) = ?
            AND CAST(strftime('%m', work_date) AS INTEGER) IN (${inClause})
          GROUP BY ts_month
        ) proj_ts ON proj_ts.ts_month = mlc.month
        LEFT JOIN (
          SELECT CAST(strftime('%m', work_date) AS INTEGER) as ts_month,
                 SUM(regular_hours + IFNULL(overtime_hours, 0) * ?)   as comp_eff
          FROM timesheets
          WHERE strftime('%Y', work_date) = ?
            AND CAST(strftime('%m', work_date) AS INTEGER) IN (${inClause})
          GROUP BY ts_month
        ) comp_ts ON comp_ts.ts_month = mlc.month
        WHERE mlc.year = ? AND mlc.month IN (${inClause})
      `).bind(OVERTIME_FACTOR, projectId, year, OVERTIME_FACTOR, year, yInt).all()

      ;(rtRows.results as any[]).forEach((r: any) => {
        const cph = r.comp_eff_hours > 0 ? r.monthly_budget / r.comp_eff_hours : 0
        rtArr.push({
          month: r.month, year: r.year,
          total_hours: r.proj_raw_hours || 0,
          cost_per_hour: Math.round(cph),
          total_labor_cost: Math.round((r.proj_eff_hours || 0) * cph)
        })
      })
    }

    // Điền đủ 12 tháng (tháng không có dữ liệu = 0)
    const allMonths = Array.from({ length: 12 }, (_, i) => {
      const mi = i + 1
      const c2 = cachedArr.find((r: any) => r.month === mi)
      if (c2) return c2
      const rt = rtArr.find((r: any) => r.month === mi)
      if (rt) return rt
      return { month: mi, year: yInt, total_hours: 0, cost_per_hour: 0, total_labor_cost: 0 }
    })

    const annualLaborCost = allMonths.reduce((s: number, r: any) => s + (r.total_labor_cost || 0), 0)
    const annualHours     = allMonths.reduce((s: number, r: any) => s + (r.total_hours || 0), 0)
    const withData        = allMonths.filter((r: any) => r.total_hours > 0)
    const avgCostPerHour  = withData.length > 0
      ? withData.reduce((s: number, r: any) => s + r.cost_per_hour, 0) / withData.length : 0

    return c.json({
      project_id: projectId, project_code: proj.code, project_name: proj.name, year: yInt,
      monthly_breakdown: allMonths,
      yearly_total: { annual_labor_cost: Math.round(annualLaborCost), annual_hours: annualHours, avg_cost_per_hour: Math.round(avgCostPerHour), months_count: withData.length },
      summary:     { total_labor_cost: Math.round(annualLaborCost), total_hours: annualHours, avg_cost_per_hour: Math.round(avgCostPerHour), months_with_data: withData.length }
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
    const OVERTIME_FACTOR = await getOvertimeFactor(db)   // FIX: was missing, caused ReferenceError → 500
    const projectId = parseInt(c.req.param('id'))
    const body = await c.req.json().catch(() => ({})) as any
    const { month, year, force_recalculate = false, all_months = false } = body
    const yInt = year ? parseInt(year) : new Date().getFullYear()
    const y = String(yInt)

    // ── all_months mode: sync every month that has timesheet data ────
    if (all_months) {
      // Find all months in the year that have timesheet data for this project
      const tsMonths = await db.prepare(`
        SELECT DISTINCT CAST(strftime('%m', work_date) AS INTEGER) as month
        FROM timesheets
        WHERE project_id = ? AND strftime('%Y', work_date) = ?
        ORDER BY month
      `).bind(projectId, y).all()

      const months = (tsMonths.results as any[]).map((r: any) => r.month)
      if (months.length === 0) {
        return c.json({ success: false, error: `Không có dữ liệu timesheet năm ${yInt} cho dự án này` }, 400)
      }

      let totalSynced = 0, totalCost = 0, created = 0, updated = 0
      const results: any[] = []

      for (const mInt of months) {
        const m = String(mInt).padStart(2, '0')
        const { totalHrs, costPerHour } = await computeMonthLaborCost(db, mInt, yInt, OVERTIME_FACTOR)
        if (totalHrs === 0) continue

        const projRow = await db.prepare(
          `SELECT SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as eff_hours,
                  SUM(regular_hours + IFNULL(overtime_hours,0))     as raw_hours
           FROM timesheets
           WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
        ).bind(OVERTIME_FACTOR, projectId, y, m).first() as any
        const projectEffHours = projRow?.eff_hours || 0
        const projectHours    = projRow?.raw_hours || 0
        if (projectHours === 0) continue
        const projectLaborCost = Math.round(projectEffHours * costPerHour)

        const existing = await db.prepare(
          `SELECT id FROM project_labor_costs WHERE project_id = ? AND month = ? AND year = ?`
        ).bind(projectId, mInt, yInt).first() as any

        if (existing) {
          await db.prepare(
            `UPDATE project_labor_costs SET total_hours = ?, cost_per_hour = ?, total_labor_cost = ?, updated_at = CURRENT_TIMESTAMP
             WHERE project_id = ? AND month = ? AND year = ?`
          ).bind(projectHours, Math.round(costPerHour), projectLaborCost, projectId, mInt, yInt).run()
          updated++
        } else {
          await db.prepare(
            `INSERT INTO project_labor_costs (project_id, month, year, total_hours, cost_per_hour, total_labor_cost) VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(projectId, mInt, yInt, projectHours, Math.round(costPerHour), projectLaborCost).run()
          created++
        }
        totalSynced++
        totalCost += projectLaborCost
        results.push({ month: mInt, total_hours: projectHours, cost_per_hour: Math.round(costPerHour), total_labor_cost: projectLaborCost })
      }

      return c.json({
        success: true, action: 'synced_all',
        months_synced: totalSynced, created, updated,
        total_labor_cost: totalCost,
        data: { total_labor_cost: totalCost, months_synced: totalSynced, results },
        message: `Đã đồng bộ ${totalSynced} tháng (tổng ${Math.round(totalCost).toLocaleString('vi-VN')} ₫)`
      })
    }

    // ── single month mode ────────────────────────────────────────────
    const mInt = month ? parseInt(month) : new Date().getMonth() + 1
    const m = String(mInt).padStart(2, '0')

    // Check existing
    const existing = await db.prepare(
      `SELECT id, total_labor_cost FROM project_labor_costs WHERE project_id = ? AND month = ? AND year = ?`
    ).bind(projectId, mInt, yInt).first() as any

    if (existing && !force_recalculate) {
      return c.json({ success: true, action: 'existing', data: existing, message: 'Chi phí đã tồn tại, dùng force_recalculate=true để tính lại' })
    }

    // Calculate với overtime x1.5
    const { totalHrs, costPerHour } = await computeMonthLaborCost(db, mInt, yInt, OVERTIME_FACTOR)
    if (totalHrs === 0) {
      return c.json({ success: false, error: `Không có dữ liệu timesheet tháng ${mInt}/${yInt}` }, 400)
    }

    // Giờ quy đổi của dự án (OT x1.5)
    const projRow = await db.prepare(
      `SELECT SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as eff_hours,
              SUM(regular_hours + IFNULL(overtime_hours,0))     as raw_hours
       FROM timesheets
       WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
    ).bind(OVERTIME_FACTOR, projectId, y, m).first() as any
    const projectEffHours = projRow?.eff_hours || 0
    const projectHours    = projRow?.raw_hours || 0
    const projectLaborCost = Math.round(projectEffHours * costPerHour)

    if (existing) {
      await db.prepare(
        `UPDATE project_labor_costs SET total_hours = ?, cost_per_hour = ?, total_labor_cost = ?, updated_at = CURRENT_TIMESTAMP
         WHERE project_id = ? AND month = ? AND year = ?`
      ).bind(projectHours, Math.round(costPerHour), projectLaborCost, projectId, mInt, yInt).run()
      return c.json({ success: true, action: 'updated', data: { total_hours: projectHours, cost_per_hour: Math.round(costPerHour), total_labor_cost: projectLaborCost }, message: `Đã cập nhật chi phí lương tháng ${mInt}/${yInt}` })
    } else {
      await db.prepare(
        `INSERT INTO project_labor_costs (project_id, month, year, total_hours, cost_per_hour, total_labor_cost) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(projectId, mInt, yInt, projectHours, Math.round(costPerHour), projectLaborCost).run()
      return c.json({ success: true, action: 'created', data: { total_hours: projectHours, cost_per_hour: Math.round(costPerHour), total_labor_cost: projectLaborCost }, message: `Đã tạo chi phí lương tháng ${mInt}/${yInt}` })
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
// Logic HYBRID từng tháng: ưu tiên project_labor_costs (synced), fallback real-time.
// Hỗ trợ năm tài chính (NTC): all_months=true → dùng fiscal year mapping.
// months=1..12 → tháng NTC (logical) → convert sang calendar (year, month).
app.get('/api/financial-summary/labor-costs-all-projects', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const OVERTIME_FACTOR = await getOvertimeFactor(db)
    const fySettings = await getFiscalYearSettings(db)
    const { months, year, all_months } = c.req.query()
    const yInt = year ? parseInt(year) : new Date().getFullYear()

    // ── Xác định danh sách (calYear, calMonth) cần tính ──────────────
    // Chế độ all_months: tất cả 12 tháng NTC của năm tài chính
    //   e.g. NTC 2026, start_month=2: T1=Feb/2026, T2=Mar/2026, ..., T12=Jan/2027
    // Chế độ months (multi-select): UI gửi giá trị tháng DƯƠNG LỊCH (1=Jan, 2=Feb, ...)
    //   → dùng trực tiếp (month, yInt) không cần convert fiscal

    interface CalPair { calYear: number; calMonth: number; fiscalIdx: number }
    let calPairs: CalPair[]

    if (all_months === 'true' || !months) {
      // Tất cả 12 tháng NTC → convert từng tháng NTC (T1..T12) sang calendar
      const sm = fySettings.start_month
      calPairs = Array.from({ length: 12 }, (_, i) => {
        const fiscalIdx = i + 1  // T1=1, T2=2, ..., T12=12
        // Calendar month của Tháng fiscal T{fiscalIdx}:
        // T1 = start_month (sm), T2 = sm+1, ..., wrap qua năm sau nếu > 12
        const rawCal = sm - 1 + fiscalIdx  // 1-based
        const calMonth = ((rawCal - 1) % 12) + 1
        const calYear = rawCal > 12 ? yInt + 1 : yInt
        return { calYear, calMonth, fiscalIdx }
      })
    } else {
      // Multi-month: UI gửi tháng DƯƠNG LỊCH (1=Jan...12=Dec) của năm đang chọn
      // Dùng trực tiếp, KHÔNG convert fiscal
      const parsed = months.split(',').map((m: string) => parseInt(m.trim())).filter((m: number) => m >= 1 && m <= 12)
      const sm = fySettings.start_month
      calPairs = parsed.map((calM, idx) => {
        // Tính fiscalIdx để hiển thị đúng nhãn T1..T12
        const rawFiscal = calM - sm + 1
        const fiscalIdx = rawFiscal <= 0 ? rawFiscal + 12 : rawFiscal
        return { calYear: yInt, calMonth: calM, fiscalIdx }
      })
    }

    // ── Pool total: tổng ngân sách đã nhập (monthly_labor_costs) cho kỳ này ─
    // monthly_labor_costs lưu theo tháng dương lịch (calYear, calMonth)
    let poolTotal = 0
    for (const { calYear, calMonth } of calPairs) {
      const poolRow = await db.prepare(
        `SELECT COALESCE(total_labor_cost, 0) as v FROM monthly_labor_costs WHERE month = ? AND year = ?`
      ).bind(calMonth, calYear).first() as any
      poolTotal += poolRow?.v || 0
    }

    // ── HYBRID: tính từng tháng calendar, ưu tiên synced → fallback real-time ──
    const projectMap: Record<number, any> = {}
    let hasSynced = false, hasRealtime = false
    let grandEffHours = 0

    for (const { calYear, calMonth, fiscalIdx } of calPairs) {
      const calY = String(calYear)
      const calM = String(calMonth).padStart(2, '0')

      // 1. Kiểm tra project_labor_costs (synced) cho (calYear, calMonth) này
      const syncedRows = await db.prepare(`
        SELECT p.id as project_id, p.code as project_code, p.name as project_name,
               plc.total_labor_cost, plc.total_hours, plc.cost_per_hour
        FROM project_labor_costs plc
        JOIN projects p ON plc.project_id = p.id
        WHERE plc.year = ? AND plc.month = ?
      `).bind(calYear, calMonth).all()

      if ((syncedRows.results as any[]).length > 0) {
        hasSynced = true
        for (const row of syncedRows.results as any[]) {
          const pid = row.project_id
          if (!projectMap[pid]) projectMap[pid] = { project_id: pid, project_code: row.project_code, project_name: row.project_name, total_labor_cost: 0, total_hours: 0, _eff_hours: 0, months_count: 0 }
          projectMap[pid].total_labor_cost += row.total_labor_cost || 0
          projectMap[pid].total_hours      += row.total_hours      || 0
          const effH = row.cost_per_hour > 0 ? (row.total_labor_cost / row.cost_per_hour) : (row.total_hours || 0)
          projectMap[pid]._eff_hours += effH
          grandEffHours += effH
          projectMap[pid].months_count++
        }
        continue
      }

      // 2. Fallback real-time: monthly_labor_costs + timesheets
      const mlcRow = await db.prepare(
        `SELECT total_labor_cost FROM monthly_labor_costs WHERE month = ? AND year = ?`
      ).bind(calMonth, calYear).first() as any
      if (!mlcRow?.total_labor_cost) continue

      const compHrsRow = await db.prepare(`
        SELECT SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as comp_eff
        FROM timesheets WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
      `).bind(OVERTIME_FACTOR, calY, calM).first() as any
      const compEff = compHrsRow?.comp_eff || 0
      if (compEff <= 0) continue

      const cph = mlcRow.total_labor_cost / compEff

      const projRows = await db.prepare(`
        SELECT project_id,
               SUM(regular_hours + IFNULL(overtime_hours,0))     as proj_raw,
               SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as proj_eff
        FROM timesheets
        WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
        GROUP BY project_id
        HAVING proj_raw > 0
      `).bind(OVERTIME_FACTOR, calY, calM).all()

      if ((projRows.results as any[]).length === 0) continue
      hasRealtime = true

      const projIds = (projRows.results as any[]).map((r: any) => r.project_id)
      const projInfoRows = await db.prepare(
        `SELECT id, code, name FROM projects WHERE id IN (${projIds.join(',')})`
      ).all()
      const projInfoMap: Record<number, any> = {}
      for (const p of projInfoRows.results as any[]) projInfoMap[p.id] = p

      for (const row of projRows.results as any[]) {
        const pid = row.project_id
        const projRaw = row.proj_raw || 0
        const projEff = row.proj_eff || 0
        if (projRaw <= 0) continue
        const mc = Math.round(projEff * cph)
        if (!projectMap[pid]) {
          const pi = projInfoMap[pid]
          if (!pi) continue
          projectMap[pid] = { project_id: pid, project_code: pi.code, project_name: pi.name, total_labor_cost: 0, total_hours: 0, _eff_hours: 0, months_count: 0 }
        }
        projectMap[pid].total_labor_cost += mc
        projectMap[pid].total_hours      += projRaw
        projectMap[pid]._eff_hours       += projEff
        grandEffHours += projEff
        projectMap[pid].months_count++
      }
    }

    const projectsArr = Object.values(projectMap)
      .filter((r: any) => r.total_labor_cost > 0)
      .sort((a: any, b: any) => b.total_labor_cost - a.total_labor_cost)

    const grandTotal    = projectsArr.reduce((s: number, r: any) => s + (r.total_labor_cost || 0), 0)
    const grandRawHours = projectsArr.reduce((s: number, r: any) => s + (r.total_hours || 0), 0)
    const grandAvgCph   = grandEffHours > 0 ? grandTotal / grandEffHours : 0

    const dataSource = hasSynced && hasRealtime ? 'mixed' : hasSynced ? 'synced' : hasRealtime ? 'realtime' : 'none'

    // Xóa field nội bộ _eff_hours trước khi trả về
    const projectsOut = projectsArr.map((r: any) => {
      const { _eff_hours, ...rest } = r
      return rest
    })

    return c.json({
      year: yInt,
      fiscal_year_start_month: fySettings.start_month,
      period_type: all_months === 'true' || !months ? 'full_year' : 'selected_months',
      data_source: dataSource,
      projects: projectsOut,
      grand_total_labor_cost: Math.round(grandTotal),
      grand_total_hours: grandRawHours,
      grand_total_eff_hours: Math.round(grandEffHours),
      grand_avg_cost_per_hour: Math.round(grandAvgCph),
      projects_count: projectsArr.length,
      // Tổng ngân sách lương đã nhập (monthly_labor_costs pool)
      pool_total: Math.round(poolTotal),
      // Danh sách tháng NTC đã tính (chỉ số fiscal T1..T12)
      fiscal_months_included: calPairs.map(p => p.fiscalIdx),
      // Danh sách calendar pairs để UI render đúng nhãn tháng
      // fiscalIdx = chỉ số NTC T1..T12; calMonth/calYear = tháng dương lịch tương ứng
      cal_pairs: calPairs.map(p => ({ fiscalIdx: p.fiscalIdx, calYear: p.calYear, calMonth: p.calMonth }))
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/projects/:id/costs-revenue-summary
// Tóm tắt tài chính dự án — hỗ trợ đầy đủ 3 chế độ:
//   ?month=M&year=Y           → single month (M là tháng lịch, Y là NTC)
//   ?months=1,2,3&year=Y      → multiple months (SUM)
//   ?all_months=true&year=Y   → whole fiscal year (SUM tất cả tháng)
// Chi phí lương = SUM(project_labor_costs) cho kỳ chọn
// Nếu không có cached data → tính real-time TỪNG THÁNG rồi cộng dồn
app.get('/api/projects/:id/costs-revenue-summary', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const OVERTIME_FACTOR = await getOvertimeFactor(db)
    const fySettings = await getFiscalYearSettings(db)
    const projectId = parseInt(c.req.param('id'))
    const { month, months, year, all_months } = c.req.query()
    const yInt = year ? parseInt(year) : new Date().getFullYear()
    const y = String(yInt)

    const proj = await db.prepare('SELECT id, code, name, contract_value FROM projects WHERE id = ?').bind(projectId).first() as any
    if (!proj) return c.json({ error: 'Project not found' }, 404)
    const contractValue = proj.contract_value || 0

    // ── Fiscal year date range ──────────────────────────────────────
    const { startDate: fyStart, endDate: fyEnd } = getFiscalYearDateRange(yInt, fySettings)

    // ── Determine period type & month list ──────────────────────────
    let periodType = 'all_months'
    let periodLabel = `Toàn NTC ${yInt}`
    let selectedMonths: number[] | null = null   // null = all months in fiscal year

    if (all_months === 'true') {
      periodType = 'all_months'
      periodLabel = `Toàn NTC ${yInt}`
      selectedMonths = null   // will sum all months in DB
    } else if (months) {
      const parsed = months.split(',').map((m: string) => parseInt(m.trim())).filter((m: number) => m >= 1 && m <= 12)
      if (parsed.length > 0) {
        selectedMonths = parsed
        periodType = 'multiple_months'
        periodLabel = `T${parsed.join(',')} NTC${yInt}`
      }
    } else if (month) {
      const mInt = parseInt(month)
      if (mInt >= 1 && mInt <= 12) {
        selectedMonths = [mInt]
        periodType = 'single_month'
        periodLabel = `T${mInt} NTC${yInt}`
      }
    }

    // ── Build SQL date filters for project_costs / project_revenues ──
    // Dùng fiscal year date range thay vì chỉ lọc theo năm dương lịch
    let costDateFilter: string
    let revDateFilter: string

    if (selectedMonths !== null && all_months !== 'true') {
      // Lọc theo tháng cụ thể trong NTC — dùng calendar year+month mapping
      const costMonthConds = fiscalMonthsSQLFilter(selectedMonths, yInt, fySettings, 'pc.cost_date')
      const revMonthConds  = fiscalMonthsSQLFilter(selectedMonths, yInt, fySettings, 'pr.revenue_date')
      costDateFilter = `AND ${costMonthConds}`
      revDateFilter  = `AND ${revMonthConds}`
    } else {
      // Toàn NTC: dùng date range
      costDateFilter = `AND pc.cost_date >= '${fyStart}' AND pc.cost_date <= '${fyEnd}'`
      revDateFilter  = `AND pr.revenue_date >= '${fyStart}' AND pr.revenue_date <= '${fyEnd}'`
    }

    // ── Step 1: Labor cost — HYBRID từng tháng ──────────────────────
    // Mỗi tháng: ưu tiên project_labor_costs (đã sync), fallback real-time.
    // Cộng dồn tất cả → đúng kể cả khi chỉ sync 1 phần tháng trong NTC.
    const monthsToCalcCRS: number[] = selectedMonths !== null
      ? selectedMonths
      : (() => {
          const sm = fySettings.start_month
          const result: number[] = []
          for (let i = 0; i < 12; i++) result.push(((sm - 1 + i) % 12) + 1)
          return result
        })()

    let laborCost   = 0
    let laborHours  = 0
    let laborPerHour = 0
    let laborMonthsCount = 0
    let laborSource = 'none'
    let crsHasSynced = false; let crsHasRealtime = false
    let crsCphSum = 0; let crsCphCount = 0

    for (const lm of monthsToCalcCRS) {
      const { calYear, calMonth } = fiscalMonthToCalendar(lm, yInt, fySettings)
      const calY = String(calYear)
      const calM = String(calMonth).padStart(2, '0')

      // Ưu tiên cached
      const cachedRow = await db.prepare(
        `SELECT total_labor_cost, total_hours, cost_per_hour
         FROM project_labor_costs plc WHERE plc.project_id = ? AND plc.month = ? AND plc.year = ?`
      ).bind(projectId, calMonth, calYear).first() as any

      if (cachedRow?.total_labor_cost) {
        laborCost += cachedRow.total_labor_cost
        laborHours += cachedRow.total_hours || 0
        crsCphSum += cachedRow.cost_per_hour || 0
        crsCphCount++
        laborMonthsCount++
        crsHasSynced = true
        continue
      }

      // Fallback real-time
      const mlcRow = await db.prepare(
        `SELECT total_labor_cost FROM monthly_labor_costs WHERE month = ? AND year = ?`
      ).bind(calMonth, calYear).first() as any
      if (!mlcRow?.total_labor_cost) continue

      const projHrsRow = await db.prepare(`
        SELECT SUM(regular_hours + IFNULL(overtime_hours,0))     as proj_raw,
               SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as proj_eff
        FROM timesheets
        WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
      `).bind(OVERTIME_FACTOR, projectId, calY, calM).first() as any

      const compHrsRow = await db.prepare(`
        SELECT SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as comp_eff
        FROM timesheets
        WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
      `).bind(OVERTIME_FACTOR, calY, calM).first() as any

      const projRaw = projHrsRow?.proj_raw || 0
      const projEff = projHrsRow?.proj_eff || 0
      const compEff = compHrsRow?.comp_eff || 0
      if (projRaw <= 0 || compEff <= 0) continue

      const cph = mlcRow.total_labor_cost / compEff
      const mc  = Math.round(projEff * cph)
      laborCost += mc; laborHours += projRaw
      crsCphSum += cph; crsCphCount++
      laborMonthsCount++
      crsHasRealtime = true
    }

    laborPerHour = crsCphCount > 0 ? crsCphSum / crsCphCount : 0
    laborSource = laborCost > 0
      ? (crsHasSynced && crsHasRealtime ? 'mixed' : crsHasSynced ? 'project_labor_costs' : 'realtime')
      : 'none'

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
    // Chỉ tính doanh thu đã thanh toán (paid) hoặc thanh toán một phần (partial)
    // Chờ TT (pending) chưa về tài khoản → không tính là doanh thu thực tế
    const revRow = await db.prepare(`
      SELECT
        SUM(CASE WHEN pr.payment_status IN ('paid','partial') THEN pr.amount ELSE 0 END) as total,
        SUM(CASE WHEN pr.payment_status = 'pending' THEN pr.amount ELSE 0 END) as pending_total
      FROM project_revenues pr
      WHERE pr.project_id = ? ${revDateFilter}
    `).bind(projectId).first() as any
    const revenue = revRow?.total || 0
    const pendingRevenue = revRow?.pending_total || 0

    // ── Totals & profit ─────────────────────────────────────────────
    // Chi phí chung phân bổ về dự án này (theo năm + tháng được chọn)
    // FIX: Chi phí có month=NULL là chi phí CẢ NĂM → chỉ tính khi query toàn năm (all_months)
    //      Chi phí có month=M chỉ tính khi M nằm trong danh sách tháng được chọn
    let sharedWhere = `WHERE sca.project_id = ? AND sc.status != 'deleted' AND sc.year = ?`
    const sharedParams: any[] = [projectId, yInt]
    if (selectedMonths !== null) {
      // Specific months selected: only include shared costs tied to those months (exclude NULL-month annual costs)
      sharedWhere += ` AND sc.month IN (${selectedMonths.join(',')})`
    }
    // all_months=true (selectedMonths === null): include all costs for the year (both NULL-month and specific-month)
    const sharedRow = await db.prepare(`
      SELECT COALESCE(SUM(sca.allocated_amount), 0) as total,
             COUNT(DISTINCT sca.shared_cost_id) as cnt
      FROM shared_cost_allocations sca
      JOIN shared_costs sc ON sc.id = sca.shared_cost_id
      ${sharedWhere}
    `).bind(...sharedParams).first() as any
    const sharedCostAllocated = sharedRow?.total || 0
    const sharedCostCount = sharedRow?.cnt || 0

    const totalCosts = laborCost + totalOtherCosts + sharedCostAllocated
    // FIX: Doanh thu thực tế = CHỈ từ project_revenues đã khai báo
    // KHÔNG fallback sang contract_value — chưa khai báo = 0
    const revenueBase = revenue  // chỉ tính paid + partial
    // FIX Bug3: Luôn tính profit = revenue - cost (âm khi chưa có doanh thu nhưng đã có chi phí)
    // Chỉ để null khi KHÔNG có cả doanh thu lẫn chi phí (dự án chưa hoạt động)
    const profit = (revenueBase > 0 || totalCosts > 0) ? revenueBase - totalCosts : null
    const profitMargin = revenueBase > 0 && profit !== null ? parseFloat(((profit / revenueBase) * 100).toFixed(1)) : null

    // Validation warnings
    if (contractValue > 0 && totalCosts > contractValue * 1.2)
      validation_warnings.push(`Tổng chi phí vượt 120% giá trị hợp đồng`)
    if (profit !== null && profit <= 0) validation_warnings.push(`Lợi nhuận âm: ${fmtNum(profit)} ₫`)
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
      })),
      ...(sharedCostAllocated > 0 ? [{
        type: 'Chi phí chung (phân bổ)', cost_type: 'shared',
        amount: sharedCostAllocated, is_auto: true, shared_count: sharedCostCount,
        percentage: totalCosts > 0 ? parseFloat(((sharedCostAllocated/totalCosts)*100).toFixed(1)) : 0,
        source: 'shared_costs'
      }] : [])
    ]

    return c.json({
      project: { id: projectId, code: proj.code, name: proj.name, contract_value: contractValue },
      period: { type: periodType, label: periodLabel, year: yInt,
        selected_months: selectedMonths,
        months_count: laborMonthsCount },
      financial: {
        revenue: { value: revenueBase, actual_revenue: revenue, pending_revenue: pendingRevenue, contract_value: contractValue,
          label: revenue > 0 ? 'Doanh thu đã thanh toán' : (pendingRevenue > 0 ? 'Chờ thanh toán' : 'Chưa khai báo doanh thu') },
        costs: {
          labor: { value: laborCost, label: 'Chi phí lương', source: laborSource,
            synced_from: laborSource === 'project_labor_costs' ? 'Chi Phí Lương (đã đồng bộ)' : laborSource === 'mixed' ? 'Hybrid: đồng bộ + real-time' : 'Tính real-time từ timesheet',
            details: { total_hours: laborHours, cost_per_hour: Math.round(laborPerHour),
              months_count: laborMonthsCount,
              formula: laborHours > 0
                ? `${laborHours}h × ${Math.round(laborPerHour).toLocaleString('vi-VN')} ₫/h`
                : `Tổng ${laborMonthsCount} tháng` } },
          other: { value: totalOtherCosts, label: 'Chi phí khác', breakdown: otherCostArr, source: 'project_costs' },
          shared: { value: sharedCostAllocated, label: 'Chi phí chung (phân bổ)', count: sharedCostCount, source: 'shared_costs' },
          total: { value: totalCosts, label: 'Tổng chi phí' }
        },
        profit: { value: profit, percentage: profitMargin, label: 'Lợi nhuận' }
      },
      cost_breakdown: costBreakdown,
      data_sync: {
        labor_synced_from: laborSource === 'project_labor_costs' ? 'Chi Phí Lương (project_labor_costs)' : laborSource === 'mixed' ? 'Hybrid (đồng bộ + real-time)' : 'Real-time calculation',
        last_updated: new Date().toISOString()
      },
      validation: { warnings: validation_warnings, has_warnings: validation_warnings.length > 0,
        profit_status: profit === null ? 'no_data' : (profit > 0 ? (profitMargin !== null && profitMargin < 10 ? 'warning' : 'ok') : 'error') }
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

    // --- Doanh thu thực tế trong tháng (chỉ paid + partial) ---
    const revenueMonth = await db.prepare(
      `SELECT
         SUM(CASE WHEN payment_status IN ('paid','partial') THEN amount ELSE 0 END) as total,
         SUM(CASE WHEN payment_status = 'pending' THEN amount ELSE 0 END) as pending_total
       FROM project_revenues
       WHERE project_id = ?
       AND strftime('%Y', revenue_date) = ? AND strftime('%m', revenue_date) = ?`
    ).bind(projectId, y, m).first() as any
    const monthRevenue = revenueMonth?.total || 0
    const monthPendingRevenue = revenueMonth?.pending_total || 0

    // ── Chi phí chung được phân bổ về dự án này (tháng/năm) ──────────
    // FIX: Chi phí có month=NULL là chi phí CẢ NĂM → chỉ tính khi query toàn năm
    //      Khi query theo tháng cụ thể chỉ tính chi phí có month = tháng đó
    const sharedAllocRow = await db.prepare(`
      SELECT COALESCE(SUM(sca.allocated_amount), 0) as shared_total,
             COUNT(DISTINCT sca.shared_cost_id) as shared_count
      FROM shared_cost_allocations sca
      JOIN shared_costs sc ON sc.id = sca.shared_cost_id
      WHERE sca.project_id = ? AND sc.status != 'deleted'
        AND sc.year = ? AND sc.month = ?
    `).bind(projectId, yInt, mInt).first() as any
    const sharedCostAllocated = sharedAllocRow?.shared_total || 0
    const sharedCostCount = sharedAllocRow?.shared_count || 0
    const totalCostsWithShared = totalCosts + sharedCostAllocated

    // FIX Bug3: Luôn tính profit kể cả khi chưa có doanh thu
    // null chỉ khi không có cả doanh thu lẫn chi phí
    const profit = (monthRevenue > 0 || totalCostsWithShared > 0) ? monthRevenue - totalCostsWithShared : null
    const profitMargin = monthRevenue > 0 && profit !== null ? parseFloat(((profit / monthRevenue) * 100).toFixed(1)) : null

    // Validation rules on profit
    if (profit !== null && profit <= 0) {
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
        pct: totalCostsWithShared > 0 ? parseFloat(((laborCost / totalCostsWithShared) * 100).toFixed(1)) : 0 },
      ...otherCostRows.map(r => ({
        type: costTypeNames[r.cost_type] || r.cost_type,
        cost_type: r.cost_type,
        amount: r.total_amount,
        is_auto: false,
        pct: totalCostsWithShared > 0 ? parseFloat(((r.total_amount / totalCostsWithShared) * 100).toFixed(1)) : 0
      })),
      ...(sharedCostAllocated > 0 ? [{
        type: 'Chi phí chung (phân bổ)', cost_type: 'shared',
        amount: sharedCostAllocated, is_auto: true, shared_count: sharedCostCount,
        pct: totalCostsWithShared > 0 ? parseFloat(((sharedCostAllocated / totalCostsWithShared) * 100).toFixed(1)) : 0
      }] : [])
    ]

    return c.json({
      project_id: projectId,
      project_code: proj.code,
      project_name: proj.name,
      month: mInt,
      year: yInt,
      period: `${y}-${m}`,
      revenue: {
        month_revenue: monthRevenue,           // đã thanh toán (paid + partial)
        pending_revenue: monthPendingRevenue,  // chờ thanh toán
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
        shared_cost_allocated: sharedCostAllocated,  // chi phí chung phân bổ
        shared_cost_count: sharedCostCount,
        total_costs: totalCostsWithShared,
        breakdown
      },
      profit: {
        profit,
        profit_margin: profitMargin
      },
      validation: {
        warnings: validation_warnings,
        has_warnings: validation_warnings.length > 0,
        profit_status: profit === null ? 'no_data' : (profit > 0 ? (profitMargin !== null && profitMargin < 10 ? 'warning' : 'ok') : 'error')
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
// Overtime x1.5: giờ tăng ca được quy đổi = overtime_hours × 1.5 (nặng hơn giờ thường)
// → effective_hours = regular_hours + overtime_hours × 1.5
// → cost_per_hour  = monthly_labor_cost / SUM(effective_hours toàn công ty)
// → project_labor  = proj_effective_hours × cost_per_hour
// Hệ số tăng ca: đọc từ system_settings, mặc định 1.5
// Lưu trữ trong DB để admin có thể cấu hình qua UI
async function getOvertimeFactor(db: any): Promise<number> {
  const row = await db.prepare(
    `SELECT value FROM system_settings WHERE key = 'overtime_factor'`
  ).first() as any
  if (row?.value) {
    const v = parseFloat(row.value)
    if (!isNaN(v) && v > 0) return v
  }
  return 1.5 // default
}

// ===================================================
// FISCAL YEAR HELPERS
// ===================================================
// Năm tài chính (NTC) bắt đầu từ ngày fiscal_year_start_month/fiscal_year_start_day
// Mặc định: 01/02 năm N → 31/01 năm N+1 (tháng bắt đầu = 2, ngày = 1)
// NTC YYYY = từ YYYY-02-01 đến (YYYY+1)-01-31
//
// Ví dụ: NTC 2026 = 2026-02-01 → 2027-01-31
//   - Tháng 2,3,...,12 thuộc lịch năm 2026
//   - Tháng 1 thuộc lịch năm 2027

interface FiscalYearSettings {
  start_month: number  // 1–12, mặc định 2
  start_day: number    // 1–28, mặc định 1
}

async function getFiscalYearSettings(db: any): Promise<FiscalYearSettings> {
  const rows = await db.prepare(
    `SELECT key, value FROM system_settings WHERE key IN ('fiscal_year_start_month','fiscal_year_start_day')`
  ).all()
  const cfg: Record<string, string> = {}
  for (const r of (rows.results as any[])) cfg[r.key] = r.value

  const startMonth = parseInt(cfg['fiscal_year_start_month'] || '2')
  const startDay   = parseInt(cfg['fiscal_year_start_day']   || '1')
  return {
    start_month: (startMonth >= 1 && startMonth <= 12) ? startMonth : 2,
    start_day:   (startDay   >= 1 && startDay   <= 28) ? startDay   : 1
  }
}

// Trả về {startDate, endDate} dạng 'YYYY-MM-DD' cho NTC fyYear
// Nếu start_month = 2, start_day = 1:
//   startDate = fyYear-02-01, endDate = (fyYear+1)-01-31
function getFiscalYearDateRange(fyYear: number, settings: FiscalYearSettings): { startDate: string; endDate: string } {
  const sm = settings.start_month
  const sd = settings.start_day

  // Tháng kết thúc = tháng trước tháng bắt đầu
  const endMonth = sm === 1 ? 12 : sm - 1
  const endYear  = sm === 1 ? fyYear : fyYear + 1

  // Ngày cuối tháng kết thúc
  const endDay = new Date(endYear, endMonth, 0).getDate()  // day=0 → last day of prev month

  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    startDate: `${fyYear}-${pad(sm)}-${pad(sd)}`,
    endDate:   `${endYear}-${pad(endMonth)}-${pad(endDay)}`
  }
}

// Trả về label hiển thị cho NTC
function getFiscalYearLabel(fyYear: number, settings: FiscalYearSettings): string {
  const { startDate, endDate } = getFiscalYearDateRange(fyYear, settings)
  if (settings.start_month === 1) {
    return `NTC ${fyYear} (01/01–31/12/${fyYear})`
  }
  return `NTC ${fyYear} (${startDate.slice(8)}/${startDate.slice(5,7)}/${fyYear}–${endDate.slice(8)}/${endDate.slice(5,7)}/${fyYear+1})`
}

// Trả về SQL WHERE condition thay thế cho strftime('%Y', col) = ?
// Dùng: colDateFilter(col, fyYear, settings) → "col >= 'YYYY-MM-DD' AND col <= 'YYYY-MM-DD'"
function fiscalYearDateFilter(col: string, fyYear: number, settings: FiscalYearSettings): string {
  const { startDate, endDate } = getFiscalYearDateRange(fyYear, settings)
  return `${col} >= '${startDate}' AND ${col} <= '${endDate}'`
}

// Map số tháng logic (2..12 = tháng trong năm bắt đầu, 1 = tháng trong năm tiếp)
// sang {calYear, calMonth} dựa vào NTC settings
// Với start_month=2: tháng logic 2→{fyYear,2}, 12→{fyYear,12}, 1→{fyYear+1,1}
// Với start_month=3: tháng logic 3→{fyYear,3}, ..., 2→{fyYear+1,2}
function fiscalMonthToCalendar(logicalMonth: number, fyYear: number, settings: FiscalYearSettings): { calYear: number; calMonth: number } {
  const sm = settings.start_month
  // Logical months: sm, sm+1, ..., 12, 1, 2, ..., sm-1
  // Months >= sm → same calendar year
  // Months < sm  → next calendar year
  if (logicalMonth >= sm) {
    return { calYear: fyYear, calMonth: logicalMonth }
  } else {
    return { calYear: fyYear + 1, calMonth: logicalMonth }
  }
}

// Build SQL month filter cho danh sách tháng logic trong NTC
// Returns SQL fragment: "(year_col = Y1 AND month_col = M1) OR (year_col = Y2 AND month_col = M2) ..."
// dùng cho timesheets: strftime('%Y')=calYear AND strftime('%m')=calMonth
function fiscalMonthsSQLFilter(logicalMonths: number[], fyYear: number, settings: FiscalYearSettings, dateCol: string): string {
  const conditions = logicalMonths.map(lm => {
    const { calYear, calMonth } = fiscalMonthToCalendar(lm, fyYear, settings)
    const y = String(calYear)
    const m = String(calMonth).padStart(2, '0')
    return `(strftime('%Y', ${dateCol}) = '${y}' AND strftime('%m', ${dateCol}) = '${m}')`
  })
  return conditions.length === 1 ? conditions[0] : `(${conditions.join(' OR ')})`
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: tính chi phí lương realtime phân bổ theo dự án
// Nếu có dateFrom/dateTo → lọc trong khoảng đó; không có → toàn bộ lịch sử
// Trả về Map<projectId, { labor_cost, labor_hours }>
// ─────────────────────────────────────────────────────────────────────────────
async function computeRealtimeLaborByProject(
  db: any,
  otFactor: number,
  dateFrom?: string,
  dateTo?: string
): Promise<Map<number, { labor_cost: number; labor_hours: number }>> {
  const result = new Map<number, { labor_cost: number; labor_hours: number }>()

  // 1. Lấy tất cả tháng có dữ liệu monthly_labor_costs trong phạm vi
  let mlcRows: any
  if (dateFrom && dateTo) {
    // Chuyển dateFrom/dateTo thành year-month để so sánh
    mlcRows = await db.prepare(`
      SELECT year, month, total_labor_cost FROM monthly_labor_costs
      WHERE (year * 100 + month) >= (CAST(strftime('%Y', ?) AS INTEGER) * 100 + CAST(strftime('%m', ?) AS INTEGER))
        AND (year * 100 + month) <= (CAST(strftime('%Y', ?) AS INTEGER) * 100 + CAST(strftime('%m', ?) AS INTEGER))
      ORDER BY year, month
    `).bind(dateFrom, dateFrom, dateTo, dateTo).all()
  } else {
    mlcRows = await db.prepare(`
      SELECT year, month, total_labor_cost FROM monthly_labor_costs
      ORDER BY year, month
    `).all()
  }

  const months: Array<{ year: number; month: number; pool: number }> =
    (mlcRows.results as any[]).map((r: any) => ({
      year: r.year, month: r.month, pool: r.total_labor_cost || 0
    }))

  if (months.length === 0) return result

  // 2. Với mỗi tháng có pool > 0, tính tổng giờ công ty và giờ từng dự án
  for (const { year: yInt, month: mInt, pool } of months) {
    if (pool <= 0) continue
    const y = String(yInt)
    const m = String(mInt).padStart(2, '0')

    // Tổng giờ quy đổi toàn công ty
    const compRow = await db.prepare(`
      SELECT SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as comp_eff
      FROM timesheets
      WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
    `).bind(otFactor, y, m).first() as any
    const compEff = compRow?.comp_eff || 0
    if (compEff <= 0) continue

    const cph = pool / compEff  // cost per effective hour tháng này

    // Giờ quy đổi từng dự án tháng này
    const projRows = await db.prepare(`
      SELECT project_id,
        SUM(regular_hours + IFNULL(overtime_hours,0)) as raw_hours,
        SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as eff_hours
      FROM timesheets
      WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
      GROUP BY project_id
    `).bind(otFactor, y, m).all()

    for (const pr of (projRows.results as any[])) {
      const pid = pr.project_id
      const laborCost = Math.round((pr.eff_hours || 0) * cph)
      const rawHours  = pr.raw_hours || 0
      const prev = result.get(pid) || { labor_cost: 0, labor_hours: 0 }
      result.set(pid, {
        labor_cost:  prev.labor_cost  + laborCost,
        labor_hours: prev.labor_hours + rawHours,
      })
    }
  }

  return result
}

async function computeMonthLaborCost(db: any, mInt: number, yInt: number, otFactor?: number) {
  const OVERTIME_FACTOR = otFactor !== undefined ? otFactor : await getOvertimeFactor(db)
  const m = String(mInt).padStart(2, '0')
  const y = String(yInt)
  const manualEntry = await db.prepare(
    `SELECT total_labor_cost, notes FROM monthly_labor_costs WHERE month = ? AND year = ?`
  ).bind(mInt, yInt).first() as any
  const salaryPool = await db.prepare(
    `SELECT SUM(salary_monthly) as total FROM users WHERE is_active = 1 AND role != 'system_admin'`
  ).first() as any
  // Tổng giờ quy đổi toàn công ty tháng đó (có tính hệ số OT x1.5)
  const totalHoursRow = await db.prepare(
    `SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as raw_hours,
            SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as effective_hours
     FROM timesheets
     WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
  ).bind(OVERTIME_FACTOR, y, m).first() as any
  const totalHrs        = totalHoursRow?.raw_hours       || 0  // giờ thực (để hiển thị)
  const totalEffectHrs  = totalHoursRow?.effective_hours || 0  // giờ quy đổi (để tính chi phí)
  // Chi phí lương CHỈ dùng khi admin đã nhập thủ công (monthly_labor_costs)
  const laborCostSource = manualEntry ? manualEntry.total_labor_cost : 0
  // cost_per_hour tính trên effective_hours (đã quy đổi OT x1.5)
  const costPerHour = (totalEffectHrs > 0 && laborCostSource > 0) ? laborCostSource / totalEffectHrs : 0
  return {
    laborCostSource, totalHrs, totalEffectHrs, costPerHour,
    isManual: !!manualEntry, notes: manualEntry?.notes || '',
    salaryPoolRef: salaryPool?.total || 0
  }
}

// ===================================================
// SYSTEM CONFIG APIs — Cấu hình hệ thống (admin only)
// ===================================================

// GET /api/system/config — Đọc tất cả cấu hình
app.get('/api/system/config', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const rows = await db.prepare(`SELECT key, value, updated_at FROM system_settings`).all()
    const config: Record<string, any> = {}
    for (const row of (rows.results as any[])) {
      config[row.key] = row.value
    }
    const fySettings = await getFiscalYearSettings(db)
    const currentFyYear = new Date().getFullYear()
    const fyRange = getFiscalYearDateRange(currentFyYear, fySettings)
    // Trả về cấu hình với giá trị mặc định nếu chưa set
    return c.json({
      overtime_factor: parseFloat(config['overtime_factor'] || '1.5'),
      fiscal_year_start_month: fySettings.start_month,
      fiscal_year_start_day: fySettings.start_day,
      fiscal_year_example: {
        year: currentFyYear,
        start: fyRange.startDate,
        end: fyRange.endDate,
        label: getFiscalYearLabel(currentFyYear, fySettings)
      },
      seed_data_initialized: config['seed_data_initialized'] === '1',
      raw: config
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// PUT /api/system/config — Cập nhật cấu hình
app.put('/api/system/config', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const body = await c.req.json() as any

    const updated: string[] = []

    // overtime_factor: hệ số quy đổi giờ tăng ca (ví dụ: 1.5 = 1h OT = 1.5h thường)
    if (body.overtime_factor !== undefined) {
      const v = parseFloat(body.overtime_factor)
      if (isNaN(v) || v <= 0 || v > 10) {
        return c.json({ error: 'overtime_factor phải là số dương, tối đa 10' }, 400)
      }
      await db.prepare(
        `INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('overtime_factor', ?, CURRENT_TIMESTAMP)`
      ).bind(String(v)).run()
      updated.push(`overtime_factor = ${v}`)
    }

    // fiscal_year_start_month: tháng bắt đầu năm tài chính (1-12, mặc định 2)
    if (body.fiscal_year_start_month !== undefined) {
      const v = parseInt(body.fiscal_year_start_month)
      if (isNaN(v) || v < 1 || v > 12) {
        return c.json({ error: 'fiscal_year_start_month phải từ 1 đến 12' }, 400)
      }
      await db.prepare(
        `INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('fiscal_year_start_month', ?, CURRENT_TIMESTAMP)`
      ).bind(String(v)).run()
      updated.push(`fiscal_year_start_month = ${v}`)
    }

    // fiscal_year_start_day: ngày bắt đầu năm tài chính (1-28, mặc định 1)
    if (body.fiscal_year_start_day !== undefined) {
      const v = parseInt(body.fiscal_year_start_day)
      if (isNaN(v) || v < 1 || v > 28) {
        return c.json({ error: 'fiscal_year_start_day phải từ 1 đến 28' }, 400)
      }
      await db.prepare(
        `INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('fiscal_year_start_day', ?, CURRENT_TIMESTAMP)`
      ).bind(String(v)).run()
      updated.push(`fiscal_year_start_day = ${v}`)
    }

    if (updated.length === 0) {
      return c.json({ error: 'Không có cấu hình nào được cập nhật' }, 400)
    }

    // Đọc lại sau khi update
    const newFactor = await getOvertimeFactor(db)
    const newFySettings = await getFiscalYearSettings(db)
    const fyYear = new Date().getFullYear()
    const fyRange = getFiscalYearDateRange(fyYear, newFySettings)
    return c.json({
      success: true,
      message: `Đã cập nhật: ${updated.join(', ')}`,
      current_config: {
        overtime_factor: newFactor,
        fiscal_year_start_month: newFySettings.start_month,
        fiscal_year_start_day: newFySettings.start_day,
        fiscal_year_example: {
          year: fyYear,
          start: fyRange.startDate,
          end: fyRange.endDate,
          label: getFiscalYearLabel(fyYear, newFySettings)
        }
      }
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ===================================================
// SHARED COSTS APIs — Chi phí chung phân bổ nhiều dự án
// ===================================================

// Helper: tính phân bổ chi phí chung cho danh sách dự án
async function computeAllocations(db: any, sharedCostId: number, totalAmount: number, basis: string, projectIds: number[], manualPcts?: Record<number, number>) {
  if (projectIds.length === 0) return []

  let pcts: Record<number, number> = {}

  if (basis === 'equal') {
    const each = 100 / projectIds.length
    projectIds.forEach(pid => { pcts[pid] = each })

  } else if (basis === 'contract_value') {
    // Lấy contract_value của từng dự án
    const inClause = projectIds.join(',')
    const rows = await db.prepare(
      `SELECT id, COALESCE(contract_value, 0) as cv FROM projects WHERE id IN (${inClause})`
    ).all()
    const totalCV = (rows.results as any[]).reduce((s: number, r: any) => s + (r.cv || 0), 0)
    if (totalCV > 0) {
      ;(rows.results as any[]).forEach((r: any) => { pcts[r.id] = (r.cv / totalCV) * 100 })
    } else {
      // Fallback to equal if no contract values
      const each = 100 / projectIds.length
      projectIds.forEach(pid => { pcts[pid] = each })
    }

  } else if (basis === 'manual') {
    // manualPcts: { projectId: percentage }
    if (manualPcts) pcts = { ...manualPcts }
    else {
      const each = 100 / projectIds.length
      projectIds.forEach(pid => { pcts[pid] = each })
    }
  }

  // Xây dựng allocation records
  return projectIds.map(pid => ({
    shared_cost_id: sharedCostId,
    project_id: pid,
    allocation_pct: parseFloat((pcts[pid] || 0).toFixed(4)),
    allocated_amount: Math.round(totalAmount * (pcts[pid] || 0) / 100)
  }))
}

// GET /api/shared-costs — Lấy danh sách chi phí chung
app.get('/api/shared-costs', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { year, month } = c.req.query()

    let where = `WHERE sc.status != 'deleted'`
    const params: any[] = []
    if (year) { where += ` AND sc.year = ?`; params.push(parseInt(year)) }
    if (month) { where += ` AND sc.month = ?`; params.push(parseInt(month)) }

    const rows = await db.prepare(`
      SELECT sc.*,
        u.full_name as created_by_name,
        COUNT(DISTINCT sca.project_id) as project_count,
        SUM(sca.allocated_amount) as total_allocated
      FROM shared_costs sc
      LEFT JOIN users u ON sc.created_by = u.id
      LEFT JOIN shared_cost_allocations sca ON sca.shared_cost_id = sc.id
      ${where}
      GROUP BY sc.id
      ORDER BY sc.cost_date DESC, sc.created_at DESC
    `).bind(...params).all()

    // Lấy thêm chi tiết phân bổ từng dự án
    const list = rows.results as any[]
    for (const sc of list) {
      const allocs = await db.prepare(`
        SELECT sca.*, p.code as project_code, p.name as project_name, p.contract_value
        FROM shared_cost_allocations sca
        JOIN projects p ON p.id = sca.project_id
        WHERE sca.shared_cost_id = ?
        ORDER BY sca.allocated_amount DESC
      `).bind(sc.id).all()
      sc.allocations = allocs.results
    }

    return c.json(list)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/shared-costs — Tạo chi phí chung mới + tự động phân bổ
app.post('/api/shared-costs', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const body = await c.req.json() as any

    const { description, cost_type, amount, currency, cost_date, invoice_number, vendor, notes,
            allocation_basis, year, month, project_ids, manual_pcts } = body

    if (!description || !amount || !project_ids || project_ids.length === 0) {
      return c.json({ error: 'Thiếu thông tin: description, amount, project_ids là bắt buộc' }, 400)
    }
    if (!['contract_value', 'equal', 'manual'].includes(allocation_basis || 'contract_value')) {
      return c.json({ error: 'allocation_basis phải là: contract_value | equal | manual' }, 400)
    }

    const basis = allocation_basis || 'contract_value'
    const yInt = year ? parseInt(year) : null
    const mInt = month ? parseInt(month) : null

    // Insert shared cost
    const ins = await db.prepare(`
      INSERT INTO shared_costs (description, cost_type, amount, currency, cost_date, invoice_number, vendor, notes, allocation_basis, year, month, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(description, cost_type || 'other', parseFloat(amount), currency || 'VND',
        cost_date || null, invoice_number || null, vendor || null, notes || null,
        basis, yInt, mInt, user.id).run()

    const scId = ins.meta.last_row_id as number

    // Tính và insert allocations
    const allocations = await computeAllocations(db, scId, parseFloat(amount), basis, project_ids.map(Number), manual_pcts)
    for (const alloc of allocations) {
      await db.prepare(`
        INSERT OR REPLACE INTO shared_cost_allocations (shared_cost_id, project_id, allocation_pct, allocated_amount)
        VALUES (?, ?, ?, ?)
      `).bind(alloc.shared_cost_id, alloc.project_id, alloc.allocation_pct, alloc.allocated_amount).run()
    }

    return c.json({ success: true, id: scId, allocations_created: allocations.length }, 201)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// PUT /api/shared-costs/:id — Cập nhật chi phí chung + tái phân bổ
app.put('/api/shared-costs/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    const body = await c.req.json() as any

    const existing = await db.prepare(`SELECT * FROM shared_costs WHERE id = ?`).bind(id).first() as any
    if (!existing) return c.json({ error: 'Không tìm thấy chi phí chung' }, 404)

    const { description, cost_type, amount, currency, cost_date, invoice_number, vendor, notes,
            allocation_basis, year, month, project_ids, manual_pcts } = body

    const newAmount = amount !== undefined ? parseFloat(amount) : existing.amount
    const newBasis = allocation_basis || existing.allocation_basis

    const fields: string[] = []
    const vals: any[] = []
    if (description !== undefined) { fields.push('description = ?'); vals.push(description) }
    if (cost_type !== undefined) { fields.push('cost_type = ?'); vals.push(cost_type) }
    if (amount !== undefined) { fields.push('amount = ?'); vals.push(newAmount) }
    if (currency !== undefined) { fields.push('currency = ?'); vals.push(currency) }
    if (cost_date !== undefined) { fields.push('cost_date = ?'); vals.push(cost_date) }
    if (invoice_number !== undefined) { fields.push('invoice_number = ?'); vals.push(invoice_number) }
    if (vendor !== undefined) { fields.push('vendor = ?'); vals.push(vendor) }
    if (notes !== undefined) { fields.push('notes = ?'); vals.push(notes) }
    if (allocation_basis !== undefined) { fields.push('allocation_basis = ?'); vals.push(newBasis) }
    if (year !== undefined) { fields.push('year = ?'); vals.push(parseInt(year)) }
    if (month !== undefined) { fields.push('month = ?'); vals.push(parseInt(month)) }
    fields.push('updated_at = CURRENT_TIMESTAMP')
    vals.push(id)

    if (fields.length > 1) {
      await db.prepare(`UPDATE shared_costs SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run()
    }

    // Tái phân bổ nếu có thay đổi amount, basis hoặc project_ids
    if (project_ids || amount !== undefined || allocation_basis !== undefined) {
      // Lấy danh sách project_ids hiện tại nếu không truyền mới
      let pIds: number[]
      if (project_ids) {
        pIds = project_ids.map(Number)
      } else {
        const curAllocs = await db.prepare(`SELECT project_id FROM shared_cost_allocations WHERE shared_cost_id = ?`).bind(id).all()
        pIds = (curAllocs.results as any[]).map((r: any) => r.project_id)
      }

      // Xóa allocation cũ và tạo mới
      await db.prepare(`DELETE FROM shared_cost_allocations WHERE shared_cost_id = ?`).bind(id).run()
      const allocations = await computeAllocations(db, id, newAmount, newBasis, pIds, manual_pcts)
      for (const alloc of allocations) {
        await db.prepare(`
          INSERT INTO shared_cost_allocations (shared_cost_id, project_id, allocation_pct, allocated_amount)
          VALUES (?, ?, ?, ?)
        `).bind(alloc.shared_cost_id, alloc.project_id, alloc.allocation_pct, alloc.allocated_amount).run()
      }
    }

    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// DELETE /api/shared-costs/:id
app.delete('/api/shared-costs/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))

    // Kiểm tra shared_cost có tồn tại không
    const sc = await db.prepare(`SELECT * FROM shared_costs WHERE id = ?`).bind(id).first() as any
    if (!sc) return c.json({ error: 'Không tìm thấy chi phí chung' }, 404)

    // Nếu là khấu hao tài sản (cost_type = 'depreciation') → rollback schedule
    if (sc.cost_type === 'depreciation') {
      // Tìm schedule rows theo shared_cost_id (ưu tiên) hoặc year+month (fallback)
      // Fallback cần thiết khi shared_cost_id bị lưu sai (NULL/string) do lỗi dữ liệu cũ
      let scheduleRows = await db.prepare(`
        SELECT ads.*, a.id AS asset_db_id
        FROM asset_depreciation_schedule ads
        JOIN assets a ON a.id = ads.asset_id
        WHERE ads.shared_cost_id = ? AND ads.is_allocated = 1
      `).bind(id).all()

      let rows = scheduleRows.results as any[]

      // Fallback: nếu không tìm được qua shared_cost_id, dùng year+month từ shared_cost record
      if (rows.length === 0 && sc.month != null) {
        scheduleRows = await db.prepare(`
          SELECT ads.*, a.id AS asset_db_id
          FROM asset_depreciation_schedule ads
          JOIN assets a ON a.id = ads.asset_id
          WHERE ads.year = ? AND ads.month = ? AND ads.is_allocated = 1
        `).bind(sc.year, sc.month).all()
        rows = scheduleRows.results as any[]
      }

      // Reset trạng thái phân bổ trong lịch khấu hao
      if (rows.length > 0) {
        // Reset theo shared_cost_id nếu có, còn không thì reset theo year+month
        const hasLinked = rows.some((r: any) => r.shared_cost_id === id)
        if (hasLinked) {
          await db.prepare(`
            UPDATE asset_depreciation_schedule
            SET is_allocated = 0, shared_cost_id = NULL, allocated_at = NULL
            WHERE shared_cost_id = ?
          `).bind(id).run()
        } else {
          // Fallback: reset theo year+month (dữ liệu orphan - shared_cost_id không khớp)
          await db.prepare(`
            UPDATE asset_depreciation_schedule
            SET is_allocated = 0, shared_cost_id = NULL, allocated_at = NULL
            WHERE year = ? AND month = ? AND is_allocated = 1
          `).bind(sc.year, sc.month).run()
        }

        // Rollback accumulated_depreciation và net_book_value trên từng tài sản
        for (const row of rows) {
          await db.prepare(`
            UPDATE assets SET
              accumulated_depreciation = MAX(0, accumulated_depreciation - ?),
              net_book_value = MIN(purchase_price, net_book_value + ?)
            WHERE id = ?
          `).bind(row.depreciation_amount, row.depreciation_amount, row.asset_id).run()
        }
      }
    }

    // Xóa allocations và shared_cost
    await db.prepare(`DELETE FROM shared_cost_allocations WHERE shared_cost_id = ?`).bind(id).run()
    await db.prepare(`DELETE FROM shared_costs WHERE id = ?`).bind(id).run()

    return c.json({
      success: true,
      rolled_back: sc.cost_type === 'depreciation',
      message: sc.cost_type === 'depreciation'
        ? 'Đã xóa chi phí chung và hoàn tác trạng thái khấu hao về chưa phân bổ'
        : 'Đã xóa chi phí chung'
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/shared-costs/summary — Tổng hợp chi phí chung theo năm
app.get('/api/shared-costs/summary', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { year } = c.req.query()
    const yInt = year ? parseInt(year) : new Date().getFullYear()

    // Tổng chi phí chung theo năm
    const totalRow = await db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total_shared_cost,
             COUNT(*) as count
      FROM shared_costs WHERE year = ? AND status != 'deleted'
    `).bind(yInt).first() as any

    // Phân bổ theo từng dự án
    const byProject = await db.prepare(`
      SELECT p.id, p.code, p.name,
        COALESCE(SUM(sca.allocated_amount), 0) as allocated_cost,
        COUNT(DISTINCT sca.shared_cost_id) as shared_cost_count
      FROM projects p
      JOIN shared_cost_allocations sca ON sca.project_id = p.id
      JOIN shared_costs sc ON sc.id = sca.shared_cost_id AND sc.year = ? AND sc.status != 'deleted'
      WHERE p.status != 'cancelled'
      GROUP BY p.id ORDER BY allocated_cost DESC
    `).bind(yInt).all()

    return c.json({
      year: yInt,
      total_shared_cost: totalRow?.total_shared_cost || 0,
      shared_cost_count: totalRow?.count || 0,
      by_project: byProject.results
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/projects/:id/shared-cost-allocations — chi phí chung được phân bổ về dự án
app.get('/api/projects/:id/shared-cost-allocations', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const projectId = parseInt(c.req.param('id'))
    const { year, month } = c.req.query()

    let where = `WHERE sca.project_id = ? AND sc.status != 'deleted'`
    const params: any[] = [projectId]
    if (year) { where += ` AND sc.year = ?`; params.push(parseInt(year)) }
    if (month) { where += ` AND sc.month = ?`; params.push(parseInt(month)) }

    const rows = await db.prepare(`
      SELECT sca.*, sc.description, sc.cost_type, sc.amount as total_amount,
             sc.cost_date, sc.vendor, sc.allocation_basis, sc.year, sc.month
      FROM shared_cost_allocations sca
      JOIN shared_costs sc ON sc.id = sca.shared_cost_id
      ${where}
      ORDER BY sc.cost_date DESC
    `).bind(...params).all()

    const list = rows.results as any[]
    const totalAllocated = list.reduce((s: number, r: any) => s + (r.allocated_amount || 0), 0)

    return c.json({
      project_id: projectId,
      year: year ? parseInt(year) : null,
      month: month ? parseInt(month) : null,
      total_allocated: totalAllocated,
      items: list
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/data-audit/consistency-check
// Full diagnostic: duplicates, labor cost > contract, missing records
app.get('/api/data-audit/consistency-check', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const OVERTIME_FACTOR = await getOvertimeFactor(db)
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

    const { laborCostSource, totalHrs, costPerHour } = await computeMonthLaborCost(db, mInt, yInt, OVERTIME_FACTOR)

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

      // Chi phí chung được phân bổ về dự án này tháng đó
      // FIX: Chi phí có month=NULL là chi phí CẢ NĂM → không tính vào tháng cụ thể
      const sharedRow2 = await db.prepare(
        `SELECT COALESCE(SUM(sca.allocated_amount), 0) as total
         FROM shared_cost_allocations sca
         JOIN shared_costs sc ON sc.id = sca.shared_cost_id
         WHERE sca.project_id = ? AND sc.status != 'deleted'
           AND sc.year = ? AND sc.month = ?`
      ).bind(proj.id, yInt, mInt).first() as any
      const sharedCost = sharedRow2?.total || 0

      const totalCosts = laborCost + otherCosts + sharedCost

      // Revenue for the month (chỉ paid + partial)
      const revRow = await db.prepare(
        `SELECT
           SUM(CASE WHEN payment_status IN ('paid','partial') THEN amount ELSE 0 END) as total,
           SUM(CASE WHEN payment_status = 'pending' THEN amount ELSE 0 END) as pending_total
         FROM project_revenues
         WHERE project_id = ? AND strftime('%Y', revenue_date) = ? AND strftime('%m', revenue_date) = ?`
      ).bind(proj.id, y, m).first() as any
      const revenue = revRow?.total || 0
      const pendingRev = revRow?.pending_total || 0

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
    const OVERTIME_FACTOR = await getOvertimeFactor(db)
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
    // Overtime x1.5: costPerHour = budget/comp_eff_hours; project_cost = proj_eff_hours × costPerHour
    if (actions.includes('fix_labor')) {
      const { laborCostSource, totalEffectHrs, costPerHour } = await computeMonthLaborCost(db, mInt, yInt, OVERTIME_FACTOR)
      const m = String(mInt).padStart(2, '0')
      const y = String(yInt)
      const projects = await db.prepare(`SELECT id, contract_value FROM projects WHERE status != 'cancelled'`).all()
      let fixed = 0
      for (const proj of projects.results as any[]) {
        // Lấy cả raw hours (hiển thị) và effective hours (tính chi phí, OT x1.5)
        const projHrsRow = await db.prepare(
          `SELECT SUM(regular_hours + IFNULL(overtime_hours,0))     as raw_hours,
                  SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as eff_hours
           FROM timesheets
           WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
        ).bind(OVERTIME_FACTOR, proj.id, y, m).first() as any
        const projEffHrs = projHrsRow?.eff_hours || 0
        const projRawHrs = projHrsRow?.raw_hours || 0
        // Chi phí lương = proj_eff_hours × costPerHour (budget phân bổ theo giờ quy đổi)
        const correctLaborCost = Math.round(projEffHrs * costPerHour)
        const contractVal = proj.contract_value || 0
        // Cap at contract value if exceeded
        const cappedLaborCost = contractVal > 0 && correctLaborCost > contractVal ? contractVal : correctLaborCost

        // Upsert into project_labor_costs (lưu raw_hours để hiển thị, eff calculation done above)
        const existing = await db.prepare(
          `SELECT id FROM project_labor_costs WHERE project_id = ? AND month = ? AND year = ?`
        ).bind(proj.id, mInt, yInt).first() as any

        if (existing) {
          await db.prepare(
            `UPDATE project_labor_costs SET total_labor_cost = ?, total_hours = ?, cost_per_hour = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).bind(cappedLaborCost, projRawHrs, Math.round(costPerHour), existing.id).run()
        } else if (projRawHrs > 0) {
          await db.prepare(
            `INSERT INTO project_labor_costs (project_id, month, year, total_labor_cost, total_hours, cost_per_hour)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(proj.id, mInt, yInt, cappedLaborCost, projRawHrs, Math.round(costPerHour)).run()
          results.rows_created++
        }
        fixed++
      }
      results.rows_fixed += fixed
      results.actions_performed.push(`fix_labor: đã sync ${fixed} dự án với chi phí lương đúng (OT x${OVERTIME_FACTOR}) cho tháng ${mInt}/${yInt}`)
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
    const { asset_code, name, category, brand, model, serial_number, specifications,
      purchase_date, purchase_price, current_value, warranty_expiry, status,
      location, department, assigned_to, notes,
      depreciation_years, depreciation_start_date } = data

    if (!asset_code || !name || !category) return c.json({ error: 'Missing required fields' }, 400)

    const depYears = depreciation_years ? parseInt(depreciation_years) : 0
    const depStart = depreciation_start_date || purchase_date || null
    const monthlyDepr = (depYears > 0 && purchase_price > 0)
      ? parseFloat(purchase_price) / (depYears * 12) : 0

    const result = await db.prepare(
      `INSERT INTO assets (asset_code, name, category, brand, model, serial_number, specifications,
        purchase_date, purchase_price, current_value, warranty_expiry, status, location, department,
        assigned_to, notes, depreciation_years, depreciation_start_date, monthly_depreciation,
        depreciation_status, net_book_value, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      asset_code, name, category, brand || null, model || null, serial_number || null,
      specifications || null, purchase_date || null, purchase_price || 0, current_value || 0,
      warranty_expiry || null, status || 'active', location || null, department || null,
      assigned_to || null, notes || null,
      depYears, depStart, monthlyDepr,
      depYears > 0 ? 'active' : 'none',
      purchase_price || 0,
      user.id
    ).run()

    const newId = result.meta.last_row_id as number

    // Tự động tạo lịch khấu hao nếu có depreciation_years
    if (depYears > 0 && purchase_price > 0 && depStart) {
      await generateDepreciationSchedule(db, newId, parseFloat(purchase_price), depYears, depStart)
    }

    return c.json({ success: true, id: newId }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.put('/api/assets/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    const data = await c.req.json()
    const fields = ['name', 'category', 'brand', 'model', 'serial_number', 'specifications',
      'purchase_date', 'purchase_price', 'current_value', 'warranty_expiry',
      'status', 'location', 'department', 'assigned_to', 'notes',
      'depreciation_years', 'depreciation_start_date', 'depreciation_status']
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
// ASSET DEPRECIATION ROUTES (Khấu hao tài sản)
// ===================================================

// Helper: Tính monthly_depreciation và sinh lịch khấu hao
async function generateDepreciationSchedule(db: any, assetId: number, purchasePrice: number, depreciationYears: number, startDate: string) {
  if (!depreciationYears || depreciationYears <= 0 || !purchasePrice || purchasePrice <= 0) return
  const monthlyAmount = purchasePrice / (depreciationYears * 12)
  const totalMonths = depreciationYears * 12
  const start = new Date(startDate)
  let accumulated = 0

  // Xóa lịch cũ chưa phân bổ
  await db.prepare(`DELETE FROM asset_depreciation_schedule WHERE asset_id = ? AND is_allocated = 0`).bind(assetId).run()

  for (let i = 0; i < totalMonths; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    const yr = d.getFullYear()
    const mo = d.getMonth() + 1
    accumulated += monthlyAmount
    const netVal = Math.max(0, purchasePrice - accumulated)
    await db.prepare(`
      INSERT OR IGNORE INTO asset_depreciation_schedule
        (asset_id, year, month, depreciation_amount, accumulated_amount, net_book_value)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(assetId, yr, mo, monthlyAmount, accumulated, netVal).run()
  }

  // Cập nhật trạng thái asset
  await db.prepare(`
    UPDATE assets SET
      monthly_depreciation = ?,
      depreciation_status = 'active',
      net_book_value = purchase_price,
      accumulated_depreciation = 0
    WHERE id = ?
  `).bind(monthlyAmount, assetId).run()
}

// GET /api/assets/:id/depreciation — Lịch khấu hao của 1 tài sản
app.get('/api/assets/:id/depreciation', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    const { year } = c.req.query()

    const asset = await db.prepare(
      `SELECT * FROM assets WHERE id = ?`
    ).bind(id).first()
    if (!asset) return c.json({ error: 'Asset not found' }, 404)

    let q = `SELECT * FROM asset_depreciation_schedule WHERE asset_id = ?`
    const params: any[] = [id]
    if (year) { q += ` AND year = ?`; params.push(parseInt(year)) }
    q += ` ORDER BY year ASC, month ASC`

    const schedule = await db.prepare(q).bind(...params).all()
    return c.json({ asset, schedule: schedule.results })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/assets/:id/depreciation/setup — Cài đặt/cập nhật khấu hao cho tài sản
app.post('/api/assets/:id/depreciation/setup', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const id = parseInt(c.req.param('id'))
    const { depreciation_years, depreciation_start_date } = await c.req.json()

    if (![3, 5].includes(parseInt(depreciation_years))) {
      return c.json({ error: 'depreciation_years phải là 3 hoặc 5' }, 400)
    }

    const asset = await db.prepare(`SELECT * FROM assets WHERE id = ?`).bind(id).first() as any
    if (!asset) return c.json({ error: 'Asset not found' }, 404)
    if (!asset.purchase_price || asset.purchase_price <= 0) {
      return c.json({ error: 'Tài sản chưa có giá mua. Vui lòng cập nhật giá mua trước.' }, 400)
    }

    const startDate = depreciation_start_date || asset.purchase_date
    if (!startDate) return c.json({ error: 'Cần cung cấp ngày bắt đầu khấu hao' }, 400)

    const yrs = parseInt(depreciation_years)
    // Cập nhật fields trên asset
    await db.prepare(`
      UPDATE assets SET
        depreciation_years = ?,
        depreciation_start_date = ?,
        depreciation_status = 'active'
      WHERE id = ?
    `).bind(yrs, startDate, id).run()

    await generateDepreciationSchedule(db, id, asset.purchase_price, yrs, startDate)

    return c.json({ success: true, message: `Đã tạo lịch khấu hao ${yrs} năm (${yrs * 12} tháng)` })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/depreciation/summary — Tổng hợp khấu hao tất cả tài sản theo tháng/năm
app.get('/api/depreciation/summary', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { year, month } = c.req.query()
    const yr = parseInt(year || new Date().getFullYear().toString())
    const mo = month ? parseInt(month) : null

    // Lấy tổng khấu hao từng tháng trong năm (nếu lọc tháng thì chỉ lấy tháng đó)
    let monthlySummary: any
    if (mo) {
      monthlySummary = await db.prepare(`
        SELECT
          ads.year, ads.month,
          COUNT(DISTINCT ads.asset_id) AS asset_count,
          SUM(ads.depreciation_amount) AS total_depreciation,
          SUM(CASE WHEN ads.is_allocated = 1 THEN ads.depreciation_amount ELSE 0 END) AS allocated_amount,
          SUM(CASE WHEN ads.is_allocated = 0 THEN ads.depreciation_amount ELSE 0 END) AS pending_allocation
        FROM asset_depreciation_schedule ads
        JOIN assets a ON a.id = ads.asset_id
        WHERE ads.year = ? AND ads.month = ? AND a.depreciation_status = 'active' AND a.status != 'retired'
        GROUP BY ads.year, ads.month
        ORDER BY ads.month ASC
      `).bind(yr, mo).all()
    } else {
      monthlySummary = await db.prepare(`
        SELECT
          ads.year, ads.month,
          COUNT(DISTINCT ads.asset_id) AS asset_count,
          SUM(ads.depreciation_amount) AS total_depreciation,
          SUM(CASE WHEN ads.is_allocated = 1 THEN ads.depreciation_amount ELSE 0 END) AS allocated_amount,
          SUM(CASE WHEN ads.is_allocated = 0 THEN ads.depreciation_amount ELSE 0 END) AS pending_allocation
        FROM asset_depreciation_schedule ads
        JOIN assets a ON a.id = ads.asset_id
        WHERE ads.year = ? AND a.depreciation_status = 'active' AND a.status != 'retired'
        GROUP BY ads.year, ads.month
        ORDER BY ads.month ASC
      `).bind(yr).all()
    }

    // Lấy danh sách tài sản đang khấu hao
    const activeAssets = await db.prepare(`
      SELECT
        a.id, a.asset_code, a.name, a.category,
        a.purchase_price, a.purchase_date, a.depreciation_years,
        a.monthly_depreciation, a.depreciation_start_date, a.depreciation_status,
        a.accumulated_depreciation, a.net_book_value
      FROM assets a
      WHERE a.depreciation_status = 'active' AND a.status != 'retired'
      ORDER BY a.asset_code ASC
    `).all()

    // Chi tiết từng tài sản theo tháng (nếu lọc theo tháng cụ thể)
    let monthDetail: any[] = []
    if (mo) {
      const detail = await db.prepare(`
        SELECT
          ads.*,
          a.asset_code, a.name AS asset_name, a.category,
          a.purchase_price, a.depreciation_years
        FROM asset_depreciation_schedule ads
        JOIN assets a ON a.id = ads.asset_id
        WHERE ads.year = ? AND ads.month = ? AND a.depreciation_status = 'active' AND a.status != 'retired'
        ORDER BY a.asset_code ASC
      `).bind(yr, mo).all()
      monthDetail = detail.results as any[]
    }

    // Tổng giá trị tài sản & khấu hao lũy kế
    const totalStats = await db.prepare(`
      SELECT
        COUNT(*) AS total_assets,
        SUM(purchase_price) AS total_purchase_value,
        SUM(monthly_depreciation) AS total_monthly_depreciation,
        SUM(accumulated_depreciation) AS total_accumulated,
        SUM(net_book_value) AS total_net_value
      FROM assets
      WHERE depreciation_status = 'active' AND status != 'retired'
    `).first()

    return c.json({
      year: yr,
      month: mo,
      total_stats: totalStats,
      monthly_summary: monthlySummary.results,
      active_assets: activeAssets.results,
      month_detail: monthDetail
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/depreciation/allocation-preview — Xem trước dự án sẽ được phân bổ cho tháng/năm
app.get('/api/depreciation/allocation-preview', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { year, month } = c.req.query()
    if (!year || !month) return c.json({ error: 'Cần cung cấp year và month' }, 400)

    const yr = parseInt(year)
    const mo = parseInt(month)
    const lastDayOfMonth = new Date(yr, mo, 0).getDate()
    const monthEndDate = `${yr}-${String(mo).padStart(2,'0')}-${String(lastDayOfMonth).padStart(2,'0')}`

    // Tổng khấu hao tháng này
    const totalRow = await db.prepare(`
      SELECT SUM(ads.depreciation_amount) AS total, COUNT(DISTINCT ads.asset_id) AS asset_count
      FROM asset_depreciation_schedule ads
      JOIN assets a ON a.id = ads.asset_id
      WHERE ads.year = ? AND ads.month = ?
        AND a.depreciation_status = 'active' AND a.status != 'retired'
    `).bind(yr, mo).first() as any

    const total = totalRow?.total || 0
    const assetCount = totalRow?.asset_count || 0

    // Dự án đã bắt đầu (active + start_date <= cuối tháng)
    const eligibleProjects = await db.prepare(`
      SELECT id, code, name, start_date, status
      FROM projects
      WHERE status = 'active'
        AND start_date IS NOT NULL
        AND start_date <= ?
      ORDER BY start_date ASC, code ASC
    `).bind(monthEndDate).all()
    const eligible = eligibleProjects.results as any[]

    // Dự án active nhưng chưa bắt đầu (start_date > cuối tháng)
    const notYetProjects = await db.prepare(`
      SELECT id, code, name, start_date, status
      FROM projects
      WHERE status = 'active'
        AND (start_date IS NULL OR start_date > ?)
      ORDER BY code ASC
    `).bind(monthEndDate).all()
    const notYet = notYetProjects.results as any[]

    const perProject = eligible.length > 0 ? total / eligible.length : 0

    return c.json({
      year: yr, month: mo,
      month_end_date: monthEndDate,
      total_depreciation: total,
      asset_count: assetCount,
      eligible_projects: eligible.map((p: any) => ({
        id: p.id, code: p.code, name: p.name, start_date: p.start_date,
        amount: perProject
      })),
      excluded_projects: notYet.map((p: any) => ({
        id: p.id, code: p.code, name: p.name, start_date: p.start_date,
        reason: p.start_date ? `Bắt đầu ${p.start_date} (sau tháng ${String(mo).padStart(2,'0')}/${yr})` : 'Chưa có ngày bắt đầu'
      })),
      eligible_count: eligible.length,
      excluded_count: notYet.length,
      per_project: perProject
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/depreciation/allocate-to-shared-cost — Phân bổ khấu hao tháng vào chi phí chung
app.post('/api/depreciation/allocate-to-shared-cost', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const { year, month } = await c.req.json()

    if (!year || !month) return c.json({ error: 'Cần cung cấp year và month' }, 400)

    const yr = parseInt(year)
    const mo = parseInt(month)
    const monthName = `${String(mo).padStart(2,'0')}/${yr}`

    // Lấy cấu hình năm tài chính để tính fiscal_year đúng
    const fySettings = await getFiscalYearSettings(db)
    // Nếu tháng phân bổ < tháng bắt đầu NTC → thuộc NTC(yr-1), ngược lại → NTC(yr)
    // Ví dụ: start_month=2, tháng 1/2024 < tháng 2 → NTC2023; tháng 2/2024 → NTC2024
    const fiscalYear = mo < fySettings.start_month ? yr - 1 : yr
    const fiscalYearLabel = `NTC${fiscalYear}`

    // Kiểm tra đã phân bổ chưa
    const alreadyAllocated = await db.prepare(`
      SELECT COUNT(*) AS cnt FROM asset_depreciation_schedule
      WHERE year = ? AND month = ? AND is_allocated = 1
    `).bind(yr, mo).first() as any
    if (alreadyAllocated?.cnt > 0) {
      return c.json({ error: `Tháng ${monthName} đã được phân bổ vào chi phí chung rồi` }, 400)
    }

    // Lấy tất cả tài sản đang KH trong tháng này
    const scheduleRows = await db.prepare(`
      SELECT ads.*, a.asset_code, a.name AS asset_name
      FROM asset_depreciation_schedule ads
      JOIN assets a ON a.id = ads.asset_id
      WHERE ads.year = ? AND ads.month = ?
        AND a.depreciation_status = 'active' AND a.status != 'retired'
    `).bind(yr, mo).all()

    const rows = scheduleRows.results as any[]
    if (rows.length === 0) return c.json({ error: `Không có tài sản nào đang khấu hao trong tháng ${monthName}` }, 400)

    const totalDepreciation = rows.reduce((s: number, r: any) => s + (r.depreciation_amount || 0), 0)

    // Ngày cuối của tháng khấu hao (để so sánh với start_date dự án)
    // Dự án được tính vào phân bổ khi start_date <= ngày cuối tháng đó
    const lastDayOfMonth = new Date(yr, mo, 0).getDate()  // mo không trừ 1 vì Date dùng 0-indexed
    const monthEndDate = `${yr}-${String(mo).padStart(2,'0')}-${String(lastDayOfMonth).padStart(2,'0')}`

    // Lấy danh sách dự án active ĐÃ BẮT ĐẦU từ tháng khấu hao trở về trước
    // Điều kiện: status='active' VÀ start_date <= ngày cuối tháng khấu hao
    // Nếu start_date IS NULL → bỏ qua (dự án chưa xác định ngày bắt đầu)
    const activeProjects = await db.prepare(`
      SELECT id, code, name, contract_value, status, start_date
      FROM projects
      WHERE status = 'active'
        AND start_date IS NOT NULL
        AND start_date <= ?
      ORDER BY code ASC
    `).bind(monthEndDate).all()
    const projList = activeProjects.results as any[]

    if (projList.length === 0) {
      return c.json({
        error: `Không có dự án nào đã bắt đầu từ tháng ${monthName} trở về trước để phân bổ chi phí khấu hao`
      }, 400)
    }

    // Tạo shared_cost với fiscal_year đúng trong year field
    const projNames = projList.map((p: any) => p.code).join(', ')
    const scIns = await db.prepare(`
      INSERT INTO shared_costs
        (description, cost_type, amount, currency, cost_date, notes, allocation_basis, year, month, created_by)
      VALUES (?, ?, ?, 'VND', ?, ?, 'equal', ?, ?, ?)
    `).bind(
      `Khấu hao tài sản tháng ${monthName} (${fiscalYearLabel})`,
      'depreciation',
      totalDepreciation,
      `${yr}-${String(mo).padStart(2,'0')}-01`,
      `Tự động phân bổ từ ${rows.length} tài sản đang khấu hao. Tổng: ${totalDepreciation.toLocaleString('vi-VN')} VND. Chia đều cho ${projList.length} dự án đã bắt đầu: ${projNames}`,
      fiscalYear,
      mo,
      user.id
    ).run()

    const scId = scIns.meta.last_row_id as number

    // Phân bổ đều cho các dự án đã bắt đầu trong/trước tháng khấu hao
    const perProject = totalDepreciation / projList.length
    const pct = 100 / projList.length

    for (const proj of projList) {
      await db.prepare(`
        INSERT OR REPLACE INTO shared_cost_allocations
          (shared_cost_id, project_id, allocation_pct, allocated_amount)
        VALUES (?, ?, ?, ?)
      `).bind(scId, proj.id, pct, perProject).run()
    }

    // Đánh dấu đã phân bổ trên schedule
    for (const row of rows) {
      await db.prepare(`
        UPDATE asset_depreciation_schedule
        SET is_allocated = 1, shared_cost_id = ?, allocated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(scId, row.id).run()
    }

    // Cập nhật accumulated_depreciation và net_book_value trên assets
    for (const row of rows) {
      await db.prepare(`
        UPDATE assets SET
          accumulated_depreciation = accumulated_depreciation + ?,
          net_book_value = MAX(0, purchase_price - (accumulated_depreciation + ?))
        WHERE id = ?
      `).bind(row.depreciation_amount, row.depreciation_amount, row.asset_id).run()
    }

    return c.json({
      success: true,
      shared_cost_id: scId,
      message: `Đã phân bổ ${totalDepreciation.toLocaleString('vi-VN')} VND khấu hao tháng ${monthName} (${fiscalYearLabel}) cho ${projList.length} dự án`,
      total_depreciation: totalDepreciation,
      project_count: projList.length,
      per_project: perProject,
      asset_count: rows.length,
      fiscal_year: fiscalYear,
      fiscal_year_label: fiscalYearLabel,
      projects: projList.map((p: any) => ({ id: p.id, code: p.code, name: p.name, start_date: p.start_date, amount: perProject })),
      month_end_date: monthEndDate
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/depreciation/repair-orphaned — Sửa dữ liệu khấu hao bị orphan
// Orphan = is_allocated=1 nhưng shared_cost_id không tồn tại trong shared_costs
app.post('/api/depreciation/repair-orphaned', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB

    // Tìm tất cả schedule rows bị orphan:
    // is_allocated=1 nhưng shared_cost_id IS NULL hoặc không tồn tại trong shared_costs
    const orphanedRows = await db.prepare(`
      SELECT ads.id, ads.asset_id, ads.year, ads.month, ads.depreciation_amount, ads.shared_cost_id
      FROM asset_depreciation_schedule ads
      WHERE ads.is_allocated = 1
        AND (
          ads.shared_cost_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM shared_costs sc WHERE sc.id = ads.shared_cost_id
          )
        )
    `).all()

    const rows = orphanedRows.results as any[]
    if (rows.length === 0) {
      return c.json({ success: true, repaired: 0, message: 'Không có dữ liệu khấu hao orphan nào' })
    }

    // Nhóm theo year+month để rollback accumulated_depreciation đúng
    const monthMap = new Map<string, any[]>()
    for (const row of rows) {
      const key = `${row.year}-${row.month}`
      if (!monthMap.has(key)) monthMap.set(key, [])
      monthMap.get(key)!.push(row)
    }

    // Reset is_allocated = 0 cho tất cả orphan rows
    await db.prepare(`
      UPDATE asset_depreciation_schedule
      SET is_allocated = 0, shared_cost_id = NULL, allocated_at = NULL
      WHERE is_allocated = 1
        AND (
          shared_cost_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM shared_costs sc WHERE sc.id = asset_depreciation_schedule.shared_cost_id
          )
        )
    `).run()

    // Rollback accumulated_depreciation và net_book_value cho từng tài sản bị ảnh hưởng
    const assetMap = new Map<number, number>()
    for (const row of rows) {
      assetMap.set(row.asset_id, (assetMap.get(row.asset_id) || 0) + (row.depreciation_amount || 0))
    }
    for (const [assetId, totalRollback] of assetMap) {
      await db.prepare(`
        UPDATE assets SET
          accumulated_depreciation = MAX(0, accumulated_depreciation - ?),
          net_book_value = MIN(purchase_price, net_book_value + ?)
        WHERE id = ?
      `).bind(totalRollback, totalRollback, assetId).run()
    }

    return c.json({
      success: true,
      repaired: rows.length,
      affected_assets: assetMap.size,
      affected_months: [...monthMap.keys()],
      message: `Đã sửa ${rows.length} dòng khấu hao orphan cho ${assetMap.size} tài sản`
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/depreciation/monthly-unallocated — Lấy các tháng chưa phân bổ (tối đa 24 tháng gần nhất)
app.get('/api/depreciation/monthly-unallocated', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { limit } = c.req.query()
    const maxRows = parseInt(limit || '24')
    const rows = await db.prepare(`
      SELECT
        ads.year, ads.month,
        COUNT(DISTINCT ads.asset_id) AS asset_count,
        SUM(ads.depreciation_amount) AS total_depreciation
      FROM asset_depreciation_schedule ads
      JOIN assets a ON a.id = ads.asset_id
      WHERE ads.is_allocated = 0
        AND a.depreciation_status = 'active'
        AND a.status != 'retired'
        AND (ads.year < CAST(strftime('%Y','now') AS INTEGER) OR
             (ads.year = CAST(strftime('%Y','now') AS INTEGER)
              AND ads.month <= CAST(strftime('%m','now') AS INTEGER)))
      GROUP BY ads.year, ads.month
      ORDER BY ads.year DESC, ads.month DESC
      LIMIT ?
    `).bind(maxRows).all()
    return c.json(rows.results)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
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
// EMAIL SETTINGS ROUTES
// ===================================================

// GET /api/email-settings — lấy cài đặt email của user hiện tại
app.get('/api/email-settings', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    await ensureEmailSettings(db, user.id)
    const settings = await db.prepare('SELECT * FROM email_settings WHERE user_id = ?').bind(user.id).first()
    return c.json(settings)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// PUT /api/email-settings — cập nhật cài đặt email của user hiện tại
app.put('/api/email-settings', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    await ensureEmailSettings(db, user.id)
    const data = await c.req.json()
    const fields = ['email_enabled','notify_task_assigned','notify_task_updated','notify_task_overdue','notify_project_added','notify_project_updated','notify_project_created','notify_timesheet_approved','notify_payment_request','notify_payment_status','notify_chat_mention','notify_daily_digest','notify_member_added']
    const updates = fields.filter(f => data[f] !== undefined).map(f => `${f} = ?`)
    const values = fields.filter(f => data[f] !== undefined).map(f => data[f] ? 1 : 0)
    if (!updates.length) return c.json({ error: 'Nothing to update' }, 400)
    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(user.id)
    await db.prepare(`UPDATE email_settings SET ${updates.join(', ')} WHERE user_id = ?`).bind(...values).run()
    const settings = await db.prepare('SELECT * FROM email_settings WHERE user_id = ?').bind(user.id).first()
    return c.json({ success: true, settings })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// SYSTEM CONFIG API (Admin only)
// ============================================================

// GET /api/system-config — lấy cấu hình hệ thống (admin only)
app.get('/api/system-config', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const rows = await db.prepare('SELECT key, value, description, updated_at FROM system_config').all()
    // Mask API key value for security
    const configs: Record<string, any> = {}
    for (const row of (rows.results as any[])) {
      if (row.key === 'resend_api_key' && row.value) {
        configs[row.key] = { value: row.value.slice(0, 8) + '****' + row.value.slice(-4), description: row.description, updated_at: row.updated_at, configured: true }
      } else {
        configs[row.key] = { value: row.value, description: row.description, updated_at: row.updated_at, configured: !!row.value }
      }
    }
    return c.json(configs)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// PUT /api/system-config — cập nhật cấu hình (admin only)
app.put('/api/system-config', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const data = await c.req.json() as Record<string, string>
    
    const allowedKeys = ['resend_api_key', 'email_from_name', 'email_from_address', 'email_enabled']
    
    for (const [key, value] of Object.entries(data)) {
      if (!allowedKeys.includes(key)) continue
      await db.prepare(
        'INSERT OR REPLACE INTO system_config (key, value, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
      ).bind(key, value, user.id).run()
    }
    return c.json({ success: true, message: 'Cấu hình đã được lưu' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// POST /api/system-config/verify-email-key — kiểm tra API key có hợp lệ không
app.post('/api/system-config/verify-email-key', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const body = await c.req.json().catch(() => ({})) as any
    
    // Lấy key: ưu tiên body, sau đó env, cuối cùng DB
    let apiKey = body?.api_key?.trim()
    if (!apiKey) apiKey = c.env.RESEND_API_KEY
    if (!apiKey) {
      const dbKey = await db.prepare("SELECT value FROM system_config WHERE key = 'resend_api_key'").first() as any
      apiKey = dbKey?.value || ''
    }
    if (!apiKey) return c.json({ valid: false, error: 'Chưa có API key nào được cấu hình' })
    
    // Gọi Resend API để verify
    const res = await fetch('https://api.resend.com/api-keys', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    })
    
    if (res.ok) {
      return c.json({ valid: true, message: '✅ API Key hợp lệ! Sẵn sàng gửi email.' })
    } else {
      const err = await res.json() as any
      return c.json({ valid: false, error: `❌ Key không hợp lệ: ${err?.message || res.statusText}` })
    }
  } catch (e: any) {
    return c.json({ valid: false, error: e.message }, 500)
  }
})

// GET /api/email-logs — lịch sử email gửi (admin only, hoặc user xem của mình)
app.get('/api/email-logs', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const limit = parseInt(c.req.query('limit') || '50')
    let rows: any
    if (user.role === 'system_admin') {
      rows = await db.prepare(`
        SELECT el.*, u.full_name, u.email as user_email
        FROM email_logs el LEFT JOIN users u ON el.user_id = u.id
        ORDER BY el.sent_at DESC LIMIT ?
      `).bind(limit).all()
    } else {
      rows = await db.prepare(`
        SELECT * FROM email_logs WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?
      `).bind(user.id, limit).all()
    }
    return c.json(rows.results)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// POST /api/email-settings/test — gửi email test
app.post('/api/email-settings/test', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any

    // Cho phép truyền to_email tuỳ chỉnh (hữu ích khi email trong DB là email giả)
    const body = await c.req.json().catch(() => ({})) as any
    const overrideEmail = body?.to_email?.trim()

    const emailUser = await getUserEmailInfo(db, user.id)
    const toEmail = overrideEmail || emailUser?.email
    const toName  = emailUser?.full_name || user.full_name || 'Admin'

    if (!toEmail) return c.json({ error: 'Tài khoản chưa có email. Vui lòng truyền to_email trong body.' }, 400)

    let apiKey = c.env.RESEND_API_KEY
    if (!apiKey) {
      const dbKey = await db.prepare("SELECT value FROM system_config WHERE key = 'resend_api_key'").first() as any
      apiKey = dbKey?.value || ''
    }
    if (!apiKey) return c.json({ error: 'Chưa cấu hình RESEND_API_KEY. Vào Admin → Cấu hình Email để thêm API Key.' }, 400)

    const { subject, html } = emailTemplates('task_assigned', {
      recipientName: toName,
      taskTitle: '[TEST] Kiểm tra email thông báo OneCad BIM',
      projectName: 'OneCad BIM - Demo Project',
      discipline: 'Kiến trúc (AA)',
      priority: 'medium',
      deadline: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      assignedBy: 'System (Test Email)',
      description: 'Đây là email kiểm tra từ hệ thống OneCad BIM. Nếu bạn nhận được email này, cài đặt thông báo email đã hoạt động chính xác!'
    })

    let status = 'sent'
    let errorMsg: string | null = null
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'OneCad BIM <no-reply@bimonecadvn.com>', to: [toEmail], subject, html }),
      })
      if (!res.ok) { const err = await res.text(); status = 'failed'; errorMsg = err.slice(0, 500) }
    } catch (e: any) { status = 'failed'; errorMsg = e.message }

    await db.prepare(`INSERT INTO email_logs (user_id, to_email, subject, event_type, status, error_msg) VALUES (?,?,?,?,?,?)`)
      .bind(user.id, toEmail, subject, 'test', status, errorMsg).run()

    if (status === 'failed') return c.json({ error: `Gửi thất bại: ${errorMsg}` }, 500)
    return c.json({ success: true, message: `Email test đã gửi đến ${toEmail}` })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /api/email-settings/all-users — admin xem settings của tất cả users
app.get('/api/email-settings/all-users', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const rows = await db.prepare(`
      SELECT u.id, u.full_name, u.email, u.department,
        COALESCE(es.email_enabled, 1) as email_enabled,
        COALESCE(es.notify_task_assigned, 1) as notify_task_assigned,
        COALESCE(es.notify_task_updated, 1) as notify_task_updated,
        COALESCE(es.notify_task_overdue, 1) as notify_task_overdue,
        COALESCE(es.notify_project_added, 1) as notify_project_added,
        COALESCE(es.notify_timesheet_approved, 1) as notify_timesheet_approved,
        COALESCE(es.notify_payment_request, 1) as notify_payment_request,
        COALESCE(es.notify_chat_mention, 1) as notify_chat_mention
      FROM users u
      LEFT JOIN email_settings es ON u.id = es.user_id
      WHERE u.is_active = 1
      ORDER BY u.full_name
    `).all()
    return c.json(rows.results)
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

    // Tổng dự án = tất cả trừ cancelled và completed (dự án đang tồn tại/hoạt động)
    const totalProjects = await db.prepare(
      'SELECT COUNT(*) as count FROM projects WHERE status NOT IN ("cancelled", "completed")'
    ).first() as any
    const activeProjects = await db.prepare(
      'SELECT COUNT(*) as count FROM projects WHERE status = "active"'
    ).first() as any
    const totalTasks = await db.prepare('SELECT COUNT(*) as count FROM tasks WHERE status != "cancelled"').first() as any
    // Hoàn thành = completed + review (đang duyệt cũng đã xử lý xong phần việc)
    const completedTasks = await db.prepare('SELECT COUNT(*) as count FROM tasks WHERE status IN ("completed","review")').first() as any
    // Quá hạn: loại trừ cả review + completed + cancelled
    const overdueTasks = await db.prepare('SELECT COUNT(*) as count FROM tasks WHERE due_date < date("now") AND status NOT IN ("completed","review","cancelled")').first() as any
    const totalUsers = await db.prepare("SELECT COUNT(*) as count FROM users WHERE is_active = 1 AND role != 'system_admin'").first() as any
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
        SUM(CASE WHEN t.status IN ('completed','review') THEN 1 ELSE 0 END) as completed_tasks,
        SUM(CASE WHEN t.due_date < date('now') AND t.status NOT IN ('completed','review','cancelled') THEN 1 ELSE 0 END) as overdue_tasks
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id
      WHERE p.status NOT IN ('cancelled', 'completed')
      GROUP BY p.id
      ORDER BY p.start_date DESC
      LIMIT 10
    `).all()

    // Discipline breakdown
    const disciplineBreakdown = await db.prepare(`
      SELECT discipline_code, COUNT(*) as count,
        SUM(CASE WHEN status IN ('completed','review') THEN 1 ELSE 0 END) as completed
      FROM tasks
      WHERE discipline_code IS NOT NULL
      GROUP BY discipline_code
      ORDER BY count DESC
    `).all()

    // Member productivity — use subqueries to avoid Cartesian product between tasks and timesheets
    const memberProductivityRaw = await db.prepare(`
      SELECT u.id, u.full_name, u.department,
        COALESCE(tsk.total_tasks,     0) AS total_tasks,
        COALESCE(tsk.completed_tasks, 0) AS completed_tasks,
        COALESCE(tsk.ontime_tasks,    0) AS ontime_tasks,
        COALESCE(ts.total_hours,      0) AS total_hours
      FROM users u
      LEFT JOIN (
        SELECT assigned_to,
          COUNT(DISTINCT id) AS total_tasks,
          COUNT(DISTINCT CASE WHEN status IN ('completed','review') THEN id END) AS completed_tasks,
          COUNT(DISTINCT CASE WHEN status IN ('completed','review')
            AND actual_end_date IS NOT NULL
            AND actual_end_date <= due_date THEN id END) AS ontime_tasks
        FROM tasks
        GROUP BY assigned_to
      ) tsk ON tsk.assigned_to = u.id
      LEFT JOIN (
        SELECT user_id,
          SUM(regular_hours + IFNULL(overtime_hours, 0)) AS total_hours
        FROM timesheets
        WHERE work_date >= date('now', '-30 days')
        GROUP BY user_id
      ) ts ON ts.user_id = u.id
      WHERE u.is_active = 1 AND u.role NOT IN ('system_admin')
      ORDER BY completed_tasks DESC, total_hours DESC
    `).all()

    // Tính các chỉ số năng suất (cùng công thức với /api/productivity)
    const memberProductivity = {
      results: (memberProductivityRaw.results as any[]).map(r => {
        const task_giao       = Math.max(0, r.total_tasks)
        const da_xong         = Math.min(task_giao, Math.max(0, r.completed_tasks))
        const dung_han        = Math.min(da_xong, Math.max(0, r.ontime_tasks))
        const completion_rate = task_giao > 0 ? Math.min(100, Math.round((da_xong / task_giao) * 100)) : 0
        const ontime_rate     = da_xong > 0   ? Math.min(100, Math.round((dung_han / da_xong) * 100)) : 0
        const productivity    = Math.round((completion_rate + ontime_rate) / 2)
        const score           = Math.round((productivity + ontime_rate) / 2)
        return { ...r, completion_rate, ontime_rate, productivity, score }
      })
    }

    // ── Extra stats for secondary KPI widgets ──────────────────────────
    const curYear  = new Date().getFullYear()
    const curMonth = new Date().getMonth() + 1
    const curMonthStr = String(curMonth).padStart(2, '0')
    const curYearStr  = String(curYear)

    // Doanh thu năm tài chính hiện tại (paid + partial)
    const fySettings3 = await getFiscalYearSettings(db)
    const { startDate: fyStartNow, endDate: fyEndNow } = getFiscalYearDateRange(curYear, fySettings3)
    const revenueNow = await db.prepare(`
      SELECT SUM(amount) as total
      FROM project_revenues
      WHERE revenue_date >= ? AND revenue_date <= ?
        AND payment_status IN ('paid','partial')
    `).bind(fyStartNow, fyEndNow).first() as any

    // GTHĐ tổng tất cả dự án đang active
    const contractTotal = await db.prepare(`
      SELECT SUM(contract_value) as total FROM projects WHERE status != 'cancelled'
    `).first() as any

    // Tổng giờ làm tháng hiện tại (regular + overtime)
    const hoursThisMonth = await db.prepare(`
      SELECT SUM(regular_hours) as regular, SUM(IFNULL(overtime_hours,0)) as overtime
      FROM timesheets
      WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
    `).bind(curYearStr, curMonthStr).first() as any

    // Chi phí lương tháng hiện tại (từ monthly_labor_costs)
    const laborThisMonth = await db.prepare(`
      SELECT total_labor_cost FROM monthly_labor_costs WHERE year = ? AND month = ?
    `).bind(curYear, curMonth).first() as any

    // ── NEW Widget 1: Phân bổ task theo trạng thái (không bao gồm cancelled) ──
    const taskStatusBreakdown = await db.prepare(`
      SELECT status, COUNT(*) as count
      FROM tasks WHERE status != 'cancelled'
      GROUP BY status
    `).all()

    // ── NEW Widget 2: Nhân sự hoạt động tháng này + top contributor ──
    const activeUsersMonth = await db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count FROM timesheets
      WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
    `).bind(curYearStr, curMonthStr).first() as any

    const topContributor = await db.prepare(`
      SELECT u.full_name, SUM(ts.regular_hours + ts.overtime_hours) as total_hours
      FROM timesheets ts JOIN users u ON u.id = ts.user_id
      WHERE strftime('%Y', ts.work_date) = ? AND strftime('%m', ts.work_date) = ?
      GROUP BY ts.user_id ORDER BY total_hours DESC LIMIT 1
    `).bind(curYearStr, curMonthStr).first() as any

    // ── NEW Widget 3: Dự án sắp đến hạn (trong 30 ngày tới) & deadline đã qua ──
    const projectsNearDeadline = await db.prepare(`
      SELECT p.id, p.code, p.name,
        date(p.end_date) as end_date,
        p.status,
        SUM(CASE WHEN t.status NOT IN ('completed','review','cancelled') THEN 1 ELSE 0 END) as open_tasks,
        SUM(CASE WHEN t.due_date < date('now') AND t.status NOT IN ('completed','review','cancelled') THEN 1 ELSE 0 END) as overdue_tasks
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id
      WHERE p.status = 'active'
        AND p.end_date IS NOT NULL
        AND date(p.end_date) <= date('now', '+30 days')
      GROUP BY p.id
      ORDER BY p.end_date ASC
      LIMIT 5
    `).all()

    // ── NEW Widget 4: Chi phí chung chưa phân bổ (tổng shared costs so với allocated) ──
    const sharedCostSummary = await db.prepare(`
      SELECT
        COUNT(*) as total_entries,
        SUM(amount) as total_amount
      FROM shared_costs
      WHERE year = ?
    `).bind(curYear).first() as any

    // Tổng đã phân bổ trong năm
    const sharedAllocated = await db.prepare(`
      SELECT SUM(sca.allocated_amount) as total_allocated
      FROM shared_cost_allocations sca
      JOIN shared_costs sc ON sc.id = sca.shared_cost_id
      WHERE sc.year = ?
    `).bind(curYear).first() as any

    // ── Member personal task stats (for non-admin users) ─────────────────
    const myTaskStats = await db.prepare(`
      SELECT
        COUNT(CASE WHEN status != 'cancelled' THEN 1 END) as total,
        COUNT(CASE WHEN status IN ('completed','review') THEN 1 END) as completed,
        COUNT(CASE WHEN due_date < date('now') AND status NOT IN ('completed','review','cancelled') THEN 1 END) as overdue,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN due_date >= date('now') AND due_date <= date('now', '+7 days') AND status NOT IN ('completed','review','cancelled') THEN 1 END) as due_soon
      FROM tasks
      WHERE assigned_to = ?
    `).bind(user.id).first() as any

    // My recent active tasks (tasks cần làm ngay)
    const myActiveTasks = await db.prepare(`
      SELECT t.id, t.title, t.status, t.priority, t.due_date, t.progress,
        p.code as project_code, p.name as project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.assigned_to = ? AND t.status NOT IN ('completed','review','cancelled')
      ORDER BY t.due_date ASC NULLS LAST
      LIMIT 5
    `).bind(user.id).all()

    // Số dự án on-track (không có task trễ) vs at-risk (có ≥1 task trễ)
    const projectHealth = await db.prepare(`
      SELECT
        SUM(CASE WHEN overdue_count = 0 THEN 1 ELSE 0 END) as on_track,
        SUM(CASE WHEN overdue_count > 0 THEN 1 ELSE 0 END) as at_risk
      FROM (
        SELECT p.id,
          SUM(CASE WHEN t.due_date < date('now') AND t.status NOT IN ('completed','review','cancelled') THEN 1 ELSE 0 END) as overdue_count
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.status = 'active'
        GROUP BY p.id
      )
    `).first() as any

    return c.json({
      stats: {
        total_projects: totalProjects?.count || 0,
        active_projects: activeProjects?.count || 0,
        total_tasks: totalTasks?.count || 0,
        completed_tasks: completedTasks?.count || 0,
        overdue_tasks: overdueTasks?.count || 0,
        total_users: totalUsers?.count || 0,
        total_assets: totalAssets?.count || 0,
        completion_rate: totalTasks?.count > 0 ? Math.round((completedTasks?.count / totalTasks?.count) * 100) : 0,
        // Extra stats for secondary widgets (legacy - kept for compat)
        revenue_ytd:        revenueNow?.total       || 0,
        contract_total:     contractTotal?.total    || 0,
        hours_this_month:   (hoursThisMonth?.regular || 0) + (hoursThisMonth?.overtime || 0),
        regular_this_month: hoursThisMonth?.regular  || 0,
        overtime_this_month:hoursThisMonth?.overtime || 0,
        labor_this_month:   laborThisMonth?.total_labor_cost || 0,
        projects_on_track:  projectHealth?.on_track  || 0,
        projects_at_risk:   projectHealth?.at_risk   || 0,
        // NEW widget stats
        active_users_month:   activeUsersMonth?.count || 0,
        top_contributor_name: (topContributor as any)?.full_name || null,
        top_contributor_hours:(topContributor as any)?.total_hours || 0,
        shared_cost_total:    sharedCostSummary?.total_amount || 0,
        shared_cost_allocated:sharedAllocated?.total_allocated || 0,
        shared_cost_entries:  sharedCostSummary?.total_entries || 0,
        // Member personal task stats
        my_tasks_total:    myTaskStats?.total || 0,
        my_tasks_completed:myTaskStats?.completed || 0,
        my_tasks_overdue:  myTaskStats?.overdue || 0,
        my_tasks_inprogress:myTaskStats?.in_progress || 0,
        my_tasks_due_soon: myTaskStats?.due_soon || 0,
      },
      monthly_hours: monthlyHours.results,
      project_progress: projectProgress.results,
      discipline_breakdown: disciplineBreakdown.results,
      member_productivity: memberProductivity.results,
      // NEW widget data
      task_status_breakdown: taskStatusBreakdown.results,
      projects_near_deadline: projectsNearDeadline.results,
      my_active_tasks: myActiveTasks.results,
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /api/dashboard/available-years — Trả về các năm NTC có dữ liệu thực tế
// Tổng hợp từ: project_costs, revenues (project_revenues), shared_costs, project_labor_costs
// Luôn thêm năm hiện tại + 1 năm tiếp theo dù chưa có dữ liệu
app.get('/api/dashboard/available-years', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const fySettings = await getFiscalYearSettings(db)
    const currentCalYear = new Date().getFullYear()
    // Năm NTC hiện tại: nếu tháng hiện tại < start_month → năm NTC = năm hiện tại - 1
    const nowMonth = new Date().getMonth() + 1
    const currentNtcYear = nowMonth < fySettings.start_month ? currentCalYear - 1 : currentCalYear

    // Lấy tất cả năm có dữ liệu từ các bảng
    // project_costs.cost_date → convert sang NTC year bằng fySettings.start_month
    // shared_costs.year, project_labor_costs.year, asset_depreciation_schedule.year đã là NTC year
    const sm = fySettings.start_month  // tháng bắt đầu NTC (vd: 2 = tháng 2)
    const yearRows = await db.prepare(`
      SELECT DISTINCT ntc_year AS year FROM (
        -- project_costs: cost_date → NTC year
        SELECT CASE
          WHEN CAST(strftime('%m', cost_date) AS INTEGER) >= ?
          THEN CAST(strftime('%Y', cost_date) AS INTEGER)
          ELSE CAST(strftime('%Y', cost_date) AS INTEGER) - 1
        END AS ntc_year
        FROM project_costs WHERE cost_date IS NOT NULL
        UNION
        -- shared_costs.year đã là NTC year
        SELECT year AS ntc_year FROM shared_costs WHERE year IS NOT NULL
        UNION
        -- project_labor_costs.year là calendar year → convert sang NTC
        SELECT CASE
          WHEN CAST(month AS INTEGER) >= ?
          THEN CAST(year AS INTEGER)
          ELSE CAST(year AS INTEGER) - 1
        END AS ntc_year
        FROM project_labor_costs WHERE year IS NOT NULL AND month IS NOT NULL
        UNION
        -- asset_depreciation_schedule: year/month là calendar → convert sang NTC
        SELECT CASE
          WHEN CAST(month AS INTEGER) >= ?
          THEN CAST(year AS INTEGER)
          ELSE CAST(year AS INTEGER) - 1
        END AS ntc_year
        FROM asset_depreciation_schedule WHERE year IS NOT NULL AND month IS NOT NULL
      )
      WHERE year IS NOT NULL
      ORDER BY year ASC
    `).bind(sm, sm, sm).all()

    // Lấy năm từ revenues (dùng revenue_date → convert sang NTC year)
    const revenueYearRows = await db.prepare(`
      SELECT DISTINCT
        CASE
          WHEN CAST(strftime('%m', revenue_date) AS INTEGER) >= ?
          THEN CAST(strftime('%Y', revenue_date) AS INTEGER)
          ELSE CAST(strftime('%Y', revenue_date) AS INTEGER) - 1
        END AS ntc_year
      FROM project_revenues
      WHERE revenue_date IS NOT NULL
      ORDER BY ntc_year ASC
    `).bind(fySettings.start_month).all()

    // Lấy năm dương lịch từ timesheets (work_date) và project start_date
    const calYearRows = await db.prepare(`
      SELECT DISTINCT cal_year AS year FROM (
        SELECT CAST(strftime('%Y', work_date) AS INTEGER) AS cal_year
        FROM timesheets WHERE work_date IS NOT NULL
        UNION
        SELECT CAST(strftime('%Y', start_date) AS INTEGER) AS cal_year
        FROM projects WHERE start_date IS NOT NULL
      )
      WHERE year IS NOT NULL
      ORDER BY year ASC
    `).all()

    const yearSet = new Set<number>()
    const calYearSet = new Set<number>()

    // Thêm năm từ project_costs, shared_costs, labor, depreciation
    for (const row of (yearRows.results as any[])) {
      if (row.year) yearSet.add(row.year)
    }
    // Thêm năm từ revenues
    for (const row of (revenueYearRows.results as any[])) {
      if (row.ntc_year) yearSet.add(row.ntc_year)
    }
    // Thêm năm dương lịch từ timesheets + project start_date
    for (const row of (calYearRows.results as any[])) {
      if (row.year) calYearSet.add(row.year)
    }

    // calendar_years cũng chứa NTC years để dùng cho các filter không phân biệt
    for (const y of calYearSet) yearSet.add(y)

    // Luôn thêm NTC năm hiện tại và năm tiếp theo
    yearSet.add(currentNtcYear)
    yearSet.add(currentNtcYear + 1)
    // Luôn thêm năm dương lịch hiện tại vào calendar set
    calYearSet.add(currentCalYear)
    calYearSet.add(currentCalYear + 1)

    const years = Array.from(yearSet).sort((a, b) => a - b)
    const calendarYears = Array.from(calYearSet).sort((a, b) => a - b)

    return c.json({
      years,
      calendar_years: calendarYears,
      current_ntc_year: currentNtcYear,
      current_cal_year: currentCalYear,
      fiscal_year_start_month: fySettings.start_month
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

app.get('/api/dashboard/cost-summary', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const OVERTIME_FACTOR = await getOvertimeFactor(db)
    const fySettings = await getFiscalYearSettings(db)
    const { year } = c.req.query()
    const fyYear = year ? parseInt(year) : new Date().getFullYear()
    const currentYear = String(fyYear)
    const { startDate: fyStart, endDate: fyEnd } = getFiscalYearDateRange(fyYear, fySettings)

    // Revenue by project trong NTC — dùng date range
    const revenueByProject = await db.prepare(`
      SELECT p.id, p.code, p.name, p.contract_value,
        COALESCE(SUM(CASE WHEN pr.payment_status IN ('paid','partial') THEN pr.amount ELSE 0 END), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN pr.payment_status = 'pending' THEN pr.amount ELSE 0 END), 0) as pending_revenue
      FROM projects p
      LEFT JOIN project_revenues pr ON pr.project_id = p.id
        AND pr.revenue_date >= ? AND pr.revenue_date <= ?
      WHERE p.status != 'cancelled'
      GROUP BY p.id ORDER BY total_revenue DESC
    `).bind(fyStart, fyEnd).all()

    // Other costs from project_costs trong NTC
    const costByProject = await db.prepare(`
      SELECT p.id, p.code, p.name,
        COALESCE(SUM(pc.amount), 0) as total_cost,
        pc.cost_type
      FROM projects p
      LEFT JOIN project_costs pc ON pc.project_id = p.id
        AND pc.cost_date >= ? AND pc.cost_date <= ?
        AND pc.cost_type != 'salary'
      WHERE p.status != 'cancelled'
      GROUP BY p.id, pc.cost_type
    `).bind(fyStart, fyEnd).all()

    // Labor costs: ưu tiên project_labor_costs (đã sync)
    // NTC bắc qua 2 năm lịch → cần lấy cả 2 năm
    const fyEnd1Year = fySettings.start_month === 1 ? fyYear : fyYear + 1
    let laborWhereSynced: string       // dùng trong JOIN ON ... (có alias plc.)
    let laborWhereSimple: string       // dùng trong WHERE standalone (không có alias)
    let laborParamsSynced: any[]
    if (fySettings.start_month === 1) {
      laborWhereSynced = `plc.year = ?`
      laborWhereSimple = `year = ?`
      laborParamsSynced = [fyYear]
    } else {
      laborWhereSynced = `((plc.year = ? AND plc.month >= ?) OR (plc.year = ? AND plc.month < ?))`
      laborWhereSimple = `((year = ? AND month >= ?) OR (year = ? AND month < ?))`
      laborParamsSynced = [fyYear, fySettings.start_month, fyEnd1Year, fySettings.start_month]
    }

    const laborByProjectSynced = await db.prepare(`
      SELECT p.id, p.code, p.name,
        COALESCE(SUM(plc.total_labor_cost), 0) as labor_cost,
        COALESCE(SUM(plc.total_hours), 0) as total_hours,
        COUNT(DISTINCT plc.month) as months_with_data
      FROM projects p
      LEFT JOIN project_labor_costs plc ON plc.project_id = p.id AND ${laborWhereSynced}
      WHERE p.status NOT IN ('cancelled','completed')
      GROUP BY p.id
    `).bind(...laborParamsSynced).all()

    // Real-time fallback: tính từng tháng NTC (có thể bắc qua 2 năm lịch)
    const realtimeMap: Record<number, { rt_labor_cost: number; rt_hours: number }> = {}
    {
      const sm = fySettings.start_month
      const monthsInFY: Array<{ calYear: number; calMonth: number }> = []
      for (let i = 0; i < 12; i++) {
        const lm = ((sm - 1 + i) % 12) + 1
        const { calYear, calMonth } = fiscalMonthToCalendar(lm, fyYear, fySettings)
        monthsInFY.push({ calYear, calMonth })
      }

      for (const { calYear, calMonth } of monthsInFY) {
        const calY = String(calYear)
        const calM = String(calMonth).padStart(2, '0')

        const mlcRow = await db.prepare(
          `SELECT total_labor_cost FROM monthly_labor_costs WHERE month = ? AND year = ?`
        ).bind(calMonth, calYear).first() as any
        if (!mlcRow?.total_labor_cost) continue

        const compHrsRow = await db.prepare(`
          SELECT SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as comp_eff
          FROM timesheets WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
        `).bind(OVERTIME_FACTOR, calY, calM).first() as any
        const compEff = compHrsRow?.comp_eff || 0
        if (compEff <= 0) continue

        const cph = mlcRow.total_labor_cost / compEff

        const projRows = await db.prepare(`
          SELECT project_id,
                 SUM(regular_hours + IFNULL(overtime_hours,0))     as proj_raw,
                 SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as proj_eff
          FROM timesheets
          WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
          GROUP BY project_id
        `).bind(OVERTIME_FACTOR, calY, calM).all()

        for (const pr of (projRows.results as any[])) {
          if ((pr.proj_raw || 0) <= 0) continue
          const mc = Math.round((pr.proj_eff || 0) * cph)
          if (!realtimeMap[pr.project_id]) realtimeMap[pr.project_id] = { rt_labor_cost: 0, rt_hours: 0 }
          realtimeMap[pr.project_id].rt_labor_cost += mc
          realtimeMap[pr.project_id].rt_hours += pr.proj_raw || 0
        }
      }
    }

    // Merge: dùng synced nếu có, fallback realtime
    const laborByProject = (laborByProjectSynced.results as any[]).map((p: any) => {
      if ((p.labor_cost || 0) > 0) return { ...p, labor_source: 'synced' }
      const rt = realtimeMap[p.id]
      if (rt && (rt.rt_labor_cost || 0) > 0) {
        return { ...p, labor_cost: Math.round(rt.rt_labor_cost), total_hours: rt.rt_hours || 0, labor_source: 'realtime' }
      }
      return { ...p, labor_source: 'none' }
    })

    // Monthly labor costs summary — ưu tiên project_labor_costs, fallback monthly_labor_costs
    // Bao gồm cả 2 năm lịch nếu NTC bắc qua 2 năm
    const plcMonthly = await db.prepare(`
      SELECT PRINTF('%d-%02d', year, month) as month,
        SUM(total_labor_cost) as total_cost, 'salary' as cost_type
      FROM project_labor_costs WHERE ${laborWhereSimple}
      GROUP BY month ORDER BY month ASC
    `).bind(...laborParamsSynced).all()

    // Nếu project_labor_costs trống, lấy từ monthly_labor_costs (tổng công ty)
    let monthlyLaborSummary = plcMonthly
    if (!plcMonthly.results?.length) {
      if (fySettings.start_month === 1) {
        monthlyLaborSummary = await db.prepare(`
          SELECT PRINTF('%d-%02d', year, month) as month,
            total_labor_cost as total_cost, 'salary' as cost_type
          FROM monthly_labor_costs WHERE year = ?
          ORDER BY month ASC
        `).bind(fyYear).all()
      } else {
        monthlyLaborSummary = await db.prepare(`
          SELECT PRINTF('%d-%02d', year, month) as month,
            total_labor_cost as total_cost, 'salary' as cost_type
          FROM monthly_labor_costs WHERE ${laborWhereSimple}
          ORDER BY month ASC
        `).bind(...laborParamsSynced).all()
      }
    }

    // Monthly summary: other non-salary costs from project_costs trong NTC
    const monthlySummary = await db.prepare(`
      SELECT strftime('%Y-%m', cost_date) as month,
        SUM(amount) as total_cost, cost_type
      FROM project_costs
      WHERE cost_date >= ? AND cost_date <= ? AND cost_type != 'salary'
      GROUP BY month, cost_type ORDER BY month ASC
    `).bind(fyStart, fyEnd).all()

    const timesheetCost = await db.prepare(`
      SELECT ts.project_id, p.name as project_name, p.code as project_code,
        SUM(ts.regular_hours + ts.overtime_hours) as total_hours
      FROM timesheets ts
      JOIN projects p ON ts.project_id = p.id
      WHERE ts.work_date >= ? AND ts.work_date <= ?
      GROUP BY ts.project_id
    `).bind(fyStart, fyEnd).all()

    // Merge monthly labor into monthlySummary for complete picture
    const allMonthlyCosts = [
      ...(monthlySummary.results || []),
      ...(monthlyLaborSummary.results || [])
    ]

    return c.json({
      fiscal_year: fyYear,
      fiscal_year_label: getFiscalYearLabel(fyYear, fySettings),
      fiscal_year_start: fyStart,
      fiscal_year_end: fyEnd,
      revenue_by_project: revenueByProject.results,
      cost_by_project: costByProject.results,
      labor_by_project: laborByProject,
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

    const baseWhere = `WHERE u.is_active = 1 AND u.role NOT IN ('system_admin')`

    // Use subqueries (no JOIN on tasks×timesheets) to prevent Cartesian duplicates
    // Hoàn thành = completed + review (đang duyệt = đã hoàn thành phần việc, chờ QA)
    const taskFilter = project_id ? `AND project_id = ${parseInt(project_id)}` : ''
    const rows = await db.prepare(`
      SELECT u.id, u.full_name, u.department,
        COALESCE(tsk.total_tasks,     0) AS total_tasks,
        COALESCE(tsk.completed_tasks, 0) AS completed_tasks,
        COALESCE(tsk.ontime_tasks,    0) AS ontime_tasks,
        COALESCE(tsk.late_completed,  0) AS late_completed,
        COALESCE(tsk.overdue_tasks,   0) AS overdue_tasks,
        COALESCE(ts.total_hours,      0) AS total_hours_period
      FROM users u
      LEFT JOIN (
        SELECT assigned_to,
          COUNT(DISTINCT id) AS total_tasks,
          COUNT(DISTINCT CASE WHEN status IN ('completed','review') THEN id END) AS completed_tasks,
          COUNT(DISTINCT CASE WHEN status IN ('completed','review')
            AND actual_end_date IS NOT NULL
            AND actual_end_date <= due_date THEN id END)             AS ontime_tasks,
          COUNT(DISTINCT CASE WHEN status IN ('completed','review')
            AND actual_end_date IS NOT NULL
            AND actual_end_date > due_date THEN id END)              AS late_completed,
          COUNT(DISTINCT CASE WHEN due_date < date('now')
            AND status NOT IN ('completed','review','cancelled') THEN id END) AS overdue_tasks
        FROM tasks
        WHERE 1=1 ${taskFilter}
        GROUP BY assigned_to
      ) tsk ON tsk.assigned_to = u.id
      LEFT JOIN (
        SELECT user_id,
          SUM(regular_hours + IFNULL(overtime_hours, 0)) AS total_hours
        FROM timesheets
        WHERE work_date >= date('now', '-${daysBack} days')
        GROUP BY user_id
      ) ts ON ts.user_id = u.id
      ${baseWhere}
      ORDER BY completed_tasks DESC, total_hours_period DESC
    `).all()

    const data = (rows.results as any[]).map(r => {
      // Safe clamped counts
      const task_giao  = Math.max(0, r.total_tasks)
      const da_xong    = Math.min(task_giao, Math.max(0, r.completed_tasks))
      const dung_han   = Math.min(da_xong, Math.max(0, r.ontime_tasks))
      const late       = Math.max(0, r.late_completed)
      const overdue    = Math.max(0, r.overdue_tasks)

      // -------------------------------------------------------
      // CÔNG THỨC NĂNG SUẤT (chính thức):
      //
      //   % Hoàn thành (completion_rate) = da_xong / task_giao × 100
      //                                     (0 nếu task_giao = 0)
      //
      //   Chính xác    (ontime_rate)     = dung_han / da_xong × 100
      //                                     (0 nếu da_xong = 0)
      //
      //   Năng suất    (productivity)    = (completion_rate + ontime_rate) / 2
      //
      //   Điểm         (score)           = (productivity + ontime_rate) / 2
      //                ↑ KHÁC với Năng suất — có thêm trọng số chính xác
      //
      // Ví dụ (Test case B — 2 task giao, 1 xong, 0 đúng hạn):
      //   completion_rate = 1/2×100 = 50%
      //   ontime_rate     = 0/1×100 = 0%
      //   productivity    = (50+0)/2 = 25%
      //   score           = (25+0)/2 = 13  (Math.round(12.5)=13)
      // -------------------------------------------------------
      const completion_rate = task_giao > 0
        ? Math.min(100, Math.round((da_xong / task_giao) * 100))
        : 0

      // ontime_rate is STRICTLY 0 when da_xong = 0
      const ontime_rate = da_xong > 0
        ? Math.min(100, Math.round((dung_han / da_xong) * 100))
        : 0

      const productivity = Math.round((completion_rate + ontime_rate) / 2)
      const score        = Math.round((productivity + ontime_rate) / 2)  // Điểm ≠ Năng suất

      return {
        id:               r.id,
        full_name:        r.full_name,
        department:       r.department,
        total_tasks:      task_giao,
        completed_tasks:  da_xong,
        ontime_tasks:     dung_han,
        late_completed:   late,
        overdue_tasks:    overdue,
        total_hours_period: r.total_hours_period,
        // computed metrics
        completion_rate,   // % Hoàn thành   = da_xong / task_giao × 100
        ontime_rate,       // Chính xác       = dung_han / da_xong × 100
        productivity,      // Năng suất        = (completion_rate + ontime_rate) / 2
        score              // Điểm             = (productivity + ontime_rate) / 2
      }
    })
    return c.json(data)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Alias for /api/productivity — same logic, same response shape
app.get('/api/productivity-report', authMiddleware, async (c) => {
  // Forward to /api/productivity handler by re-using same logic
  const db = c.env.DB
  try {
    const { project_id, days } = c.req.query()
    const daysBack = parseInt(days || '30')
    const baseWhere = `WHERE u.is_active = 1 AND u.role NOT IN ('system_admin')`
    const taskFilter = project_id ? `AND project_id = ${parseInt(project_id)}` : ''
    const rows = await db.prepare(`
      SELECT u.id, u.full_name, u.department,
        COALESCE(tsk.total_tasks,     0) AS total_tasks,
        COALESCE(tsk.completed_tasks, 0) AS completed_tasks,
        COALESCE(tsk.ontime_tasks,    0) AS ontime_tasks,
        COALESCE(tsk.late_completed,  0) AS late_completed,
        COALESCE(tsk.overdue_tasks,   0) AS overdue_tasks,
        COALESCE(ts.total_hours,      0) AS total_hours_period
      FROM users u
      LEFT JOIN (
        SELECT assigned_to,
          COUNT(DISTINCT id) AS total_tasks,
          COUNT(DISTINCT CASE WHEN status IN ('completed','review') THEN id END) AS completed_tasks,
          COUNT(DISTINCT CASE WHEN status IN ('completed','review')
            AND actual_end_date IS NOT NULL
            AND actual_end_date <= due_date THEN id END)             AS ontime_tasks,
          COUNT(DISTINCT CASE WHEN status IN ('completed','review')
            AND actual_end_date IS NOT NULL
            AND actual_end_date > due_date THEN id END)              AS late_completed,
          COUNT(DISTINCT CASE WHEN due_date < date('now')
            AND status NOT IN ('completed','review','cancelled') THEN id END) AS overdue_tasks
        FROM tasks
        WHERE 1=1 ${taskFilter}
        GROUP BY assigned_to
      ) tsk ON tsk.assigned_to = u.id
      LEFT JOIN (
        SELECT user_id,
          SUM(regular_hours + IFNULL(overtime_hours, 0)) AS total_hours
        FROM timesheets
        WHERE work_date >= date('now', '-${daysBack} days')
        GROUP BY user_id
      ) ts ON ts.user_id = u.id
      ${baseWhere}
      ORDER BY completed_tasks DESC, total_hours_period DESC
    `).all()
    const data = (rows.results as any[]).map(r => {
      const task_giao  = Math.max(0, r.total_tasks)
      const da_xong    = Math.min(task_giao, Math.max(0, r.completed_tasks))
      const dung_han   = Math.min(da_xong, Math.max(0, r.ontime_tasks))
      const late       = Math.max(0, r.late_completed)
      const overdue    = Math.max(0, r.overdue_tasks)
      // CÔNG THỨC (giống /api/productivity):
      //   completion_rate = da_xong / task_giao × 100  (% Hoàn thành)
      //   ontime_rate     = dung_han / da_xong × 100   (Chính xác)
      //   productivity    = (completion_rate + ontime_rate) / 2  (Năng suất)
      //   score           = (productivity + ontime_rate) / 2     (Điểm)
      const completion_rate = task_giao > 0 ? Math.min(100, Math.round((da_xong / task_giao) * 100)) : 0
      const ontime_rate     = da_xong > 0   ? Math.min(100, Math.round((dung_han / da_xong)  * 100)) : 0
      const productivity    = Math.round((completion_rate + ontime_rate) / 2)
      const score           = Math.round((productivity + ontime_rate) / 2)  // Điểm = (NS + CX) / 2
      return { id: r.id, full_name: r.full_name, department: r.department,
        total_tasks: task_giao, completed_tasks: da_xong, ontime_tasks: dung_han,
        late_completed: late, overdue_tasks: overdue, total_hours_period: r.total_hours_period,
        completion_rate, ontime_rate, productivity, score }
    })
    return c.json(data)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
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
        WHEN due_date IS NOT NULL AND due_date < date('now') AND status NOT IN ('completed','review','cancelled') THEN 1
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
// SEND OVERDUE REMINDERS — gửi mail nhắc deadline cho đúng người phụ trách
// POST /api/admin/send-overdue-reminders
// Gửi mail task_overdue cho assigned_to của mỗi task quá hạn chưa hoàn thành
// Có thể gọi từ cron job bên ngoài (VD: Cloudflare CRON, GitHub Actions...)
// ===================================================
app.post('/api/admin/send-overdue-reminders', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB

    // Lấy tất cả task quá hạn, chưa hoàn thành, có assigned_to
    const overdueRows = await db.prepare(`
      SELECT
        t.id, t.title, t.due_date, t.status, t.progress,
        t.assigned_to,
        u.email AS assignee_email, u.full_name AS assignee_name,
        p.name AS project_name, p.code AS project_code
      FROM tasks t
      JOIN users u ON u.id = t.assigned_to AND u.is_active = 1
      JOIN projects p ON p.id = t.project_id
      WHERE t.due_date < date('now')
        AND t.status NOT IN ('completed', 'review', 'cancelled')
        AND t.assigned_to IS NOT NULL
        AND u.email IS NOT NULL AND u.email != ''
      ORDER BY t.due_date ASC
    `).all()

    const tasks = overdueRows.results as any[]
    if (tasks.length === 0) {
      return c.json({ success: true, sent: 0, message: 'Không có task quá hạn nào cần nhắc' })
    }

    let sent = 0
    const errors: string[] = []

    for (const task of tasks) {
      try {
        // Tính số ngày quá hạn
        const dueDate = new Date(task.due_date)
        const today   = new Date()
        today.setHours(0, 0, 0, 0)
        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / 86400000)

        await sendEmail(c.env, {
          to:        task.assignee_email,
          toName:    task.assignee_name,
          eventType: 'task_overdue',
          data: {
            taskTitle:     task.title,
            projectName:   `${task.project_code} – ${task.project_name}`,
            deadline:      task.due_date,
            daysOverdue:   daysOverdue,
            status:        task.status,
            recipientName: task.assignee_name,
          },
          db,
          userId:      task.assigned_to,
          relatedType: 'task',
          relatedId:   task.id,
        })
        sent++
      } catch (e: any) {
        errors.push(`task#${task.id}: ${e.message}`)
      }
    }

    return c.json({
      success: true,
      total_overdue: tasks.length,
      sent,
      errors: errors.length ? errors : undefined,
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /api/admin/overdue-tasks-preview — xem trước danh sách sẽ nhận mail
app.get('/api/admin/overdue-tasks-preview', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const rows = await db.prepare(`
      SELECT
        t.id, t.title, t.due_date, t.status,
        u.email AS assignee_email, u.full_name AS assignee_name,
        p.code AS project_code
      FROM tasks t
      JOIN users u ON u.id = t.assigned_to AND u.is_active = 1
      JOIN projects p ON p.id = t.project_id
      WHERE t.due_date < date('now')
        AND t.status NOT IN ('completed', 'review', 'cancelled')
        AND t.assigned_to IS NOT NULL
        AND u.email IS NOT NULL AND u.email != ''
      ORDER BY t.due_date ASC
    `).all()
    return c.json(rows.results)
  } catch (e: any) {
    return c.json({ error: e.message }, 500) }
})

// ===================================================
// COST TYPES (System Admin CRUD)
// ===================================================
app.get('/api/cost-types', authMiddleware, async (c) => {
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
// Không phụ thuộc năm tài chính — hỗ trợ các chế độ:
//   ?mode=all_time           → Toàn dự án (từ start_date đến hiện tại hoặc end_date)
//   ?mode=ytd                → Từ đầu năm dương lịch đến nay (Year-to-date)
//   ?mode=year&year=2026     → Cả năm dương lịch 2026
//   ?mode=month&year=2026&month=3 → Tháng 3/2026
//   ?mode=range&from=2026-01-01&to=2026-06-30 → Khoảng ngày tuỳ chỉnh
//   ?mode=months&year=2026&months=1,2,3 → Nhiều tháng dương lịch
// ===================================================
app.get('/api/finance/project/:id', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const OVERTIME_FACTOR = await getOvertimeFactor(db)
    const projectId = parseInt(c.req.param('id'))
    const { mode, year, month, months, from, to } = c.req.query()

    const project = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first() as any
    if (!project) return c.json({ error: 'Not found' }, 404)

    const contractValue = project.contract_value || 0
    const validation_warnings: string[] = []
    const today = new Date().toISOString().slice(0, 10)

    // ── Xác định khoảng ngày và nhãn kỳ báo cáo ──────────────────────────
    let dateFrom: string
    let dateTo: string
    let periodLabel: string
    let periodMode: string = mode || 'all_time'

    const projectStart = project.start_date || '2020-01-01'
    const projectEnd   = project.end_date   || today

    if (periodMode === 'all_time' || !mode) {
      // Toàn bộ thời gian dự án (start_date → today hoặc end_date nếu đã xong)
      dateFrom = projectStart
      dateTo   = project.status === 'completed' ? projectEnd : today
      const endLabel = project.status === 'completed' ? projectEnd.slice(0,7) : 'hiện tại'
      periodLabel = `Toàn dự án (${projectStart.slice(0,7)} → ${endLabel})`
      periodMode = 'all_time'
    } else if (periodMode === 'ytd') {
      // Year-to-date: từ đầu năm hiện tại đến hôm nay
      const currentYear = new Date().getFullYear()
      dateFrom = `${currentYear}-01-01`
      dateTo   = today
      periodLabel = `Lũy kế ${currentYear} (01/${currentYear} → hiện tại)`
    } else if (periodMode === 'year' && year) {
      // Cả năm dương lịch
      dateFrom = `${year}-01-01`
      dateTo   = `${year}-12-31`
      periodLabel = `Năm ${year}`
    } else if (periodMode === 'month' && year && month) {
      // Tháng cụ thể (dương lịch)
      const mPad = String(parseInt(month)).padStart(2, '0')
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
      dateFrom = `${year}-${mPad}-01`
      dateTo   = `${year}-${mPad}-${String(lastDay).padStart(2,'0')}`
      periodLabel = `Tháng ${parseInt(month)}/${year}`
    } else if (periodMode === 'months' && year && months) {
      // Nhiều tháng dương lịch trong cùng năm
      const monthArr = months.split(',').map((m: string) => parseInt(m.trim())).filter((m: number) => m >= 1 && m <= 12).sort((a: number, b: number) => a - b)
      if (monthArr.length === 0) {
        dateFrom = `${year}-01-01`
        dateTo   = `${year}-12-31`
        periodLabel = `Năm ${year}`
      } else {
        const firstM = String(monthArr[0]).padStart(2,'0')
        const lastM  = String(monthArr[monthArr.length - 1]).padStart(2,'0')
        const lastDay = new Date(parseInt(year), monthArr[monthArr.length - 1], 0).getDate()
        dateFrom = `${year}-${firstM}-01`
        dateTo   = `${year}-${lastM}-${String(lastDay).padStart(2,'0')}`
        // Build exact month filter for non-contiguous months
        const monthConds = monthArr.map((m: number) => `strftime('%m', cost_date) = '${String(m).padStart(2,'0')}'`).join(' OR ')
        const revMonthConds = monthArr.map((m: number) => `strftime('%m', revenue_date) = '${String(m).padStart(2,'0')}'`).join(' OR ')
        periodLabel = `T${monthArr.join(',')}/${year}`

        // Use month-specific filter logic for non-contiguous months
        const costDateFilter = `AND strftime('%Y', cost_date) = '${year}' AND (${monthConds})`
        const revDateFilter  = `AND strftime('%Y', revenue_date) = '${year}' AND (${revMonthConds})`

        // Other costs
        const otherCostsR = await db.prepare(
          `SELECT cost_type, SUM(amount) as total FROM project_costs
           WHERE project_id = ? AND cost_type != 'salary' ${costDateFilter} GROUP BY cost_type`
        ).bind(projectId).all()
        const totalOtherCostR = (otherCostsR.results as any[]).reduce((s, c) => s + (c as any).total, 0)

        // Labor: hybrid per calendar month
        let laborCostR = 0, laborHoursR = 0, totalCphSumR = 0, totalCphCountR = 0
        let laborMonthsCountR = 0, hasSyncedR = false, hasRealtimeR = false
        for (const calMonth of monthArr) {
          const calYear = parseInt(year)
          const calY = year
          const calM = String(calMonth).padStart(2, '0')
          const cachedRowR = await db.prepare(
            `SELECT total_labor_cost, total_hours, cost_per_hour FROM project_labor_costs WHERE project_id = ? AND month = ? AND year = ?`
          ).bind(projectId, calMonth, calYear).first() as any
          if (cachedRowR?.total_labor_cost) {
            laborCostR += cachedRowR.total_labor_cost; laborHoursR += cachedRowR.total_hours || 0
            totalCphSumR += cachedRowR.cost_per_hour || 0; totalCphCountR++; laborMonthsCountR++; hasSyncedR = true; continue
          }
          const mlcRowR = await db.prepare(`SELECT total_labor_cost FROM monthly_labor_costs WHERE month = ? AND year = ?`).bind(calMonth, calYear).first() as any
          if (!mlcRowR?.total_labor_cost) continue
          const projHrsRowR = await db.prepare(`SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as proj_raw, SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as proj_eff FROM timesheets WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`).bind(OVERTIME_FACTOR, projectId, calY, calM).first() as any
          const compHrsRowR = await db.prepare(`SELECT SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as comp_eff FROM timesheets WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`).bind(OVERTIME_FACTOR, calY, calM).first() as any
          const projRawR = projHrsRowR?.proj_raw || 0; const projEffR = projHrsRowR?.proj_eff || 0; const compEffR = compHrsRowR?.comp_eff || 0
          if (projRawR <= 0 || compEffR <= 0) continue
          const cphR = mlcRowR.total_labor_cost / compEffR; const mcR = Math.round(projEffR * cphR)
          laborCostR += mcR; laborHoursR += projRawR; totalCphSumR += cphR; totalCphCountR++; laborMonthsCountR++; hasRealtimeR = true
        }
        const laborPerHourR = totalCphCountR > 0 ? totalCphSumR / totalCphCountR : 0
        const laborSourceR  = laborCostR > 0 ? (hasSyncedR && hasRealtimeR ? 'mixed' : hasSyncedR ? 'project_labor_costs' : 'realtime') : 'none'
        if (contractValue > 0 && laborCostR > contractValue) { validation_warnings.push(`Chi phí lương vượt giá trị HĐ`); laborCostR = contractValue }

        const revsR = await db.prepare(`SELECT SUM(CASE WHEN payment_status IN ('paid','partial') THEN amount ELSE 0 END) as total, SUM(CASE WHEN payment_status = 'pending' THEN amount ELSE 0 END) as pending_total FROM project_revenues WHERE project_id = ? ${revDateFilter}`).bind(projectId).first() as any
        const totalRevenueR = revsR?.total || 0; const pendingRevenueR = revsR?.pending_total || 0

        const timelineR = await db.prepare(`SELECT strftime('%Y-%m', cost_date) as month, cost_type, SUM(amount) as total FROM project_costs WHERE project_id = ? ${costDateFilter} GROUP BY month, cost_type ORDER BY month`).bind(projectId).all()
        const revTimelineR = await db.prepare(`SELECT strftime('%Y-%m', revenue_date) as month, SUM(amount) as total FROM project_revenues WHERE project_id = ? AND payment_status IN ('paid','partial') ${revDateFilter} GROUP BY month ORDER BY month`).bind(projectId).all()

        const sharedRowR = await db.prepare(`SELECT COALESCE(SUM(sca.allocated_amount), 0) as total, COUNT(DISTINCT sca.shared_cost_id) as cnt FROM shared_cost_allocations sca JOIN shared_costs sc ON sc.id = sca.shared_cost_id WHERE sca.project_id = ? AND sc.status != 'deleted' AND sc.year = ? AND sc.month IN (${monthArr.join(',')})`).bind(projectId, parseInt(year)).first() as any
        const sharedTotalR = sharedRowR?.total || 0; const sharedCountR = sharedRowR?.cnt || 0

        const totalCostR = laborCostR + totalOtherCostR + sharedTotalR
        const profitR = (totalRevenueR > 0 || totalCostR > 0) ? totalRevenueR - totalCostR : null
        const marginR = totalRevenueR > 0 && profitR !== null ? parseFloat(((profitR / totalRevenueR) * 100).toFixed(1)) : null
        if (contractValue > 0 && totalCostR > contractValue * 1.2) validation_warnings.push(`Tổng chi phí vượt 120% giá trị HĐ`)
        if (profitR !== null && profitR <= 0) validation_warnings.push(`Lợi nhuận âm: ${fmtNum(profitR)} ₫`)
        else if (profitR !== null && marginR !== null && marginR < 10 && marginR > 0) validation_warnings.push(`Lợi nhuận thấp: ${marginR}%`)
        if (totalRevenueR > 0 && laborCostR > totalRevenueR * 0.8) validation_warnings.push(`Chi phí lương chiếm ${((laborCostR/totalRevenueR)*100).toFixed(1)}% doanh thu`)

        const costTypeNamesR: Record<string, string> = { material: 'Vật liệu', equipment: 'Thiết bị', transport: 'Vận chuyển', other: 'Chi phí khác', salary: 'Lương nhân sự' }
        const costsByTypeR = [
          ...(laborCostR > 0 ? [{ cost_type: 'salary', total: laborCostR, label: 'Lương nhân sự', is_auto: true }] : []),
          ...(otherCostsR.results as any[]).map((c: any) => ({ ...c, label: costTypeNamesR[c.cost_type] || c.cost_type, is_auto: false })),
          ...(sharedTotalR > 0 ? [{ cost_type: 'shared', total: sharedTotalR, label: 'Chi phí chung (phân bổ)', is_auto: true, shared_count: sharedCountR }] : [])
        ]
        // Build labor_timeline per month for months mode
        const laborTimelineMapR: Record<string, number> = {}
        for (const calMonth of monthArr) {
          const calYear = parseInt(year)
          const calY = year
          const calM = String(calMonth).padStart(2, '0')
          const key = `${calYear}-${calM}`
          const cachedR2 = await db.prepare(`SELECT total_labor_cost FROM project_labor_costs WHERE project_id = ? AND month = ? AND year = ?`).bind(projectId, calMonth, calYear).first() as any
          if (cachedR2?.total_labor_cost) { laborTimelineMapR[key] = cachedR2.total_labor_cost; continue }
          const mlcR2 = await db.prepare(`SELECT total_labor_cost FROM monthly_labor_costs WHERE month = ? AND year = ?`).bind(calMonth, calYear).first() as any
          if (!mlcR2?.total_labor_cost) continue
          const phR2 = await db.prepare(`SELECT SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as proj_eff FROM timesheets WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`).bind(OVERTIME_FACTOR, projectId, calY, calM).first() as any
          const chR2 = await db.prepare(`SELECT SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as comp_eff FROM timesheets WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`).bind(OVERTIME_FACTOR, calY, calM).first() as any
          const pEff = phR2?.proj_eff || 0; const cEff = chR2?.comp_eff || 0
          if (pEff > 0 && cEff > 0) laborTimelineMapR[key] = Math.round(pEff * (mlcR2.total_labor_cost / cEff))
        }
        const laborTimelineR = Object.entries(laborTimelineMapR).map(([month, total]) => ({ month, total })).sort((a, b) => a.month.localeCompare(b.month))
        return c.json({
          project: { id: project.id, code: project.code, name: project.name, contract_value: contractValue, start_date: project.start_date, end_date: project.end_date, status: project.status },
          period: { label: periodLabel, mode: periodMode, date_from: dateFrom, date_to: dateTo },
          summary: { total_revenue: totalRevenueR, pending_revenue: pendingRevenueR, contract_value: contractValue, total_cost: totalCostR, labor_cost: laborCostR, other_cost: totalOtherCostR, shared_cost: sharedTotalR, shared_cost_count: sharedCountR, profit: profitR ?? null, margin: marginR ?? null, labor_hours: laborHoursR, labor_per_hour: Math.round(laborPerHourR), labor_source: laborSourceR, labor_months_count: laborMonthsCountR },
          costs_by_type: costsByTypeR,
          timeline: timelineR.results,
          revenue_timeline: revTimelineR.results,
          labor_timeline: laborTimelineR,
          validation: { warnings: validation_warnings, has_warnings: validation_warnings.length > 0, profit_status: profitR === null ? 'no_data' : (profitR > 0 ? (marginR !== null && marginR < 10 ? 'warning' : 'ok') : 'error') }
        })
      }
    } else if (periodMode === 'range' && from && to) {
      dateFrom = from
      dateTo   = to
      periodLabel = `${from.slice(0,7)} → ${to.slice(0,7)}`
    } else {
      // Mặc định: toàn dự án
      dateFrom = projectStart
      dateTo   = project.status === 'completed' ? projectEnd : today
      periodLabel = `Toàn dự án`
      periodMode = 'all_time'
    }

    // ── Lọc theo khoảng ngày (dateFrom → dateTo) ──────────────────────────
    const costDateFilter = `AND cost_date >= '${dateFrom}' AND cost_date <= '${dateTo}'`
    // Revenue: khi all_time không giới hạn dateTo (bao gồm cả thanh toán tương lai đã ghi nhận)
    const revDateTo = periodMode === 'all_time' ? '9999-12-31' : dateTo
    const revDateFilter  = `AND revenue_date >= '${dateFrom}' AND revenue_date <= '${revDateTo}'`

    // ── Other costs ──────────────────────────────────────────────────────
    const otherCosts = await db.prepare(
      `SELECT cost_type, SUM(amount) as total FROM project_costs
       WHERE project_id = ? AND cost_type != 'salary' ${costDateFilter} GROUP BY cost_type`
    ).bind(projectId).all()
    const totalOtherCost = (otherCosts.results as any[]).reduce((s, c) => s + (c as any).total, 0)

    // ── Labor cost: HYBRID per calendar month trong khoảng dateFrom→dateTo ──
    // Tìm tất cả tháng dương lịch nằm trong [dateFrom, dateTo]
    // Với mỗi tháng: ưu tiên project_labor_costs (synced), fallback real-time
    let laborCost = 0, laborHours = 0, totalCphSum = 0, totalCphCount = 0
    let laborMonthsCount = 0, hasSynced = false, hasRealtime = false

    // Tạo danh sách {calYear, calMonth} trong khoảng dateFrom→dateTo
    interface CalMonthPair { calYear: number; calMonth: number }
    const calMonthsInRange: CalMonthPair[] = []
    {
      const dFrom = new Date(dateFrom + 'T00:00:00Z')
      const dTo   = new Date(dateTo   + 'T00:00:00Z')
      let cur = new Date(dFrom.getFullYear(), dFrom.getMonth(), 1)
      const end = new Date(dTo.getFullYear(), dTo.getMonth(), 1)
      while (cur <= end) {
        calMonthsInRange.push({ calYear: cur.getFullYear(), calMonth: cur.getMonth() + 1 })
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
      }
    }

    for (const { calYear, calMonth } of calMonthsInRange) {
      const calY = String(calYear)
      const calM = String(calMonth).padStart(2, '0')

      // 1. Synced project_labor_costs
      const cachedRow = await db.prepare(
        `SELECT total_labor_cost, total_hours, cost_per_hour
         FROM project_labor_costs WHERE project_id = ? AND month = ? AND year = ?`
      ).bind(projectId, calMonth, calYear).first() as any
      if (cachedRow?.total_labor_cost) {
        laborCost += cachedRow.total_labor_cost
        laborHours += cachedRow.total_hours || 0
        totalCphSum += cachedRow.cost_per_hour || 0
        totalCphCount++; laborMonthsCount++; hasSynced = true; continue
      }

      // 2. Real-time từ monthly_labor_costs + timesheets
      const mlcRow = await db.prepare(
        `SELECT total_labor_cost FROM monthly_labor_costs WHERE month = ? AND year = ?`
      ).bind(calMonth, calYear).first() as any
      if (!mlcRow?.total_labor_cost) continue

      const projHrsRow = await db.prepare(`
        SELECT SUM(regular_hours + IFNULL(overtime_hours,0))     as proj_raw,
               SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as proj_eff
        FROM timesheets WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
      `).bind(OVERTIME_FACTOR, projectId, calY, calM).first() as any
      const compHrsRow = await db.prepare(`
        SELECT SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as comp_eff
        FROM timesheets WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
      `).bind(OVERTIME_FACTOR, calY, calM).first() as any

      const projRaw = projHrsRow?.proj_raw || 0
      const projEff = projHrsRow?.proj_eff || 0
      const compEff = compHrsRow?.comp_eff || 0
      if (projRaw <= 0 || compEff <= 0) continue

      const cph = mlcRow.total_labor_cost / compEff
      const mc  = Math.round(projEff * cph)
      laborCost += mc; laborHours += projRaw; totalCphSum += cph; totalCphCount++
      laborMonthsCount++; hasRealtime = true
    }

    const laborPerHour = totalCphCount > 0 ? totalCphSum / totalCphCount : 0
    const laborSource  = laborCost > 0
      ? (hasSynced && hasRealtime ? 'mixed' : hasSynced ? 'project_labor_costs' : 'realtime')
      : 'none'

    if (contractValue > 0 && laborCost > contractValue) {
      validation_warnings.push(`Chi phí lương (${fmtNum(laborCost)} ₫) vượt giá trị hợp đồng`)
      laborCost = contractValue
    }

    // ── Revenue ──────────────────────────────────────────────────────────
    const revenues = await db.prepare(
      `SELECT
         SUM(CASE WHEN payment_status IN ('paid','partial') THEN amount ELSE 0 END) as total,
         SUM(CASE WHEN payment_status = 'pending' THEN amount ELSE 0 END) as pending_total
       FROM project_revenues WHERE project_id = ? ${revDateFilter}`
    ).bind(projectId).first() as any
    const totalRevenue  = revenues?.total || 0
    const pendingRevenue2 = revenues?.pending_total || 0

    // ── Timeline: chi phí + doanh thu theo tháng ──────────────────────────
    const timeline = await db.prepare(`
      SELECT strftime('%Y-%m', cost_date) as month, cost_type, SUM(amount) as total
      FROM project_costs WHERE project_id = ? ${costDateFilter}
      GROUP BY month, cost_type ORDER BY month
    `).bind(projectId).all()

    // Timeline doanh thu theo tháng
    const revenueTimeline = await db.prepare(`
      SELECT strftime('%Y-%m', revenue_date) as month, SUM(amount) as total
      FROM project_revenues WHERE project_id = ?
        AND payment_status IN ('paid','partial') ${revDateFilter}
      GROUP BY month ORDER BY month
    `).bind(projectId).all()

    // Timeline lương từng tháng (từ project_labor_costs đã sync)
    // Dùng calMonthsInRange đã tính ở trên để lấy đúng tháng trong khoảng
    const laborTimelineMap: Record<string, number> = {}
    for (const { calYear, calMonth } of calMonthsInRange) {
      const row = await db.prepare(
        `SELECT total_labor_cost FROM project_labor_costs WHERE project_id = ? AND month = ? AND year = ?`
      ).bind(projectId, calMonth, calYear).first() as any
      if (row?.total_labor_cost) {
        const key = `${calYear}-${String(calMonth).padStart(2,'0')}`
        laborTimelineMap[key] = (laborTimelineMap[key] || 0) + row.total_labor_cost
      } else {
        // Fallback real-time nếu chưa sync
        const calY = String(calYear)
        const calM = String(calMonth).padStart(2,'0')
        const mlcRow = await db.prepare(
          `SELECT total_labor_cost FROM monthly_labor_costs WHERE month = ? AND year = ?`
        ).bind(calMonth, calYear).first() as any
        if (mlcRow?.total_labor_cost) {
          const projHrsRow = await db.prepare(`
            SELECT SUM(regular_hours + IFNULL(overtime_hours,0)) as proj_raw,
                   SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as proj_eff
            FROM timesheets WHERE project_id = ? AND strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
          `).bind(OVERTIME_FACTOR, projectId, calY, calM).first() as any
          const compHrsRow = await db.prepare(`
            SELECT SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as comp_eff
            FROM timesheets WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?
          `).bind(OVERTIME_FACTOR, calY, calM).first() as any
          const projEff = projHrsRow?.proj_eff || 0
          const compEff = compHrsRow?.comp_eff || 0
          if (projEff > 0 && compEff > 0) {
            const cph = mlcRow.total_labor_cost / compEff
            const key = `${calYear}-${calM}`
            laborTimelineMap[key] = (laborTimelineMap[key] || 0) + Math.round(projEff * cph)
          }
        }
      }
    }
    const laborTimeline = Object.entries(laborTimelineMap)
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month.localeCompare(b.month))

    // ── Shared cost ───────────────────────────────────────────────────────
    // all_time / year / range: lấy tất cả shared_costs của dự án trong khoảng ngày
    // Dùng ngày giao dịch (year+month của shared_costs) hoặc allocated_date nếu có
    let sharedRow: any
    if (periodMode === 'all_time' || periodMode === 'ytd') {
      // Tất cả shared costs được phân bổ cho dự án (không giới hạn năm)
      sharedRow = await db.prepare(`
        SELECT COALESCE(SUM(sca.allocated_amount), 0) as total, COUNT(DISTINCT sca.shared_cost_id) as cnt
        FROM shared_cost_allocations sca
        JOIN shared_costs sc ON sc.id = sca.shared_cost_id
        WHERE sca.project_id = ? AND sc.status != 'deleted'
      `).bind(projectId).first() as any
    } else {
      // Năm cụ thể hoặc range: lọc theo năm trong khoảng
      const yearsInRange = [...new Set(calMonthsInRange.map(p => p.calYear))]
      if (yearsInRange.length === 1) {
        sharedRow = await db.prepare(`
          SELECT COALESCE(SUM(sca.allocated_amount), 0) as total, COUNT(DISTINCT sca.shared_cost_id) as cnt
          FROM shared_cost_allocations sca
          JOIN shared_costs sc ON sc.id = sca.shared_cost_id
          WHERE sca.project_id = ? AND sc.status != 'deleted' AND sc.year = ?
        `).bind(projectId, yearsInRange[0]).first() as any
      } else {
        sharedRow = await db.prepare(`
          SELECT COALESCE(SUM(sca.allocated_amount), 0) as total, COUNT(DISTINCT sca.shared_cost_id) as cnt
          FROM shared_cost_allocations sca
          JOIN shared_costs sc ON sc.id = sca.shared_cost_id
          WHERE sca.project_id = ? AND sc.status != 'deleted'
            AND sc.year >= ? AND sc.year <= ?
        `).bind(projectId, Math.min(...yearsInRange), Math.max(...yearsInRange)).first() as any
      }
    }
    const sharedCostTotal = sharedRow?.total || 0
    const sharedCostCount = sharedRow?.cnt || 0

    // ── Tổng hợp ─────────────────────────────────────────────────────────
    const totalCost = laborCost + totalOtherCost + sharedCostTotal
    const profit = (totalRevenue > 0 || totalCost > 0) ? totalRevenue - totalCost : null
    const margin = totalRevenue > 0 && profit !== null ? parseFloat(((profit / totalRevenue) * 100).toFixed(1)) : null

    if (contractValue > 0 && totalCost > contractValue * 1.2) validation_warnings.push(`Tổng chi phí (${fmtNum(totalCost)} ₫) vượt 120% giá trị HĐ`)
    if (profit !== null && profit <= 0) validation_warnings.push(`Lợi nhuận âm: ${fmtNum(profit)} ₫`)
    else if (profit !== null && margin !== null && margin < 10 && margin > 0) validation_warnings.push(`Lợi nhuận thấp: ${margin}% (< 10%)`)
    if (totalRevenue > 0 && laborCost > totalRevenue * 0.8) validation_warnings.push(`Chi phí lương chiếm ${((laborCost/totalRevenue)*100).toFixed(1)}% doanh thu (> 80%)`)

    const costTypeNames: Record<string, string> = {
      material: 'Vật liệu', equipment: 'Thiết bị', transport: 'Vận chuyển',
      other: 'Chi phí khác', salary: 'Lương nhân sự'
    }
    const costsByType = [
      ...(laborCost > 0 ? [{ cost_type: 'salary', total: laborCost, label: 'Lương nhân sự', is_auto: true }] : []),
      ...(otherCosts.results as any[]).map((c: any) => ({ ...c, label: costTypeNames[c.cost_type] || c.cost_type, is_auto: false })),
      ...(sharedCostTotal > 0 ? [{ cost_type: 'shared', total: sharedCostTotal, label: 'Chi phí chung (phân bổ)', is_auto: true, shared_count: sharedCostCount }] : [])
    ]

    return c.json({
      project: {
        id: project.id, code: project.code, name: project.name,
        contract_value: contractValue,
        start_date: project.start_date, end_date: project.end_date, status: project.status
      },
      period: { label: periodLabel, mode: periodMode, date_from: dateFrom, date_to: dateTo },
      summary: {
        total_revenue: totalRevenue, pending_revenue: pendingRevenue2,
        contract_value: contractValue, total_cost: totalCost,
        labor_cost: laborCost, other_cost: totalOtherCost,
        shared_cost: sharedCostTotal, shared_cost_count: sharedCostCount,
        profit: profit ?? null, margin: margin ?? null,
        labor_hours: laborHours, labor_per_hour: Math.round(laborPerHour),
        labor_source: laborSource, labor_months_count: laborMonthsCount
      },
      costs_by_type: costsByType,
      timeline: timeline.results,
      revenue_timeline: revenueTimeline.results,
      labor_timeline: laborTimeline,
      validation: {
        warnings: validation_warnings, has_warnings: validation_warnings.length > 0,
        profit_status: profit === null ? 'no_data' : (profit > 0 ? (margin !== null && margin < 10 ? 'warning' : 'ok') : 'error')
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
    const OVERTIME_FACTOR = await getOvertimeFactor(db)
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

    // Tổng giờ quy đổi toàn công ty tháng đó (OT x1.5)
    const totalHoursRow = await db.prepare(
      `SELECT SUM(regular_hours + overtime_hours) as raw_hours,
              SUM(regular_hours + IFNULL(overtime_hours,0) * ?) as eff_hours
       FROM timesheets
       WHERE strftime('%Y', work_date) = ? AND strftime('%m', work_date) = ?`
    ).bind(OVERTIME_FACTOR, y, m).first() as any

    const salaryPoolTotal  = salaryPool?.total    || 0
    const totalHoursAll    = totalHoursRow?.raw_hours || 0  // giờ thực (để hiển thị)
    const totalEffHoursAll = totalHoursRow?.eff_hours || 0  // giờ quy đổi (để tính chi phí)

    // Chi phí lương CHỈ dùng khi admin đã nhập thủ công
    const laborCostSource = manualEntry ? manualEntry.total_labor_cost : 0
    // cost_per_hour tính trên effective_hours (OT x1.5)
    const costPerHour = (totalEffHoursAll > 0 && laborCostSource > 0) ? laborCostSource / totalEffHoursAll : 0

    // Per-project: giờ quy đổi của từng dự án
    const byProject = await db.prepare(`
      SELECT p.id, p.code, p.name,
        COALESCE(SUM(ts.regular_hours + ts.overtime_hours), 0)           as project_hours,
        COALESCE(SUM(ts.regular_hours + IFNULL(ts.overtime_hours,0)*?),0) as project_eff_hours
      FROM projects p
      LEFT JOIN timesheets ts ON ts.project_id = p.id
        AND strftime('%Y', ts.work_date) = ?
        AND strftime('%m', ts.work_date) = ?
      WHERE p.status != 'cancelled'
      GROUP BY p.id
      HAVING project_hours > 0
      ORDER BY project_hours DESC
    `).bind(OVERTIME_FACTOR, y, m).all()

    const projectsWithCost = (byProject.results as any[]).map(r => ({
      ...r,
      labor_cost: Math.round(r.project_eff_hours * costPerHour),
      pct: totalEffHoursAll > 0 ? Math.round((r.project_eff_hours / totalEffHoursAll) * 100) : 0
    }))

    return c.json({
      month: `${y}-${m}`,
      month_int: mInt,
      year_int: yInt,
      salary_pool: salaryPoolTotal,          // tổng lương nhân sự (chỉ tham khảo)
      salary_pool_ref: salaryPoolTotal,
      manual_labor_cost: manualEntry ? manualEntry.total_labor_cost : null,
      labor_cost_used: laborCostSource,
      cost_source: manualEntry ? 'manual' : 'not_entered',
      total_hours: totalHoursAll,            // giờ thực (hiển thị ra ngoài)
      cost_per_hour: Math.round(costPerHour),// tính trên eff_hours (OT x1.5, ẩn)
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
      `CREATE TABLE IF NOT EXISTS subtasks (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'todo', priority TEXT NOT NULL DEFAULT 'medium', assigned_to INTEGER, due_date DATE, estimated_hours REAL DEFAULT 0, actual_hours REAL DEFAULT 0, notes TEXT, created_by INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id)`,
      `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, context_type TEXT NOT NULL, context_id INTEGER NOT NULL, sender_id INTEGER NOT NULL, content TEXT NOT NULL, mentions TEXT DEFAULT '[]', edited_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS message_attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL, file_name TEXT NOT NULL, file_type TEXT NOT NULL, file_size INTEGER DEFAULT 0, data TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_context ON messages(context_type, context_id)`,
      `CREATE INDEX IF NOT EXISTS idx_msg_attachments ON message_attachments(message_id)`,
      `CREATE TABLE IF NOT EXISTS timesheets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, project_id INTEGER NOT NULL, task_id INTEGER, work_date DATE NOT NULL, regular_hours REAL DEFAULT 0, overtime_hours REAL DEFAULT 0, description TEXT, status TEXT DEFAULT 'draft', approved_by INTEGER, approved_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, project_id, work_date))`,
      `CREATE TABLE IF NOT EXISTS project_costs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, cost_type TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL, currency TEXT DEFAULT 'VND', cost_date DATE, invoice_number TEXT, vendor TEXT, approved_by INTEGER, notes TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS project_revenues (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL, currency TEXT DEFAULT 'VND', revenue_date DATE, invoice_number TEXT, payment_status TEXT DEFAULT 'pending', notes TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS assets (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, brand TEXT, model TEXT, serial_number TEXT, specifications TEXT, purchase_date DATE, purchase_price REAL DEFAULT 0, current_value REAL DEFAULT 0, warranty_expiry DATE, status TEXT DEFAULT 'unused', location TEXT, department TEXT, assigned_to INTEGER, assigned_date DATE, notes TEXT, image_url TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, type TEXT DEFAULT 'info', related_type TEXT, related_id INTEGER, is_read INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS cost_types (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, color TEXT DEFAULT '#6B7280', is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS monthly_labor_costs (id INTEGER PRIMARY KEY AUTOINCREMENT, month INTEGER NOT NULL, year INTEGER NOT NULL, total_labor_cost REAL NOT NULL, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(month, year))`,
      `CREATE TABLE IF NOT EXISTS project_labor_costs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL, total_labor_cost REAL NOT NULL DEFAULT 0, total_hours REAL NOT NULL DEFAULT 0, cost_per_hour REAL NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, month, year), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS shared_costs (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, cost_type TEXT NOT NULL DEFAULT 'other', amount REAL NOT NULL, currency TEXT DEFAULT 'VND', cost_date DATE, invoice_number TEXT, vendor TEXT, notes TEXT, allocation_basis TEXT NOT NULL DEFAULT 'contract_value', year INTEGER, month INTEGER, status TEXT DEFAULT 'active', created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS shared_cost_allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, shared_cost_id INTEGER NOT NULL, project_id INTEGER NOT NULL, allocated_amount REAL NOT NULL DEFAULT 0, allocation_pct REAL NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(shared_cost_id, project_id), FOREIGN KEY (shared_cost_id) REFERENCES shared_costs(id) ON DELETE CASCADE, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE)`,
    ]

    for (const stmt of tables) {
      await db.prepare(stmt).run()
    }

    // ---- CRITICAL: Always dedup timesheets BEFORE seeding new data ----
    // This handles DBs created before UNIQUE constraint and any existing dupes
    try {
      await db.prepare(`
        DELETE FROM timesheets
        WHERE id NOT IN (
          SELECT MAX(id) FROM timesheets GROUP BY user_id, project_id, work_date
        )
      `).run()
    } catch (_) { /* ignore */ }

    // Insert admin user
    const adminHash = await hashPassword('Admin@123')
    await db.prepare(
      `INSERT OR IGNORE INTO users (username, password_hash, full_name, email, role, department)
       VALUES ('admin', ?, 'System Administrator', 'admin@onecad.vn', 'system_admin', 'Quản lý hệ thống')`
    ).bind(adminHash).run()

    // ---- CHECK SEED FLAG: Skip demo data if already initialized ----
    const seedFlag = await db.prepare(`SELECT value FROM system_settings WHERE key = 'seed_data_initialized'`).first() as any
    if (seedFlag && seedFlag.value === '1') {
      // Already initialized — only run safe maintenance tasks, skip re-seeding
      await db.prepare(`UPDATE tasks SET is_overdue = 0 WHERE due_date >= date('now') AND status NOT IN ('completed','review','cancelled')`).run()
      await db.prepare(`UPDATE tasks SET is_overdue = 1 WHERE due_date < date('now') AND status NOT IN ('completed','review','cancelled')`).run()
      return c.json({ success: true, message: 'System already initialized — skipped demo data re-seed' })
    }

    // ---- Migrate old 2024 dates to 2026 to fix overdue tasks ----
    await db.prepare(`UPDATE tasks SET due_date = REPLACE(due_date, '2024-', '2026-') WHERE due_date LIKE '2024-%'`).run()
    await db.prepare(`UPDATE tasks SET start_date = REPLACE(start_date, '2024-', '2026-') WHERE start_date LIKE '2024-%'`).run()
    await db.prepare(`UPDATE tasks SET actual_end_date = REPLACE(actual_end_date, '2024-', '2026-') WHERE actual_end_date LIKE '2024-%'`).run()
    await db.prepare(`UPDATE projects SET start_date = REPLACE(start_date, '2024-', '2026-'), end_date = REPLACE(end_date, '2024-', '2026-') WHERE start_date LIKE '2024-%'`).run()
    await db.prepare(`UPDATE projects SET end_date = REPLACE(end_date, '2025-', '2027-') WHERE end_date LIKE '2025-%'`).run()

    // -------------------------------------------------------
    // FIX DEMO DATA: Assign realistic actual_end_date values
    // to completed tasks so the <= deadline logic works correctly.
    //
    // Rules for demo data:
    //   - ĐÚNG HẠN (on-time)  : actual_end_date <= due_date
    //   - TRỄ HẠN  (late)     : actual_end_date >  due_date
    //
    // We use specific task IDs and only update if actual_end_date
    // is NULL or was set to the same generic "today" value, so that
    // real user-entered dates are never overwritten.
    // -------------------------------------------------------
    // Task 1 – "Vẽ mặt bằng tầng điển hình"
    //   due_date=2026-02-05 → completed 2026-02-03 (ONTIME, 2 days early)
    await db.prepare(`
      UPDATE tasks SET actual_end_date = '2026-02-03'
      WHERE title = 'Vẽ mặt bằng tầng điển hình'
        AND project_id = 1 AND status = 'completed'
        AND (actual_end_date IS NULL OR actual_end_date = date('now'))
    `).run()
    // Task 2 – "Thiết kế mặt đứng công trình"
    //   due_date=2026-02-12 → completed 2026-02-10 (ONTIME, 2 days early)
    await db.prepare(`
      UPDATE tasks SET actual_end_date = '2026-02-10'
      WHERE title = 'Thiết kế mặt đứng công trình'
        AND project_id = 1 AND status = 'completed'
        AND (actual_end_date IS NULL OR actual_end_date = date('now'))
    `).run()
    // Task 3 – "Tính toán móng cọc"
    //   due_date=2026-02-20 → completed 2026-02-28 (LATE, 8 days overdue)
    await db.prepare(`
      UPDATE tasks SET actual_end_date = '2026-02-28'
      WHERE title = 'Tính toán móng cọc'
        AND project_id = 1 AND status = 'completed'
        AND (actual_end_date IS NULL OR actual_end_date = date('now'))
    `).run()
    // Task 5 – "Khảo sát địa chất" (id 5 from earlier user sessions)
    //   due_date=2026-02-25 → completed 2026-02-25 (ONTIME, exactly on deadline)
    await db.prepare(`
      UPDATE tasks SET actual_end_date = '2026-02-25'
      WHERE title = 'Khảo sát địa chất'
        AND status = 'completed'
        AND actual_end_date IS NULL
    `).run()
    // "Khảo sát địa chất cầu" – no actual_end_date yet (still in future)
    // leave as NULL so it doesn't count as on-time/late until user completes it

    // Reset overdue flags for tasks that are no longer past due
    await db.prepare(`UPDATE tasks SET is_overdue = 0 WHERE due_date >= date('now') AND status NOT IN ('completed','review','cancelled')`).run()
    await db.prepare(`UPDATE tasks SET is_overdue = 1 WHERE due_date < date('now') AND status NOT IN ('completed','review','cancelled')`).run()

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
    // Format: [project_id, title, discipline, priority, status, assigned_to, start_date, due_date, est_hours, progress, actual_end_date|null]
    // actual_end_date rules:
    //   ĐÚNG HẠN (on-time): actual_end_date <= due_date  ✓ hoàn thành trước hoặc đúng deadline
    //   TRỄ HẠN  (late)   : actual_end_date > due_date   ✗ hoàn thành sau deadline
    const sampleTasks: [number,string,string,string,string,number,string,string,number,number,string|null][] = [
      // Project 1 – tasks with variety: ontime, late, and null (no date yet)
      [1, 'Vẽ mặt bằng tầng điển hình',       'AA', 'high',   'completed', 2, '2026-01-10', '2026-02-05', 40,  100, '2026-02-03'], // ONTIME (2 days early)
      [1, 'Thiết kế mặt đứng công trình',      'AA', 'high',   'completed', 2, '2026-01-20', '2026-02-12', 30,  100, '2026-02-10'], // ONTIME (2 days early)
      [1, 'Tính toán móng cọc',                'ES', 'urgent', 'completed', 3, '2026-02-01', '2026-02-20', 24,  100, '2026-02-28'], // LATE   (8 days overdue)
      [1, 'Thiết kế khung thép tầng 1',        'ES', 'medium', 'in_progress', 3, '2026-03-01', '2026-06-30', 20, 45, null],         // in progress
      [1, 'Hệ thống PCCC tầng hầm',            'EF', 'high',   'todo',      4, '2026-04-01', '2026-07-30', 32,   0, null],
      [1, 'Thiết kế hệ thống điện tầng 1-5',  'EE', 'medium', 'todo',      4, '2026-05-01', '2026-08-30', 24,   0, null],
      // Project 2 – mix of statuses
      [2, 'Khảo sát địa chất cầu',             'CT', 'urgent', 'completed', 2, '2026-01-15', '2026-02-28', 16,  100, '2026-02-15'], // ONTIME (13 days early)
      [2, 'Thiết kế móng trụ cầu',             'ES', 'high',   'in_progress', 3, '2026-04-01', '2026-07-15', 48, 30, null],
    ]

    for (const [pid, title, disc, priority, status, assigned, start, due, est, prog, actualEnd] of sampleTasks) {
      try {
        // Use INSERT OR IGNORE with a unique constraint check via WHERE NOT EXISTS
        const existing = await db.prepare(
          `SELECT id FROM tasks WHERE title = ? AND project_id = ? AND assigned_to = ? LIMIT 1`
        ).bind(title, pid, assigned).first()
        if (!existing) {
          await db.prepare(
            `INSERT INTO tasks (project_id, title, discipline_code, priority, status, assigned_to, assigned_by, start_date, due_date, estimated_hours, progress, actual_end_date)
             VALUES (?, ?, ?, ?, ?, ?, 4, ?, ?, ?, ?, ?)`
          ).bind(pid, title, disc, priority, status, assigned, start, due, est, prog, actualEnd).run()
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


    // Sample timesheets for PRJ001 — INSERT OR IGNORE to prevent duplicates on re-init
    // Only seed if PRJ001 has fewer than 10 timesheet records (avoid re-seeding)
    const existingPrj1Ts = await db.prepare(`SELECT COUNT(*) as cnt FROM timesheets WHERE project_id = 1`).first() as any
    if (!existingPrj1Ts || existingPrj1Ts.cnt < 10) {
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
    }

    // Sample costs & revenues - for year 2026
    // GLOBAL DEDUP: Always run after ALL timesheet inserts to clean any existing duplicates
    try {
      await db.prepare(`
        DELETE FROM timesheets
        WHERE id NOT IN (
          SELECT MAX(id) FROM timesheets GROUP BY user_id, project_id, work_date
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
    const proj1Members = [[2, 'member'], [3, 'project_leader'], [4, 'project_admin']]
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
    const proj2Members = [[2, 'member'], [3, 'project_leader'], [4, 'project_admin']]
    for (const [uid, role] of proj2Members) {
      try {
        await db.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (2, ?, ?)`).bind(uid, role).run()
      } catch (_) {}
    }

    // Timesheets for Project 2 — only seed if PRJ002 has fewer than 10 timesheet records
    const existingPrj2Ts = await db.prepare(`SELECT COUNT(*) as cnt FROM timesheets WHERE project_id = 2`).first() as any
    if (!existingPrj2Ts || existingPrj2Ts.cnt < 10) {
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
    const proj3Members = [[3, 'project_leader'], [4, 'project_admin']]
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

    // ---- MARK AS SEEDED: Set flag so demo data is never re-inserted ----
    await db.prepare(`INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('seed_data_initialized', '1', CURRENT_TIMESTAMP)`).run()

    return c.json({ success: true, message: 'Database initialized successfully' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// PRODUCTION CLEANUP ENDPOINT
// POST /api/system/cleanup-production
// Removes all test/demo data; keeps official data intact.
// Requires system_admin role + confirmation token.
// ===================================================
app.post('/api/system/cleanup-production', authMiddleware, async (c) => {
  const user = (c as any).get('user')
  if (!user || user.role !== 'system_admin') {
    return c.json({ error: 'Forbidden: system_admin role required' }, 403)
  }

  const body = await c.req.json().catch(() => ({})) as any
  // Safety gate: caller must pass { confirm: "CLEANUP_PRODUCTION_DATA" }
  if (body?.confirm !== 'CLEANUP_PRODUCTION_DATA') {
    return c.json({
      error: 'Safety check failed',
      hint: 'Send { "confirm": "CLEANUP_PRODUCTION_DATA" } in request body',
    }, 400)
  }

  const db = c.env.DB

  // --- Before counts ---
  const beforeCounts = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users)           as users,
      (SELECT COUNT(*) FROM projects)        as projects,
      (SELECT COUNT(*) FROM tasks)           as tasks,
      (SELECT COUNT(*) FROM timesheets)      as timesheets,
      (SELECT COUNT(*) FROM notifications)   as notifications,
      (SELECT COUNT(*) FROM task_history)    as task_history,
      (SELECT COUNT(*) FROM project_costs)   as project_costs,
      (SELECT COUNT(*) FROM project_revenues) as project_revenues,
      (SELECT COUNT(*) FROM categories)      as categories,
      (SELECT COUNT(*) FROM project_members) as project_members
  `).first() as any

  const steps: string[] = []

  try {
    // STEP 1 — Delete test/junk tasks (title='123', 'qqqq', or test project tasks)
    const testTaskIds = (await db.prepare(`
      SELECT id FROM tasks 
      WHERE title IN ('123', 'qqqq')
         OR (title LIKE '%123%' AND project_id IN (SELECT id FROM projects WHERE code IN ('C08','111') OR name LIKE '%123%' OR length(name) < 6))
    `).all()).results.map((r: any) => r.id)

    if (testTaskIds.length > 0) {
      await db.prepare(`DELETE FROM task_history WHERE task_id IN (${testTaskIds.map(() => '?').join(',')})`).bind(...testTaskIds).run()
      await db.prepare(`DELETE FROM tasks WHERE id IN (${testTaskIds.map(() => '?').join(',')})`).bind(...testTaskIds).run()
      steps.push(`Deleted ${testTaskIds.length} junk tasks and their history`)
    }

    // STEP 2 — Identify test projects
    const testProjects = (await db.prepare(`
      SELECT id FROM projects 
      WHERE code IN ('C08','111') 
         OR name LIKE '%123%' 
         OR name LIKE '%test%' 
         OR name LIKE '%demo%' 
         OR (length(name) < 6 AND id NOT IN (1,2,3))
    `).all()).results
    const testProjectIds = testProjects.map((r: any) => r.id)

    if (testProjectIds.length > 0) {
      const placeholder = testProjectIds.map(() => '?').join(',')
      // Cascade-delete everything related to test projects
      const orphanTasks = (await db.prepare(`SELECT id FROM tasks WHERE project_id IN (${placeholder})`).bind(...testProjectIds).all()).results.map((r: any) => r.id)
      if (orphanTasks.length > 0) {
        await db.prepare(`DELETE FROM task_history WHERE task_id IN (${orphanTasks.map(() => '?').join(',')})`).bind(...orphanTasks).run()
        await db.prepare(`DELETE FROM tasks WHERE id IN (${orphanTasks.map(() => '?').join(',')})`).bind(...orphanTasks).run()
      }
      await db.prepare(`DELETE FROM timesheets WHERE project_id IN (${placeholder})`).bind(...testProjectIds).run()
      await db.prepare(`DELETE FROM project_costs WHERE project_id IN (${placeholder})`).bind(...testProjectIds).run()
      await db.prepare(`DELETE FROM project_revenues WHERE project_id IN (${placeholder})`).bind(...testProjectIds).run()
      await db.prepare(`DELETE FROM project_members WHERE project_id IN (${placeholder})`).bind(...testProjectIds).run()
      await db.prepare(`DELETE FROM categories WHERE project_id IN (${placeholder})`).bind(...testProjectIds).run()
      await db.prepare(`DELETE FROM project_labor_costs WHERE project_id IN (${placeholder})`).bind(...testProjectIds).run()
      await db.prepare(`DELETE FROM projects WHERE id IN (${placeholder})`).bind(...testProjectIds).run()
      steps.push(`Deleted ${testProjectIds.length} test projects and all related data`)
    }

    // STEP 3 — Orphan cleanup
    await db.prepare(`DELETE FROM task_history WHERE task_id NOT IN (SELECT id FROM tasks)`).run()
    await db.prepare(`DELETE FROM timesheets WHERE user_id NOT IN (SELECT id FROM users) OR project_id NOT IN (SELECT id FROM projects)`).run()
    await db.prepare(`DELETE FROM project_costs WHERE project_id NOT IN (SELECT id FROM projects)`).run()
    await db.prepare(`DELETE FROM project_revenues WHERE project_id NOT IN (SELECT id FROM projects)`).run()
    await db.prepare(`DELETE FROM project_members WHERE project_id NOT IN (SELECT id FROM projects) OR user_id NOT IN (SELECT id FROM users)`).run()
    await db.prepare(`DELETE FROM categories WHERE project_id NOT IN (SELECT id FROM projects)`).run()
    await db.prepare(`DELETE FROM notifications WHERE user_id NOT IN (SELECT id FROM users)`).run()
    await db.prepare(`UPDATE assets SET assigned_to = NULL WHERE assigned_to IS NOT NULL AND assigned_to NOT IN (SELECT id FROM users)`).run()
    steps.push('Removed all orphan records (tasks, timesheets, costs, revenues, members, categories, notifications)')

    // STEP 4 — Clear all stale notifications (they're demo data)
    await db.prepare(`DELETE FROM notifications`).run()
    steps.push('Cleared all notifications (stale demo data)')

    // STEP 5 — Ensure default cost_types exist (5 types)
    const defaultCostTypes = [
      ['salary', 'Lương nhân sự', 'Chi phí lương và phúc lợi nhân sự', '#00A651', 1],
      ['material', 'Chi phí vật liệu', 'Vật tư, nguyên liệu thi công', '#0066CC', 2],
      ['equipment', 'Chi phí thiết bị', 'Thuê hoặc khấu hao thiết bị', '#8B5CF6', 3],
      ['transport', 'Chi phí vận chuyển', 'Di chuyển, vận chuyển hàng hóa', '#FF6B00', 4],
      ['other', 'Chi phí khác', 'Các chi phí phát sinh khác', '#6B7280', 5],
    ]
    for (const [code, name, desc, color, sort] of defaultCostTypes) {
      await db.prepare(`INSERT OR IGNORE INTO cost_types (code, name, description, color, sort_order) VALUES (?,?,?,?,?)`).bind(code, name, desc, color, sort).run()
    }
    steps.push('Verified 5 default cost types')

    // STEP 6 — Verify system admin
    const adminCheck = await db.prepare(`SELECT id FROM users WHERE username='admin' AND role='system_admin'`).first()
    if (!adminCheck) {
      return c.json({ error: 'CRITICAL: admin user missing! Rollback recommended.' }, 500)
    }
    steps.push('Verified system admin account intact')

    // --- After counts ---
    const afterCounts = await db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM users)           as users,
        (SELECT COUNT(*) FROM projects)        as projects,
        (SELECT COUNT(*) FROM tasks)           as tasks,
        (SELECT COUNT(*) FROM timesheets)      as timesheets,
        (SELECT COUNT(*) FROM notifications)   as notifications,
        (SELECT COUNT(*) FROM task_history)    as task_history,
        (SELECT COUNT(*) FROM project_costs)   as project_costs,
        (SELECT COUNT(*) FROM project_revenues) as project_revenues,
        (SELECT COUNT(*) FROM categories)      as categories,
        (SELECT COUNT(*) FROM project_members) as project_members
    `).first() as any

    return c.json({
      success: true,
      message: 'Production cleanup completed successfully',
      steps,
      before: beforeCounts,
      after: afterCounts,
      diff: {
        users:            (beforeCounts?.users           || 0) - (afterCounts?.users           || 0),
        projects:         (beforeCounts?.projects        || 0) - (afterCounts?.projects        || 0),
        tasks:            (beforeCounts?.tasks           || 0) - (afterCounts?.tasks           || 0),
        timesheets:       (beforeCounts?.timesheets      || 0) - (afterCounts?.timesheets      || 0),
        notifications:    (beforeCounts?.notifications   || 0) - (afterCounts?.notifications   || 0),
        task_history:     (beforeCounts?.task_history    || 0) - (afterCounts?.task_history    || 0),
        project_costs:    (beforeCounts?.project_costs   || 0) - (afterCounts?.project_costs   || 0),
        project_revenues: (beforeCounts?.project_revenues|| 0) - (afterCounts?.project_revenues|| 0),
        categories:       (beforeCounts?.categories      || 0) - (afterCounts?.categories      || 0),
        project_members:  (beforeCounts?.project_members || 0) - (afterCounts?.project_members || 0),
      },
    })
  } catch (e: any) {
    return c.json({ error: `Cleanup failed: ${e.message}` }, 500)
  }
})

// ===================================================
// ADVANCED ANALYTICS ROUTES
// ===================================================

// 1. Project Performance Overview (tổng quan hiệu suất tất cả dự án)
app.get('/api/analytics/project-performance', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const { year } = c.req.query()
    const y = year || new Date().getFullYear().toString()

    let projectFilter = ''
    let binds: any[] = [y, y]
    if (user.role !== 'system_admin') {
      projectFilter = 'AND p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)'
      binds.push(user.id)
    }

    const projects = await db.prepare(`
      SELECT
        p.id, p.code, p.name, p.status, p.start_date, p.end_date,
        p.budget, p.contract_value, p.progress,
        COALESCE(t_stats.total_tasks, 0)     as total_tasks,
        COALESCE(t_stats.completed_tasks, 0) as completed_tasks,
        COALESCE(t_stats.overdue_tasks, 0)   as overdue_tasks,
        COALESCE(t_stats.urgent_tasks, 0)    as urgent_tasks,
        COALESCE(ts_stats.total_hours, 0)    as total_hours,
        COALESCE(ts_stats.approved_hours, 0) as approved_hours,
        COALESCE(mem_stats.member_count, 0)  as member_count,
        COALESCE(cost_stats.total_cost, 0)   as total_cost,
        COALESCE(rev_stats.total_revenue, 0) as total_revenue
      FROM projects p
      LEFT JOIN (
        SELECT project_id,
          COUNT(*) as total_tasks,
          SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed_tasks,
          SUM(CASE WHEN is_overdue=1 AND status!='completed' THEN 1 ELSE 0 END) as overdue_tasks,
          SUM(CASE WHEN priority='urgent' AND status!='completed' THEN 1 ELSE 0 END) as urgent_tasks
        FROM tasks GROUP BY project_id
      ) t_stats ON t_stats.project_id = p.id
      LEFT JOIN (
        SELECT project_id,
          SUM(regular_hours + overtime_hours) as total_hours,
          SUM(CASE WHEN status='approved' THEN regular_hours + overtime_hours ELSE 0 END) as approved_hours
        FROM timesheets WHERE strftime('%Y', work_date) = ?
        GROUP BY project_id
      ) ts_stats ON ts_stats.project_id = p.id
      LEFT JOIN (
        SELECT project_id, COUNT(DISTINCT user_id) as member_count
        FROM project_members GROUP BY project_id
      ) mem_stats ON mem_stats.project_id = p.id
      LEFT JOIN (
        SELECT project_id, SUM(amount) as total_cost
        FROM project_costs WHERE strftime('%Y', cost_date) = ?
        GROUP BY project_id
      ) cost_stats ON cost_stats.project_id = p.id
      LEFT JOIN (
        SELECT project_id, SUM(amount) as total_revenue
        FROM project_revenues GROUP BY project_id
      ) rev_stats ON rev_stats.project_id = p.id
      WHERE 1=1 ${projectFilter}
      ORDER BY p.created_at DESC
    `).bind(...binds).all()

    return c.json({ projects: projects.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// 2. Team Productivity Deep Dive (phân tích năng suất nhân sự chi tiết)
app.get('/api/analytics/team-productivity', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const { year, month } = c.req.query()
    const y = year || new Date().getFullYear().toString()
    const dateFilter = month ? `AND strftime('%Y-%m', ts.work_date) = '${y}-${month.padStart(2,'0')}'`
                              : `AND strftime('%Y', ts.work_date) = '${y}'`

    const members = await db.prepare(`
      SELECT
        u.id, u.full_name, u.department, u.role,
        COUNT(DISTINCT ts.id) as timesheet_days,
        COALESCE(SUM(ts.regular_hours), 0) as regular_hours,
        COALESCE(SUM(ts.overtime_hours), 0) as overtime_hours,
        COALESCE(SUM(ts.regular_hours + ts.overtime_hours), 0) as total_hours,
        COALESCE(SUM(CASE WHEN ts.status='approved' THEN ts.regular_hours+ts.overtime_hours ELSE 0 END),0) as approved_hours,
        COUNT(DISTINCT t.id) as assigned_tasks,
        SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) as completed_tasks,
        SUM(CASE WHEN t.is_overdue=1 AND t.status!='completed' THEN 1 ELSE 0 END) as overdue_tasks,
        COUNT(DISTINCT pm.project_id) as active_projects
      FROM users u
      LEFT JOIN timesheets ts ON ts.user_id = u.id ${dateFilter}
      LEFT JOIN tasks t ON t.assigned_to = u.id
      LEFT JOIN project_members pm ON pm.user_id = u.id
      WHERE u.is_active = 1
      GROUP BY u.id
      ORDER BY total_hours DESC
    `).all()

    // Monthly trend for each member
    const trend = await db.prepare(`
      SELECT
        u.id as user_id, u.full_name,
        strftime('%m', ts.work_date) as month,
        SUM(ts.regular_hours + ts.overtime_hours) as hours,
        COUNT(DISTINCT ts.work_date) as days
      FROM users u
      JOIN timesheets ts ON ts.user_id = u.id
      WHERE strftime('%Y', ts.work_date) = ? AND u.is_active = 1
      GROUP BY u.id, strftime('%m', ts.work_date)
      ORDER BY u.id, month
    `).bind(y).all()

    return c.json({ members: members.results, trend: trend.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// 3. Task Analytics (phân tích công việc theo discipline, priority, trạng thái)
app.get('/api/analytics/task-analytics', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const { year, project_id } = c.req.query()
    const y = year || new Date().getFullYear().toString()

    let projectFilter = ''
    let binds: any[] = []
    if (project_id) {
      projectFilter = 'AND t.project_id = ?'
      binds.push(project_id)
    } else if (user.role !== 'system_admin') {
      projectFilter = 'AND t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)'
      binds.push(user.id)
    }

    const byStatus = await db.prepare(`
      SELECT status, COUNT(*) as count FROM tasks t WHERE 1=1 ${projectFilter} GROUP BY status
    `).bind(...binds).all()

    const byPriority = await db.prepare(`
      SELECT priority, COUNT(*) as count FROM tasks t WHERE 1=1 ${projectFilter} GROUP BY priority
    `).bind(...binds).all()

    const byDiscipline = await db.prepare(`
      SELECT discipline_code, COUNT(*) as count,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN is_overdue=1 AND status!='completed' THEN 1 ELSE 0 END) as overdue
      FROM tasks t WHERE discipline_code IS NOT NULL AND discipline_code != '' ${projectFilter}
      GROUP BY discipline_code ORDER BY count DESC
    `).bind(...binds).all()

    const byPhase = await db.prepare(`
      SELECT phase, COUNT(*) as count,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
      FROM tasks t WHERE 1=1 ${projectFilter} GROUP BY phase
    `).bind(...binds).all()

    // Monthly completion trend
    const completionTrend = await db.prepare(`
      SELECT strftime('%m', updated_at) as month,
        COUNT(*) as total,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
      FROM tasks t
      WHERE strftime('%Y', created_at) = ? ${projectFilter}
      GROUP BY strftime('%m', updated_at)
      ORDER BY month
    `).bind(y, ...binds).all()

    // Avg completion time
    const avgTime = await db.prepare(`
      SELECT
        AVG(CAST((julianday(actual_end_date) - julianday(start_date)) AS REAL)) as avg_days,
        priority,
        COUNT(*) as count
      FROM tasks t
      WHERE status='completed' AND actual_end_date IS NOT NULL AND start_date IS NOT NULL ${projectFilter}
      GROUP BY priority
    `).bind(...binds).all()

    return c.json({
      byStatus: byStatus.results,
      byPriority: byPriority.results,
      byDiscipline: byDiscipline.results,
      byPhase: byPhase.results,
      completionTrend: completionTrend.results,
      avgCompletionTime: avgTime.results
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// 4. Financial Analytics (phân tích tài chính tổng hợp)
// ⚠️ ĐỒNG BỘ với /api/dashboard/cost-summary:
//   - Dùng NTC date range thay vì năm lịch
//   - Tính đủ: project_costs + labor costs + shared costs
//   - Doanh thu chỉ tính paid/partial (đã thu)
app.get('/api/analytics/financial', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const OVERTIME_FACTOR = await getOvertimeFactor(db)
    const fySettings = await getFiscalYearSettings(db)
    const { year } = c.req.query()
    const fyYear = year ? parseInt(year) : new Date().getFullYear()
    const y = String(fyYear)
    const { startDate: fyStart, endDate: fyEnd } = getFiscalYearDateRange(fyYear, fySettings)

    // ── 1. KPI: Doanh thu chỉ tính paid/partial (đồng bộ với cost-summary)
    const rawRevenue = await db.prepare(`
      SELECT strftime('%Y-%m', revenue_date) as month,
        SUM(CASE WHEN payment_status IN ('paid','partial') THEN amount ELSE 0 END) as revenue,
        SUM(amount) as total_amount
      FROM project_revenues
      WHERE revenue_date >= ? AND revenue_date <= ?
      GROUP BY strftime('%Y-%m', revenue_date)
    `).bind(fyStart, fyEnd).all()

    // ── 2. Chi phí trực tiếp (non-salary) trong NTC
    const rawDirectCost = await db.prepare(`
      SELECT strftime('%Y-%m', cost_date) as month, SUM(amount) as cost
      FROM project_costs
      WHERE cost_date >= ? AND cost_date <= ? AND cost_type != 'salary'
      GROUP BY strftime('%Y-%m', cost_date)
    `).bind(fyStart, fyEnd).all()

    // ── 3. Labor costs trong NTC (ưu tiên project_labor_costs)
    const fyEnd1Year = fySettings.start_month === 1 ? fyYear : fyYear + 1
    let laborWhereSimple: string
    let laborParams: any[]
    if (fySettings.start_month === 1) {
      laborWhereSimple = `year = ?`
      laborParams = [fyYear]
    } else {
      laborWhereSimple = `((year = ? AND month >= ?) OR (year = ? AND month < ?))`
      laborParams = [fyYear, fySettings.start_month, fyEnd1Year, fySettings.start_month]
    }

    const plcMonthly = await db.prepare(`
      SELECT PRINTF('%d-%02d', year, month) as month,
        SUM(total_labor_cost) as labor_cost
      FROM project_labor_costs WHERE ${laborWhereSimple}
      GROUP BY month ORDER BY month
    `).bind(...laborParams).all()

    // Fallback: monthly_labor_costs nếu project_labor_costs trống
    let laborMonthly = plcMonthly.results as any[]
    if (!laborMonthly.length) {
      const mlc = await db.prepare(`
        SELECT PRINTF('%d-%02d', year, month) as month,
          total_labor_cost as labor_cost
        FROM monthly_labor_costs WHERE ${laborWhereSimple}
        ORDER BY month
      `).bind(...laborParams).all()
      laborMonthly = mlc.results as any[]
    }

    // ── 4. Shared costs trong NTC
    const sharedRows = await db.prepare(`
      SELECT strftime('%Y-%m', cost_date) as month, SUM(amount) as shared_cost
      FROM shared_costs
      WHERE cost_date >= ? AND cost_date <= ?
      GROUP BY strftime('%Y-%m', cost_date)
    `).bind(fyStart, fyEnd).all()

    // ── 5. Build monthly map (12 tháng NTC)
    const revMap: Record<string, number> = {}
    ;(rawRevenue.results as any[]).forEach((r: any) => { revMap[r.month] = r.revenue || 0 })
    const directCostMap: Record<string, number> = {}
    ;(rawDirectCost.results as any[]).forEach((r: any) => { directCostMap[r.month] = r.cost || 0 })
    const laborMap: Record<string, number> = {}
    laborMonthly.forEach((r: any) => { laborMap[r.month] = r.labor_cost || 0 })
    const sharedMap: Record<string, number> = {}
    ;(sharedRows.results as any[]).forEach((r: any) => { sharedMap[r.month] = r.shared_cost || 0 })

    // Build 12-month array theo NTC
    const sm = fySettings.start_month
    const monthlyRevCostResults = Array.from({length: 12}, (_, i) => {
      const lm = ((sm - 1 + i) % 12) + 1
      const { calYear, calMonth } = fiscalMonthToCalendar(lm, fyYear, fySettings)
      const mkey = `${calYear}-${String(calMonth).padStart(2,'0')}`
      const revenue = revMap[mkey] || 0
      const directCost = directCostMap[mkey] || 0
      const laborCost = laborMap[mkey] || 0
      const sharedCost = sharedMap[mkey] || 0
      const cost = directCost + laborCost + sharedCost
      return {
        month: `T${lm}`,             // Tháng NTC (T1..T12)
        month_key: mkey,              // YYYY-MM thực tế
        revenue, directCost, laborCost, sharedCost, cost,
        profit: revenue - cost
      }
    })

    // ── 6. KPI tổng hợp (đồng bộ với cost-summary)
    const totalRevenue = (rawRevenue.results as any[]).reduce((s: number, r: any) => s + (r.revenue || 0), 0)
    const totalDirectCost = (rawDirectCost.results as any[]).reduce((s: number, r: any) => s + (r.cost || 0), 0)
    const totalLaborCost = laborMonthly.reduce((s: number, r: any) => s + (r.labor_cost || 0), 0)
    const totalSharedCost = (sharedRows.results as any[]).reduce((s: number, r: any) => s + (r.shared_cost || 0), 0)
    const totalCost = totalDirectCost + totalLaborCost + totalSharedCost

    // ── 7. Cost breakdown by type (trong NTC, gộp cả labor & shared)
    const costByTypeRaw = await db.prepare(`
      SELECT cost_type, SUM(amount) as total, COUNT(*) as count
      FROM project_costs
      WHERE cost_date >= ? AND cost_date <= ? AND cost_type != 'salary'
      GROUP BY cost_type ORDER BY total DESC
    `).bind(fyStart, fyEnd).all()

    const costByType: any[] = [...(costByTypeRaw.results as any[])]
    if (totalLaborCost > 0) costByType.push({ cost_type: 'salary', total: totalLaborCost, count: 0 })
    if (totalSharedCost > 0) costByType.push({ cost_type: 'shared', total: totalSharedCost, count: 0 })

    // ── 8. Top projects by revenue (trong NTC)
    const topProjectsByRevenue = await db.prepare(`
      SELECT p.code, p.name,
        COALESCE(SUM(CASE WHEN pr.payment_status IN ('paid','partial') THEN pr.amount ELSE 0 END), 0) as revenue,
        COALESCE(SUM(pc.amount), 0) as cost,
        COALESCE(SUM(CASE WHEN pr.payment_status IN ('paid','partial') THEN pr.amount ELSE 0 END), 0)
          - COALESCE(SUM(pc.amount), 0) as profit
      FROM projects p
      LEFT JOIN project_revenues pr ON pr.project_id = p.id
        AND pr.revenue_date >= ? AND pr.revenue_date <= ?
      LEFT JOIN project_costs pc ON pc.project_id = p.id
        AND pc.cost_date >= ? AND pc.cost_date <= ?
      WHERE p.status != 'cancelled'
      GROUP BY p.id HAVING revenue > 0 OR cost > 0
      ORDER BY revenue DESC LIMIT 10
    `).bind(fyStart, fyEnd, fyStart, fyEnd).all()

    // ── 9. Revenue by payment status (trong NTC)
    const revenueByStatus = await db.prepare(`
      SELECT payment_status, SUM(amount) as total, COUNT(*) as count
      FROM project_revenues WHERE revenue_date >= ? AND revenue_date <= ?
      GROUP BY payment_status
    `).bind(fyStart, fyEnd).all()

    // ── 10. Active / completed projects
    const activeProjects = await db.prepare(`SELECT COUNT(*) as cnt FROM projects WHERE status='active'`).first() as any
    const completedProjects = await db.prepare(`
      SELECT COUNT(*) as cnt FROM projects WHERE status='completed' AND end_date >= ? AND end_date <= ?
    `).bind(fyStart, fyEnd).first() as any

    const kpi = {
      total_revenue: totalRevenue,
      total_cost: totalCost,
      total_direct_cost: totalDirectCost,
      total_labor_cost: totalLaborCost,
      total_shared_cost: totalSharedCost,
      active_projects: activeProjects?.cnt || 0,
      completed_projects: completedProjects?.cnt || 0,
      fiscal_year: fyYear,
      fiscal_year_label: getFiscalYearLabel(fyYear, fySettings),
      fiscal_year_start: fyStart,
      fiscal_year_end: fyEnd
    }

    return c.json({
      monthlyRevCost: monthlyRevCostResults,
      costByType,
      topProjectsByRevenue: topProjectsByRevenue.results,
      revenueByStatus: revenueByStatus.results,
      kpi
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── Analytics: Financial By Project (per-project breakdown) ──────────
// GET /api/analytics/financial-by-project?year=YYYY
// Trả về tài chính chi tiết cho tất cả dự án: GTHĐ, doanh thu, chi phí, lợi nhuận
app.get('/api/analytics/financial-by-project', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const fySettings = await getFiscalYearSettings(db)
    const { year } = c.req.query()
    const fyYear = year ? parseInt(year) : new Date().getFullYear()
    const { startDate: fyStart, endDate: fyEnd } = getFiscalYearDateRange(fyYear, fySettings)
    const fyLabel = getFiscalYearLabel(fyYear, fySettings)

    // ── 1. Tất cả dự án (kể cả chưa có doanh thu/chi phí)
    const projects = await db.prepare(`
      SELECT id, code, name, status, project_type, contract_value, start_date, end_date, progress
      FROM projects WHERE status != 'cancelled'
      ORDER BY name ASC
    `).all()

    // ── 2. Doanh thu theo dự án (trong NTC)
    const revRows = await db.prepare(`
      SELECT project_id,
        SUM(CASE WHEN payment_status IN ('paid','partial') THEN amount ELSE 0 END) as revenue_collected,
        SUM(CASE WHEN payment_status = 'paid' THEN amount ELSE 0 END) as revenue_paid,
        SUM(CASE WHEN payment_status = 'partial' THEN amount ELSE 0 END) as revenue_partial,
        SUM(CASE WHEN payment_status = 'pending' THEN amount ELSE 0 END) as revenue_pending,
        SUM(amount) as revenue_total
      FROM project_revenues
      WHERE revenue_date >= ? AND revenue_date <= ?
      GROUP BY project_id
    `).bind(fyStart, fyEnd).all()

    // ── 3. Chi phí trực tiếp theo dự án (non-salary, trong NTC)
    const directCostRows = await db.prepare(`
      SELECT project_id,
        SUM(amount) as direct_cost,
        SUM(CASE WHEN cost_type='equipment' THEN amount ELSE 0 END) as cost_equipment,
        SUM(CASE WHEN cost_type='material' THEN amount ELSE 0 END) as cost_material,
        SUM(CASE WHEN cost_type='travel' THEN amount ELSE 0 END) as cost_travel,
        SUM(CASE WHEN cost_type='office' THEN amount ELSE 0 END) as cost_office,
        SUM(CASE WHEN cost_type='other' THEN amount ELSE 0 END) as cost_other
      FROM project_costs
      WHERE cost_date >= ? AND cost_date <= ? AND cost_type != 'salary'
      GROUP BY project_id
    `).bind(fyStart, fyEnd).all()

    // ── 4. Chi phí lương theo dự án (project_labor_costs trong NTC, fallback realtime)
    const fySettings2 = fySettings
    const fyEnd1Year = fySettings2.start_month === 1 ? fyYear : fyYear + 1
    let laborWhere: string
    let laborParams: any[]
    if (fySettings2.start_month === 1) {
      laborWhere = `year = ?`
      laborParams = [fyYear]
    } else {
      laborWhere = `((year = ? AND month >= ?) OR (year = ? AND month < ?))`
      laborParams = [fyYear, fySettings2.start_month, fyEnd1Year, fySettings2.start_month]
    }
    const laborCostRows = await db.prepare(`
      SELECT project_id, SUM(total_labor_cost) as labor_cost, SUM(total_hours) as labor_hours
      FROM project_labor_costs WHERE ${laborWhere}
      GROUP BY project_id
    `).bind(...laborParams).all()

    // Fallback: nếu project_labor_costs trống → tính realtime từ timesheets + monthly_labor_costs
    const OVERTIME_FACTOR_FIN = await getOvertimeFactor(db)
    let laborMap: Record<number, any>
    if ((laborCostRows.results as any[]).length > 0) {
      laborMap = {}
      ;(laborCostRows.results as any[]).forEach((r: any) => { laborMap[r.project_id] = r })
    } else {
      const rtMap = await computeRealtimeLaborByProject(db, OVERTIME_FACTOR_FIN, fyStart, fyEnd)
      laborMap = {}
      rtMap.forEach((v, pid) => { laborMap[pid] = { labor_cost: v.labor_cost, labor_hours: v.labor_hours } })
    }
    const sharedAllocRows = await db.prepare(`
      SELECT sca.project_id, SUM(sca.allocated_amount) as shared_cost
      FROM shared_cost_allocations sca
      JOIN shared_costs sc ON sc.id = sca.shared_cost_id
      WHERE sc.cost_date >= ? AND sc.cost_date <= ?
      GROUP BY sca.project_id
    `).bind(fyStart, fyEnd).all()

    // ── 6. Build maps
    const revMap: Record<number, any> = {}
    ;(revRows.results as any[]).forEach((r: any) => { revMap[r.project_id] = r })
    const directMap: Record<number, any> = {}
    ;(directCostRows.results as any[]).forEach((r: any) => { directMap[r.project_id] = r })
    // laborMap already built above (from cache or realtime)
    const sharedMap: Record<number, any> = {}
    ;(sharedAllocRows.results as any[]).forEach((r: any) => { sharedMap[r.project_id] = r })

    // ── 7. Tổng hợp từng dự án
    const projectData = (projects.results as any[]).map((p: any) => {
      const rev    = revMap[p.id] || {}
      const direct = directMap[p.id] || {}
      const labor  = laborMap[p.id] || {}
      const shared = sharedMap[p.id] || {}

      const contractValue    = p.contract_value || 0
      const revenueCollected = rev.revenue_collected || 0
      const revenuePaid      = rev.revenue_paid || 0
      const revenuePartial   = rev.revenue_partial || 0
      const revenuePending   = rev.revenue_pending || 0
      const revenueTotal     = rev.revenue_total || 0  // tất cả trạng thái
      const directCost       = direct.direct_cost || 0
      const laborCost        = labor.labor_cost || 0
      const laborHours       = labor.labor_hours || 0
      const sharedCost       = shared.shared_cost || 0
      const totalCost        = directCost + laborCost + sharedCost
      const profit           = revenueCollected - totalCost
      const margin           = revenueCollected > 0 ? Math.round((profit / revenueCollected) * 100 * 10) / 10 : 0
      // Tỷ lệ doanh thu đã thu / GTHĐ
      const contractProgress = contractValue > 0 ? Math.round((revenueTotal / contractValue) * 100 * 10) / 10 : 0
      // Tỷ lệ % từng khoản trên doanh thu đã thu (để thể hiện cơ cấu chi phí)
      const pctDirect = revenueCollected > 0 ? Math.round((directCost / revenueCollected) * 100 * 10) / 10 : 0
      const pctLabor  = revenueCollected > 0 ? Math.round((laborCost / revenueCollected) * 100 * 10) / 10 : 0
      const pctShared = revenueCollected > 0 ? Math.round((sharedCost / revenueCollected) * 100 * 10) / 10 : 0
      const pctCost   = revenueCollected > 0 ? Math.round((totalCost / revenueCollected) * 100 * 10) / 10 : 0

      return {
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        project_type: p.project_type,
        progress: p.progress || 0,
        contract_value: contractValue,
        revenue_collected: revenueCollected,
        revenue_paid: revenuePaid,
        revenue_partial: revenuePartial,
        revenue_pending: revenuePending,
        revenue_total: revenueTotal,
        direct_cost: directCost,
        labor_cost: laborCost,
        labor_hours: laborHours,
        shared_cost: sharedCost,
        total_cost: totalCost,
        profit,
        margin,
        contract_progress: contractProgress,
        pct_direct: pctDirect,
        pct_labor: pctLabor,
        pct_shared: pctShared,
        pct_cost: pctCost,
        cost_equipment: direct.cost_equipment || 0,
        cost_material: direct.cost_material || 0,
        cost_travel: direct.cost_travel || 0,
        cost_office: direct.cost_office || 0,
        cost_other: direct.cost_other || 0,
      }
    })

    // ── 8. KPI tổng
    const totals = projectData.reduce((acc: any, p: any) => {
      acc.contract_value    += p.contract_value
      acc.revenue_collected += p.revenue_collected
      acc.revenue_pending   += p.revenue_pending
      acc.revenue_total     += p.revenue_total
      acc.direct_cost       += p.direct_cost
      acc.labor_cost        += p.labor_cost
      acc.shared_cost       += p.shared_cost
      acc.total_cost        += p.total_cost
      acc.profit            += p.profit
      return acc
    }, { contract_value:0, revenue_collected:0, revenue_pending:0, revenue_total:0,
         direct_cost:0, labor_cost:0, shared_cost:0, total_cost:0, profit:0 })

    totals.margin = totals.revenue_collected > 0
      ? Math.round((totals.profit / totals.revenue_collected) * 100 * 10) / 10 : 0
    totals.contract_progress = totals.contract_value > 0
      ? Math.round((totals.revenue_total / totals.contract_value) * 100 * 10) / 10 : 0
    totals.pct_cost = totals.revenue_collected > 0
      ? Math.round((totals.total_cost / totals.revenue_collected) * 100 * 10) / 10 : 0
    totals.pct_direct = totals.revenue_collected > 0
      ? Math.round((totals.direct_cost / totals.revenue_collected) * 100 * 10) / 10 : 0
    totals.pct_labor = totals.revenue_collected > 0
      ? Math.round((totals.labor_cost / totals.revenue_collected) * 100 * 10) / 10 : 0
    totals.pct_shared = totals.revenue_collected > 0
      ? Math.round((totals.shared_cost / totals.revenue_collected) * 100 * 10) / 10 : 0

    return c.json({
      projects: projectData,
      totals,
      fiscal_year: fyYear,
      fiscal_year_label: fyLabel,
      fiscal_year_start: fyStart,
      fiscal_year_end: fyEnd,
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /api/analytics/financial-by-project-lifetime
// Tài chính toàn vòng đời dự án (không lọc theo năm tài chính – lấy toàn bộ từ start_date đến end_date)
app.get('/api/analytics/financial-by-project-lifetime', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB

    // ── 1. Tất cả dự án (kể cả chưa có doanh thu/chi phí)
    const projects = await db.prepare(`
      SELECT id, code, name, status, project_type, contract_value, start_date, end_date, progress
      FROM projects WHERE status != 'cancelled'
      ORDER BY name ASC
    `).all()

    // ── 2. Doanh thu theo dự án (TOÀN BỘ – không lọc ngày)
    const revRows = await db.prepare(`
      SELECT project_id,
        SUM(CASE WHEN payment_status IN ('paid','partial') THEN amount ELSE 0 END) as revenue_collected,
        SUM(CASE WHEN payment_status = 'paid' THEN amount ELSE 0 END) as revenue_paid,
        SUM(CASE WHEN payment_status = 'partial' THEN amount ELSE 0 END) as revenue_partial,
        SUM(CASE WHEN payment_status = 'pending' THEN amount ELSE 0 END) as revenue_pending,
        SUM(amount) as revenue_total,
        MIN(revenue_date) as first_revenue_date,
        MAX(revenue_date) as last_revenue_date
      FROM project_revenues
      GROUP BY project_id
    `).all()

    // ── 3. Chi phí trực tiếp theo dự án (TOÀN BỘ – không lọc ngày)
    const directCostRows = await db.prepare(`
      SELECT project_id,
        SUM(amount) as direct_cost,
        SUM(CASE WHEN cost_type='equipment' THEN amount ELSE 0 END) as cost_equipment,
        SUM(CASE WHEN cost_type='material'  THEN amount ELSE 0 END) as cost_material,
        SUM(CASE WHEN cost_type='travel'    THEN amount ELSE 0 END) as cost_travel,
        SUM(CASE WHEN cost_type='office'    THEN amount ELSE 0 END) as cost_office,
        SUM(CASE WHEN cost_type='other'     THEN amount ELSE 0 END) as cost_other
      FROM project_costs
      WHERE cost_type != 'salary'
      GROUP BY project_id
    `).all()

    // ── 4. Chi phí lương theo dự án (TOÀN BỘ: project_labor_costs, fallback realtime)
    const laborCostRowsLT = await db.prepare(`
      SELECT project_id,
        SUM(total_labor_cost) as labor_cost,
        SUM(total_hours) as labor_hours
      FROM project_labor_costs
      GROUP BY project_id
    `).all()

    const OVERTIME_FACTOR_LT = await getOvertimeFactor(db)
    let laborMapLT: Record<number, any>
    if ((laborCostRowsLT.results as any[]).length > 0) {
      laborMapLT = {}
      ;(laborCostRowsLT.results as any[]).forEach((r: any) => { laborMapLT[r.project_id] = r })
    } else {
      // Fallback: tính realtime toàn bộ lịch sử (không lọc ngày)
      const rtMap = await computeRealtimeLaborByProject(db, OVERTIME_FACTOR_LT)
      laborMapLT = {}
      rtMap.forEach((v, pid) => { laborMapLT[pid] = { labor_cost: v.labor_cost, labor_hours: v.labor_hours } })
    }

    // ── 5. Chi phí chung phân bổ (TOÀN BỘ)
    const sharedAllocRows = await db.prepare(`
      SELECT sca.project_id, SUM(sca.allocated_amount) as shared_cost
      FROM shared_cost_allocations sca
      GROUP BY sca.project_id
    `).all()

    // ── 6. Build maps
    const revMap: Record<number, any> = {}
    ;(revRows.results as any[]).forEach((r: any) => { revMap[r.project_id] = r })
    const directMap: Record<number, any> = {}
    ;(directCostRows.results as any[]).forEach((r: any) => { directMap[r.project_id] = r })
    const laborMap = laborMapLT  // alias
    const sharedMap: Record<number, any> = {}
    ;(sharedAllocRows.results as any[]).forEach((r: any) => { sharedMap[r.project_id] = r })

    // ── 7. Tổng hợp từng dự án
    const projectData = (projects.results as any[]).map((p: any) => {
      const rev    = revMap[p.id]    || {}
      const direct = directMap[p.id] || {}
      const labor  = laborMap[p.id]  || {}
      const shared = sharedMap[p.id] || {}

      const contractValue    = p.contract_value || 0
      const revenueCollected = rev.revenue_collected || 0
      const revenuePaid      = rev.revenue_paid      || 0
      const revenuePartial   = rev.revenue_partial   || 0
      const revenuePending   = rev.revenue_pending   || 0
      const revenueTotal     = rev.revenue_total     || 0
      const directCost       = direct.direct_cost    || 0
      const laborCost        = labor.labor_cost       || 0
      const laborHours       = labor.labor_hours      || 0
      const sharedCost       = shared.shared_cost     || 0
      const totalCost        = directCost + laborCost + sharedCost
      const profit           = revenueCollected - totalCost
      const margin           = revenueCollected > 0 ? Math.round((profit / revenueCollected) * 100 * 10) / 10 : 0
      const contractProgress = contractValue > 0 ? Math.round((revenueTotal / contractValue) * 100 * 10) / 10 : 0
      const pctDirect = revenueCollected > 0 ? Math.round((directCost / revenueCollected) * 100 * 10) / 10 : 0
      const pctLabor  = revenueCollected > 0 ? Math.round((laborCost  / revenueCollected) * 100 * 10) / 10 : 0
      const pctShared = revenueCollected > 0 ? Math.round((sharedCost / revenueCollected) * 100 * 10) / 10 : 0
      const pctCost   = revenueCollected > 0 ? Math.round((totalCost  / revenueCollected) * 100 * 10) / 10 : 0

      // Tính thời gian dự án
      const startDate = p.start_date || ''
      const endDate   = p.end_date   || ''

      return {
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        project_type: p.project_type,
        progress: p.progress || 0,
        start_date: startDate,
        end_date: endDate,
        contract_value: contractValue,
        revenue_collected: revenueCollected,
        revenue_paid: revenuePaid,
        revenue_partial: revenuePartial,
        revenue_pending: revenuePending,
        revenue_total: revenueTotal,
        direct_cost: directCost,
        labor_cost: laborCost,
        labor_hours: laborHours,
        shared_cost: sharedCost,
        total_cost: totalCost,
        profit,
        margin,
        contract_progress: contractProgress,
        pct_direct: pctDirect,
        pct_labor:  pctLabor,
        pct_shared: pctShared,
        pct_cost:   pctCost,
        cost_equipment: direct.cost_equipment || 0,
        cost_material:  direct.cost_material  || 0,
        cost_travel:    direct.cost_travel    || 0,
        cost_office:    direct.cost_office    || 0,
        cost_other:     direct.cost_other     || 0,
      }
    })

    // ── 8. KPI tổng
    const totals = projectData.reduce((acc: any, p: any) => {
      acc.contract_value    += p.contract_value
      acc.revenue_collected += p.revenue_collected
      acc.revenue_pending   += p.revenue_pending
      acc.revenue_total     += p.revenue_total
      acc.direct_cost       += p.direct_cost
      acc.labor_cost        += p.labor_cost
      acc.shared_cost       += p.shared_cost
      acc.total_cost        += p.total_cost
      acc.profit            += p.profit
      return acc
    }, { contract_value:0, revenue_collected:0, revenue_pending:0, revenue_total:0,
         direct_cost:0, labor_cost:0, shared_cost:0, total_cost:0, profit:0 })

    totals.margin = totals.revenue_collected > 0
      ? Math.round((totals.profit / totals.revenue_collected) * 100 * 10) / 10 : 0
    totals.contract_progress = totals.contract_value > 0
      ? Math.round((totals.revenue_total / totals.contract_value) * 100 * 10) / 10 : 0
    totals.pct_cost   = totals.revenue_collected > 0 ? Math.round((totals.total_cost  / totals.revenue_collected) * 100 * 10) / 10 : 0
    totals.pct_direct = totals.revenue_collected > 0 ? Math.round((totals.direct_cost / totals.revenue_collected) * 100 * 10) / 10 : 0
    totals.pct_labor  = totals.revenue_collected > 0 ? Math.round((totals.labor_cost  / totals.revenue_collected) * 100 * 10) / 10 : 0
    totals.pct_shared = totals.revenue_collected > 0 ? Math.round((totals.shared_cost / totals.revenue_collected) * 100 * 10) / 10 : 0

    return c.json({
      projects: projectData,
      totals,
      mode: 'lifetime',
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// 5. Timesheet Analytics (phân tích chấm công tổng hợp)
app.get('/api/analytics/timesheet', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any
    const { year } = c.req.query()
    const y = year || new Date().getFullYear().toString()

    // Hours by month & status
    const monthlyHours = await db.prepare(`
      SELECT strftime('%m', work_date) as month,
        SUM(regular_hours) as regular,
        SUM(overtime_hours) as overtime,
        COUNT(DISTINCT user_id) as active_users,
        SUM(CASE WHEN status='approved' THEN regular_hours+overtime_hours ELSE 0 END) as approved_hours
      FROM timesheets
      WHERE strftime('%Y', work_date) = ?
      GROUP BY strftime('%m', work_date) ORDER BY month
    `).bind(y).all()

    // By department
    const byDepartment = await db.prepare(`
      SELECT u.department,
        SUM(ts.regular_hours + ts.overtime_hours) as total_hours,
        COUNT(DISTINCT ts.user_id) as members,
        AVG(ts.regular_hours + ts.overtime_hours) as avg_hours_per_day
      FROM timesheets ts JOIN users u ON u.id = ts.user_id
      WHERE strftime('%Y', ts.work_date) = ? AND u.is_active = 1
      GROUP BY u.department ORDER BY total_hours DESC
    `).bind(y).all()

    // Status distribution
    const byStatus = await db.prepare(`
      SELECT status, COUNT(*) as count,
        SUM(regular_hours + overtime_hours) as hours
      FROM timesheets WHERE strftime('%Y', work_date) = ?
      GROUP BY status
    `).bind(y).all()

    // Top workers by hours
    const topWorkers = await db.prepare(`
      SELECT u.full_name, u.department,
        SUM(ts.regular_hours + ts.overtime_hours) as total_hours,
        SUM(ts.overtime_hours) as overtime_hours,
        COUNT(DISTINCT ts.work_date) as days_worked,
        COUNT(DISTINCT ts.project_id) as projects
      FROM timesheets ts JOIN users u ON u.id = ts.user_id
      WHERE strftime('%Y', ts.work_date) = ? AND u.is_active = 1
      GROUP BY ts.user_id ORDER BY total_hours DESC LIMIT 10
    `).bind(y).all()

    // ── Task hours: actual (từ timesheet) vs planned (estimated_hours trong task) ──
    // Chỉ lấy task có ít nhất 1 timesheet ghi nhận trong năm này
    const taskHoursVsPlan = await db.prepare(`
      SELECT
        t.id                                                        AS task_id,
        t.title                                                     AS task_title,
        t.discipline_code,
        t.status                                                    AS task_status,
        t.priority,
        t.estimated_hours                                           AS planned_hours,
        t.actual_hours                                              AS logged_actual_hours,
        p.code                                                      AS project_code,
        p.name                                                      AS project_name,
        COALESCE(u.full_name, '—')                                  AS assignee,
        SUM(ts.regular_hours + ts.overtime_hours)                  AS ts_actual_hours,
        COUNT(DISTINCT ts.work_date)                               AS days_logged,
        COUNT(DISTINCT ts.user_id)                                 AS members_logged,
        ROUND(
          CASE WHEN t.estimated_hours > 0
            THEN SUM(ts.regular_hours + ts.overtime_hours) * 100.0 / t.estimated_hours
            ELSE NULL
          END, 1
        )                                                           AS pct_used
      FROM timesheets ts
      JOIN tasks t     ON t.id = ts.task_id
      JOIN projects p  ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE strftime('%Y', ts.work_date) = ?
        AND ts.task_id IS NOT NULL
      GROUP BY t.id
      ORDER BY ts_actual_hours DESC
      LIMIT 50
    `).bind(y).all()

    // ── Tổng hợp by project: actual vs planned ──
    const projectHoursVsPlan = await db.prepare(`
      SELECT
        p.id          AS project_id,
        p.code        AS project_code,
        p.name        AS project_name,
        SUM(DISTINCT t.estimated_hours)                            AS total_planned_hours,
        SUM(ts.regular_hours + ts.overtime_hours)                  AS total_actual_hours,
        COUNT(DISTINCT ts.task_id)                                 AS tasks_with_hours,
        COUNT(DISTINCT t.id)                                       AS total_tasks_in_project
      FROM timesheets ts
      JOIN projects p ON p.id = ts.project_id
      LEFT JOIN tasks t ON t.project_id = p.id AND t.id = ts.task_id
      WHERE strftime('%Y', ts.work_date) = ?
      GROUP BY p.id
      ORDER BY total_actual_hours DESC
    `).bind(y).all()

    return c.json({
      monthlyHours: monthlyHours.results,
      byDepartment: byDepartment.results,
      byStatus: byStatus.results,
      topWorkers: topWorkers.results,
      taskHoursVsPlan: taskHoursVsPlan.results,
      projectHoursVsPlan: projectHoursVsPlan.results
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// 6. Project Health Score (điểm sức khỏe dự án)
app.get('/api/analytics/project-health', authMiddleware, adminOnly, async (c) => {
  try {
    const db = c.env.DB
    const user = c.get('user') as any

    let projectFilter = ''
    let binds: any[] = []
    if (user.role !== 'system_admin') {
      projectFilter = 'AND p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)'
      binds.push(user.id)
    }

    const projects = await db.prepare(`
      SELECT
        p.id, p.code, p.name, p.status, p.progress,
        p.start_date, p.end_date, p.budget, p.contract_value,
        COALESCE(t_stats.total_tasks, 0)    as total_tasks,
        COALESCE(t_stats.done_tasks, 0)     as done_tasks,
        COALESCE(t_stats.overdue_tasks, 0)  as overdue_tasks,
        COALESCE(t_stats.urgent_pending, 0) as urgent_pending,
        COALESCE(cost_stats.total_cost, 0)  as total_cost,
        COALESCE(rev_stats.total_revenue, 0) as total_revenue,
        COALESCE(mem_stats.team_size, 0)    as team_size
      FROM projects p
      LEFT JOIN (
        SELECT project_id,
          COUNT(*) as total_tasks,
          SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as done_tasks,
          SUM(CASE WHEN is_overdue=1 AND status!='completed' THEN 1 ELSE 0 END) as overdue_tasks,
          SUM(CASE WHEN priority='urgent' AND status!='completed' THEN 1 ELSE 0 END) as urgent_pending
        FROM tasks GROUP BY project_id
      ) t_stats ON t_stats.project_id = p.id
      LEFT JOIN (
        SELECT project_id, SUM(amount) as total_cost
        FROM project_costs GROUP BY project_id
      ) cost_stats ON cost_stats.project_id = p.id
      LEFT JOIN (
        SELECT project_id, SUM(amount) as total_revenue
        FROM project_revenues GROUP BY project_id
      ) rev_stats ON rev_stats.project_id = p.id
      LEFT JOIN (
        SELECT project_id, COUNT(DISTINCT user_id) as team_size
        FROM project_members GROUP BY project_id
      ) mem_stats ON mem_stats.project_id = p.id
      WHERE p.status != 'cancelled' ${projectFilter}
      ORDER BY p.created_at DESC
    `).bind(...binds).all()

    // Calculate health score for each project
    const scored = (projects.results as any[]).map((p: any) => {
      let score = 100
      const issues: string[] = []

      // Task completion rate (30 pts)
      const completionRate = p.total_tasks > 0 ? p.done_tasks / p.total_tasks : 0
      const taskScore = Math.round(completionRate * 30)
      score -= (30 - taskScore)

      // Overdue penalty (-5 each, max -25)
      const overduePenalty = Math.min(p.overdue_tasks * 5, 25)
      score -= overduePenalty
      if (p.overdue_tasks > 0) issues.push(`${p.overdue_tasks} task trễ hạn`)

      // Budget health (20 pts)
      if (p.budget > 0) {
        const budgetUsage = p.total_cost / p.budget
        if (budgetUsage > 1.2) { score -= 20; issues.push('Vượt ngân sách >20%') }
        else if (budgetUsage > 1.0) { score -= 10; issues.push('Vượt ngân sách') }
        else if (budgetUsage > 0.9) score -= 5
      }

      // Deadline (20 pts)
      if (p.end_date) {
        const daysLeft = Math.ceil((new Date(p.end_date).getTime() - Date.now()) / 86400000)
        if (daysLeft < 0 && p.status !== 'completed') { score -= 20; issues.push('Quá hạn dự án') }
        else if (daysLeft < 7 && p.status !== 'completed') { score -= 10; issues.push('Sắp hết hạn (<7 ngày)') }
      }

      // Urgent pending penalty
      if (p.urgent_pending > 0) { score -= Math.min(p.urgent_pending * 3, 10); issues.push(`${p.urgent_pending} task urgent`) }

      score = Math.max(0, Math.min(100, score))

      let health = 'excellent'
      if (score < 40) health = 'critical'
      else if (score < 60) health = 'poor'
      else if (score < 75) health = 'fair'
      else if (score < 90) health = 'good'

      return { ...p, health_score: score, health_status: health, issues, completion_rate: Math.round(completionRate * 100) }
    })

    return c.json({ projects: scored })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// MODULE: HỒ SƠ PHÁP LÝ DỰ ÁN (Legal Documents)
// ===================================================

// ── Default stages & items template ─────────────────────────────────────────
const DEFAULT_LEGAL_STAGES = [
  {
    code: 'A', name: 'Giai đoạn chuẩn bị gói thầu', sort_order: 1,
    items: [
      { stt: '1', title: 'Yêu cầu lập đề cương dự toán', item_type: 'group', children: [
        { stt: '1.1', title: 'Dự toán chi phí', item_type: 'task' },
        { stt: '1.2', title: 'Đề cương nhiệm vụ', item_type: 'task' },
      ]},
    ]
  },
  {
    code: 'B', name: 'Giai đoạn tham gia gói thầu', sort_order: 2,
    items: [
      { stt: '1', title: 'Yêu cầu chuẩn bị hồ sơ năng lực nhà thầu', item_type: 'group', children: [
        { stt: '1.1', title: 'Xin tên gói thầu, các thông tin liên quan nếu có', item_type: 'task' },
        { stt: '1.2', title: 'Thư ngỏ', item_type: 'document' },
        { stt: '1.3', title: 'Thư cam kết thực hiện', item_type: 'document' },
      ]},
    ]
  },
  {
    code: 'C', name: 'Giai đoạn ký hợp đồng và thực hiện gói thầu', sort_order: 3,
    items: [
      { stt: '1', title: 'Thư mời thương thảo hợp đồng', item_type: 'group', children: [
        { stt: '1.1', title: 'Công văn tham gia thương thảo hợp đồng', item_type: 'document' },
        { stt: '1.2', title: 'Thương thảo hợp đồng', item_type: 'task' },
        { stt: '1.3', title: 'Dự thảo hợp đồng', item_type: 'document' },
      ]},
      { stt: '2', title: 'Ký hợp đồng', item_type: 'document', children: [
        { stt: '2.1', title: 'Bảo lãnh tạm ứng (Nếu có)', item_type: 'document' },
        { stt: '2.2', title: 'Đơn đề nghị tạm ứng', item_type: 'document' },
        { stt: '2.3', title: 'Quyết định thành lập tổ chuyên gia thực hiện gói thầu', item_type: 'document' },
        { stt: '2.4', title: 'Công văn cho phép tổ chuyên gia tiếp cận hồ sơ gói thầu', item_type: 'document' },
      ]},
      { stt: '3', title: 'Thực hiện dự án', item_type: 'group', children: [
        { stt: '3.1', title: 'Phê duyệt kế hoạch thực hiện BIM (BEP)', item_type: 'document' },
        { stt: '3.2', title: 'Báo cáo triển khai BIM hàng tuần', item_type: 'task' },
        { stt: '3.3', title: 'Họp phối hợp BIM', item_type: 'task' },
        { stt: '3.4', title: 'Báo cáo kết quả và nộp sản phẩm', item_type: 'document' },
      ]},
    ]
  },
  {
    code: 'D', name: 'Giai đoạn nghiệm thu', sort_order: 4,
    items: [
      { stt: '1', title: 'Biên bản nghiệm thu hoàn thành sản phẩm tư vấn', item_type: 'document', children: [] },
      { stt: '2', title: 'Mẫu số 3A - Xác định khối lượng công việc hoàn thành', item_type: 'document', children: [] },
      { stt: '3', title: 'Giấy đề nghị thanh toán', item_type: 'document', children: [] },
    ]
  },
]

// ── Helper: init default stages for a project ────────────────────────────────
async function initLegalStagesForProject(db: D1Database, projectId: number, createdBy: number) {
  // Check if already initialized
  const existing = await db.prepare('SELECT id FROM legal_stages WHERE project_id = ?').bind(projectId).first()
  if (existing) return { skipped: true }

  for (const stage of DEFAULT_LEGAL_STAGES) {
    const stageResult = await db.prepare(
      'INSERT INTO legal_stages (project_id, code, name, sort_order) VALUES (?,?,?,?)'
    ).bind(projectId, stage.code, stage.name, stage.sort_order).run()
    const stageId = stageResult.meta.last_row_id

    let sortOrder = 0
    for (const item of stage.items) {
      sortOrder++
      const parentResult = await db.prepare(
        `INSERT INTO legal_items (project_id, stage_id, parent_id, stt, title, item_type, sort_order, created_by)
         VALUES (?,?,NULL,?,?,?,?,?)`
      ).bind(projectId, stageId, item.stt, item.title, item.item_type, sortOrder, createdBy).run()
      const parentId = parentResult.meta.last_row_id

      if (item.children && item.children.length > 0) {
        let childSort = 0
        for (const child of item.children) {
          childSort++
          await db.prepare(
            `INSERT INTO legal_items (project_id, stage_id, parent_id, stt, title, item_type, sort_order, created_by)
             VALUES (?,?,?,?,?,?,?,?)`
          ).bind(projectId, stageId, parentId, child.stt, child.title, child.item_type, childSort, createdBy).run()
        }
      }
    }
  }

  // Default letter config
  await db.prepare(
    `INSERT OR IGNORE INTO legal_letter_config (project_id, prefix) VALUES (?,?)`
  ).bind(projectId, 'OC').run()

  return { initialized: true }
}

// ── Mã hiệu loại văn bản (dùng trong số văn bản) ────────────────────────────
const LETTER_TYPE_CODE: Record<string, string> = {
  cv: 'CV', bc: 'BC', bb: 'BB', tb: 'TB', qd: 'QĐ',
  tt: 'TT', kh: 'KH', yc: 'YC', pl: 'PL',
  contract: 'HĐ', appendix: 'PLHĐ', acceptance: 'BBNT',
  payment: 'TT', other: 'VB'
}

// ── Helper: generate next letter number ─────────────────────────────────────
// Format mới: {STT:02d}-{MÃ LOẠI}/OneCAD-BIM({SỐ HIỆU DỰ ÁN})
// Ví dụ: 01-CV/OneCAD-BIM(TS.C08)
// STT đếm theo project + loại văn bản, KHÔNG reset hàng năm
async function generateLetterNumber(
  db: D1Database,
  projectId: number,
  letterType: string,
  _year?: number   // giữ tham số cho tương thích, không dùng nữa
): Promise<{ number: string, seq: number, typeSeq: number }> {
  // Get project — prefer project_code_letter
  const proj = await db.prepare('SELECT code, project_code_letter FROM projects WHERE id = ?').bind(projectId).first() as any
  const projCode = (proj?.project_code_letter && proj.project_code_letter.trim() !== '')
    ? proj.project_code_letter.trim()
    : (proj?.code || `P${projectId}`)

  const typeCode = LETTER_TYPE_CODE[letterType] || letterType.toUpperCase()

  // Số thứ tự theo project + loại, không reset năm
  const lastRow = await db.prepare(
    `SELECT MAX(letter_type_seq) as max_seq FROM outgoing_letters WHERE project_id = ? AND letter_type = ?`
  ).bind(projectId, letterType).first() as any
  const typeSeq = (lastRow?.max_seq || 0) + 1

  // Số thứ tự tổng trong project (dùng cho letter_seq legacy)
  const lastTotal = await db.prepare(
    `SELECT MAX(letter_seq) as max_seq FROM outgoing_letters WHERE project_id = ?`
  ).bind(projectId).first() as any
  const seq = (lastTotal?.max_seq || 0) + 1

  // Format: 01-CV/OneCAD-BIM(TS.C08)
  const sttStr = String(typeSeq).padStart(2, '0')
  const number = `${sttStr}-${typeCode}/OneCAD-BIM(${projCode})`

  return { number, seq, typeSeq }
}

// ── Init project legal ────────────────────────────────────────────────────────
app.post('/api/legal/init/:projectId', authMiddleware, async (c) => {
  const user = c.get('user') as any
  const projectId = parseInt(c.req.param('projectId'))
  try {
    const result = await initLegalStagesForProject(c.env.DB, projectId, user.id)
    return c.json(result)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── Get all stages + items for a project ─────────────────────────────────────
app.get('/api/legal/:projectId/overview', authMiddleware, async (c) => {
  const projectId = parseInt(c.req.param('projectId'))
  try {
    const stages = await c.env.DB.prepare(
      'SELECT * FROM legal_stages WHERE project_id = ? ORDER BY sort_order'
    ).bind(projectId).all()

    const items = await c.env.DB.prepare(
      `SELECT li.*, u.full_name as created_by_name
       FROM legal_items li
       LEFT JOIN users u ON u.id = li.created_by
       WHERE li.project_id = ? ORDER BY li.stage_id, li.sort_order`
    ).bind(projectId).all()

    // Build tree per stage
    const stagesWithItems = (stages.results as any[]).map(stage => {
      const stageItems = (items.results as any[]).filter(i => i.stage_id === stage.id)
      const parents = stageItems.filter(i => !i.parent_id)
      const tree = parents.map(p => ({
        ...p,
        children: stageItems.filter(c => c.parent_id === p.id)
      }))
      return { ...stage, items: tree }
    })

    // Letters summary
    const letters = await c.env.DB.prepare(
      `SELECT ol.*, li.title as item_title, u.full_name as created_by_name
       FROM outgoing_letters ol
       LEFT JOIN legal_items li ON li.id = ol.legal_item_id
       LEFT JOIN users u ON u.id = ol.created_by
       WHERE ol.project_id = ? ORDER BY ol.letter_year DESC, ol.letter_seq DESC`
    ).bind(projectId).all()

    // Documents summary
    const docs = await c.env.DB.prepare(
      `SELECT ld.*, li.title as item_title
       FROM legal_documents ld
       LEFT JOIN legal_items li ON li.id = ld.legal_item_id
       WHERE ld.project_id = ? ORDER BY ld.created_at DESC`
    ).bind(projectId).all()

    // Config
    const config = await c.env.DB.prepare(
      'SELECT * FROM legal_letter_config WHERE project_id = ?'
    ).bind(projectId).first()

    // Payments summary (kèm trạng thái sync revenue)
    const payments = await c.env.DB.prepare(
      `SELECT pr.*, u.full_name as created_by_name,
              li.stt as item_stt, li.title as item_title,
              CASE WHEN pr.revenue_id IS NOT NULL THEN 1 ELSE 0 END as revenue_synced
       FROM payment_requests pr
       LEFT JOIN users u ON u.id = pr.created_by
       LEFT JOIN legal_items li ON li.id = pr.legal_item_id
       WHERE pr.project_id = ? ORDER BY pr.created_at DESC`
    ).bind(projectId).all()

    return c.json({ stages: stagesWithItems, letters: letters.results, documents: docs.results, config, payments: payments.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── CRUD Legal Items ──────────────────────────────────────────────────────────
app.post('/api/legal/:projectId/items', authMiddleware, async (c) => {
  const user = c.get('user') as any
  const projectId = parseInt(c.req.param('projectId'))
  const body = await c.req.json()
  try {
    const stageId = body.stage_id
    const parentId = body.parent_id || null

    // Đếm số item cha/con hiện có để tính sort_order + auto stt
    const siblings = await c.env.DB.prepare(
      `SELECT id, stt, sort_order FROM legal_items
       WHERE stage_id = ? AND parent_id IS ?
       ORDER BY sort_order, id`
    ).bind(stageId, parentId).all()
    const siblingsArr = siblings.results as any[]
    const sortOrder = siblingsArr.length + 1  // thêm vào cuối

    // Tính STT tự động
    let autoStt: string
    if (!parentId) {
      // Item cha: đếm tất cả item cha trong stage này
      autoStt = String(sortOrder)
    } else {
      // Item con: tìm STT của cha → "{parentStt}.{childIdx}"
      const parent = await c.env.DB.prepare(
        `SELECT stt FROM legal_items WHERE id = ?`
      ).bind(parentId).first() as any
      const parentStt = parent?.stt || '1'
      autoStt = `${parentStt}.${sortOrder}`
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO legal_items (project_id, stage_id, parent_id, stt, title, item_type, due_date, status, notes, sort_order, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      projectId, stageId, parentId,
      autoStt, body.title, body.item_type || 'task',
      body.due_date || null, body.status || 'pending',
      body.notes || null, sortOrder, user.id
    ).run()
    return c.json({ id: result.meta.last_row_id, stt: autoStt, success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.put('/api/legal/items/:id', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json()
  try {
    // stt do hệ thống quản lý tự động, chỉ cập nhật các field nội dung
    await c.env.DB.prepare(
      `UPDATE legal_items SET title=?, item_type=?, due_date=?, status=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(body.title, body.item_type, body.due_date || null, body.status, body.notes || null, id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.delete('/api/legal/items/:id', authMiddleware, async (c) => {
  const user = c.get('user') as any
  if (!(['system_admin','project_admin','project_leader'] as string[]).includes(user.role)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const id = parseInt(c.req.param('id'))
  try {
    // Lấy thông tin item trước khi xóa để recalculate
    const item = await c.env.DB.prepare('SELECT stage_id, parent_id FROM legal_items WHERE id = ?').bind(id).first() as any
    await c.env.DB.prepare('DELETE FROM legal_items WHERE id = ?').bind(id).run()
    // Recalculate stt + sort_order của các items cùng cấp sau khi xóa
    if (item) {
      await recalculateSiblingsStt(c.env.DB, item.stage_id, item.parent_id)
    }
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── Helper: recalculate STT sau khi xóa/reorder ─────────────────────────────
async function recalculateSiblingsStt(db: D1Database, stageId: number, parentId: number | null) {
  const siblings = await db.prepare(
    `SELECT id, parent_id FROM legal_items WHERE stage_id = ? AND parent_id IS ? ORDER BY sort_order, id`
  ).bind(stageId, parentId).all()
  const arr = siblings.results as any[]
  for (let i = 0; i < arr.length; i++) {
    const newSortOrder = i + 1
    let newStt: string
    if (!parentId) {
      newStt = String(newSortOrder)
    } else {
      // Lấy stt của parent
      const parent = await db.prepare('SELECT stt FROM legal_items WHERE id = ?').bind(parentId).first() as any
      newStt = `${parent?.stt || '1'}.${newSortOrder}`
    }
    await db.prepare('UPDATE legal_items SET stt=?, sort_order=? WHERE id=?').bind(newStt, newSortOrder, arr[i].id).run()
    // Nếu item cha bị renumber, cập nhật cả các item con
    if (!parentId) {
      const children = await db.prepare(
        `SELECT id FROM legal_items WHERE parent_id = ? ORDER BY sort_order, id`
      ).bind(arr[i].id).all()
      const childArr = children.results as any[]
      for (let j = 0; j < childArr.length; j++) {
        await db.prepare('UPDATE legal_items SET stt=?, sort_order=? WHERE id=?')
          .bind(`${newStt}.${j+1}`, j+1, childArr[j].id).run()
      }
    }
  }
}

// ── Reorder item (move up / move down) ────────────────────────────────────────
app.post('/api/legal/items/:id/reorder', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'))
  const { direction } = await c.req.json()  // 'up' | 'down'
  try {
    const item = await c.env.DB.prepare(
      'SELECT id, stage_id, parent_id, sort_order FROM legal_items WHERE id = ?'
    ).bind(id).first() as any
    if (!item) return c.json({ error: 'Not found' }, 404)

    const siblings = await c.env.DB.prepare(
      `SELECT id, sort_order FROM legal_items WHERE stage_id = ? AND parent_id IS ? ORDER BY sort_order, id`
    ).bind(item.stage_id, item.parent_id).all()
    const arr = siblings.results as any[]
    const idx = arr.findIndex((s: any) => s.id === id)
    if (idx === -1) return c.json({ error: 'Not found in siblings' }, 404)

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= arr.length) return c.json({ success: true, noChange: true })

    // Swap sort_order giữa 2 items
    const aId = arr[idx].id,  bId = arr[swapIdx].id
    const aOrd = arr[idx].sort_order, bOrd = arr[swapIdx].sort_order
    await c.env.DB.prepare('UPDATE legal_items SET sort_order=? WHERE id=?').bind(bOrd, aId).run()
    await c.env.DB.prepare('UPDATE legal_items SET sort_order=? WHERE id=?').bind(aOrd, bId).run()

    // Recalculate stt cho toàn bộ siblings sau khi swap
    await recalculateSiblingsStt(c.env.DB, item.stage_id, item.parent_id)
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── Tasks gắn với Legal Item ──────────────────────────────────────────────────
// GET /api/legal/items/:itemId/tasks — lấy tasks + subtasks của 1 hạng mục
app.get('/api/legal/items/:itemId/tasks', authMiddleware, async (c) => {
  const itemId = parseInt(c.req.param('itemId'))
  try {
    const tasks = await c.env.DB.prepare(
      `SELECT t.*, u.full_name as assignee_name,
        (SELECT COUNT(*) FROM subtasks st WHERE st.task_id = t.id) as subtask_count,
        (SELECT COUNT(*) FROM subtasks st WHERE st.task_id = t.id AND st.status = 'done') as subtask_done_count
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.legal_item_id = ?
       ORDER BY t.created_at ASC`
    ).bind(itemId).all()

    // Load subtasks for each task
    const taskArr = tasks.results as any[]
    const result = []
    for (const task of taskArr) {
      const subs = await c.env.DB.prepare(
        `SELECT st.*, u.full_name as assignee_name
         FROM subtasks st LEFT JOIN users u ON u.id = st.assigned_to
         WHERE st.task_id = ? ORDER BY st.created_at ASC`
      ).bind(task.id).all()
      result.push({ ...task, subtasks: subs.results })
    }
    return c.json(result)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// POST /api/legal/items/:itemId/tasks — tạo task gắn với hạng mục
app.post('/api/legal/items/:itemId/tasks', authMiddleware, async (c) => {
  const user = c.get('user') as any
  const itemId = parseInt(c.req.param('itemId'))
  const body = await c.req.json()
  try {
    // Lấy project_id từ legal_item
    const item = await c.env.DB.prepare('SELECT project_id FROM legal_items WHERE id = ?').bind(itemId).first() as any
    if (!item) return c.json({ error: 'Legal item not found' }, 404)

    const result = await c.env.DB.prepare(
      `INSERT INTO tasks (project_id, legal_item_id, title, description, priority, status, assigned_to, assigned_by, due_date, estimated_hours)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      item.project_id, itemId,
      body.title, body.description || null,
      body.priority || 'medium', body.status || 'todo',
      body.assigned_to || null, user.id,
      body.due_date || null, body.estimated_hours || 0
    ).run()
    return c.json({ id: result.meta.last_row_id, success: true }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── CRUD Legal Documents ──────────────────────────────────────────────────────
app.get('/api/legal/:projectId/documents', authMiddleware, async (c) => {
  const projectId = parseInt(c.req.param('projectId'))
  try {
    const rows = await c.env.DB.prepare(
      `SELECT ld.*, li.title as item_title, u.full_name as created_by_name
       FROM legal_documents ld
       LEFT JOIN legal_items li ON li.id = ld.legal_item_id
       LEFT JOIN users u ON u.id = ld.created_by
       WHERE ld.project_id = ? ORDER BY ld.created_at DESC`
    ).bind(projectId).all()
    return c.json({ documents: rows.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/legal/:projectId/documents', authMiddleware, async (c) => {
  const user = c.get('user') as any
  const projectId = parseInt(c.req.param('projectId'))
  const body = await c.req.json()
  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO legal_documents (project_id, legal_item_id, doc_type, title, file_name, file_url, signed_date, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      projectId, body.legal_item_id || null, body.doc_type || 'other',
      body.title, body.file_name || null, body.file_url || null,
      body.signed_date || null, body.notes || null, user.id
    ).run()
    return c.json({ id: result.meta.last_row_id, success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.put('/api/legal/documents/:id', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json()
  try {
    await c.env.DB.prepare(
      `UPDATE legal_documents SET title=?, doc_type=?, legal_item_id=?, signed_date=?, notes=?, file_name=?, file_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(body.title, body.doc_type, body.legal_item_id || null, body.signed_date || null, body.notes || null, body.file_name || null, body.file_url || null, id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.delete('/api/legal/documents/:id', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    await c.env.DB.prepare('DELETE FROM legal_documents WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── Outgoing Letters ─────────────────────────────────────────────────────────
app.get('/api/legal/:projectId/letters', authMiddleware, async (c) => {
  const projectId = parseInt(c.req.param('projectId'))
  try {
    const rows = await c.env.DB.prepare(
      `SELECT ol.*, li.title as item_title, u.full_name as created_by_name
       FROM outgoing_letters ol
       LEFT JOIN legal_items li ON li.id = ol.legal_item_id
       LEFT JOIN users u ON u.id = ol.created_by
       WHERE ol.project_id = ? ORDER BY ol.letter_year DESC, ol.letter_seq DESC`
    ).bind(projectId).all()
    return c.json({ letters: rows.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/legal/:projectId/letters', authMiddleware, async (c) => {
  const user = c.get('user') as any
  const projectId = parseInt(c.req.param('projectId'))
  const body = await c.req.json()
  try {
    const year = body.sent_date ? parseInt(body.sent_date.split('-')[0]) : new Date().getFullYear()
    const letterType = body.letter_type || 'cv'
    const { number, seq, typeSeq } = await generateLetterNumber(c.env.DB, projectId, letterType, year)
    const result = await c.env.DB.prepare(
      `INSERT INTO outgoing_letters (project_id, legal_item_id, letter_number, letter_seq, letter_year, letter_type, letter_type_seq, subject, recipient, sent_date, status, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      projectId, body.legal_item_id || null, number, seq, year,
      letterType, typeSeq,
      body.subject, body.recipient || null,
      body.sent_date || null, body.status || 'draft',
      body.notes || null, user.id
    ).run()
    return c.json({ id: result.meta.last_row_id, letter_number: number, success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.put('/api/legal/letters/:id', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json()
  try {
    await c.env.DB.prepare(
      `UPDATE outgoing_letters SET subject=?, recipient=?, sent_date=?, status=?, notes=?, legal_item_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(body.subject, body.recipient || null, body.sent_date || null, body.status, body.notes || null, body.legal_item_id || null, id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.delete('/api/legal/letters/:id', authMiddleware, async (c) => {
  const user = c.get('user') as any
  if (!['system_admin','project_admin','project_leader'].includes(user.role)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const id = parseInt(c.req.param('id'))
  try {
    await c.env.DB.prepare('DELETE FROM outgoing_letters WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── Letter Config ─────────────────────────────────────────────────────────────
app.get('/api/legal/:projectId/config', authMiddleware, async (c) => {
  const projectId = parseInt(c.req.param('projectId'))
  const config = await c.env.DB.prepare('SELECT * FROM legal_letter_config WHERE project_id = ?').bind(projectId).first()
  return c.json({ config: config || { prefix: 'OC', include_project_code: 1, seq_reset_yearly: 1 } })
})

app.put('/api/legal/:projectId/config', authMiddleware, async (c) => {
  const projectId = parseInt(c.req.param('projectId'))
  const body = await c.req.json()
  try {
    await c.env.DB.prepare(
      `INSERT INTO legal_letter_config (project_id, prefix, include_project_code, seq_reset_yearly)
       VALUES (?,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET prefix=excluded.prefix, include_project_code=excluded.include_project_code, seq_reset_yearly=excluded.seq_reset_yearly, updated_at=CURRENT_TIMESTAMP`
    ).bind(projectId, body.prefix || 'OC', body.include_project_code ? 1 : 0, body.seq_reset_yearly ? 1 : 0).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── Preview next letter number ────────────────────────────────────────────────
app.get('/api/legal/:projectId/letters/preview-number', authMiddleware, async (c) => {
  const projectId = parseInt(c.req.param('projectId'))
  const letterType = c.req.query('type') || 'cv'
  try {
    const { number } = await generateLetterNumber(c.env.DB, projectId, letterType)
    return c.json({ number })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// MODULE: E. TÌNH TRẠNG THANH TOÁN (Payment Requests)
// Auto-sync với project_revenues khi status = paid | partial
// ===================================================

// ── Helper: map payment status → revenue payment_status ──────────────────────
function paymentStatusToRevenue(status: string): string {
  if (status === 'paid') return 'paid'
  if (status === 'partial') return 'partial'
  return 'pending'
}

// ── Helper: tạo hoặc cập nhật revenue từ payment request ─────────────────────
async function syncPaymentToRevenue(
  db: D1Database,
  payment: {
    id: number, project_id: number, description: string,
    paid_amount: number, currency: string,
    paid_date: string | null, invoice_number: string | null,
    payment_phase: string | null, status: string,
    revenue_id: number | null, notes: string | null
  },
  userId: number
): Promise<number | null> {
  const shouldSync = payment.status === 'paid' || payment.status === 'partial'
  const syncAmount = payment.paid_amount || 0

  // Nếu không cần sync → xóa revenue cũ nếu có
  if (!shouldSync || syncAmount <= 0) {
    if (payment.revenue_id) {
      await db.prepare('DELETE FROM project_revenues WHERE id = ?').bind(payment.revenue_id).run()
      await db.prepare('UPDATE payment_requests SET revenue_id = NULL WHERE id = ?').bind(payment.id).run()
    }
    return null
  }

  const revenueDesc = payment.payment_phase
    ? `[${payment.payment_phase}] ${payment.description}`
    : payment.description
  const revenueStatus = paymentStatusToRevenue(payment.status)
  const revenueNotes = `[Đồng bộ từ Hồ Sơ Pháp Lý - Tình trạng thanh toán]${payment.notes ? '\n' + payment.notes : ''}`

  if (payment.revenue_id) {
    // Cập nhật revenue đã có
    await db.prepare(`
      UPDATE project_revenues
      SET description = ?, amount = ?, currency = ?, revenue_date = ?,
          invoice_number = ?, payment_status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      revenueDesc, syncAmount, payment.currency || 'VND',
      payment.paid_date || null, payment.invoice_number || null,
      revenueStatus, revenueNotes, payment.revenue_id
    ).run()
    return payment.revenue_id
  } else {
    // Tạo revenue mới
    const result = await db.prepare(`
      INSERT INTO project_revenues
        (project_id, description, amount, currency, revenue_date, invoice_number, payment_status, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(
      payment.project_id, revenueDesc, syncAmount, payment.currency || 'VND',
      payment.paid_date || null, payment.invoice_number || null,
      revenueStatus, revenueNotes, userId
    ).run()
    return result.meta.last_row_id as number
  }
}

// GET /api/legal/:projectId/payments — list all payment requests
app.get('/api/legal/:projectId/payments', authMiddleware, async (c) => {
  const projectId = parseInt(c.req.param('projectId'))
  try {
    const rows = await c.env.DB.prepare(`
      SELECT pr.*, u.full_name as created_by_name,
             li.stt as item_stt, li.title as item_title,
             rv.id as revenue_synced_id
      FROM payment_requests pr
      LEFT JOIN users u ON u.id = pr.created_by
      LEFT JOIN legal_items li ON li.id = pr.legal_item_id
      LEFT JOIN project_revenues rv ON rv.id = pr.revenue_id
      WHERE pr.project_id = ?
      ORDER BY pr.created_at DESC
    `).bind(projectId).all()
    return c.json({ payments: rows.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// POST /api/legal/:projectId/payments — create payment request
app.post('/api/legal/:projectId/payments', authMiddleware, async (c) => {
  const projectId = parseInt(c.req.param('projectId'))
  const user = c.get('user') as any
  try {
    const data = await c.req.json()
    const { description, request_number, request_date, amount, currency, status,
            paid_amount, paid_date, invoice_number, invoice_date, payment_phase,
            legal_item_id, notes } = data
    if (!description) return c.json({ error: 'description required' }, 400)

    // Insert payment request
    const result = await c.env.DB.prepare(`
      INSERT INTO payment_requests
        (project_id, legal_item_id, request_number, description, request_date, amount, currency,
         status, paid_amount, paid_date, invoice_number, invoice_date, payment_phase, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      projectId, legal_item_id || null, request_number || null, description,
      request_date || null, amount || 0, currency || 'VND',
      status || 'pending', paid_amount || 0, paid_date || null,
      invoice_number || null, invoice_date || null, payment_phase || null,
      notes || null, user.id
    ).run()
    const paymentId = result.meta.last_row_id as number

    // Auto-sync revenue nếu cần
    const revenueId = await syncPaymentToRevenue(c.env.DB, {
      id: paymentId, project_id: projectId, description,
      paid_amount: paid_amount || 0, currency: currency || 'VND',
      paid_date: paid_date || null, invoice_number: invoice_number || null,
      payment_phase: payment_phase || null, status: status || 'pending',
      revenue_id: null, notes: notes || null
    }, user.id)

    // Lưu revenue_id vào payment nếu có
    if (revenueId) {
      await c.env.DB.prepare('UPDATE payment_requests SET revenue_id = ? WHERE id = ?')
        .bind(revenueId, paymentId).run()
    }

    // ── Email: payment_request_new → thông báo cho System Admin ──
    const projInfo = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(projectId).first() as any
    const admins = await c.env.DB.prepare(`SELECT id, email, full_name FROM users WHERE role = 'system_admin' AND is_active = 1`).all()
    for (const admin of admins.results as any[]) {
      if (admin.id !== user.id && admin.email) {
        await sendEmail(c.env, {
          to: admin.email, toName: admin.full_name,
          eventType: 'payment_request_new',
          data: { title: description, projectName: projInfo?.name, amount: `${(amount || 0).toLocaleString('vi-VN')} ${currency || 'VND'}`, requestedBy: user.full_name, date: request_date, description: notes },
          db: c.env.DB, userId: admin.id, relatedType: 'payment', relatedId: paymentId
        })
      }
    }

    return c.json({ id: paymentId, revenue_id: revenueId, success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// PUT /api/legal/payments/:id — update payment request
app.put('/api/legal/payments/:id', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'))
  const user = c.get('user') as any
  try {
    const data = await c.req.json()

    // Lấy payment hiện tại để có đủ thông tin sync
    const current = await c.env.DB.prepare(
      'SELECT * FROM payment_requests WHERE id = ?'
    ).bind(id).first() as any
    if (!current) return c.json({ error: 'not found' }, 404)

    const fields = ['description', 'request_number', 'request_date', 'amount', 'currency',
                    'status', 'paid_amount', 'paid_date', 'invoice_number', 'invoice_date',
                    'payment_phase', 'legal_item_id', 'notes']
    const updates: string[] = []
    const values: any[] = []
    fields.forEach(f => {
      if (data[f] !== undefined) {
        updates.push(`${f} = ?`)
        values.push(data[f] === '' ? null : data[f])
      }
    })
    if (!updates.length) return c.json({ error: 'no fields' }, 400)
    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)
    await c.env.DB.prepare(`UPDATE payment_requests SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()

    // Merge current + new data để sync
    const merged = { ...current, ...Object.fromEntries(fields.map(f => [f, data[f] !== undefined ? (data[f] === '' ? null : data[f]) : current[f]])) }

    // Auto-sync revenue
    const revenueId = await syncPaymentToRevenue(c.env.DB, {
      id, project_id: current.project_id,
      description: merged.description,
      paid_amount: merged.paid_amount || 0,
      currency: merged.currency || 'VND',
      paid_date: merged.paid_date || null,
      invoice_number: merged.invoice_number || null,
      payment_phase: merged.payment_phase || null,
      status: merged.status || 'pending',
      revenue_id: current.revenue_id || null,
      notes: merged.notes || null
    }, user.id)

    // Cập nhật revenue_id
    await c.env.DB.prepare('UPDATE payment_requests SET revenue_id = ? WHERE id = ?')
      .bind(revenueId || null, id).run()

    // ── Email: payment_status_changed → thông báo creator khi admin đổi trạng thái ──
    if (data.status && data.status !== current.status) {
      try {
        const projInfo = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?')
          .bind(current.project_id).first() as any
        const amount = current.amount || merged.amount || 0
        const paidAmount = merged.paid_amount || 0
        // Thông báo người tạo đề nghị
        if (current.created_by && current.created_by !== user.id) {
          const creatorInfo = await getUserEmailInfo(c.env.DB, current.created_by)
          if (creatorInfo) {
            sendEmail(c.env, {
              to: creatorInfo.email, toName: creatorInfo.full_name,
              eventType: 'payment_status_changed',
              data: {
                description: merged.description || current.description,
                projectName: projInfo?.name,
                amount: `${Number(amount).toLocaleString('vi-VN')} ${merged.currency || current.currency || 'VND'}`,
                paidAmount: paidAmount > 0 ? `${Number(paidAmount).toLocaleString('vi-VN')} ${merged.currency || 'VND'}` : null,
                paidDate: merged.paid_date || current.paid_date || null,
                oldStatus: current.status, newStatus: data.status,
                updatedBy: user.full_name,
                notes: merged.notes || current.notes || null
              },
              db: c.env.DB, userId: current.created_by,
              relatedType: 'payment', relatedId: id
            })
          }
        }
        // Thông báo thêm cho system_admin nếu đã paid
        if (data.status === 'paid') {
          const admins = await c.env.DB.prepare(
            `SELECT id, email, full_name FROM users WHERE role = 'system_admin' AND is_active = 1`
          ).all()
          for (const admin of admins.results as any[]) {
            if (admin.id !== user.id && admin.id !== current.created_by && admin.email) {
              sendEmail(c.env, {
                to: admin.email, toName: admin.full_name,
                eventType: 'payment_status_changed',
                data: {
                  description: merged.description || current.description,
                  projectName: projInfo?.name,
                  amount: `${Number(amount).toLocaleString('vi-VN')} ${merged.currency || 'VND'}`,
                  paidAmount: paidAmount > 0 ? `${Number(paidAmount).toLocaleString('vi-VN')} ${merged.currency || 'VND'}` : null,
                  paidDate: merged.paid_date || null,
                  oldStatus: current.status, newStatus: data.status,
                  updatedBy: user.full_name, notes: merged.notes || null
                },
                db: c.env.DB, userId: admin.id,
                relatedType: 'payment', relatedId: id
              })
            }
          }
        }
      } catch (_) { /* ignore email errors */ }
    }

    return c.json({ success: true, revenue_id: revenueId })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// DELETE /api/legal/payments/:id — delete payment request + xóa revenue liên kết
app.delete('/api/legal/payments/:id', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    // Lấy revenue_id trước khi xóa
    const payment = await c.env.DB.prepare(
      'SELECT revenue_id FROM payment_requests WHERE id = ?'
    ).bind(id).first() as any

    await c.env.DB.prepare('DELETE FROM payment_requests WHERE id = ?').bind(id).run()

    // Xóa revenue đã sync nếu có
    if (payment?.revenue_id) {
      await c.env.DB.prepare('DELETE FROM project_revenues WHERE id = ?')
        .bind(payment.revenue_id).run()
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ===================================================
// IMPORT EXCEL - Hồ Sơ Pháp Lý
// ===================================================

// POST /api/legal/import-excel/:projectId
// Body: multipart/form-data { file: .xlsx }
// Logic parse:
//   - Hàng header (STT = 'STT') → bỏ qua
//   - A = chữ cái (A/B/C/D) → tạo stage mới
//   - A = số nguyên (1,2,3…) → parent item
//   - A = công thức =A3+0.1 style → child item (con của parent gần nhất)
app.post('/api/legal/import-excel/:projectId', authMiddleware, async (c) => {
  const user = c.get('user') as any
  const projectId = parseInt(c.req.param('projectId'))
  const db = c.env.DB

  try {
    // --- Đọc file từ multipart ---
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ error: 'Không tìm thấy file' }, 400)

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'xlsx' && ext !== 'xls') {
      return c.json({ error: 'Chỉ hỗ trợ file .xlsx hoặc .xls' }, 400)
    }

    // Đọc ArrayBuffer → parse thủ công (XLSX binary format)
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    // Parse XLSX bằng cách đọc XML bên trong (ZIP format)
    // Dùng cách unzip + parse XML từ WebAPI
    const rows = await parseXlsxRowsAsync(bytes)
    if (!rows || rows.length === 0) {
      return c.json({ error: 'File rỗng hoặc không đọc được dữ liệu' }, 400)
    }

    // --- Kiểm tra project tồn tại ---
    const project = await db.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first()
    if (!project) return c.json({ error: 'Project không tồn tại' }, 404)

    // --- Xóa dữ liệu cũ nếu người dùng chọn replace ---
    const replaceExisting = formData.get('replace') === '1'
    if (replaceExisting) {
      await db.prepare('DELETE FROM legal_items WHERE project_id = ?').bind(projectId).run()
      await db.prepare('DELETE FROM legal_stages WHERE project_id = ?').bind(projectId).run()
    }

    // --- Parse rows → stages + items ---
    const STAGE_MAP: Record<string, string> = {
      'A': 'Giai đoạn A',
      'B': 'Giai đoạn B',
      'C': 'Giai đoạn C',
      'D': 'Giai đoạn D',
    }

    let currentStageId: number | null = null
    let currentStageCode: string | null = null
    let currentParentId: number | null = null
    let currentParentStt: string = '0'   // STT của parent hiện tại, dùng để tính 1.1, 1.2...
    let stageOrder = 0
    let itemOrder = 0
    let childCount = 0   // đếm sub-item trong parent hiện tại

    const stats = { stages: 0, parents: 0, children: 0, skipped: 0 }

    for (const row of rows) {
      // row: [stt, title, due_date, status_raw, notes]
      const sttRaw = row[0]
      const title = (row[1] || '').toString().trim()
      const dueDateRaw = row[2]
      const statusRaw = (row[3] || '').toString().trim().toLowerCase()
      const notes = (row[4] || '').toString().trim()

      if (!title) { stats.skipped++; continue }

      const sttStr = sttRaw !== null && sttRaw !== undefined ? sttRaw.toString().trim() : ''

      // Bỏ qua hàng header
      if (sttStr.toUpperCase() === 'STT') { stats.skipped++; continue }

      // Xử lý công thức Excel dạng =Ax+0.y hoặc =Ax+0.xy khi không có cached value
      // Ví dụ: =A3+0.1, =A10+0.1 → trường hợp này không có cached value → detect là sub-item
      // (Khi có cached value thì parseSheetXml đã giải quyết thành float 1.1, 1.2 rồi)
      // → Nếu sttStr vẫn là dạng công thức thì vẫn nhận diện đúng là child qua isChild check

      // Parse due_date
      let dueDate: string | null = null
      if (dueDateRaw) {
        const d = dueDateRaw.toString().trim()
        if (d.match(/^\d{4}-\d{2}-\d{2}/)) {
          dueDate = d.substring(0, 10)
        } else if (d.match(/^\d+\/\d+\/\d{4}/)) {
          // dd/mm/yyyy or mm/dd/yyyy
          const parts = d.split('/')
          if (parts.length === 3) {
            dueDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
          }
        } else if (d.match(/^\d+\/\d+\/\d{2}$/)) {
          const parts = d.split('/')
          dueDate = `20${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
        } else if (d.match(/^[A-Za-z]/)) {
          // Text date like "Trước 21/04/2025" → notes
          if (!notes && d) { /* keep as note */ }
        }
      }

      // Parse status
      let status: string = 'pending'
      if (statusRaw === 'x' || statusRaw === '✓' || statusRaw === 'completed' || statusRaw === 'done') {
        status = 'completed'
      } else if (statusRaw === 'in_progress' || statusRaw === 'đang làm') {
        status = 'in_progress'
      }

      // Determine row type
      // Stage: sttStr là 1 ký tự chữ cái A-D
      if (/^[A-Za-z]$/.test(sttStr) && sttStr.length === 1) {
        const code = sttStr.toUpperCase()
        const stageName = STAGE_MAP[code] || `Giai đoạn ${code}`
        // Tên stage từ title nếu có
        const finalStageName = title || stageName

        // Tạo stage
        const existingStage = await db.prepare(
          'SELECT id FROM legal_stages WHERE project_id = ? AND code = ?'
        ).bind(projectId, code).first() as any

        if (existingStage) {
          currentStageId = existingStage.id
          currentStageCode = code
        } else {
          const stageRes = await db.prepare(
            'INSERT INTO legal_stages (project_id, code, name, sort_order) VALUES (?, ?, ?, ?)'
          ).bind(projectId, code, finalStageName, stageOrder).run()
          currentStageId = stageRes.meta.last_row_id as number
          currentStageCode = code
          stageOrder++
          stats.stages++
        }
        currentParentId = null
        currentParentStt = '0'
        itemOrder = 0
        childCount = 0
        continue
      }

      // Nếu chưa có stage → tạo mặc định
      if (!currentStageId) {
        const stageRes = await db.prepare(
          'INSERT INTO legal_stages (project_id, code, name, sort_order) VALUES (?, ?, ?, ?)'
        ).bind(projectId, 'A', 'Giai đoạn A', stageOrder).run()
        currentStageId = stageRes.meta.last_row_id as number
        currentStageCode = 'A'
        stageOrder++
        stats.stages++
        itemOrder = 0
        childCount = 0
      }

      // Parent item: sttStr là số nguyên (không chứa dấu chấm, không phải công thức)
      const isParent = /^\d+$/.test(sttStr)
      // Child item: công thức =A3+0.1 hoặc số thập phân như 1.1, 1.2
      // Sau khi fix parseSheetXml, formula cells đã được resolve thành float (1.1, 1.2, ...)
      const isChild = sttStr.startsWith('=') || /^\d+\.\d+$/.test(sttStr)

      // Tính STT thực cho sub-item: parentStt.childIndex (VD: 1.1, 1.2, 2.3)
      // Luôn đếm tự động để đảm bảo 1.1, 1.2, 1.3... liên tục
      let itemStt = sttStr
      if (isChild) {
        childCount++
        itemStt = `${currentParentStt}.${childCount}`
      }

      const notesFinal = [notes, (dueDateRaw?.toString().match(/^[A-Za-zÀ-ỹ]/) ? dueDateRaw.toString().trim() : '')].filter(Boolean).join(' | ')

      if (isParent) {
        const res = await db.prepare(
          `INSERT INTO legal_items 
           (project_id, stage_id, parent_id, stt, title, item_type, due_date, status, notes, sort_order, created_by)
           VALUES (?, ?, NULL, ?, ?, 'group', ?, ?, ?, ?, ?)`
        ).bind(projectId, currentStageId, sttStr, title, dueDate, status, notesFinal || null, itemOrder, user.id).run()
        currentParentId = res.meta.last_row_id as number
        currentParentStt = sttStr   // lưu STT parent để tính sub-item
        childCount = 0              // reset đếm sub-item
        itemOrder++
        stats.parents++
      } else if (isChild) {
        // Nếu chưa có parent, tạo pseudo-parent
        if (!currentParentId) {
          const pseudoRes = await db.prepare(
            `INSERT INTO legal_items 
             (project_id, stage_id, parent_id, stt, title, item_type, due_date, status, sort_order, created_by)
             VALUES (?, ?, NULL, '0', '(Nhóm)', 'group', NULL, 'pending', ?, ?)`
          ).bind(projectId, currentStageId, itemOrder, user.id).run()
          currentParentId = pseudoRes.meta.last_row_id as number
          currentParentStt = '0'
          childCount = 0
          itemOrder++
        }

        await db.prepare(
          `INSERT INTO legal_items 
           (project_id, stage_id, parent_id, stt, title, item_type, due_date, status, notes, sort_order, created_by)
           VALUES (?, ?, ?, ?, ?, 'document', ?, ?, ?, ?, ?)`
        ).bind(projectId, currentStageId, currentParentId, itemStt, title, dueDate, status, notesFinal || null, itemOrder, user.id).run()
        itemOrder++
        stats.children++
      } else {
        // Row không rõ loại → treat as parent
        const res = await db.prepare(
          `INSERT INTO legal_items 
           (project_id, stage_id, parent_id, stt, title, item_type, due_date, status, notes, sort_order, created_by)
           VALUES (?, ?, NULL, ?, ?, 'task', ?, ?, ?, ?, ?)`
        ).bind(projectId, currentStageId, sttStr || itemOrder.toString(), title, dueDate, status, notesFinal || null, itemOrder, user.id).run()
        currentParentId = res.meta.last_row_id as number
        currentParentStt = sttStr || itemOrder.toString()
        childCount = 0
        itemOrder++
        stats.parents++
      }
    }

    return c.json({
      success: true,
      message: `Import thành công: ${stats.stages} giai đoạn, ${stats.parents} hạng mục, ${stats.children} tài liệu con`,
      stats
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── Helper: Parse XLSX file (ZIP → shared strings + sheet XML) ──────────────

// ZIP local file entry structure
interface ZipEntry {
  name: string
  offset: number         // offset đến local file header
  compressedSize: number
  uncompressedSize: number
  compressionMethod: number
}

function readUint16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8)
}

function readUint32LE(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

function parseZipEntries(data: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = []
  // Tìm End of Central Directory (signature 0x06054b50)
  let eocdOffset = -1
  for (let i = data.length - 22; i >= 0; i--) {
    if (data[i] === 0x50 && data[i + 1] === 0x4b && data[i + 2] === 0x05 && data[i + 3] === 0x06) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) return entries

  const centralDirOffset = readUint32LE(data, eocdOffset + 16)
  const totalEntries = readUint16LE(data, eocdOffset + 10)

  let pos = centralDirOffset
  for (let i = 0; i < totalEntries; i++) {
    // Central directory entry signature: 0x02014b50
    if (data[pos] !== 0x50 || data[pos + 1] !== 0x4b || data[pos + 2] !== 0x01 || data[pos + 3] !== 0x02) break

    const compressionMethod = readUint16LE(data, pos + 10)
    const compressedSize = readUint32LE(data, pos + 20)
    const uncompressedSize = readUint32LE(data, pos + 24)
    const fileNameLen = readUint16LE(data, pos + 28)
    const extraFieldLen = readUint16LE(data, pos + 30)
    const commentLen = readUint16LE(data, pos + 32)
    const localHeaderOffset = readUint32LE(data, pos + 42)

    const nameBytes = data.slice(pos + 46, pos + 46 + fileNameLen)
    const name = new TextDecoder().decode(nameBytes)

    entries.push({ name, offset: localHeaderOffset, compressedSize, uncompressedSize, compressionMethod })
    pos += 46 + fileNameLen + extraFieldLen + commentLen
  }

  return entries
}

function decompressEntryUnused(_data: Uint8Array, _entry: ZipEntry): string {
  throw new Error('Use async version')
}

// parseXlsxRows async version using DecompressionStream properly
async function parseXlsxRowsAsync(bytes: Uint8Array): Promise<Array<Array<any>>> {
  const entries = parseZipEntries(bytes)

  async function extractEntry(entry: ZipEntry): Promise<string> {
    const pos = entry.offset
    const fileNameLen = readUint16LE(bytes, pos + 26)
    const extraLen = readUint16LE(bytes, pos + 28)
    const dataStart = pos + 30 + fileNameLen + extraLen
    const compressed = bytes.slice(dataStart, dataStart + entry.compressedSize)

    if (entry.compressionMethod === 0) {
      return new TextDecoder().decode(compressed)
    }
    if (entry.compressionMethod === 8) {
      const ds = new DecompressionStream('deflate-raw')
      const writer = ds.writable.getWriter()
      const reader = ds.readable.getReader()
      await writer.write(compressed)
      await writer.close()
      const chunks: Uint8Array[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      const total = chunks.reduce((s, c) => s + c.length, 0)
      const result = new Uint8Array(total)
      let off = 0
      for (const c of chunks) { result.set(c, off); off += c.length }
      return new TextDecoder().decode(result)
    }
    throw new Error(`Unsupported compression ${entry.compressionMethod}`)
  }

  let sharedStringsXml: string | null = null
  let sheetXml: string | null = null

  for (const entry of entries) {
    if (entry.name === 'xl/sharedStrings.xml') {
      sharedStringsXml = await extractEntry(entry)
    }
    if (entry.name === 'xl/worksheets/sheet1.xml') {
      sheetXml = await extractEntry(entry)
    }
  }

  if (!sheetXml) {
    for (const entry of entries) {
      if (entry.name.match(/xl\/worksheets\/sheet\d+\.xml/)) {
        sheetXml = await extractEntry(entry)
        break
      }
    }
  }

  if (!sheetXml) throw new Error('Không tìm thấy dữ liệu sheet trong file Excel')

  const sharedStrings: string[] = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : []
  return parseSheetXml(sheetXml, sharedStrings)
}

// parseSharedStrings: parse xl/sharedStrings.xml

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = []
  // Match <si>...</si> blocks
  const siMatches = xml.match(/<si>([\s\S]*?)<\/si>/g) || []
  for (const si of siMatches) {
    // Extract all <t>...</t> values and concatenate
    const tMatches = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []
    const text = tMatches.map(t => {
      return t.replace(/<t[^>]*>/, '').replace(/<\/t>/, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    }).join('')
    strings.push(text)
  }
  return strings
}

function parseSheetXml(xml: string, sharedStrings: string[]): Array<Array<any>> {
  const rows: Array<Array<any>> = []

  // Excel date serial → JS Date string
  function excelDateToString(serial: number): string | null {
    if (!serial || isNaN(serial)) return null
    // Excel date serial: 1 = Jan 1, 1900 (with off-by-one for Lotus bug)
    const msPerDay = 86400000
    const excelEpoch = new Date(1900, 0, 1).getTime() - msPerDay // start from Dec 31, 1899
    const jsDate = new Date(excelEpoch + serial * msPerDay)
    const y = jsDate.getFullYear()
    const m = String(jsDate.getMonth() + 1).padStart(2, '0')
    const d = String(jsDate.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  // Parse all <row>...</row>
  const rowMatches = xml.match(/<row[^>]*>([\s\S]*?)<\/row>/g) || []

  for (const rowXml of rowMatches) {
    // Get row index from r attribute
    const rowNumMatch = rowXml.match(/\br="(\d+)"/)
    // Parse all <c ...>...</c>
    const cellMatches = rowXml.match(/<c[^>]*>([\s\S]*?)<\/c>/g) || []

    const cellMap: Record<string, any> = {}

    for (const cellXml of cellMatches) {
      const refMatch = cellXml.match(/\br="([A-Z]+\d+)"/)
      if (!refMatch) continue
      const ref = refMatch[1]
      const colLetter = ref.replace(/\d/g, '')

      const typeMatch = cellXml.match(/\bt="([^"]+)"/)
      const cellType = typeMatch ? typeMatch[1] : null

      const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/)
      const fMatch = cellXml.match(/<f>([\s\S]*?)<\/f>/)
      const isMatch = cellXml.match(/<is>([\s\S]*?)<\/is>/)

      let value: any = null

      if (isMatch) {
        // Inline string
        const tM = isMatch[1].match(/<t[^>]*>([\s\S]*?)<\/t>/)
        value = tM ? tM[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : ''
      } else if (cellType === 's' && vMatch) {
        // Shared string
        const idx = parseInt(vMatch[1])
        value = sharedStrings[idx] ?? ''
      } else if (fMatch) {
        // Formula cell – ưu tiên đọc cached value <v> nếu có
        if (vMatch) {
          // Có cached value → dùng luôn (1.1, 1.2, ...)
          const raw = vMatch[1]
          const num = parseFloat(raw)
          value = isNaN(num) ? raw : num
        } else {
          // Không có cached value → giữ công thức dạng string để detect sub-item
          value = '=' + fMatch[1]
        }
      } else if (vMatch) {
        const raw = vMatch[1]
        const num = parseFloat(raw)
        // Check if it's a date (we'll check by column C usually, just pass numeric)
        if (!isNaN(num)) {
          value = num
        } else {
          value = raw
        }
      }

      cellMap[colLetter] = value
    }

    // Build row array [A, B, C, D, E]
    const a = cellMap['A'] ?? null
    const b = cellMap['B'] ?? null
    const c = cellMap['C'] ?? null
    const d = cellMap['D'] ?? null
    const e = cellMap['E'] ?? null

    // Skip completely empty rows
    if (a === null && b === null && c === null && d === null && e === null) continue

    // Convert date column C: if numeric and > 10000 it's likely Excel date serial
    let dateVal: any = c
    if (typeof c === 'number' && c > 10000) {
      dateVal = excelDateToString(c)
    } else if (typeof c === 'number' && c > 0 && c < 100) {
      // Thời gian text encoded as small number → bỏ qua
      dateVal = null
    }

    // Convert A: numeric → keep as-is (integer = parent, float = sub-item)
    // Formula strings như '=A3+0.1' được xử lý ở parseSheetXml đã resolve thành số
    let sttVal: any = a
    // Nếu A là float (ví dụ 1.1000000000000001), làm tròn đến 1 chữ số thập phân
    if (typeof a === 'number' && !Number.isInteger(a)) {
      sttVal = Math.round(a * 10) / 10  // 1.1000000000000001 → 1.1
    }

    rows.push([sttVal, b, dateVal, d, e])
  }

  return rows
}

// ===================================================
// STATIC FILES & SPA
// ===================================================
app.use('/static/*', serveStatic({ root: './' }))

// ============================================================
// WEB PUSH — VAPID + Subscriptions
// ============================================================

// ── VAPID helpers (pure Web Crypto, no lib needed) ──────────
function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let str = ''
  bytes.forEach(b => str += String.fromCharCode(b))
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
function b64urlDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s + '='.repeat((4 - s.length % 4) % 4))
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])
  const pub  = await crypto.subtle.exportKey('raw', kp.publicKey)
  const priv = await crypto.subtle.exportKey('pkcs8', kp.privateKey)
  return { publicKey: b64url(pub), privateKey: b64url(priv) }
}

async function makeVapidJWT(subject: string, audience: string, privateKeyB64: string): Promise<string> {
  const header  = b64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const now     = Math.floor(Date.now() / 1000)
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ aud: audience, exp: now + 12 * 3600, sub: subject })))
  const sigInput = `${header}.${payload}`

  const pkcs8 = b64urlDecode(privateKeyB64)
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(sigInput))
  return `${sigInput}.${b64url(sig)}`
}

async function sendWebPush(db: D1Database, userId: number, payload: object): Promise<void> {
  // Load VAPID config
  const rows = await db.prepare(
    `SELECT key, value FROM system_config WHERE key IN ('vapid_public_key','vapid_private_key','vapid_subject')`
  ).all()
  const cfg: Record<string, string> = {}
  rows.results.forEach((r: any) => { cfg[r.key] = r.value })

  if (!cfg.vapid_public_key || !cfg.vapid_private_key) return  // Not configured

  const subject = cfg.vapid_subject || 'mailto:admin@bimonecadvn.com'
  const bodyStr = JSON.stringify(payload)

  // Load all subscriptions for user
  const subs = await db.prepare(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?'
  ).bind(userId).all()

  for (const sub of subs.results as any[]) {
    try {
      const url    = new URL(sub.endpoint)
      const aud    = `${url.protocol}//${url.host}`
      const jwt    = await makeVapidJWT(subject, aud, cfg.vapid_private_key)
      const vapidAuth = `vapid t=${jwt},k=${cfg.vapid_public_key}`

      // Encrypt payload with ECDH + AES-GCM (RFC 8291)
      const encrypted = await encryptPushPayload(bodyStr, sub.p256dh, sub.auth)

      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          'Authorization':  vapidAuth,
          'Content-Type':   'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          'TTL':            '86400',
        },
        body: encrypted,
      })

      if (res.status === 410 || res.status === 404) {
        // Subscription expired — remove it
        await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run()
      }
      // Update last_used_at
      await db.prepare('UPDATE push_subscriptions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').bind(sub.id).run()
    } catch { /* silent — don't block notification flow */ }
  }
}

// RFC 8291 AES-GCM encryption for Web Push payload
async function encryptPushPayload(plaintext: string, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const encoder    = new TextEncoder()
  const receiverPub = b64urlDecode(p256dhB64)
  const authSecret  = b64urlDecode(authB64)

  // Generate sender ephemeral key pair
  const senderKP = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits'])
  const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderKP.publicKey))

  // Import receiver public key
  const receiverKey = await crypto.subtle.importKey('raw', receiverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])

  // ECDH shared secret
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, senderKP.privateKey, 256)
  const sharedSecret = new Uint8Array(sharedBits)

  // Salt
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // HKDF PRK (auth secret)
  const prkKey = await crypto.subtle.importKey('raw', authSecret, { name: 'HKDF' }, false, ['deriveBits'])
  const ikm = await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveBits'])

  // key_info and nonce_info as per RFC 8291
  const authInfo = concat(encoder.encode('WebPush: info\0'), receiverPub, senderPubRaw)
  const prkBits  = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: authInfo }, ikm, 256)
  const prk = await crypto.subtle.importKey('raw', prkBits, { name: 'HKDF' }, false, ['deriveBits'])

  const keyInfo   = encoder.encode('Content-Encoding: aes128gcm\0')
  const nonceInfo = encoder.encode('Content-Encoding: nonce\0')

  const cekBits   = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: keyInfo   }, prk, 128)
  const nonceBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo }, prk, 96)

  const cek   = await crypto.subtle.importKey('raw', cekBits, { name: 'AES-GCM' }, false, ['encrypt'])
  const nonce = new Uint8Array(nonceBits)

  // Pad plaintext (add 0x02 padding delimiter)
  const data = concat(encoder.encode(plaintext), new Uint8Array([2]))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cek, data))

  // Build RFC 8291 header: salt(16) + rs(4) + idlen(1) + keyid + ciphertext
  const rs      = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096, false)
  const keyId   = senderPubRaw
  const idLen   = new Uint8Array([keyId.length])
  return concat(salt, rs, idLen, keyId, ciphertext)
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(len)
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}

// ── GET /api/push/vapid-public-key — trả public key cho client ──
app.get('/api/push/vapid-public-key', authMiddleware, async (c) => {
  try {
    const db = c.env.DB
    let row = await db.prepare(`SELECT value FROM system_config WHERE key = 'vapid_public_key'`).first() as any

    if (!row?.value) {
      // Auto-generate keys on first call
      const keys = await generateVapidKeys()
      await db.prepare(`UPDATE system_config SET value = ? WHERE key = 'vapid_public_key'`).bind(keys.publicKey).run()
      await db.prepare(`UPDATE system_config SET value = ? WHERE key = 'vapid_private_key'`).bind(keys.privateKey).run()
      return c.json({ publicKey: keys.publicKey })
    }
    return c.json({ publicKey: row.value })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── POST /api/push/subscribe — lưu subscription ─────────────
app.post('/api/push/subscribe', authMiddleware, async (c) => {
  try {
    const db   = c.env.DB
    const user = c.get('user') as any
    const { endpoint, keys } = await c.req.json()
    if (!endpoint || !keys?.p256dh || !keys?.auth) return c.json({ error: 'Invalid subscription' }, 400)

    const ua = c.req.header('User-Agent')?.slice(0, 200) || ''
    await db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, endpoint) DO UPDATE SET
         p256dh = excluded.p256dh, auth = excluded.auth, last_used_at = CURRENT_TIMESTAMP`
    ).bind(user.id, endpoint, keys.p256dh, keys.auth, ua).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── DELETE /api/push/unsubscribe — xóa subscription ─────────
app.delete('/api/push/unsubscribe', authMiddleware, async (c) => {
  try {
    const db   = c.env.DB
    const user = c.get('user') as any
    const { endpoint } = await c.req.json()
    if (endpoint) {
      await db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').bind(user.id, endpoint).run()
    } else {
      await db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(user.id).run()
    }
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok', version: '1.0.0' }))

// Service Worker — must be served from root scope with correct MIME type
app.get('/sw.js', serveStatic({ path: './sw.js' }))

// Push notification icons
app.get('/icon-192.png',  serveStatic({ path: './icon-192.png' }))
app.get('/badge-72.png',  serveStatic({ path: './badge-72.png' }))

// SPA - serve index.html as static asset via Cloudflare Pages
// The _routes.json excludes /index.html and /static/* from the worker
// For local dev with wrangler, we serve it directly
app.get('/', serveStatic({ path: './index.html' }))
app.get('/index.html', serveStatic({ path: './index.html' }))

export default app
