param([string]$Directory)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Path "$PSScriptRoot\factory-interop.cs"
[FactoryInterop]::Build("$Directory\Interop.stata.dll")
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\vbc.exe' /nologo /target:exe /platform:anycpu "/out:$Directory\factory-client.exe" "/reference:$Directory\Interop.stata.dll" "$PSScriptRoot\factory-client.vb"
if ($LASTEXITCODE -ne 0) { throw 'VB.NET compile failed' }
