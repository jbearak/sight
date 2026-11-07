param([ValidateSet('backup-mutate','restore')][string]$Action,[ValidateSet('HKLM','HKCU')][string]$Hive,[string]$Directory)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$class_path='SOFTWARE\Classes\CLSID\{D3D9A260-CA12-48EE-A6B8-492AD0E71E70}'
$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($(if($Hive -eq 'HKLM'){[Microsoft.Win32.RegistryHive]::LocalMachine}else{[Microsoft.Win32.RegistryHive]::CurrentUser}),[Microsoft.Win32.RegistryView]::Registry64)
function Tree($key) {
    if ($null -eq $key) { return $null }
    $values=[ordered]@{}; $children=[ordered]@{}
    foreach ($name in @($key.GetValueNames()|Sort-Object)) {
        $value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($value -is [byte[]]) { $value=[Convert]::ToBase64String($value) }
        $values[$name]=[ordered]@{kind=[string]$key.GetValueKind($name);value=$value}
    }
    foreach ($name in @($key.GetSubKeyNames()|Sort-Object)) {
        $child=$key.OpenSubKey($name)
        try { $children[$name]=Tree $child } finally { $child.Close() }
    }
    return [ordered]@{values=$values;children=$children}
}
function Snapshot($path) {
    $key=$base.OpenSubKey($path)
    try { return Tree $key } finally { if($key){$key.Close()} }
}
function Canonical($value) {
    if($null -eq $value){return 'null'}
    if($value -is [Collections.IDictionary]){
        $parts=New-Object 'System.Collections.Generic.List[string]'
        foreach($name in @($value.Keys|Sort-Object)){
            $parts.Add(($name|ConvertTo-Json -Compress)+':'+(Canonical $value[$name]))
        }
        return '{'+($parts -join ',')+'}'
    }
    if($value -is [Array]){
        $parts=New-Object 'System.Collections.Generic.List[string]'
        foreach($item in $value){$parts.Add((Canonical $item))}
        return '['+($parts -join ',')+']'
    }
    return ConvertTo-Json -InputObject $value -Compress
}
try {
    if($Action -eq 'backup-mutate') {
        if (Test-Path "$Directory\registry-before.json") { throw 'Backup already exists; refusing overwrite' }
        $appid=[guid]::NewGuid().ToString('B')
        $app_path='SOFTWARE\Classes\AppID\'+$appid
        if ($null -ne (Snapshot $app_path)) { throw 'Random AppID already exists' }
        $before=Snapshot $class_path
        $class=$base.OpenSubKey($class_path)
        $has_appid=$null -ne $class -and @($class.GetValueNames()) -contains 'AppID'
        $old_value=$null; $old_kind=$null
        if($has_appid){$old_value=$class.GetValue('AppID');$old_kind=[string]$class.GetValueKind('AppID')}
        if($class){$class.Close()}
        $parents=@{}
        foreach($parent_path in @('SOFTWARE\Classes\CLSID','SOFTWARE\Classes\AppID')) {
            $parent_key=$base.OpenSubKey($parent_path)
            $parents[$parent_path]=($null -ne $parent_key)
            if($parent_key){$parent_key.Close()}
        }
        $record=@{hive=$Hive;class_path=$class_path;app_path=$app_path;appid=$appid;class_existed=($null -ne $before);before=$before;had_appid=$has_appid;old_appid=$old_value;old_kind=$old_kind;parents=$parents;user=[Security.Principal.WindowsIdentity]::GetCurrent().Name;session=(Get-Process -Id $PID).SessionId}
        [IO.File]::WriteAllText("$Directory\registry-before.json",($record|ConvertTo-Json -Depth 30))
        if($record.class_existed){
            & "$env:WINDIR\System32\reg.exe" export "$Hive\$class_path" "$Directory\class-backup.reg" /y
            if($LASTEXITCODE -ne 0){throw 'Registry export failed'}
        } else { [IO.File]::WriteAllText("$Directory\class-backup.absent.txt",'Class key absent before test; restore must remove only the created key.') }
        [IO.File]::WriteAllText("$Directory\registry-change-started",'started')
        $class=$base.CreateSubKey($class_path)
        try {$class.SetValue('AppID',$appid,[Microsoft.Win32.RegistryValueKind]::String)}finally{$class.Close()}
        $app=$base.CreateSubKey($app_path)
        try {$app.SetValue('RunAs','Interactive User',[Microsoft.Win32.RegistryValueKind]::String)}finally{$app.Close()}
        [IO.File]::WriteAllText("$Directory\registry-mutated.json",(@{class=(Snapshot $class_path);appid=(Snapshot $app_path)}|ConvertTo-Json -Depth 30))
    } else {
        # Windows PowerShell 5.1's ConvertFrom-Json rejects empty property
        # names; registry default values legitimately have the empty name.
        Add-Type -AssemblyName System.Web.Extensions
        $serializer=New-Object Web.Script.Serialization.JavaScriptSerializer
        $saved=$serializer.DeserializeObject([IO.File]::ReadAllText("$Directory\registry-before.json"))
        $class=$base.OpenSubKey($class_path,$true)
        if($class){
            try {
                if([string]$class.GetValue('AppID') -cne $saved.appid){throw 'Registry changed unexpectedly; stop before restore'}
                if($saved.had_appid){
                    $kind=[Enum]::Parse([Microsoft.Win32.RegistryValueKind],[string]$saved.old_kind)
                    $class.SetValue('AppID',$saved.old_appid,$kind)
                }
                else{$class.DeleteValue('AppID',$false)}
                if(!$saved.class_existed -and ($class.GetValueNames().Count -ne 0 -or $class.GetSubKeyNames().Count -ne 0)){throw 'Unexpected content in created class key'}
            }finally{$class.Close()}
        }
        if(!$saved.class_existed){$base.DeleteSubKey($class_path,$false)}
        $app=$base.OpenSubKey($saved.app_path)
        if($app){
            try {if($app.GetSubKeyNames().Count -ne 0 -or $app.GetValueNames().Count -ne 1 -or $app.GetValue('RunAs') -cne 'Interactive User'){throw 'Unexpected content in temporary AppID'}}finally{$app.Close()}
            $base.DeleteSubKey($saved.app_path,$false)
        }
        $after=Snapshot $class_path
        $equal=(Canonical $saved.before) -ceq (Canonical $after)
        [IO.File]::WriteAllText("$Directory\registry-after-tree.json",(ConvertTo-Json -InputObject $after -Depth 30))
        $verified=@{hive=$Hive;class_matches_backup=$equal;temporary_appid_absent=($null -eq (Snapshot $saved.app_path))}
        [IO.File]::WriteAllText("$Directory\registry-restored.json",($verified|ConvertTo-Json -Depth 30))
        if(!$equal -or !$verified.temporary_appid_absent){throw 'Registry restore verification failed'}
        foreach($parent_path in $saved.parents.Keys) {
            if(!$saved.parents[$parent_path]) {
                $parent_key=$base.OpenSubKey($parent_path)
                if($parent_key){
                    try {if($parent_key.GetValueNames().Count -ne 0 -or $parent_key.GetSubKeyNames().Count -ne 0){throw 'Unexpected new registry parent content'}}finally{$parent_key.Close()}
                    $base.DeleteSubKey($parent_path,$false)
                }
            }
        }
    }
} finally {$base.Close()}
