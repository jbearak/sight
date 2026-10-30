param([string]$Marker, [string]$Evidence)
$ErrorActionPreference = 'Stop'
Start-Transcript -Path $Evidence -Force | Out-Null
$mutex = New-Object Threading.Mutex($false, 'Local\SightConsoleConnect')
$held = $false
$refs = @()
try {
    Write-Output "$(Get-Date -Format o) $Marker waiting"
    $held = $mutex.WaitOne(65000)
    if (!$held) { throw 'mutex timeout' }
    Write-Output "$(Get-Date -Format o) $Marker acquired"
    for ($i=0; $i -lt 3; $i++) {
        $ref = New-Object -ComObject stata.StataOLEApp
        $refs += $ref
        $value = $ref.MacroValue('SIGHT_SPIKE_MARK')
        Write-Output "$(Get-Date -Format o) attempt=$i marker=[$value]"
        Get-Process Stata* | Select-Object Id,MainWindowTitle | Format-List
        if ($value -ceq $Marker) { break }
    }
    foreach ($item in $refs) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item) }
    $refs = @()
} catch { Write-Output "error=$_" }
finally {
    if ($held) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
    Write-Output "$(Get-Date -Format o) $Marker finished"
    Stop-Transcript | Out-Null
}
