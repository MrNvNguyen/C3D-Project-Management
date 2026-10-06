# Cài helper cho máy user

Dành cho máy chỉ mở trang [https://ddcn.bimonecadvn.com/#/projects](https://ddcn.bimonecadvn.com/#/projects).

Trang web không mở được folder NAS nếu máy đó chưa có helper. Helper chạy tại `127.0.0.1:8765` trên chính máy user.

## Máy cài được ngay

1. Copy cả thư mục này sang máy user.
2. Double-click `CaiDat-MayUser.bat`.
3. Nếu Windows hỏi UAC, bấm **Yes**.
4. Đóng hẳn Chrome/Edge, mở lại trang dự án, nhấn Ctrl+F5.
5. Lần đầu bấm mở folder, nếu trình duyệt hỏi quyền mạng nội bộ, chọn **Cho phép**.

## Máy bị chặn (Smart App Control)

Hộp thoại **Smart App Control blocked a file** nghĩa là Windows chặn file vì thư mục được copy từ mạng, Zalo hoặc USB. Máy không bật Smart App Control thì không gặp hộp này và cài được luôn.

1. Bấm **OK** trên hộp thoại.
2. Mở Start, gõ `powershell`, Enter.
3. Dán đúng đường dẫn thư mục đang chứa `CaiDat-MayUser.bat` (ảnh mẫu là `C:\Onecad\bimfolder`):

```powershell
Get-ChildItem -LiteralPath 'C:\Onecad\bimfolder' -File | Unblock-File
powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\Onecad\bimfolder\CaiDat-MayUser.ps1'
```

4. Nếu có cửa sổ UAC, bấm **Yes**.
5. Đóng hẳn Chrome/Edge, mở lại trang, Ctrl+F5. Trình duyệt hỏi mạng nội bộ thì chọn **Cho phép**.

Cách khác, từng file: chuột phải `CaiDat-MayUser.bat` → **Properties** → tick **Unblock** (Bỏ chặn) → OK. Làm tương tự với `CaiDat-MayUser.ps1`, `install-bimfolder.ps1` và `bimfolder.ps1`, rồi double-click lại file `.bat`.
