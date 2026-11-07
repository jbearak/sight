$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Preexisting Stata' }
if ((Get-Process -Id $PID).SessionId -eq 0) { throw 'Session 0' }
$dir = Join-Path $env:TEMP ('sight-strategy-x64-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $dir | Out-Null
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:exe /platform:x64 "/out:$dir\decode.exe" "$PSScriptRoot\strategy-native.cs" "$PSScriptRoot\strategy-decode-x64.cs"
if ($LASTEXITCODE -ne 0) { throw 'Compile failed' }
@"
sysuse auto, clear
replace price = 918273 in 1
file open ready using "$dir\ready", write replace
file close ready
"@ | Set-Content -Encoding ASCII "$dir\original.do"
$p = Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -ArgumentList 'do',"`"$dir\original.do`"" -PassThru
$start = $p.StartTime
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (!(Test-Path "$dir\ready") -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
    if (!(Test-Path "$dir\ready")) { throw 'Original not ready' }
    & "$dir\decode.exe" '{D3D9A260-CA12-48EE-A6B8-492AD0E71E70}'
    'helper_exit=' + $LASTEXITCODE
    'original_alive=' + [bool](Get-Process -Id $p.Id -ErrorAction SilentlyContinue)
} finally {
    $same = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
    if ($same -and $same.StartTime -eq $start) { $same.Kill(); $same.WaitForExit() }
}
