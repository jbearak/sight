param([int]$ProcessId,[string]$Start)
$ErrorActionPreference='Stop'
if (@(Get-Process Taskmgr -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'Refusing to alter a preexisting Task Manager'
}
$candidate=Get-Process -Id $ProcessId
if ($candidate.StartTime.ToUniversalTime().ToString('o') -cne $Start) {
    throw 'Leftover PID/start changed'
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$started=[DateTime]::UtcNow
[void](Start-Process taskmgr.exe -PassThru)
$manager=$null
try {
    $clock=[Diagnostics.Stopwatch]::StartNew()
    $window=$null
    while ($clock.ElapsedMilliseconds -lt 15000) {
        $candidates=@(Get-Process Taskmgr -ErrorAction SilentlyContinue|Where-Object {
            $_.MainWindowHandle -and $_.MainWindowHandle -ne [IntPtr]::Zero
        })
        if ($candidates.Count -eq 1) {
            $manager=$candidates[0]
            [void]$manager.Handle
            $window=[Windows.Automation.AutomationElement]::FromHandle($manager.MainWindowHandle)
            break
        }
        Start-Sleep -Milliseconds 100
    }
    if (!$window) { throw 'Task Manager window unavailable' }
    $condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,'Details')
    $details=$null
    $clock.Restart()
    while ($clock.ElapsedMilliseconds -lt 15000 -and !$details) {
        $details=$window.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)
        if (!$details) { Start-Sleep -Milliseconds 200 }
    }
    if (!$details) {
        $names=@($window.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)|ForEach-Object {$_.Current.Name})
        throw ('Task Manager Details navigation unavailable: '+($names -join ' | '))
    }
    $pattern=$null
    if ($details.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {
        $pattern.Invoke()
    } elseif ($details.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)) {
        $pattern.Select()
    } else { throw 'Task Manager Details navigation not invokable' }
    $found=$null
    $clock.Restart()
    while ($clock.ElapsedMilliseconds -lt 15000) {
        $items=$window.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
        foreach ($item in $items) {
            $name=$item.Current.Name
            if ($name -like '*StataMP-64.exe*' -and $name -match ('\b'+$ProcessId+'\b')) { $found=$name;break }
            if ($name -like '*StataMP-64.exe*') {
                $row=$item
                for($depth=0;$depth -lt 3 -and $row;$depth++) {
                    if ($row.Current.ControlType -eq [Windows.Automation.ControlType]::DataItem -or $row.Current.ControlType -eq [Windows.Automation.ControlType]::ListItem) {
                        $cells=@($row.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)|ForEach-Object {$_.Current.Name})
                        $row_text=$name+' | '+($cells -join ' | ')
                        if ($row_text -match ('\b'+$ProcessId+'\b')) { $found=$row_text;break }
                    }
                    $row=[Windows.Automation.TreeWalker]::RawViewWalker.GetParent($row)
                }
            }
            if ($found) { break }
        }
        if ($found) { break }
        Start-Sleep -Milliseconds 200
    }
    if (!$found) {
        $names=@($items|ForEach-Object {$_.Current.Name}|Where-Object {$_})
        throw ('Task Manager did not expose the known Stata executable and PID in Details: '+($names -join ' | '))
    }
    return @{pid=$ProcessId;start=$Start;details_row=$found;task_manager_pid=$manager.Id}
} finally {
    foreach($created in @(Get-Process Taskmgr -ErrorAction SilentlyContinue)) {
        if ($created.StartTime.ToUniversalTime() -ge $started -and !$created.HasExited) {
            $created.CloseMainWindow()|Out-Null
            if(!$created.WaitForExit(3000)){$created.Kill();$created.WaitForExit()}
        }
    }
}
