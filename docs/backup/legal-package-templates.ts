// Backup only. The app does not import this file.
// Gói thầu mẫu và checklist A–D đã ngừng tạo sẵn từ 2026-09-29.
// Dự án mới để trống hồ sơ: tự nhập hoặc sao chép từ dự án khác.

// ── Default stages & items template ─────────────────────────────────────────
const DEFAULT_LEGAL_STAGES = [
  {
    code: 'A', name: 'Hồ sơ BCNCKT (Báo cáo nghiên cứu khả thi)', sort_order: 1,
    items: [
      { stt: '1', title: 'Hồ sơ nhiệm vụ và dự toán', item_type: 'group', children: [
        { stt: '1.1', title: 'Đề cương nhiệm vụ', item_type: 'document' },
        { stt: '1.2', title: 'Dự toán chi phí tư vấn', item_type: 'document' },
        { stt: '1.3', title: 'Phê duyệt đề cương và dự toán', item_type: 'document' },
      ]},
      { stt: '2', title: 'Sản phẩm BIM giai đoạn BCNCKT', item_type: 'group', children: [
        { stt: '2.1', title: 'Mô hình BIM BCNCKT', item_type: 'document' },
        { stt: '2.2', title: 'Báo cáo kết quả BCNCKT', item_type: 'document' },
        { stt: '2.3', title: 'Nộp và bàn giao sản phẩm', item_type: 'task' },
      ]},
    ]
  },
  {
    code: 'B', name: 'Hồ sơ GĐTK (Thiết kế kỹ thuật)', sort_order: 2,
    items: [
      { stt: '1', title: 'Hồ sơ hợp đồng tư vấn', item_type: 'group', children: [
        { stt: '1.1', title: 'Hợp đồng tư vấn thiết kế', item_type: 'document' },
        { stt: '1.2', title: 'Phụ lục hợp đồng (nếu có)', item_type: 'document' },
        { stt: '1.3', title: 'Kế hoạch thực hiện BIM (BEP)', item_type: 'document' },
      ]},
      { stt: '2', title: 'Hồ sơ thiết kế kỹ thuật', item_type: 'group', children: [
        { stt: '2.1', title: 'Báo cáo triển khai BIM định kỳ', item_type: 'task' },
        { stt: '2.2', title: 'Mô hình BIM GĐTK', item_type: 'document' },
        { stt: '2.3', title: 'Hồ sơ thiết kế bản vẽ kỹ thuật', item_type: 'document' },
        { stt: '2.4', title: 'Dự toán công trình', item_type: 'document' },
      ]},
      { stt: '3', title: 'Nghiệm thu và bàn giao GĐTK', item_type: 'group', children: [
        { stt: '3.1', title: 'Biên bản nghiệm thu sản phẩm tư vấn', item_type: 'document' },
        { stt: '3.2', title: 'Phê duyệt thiết kế kỹ thuật', item_type: 'document' },
        { stt: '3.3', title: 'Đề nghị thanh toán', item_type: 'document' },
      ]},
    ]
  },
  {
    code: 'C', name: 'Hồ sơ Thi công', sort_order: 3,
    items: [
      { stt: '1', title: 'Hồ sơ hợp đồng tư vấn thi công', item_type: 'group', children: [
        { stt: '1.1', title: 'Hợp đồng tư vấn thi công', item_type: 'document' },
        { stt: '1.2', title: 'Phụ lục hợp đồng (nếu có)', item_type: 'document' },
        { stt: '1.3', title: 'BEP giai đoạn thi công', item_type: 'document' },
      ]},
      { stt: '2', title: 'Hồ sơ bản vẽ thi công', item_type: 'group', children: [
        { stt: '2.1', title: 'Bản vẽ thi công chi tiết', item_type: 'document' },
        { stt: '2.2', title: 'Mô hình BIM thi công', item_type: 'document' },
        { stt: '2.3', title: 'Bảng thống kê khối lượng', item_type: 'document' },
        { stt: '2.4', title: 'Báo cáo giám sát thi công định kỳ', item_type: 'task' },
      ]},
      { stt: '3', title: 'Nghiệm thu và thanh toán', item_type: 'group', children: [
        { stt: '3.1', title: 'Biên bản nghiệm thu từng đợt', item_type: 'document' },
        { stt: '3.2', title: 'Xác nhận khối lượng hoàn thành (Mẫu 3A)', item_type: 'document' },
        { stt: '3.3', title: 'Giấy đề nghị thanh toán', item_type: 'document' },
      ]},
    ]
  },
  {
    code: 'D', name: 'Hồ sơ Hoàn công', sort_order: 4,
    items: [
      { stt: '1', title: 'Hồ sơ hoàn công BIM', item_type: 'group', children: [
        { stt: '1.1', title: 'Mô hình BIM hoàn công (As-built)', item_type: 'document' },
        { stt: '1.2', title: 'Bản vẽ hoàn công', item_type: 'document' },
        { stt: '1.3', title: 'Báo cáo tổng kết triển khai BIM', item_type: 'document' },
      ]},
      { stt: '2', title: 'Nghiệm thu hoàn công và thanh lý', item_type: 'group', children: [
        { stt: '2.1', title: 'Biên bản nghiệm thu hoàn thành toàn bộ', item_type: 'document' },
        { stt: '2.2', title: 'Mẫu số 3A - Xác nhận khối lượng hoàn thành', item_type: 'document' },
        { stt: '2.3', title: 'Giấy đề nghị thanh toán lần cuối', item_type: 'document' },
        { stt: '2.4', title: 'Thanh lý hợp đồng', item_type: 'document' },
      ]},
    ]
  },
]

