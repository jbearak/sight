param([int]$ProcessId, [int]$Key = 13)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class SightDialogKeys {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr w, IntPtr l);
}
'@
$window = (Get-Process -Id $ProcessId).MainWindowHandle
[SightDialogKeys]::SetForegroundWindow($window) | Out-Null
[SightDialogKeys]::PostMessage($window, 0x100, [IntPtr]$Key, [IntPtr]::Zero) | Out-Null
[SightDialogKeys]::PostMessage($window, 0x101, [IntPtr]$Key, [IntPtr]::Zero) | Out-Null
