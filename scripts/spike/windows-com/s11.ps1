param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Stata is already open.' }
Start-Transcript -Path "$Results\s11.txt" -Force | Out-Null
$dir = Join-Path $env:TEMP 'sight-com-spike-s11'
New-Item -ItemType Directory -Force $dir | Out-Null
$fso = New-Object -ComObject Scripting.FileSystemObject
$short = $fso.GetFolder($dir).ShortPath
$log = "$short\startup.log"
$ready = "$short\ready"
$script = "$short\start.do"
Remove-Item $ready,$log -ErrorAction SilentlyContinue
$stata = @"
set more off
set linesize 80
sysuse auto, clear
capture log using "$log", text replace name(_spike)
global SIGHT_SPIKE_LOG_RC = _rc
global SIGHT_SPIKE_MARK "s11"
global SIGHT_SPIKE_MORE "``=c(more)'"
display uchar(233) + uchar(26481) + uchar(20140)
file open ready using "$ready", write replace
file close ready
"@
[IO.File]::WriteAllText($script, $stata, (New-Object Text.UTF8Encoding($false)))
Write-Output "$(Get-Date -Format o) before launch; short=$short"
$p = Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -ArgumentList 'do', "`"$script`"" -PassThru
Write-Output "launched PID=$($p.Id)"
$deadline = (Get-Date).AddSeconds(30)
while (!(Test-Path $ready) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 10 }
if (!(Test-Path $ready)) { throw 'ready not found' }
for ($i=0; $i -lt 20; $i++) {
    $stream = [IO.File]::Open($log, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $length = $stream.Length
    $stream.Dispose()
    Write-Output "$(Get-Date -Format o) ready sample=$i bytes=$length"
    Start-Sleep -Milliseconds 50
}
$stream = [IO.File]::Open($log, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
$out = [IO.File]::Create("$Results\s11-startup.log")
$stream.CopyTo($out)
$out.Dispose()
$stream.Dispose()
$ref = New-Object -ComObject stata.StataOLEApp
Write-Output "marker=[$($ref.MacroValue('SIGHT_SPIKE_MARK'))] log_rc=[$($ref.MacroValue('SIGHT_SPIKE_LOG_RC'))] more=[$($ref.MacroValue('SIGHT_SPIKE_MORE'))]"
Write-Output "$(Get-Date -Format o) sending exit with unchanged data"
$ref.DoCommandAsync('exit') | Out-Null
Start-Sleep -Seconds 3
Write-Output "$(Get-Date -Format o) process alive=$([bool](Get-Process -Id $p.Id -ErrorAction SilentlyContinue))"
try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref) } catch { Write-Output $_ }
Write-Output "$(Get-Date -Format o) changed-data case: CreateObject"
$changed = New-Object -ComObject stata.StataOLEApp
$changed.DoCommand('sysuse auto, clear') | Out-Null
$changed.DoCommand('replace price = price + 1 in 1') | Out-Null
Get-Process Stata* | Select-Object Id,MainWindowTitle | Format-List
$changed.DoCommandAsync('exit') | Out-Null
Start-Sleep -Seconds 2
Write-Output "$(Get-Date -Format o) changed-data exit; processes:"
Get-Process Stata* -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle | Format-List
try { Write-Output "free=$($changed.UtilIsStataFree()) rc=$($changed.UtilStataErrorCode())" } catch { Write-Output "query error $_" }
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($changed)
Stop-Transcript | Out-Null
