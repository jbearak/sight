param(
    [ValidateSet('basic', 'editing', 'lostlog', 'blockbreak', 'decline', 'share', 'yes', 'two')][string]$Scenario = 'basic',
    [string]$OutputPath = "$PSScriptRoot\results\debug-conpty-$Scenario.bin"
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

public static class SightConpty {
    [StructLayout(LayoutKind.Sequential)] struct COORD { public short X, Y; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
        public int cb; public string reserved, desktop, title; public int x,y,xsize,ysize,xchars,ychars,fill,flags;
        public short show,reserved2; public IntPtr reserved3,stdin,stdout,stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO info; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public int pid,tid; }
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, IntPtr attrs, int size);
    [DllImport("kernel32.dll")] static extern int CreatePseudoConsole(COORD size, IntPtr input, IntPtr output, int flags, out IntPtr pseudo);
    [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr pseudo);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX startup, out PROCESS_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int handle);
    [DllImport("kernel32.dll")] static extern bool SetStdHandle(int handle, IntPtr value);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr handle, uint code);
    static void Check(bool ok, string name) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), name); }
    public static int Run(string command, string cwd, string output, string scenario) {
        IntPtr inRead, inWrite, outRead, outWrite, pseudo;
        Check(CreatePipe(out inRead, out inWrite, IntPtr.Zero, 0), "CreatePipe input");
        Check(CreatePipe(out outRead, out outWrite, IntPtr.Zero, 0), "CreatePipe output");
        int hr = CreatePseudoConsole(new COORD { X=100, Y=30 }, inRead, outWrite, 0, out pseudo);
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        CloseHandle(inRead); CloseHandle(outWrite);
        IntPtr size = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
        IntPtr attrs = Marshal.AllocHGlobal(size);
        Check(InitializeProcThreadAttributeList(attrs, 1, 0, ref size), "InitializeProcThreadAttributeList");
        Check(UpdateProcThreadAttribute(attrs, 0, (IntPtr)0x00020016, pseudo, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero), "UpdateProcThreadAttribute");
        var startup = new STARTUPINFOEX(); startup.info.cb = Marshal.SizeOf(typeof(STARTUPINFOEX)); startup.attributes = attrs;
        PROCESS_INFORMATION info;
        IntPtr sin = GetStdHandle(-10), sout = GetStdHandle(-11), serr = GetStdHandle(-12);
        bool created;
        try {
            SetStdHandle(-10, IntPtr.Zero); SetStdHandle(-11, IntPtr.Zero); SetStdHandle(-12, IntPtr.Zero);
            created = CreateProcess(null, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, false, 0x00080000, IntPtr.Zero, cwd, ref startup, out info);
        } finally {
            SetStdHandle(-10, sin); SetStdHandle(-11, sout); SetStdHandle(-12, serr);
        }
        Check(created, "CreateProcess");
        CloseHandle(info.thread);
        var reader = new FileStream(new SafeFileHandle(outRead, true), FileAccess.Read, 4096, false);
        var writer = new FileStream(new SafeFileHandle(inWrite, true), FileAccess.Write, 4096, false);
        var transcript = new MemoryStream();
        Task readTask = Task.Run(() => { try { reader.CopyTo(transcript); } catch (IOException) { } });
        Action<string> send = text => { byte[] bytes=Encoding.UTF8.GetBytes(text); writer.Write(bytes,0,bytes.Length); writer.Flush(); };
        try {
            if (scenario == "decline" || scenario == "share") {
                Thread.Sleep(7000); send(scenario == "decline" ? "n\r" : "y\r");
            }
            if (scenario == "decline" || scenario == "two") {
                WaitForSingleObject(info.process, 15000);
                uint early; GetExitCodeProcess(info.process, out early);
                if (early == 259) { TerminateProcess(info.process, 99); early = 99; }
                writer.Dispose(); ClosePseudoConsole(pseudo); readTask.Wait(5000);
                File.WriteAllBytes(output, transcript.ToArray());
                return (int)early;
            }
            Thread.Sleep(14000);
            send("sysuse auto, clear\r"); Thread.Sleep(2500);
            if (scenario == "lostlog") {
                send("log close _all\r"); Thread.Sleep(2000);
                send("display 77\r"); Thread.Sleep(2000);
                send("display 88\r"); Thread.Sleep(2000);
                send("\x04");
                if (WaitForSingleObject(info.process, 15000) != 0) { TerminateProcess(info.process, 99); }
                uint lostCode; GetExitCodeProcess(info.process, out lostCode);
                writer.Dispose(); ClosePseudoConsole(pseudo); readTask.Wait(5000);
                File.WriteAllBytes(output, transcript.ToArray());
                return (int)lostCode;
            }
            send("display 1234567\r"); Thread.Sleep(2000);
            send("foreach x in 1 2 {\r"); Thread.Sleep(1200);
            send("display `x'\r"); Thread.Sleep(1200);
            send("}\r"); Thread.Sleep(2000);
            send("display no_such_variable\r"); Thread.Sleep(2000);
            if (scenario == "blockbreak") {
                send("foreach z in 1 {\r"); Thread.Sleep(1500); send("\x03"); Thread.Sleep(2000);
                send("display 56789\r"); Thread.Sleep(1500);
            }
            if (scenario == "editing") {
                send("displa\t 2468\r"); Thread.Sleep(2000);
                send("\x1b[A\r"); Thread.Sleep(2000);
            }
            send("sleep 10000\r"); Thread.Sleep(1200); send("\x03"); Thread.Sleep(2500);
            send("\x04");
            if (WaitForSingleObject(info.process, 15000) != 0) { TerminateProcess(info.process, 99); }
            uint code; GetExitCodeProcess(info.process, out code);
            writer.Dispose(); ClosePseudoConsole(pseudo); readTask.Wait(5000);
            File.WriteAllBytes(output, transcript.ToArray());
            return (int)code;
        } finally {
            try { writer.Dispose(); } catch { }
            CloseHandle(info.process); DeleteProcThreadAttributeList(attrs); Marshal.FreeHGlobal(attrs);
        }
    }
}
'@
$bun = Join-Path $env:TEMP 'sight-bun\bun-windows-x64\bun.exe'
$repo = 'C:\sight-debug'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Existing Stata; stopping.' }
$owned = @()
try {
    $count = if ($Scenario -eq 'two') { 2 } elseif ($Scenario -in @('share','yes','decline')) { 1 } else { 0 }
    for ($i = 0; $i -lt $count; $i++) {
        $owned += Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -PassThru
        Start-Sleep -Seconds 2
    }
    $yes = if ($Scenario -in @('basic', 'editing', 'lostlog', 'blockbreak', 'yes')) { ' --yes' } else { '' }
    $command = '"' + $bun + '" "' + $repo + '\src\cli.ts" console' + $yes
    Write-Output "$(Get-Date -Format o) scenario=$Scenario owned=$($owned.Id) starting $command"
    $code = [SightConpty]::Run($command, $repo, $OutputPath, $Scenario)
    $text = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($OutputPath))
    $expected = if ($Scenario -eq 'decline') { 81 } elseif ($Scenario -eq 'two') { 80 } else { 0 }
    if ($code -ne $expected) { throw "Expected exit $expected, got $code; transcript: $text" }
    if ($Scenario -in @('decline', 'two')) {
        foreach ($process in $owned) {
            $process.Refresh()
            if ($process.HasExited) { throw 'A pre-existing Stata exited unexpectedly' }
        }
    }
    if ($Scenario -eq 'decline' -and $text -notmatch 'take over') { throw 'No takeover prompt' }
    if ($Scenario -eq 'two' -and $text -notmatch 'Stata windows are open') { throw 'No multiple-Stata message' }
    if ($Scenario -in @('basic', 'editing', 'share', 'yes')) {
        foreach ($needle in @('1978 automobile data', '1234567', 'no_such_variable', '--Break--', 'Stata exited')) {
            if (-not $text.Contains($needle)) { throw "Missing $needle in transcript" }
        }
    }
    if ($Scenario -eq 'share' -and $text -notmatch 'take over') { throw 'No takeover prompt' }
    if ($Scenario -eq 'yes' -and $text -match 'take over') { throw 'Unexpected takeover prompt' }
    if ($Scenario -eq 'lostlog' -and -not $text.Contains("Sight's log was closed")) { throw 'Missing log-loss message' }
    if ($Scenario -eq 'editing' -and -not $text.Contains('2468')) { throw 'Completion value missing' }
    if ($Scenario -in @('basic', 'editing') -and -not $text.Contains("$([char]27)[31m")) { throw 'No red error output' }
    Write-Output "$(Get-Date -Format o) exit=$code assertions passed transcript=$OutputPath"
} finally {
    foreach ($process in $owned) {
        $process.Refresh()
        if (-not $process.HasExited) { [void]$process.CloseMainWindow() }
    }
}
