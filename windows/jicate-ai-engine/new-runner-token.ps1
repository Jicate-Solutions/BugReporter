# Generates ONE worker's secret on this box and prints ONLY its SHA-256 hash.
# The secret goes into <runner>.env next to this script (readable by this user only)
# and never leaves the machine. Send the printed hash line to the Mac tab
# "jicate ai engine"; the Control Tower stores the hash, bound to the runner name.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\new-runner-token.ps1 -Runner jicate-1
#
# To rotate: delete <runner>.env, run this again, send the new hash.
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9._-]{1,64}$')][string]$Runner,
  [string]$Url = 'https://jkkn-centralized-bug-reporter.vercel.app'
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $here "$Runner.env"
if (Test-Path $envFile) { throw "$envFile already exists. Delete it first if you mean to rotate." }

$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$sha = [System.Security.Cryptography.SHA256]::Create()
$hash = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($token)) | ForEach-Object { $_.ToString('x2') })

# UTF-8 without BOM, LF line endings, exactly two lines.
[System.IO.File]::WriteAllText($envFile, "JICATE_AI_URL=$Url`nJICATE_AI_RUNNER_TOKEN=$token`n", (New-Object System.Text.UTF8Encoding $false))
icacls $envFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
Remove-Variable token, bytes

Write-Output "runner=$Runner sha256=$hash"
