$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Stata is already open.' }
$dir = Join-Path $env:TEMP 'sight-com-spike-editor'
New-Item -ItemType Directory -Force $dir | Out-Null
@'
sysuse auto, clear
global SIGHT_SPIKE_MARK "editor_s13"
window manage maintitle "Stata - sight spike s7"
cls
edit
'@ | Set-Content -Encoding ASCII "$dir\editor.do"
Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -ArgumentList 'do', "`"$dir\editor.do`""
