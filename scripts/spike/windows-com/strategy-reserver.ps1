param([string]$Directory,[string]$Clsid)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Path "$PSScriptRoot\strategy-native.cs"
$pointer = [IntPtr]::Zero
$hr = [StrategyNative]::GetFactory($Clsid,0x8004,[ref]$pointer)
if ($hr -ne 0) { throw ('Acquire failed 0x{0:X8}' -f $hr) }
[IO.File]::WriteAllText("$Directory\reserver.ready",[string]$PID)
while (!(Test-Path "$Directory\reserver.release")) { Start-Sleep -Milliseconds 20 }
[void][Runtime.InteropServices.Marshal]::Release($pointer)
[IO.File]::WriteAllText("$Directory\reserver.released",'released')
