param([switch]$UseAlt)
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Existing Stata; refusing to touch it' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SightKeyProbe {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    public static void Key(byte key, bool up = false) { keybd_event(key, 0, up ? 2u : 0u, UIntPtr.Zero); }
    public static void Ctrl(byte key) { Key(0x11); Key(key); Key(key, true); Key(0x11, true); }
}
'@
$tag = if ($UseAlt) { 'with-alt' } else { 'without-alt' }
$dir = Join-Path $env:TEMP "sight-keys-$tag"
New-Item -ItemType Directory -Force $dir | Out-Null
Remove-Item "$dir\ready" -ErrorAction SilentlyContinue
@"
set more off
sysuse auto, clear
cls
log using "$dir\stata.log", text replace
file open ready using "$dir\ready", write replace
file close ready
"@ | Set-Content -Encoding ASCII "$dir\start.do"
$stata = Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -ArgumentList @('do', "$dir\start.do") -PassThru
try {
    for ($i = 0; $i -lt 120 -and !(Test-Path "$dir\ready"); $i++) { Start-Sleep -Milliseconds 250 }
    if (!(Test-Path "$dir\ready")) { throw 'Stata did not start' }
    $stata.Refresh()
    [void][SightKeyProbe]::SetForegroundWindow($stata.MainWindowHandle)
    Start-Sleep -Milliseconds 250
    if ([SightKeyProbe]::GetForegroundWindow() -ne $stata.MainWindowHandle) { throw 'Stata is not foreground' }
    Set-Clipboard 'display 667788'
    if ($UseAlt) { [SightKeyProbe]::Key(0x12); [SightKeyProbe]::Key(0x12, $true) }
    [void][SightKeyProbe]::SetForegroundWindow($stata.MainWindowHandle)
    Start-Sleep -Milliseconds 50
    [SightKeyProbe]::Ctrl(0x31)
    Start-Sleep -Milliseconds 50
    [SightKeyProbe]::Ctrl(0x56)
    Start-Sleep -Milliseconds 50
    [SightKeyProbe]::Key(0x0D); [SightKeyProbe]::Key(0x0D, $true)
    Start-Sleep -Seconds 2
    $file = [IO.File]::Open("$dir\stata.log", [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $buffer = New-Object IO.MemoryStream
    try { $file.CopyTo($buffer); $bytes = $buffer.ToArray() } finally { $file.Dispose(); $buffer.Dispose() }
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    "case=$tag foreground-is-target=True command-in-log=$($text.Contains('667788'))" | Set-Content -Encoding UTF8 "$PSScriptRoot\results\pane-keys-$tag.txt"
    [IO.File]::WriteAllBytes("$PSScriptRoot\results\pane-keys-$tag.log", $bytes)
} finally {
    $stata.Refresh()
    if (!$stata.HasExited) { [void]$stata.CloseMainWindow() }
}
