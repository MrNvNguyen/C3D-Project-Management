param(
  [string]$Uri,
  [switch]$Listen,
  [switch]$SelfTest
)

# Danh sách origin app được phép — IT chỉnh mảng $AllowedAppOrigins khi triển khai (không lấy từ tham số api trên link).
# Listener luôn chạy local (HttpListener không bind HTTPS production).
$DefaultAppApiBase = 'http://127.0.0.1:8788'
$ListenerPrefix = 'http://127.0.0.1:8765/'
$AllowedAppOrigins = @(
  'http://127.0.0.1:8788',
  'http://localhost:8788',
  'https://ddcn.bimonecadvn.com'
)

Add-Type -AssemblyName System.Web

$script:ScanToken = $null
$script:MyScriptPath = $MyInvocation.MyCommand.Path
$script:LastAllowedAppOrigin = $null

function Normalize-AppOrigin([string]$origin) {
  if (-not $origin) { return $null }
  return $origin.Trim().TrimEnd('/')
}

function Test-AllowedAppOrigin([string]$origin) {
  $n = Normalize-AppOrigin $origin
  if (-not $n) { return $null }
  foreach ($a in $AllowedAppOrigins) {
    if ((Normalize-AppOrigin $a) -eq $n) { return $n }
  }
  return $null
}

function Register-AllowedAppOrigin([string]$origin) {
  $allowed = Test-AllowedAppOrigin $origin
  if ($allowed) { $script:LastAllowedAppOrigin = $allowed }
  return $allowed
}

function Get-AppApiBase {
  if ($script:LastAllowedAppOrigin) { return $script:LastAllowedAppOrigin }
  return (Normalize-AppOrigin $DefaultAppApiBase)
}

function Fail([string]$msg) {
  Write-Host $msg
  Post-ScanClientError $msg
  exit 1
}

function Post-ScanClientError([string]$msg) {
  if (-not $script:ScanToken) { return }
  try {
    $body = @{ token = $script:ScanToken; client_error = $msg } | ConvertTo-Json -Compress
    $apiBase = Get-AppApiBase
    Invoke-RestMethod -Method POST -Uri "$apiBase/api/design/scan-callback" -ContentType 'application/json; charset=utf-8' -Body $body -ErrorAction Stop | Out-Null
  } catch {
    Write-Host ("Khong gui loi ve app: " + $_.Exception.Message)
  }
}

