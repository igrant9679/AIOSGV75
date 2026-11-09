# Packed inside MissionControlSetup.exe with setup.cmd: puts the newer of GitHub's
# install.ps1 and the bundled one at $env:MC_PS1 (compares MC-INSTALLER-VERSION).
function Get-InstallerVersion($file) {
  $m = Select-String -Path $file -Pattern 'MC-INSTALLER-VERSION:\s*([\d.]+)' -List -ErrorAction SilentlyContinue
  if ($m) { return [version]$m.Matches[0].Groups[1].Value }
  return [version]'0.0'
}
$online = $true
try {
  Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/igrant9679/AIOSGV75/main/install.ps1' -OutFile $env:MC_WEB
} catch { $online = $false }
if ($online -and ((Get-InstallerVersion $env:MC_WEB) -ge (Get-InstallerVersion $env:MC_BUNDLED))) {
  Copy-Item $env:MC_WEB $env:MC_PS1 -Force
  Write-Host 'Using the latest installer from GitHub.'
} else {
  Copy-Item $env:MC_BUNDLED $env:MC_PS1 -Force
  if ($online) { Write-Host 'Using the newer installer bundled in this setup.' } else { Write-Host 'Offline - using the installer bundled in this setup.' }
}
