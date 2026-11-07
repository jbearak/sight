# Called in the probe's existing desktop process. Uses a temporary class-table
# entry with a random CLSID, not a registry entry or a Stata server.
function Test-IdentityCapability {
    Remove-Item -LiteralPath "$dir\identity.ready","$dir\identity.stop" -ErrorAction SilentlyContinue
    $compiler='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $output="$dir\identity-server.exe"
    & $compiler /nologo /target:exe /platform:x64 /reference:System.Windows.Forms.dll "/out:$output" "$PSScriptRoot\strategy-identity-server.cs"
    if ($LASTEXITCODE -ne 0) { throw 'Identity preflight compilation failed' }
    $probe_clsid=[guid]::NewGuid().ToString('B')
    $server=Start-Process $output -ArgumentList "`"$dir`"",$probe_clsid -PassThru
    $pointer=[IntPtr]::Zero
    try {
        Wait-File "$dir\identity.ready" 10000
        $hr=[StrategyNative]::GetFactory($probe_clsid,4,[ref]$pointer)
        Note 'identity_preflight_acquire' @{hr=('0x{0:X8}' -f $hr);server_pid=$server.Id;
            random_clsid=$probe_clsid;registry_edits=0;stata_acquisitions=0}
        if ($hr -ne 0) { return $false }
        $info=New-Object StrategyNative+ServerInformation
        $decode_hr=[StrategyNative]::Decode($pointer,[ref]$info)
        Note 'identity_preflight_decode' @{hr=('0x{0:X8}' -f $decode_hr);server_pid=$info.dwServerPid;
            expected_server_pid=$server.Id;any_createinstance_calls=0}
        return $decode_hr -eq 0 -and $info.dwServerPid -eq $server.Id
    } finally {
        if ($pointer -ne [IntPtr]::Zero) { [void][Runtime.InteropServices.Marshal]::Release($pointer) }
        [IO.File]::WriteAllText("$dir\identity.stop",'stop')
        if (!$server.WaitForExit(5000)) { $server.Kill(); $server.WaitForExit() }
        $after_pointer=[IntPtr]::Zero
        $after_hr=[StrategyNative]::GetFactory($probe_clsid,0x8004,[ref]$after_pointer)
        if ($after_pointer -ne [IntPtr]::Zero) { [void][Runtime.InteropServices.Marshal]::Release($after_pointer) }
        Note 'identity_preflight_cleanup' @{helper_exited=$server.HasExited;
            random_class_unavailable_hr=('0x{0:X8}' -f $after_hr);registry_edits=0}
        Assert ($after_hr -lt 0 -and $after_pointer -eq [IntPtr]::Zero) 'Temporary helper class is unavailable after server exit'
    }
}
