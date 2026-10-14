<#
.SYNOPSIS
  Nasadí aplikáciu na server (CloudPanel, stránka typu Node.js) cez SSH.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1 -Server 203.0.113.10 -CreateAdmin
  Prvé nasadenie: nahrá aplikáciu, spustí ju a vytvorí prvý admin účet.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1 -Server 203.0.113.10
  Aktualizácia: nahrá novú verziu a reštartuje aplikáciu. Databáza zostáva.
#>
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$User = 'jurajkurek-forms',
  [int]$SshPort = 22,
  [string]$AppDir = '/home/jurajkurek-forms/htdocs/forms.jurajkurek.com',
  [string]$DataDir = '/home/jurajkurek-forms/forms-data',
  [int]$AppPort = 9876,
  [string]$PublicUrl = 'https://forms.jurajkurek.com',
  [string]$AppName = 'forms',
  [switch]$CreateAdmin
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

foreach ($cmd in 'ssh', 'scp', 'tar') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "Chýba príkaz '$cmd'. Vo Windows zapni 'OpenSSH Client' (Nastavenia > Aplikácie > Voliteľné funkcie)."
  }
}

# Bash single-quoted string, safe for any value.
function Quote([string]$value) { "'" + ($value -replace "'", "'\''") + "'" }

function Write-LfFile([string]$path, [string]$text) {
  [IO.File]::WriteAllText($path, ($text -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
}

$id = "forms-deploy-$(Get-Random)"
$tmp = Join-Path ([IO.Path]::GetTempPath()) $id
New-Item -ItemType Directory -Path $tmp | Out-Null
$archive = Join-Path $tmp "$id.tar.gz"
$config = Join-Path $tmp "$id.env"
$script = Join-Path $tmp "$id.sh"

try {
  Write-Host '==> Balím aplikáciu'
  tar -czf $archive -C $root package.json package-lock.json src public scripts
  if ($LASTEXITCODE -ne 0) { throw 'Balenie aplikácie zlyhalo.' }

  $lines = @(
    "APP_DIR=$(Quote $AppDir)"
    "DATA_DIR=$(Quote $DataDir)"
    "APP_PORT=$(Quote $AppPort)"
    "PUBLIC_URL=$(Quote $PublicUrl)"
    "APP_NAME=$(Quote $AppName)"
  )
  if ($CreateAdmin) {
    $email = Read-Host 'E-mail admina'
    $name = Read-Host 'Meno admina'
    $secure = Read-Host 'Heslo admina (min. 8 znakov)' -AsSecureString
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if ($password.Length -lt 8) { throw 'Heslo musí mať aspoň 8 znakov.' }
    $lines += "ADMIN_EMAIL=$(Quote $email)", "ADMIN_NAME=$(Quote $name)", "ADMIN_PASSWORD=$(Quote $password)"
  }
  Write-LfFile $config (($lines -join "`n") + "`n")
  # Git on Windows may have checked the script out with CRLF line endings.
  Write-LfFile $script ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'remote-deploy.sh')))

  $target = "$User@$Server"
  Write-Host "==> Nahrávam na $target"
  scp -P $SshPort $archive $config $script "${target}:"
  if ($LASTEXITCODE -ne 0) { throw 'Nahrávanie cez scp zlyhalo.' }

  Write-Host '==> Spúšťam nasadenie na serveri'
  ssh -p $SshPort $target "bash ~/$id.sh ~/$id.env ~/$id.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw 'Nasadenie na serveri zlyhalo (pozri výpis vyššie).' }

  Write-Host ''
  Write-Host "Hotovo: $PublicUrl/admin" -ForegroundColor Green
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
