$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$results="$PSScriptRoot\results\production-proof"
$os=Get-CimInstance Win32_OperatingSystem
$environment=@{
    utc=[DateTime]::UtcNow.ToString('o');windows=$os.Caption;version=$os.Version;
    build=$os.BuildNumber;os_architecture=$os.OSArchitecture;
    helper_architecture=[Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString();
    powershell=$PSVersionTable.PSVersion.ToString();session=(Get-Process -Id $PID).SessionId;
    stata_exe='C:\Program Files\Stata18\StataMP-64.exe';
    stata_file_version=(Get-Item 'C:\Program Files\Stata18\StataMP-64.exe').VersionInfo.FileVersion;
    clsid='{D3D9A260-CA12-48EE-A6B8-492AD0E71E70}';registration=@{}
}
foreach($hive in @('HKLM','HKCU')){
    $path=$hive+':\Software\Classes\CLSID\'+$environment.clsid
    $item=Get-Item $path -ErrorAction SilentlyContinue
    $server=Get-Item ($path+'\LocalServer32') -ErrorAction SilentlyContinue
    $environment.registration[$hive]=@{
        class_present=($null -ne $item);
        appid=$(if($item){$item.GetValue('AppID')}else{$null});
        local_server=$(if($server){$server.GetValue('')}else{$null})
    }
}
[IO.File]::WriteAllText("$results\verified-environment.json",($environment|ConvertTo-Json -Depth 5))
$stata=@(Get-CimInstance Win32_Process -Filter "Name LIKE 'Stata%'"|ForEach-Object {
    $p=Get-Process -Id $_.ProcessId
    @{pid=$p.Id;start=$p.StartTime.ToUniversalTime().ToString('o');session=$_.SessionId;command_line=$_.CommandLine}
})
$helpers=@(Get-CimInstance Win32_Process|Where-Object {
    $_.ProcessId -ne $PID -and ($_.Name -eq 'Taskmgr.exe' -or $_.CommandLine -match '(sight-target-proof|\\proof-[^\\]+\\)')
}|Select-Object ProcessId,Name,CreationDate,CommandLine)
$inventory=@{utc=[DateTime]::UtcNow.ToString('o');session=(Get-Process -Id $PID).SessionId;user=[Security.Principal.WindowsIdentity]::GetCurrent().Name;stata=$stata;helpers=$helpers}
[IO.File]::WriteAllText("$results\final-inventory.json",($inventory|ConvertTo-Json -Depth 5))
$repo='C:\sight-target-proof'
$hashes=@(Get-ChildItem "$repo\src" -Recurse -File|ForEach-Object {
    @{file=$_.FullName.Substring($repo.Length+1).Replace('\','/');sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash}
})
[IO.File]::WriteAllText("$results\windows-source-hashes.json",($hashes|ConvertTo-Json -Depth 3))
$checks=@()
foreach($file in @(Get-ChildItem "$PSScriptRoot\proof-*.ps1")+@(Get-Item "$PSScriptRoot\debug-conpty.ps1","$PSScriptRoot\strategy-common.ps1")) {
    $tokens=$null;$errors=$null
    [void][Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
    $checks+=@{file=$file.Name;errors=@($errors|ForEach-Object {$_.Message})}
    if($errors.Count -ne 0){throw ('Parse error in '+$file.Name)}
}
[IO.File]::WriteAllText("$results\powershell-parse.json",(@{utc=[DateTime]::UtcNow.ToString('o');checks=$checks}|ConvertTo-Json -Depth 5))
Write-Output ($inventory|ConvertTo-Json -Depth 5)
if($stata.Count -ne 0 -or $helpers.Count -ne 0){exit 1}
