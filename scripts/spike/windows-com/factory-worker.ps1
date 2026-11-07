param([string]$Directory, [string]$Clsid)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Path "$PSScriptRoot\factory-native.cs"
if ((Get-Process -Id $PID).SessionId -eq 0) { throw 'Session 0 forbidden' }
$pointer = [FactoryNative]::Acquire($Clsid)
[IO.File]::WriteAllText("$Directory\worker.ready", ('pid='+$PID+';factory-only;architecture='+
    [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture))
while (!(Test-Path "$Directory\worker.release")) { Start-Sleep -Milliseconds 50 }
$count = [FactoryNative]::Release($pointer)
[IO.File]::WriteAllText("$Directory\worker.released", ('Release count='+$count))
