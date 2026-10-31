param([string]$HostName = 'windows-terminal', [string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Stata is already open.' }
$dir = Join-Path $env:TEMP 'sight-com-spike-terminal'
New-Item -ItemType Directory -Force $dir | Out-Null
$ready = "$dir\ready"
Remove-Item $ready -ErrorAction SilentlyContinue
@"
sysuse auto, clear
global SIGHT_SPIKE_MARK "s3_terminal"
cls
file open ready using "$ready", write replace
file close ready
"@ | Set-Content -Encoding ASCII "$dir\start.do"
$p = Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -ArgumentList 'do', "`"$dir\start.do`"" -PassThru
$deadline = (Get-Date).AddSeconds(30)
while (!(Test-Path $ready) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 50 }
if (!(Test-Path $ready)) { throw 'Stata was not ready' }
$bun = "$env:TEMP\sight-bun\bun-windows-x64\bun.exe"
$evidence = "$Results\s3-$HostName.txt"
Remove-Item $evidence -ErrorAction SilentlyContinue
$args = @('-w','new','new-tab','--title','SightSpikeS3',"`"$bun`"",
    "`"$PSScriptRoot\s3-terminal.ts`"", $p.Id, 's3_terminal', "`"$evidence`"")
Start-Process wt.exe -ArgumentList $args
Write-Output "$(Get-Date -Format o) Stata PID=$($p.Id); requested Windows Terminal"
