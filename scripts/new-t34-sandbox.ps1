param([string]$DeliveryPath = (Join-Path $PSScriptRoot '..\release'))
$ErrorActionPreference = 'Stop'
$delivery = (Resolve-Path -LiteralPath $DeliveryPath).Path
$installers = @(Get-ChildItem -LiteralPath $delivery -Filter 'FrameMind-*-Windows-x64-Setup.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows installer in DeliveryPath' }
$evidence = Join-Path $delivery 'sandbox-evidence'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 't34-sandbox-smoke.ps1') -Destination (Join-Path $delivery 'sandbox-smoke.ps1')
$hostDelivery = [System.Security.SecurityElement]::Escape($delivery)
$hostEvidence = [System.Security.SecurityElement]::Escape($evidence)
$configuration = @"
<Configuration>
  <Networking>Disable</Networking>
  <MappedFolders>
    <MappedFolder><HostFolder>$hostDelivery</HostFolder><SandboxFolder>C:\Delivery</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$hostEvidence</HostFolder><SandboxFolder>C:\Evidence</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Delivery\sandbox-smoke.ps1</Command></LogonCommand>
</Configuration>
"@
Set-Content -LiteralPath (Join-Path $delivery 'FrameMind-offline.wsb') -Value $configuration -Encoding UTF8
Write-Output "Created $(Join-Path $delivery 'FrameMind-offline.wsb'). Open it on a Windows Sandbox enabled machine."
