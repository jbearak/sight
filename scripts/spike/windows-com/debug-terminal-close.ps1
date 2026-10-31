param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class SightWindows {
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int size);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, int message, IntPtr wparam, IntPtr lparam);
}
'@
Start-Transcript -Path "$Results\debug-terminal-close.txt" -Force | Out-Null
$handles = New-Object System.Collections.ArrayList
$callback = [SightWindows+EnumWindowsProc] {
    param($handle, $unused)
    $title = New-Object Text.StringBuilder 1024
    [void][SightWindows]::GetWindowText($handle, $title, $title.Capacity)
    if ([SightWindows]::IsWindowVisible($handle) -and $title.ToString().Contains('SightDebugWT')) {
        [void]$handles.Add($handle)
    }
    return $true
}
[void][SightWindows]::EnumWindows($callback, [IntPtr]::Zero)
if ($handles.Count -ne 1) { throw "Expected one SightDebugWT window; got $($handles.Count)" }
$stata = @(Get-Process Stata* -ErrorAction SilentlyContinue)
if ($stata.Count -ne 1 -or $stata[0].MainWindowTitle -notlike '*sight console*') { throw 'Expected one owned console Stata' }
$pid_value = $stata[0].Id
Write-Output "$(Get-Date -Format o) WM_CLOSE terminal=$($handles[0]) Stata=$pid_value"
[void][SightWindows]::PostMessage($handles[0], 0x10, [IntPtr]::Zero, [IntPtr]::Zero)
for ($i=0; $i -lt 120; $i++) {
    $alive = [bool](Get-Process -Id $pid_value -ErrorAction SilentlyContinue)
    Write-Output "$(Get-Date -Format o) Stata alive=$alive"
    if (!$alive) { break }
    Start-Sleep -Milliseconds 500
}
Stop-Transcript | Out-Null
