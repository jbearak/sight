# Independent UI and identity checks shared with the first spike.
function Note($event, $data) {
    $line = @{utc=[DateTime]::UtcNow.ToString('o');run=$run;event=$event;data=$data} |
        ConvertTo-Json -Depth 8 -Compress
    Add-Content -LiteralPath $evidence -Value $line -Encoding UTF8
    [Console]::WriteLine($line)
}
function Assert($condition, $message) {
    Note 'assert' @{ok=[bool]$condition;message=$message}
    if (!$condition) { throw $message }
}
function Inventory {
    @(Get-CimInstance Win32_Process -Filter "Name LIKE 'Stata%'" | ForEach-Object {
        $p = Get-Process -Id $_.ProcessId -ErrorAction Stop
        @{pid=$p.Id;start=$p.StartTime.ToUniversalTime().ToString('o');
            session=$_.SessionId;command_line=$_.CommandLine;title=$p.MainWindowTitle}
    })
}
function Same-Process($identity) {
    $p = Get-Process -Id $identity.pid -ErrorAction SilentlyContinue
    return ($null -ne $p -and
        $p.StartTime.ToUniversalTime().ToString('o') -ceq $identity.start)
}
function Guard {
    $all = @(Inventory)
    foreach ($item in $all) {
        if (!$owned.ContainsKey($item.pid) -or
            $owned[$item.pid].start -cne $item.start) {
            Note 'unexpected_process' $item
            throw 'Unrelated Stata detected: no further COM calls allowed'
        }
    }
    Note 'pre_com_inventory' @($all)
}
function Wait-File($path, [int]$timeout_ms = 15000) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $ready = $false
    while ($clock.ElapsedMilliseconds -lt $timeout_ms) {
        if (Test-Path -LiteralPath $path) {
            try {
                $stream = [IO.File]::Open($path,[IO.FileMode]::Open,
                    [IO.FileAccess]::Read,[IO.FileShare]::None)
                $stream.Dispose()
                $ready = $true
                break
            } catch [IO.IOException] { }
        }
        Start-Sleep -Milliseconds 50
    }
    Assert $ready ('closed ready/response: ' + (Split-Path $path -Leaf))
}
function Check-State($identity, $token, $stage) {
    Assert (Same-Process $identity) "$stage original PID/start survives"
    $nonce = [guid]::NewGuid().ToString('N')
    $response = "$dir\$nonce.ok"
    $check = "$dir\$nonce.do"
    @"
assert _N == 74
assert price[1] == 918273
assert make[1] == "AMC Concord"
assert "`$SIGHT_FACTORY_MARK" == "$token"
assert factory_marker == "$token"
assert c(changed) == 1
datasignature confirm
file open verification using "$response", write replace
file write verification "$nonce|STATE_OK|N=74|price1=918273|changed=1|marker=$token" _n
file close verification
"@ | Set-Content -Encoding ASCII $check
    $p = Get-Process -Id $identity.pid
    $the_controls = @([FactoryNative]::Children($p.MainWindowHandle) | Where-Object {
        [FactoryNative]::Class($_) -ceq 'Scintilla' -and
        [FactoryNative]::Text([FactoryNative]::GetParent($_)) -ceq 'Command'
    })
    Assert ($the_controls.Count -eq 1) "$stage one PID-targeted Command control"
    # WM_CHAR carries characters by value; no cross-process Scintilla pointer.
    foreach ($char in "do `"$check`"".ToCharArray()) {
        if (![FactoryNative]::PostMessage($the_controls[0],0x102,[IntPtr][int]$char,[IntPtr]::Zero)) {
            throw 'WM_CHAR failed'
        }
    }
    [void][FactoryNative]::PostMessage($the_controls[0],0x100,[IntPtr]13,[IntPtr]::Zero)
    [void][FactoryNative]::PostMessage($the_controls[0],0x101,[IntPtr]13,[IntPtr]::Zero)
    Wait-File $response
    $text = [IO.File]::ReadAllText($response).Trim()
    Assert ($text -ceq "$nonce|STATE_OK|N=74|price1=918273|changed=1|marker=$token") "$stage state and nonce match"
    Note 'original_state' @{stage=$stage;pid=$identity.pid;start=$identity.start;response=$text}
}
