# Đăng ký protocol bimfolder:// cho user hiện tại (HKCU). Chạy từ thư mục chứa bimfolder.ps1.

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'bimfolder.ps1'

if (-not (Test-Path -LiteralPath $scriptPath)) {

  Write-Error "Không thấy $scriptPath"

}

$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

$cmd = "`"$ps`" -NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File `"$scriptPath`" `"%1`""

$base = 'HKCU:\Software\Classes\bimfolder'

New-Item -Path $base -Force | Out-Null

Set-ItemProperty -Path $base -Name '(default)' -Value 'URL:BIM Folder Protocol'

New-ItemProperty -Path $base -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null

$icon = Join-Path $base 'DefaultIcon'

New-Item -Path $icon -Force | Out-Null

Set-ItemProperty -Path $icon -Name '(default)' -Value 'explorer.exe,0'

$open = Join-Path $base 'shell\open\command'

New-Item -Path $open -Force | Out-Null

Set-ItemProperty -Path $open -Name '(default)' -Value $cmd

Write-Host "Registered bimfolder protocol -> $scriptPath"

$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'BIM Folder Helper.lnk'
try {
  $wsh = New-Object -ComObject WScript.Shell
  $sc = $wsh.CreateShortcut($shortcutPath)
  $sc.TargetPath = $ps
  $sc.Arguments = "-NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File `"$scriptPath`" -Listen"
  $sc.WorkingDirectory = $PSScriptRoot
  $sc.WindowStyle = 7
  $sc.Description = 'QLy HSTK bimfolder localhost helper (8765)'
  $sc.Save()
  Write-Host "Startup shortcut -> $shortcutPath"
} catch {
  Write-Warning "Could not create Startup shortcut: $($_.Exception.Message)"
}

function Merge-AutoLaunchProtocolsJson {

  param(

    [string]$ExistingJson,

    [string[]]$AllowedOrigins,

    [string]$Protocol

  )

  $list = @()

  if ($ExistingJson) {

    try {

      $parsed = $ExistingJson | ConvertFrom-Json

      if ($parsed -is [System.Array]) { $list = @($parsed) }

      elseif ($parsed) { $list = @($parsed) }

    } catch {

      Write-Warning 'Could not parse existing AutoLaunchProtocolsFromOrigins; replacing bimfolder entry only.'

      $list = @()

    }

  }

  $origins = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

  $idx = -1

  for ($i = 0; $i -lt $list.Count; $i++) {

    if ($list[$i].protocol -eq $Protocol) { $idx = $i; break }

  }

  if ($idx -ge 0) {

    foreach ($o in $list[$idx].allowed_origins) { [void]$origins.Add([string]$o) }

  }

  foreach ($o in $AllowedOrigins) { [void]$origins.Add($o) }

  $merged = @{

    allowed_origins = @($origins)

    protocol        = $Protocol

  }

  if ($idx -ge 0) { $list[$idx] = [pscustomobject]$merged }

  else { $list += [pscustomobject]$merged }

  ($list | ConvertTo-Json -Compress -Depth 5)

}



$autoLaunchOrigins = @(

  'http://127.0.0.1:8788',

  'http://localhost:8788',

  'https://bim.onecadvn.com'

)

$autoLaunchKeys = @(

  'HKCU:\Software\Policies\Microsoft\Edge\AutoLaunchProtocolsFromOrigins',

  'HKCU:\Software\Policies\Google\Chrome\AutoLaunchProtocolsFromOrigins'

)

foreach ($keyPath in $autoLaunchKeys) {
  try {
    New-Item -Path $keyPath -Force -ErrorAction Stop | Out-Null
    $existing = (Get-ItemProperty -Path $keyPath -Name '(default)' -ErrorAction SilentlyContinue).'(default)'
    $json = Merge-AutoLaunchProtocolsJson -ExistingJson $existing -AllowedOrigins $autoLaunchOrigins -Protocol 'bimfolder'
    Set-ItemProperty -Path $keyPath -Name '(default)' -Value $json -Type String -ErrorAction Stop
    Write-Host "AutoLaunchProtocolsFromOrigins -> $keyPath"
    Write-Host "  $json"
  } catch {
    Write-Warning "Could not write $keyPath : $($_.Exception.Message)"
    Write-Warning 'Run this script again in your own PowerShell (outside restricted automation) if Chon folder still shows Open External Link.'
  }
}



Write-Host 'Done. Quit Edge/Chrome fully, reopen, Ctrl+F5, then Chon folder on QLy HSTK.'


