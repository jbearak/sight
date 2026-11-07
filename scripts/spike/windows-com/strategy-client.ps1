param([string]$Directory, [string]$Token)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ((Get-Process -Id $PID).SessionId -eq 0) { throw 'Session 0' }
$ref = $null
try {
    $ref = New-Object -ComObject stata.StataOLEApp
    if ($ref.MacroValue('SIGHT_FACTORY_MARK') -cne $Token) { throw 'Wrong held original' }
    [IO.File]::WriteAllText("$Directory\client.ready",[string]$PID)
    $last = ''
    $deadline = [DateTime]::UtcNow.AddMinutes(5)
    while (!(Test-Path "$Directory\client.release")) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Client timeout' }
        if (Test-Path "$Directory\client.request") {
            $nonce = [IO.File]::ReadAllText("$Directory\client.request")
            if ($nonce -cne $last -and $nonce.Length -gt 0) {
                $rc = $ref.DoCommand('assert _N == 74 & price[1] == 918273 & c(changed) == 1')
                if ($rc -ne 0 -or $ref.MacroValue('SIGHT_FACTORY_MARK') -cne $Token) {
                    throw 'Existing client state changed'
                }
                if ($ref.DoCommand('datasignature confirm') -ne 0) { throw 'Signature changed' }
                [IO.File]::WriteAllText("$Directory\client.response",$nonce)
                $last = $nonce
            }
        }
        Start-Sleep -Milliseconds 20
    }
} catch {
    [IO.File]::WriteAllText("$Directory\client.error",$_.Exception.ToString())
    exit 1
} finally {
    if ($null -ne $ref) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref) }
}