// ── Template 4 giai đoạn A-B-C-D cho mỗi gói thầu ──────────────────────────
// Dùng khi tạo gói thầu mới. Tên giai đoạn có thể đổi tùy dự án.
const DEFAULT_STAGES_FOR_PACKAGE = [
  {
    code: 'A', name: 'A. Chuẩn bị & Dự thầu', sort_order: 1,
    items: [
      { stt: '1', title: 'Hồ sơ năng lực dự thầu', item_type: 'group', children: [
        { stt: '1.1', title: 'Đề cương nhiệm vụ & Dự toán chi phí', item_type: 'document' },
        { stt: '1.2', title: 'Thư ngỏ / Thư cam kết thực hiện', item_type: 'document' },
        { stt: '1.3', title: 'Hồ sơ năng lực nhà thầu', item_type: 'document' },
      ]},
      { stt: '2', title: 'Phê duyệt chủ trương & Kế hoạch lựa chọn nhà thầu', item_type: 'document', children: [] },
    ]
  },
  {
    code: 'B', name: 'B. Ký hợp đồng', sort_order: 2,
    items: [
      { stt: '1', title: 'Thương thảo và ký hợp đồng', item_type: 'group', children: [
        { stt: '1.1', title: 'Công văn tham gia thương thảo hợp đồng', item_type: 'document' },
        { stt: '1.2', title: 'Biên bản thương thảo hợp đồng', item_type: 'document' },
        { stt: '1.3', title: 'Hợp đồng kinh tế', item_type: 'document' },
      ]},
      { stt: '2', title: 'Hồ sơ sau ký hợp đồng', item_type: 'group', children: [
        { stt: '2.1', title: 'Bảo lãnh tạm ứng (nếu có)', item_type: 'document' },
        { stt: '2.2', title: 'Đơn đề nghị tạm ứng', item_type: 'document' },
        { stt: '2.3', title: 'Quyết định thành lập tổ chuyên gia', item_type: 'document' },
        { stt: '2.4', title: 'Kế hoạch thực hiện BIM (BEP)', item_type: 'document' },
      ]},
    ]
  },
  {
    code: 'C', name: 'C. Thực hiện & Sản phẩm BIM', sort_order: 3,
    items: [
      { stt: '1', title: 'Triển khai thực hiện', item_type: 'group', children: [
        { stt: '1.1', title: 'Báo cáo triển khai BIM định kỳ', item_type: 'task' },
        { stt: '1.2', title: 'Họp phối hợp BIM', item_type: 'task' },
        { stt: '1.3', title: 'Phụ lục hợp đồng (nếu phát sinh)', item_type: 'document' },
      ]},
      { stt: '2', title: 'Nộp sản phẩm', item_type: 'group', children: [
        { stt: '2.1', title: 'Mô hình BIM và hồ sơ thiết kế', item_type: 'document' },
        { stt: '2.2', title: 'Báo cáo tổng kết & Bàn giao sản phẩm', item_type: 'document' },
      ]},
    ]
  },
  {
    code: 'D', name: 'D. Nghiệm thu & Thanh toán', sort_order: 4,
    items: [
      { stt: '1', title: 'Nghiệm thu', item_type: 'group', children: [
        { stt: '1.1', title: 'Biên bản nghiệm thu sản phẩm tư vấn', item_type: 'document' },
        { stt: '1.2', title: 'Mẫu 3A - Xác nhận khối lượng hoàn thành', item_type: 'document' },
      ]},
      { stt: '2', title: 'Thanh toán', item_type: 'group', children: [
        { stt: '2.1', title: 'Giấy đề nghị thanh toán', item_type: 'document' },
        { stt: '2.2', title: 'Hóa đơn tài chính', item_type: 'document' },
        { stt: '2.3', title: 'Thanh lý hợp đồng', item_type: 'document' },
      ]},
    ]
  },
]

// Tên package mặc định theo loại
const DEFAULT_PACKAGE_NAMES: Record<string, string> = {
  bcnckt:       'Gói BCNCKT (Báo cáo nghiên cứu khả thi)',
  tkbvtc:       'Gói TKBVTC (Thiết kế bản vẽ thi công)',
  construction: 'Gói Thi công & Hoàn công',
  custom:       'Gói thầu tùy chỉnh',
}

