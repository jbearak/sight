$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$checks = @()
$the_files = @(Get-ChildItem "$PSScriptRoot\strategy-*.ps1") + @(Get-Item "$PSScriptRoot\factory-probe.ps1","$PSScriptRoot\factory-inventory.ps1")
foreach ($file in $the_files) {
    $tokens=$null
    $errors=$null
    [void][Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
    $checks += @{file=$file.Name;parser_errors=@($errors | ForEach-Object { $_.Message })}
    if ($errors.Count -ne 0) { throw ('PowerShell parse failed: '+$file.Name) }
}
$json=@{utc=[DateTime]::UtcNow.ToString('o');powershell=$PSVersionTable.PSVersion.ToString();checks=$checks} | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText("$PSScriptRoot\results\factory-strategy\powershell-parse.json",$json)
Write-Output $json
