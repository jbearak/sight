param([string]$Directory,[string]$Token)
$ErrorActionPreference='Stop'
$ref=$null
try {
    $ref=New-Object -ComObject stata.StataOLEApp
    if ($ref.MacroValue('SIGHT_FACTORY_MARK') -cne $Token) { throw 'Client got wrong original' }
    $commands=0
    $deadline=[DateTime]::UtcNow.AddMinutes(5)
    while (!(Test-Path "$Directory\release")) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Client lifetime timeout' }
        if ($ref.UtilIsStataFree()) {
            if ($ref.DoCommand('assert _N == 74 & price[1] == 918273 & c(changed) == 1') -ne 0) { throw 'Client dataset check failed' }
            if ($ref.MacroValue('SIGHT_FACTORY_MARK') -cne $Token) { throw 'Client macro changed' }
            $commands++
            [IO.File]::WriteAllText("$Directory\heartbeat.json",(@{commands=$commands;utc=[DateTime]::UtcNow.ToString('o');token=$Token}|ConvertTo-Json -Compress))
        }
        Start-Sleep -Milliseconds 250
    }
} catch {
    [IO.File]::WriteAllText("$Directory\error.txt",$_.Exception.ToString())
    exit 1
} finally { if ($null -ne $ref) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref) } }
