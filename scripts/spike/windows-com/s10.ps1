param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Stata is already open.' }
Start-Transcript -Path "$Results\s10.txt" -Force | Out-Null
$ref = New-Object -ComObject stata.StataOLEApp
Get-Process Stata* | Select-Object Id,MainWindowTitle | Format-List
$ref.DoCommand('sysuse auto, clear') | Out-Null
foreach ($n in @(4108, 4109, 4110, 4111)) {
    foreach ($character in @('a', [string][char]0x00e9)) {
        $prefix = 'global SIGHT_SPIKE_LONG "'
        $suffix = '"'
        $cmd = $prefix + ($character * ($n - $prefix.Length - $suffix.Length)) + $suffix
        Write-Output "$(Get-Date -Format o) units=$($cmd.Length) utf8=$([Text.Encoding]::UTF8.GetByteCount($cmd)) codepoint=$([int][char]$character)"
        try {
            $ref.DoCommandAsync('global SIGHT_SPIKE_LONG "reset"') | Out-Null
            Start-Sleep -Milliseconds 150
            $ref.DoCommandAsync($cmd) | Out-Null
            Start-Sleep -Milliseconds 300
            $value = $ref.MacroValue('SIGHT_SPIKE_LONG')
            Write-Output "$(Get-Date -Format o) free=$($ref.UtilIsStataFree()) value_units=$($value.Length) rc=$($ref.UtilStataErrorCode())"
        } catch { Write-Output "$(Get-Date -Format o) error=$_" }
    }
}
$nul = 'global SIGHT_SPIKE_LONG "before' + [char]0 + 'after"'
try {
    $ref.DoCommandAsync($nul) | Out-Null
    Start-Sleep -Milliseconds 300
    Write-Output "NUL free=$($ref.UtilIsStataFree()) value=[$($ref.MacroValue('SIGHT_SPIKE_LONG'))] rc=$($ref.UtilStataErrorCode())"
} catch { Write-Output "NUL error=$_" }
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref)
Stop-Transcript | Out-Null
