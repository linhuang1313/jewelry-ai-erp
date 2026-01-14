# PowerShell script to remove Python 3.12 from system PATH
# This script requires Administrator privileges

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "此脚本需要管理员权限。" -ForegroundColor Red
    Write-Host "请以管理员身份运行 PowerShell，然后执行此脚本。" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "或者运行以下命令：" -ForegroundColor Yellow
    Write-Host "Start-Process powershell -Verb RunAs -ArgumentList '-ExecutionPolicy Bypass -File `"$PSCommandPath`"'" -ForegroundColor Cyan
    exit 1
}

Write-Host "正在从系统 PATH 中移除 Python 3.12..." -ForegroundColor Green
Write-Host ""

# Get current system PATH
$systemPath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$paths = $systemPath -split ';' | Where-Object { $_ }

# Remove Python 3.12 paths
$python312Paths = $paths | Where-Object { $_ -match 'Python312' }
$otherPaths = $paths | Where-Object { $_ -notmatch 'Python312' }

if ($python312Paths) {
    Write-Host "找到以下 Python 3.12 路径：" -ForegroundColor Yellow
    $python312Paths | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
    Write-Host ""
    
    # Rebuild system PATH without Python 3.12
    $newSystemPath = $otherPaths -join ';'
    [Environment]::SetEnvironmentVariable('Path', $newSystemPath, 'Machine')
    
    Write-Host "✅ Python 3.12 已从系统 PATH 中移除！" -ForegroundColor Green
    Write-Host ""
    Write-Host "⚠️  注意：" -ForegroundColor Yellow
    Write-Host "1. 请关闭所有终端窗口并重新打开，使更改生效" -ForegroundColor White
    Write-Host "2. 如果要从系统中完全卸载 Python 3.12，请使用 Windows 的'程序和功能'卸载" -ForegroundColor White
    Write-Host ""
    Write-Host "验证命令：" -ForegroundColor Cyan
    Write-Host "  py -0  # 查看所有已安装的 Python 版本" -ForegroundColor White
} else {
    Write-Host "未在系统 PATH 中找到 Python 3.12 路径。" -ForegroundColor Yellow
}