function Normalize-PathSafe([string]$p) {
  if (-not $p) { return $null }
  $p = $p -replace '/', '\'
  if ($p -match '\.\.') { Fail 'Duong dan khong hop le' }
  if ($p.StartsWith('\\') -and -not $p.StartsWith('\\?\')) {
    $tail = ($p.Substring(2) -replace '\\+', '\').TrimEnd('\')
    return '\\' + $tail
  }
  $p = ($p -replace '\\+', '\').TrimEnd('\')
  return $p
}

function Test-UnderNas([string]$folderPath, [string]$nasRoot) {
  if (-not $nasRoot) { return $true }
  $a = $folderPath.ToLower()
  $b = ($nasRoot.TrimEnd('\')).ToLower()
  return ($a -eq $b) -or $a.StartsWith("$b\")
}

function Initialize-BimFolderPickHostTypes {
  if ('BimFolderPickHost' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

public static class BimFolderPickHost {
    const byte VK_MENU = 0x12;
    const uint KEYEVENTF_KEYUP = 0x0002;

    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    public static Form CreateOwner() {
        var f = new Form();
        f.ShowInTaskbar = false;
        f.TopMost = true;
        f.Opacity = 0.01;
        f.FormBorderStyle = FormBorderStyle.None;
        f.StartPosition = FormStartPosition.Manual;
        f.Location = new System.Drawing.Point(-32000, -32000);
        f.Size = new System.Drawing.Size(1, 1);
        f.Show();
        f.Refresh();
        return f;
    }

    public static void BoostDialogForeground(string titleHint) {
        if (string.IsNullOrEmpty(titleHint)) titleHint = "Ch\u1ecdn folder";
        Task.Run(() => {
            for (int i = 0; i < 80; i++) {
                Thread.Sleep(100);
                IntPtr found = IntPtr.Zero;
                EnumWindows((h, _) => {
                    if (!IsWindowVisible(h)) return true;
                    var sb = new StringBuilder(512);
                    GetWindowText(h, sb, sb.Capacity);
                    string t = sb.ToString();
                    if (t.Length > 0 && t.IndexOf(titleHint, StringComparison.OrdinalIgnoreCase) >= 0) {
                        found = h; return false;
                    }
                    return true;
                }, IntPtr.Zero);
                if (found != IntPtr.Zero) {
                    keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
                    keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                    SetForegroundWindow(found);
                    break;
                }
            }
        });
    }
}
'@ -ReferencedAssemblies System.Windows.Forms
}

function Initialize-BimFolderWinRtInitTypes {
  if ('WinRtInitWindow' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("3E68D4BD-7135-4D10-8018-9FB6D9F033FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IInitializeWithWindow {
    void Initialize(IntPtr hwnd);
}
public static class WinRtInitWindow {
    public static void Init(object picker, IntPtr hwnd) {
        ((IInitializeWithWindow)picker).Initialize(hwnd);
    }
}
'@
}

function Initialize-BimFolderWinRtPicker {
  if ($script:BimFolderWinRtReady) { return }
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [Windows.Storage.Pickers.FolderPicker, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
  [Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
  Initialize-BimFolderWinRtInitTypes
  $script:BimFolderWinRtReady = $true
}

function Test-BimFolderWinRtPickerAvailable {
  try {
    Initialize-BimFolderWinRtPicker
    $p = [Windows.Storage.Pickers.FolderPicker]::new()
    $null = $p.FileTypeFilter.Add('*')
    return $true
  } catch {
    return $false
  }
}

function Wait-BimFolderWinRtOperation($asyncOp, [type]$resultType) {
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and -not $_.IsGenericMethod } |
    Select-Object -First 1
  if (-not $asTask) { throw 'WinRT AsTask missing' }
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($asyncOp))
  $task.Wait()
  if ($task.IsFaulted) {
    if ($task.Exception.InnerException) { throw $task.Exception.InnerException }
    throw $task.Exception
  }
  return $task.Result
}

function Get-BimFolderVistaCoCreateHr {
  try {
    Initialize-BimFolderVistaPickerTypes
    return [BimFolderVistaPick]::Probe()
  } catch {
    return -2147221164
  }
}

function Resolve-BimFolderPickerMode {
  if ($script:BimFolderPickerMode) { return $script:BimFolderPickerMode }
  if ((Get-BimFolderVistaCoCreateHr) -eq 0) {
    $script:BimFolderPickerMode = 'vista'
    return 'vista'
  }
  if (Get-Command pwsh -ErrorAction SilentlyContinue) {
    $script:BimFolderPickerMode = 'pwsh'
    return 'pwsh'
  }
  if (Test-BimFolderWinRtPickerAvailable) {
    $script:BimFolderPickerMode = 'winrt'
    return 'winrt'
  }
  $script:BimFolderPickerMode = 'ofn'
  return 'ofn'
}

function Initialize-BimFolderVistaPickerTypes {
  if ('BimFolderVistaPick' -as [type]) { return }
  $src = @'
using System;
using System.IO;
using System.Runtime.InteropServices;

[ComImport, ClassInterface(ClassInterfaceType.None), Guid("DC1C5A9C-E88A-4dde-B5A1-0F364606A0C1")]
public class FileOpenDialogRCW { }

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe")]
public interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare([MarshalAs(UnmanagedType.Interface)] IShellItem psi, int hint, out int piOrder);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("d57fdd28-4164-4132-b816-7271430137af")]
public interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder([MarshalAs(UnmanagedType.Interface)] IShellItem psi);
    void SetFolder([MarshalAs(UnmanagedType.Interface)] IShellItem psi);
    void GetFolder([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
    [PreserveSig] int GetCurrentSelection([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close([MarshalAs(UnmanagedType.Error)] int hr);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr pFilter);
    void GetResults([MarshalAs(UnmanagedType.Interface)] out IntPtr ppenum);
    void GetSelectedItems([MarshalAs(UnmanagedType.Interface)] out IntPtr ppsai);
}

public static class BimFolderVistaPick {
    public const uint FOS_PICKFOLDERS = 0x20;
    public const uint FOS_FORCEFILESYSTEM = 0x40;
    public const uint FOS_PATHMUSTEXIST = 0x800;
    public const uint SIGDN_FILESYSPATH = 0x80058000;
    static readonly Guid ClsidFileOpenDialog = new Guid("DC1C5A9C-E88A-4dde-B5A1-0F364606A0C1");
    static readonly Guid IidFileOpenDialog = new Guid("d57fdd28-4164-4132-b816-7271430137af");
    static readonly Guid ShellItemGuid = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");
    const int CLSCTX_INPROC_SERVER = 1;

    [DllImport("ole32.dll", PreserveSig = true)]
    static extern int CoCreateInstance(
        [In] ref Guid rclsid, IntPtr pUnkOuter, uint dwClsContext, [In] ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IFileOpenDialog ppv);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    static extern int SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

    static IFileOpenDialog CreateDialog(out int hr) {
        IFileOpenDialog dlg;
        Guid clsid = ClsidFileOpenDialog;
        Guid iid = IidFileOpenDialog;
        hr = CoCreateInstance(ref clsid, IntPtr.Zero, CLSCTX_INPROC_SERVER, ref iid, out dlg);
        return dlg;
    }

    public static int Probe() {
        int hr;
        var dlg = CreateDialog(out hr);
        if (hr != 0) return hr;
        dlg.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
        return 0;
    }

    static string ShellItemPath(IShellItem item) {
        if (item == null) return null;
        string path;
        item.GetDisplayName(SIGDN_FILESYSPATH, out path);
        return string.IsNullOrWhiteSpace(path) ? null : path;
    }

    public static string Pick(IntPtr ownerHwnd, string title, string initialPath) {
        int hrCreate;
        var dlg = CreateDialog(out hrCreate);
        if (hrCreate != 0) return null;
        dlg.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
        if (!string.IsNullOrEmpty(title)) dlg.SetTitle(title);
        try { dlg.SetOkButtonLabel("Ch\u1ecdn folder"); } catch { }
        if (!string.IsNullOrEmpty(initialPath) && Directory.Exists(initialPath)) {
            IShellItem folder;
            Guid iid = ShellItemGuid;
            if (SHCreateItemFromParsingName(initialPath, IntPtr.Zero, ref iid, out folder) == 0) {
                try { dlg.SetFolder(folder); } catch { }
            }
        }
        IntPtr owner = ownerHwnd != IntPtr.Zero ? ownerHwnd : IntPtr.Zero;
        int hr = dlg.Show(owner);
        if (hr != 0) return null;
        IShellItem item;
        if (dlg.GetCurrentSelection(out item) != 0) {
            dlg.GetFolder(out item);
        }
        return ShellItemPath(item);
    }
}
'@
  Add-Type -TypeDefinition $src -ErrorAction Stop
}

function Initialize-BimFolderOpenFilePickTypes {
  if ('BimFolderOpenFilePick' -as [type]) { return }
  $src = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class BimFolderOpenFilePick {
    public const string FolderSentinel = ".";

    const int IDOK = 1;
    const int IDC_FILENAME = 0x047c;
    const int IDC_FILENAME_LABEL = 0x0442;
    const int IDC_FILTER = 0x0470;
    const int SW_HIDE = 0;
    const int WM_INITDIALOG = 0x0110;
    const int WM_NOTIFY = 0x004E;
    const int CDN_INITDONE = -601;
    const int CDN_FOLDERCHANGE = -603;
    const int CDN_SELCHANGE = -604;
    const int CDM_GETFOLDERPATH = 0x0450;
    const int CDM_GETFILEPATH = 0x0451;
    const int OFN_ENABLEHOOK = 0x00000020;
    const int OFN_EXPLORER = 0x00080000;
    const int OFN_NOVALIDATE = 0x00000100;
    const int OFN_PATHMUSTEXIST = 0x00000800;
    const int OFN_HIDEREADONLY = 0x00000004;
    const int OFN_DONTADDTORECENT = 0x02000000;
    const int MaxPath = 1024;

    delegate IntPtr OfnHookProc(IntPtr hDlg, int msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct OpenFileName {
        public int lStructSize;
        public IntPtr hwndOwner;
        public IntPtr hInstance;
        public string lpstrFilter;
        public IntPtr lpstrCustomFilter;
        public int nMaxCustFilter;
        public int nFilterIndex;
        public IntPtr lpstrFile;
        public int nMaxFile;
        public IntPtr lpstrFileTitle;
        public int nMaxFileTitle;
        public string lpstrInitialDir;
        public string lpstrTitle;
        public int Flags;
        public short nFileOffset;
        public short nFileExtension;
        public string lpstrDefExt;
        public IntPtr lCustData;
        public OfnHookProc lpfnHook;
        public string lpTemplateName;
        public IntPtr pvReserved;
        public int dwReserved;
        public int FlagsEx;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NMHDR {
        public IntPtr hwndFrom;
        public IntPtr idFrom;
        public int code;
    }

    [DllImport("comdlg32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetOpenFileName(ref OpenFileName ofn);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool SetWindowText(IntPtr hWnd, string lpString);

    [DllImport("user32.dll")]
    static extern IntPtr GetDlgItem(IntPtr hDlg, int nIDDlgItem);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int SendMessage(IntPtr hWnd, int msg, int wParam, StringBuilder lParam);

    static string _addressBarFolder;
    static string _lastSelPath;
    static OfnHookProc _ofnHook;

    static void CustomizeFolderDialogHwnd(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero) return;
        IntPtr edit = GetDlgItem(hWnd, IDC_FILENAME);
        if (edit != IntPtr.Zero) ShowWindow(edit, SW_HIDE);
        IntPtr label = GetDlgItem(hWnd, IDC_FILENAME_LABEL);
        if (label != IntPtr.Zero) ShowWindow(label, SW_HIDE);
        IntPtr filter = GetDlgItem(hWnd, IDC_FILTER);
        if (filter != IntPtr.Zero) ShowWindow(filter, SW_HIDE);
        IntPtr ok = GetDlgItem(hWnd, IDOK);
        if (ok != IntPtr.Zero) SetWindowText(ok, "Ch\u1ecdn folder");
    }

    static string QueryFolderPath(IntPtr hDlg) {
        var sb = new StringBuilder(MaxPath);
        if (SendMessage(hDlg, CDM_GETFOLDERPATH, sb.Capacity, sb) <= 0) return null;
        var p = sb.ToString().Trim();
        return string.IsNullOrEmpty(p) ? null : p;
    }

    static string QuerySelFilePath(IntPtr hDlg) {
        var sb = new StringBuilder(MaxPath);
        if (SendMessage(hDlg, CDM_GETFILEPATH, sb.Capacity, sb) <= 0) return null;
        var p = sb.ToString().Trim();
        return string.IsNullOrEmpty(p) ? null : p;
    }

    static IntPtr OfnHook(IntPtr hDlg, int msg, IntPtr wParam, IntPtr lParam) {
        if (msg == WM_INITDIALOG) {
            CustomizeFolderDialogHwnd(hDlg);
            _addressBarFolder = QueryFolderPath(hDlg);
        } else if (msg == WM_NOTIFY && lParam != IntPtr.Zero) {
            var hdr = (NMHDR)Marshal.PtrToStructure(lParam, typeof(NMHDR));
            if (hdr.code == CDN_INITDONE) {
                CustomizeFolderDialogHwnd(hDlg);
                _addressBarFolder = QueryFolderPath(hDlg);
            } else if (hdr.code == CDN_FOLDERCHANGE) {
                _addressBarFolder = QueryFolderPath(hDlg);
            } else if (hdr.code == CDN_SELCHANGE) {
                var sel = QuerySelFilePath(hDlg);
                if (!string.IsNullOrEmpty(sel)) _lastSelPath = sel;
            }
        }
        return IntPtr.Zero;
    }

    public static string ResolvePickedPath(string picked, string folderStore, string selStore) {
        if (!string.IsNullOrWhiteSpace(selStore)) {
            var s = selStore.Trim().Replace('/', '\\').TrimEnd('\\');
            if (Directory.Exists(s)) return s;
        }
        if (!string.IsNullOrWhiteSpace(picked)) {
            picked = picked.Trim().Replace('/', '\\');
            string trimmed = picked.TrimEnd('\\');
            string leaf = Path.GetFileName(trimmed);
            if (leaf == FolderSentinel || leaf == " " || leaf == "") {
                if (!string.IsNullOrEmpty(folderStore) && Directory.Exists(folderStore.TrimEnd('\\')))
                    return folderStore.TrimEnd('\\');
                string dir = Path.GetDirectoryName(trimmed);
                if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir)) return dir.TrimEnd('\\');
            }
            if (Directory.Exists(trimmed)) return trimmed;
            if (File.Exists(trimmed)) {
                string parent = Path.GetDirectoryName(trimmed);
                if (!string.IsNullOrEmpty(parent) && Directory.Exists(parent)) return parent;
            }
        }
        if (!string.IsNullOrWhiteSpace(folderStore)) {
            var f = folderStore.Trim().Replace('/', '\\').TrimEnd('\\');
            if (Directory.Exists(f)) return f;
        }
        return null;
    }

    public static string ResolvePickedPath(string picked) {
        return ResolvePickedPath(picked, _addressBarFolder, _lastSelPath);
    }

    public static string Pick(IntPtr ownerHwnd, string title, string initialPath) {
        _addressBarFolder = null;
        _lastSelPath = null;
        _ofnHook = OfnHook;
        var fileBuffer = Marshal.AllocHGlobal(MaxPath * 2);
        var titleBuffer = Marshal.AllocHGlobal(MaxPath * 2);
        try {
            Marshal.Copy(new byte[MaxPath * 2], 0, fileBuffer, MaxPath * 2);
            Marshal.WriteInt16(fileBuffer, (short)FolderSentinel[0]);
            var ofn = new OpenFileName {
                lStructSize = Marshal.SizeOf(typeof(OpenFileName)),
                hwndOwner = ownerHwnd,
                lpstrFilter = "All files (*.*)\0*.*\0",
                lpstrFile = fileBuffer,
                nMaxFile = MaxPath,
                lpstrFileTitle = titleBuffer,
                nMaxFileTitle = MaxPath,
                lpstrInitialDir = string.IsNullOrEmpty(initialPath) ? null : initialPath,
                lpstrTitle = title,
                Flags = OFN_EXPLORER | OFN_ENABLEHOOK | OFN_NOVALIDATE | OFN_PATHMUSTEXIST |
                        OFN_HIDEREADONLY | OFN_DONTADDTORECENT,
                lpfnHook = _ofnHook
            };
            if (!GetOpenFileName(ref ofn)) return null;
            string picked = Marshal.PtrToStringUni(fileBuffer);
            return ResolvePickedPath(picked, _addressBarFolder, _lastSelPath);
        } finally {
            Marshal.FreeHGlobal(fileBuffer);
            Marshal.FreeHGlobal(titleBuffer);
        }
    }
}
'@
  Add-Type -TypeDefinition $src -ErrorAction Stop
}

function Show-FolderPickerOpenFileDialogFallback([string]$Title, [string]$InitialPath, [IntPtr]$OwnerHwnd) {
  Initialize-BimFolderOpenFilePickTypes
  $fromDialog = [BimFolderOpenFilePick]::Pick($OwnerHwnd, $Title, $InitialPath)
  if (-not $fromDialog) { return $null }
  return (Normalize-PathSafe $fromDialog)
}

function Show-FolderPickerWinRt([string]$Title, [string]$InitialPath, [IntPtr]$OwnerHwnd) {
  Initialize-BimFolderWinRtPicker
  $picker = [Windows.Storage.Pickers.FolderPicker]::new()
  $null = $picker.FileTypeFilter.Add('*')
  $picker.SuggestedStartLocation = [Windows.Storage.Pickers.PickerLocationId]::ComputerFolder
  [WinRtInitWindow]::Init($picker, $OwnerHwnd)
  [BimFolderPickHost]::BoostDialogForeground($Title)
  $folder = Wait-BimFolderWinRtOperation $picker.PickSingleFolderAsync() ([Windows.Storage.StorageFolder])
  if (-not $folder) { return $null }
  return (Normalize-PathSafe $folder.Path)
}

function Show-FolderPickerPwsh([string]$Title, [string]$InitialPath) {
  $pwshExe = (Get-Command pwsh -ErrorAction Stop).Source
  $helper = Join-Path $env:TEMP ('bimfolder-pwsh-pick-' + [guid]::NewGuid().ToString('n') + '.ps1')
  $helperSrc = @'
param([string]$Title, [string]$InitialPath)
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Opacity = 0.01
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$owner.Location = New-Object System.Drawing.Point(-32000, -32000)
$owner.Size = New-Object System.Drawing.Size(1, 1)
$null = $owner.Show()
$owner.Refresh()
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.AutoUpgradeEnabled = $true
$d.UseDescriptionForTitle = $true
$d.Description = $Title
if ($InitialPath -and (Test-Path -LiteralPath $InitialPath -PathType Container)) {
  $d.SelectedPath = $InitialPath
}
try {
  if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $d.SelectedPath
  }
} finally {
  $d.Dispose()
  $owner.Close()
  $owner.Dispose()
}
'@
  Set-Content -LiteralPath $helper -Value $helperSrc -Encoding UTF8
  try {
    $out = & $pwshExe -NoProfile -Sta -File $helper -Title $Title -InitialPath $InitialPath 2>&1
    $line = ($out | Where-Object { $_ -and ($_ -notmatch '^\s*$') } | Select-Object -Last 1)
    if (-not $line) { return $null }
    return (Normalize-PathSafe ([string]$line))
  } finally {
    Remove-Item -LiteralPath $helper -Force -ErrorAction SilentlyContinue
  }
}

function Show-FolderPicker([string]$Title, [string]$InitialPath) {
  Initialize-BimFolderPickHostTypes
  $mode = Resolve-BimFolderPickerMode
  $owner = [BimFolderPickHost]::CreateOwner()
  $hwnd = $owner.Handle
  try {
    [BimFolderPickHost]::BoostDialogForeground($Title)
    switch ($mode) {
      'vista' {
        Initialize-BimFolderVistaPickerTypes
        $fromVista = [BimFolderVistaPick]::Pick($hwnd, $Title, $InitialPath)
        if ($fromVista) { return (Normalize-PathSafe $fromVista) }
        return $null
      }
      'pwsh' {
        return (Show-FolderPickerPwsh -Title $Title -InitialPath $InitialPath)
      }
      'winrt' {
        return (Show-FolderPickerWinRt -Title $Title -InitialPath $InitialPath -OwnerHwnd $hwnd)
      }
      default {
        return (Show-FolderPickerOpenFileDialogFallback -Title $Title -InitialPath $InitialPath -OwnerHwnd $hwnd)
      }
    }
  } catch {
    if ($mode -eq 'ofn') { throw }
    try {
      return (Show-FolderPickerOpenFileDialogFallback -Title $Title -InitialPath $InitialPath -OwnerHwnd $hwnd)
    } catch {
      Fail ("Khong mo hop chon folder ($mode): " + $_.Exception.Message)
    }
  } finally {
    try { $owner.Close() } catch { }
    try { $owner.Dispose() } catch { }
  }
}

function Open-ExplorerFolder([string]$folderPath) {
  $folderPath = Normalize-PathSafe $folderPath
  if (-not (Test-Path -LiteralPath $folderPath -PathType Container)) { Fail 'Folder khong ton tai' }
  if ($folderPath -match '\.(exe|bat|cmd|msi|ps1)$') { Fail 'Tu choi mo file thuc thi' }
  Start-Process explorer.exe -ArgumentList @($folderPath)
}

function Get-PickDialogStartPath([string]$pathParam, [string]$nasRoot) {
  $saved = Normalize-PathSafe $pathParam
  if ($saved -and (Test-Path -LiteralPath $saved -PathType Container)) { return $saved }
  if ($nasRoot -and (Test-Path -LiteralPath $nasRoot -PathType Container)) { return $nasRoot }
  $fallback = $env:USERPROFILE
  if (-not (Test-Path -LiteralPath $fallback -PathType Container)) { $fallback = 'C:\' }
  return $fallback
}

function Send-ScanCallback([string]$token, [string]$folderPath, [string[]]$names) {
  $folderPath = Normalize-PathSafe $folderPath
  $payload = @{
    token        = $token
    folder_path  = $folderPath
    folder_names = @($names)
  }
  $body = $payload | ConvertTo-Json -Compress -Depth 5
  $apiBase = Get-AppApiBase
  Invoke-RestMethod -Method POST -Uri "$apiBase/api/design/scan-callback" -ContentType 'application/json; charset=utf-8' -Body $body -ErrorAction Stop | Out-Null
}

function Invoke-PickScan([string]$token, [string]$startPath, [string]$nasRoot) {
  $script:ScanToken = $token
  if (-not $token) { Fail 'Thieu ma quet (token)' }
  $initialBrowse = Get-PickDialogStartPath $startPath $nasRoot
  $picked = Show-FolderPicker -Title 'Chọn folder bộ môn HSTK' -InitialPath $initialBrowse
  if (-not $picked) { return }
  Invoke-ScanFolder $token $picked $nasRoot $true
}

function Invoke-ScanFolder([string]$token, [string]$folderPathRaw, [string]$nasRoot, [bool]$fromPick) {
  $script:ScanToken = $token
  if (-not $token) { Fail 'Thieu ma quet (token)' }
  $folderPath = Normalize-PathSafe $folderPathRaw
  if (-not (Test-UnderNas $folderPath $nasRoot)) { Fail 'Duong dan ngoai goc NAS' }
  if (-not (Test-Path -LiteralPath $folderPath -PathType Container)) { Fail 'Folder khong ton tai' }
  $names = @(Get-ChildItem -LiteralPath $folderPath -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
  $leaf = Split-Path -Leaf $folderPath
  if ($leaf -and ($names -notcontains $leaf)) {
    $names = @($leaf) + $names
  }
  if ($names.Count -gt 500) { $names = $names[0..499] }
  try {
    Send-ScanCallback $token $folderPath $names
  } catch {
    $detail = $_.Exception.Message
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }
    Fail ("Loi goi API: " + $detail)
  }
  if ($fromPick) { Start-ListenerBackgroundIfNeeded }
}

function Start-ListenerBackgroundIfNeeded {
  try {
    Invoke-WebRequest -Uri "${ListenerPrefix}health" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop | Out-Null
    return
  } catch { }
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  Start-Process -FilePath $ps -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Sta', '-WindowStyle', 'Hidden',
    '-File', $script:MyScriptPath, '-Listen'
  ) -WindowStyle Hidden | Out-Null
}

function Write-CorsHeaders([System.Net.HttpListenerResponse]$resp, [string]$origin) {
  $allow = Test-AllowedAppOrigin $origin
  if ($allow) {
    $resp.Headers['Access-Control-Allow-Origin'] = $allow
  }
  $resp.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
  $resp.Headers['Access-Control-Allow-Headers'] = 'Content-Type'
}

function Read-JsonBody([System.IO.Stream]$inputStream) {
  $reader = New-Object System.IO.StreamReader($inputStream, [System.Text.Encoding]::UTF8)
  try {
    $text = $reader.ReadToEnd()
  } finally {
    $reader.Close()
  }
  if (-not $text) { return @{} }
  return ($text | ConvertFrom-Json)
}

function Send-HttpJson([System.Net.HttpListenerResponse]$resp, [int]$status, $obj, [string]$origin) {
  Write-CorsHeaders $resp $origin
  $resp.StatusCode = $status
  $resp.ContentType = 'application/json; charset=utf-8'
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress))
  $resp.ContentLength64 = $bytes.Length
  $resp.OutputStream.Write($bytes, 0, $bytes.Length)
  $resp.OutputStream.Close()
}

function Start-BimfolderListener {
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add($ListenerPrefix)
  $listener.Start()
  Write-Host "bimfolder listener on $ListenerPrefix"
  while ($listener.IsListening) {
    $ctx = $null
    try {
      $ctx = $listener.GetContext()
    } catch {
      break
    }
    $req = $ctx.Request
    $resp = $ctx.Response
    $origin = $req.Headers['Origin']
    Register-AllowedAppOrigin $origin | Out-Null
    $path = $req.Url.AbsolutePath.TrimEnd('/')
    if ($req.HttpMethod -eq 'OPTIONS') {
      Write-CorsHeaders $resp $origin
      $resp.StatusCode = 204
      $resp.Close()
      continue
    }
    try {
      if ($req.HttpMethod -eq 'GET' -and ($path -eq '/health' -or $path -eq '')) {
        Send-HttpJson $resp 200 @{ ok = $true } $origin
        continue
      }
      if ($req.HttpMethod -eq 'POST' -and $path -eq '/open') {
        $body = Read-JsonBody $req.InputStream
        $folderPath = Normalize-PathSafe ([string]$body.path)
        $nas = Normalize-PathSafe ([string]$body.nas_root)
        if ($nas -eq '') { $nas = $null }
        if (-not (Test-UnderNas $folderPath $nas)) { Send-HttpJson $resp 403 @{ error = 'Duong dan ngoai goc NAS' } $origin; continue }
        Open-ExplorerFolder $folderPath
        Send-HttpJson $resp 200 @{ ok = $true } $origin
        continue
      }
      if ($req.HttpMethod -eq 'POST' -and $path -eq '/pick') {
        $body = Read-JsonBody $req.InputStream
        $token = [string]$body.token
        $startPath = [string]$body.startPath
        $nas = Normalize-PathSafe ([string]$body.nas_root)
        if ($nas -eq '') { $nas = $null }
        Invoke-PickScan $token $startPath $nas
        Send-HttpJson $resp 200 @{ ok = $true } $origin
        continue
      }
      if ($req.HttpMethod -eq 'POST' -and $path -eq '/scan') {
        $body = Read-JsonBody $req.InputStream
        $token = [string]$body.token
        $scanPath = [string]$body.path
        $nas = Normalize-PathSafe ([string]$body.nas_root)
        if ($nas -eq '') { $nas = $null }
        Invoke-ScanFolder $token $scanPath $nas $false
        Send-HttpJson $resp 200 @{ ok = $true } $origin
        continue
      }
      Send-HttpJson $resp 404 @{ error = 'not found' } $origin
    } catch {
      $msg = $_.Exception.Message
      try { Send-HttpJson $resp 500 @{ error = $msg } $origin } catch { $resp.Close() }
    }
  }
  $listener.Stop()
}

if ($Listen) {
  Start-BimfolderListener
  exit 0
}

if ($SelfTest) {
  $exitCode = 0
  $vistaHr = Get-BimFolderVistaCoCreateHr
  $vistaHex = '0x{0:X8}' -f (($vistaHr -band 0xffffffff))
  Write-Host ("SELFTEST vista hr=" + $vistaHex)
  $pickerMode = Resolve-BimFolderPickerMode
  Write-Host ("SELFTEST picker=" + $pickerMode)
  try {
    Initialize-BimFolderOpenFilePickTypes
    Write-Host 'SELFTEST ofn=ok'
  } catch {
    Write-Host ("SELFTEST ofn=fail " + $_.Exception.Message)
    $exitCode = 1
  }
  if (Test-BimFolderWinRtPickerAvailable) {
    Write-Host 'SELFTEST winrt=ok'
  } else {
    Write-Host 'SELFTEST winrt=fail'
  }
  try {
    $tmpdir = Join-Path $env:TEMP ('bimfolder-selftest-' + [guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Path $tmpdir -Force | Out-Null
    $sentIn = Join-Path $tmpdir '.'
    $gotSent = [BimFolderOpenFilePick]::ResolvePickedPath($sentIn)
    if ($gotSent -ne $tmpdir) {
      Write-Host ("SELFTEST resolve=fail sentinel got=" + $gotSent + " want=" + $tmpdir)
      $exitCode = 1
    }
    $gotDir = [BimFolderOpenFilePick]::ResolvePickedPath($tmpdir)
    if ($gotDir -ne $tmpdir) {
      Write-Host ("SELFTEST resolve=fail dir got=" + $gotDir + " want=" + $tmpdir)
      $exitCode = 1
    }
    if ($exitCode -eq 0) { Write-Host 'SELFTEST resolve=ok' }
  } catch {
    Write-Host ("SELFTEST resolve=fail " + $_.Exception.Message)
    $exitCode = 1
  } finally {
    if ($tmpdir -and (Test-Path -LiteralPath $tmpdir)) {
      Remove-Item -LiteralPath $tmpdir -Force -Recurse -ErrorAction SilentlyContinue
    }
  }

  $norm = Normalize-PathSafe 'C:\\DuAn\\\\KT'
  if ($norm -ne 'C:\DuAn\KT') {
    Write-Host ("SELFTEST normalize=fail got=" + $norm)
    $exitCode = 1
  } else {
    Write-Host 'SELFTEST normalize=ok'
  }
  $unc = Normalize-PathSafe '\\server\\share\\folder\\'
  if ($unc -ne '\\server\share\folder') {
    Write-Host ("SELFTEST unc=fail got=" + $unc)
    $exitCode = 1
  } else {
    Write-Host 'SELFTEST unc=ok'
  }
  exit $exitCode
}

if (-not $Uri) { Fail 'Thiếu URI bimfolder hoặc -Listen' }

$u = [Uri]$Uri
$q = [System.Web.HttpUtility]::ParseQueryString($u.Query)
$mode = $u.Host
if ($mode -ne 'pick' -and $mode -ne 'scan' -and $mode -ne 'open' -and $mode -ne 'listen') {
  $mode = ($u.AbsolutePath -replace '^/', '').Split('?')[0]
}

if ($mode -eq 'listen') {
  Start-BimfolderListener
  exit 0
}

$script:ScanToken = $q['token']
$pathParam = $q['path']
$nasFromLink = $q['nas_root']

function Get-NasRootConfigured {
  if ($null -ne $nasFromLink -and $nasFromLink -ne '') {
    return (Normalize-PathSafe $nasFromLink)
  }
  if ($nasFromLink -eq '') { return $null }
  return $null
}

$nasRoot = Get-NasRootConfigured

if ($mode -eq 'open') {
  $folderPath = Normalize-PathSafe $pathParam
  if (-not (Test-UnderNas $folderPath $nasRoot)) { Fail 'Duong dan ngoai goc NAS' }
  Open-ExplorerFolder $folderPath
  exit 0
}

if ($mode -eq 'pick') {
  Invoke-PickScan $script:ScanToken $pathParam $nasRoot
  exit 0
}

if ($mode -eq 'scan') {
  Invoke-ScanFolder $script:ScanToken $pathParam $nasRoot $false
  exit 0
}

Fail 'Lenh bimfolder khong hop le'
