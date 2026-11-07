$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$snapshots = @()
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryHive]::CurrentUser)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
        $paths = @('SOFTWARE\Classes\stata.StataOLEApp\CLSID',
            'SOFTWARE\Classes\CLSID\{D3D9A260-CA12-48EE-A6B8-492AD0E71E70}',
            'SOFTWARE\Classes\CLSID\{D3D9A260-CA12-48EE-A6B8-492AD0E71E70}\LocalServer32',
            'SOFTWARE\Classes\AppID\StataMP-64.exe',
            'SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock')
        foreach ($path in $paths) {
            $key = $base.OpenSubKey($path)
            $values = @{}
            if ($key) {
                foreach ($name in $key.GetValueNames()) { $values[$name]=$key.GetValue($name) }
                $app_id = $key.GetValue('AppID')
                if ($app_id) {
                    $app_key = $base.OpenSubKey("SOFTWARE\Classes\AppID\$app_id")
                    $app_values = @{}
                    if ($app_key) {
                        foreach ($name in $app_key.GetValueNames()) { $app_values[$name]=$app_key.GetValue($name) }
                        $app_key.Close()
                    }
                    $snapshots += @{hive=[string]$hive;view=[string]$view;path="SOFTWARE\Classes\AppID\$app_id";values=$app_values}
                }
                $key.Close()
            }
            $snapshots += @{hive=[string]$hive;view=[string]$view;path=$path;present=($null -ne $key);values=$values}
        }
        $base.Close()
    }
}
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$record = @{utc=[DateTime]::UtcNow.ToString('o');session=(Get-Process -Id $PID).SessionId;
    elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
    os=(Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture);
    powershell=$PSVersionTable.PSVersion.ToString();clr=[Environment]::Version.ToString();
    helper_architecture=[string][Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture;
    stata_version=(Get-Item 'C:\Program Files\Stata18\StataMP-64.exe').VersionInfo.FileVersion;
    registration=$snapshots}
$json = $record | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText("$PSScriptRoot\results\factory-strategy\environment.json",$json)
Write-Output $json
