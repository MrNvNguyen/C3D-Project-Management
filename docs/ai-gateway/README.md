# Kết nối DDCN với trợ lý điều hành ChatGPT

Phạm vi v1: quản lý dự án và phòng ban. R&D chưa liên kết. Không thay đổi cơ sở dữ liệu; không gọi mô hình AI và không cần khóa OpenAI API.

## Đưa lên Cloudflare

1. Kiểm tra và hợp nhất nhánh này, build/deploy theo quy trình hiện có. Thử trên môi trường preview trước.
2. Trong cấu hình Cloudflare Pages của dự án, đặt hai biến dạng Secret: `AI_GATEWAY_KEY` (chuỗi ngẫu nhiên tối thiểu 32 ký tự) và `AI_GATEWAY_USER_ID` (ID tài khoản DDCN system_admin đang hoạt động mà anh cho phép đọc dữ liệu toàn công ty). Có thể tạo khóa bằng `openssl rand -hex 32`; chỉ nhập vào Cloudflare và màn hình cấu hình Action, không đưa lên GitHub/chat.
3. Redeploy để nhận biến mới. Thiếu cấu hình, cổng trả 503 và không đọc dữ liệu. Không cần chạy migration D1.
4. Kiểm thử GET `/api/ai/v1/overview` bằng Authorization: Bearer <khóa>. Sai/thiếu khóa trả 401; tài khoản bị vô hiệu hóa hoặc đổi vai trò trả 403. Kiểm tra projects, tasks, workload bằng dữ liệu thực tế.

## Kết nối ChatGPT

Tạo GPT riêng cho anh, thêm Action bằng nội dung `openapi.json`, chọn xác thực API Key và kiểu Bearer, nhập khóa trên màn hình xác thực. Tài liệu chính thức: https://developers.openai.com/api/docs/actions/authentication

Giữ GPT ở chế độ riêng tư: Action dùng quyền của tài khoản được cấu hình, không tự phân quyền từng người trò chuyện. Dữ liệu trả về sẽ được gửi đến ChatGPT khi gọi Action. Đường dẫn REST này không phải máy chủ MCP và không tự xuất hiện trong cuộc trò chuyện ChatGPT hiện tại.

Dán nội dung `instructions.md` làm hướng dẫn trợ lý. Thử: “Các dự án có công việc quá hạn?”, “Ai đang có nhiều công việc tồn?”, “Tổng hợp việc anh cần xử lý hôm nay”. Test từng Action và đối chiếu Dashboard DDCN trước khi sử dụng báo cáo.

## Dữ liệu và vận hành

- `/overview`: thống kê dự án, việc mở/quá hạn/chưa phân công, nhân sự theo phòng ban.
- `/projects`: thông tin tiến độ khai báo, số việc, số việc hoàn thành hoặc đang review, số việc quá hạn.
- `/tasks`: việc mở, lọc project_id, overdue=true; tên người phụ trách chính.
- `/workload`: việc mở/quá hạn theo người, tổng giờ khai báo 7 ngày (trừ bị từ chối; có thể chưa duyệt). Không kết luận hiệu suất từ số giờ.
- Phân trang limit 1–100, offset 0–100000; đọc next_offset đến null. Không coi trang đầu là toàn bộ dữ liệu.
- Theo quy tắc đang dùng trong DDCN, trạng thái review được gộp cùng completed khi đếm việc không còn mở; không suy diễn review là đã nghiệm thu.
- Ngày tính theo Việt Nam. generated_at ghi thời gian truy xuất, không phải lần cập nhật cuối của dữ liệu.
- Không xuất lương, mật khẩu, số điện thoại, email, CCCD, tài khoản ngân hàng, giá trị hợp đồng hay nội dung tệp đính kèm.
- Nhật ký Cloudflare ghi request_id, tài khoản, đường dẫn, trạng thái, thời lượng; không ghi khóa/nội dung báo cáo. Theo dõi lưu lượng và cấu hình rate limit của Cloudflare nếu cần.
- Tắt kết nối: xóa AI_GATEWAY_KEY và redeploy. Đổi khóa: thay Secret, redeploy, cập nhật Action. Không cấp khóa này cho công cụ cần quyền hạn hẹp hơn.

Kiểm thử tự động: `npm test`; build: `npm run build`. Cần kiểm thử D1 thật ở preview sau khi deploy; mock test không thay thế kiểm tra dữ liệu vận hành.
