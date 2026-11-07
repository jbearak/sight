$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$results="$PSScriptRoot\results\production-proof"
New-Item -ItemType Directory -Force $results | Out-Null
$all=@(Get-CimInstance Win32_Process -Filter "Name LIKE 'Stata%'" | Select-Object ProcessId,CreationDate,SessionId,CommandLine)
$record=@{utc=[DateTime]::UtcNow.ToString('o');session=(Get-Process -Id $PID).SessionId;stata=$all;
    powershell=$PSVersionTable.PSVersion.ToString();architecture=[string][Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture;
    bun=(Join-Path $env:TEMP 'sight-bun\bun-windows-x64\bun.exe');
    stata_file_version=(Get-Item 'C:\Program Files\Stata18\StataMP-64.exe').VersionInfo.FileVersion}
[IO.File]::WriteAllText("$results\initial-environment.json",($record|ConvertTo-Json -Depth 5))
if ($record.session -eq 0 -or $all.Count -ne 0) { throw 'Unsafe session or unrelated Stata present' }
$bun=$record.bun
if (!(Test-Path $bun)) { throw 'Windows Bun missing' }
# A dedicated copy avoids changing the user's previous C:\sight-debug copy.
$destination='C:\sight-target-proof'
New-Item -ItemType Directory -Force $destination | Out-Null
$root=Split-Path (Split-Path (Split-Path $PSScriptRoot))
foreach ($name in @('src','scripts','package.json','bun.lock','bun.lockb','tsconfig.json')) {
    $source=Join-Path $root $name
    if (Test-Path $source) { Copy-Item $source $destination -Recurse -Force }
}
Push-Location $destination
try {
    & $bun --version
    & $bun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Windows Bun install failed' }
} finally { Pop-Location }
Write-Output ($record|ConvertTo-Json -Depth 5)
