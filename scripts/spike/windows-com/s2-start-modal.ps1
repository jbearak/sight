$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) {
    throw 'Close existing Stata instances before running this script.'
}
$dir = Join-Path $env:TEMP 'sight-com-spike-modal'
New-Item -ItemType Directory -Force $dir | Out-Null
@'
sysuse auto, clear
global SIGHT_SPIKE_MARK "modal_s2"
cls
db regress
'@ | Set-Content -Encoding ASCII "$dir\modal.do"
Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -ArgumentList 'do', "`"$dir\modal.do`""
