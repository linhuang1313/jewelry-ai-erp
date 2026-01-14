# PowerShell script to set Python 3.10 as system default
# This script requires Administrator privileges
# Run: PowerShell -ExecutionPolicy Bypass -File set_python310_default.ps1

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "This script requires Administrator privileges." -ForegroundColor Red
    Write-Host "Please run PowerShell as Administrator and execute this script again." -ForegroundColor Yellow
    Write-Host "Or run: Start-Process powershell -Verb RunAs -ArgumentList '-ExecutionPolicy Bypass -File $PSCommandPath'" -ForegroundColor Yellow
    exit 1
}

Write-Host "Setting Python 3.10 as default..." -ForegroundColor Green

# Get current system PATH
$systemPath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$paths = $systemPath -split ';' | Where-Object { $_ }

# Remove Python 3.14 paths
$paths = $paths | Where-Object { $_ -notmatch 'Python314' }

# Rebuild system PATH
$newSystemPath = $paths -join ';'
[Environment]::SetEnvironmentVariable('Path', $newSystemPath, 'Machine')

# Get current user PATH
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$userPaths = $userPath -split ';' | Where-Object { $_ }

# Ensure Python 3.10 is at the front of user PATH
$python310Paths = @(
    'C:\Users\hlin2\AppData\Local\Programs\Python\Python310',
    'C:\Users\hlin2\AppData\Local\Programs\Python\Python310\Scripts'
)
$otherUserPaths = $userPaths | Where-Object { $_ -notin $python310Paths }
$newUserPath = ($python310Paths + $otherUserPaths) -join ';'
[Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')

Write-Host "`nPython 3.10 has been set as default!" -ForegroundColor Green
Write-Host "`nPlease restart your terminal or run: refreshenv" -ForegroundColor Yellow
Write-Host "Then verify with: python --version" -ForegroundColor Yellow







