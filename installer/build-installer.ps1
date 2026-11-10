<#
  Builds dist\MissionControlSetup.exe with IExpress (built into Windows - no downloads).
  The .exe carries setup.cmd + pick-installer.ps1 + install.ps1; at run time it uses the
  newer of GitHub's install.ps1 and the bundled one (MC-INSTALLER-VERSION), or the bundled
  one when offline.
  Also copies the logo + icon to dist\. Run:  installer\build-installer.cmd

  -ProductName "Agentic Operations Control" builds a renamed copy instead
  (dist\AgenticOperationsControlSetup.exe) that runs the installer as that product.
#>
param([string]$ProductName = "Mission Control")
$ErrorActionPreference = "Stop"
$branded = $ProductName -ne "Mission Control"
$exeName = (($ProductName -split '[^A-Za-z0-9]+' | Where-Object { $_ } | ForEach-Object { $_.Substring(0, 1).ToUpper() + $_.Substring(1) }) -join '') + "Setup.exe"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stage = Join-Path $env:TEMP "mc-setup-stage"
$out = Join-Path $root "dist"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage, $out | Out-Null
if ($branded) {
  # same bootstrap, but it tells the installer which product it is
  $cmd = Get-Content (Join-Path $PSScriptRoot "setup.cmd") -Raw
  $cmd = $cmd.Replace("title Mission Control Setup", "title $ProductName Setup")
  $cmd = $cmd.Replace('"%MC_PS1%" %*', ('"%MC_PS1%" -ProductName "' + $ProductName + '" %*'))
  if ($cmd -notmatch [regex]::Escape("-ProductName")) { throw "setup.cmd changed - couldn't add -ProductName" }
  Set-Content -Path (Join-Path $stage "setup.cmd") -Value $cmd -Encoding Ascii -NoNewline
} else {
  Copy-Item (Join-Path $PSScriptRoot "setup.cmd") $stage
}
Copy-Item (Join-Path $PSScriptRoot "pick-installer.ps1") $stage
Copy-Item (Join-Path $root "install.ps1") $stage
$exe = Join-Path $out $exeName
if (Test-Path $exe) { Remove-Item $exe -Force }

$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$exe
FriendlyName=$ProductName Setup
AppLaunched=cmd /c setup.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
FILE0="setup.cmd"
FILE1="install.ps1"
FILE2="pick-installer.ps1"
[SourceFiles]
SourceFiles0=$stage\
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
"@
$sedFile = Join-Path $stage "setup.sed"
Set-Content -Path $sedFile -Value $sed -Encoding Ascii
# iexpress is a GUI program - wait for it explicitly
$p = Start-Process -FilePath (Join-Path $env:SystemRoot "System32\iexpress.exe") -ArgumentList "/N", "/Q", $sedFile -WorkingDirectory $stage -Wait -PassThru
if (-not (Test-Path $exe)) { Write-Host "Build failed - IExpress exit code $($p.ExitCode), no exe produced." -ForegroundColor Red; exit 1 }
foreach ($a in @("mission-control-logo.png", "mission-control-logo.svg", "mission-control.ico")) {
  $src = Join-Path $PSScriptRoot "assets\$a"
  if (Test-Path $src) { Copy-Item $src $out -Force }
}
Write-Host "Built $exe ($([math]::Round((Get-Item $exe).Length / 1KB)) KB)" -ForegroundColor Green
