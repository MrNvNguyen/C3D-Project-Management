# Cài bộ bimfolder (QLy HSTK)



1. Copy cả thư mục `tools/bimfolder` vào ổ cố định (vd `C:\Onecad\bimfolder` hoặc `C:\OneCad\bimfolder`).

2. Sửa file `bimfolder.ps1` nếu cần: mảng `$AllowedAppOrigins` (mặc định gồm dev `http://127.0.0.1:8788` và production `https://ddcn.bimonecadvn.com`; listener vẫn `http://127.0.0.1:8765`).

3. **Quan trọng:** Chuột phải `install-bimfolder.ps1` → **Run with PowerShell** (hoặc trong PowerShell: `Set-ExecutionPolicy -Scope Process Bypass; & '.\install-bimfolder.ps1'`).  

   Không dùng `install-bimfolder.reg` trực tiếp — Windows **không** hiểu `%~dp0` trong registry, protocol sẽ không gọi được script.

4. Cửa sổ cài phải in dòng `Helper dang chay: http://127.0.0.1:8765/health`. Nếu Windows hỏi UAC, bấm **Yes** — máy user thường không được mở cổng 8765 nếu thiếu bước này. Shortcut khởi động cùng Windows được tạo trong Startup của user đang cài.

5. **Đóng hẳn** Chrome/Edge rồi mở lại → **Ctrl+F5**. Trang production là HTTPS nên trình duyệt có thể hỏi quyền **mạng nội bộ / local network** khi bấm mở folder: chọn **Cho phép**. Không cho phép thì link folder báo không kết nối helper dù helper đang chạy.



Gỡ cài: chạy `uninstall-bimfolder.reg`, sau đó xóa thư mục bimfolder nếu muốn.



**Lưu ý:** Script gửi callback về đúng origin trang đang mở (nếu nằm trong `$AllowedAppOrigins`), mặc định `http://127.0.0.1:8788`. Gốc NAS (`nas_root_path`) trống = cho phép chọn folder local khi dev; khi đã cấu hình NAS, đường dẫn phải nằm dưới gốc đó.

