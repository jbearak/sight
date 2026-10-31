$ErrorActionPreference = 'Stop'
$results = "$PSScriptRoot\results"
Start-Transcript -Path "$results\pane-cli-suite.txt" -Force | Out-Null
try {
    foreach ($scenario in @('basic', 'decline', 'share', 'yes', 'two', 'lostlog')) {
        Write-Output "$(Get-Date -Format o) starting $scenario"
        & powershell.exe -Sta -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\debug-conpty.ps1" -Scenario $scenario -OutputPath "$results\pane-cli-$scenario.bin"
        if ($LASTEXITCODE -ne 0) { throw "$scenario failed with $LASTEXITCODE" }
    }
} finally {
    Stop-Transcript | Out-Null
}
