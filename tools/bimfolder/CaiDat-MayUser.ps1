# User installer for https://ddcn.bimonecadvn.com only.
# Double-click CaiDat-MayUser.bat. Helper listens on 127.0.0.1:8765 on this PC.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$src = $PSScriptRoot
$dest = Join-Path $env:LOCALAPPDATA 'Onecad\bimfolder'
$site = 'https://ddcn.bimonecadvn.com'

function Show-Result([string]$text, [string]$title, $icon) {
  [System.Windows.Forms.MessageBox]::Show($text, $title, 'OK', $icon) | Out-Null
}

# File copy từ mạng/Zalo/USB thường bị Smart App Control chặn (Mark of the Web).
Get-ChildItem -LiteralPath $src -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

$needed = @('bimfolder.ps1', 'install-bimfolder.ps1', 'bimfolder.cmd', 'uninstall-bimfolder.reg')
foreach ($name in $needed) {
  $from = Join-Path $src $name
  if (-not (Test-Path -LiteralPath $from)) {
    Show-Result "Thiếu file $name. Giải nén cả thư mục rồi chạy lại CaiDat-MayUser.bat." 'Cài bimfolder' 'Error'
    exit 1
  }
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
foreach ($name in $needed) {
  Copy-Item -LiteralPath (Join-Path $src $name) -Destination (Join-Path $dest $name) -Force
  Unblock-File -LiteralPath (Join-Path $dest $name) -ErrorAction SilentlyContinue
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dest 'install-bimfolder.ps1')
if ($LASTEXITCODE -ne 0) {
  Show-Result "Cài chưa xong. Nếu có cửa sổ UAC, bấm Yes rồi chạy lại CaiDat-MayUser.bat.`r`n`r`nChi tiết: $env:LOCALAPPDATA\bimfolder\listener.log" 'Cài bimfolder' 'Warning'
  exit 1
}

$healthOk = $false
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8765/health' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
  $healthOk = ($r.StatusCode -eq 200)
} catch { }

if (-not $healthOk) {
  Show-Result "Chưa mở được 127.0.0.1:8765 trên máy này.`r`nChạy lại CaiDat-MayUser.bat và bấm Yes ở cửa sổ UAC.`r`n`r`nLog: $env:LOCALAPPDATA\bimfolder\listener.log" 'Cài bimfolder' 'Warning'
  exit 1
}

$done = "Đã cài helper trên máy này (127.0.0.1:8765).`r`n`r`n1. Đóng hẳn Chrome hoặc Edge, mở lại.`r`n2. Vào $site/#/projects rồi nhấn Ctrl+F5.`r`n3. Nếu trình duyệt hỏi quyền mạng nội bộ, chọn Cho phép.`r`n4. Mở lại link folder trong dự án."
Show-Result $done 'Cài bimfolder' 'Information'
exit 0
