# OAuth cho OneCAD DDCN

## Phạm vi

OAuth Authorization Code + PKCE S256 dùng tài khoản DDCN hiện có. Chỉ principal `AI_GATEWAY_USER_ID` với role `system_admin`, `is_active=1` được cấp scope `ddcn:read`. Token không phải JWT đăng nhập DDCN; không mở rộng quyền sang API ghi. GPT Actions và khóa Bearer cũ tiếp tục hoạt động.

Issuer cố định: `https://ddcn.bimonecadvn.com`.
Resource: `https://ddcn.bimonecadvn.com/api/ai/v1/mcp`.
Discovery: `/.well-known/oauth-protected-resource/api/ai/v1/mcp` và `/.well-known/oauth-authorization-server`.
DCR: `/oauth/ddcn/register`, chỉ chấp nhận một callback chính xác `https://chatgpt.com/connector_platform_oauth_redirect`. Hỗ trợ RFC9207 `iss` để ChatGPT dùng callback ổn định. Nếu client hiển thị callback khác, không dùng wildcard: kiểm tra callback và điều chỉnh allowlist trước khi kết nối.

Trang consent `/oauth/ddcn/authorize` sử dụng phiên DDCN ở localStorage `bim_token`, qua Authorization header khi người dùng bấm Cho phép. Người dùng chưa đăng nhập mở DDCN trong tab khác rồi quay lại. Không gửi password hay JWT đăng nhập sang ChatGPT.

Mã cấp quyền hết hạn 5 phút, tiêu thụ bằng DELETE RETURNING nguyên tử, ràng buộc client/callback/resource/PKCE. Chỉ lưu SHA256 của code và token. Access token hết hạn 8 giờ. Refresh token tự xoay vòng sau mỗi lần dùng, chỉ lưu SHA256 và có thời hạn tuyệt đối 30 ngày kể từ lần cấp quyền; sau đó cần kết nối lại. Gia hạn kiểm tra lại tài khoản quản trị đang hoạt động, principal, audience và scope. Token cũ được tiêu thụ nguyên tử; gia hạn thành công thu hồi access token cũ. Thu hồi access hoặc refresh token vô hiệu hóa cả cặp hiện tại. Nếu lỗi lưu trữ xảy ra sau khi tiêu thụ token, kết nối cần cấp quyền lại (fail closed). Có endpoint `/oauth/ddcn/revoke`.

## Triển khai

1. Áp dụng migration `0072_ddcn_oauth.sql` trên D1 trước khi bật mã mới. Migration chỉ thêm ba bảng riêng, không sửa bảng nghiệp vụ.
2. Triển khai nhánh đã được review. Các binding DB, JWT_SECRET, AI_GATEWAY_KEY, AI_GATEWAY_USER_ID hiện có vẫn cần đầy đủ; không thêm khóa bí mật mới.
3. Kiểm tra hai discovery URL trả JSON, issuer/resource đúng, `code_challenge_methods_supported` có S256. Anonymous initialize/tools/list chỉ trả metadata; tools/call cần auth và trả401 kèm WWW-Authenticate nếu chưa có token.
4. Plugins → Add custom MCP server, URL resource ở trên, chọn OAuth; để tự khám phá, dùng Dynamic Client Registration (public client, token endpoint auth none) khi giao diện yêu cầu chọn phương thức.
5. Đăng nhập DDCN bằng đúng tài khoản đã cấu hình và xác nhận Cho phép đọc. Kiểm tra bốn công cụ và đối chiếu dữ liệu dashboard.
6. Sao chép ID kết nối `plugin_asdk_app...` sau khi tạo thành công để liên kết vào `.app.json` của gói marketplace. Không nhầm ID này với ID user DDCN. Gói `.mcp.json` hiện tại dành cho client local; chưa có registered app mapping cho ChatGPT web.

Chưa xác nhận callback và luồng OAuth trên tài khoản production. Không coi test mock là bằng chứng liên kết ChatGPT thành công. DCR public cần quy tắc rate limit của Cloudflare cho `/oauth/ddcn/register`; bảng client sẽ tăng khi tạo kết nối mới. Bản này dành cho kết nối nội bộ ChatGPT, chưa hỗ trợ client metadata URL CIMD hoặc các callback Codex khác.

Tham chiếu: https://developers.openai.com/plugins/build/auth

## Nâng cấp refresh token

Áp dụng `migrations/0073_ddcn_oauth_refresh.sql` trên D1 production trước khi triển khai bản refresh. Migration chỉ thêm bảng OAuth độc lập, có thể chạy lại. Sau deployment, làm mới công cụ/metadata plugin và ngắt kết nối rồi cấp quyền lại một lần: access token cũ không tự nhận refresh token. Không cần đổi AI_GATEWAY_KEY hay JWT_SECRET. ChatGPT phải lưu và dùng refresh token mới nhất trả về trong mỗi lần gia hạn. Chưa xác nhận tác vụ định kỳ có tự gia hạn cho tới khi kiểm tra trên host thực tế.

## Thu hồi an toàn khi gia hạn đồng thời

Refresh token đã dùng được giữ dưới dạng hash với expiry âm tới thời hạn gốc để nhận diện yêu cầu thu hồi. Thu hồi bằng access/refresh token hợp lệ (kể cả token đã xoay vòng) xóa OAuth client riêng của kết nối và toàn bộ token của client đó. Các client khác không bị ảnh hưởng. Cấp token dùng INSERT SELECT có điều kiện client còn tồn tại trong cùng D1 batch; gateway cũng yêu cầu client còn tồn tại. Vì vậy token tiếp nối không dùng được sau khi thu hồi, kể cả refresh đang chạy. Sau thu hồi phải đăng ký client DCR mới; Client ID nhập tay cũ không tái sử dụng. Bảng refresh được tạo bằng CREATE TABLE IF NOT EXISTS ở endpoint token/revoke nếu migration 0073 chưa chạy; migration vẫn bổ sung các index, nên khuyến nghị áp dụng.
