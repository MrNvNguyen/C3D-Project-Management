# Cài bộ bimfolder (QLy HSTK)



1. Copy cả thư mục `tools/bimfolder` vào ổ cố định (vd `C:\Onecad\bimfolder` hoặc `C:\OneCad\bimfolder`).

2. Sửa file `bimfolder.ps1` nếu cần: mảng `$AllowedAppOrigins` (mặc định gồm dev `http://127.0.0.1:8788` và production `https://ddcn.bimonecadvn.com`; listener vẫn `http://127.0.0.1:8765`).

3. **Quan trọng:** Chuột phải `install-bimfolder.ps1` → **Run with PowerShell** (hoặc trong PowerShell: `Set-ExecutionPolicy -Scope Process Bypass; & '.\install-bimfolder.ps1'`).  

   Không dùng `install-bimfolder.reg` trực tiếp — Windows **không** hiểu `%~dp0` trong registry, protocol sẽ không gọi được script.

4. Sau khi chạy install, **đóng hẳn** Chrome/Edge rồi mở lại → **Ctrl+F5** tab dự án → QLy HSTK → **Khai báo bộ môn** (nếu chưa có) → **Chọn folder**. Lần đầu (helper chưa chạy) trình duyệt có thể hỏi **một lần** khi mở `bimfolder:listen`; sau khi helper lắng nghe `http://127.0.0.1:8765`, **Chọn folder** / mở đường dẫn dùng fetch — không còn hộp “Open External Link” cho pick.



Gỡ cài: chạy `uninstall-bimfolder.reg`, sau đó xóa thư mục bimfolder nếu muốn.



**Lưu ý:** Script gửi callback về đúng origin trang đang mở (nếu nằm trong `$AllowedAppOrigins`), mặc định `http://127.0.0.1:8788`. Gốc NAS (`nas_root_path`) trống = cho phép chọn folder local khi dev; khi đã cấu hình NAS, đường dẫn phải nằm dưới gốc đó.

