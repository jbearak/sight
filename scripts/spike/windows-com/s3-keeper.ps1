param(
    [Parameter(Mandatory = $true)][int]$StataPid,
    [Parameter(Mandatory = $true)][string]$Marker,
    [Parameter(Mandatory = $true)][string]$Evidence
)
$ErrorActionPreference = 'Stop'
function Record($message) {
    Add-Content -Path $Evidence -Value "$(Get-Date -Format o) $message"
}
try {
    Record "helper PID=$PID; target PID=$StataPid; connecting"
    $ref = New-Object -ComObject stata.StataOLEApp
    $value = $ref.MacroValue('SIGHT_SPIKE_MARK')
    Record "marker=[$value]"
    if ($value -cne $Marker) { throw 'Marker mismatch; no commands sent.' }
    while (Get-Process -Id $StataPid -ErrorAction SilentlyContinue) {
        Record "holding reference; free=$($ref.UtilIsStataFree())"
        Start-Sleep -Seconds 2
    }
    Record 'Stata process exited; helper ending'
} catch {
    Record "error: $_"
    throw
}
