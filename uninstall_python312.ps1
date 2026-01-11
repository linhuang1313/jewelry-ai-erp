# PowerShell script to uninstall Python 3.12 completely
# This script requires Administrator privileges

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "此脚本需要管理员权限。" -ForegroundColor Red
    Write-Host "请以管理员身份运行 PowerShell，然后执行此脚本。" -ForegroundColor Yellow
    exit 1
}

Write-Host "正在查找 Python 3.12 的所有组件..." -ForegroundColor Green
Write-Host ""

# 获取所有 Python 3.12 组件
$python312Components = Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* | 
    Where-Object { $_.DisplayName -like "*Python*3.12*" } | 
    Select-Object DisplayName, UninstallString, PSChildName

if (-not $python312Components) {
    Write-Host "未找到 Python 3.12 组件。" -ForegroundColor Yellow
    exit 0
}

Write-Host "找到以下 Python 3.12 组件：" -ForegroundColor Yellow
$python312Components | ForEach-Object { 
    Write-Host "  - $($_.DisplayName)" -ForegroundColor White
}
Write-Host ""

# 确认卸载
$confirm = Read-Host "确定要卸载所有 Python 3.12 组件吗？(Y/N)"
if ($confirm -ne 'Y' -and $confirm -ne 'y') {
    Write-Host "已取消卸载。" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "开始卸载..." -ForegroundColor Green
Write-Host ""

$successCount = 0
$failCount = 0

foreach ($component in $python312Components) {
    $displayName = $component.DisplayName
    $productCode = $component.PSChildName
    
    Write-Host "正在卸载: $displayName" -ForegroundColor Cyan
    
    try {
        # 使用 MsiExec 卸载
        $uninstallArgs = "/X $productCode /quiet /norestart"
        $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $uninstallArgs -Wait -PassThru -NoNewWindow
        
        if ($process.ExitCode -eq 0) {
            Write-Host "  ✅ 卸载成功" -ForegroundColor Green
            $successCount++
        } else {
            Write-Host "  ⚠️  卸载完成，退出代码: $($process.ExitCode)" -ForegroundColor Yellow
            $successCount++
        }
    } catch {
        Write-Host "  ❌ 卸载失败: $_" -ForegroundColor Red
        $failCount++
    }
    
    Start-Sleep -Seconds 1
}

Write-Host ""
Write-Host "=== 卸载完成 ===" -ForegroundColor Cyan
Write-Host "成功: $successCount" -ForegroundColor Green
Write-Host "失败: $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })
Write-Host ""

# 检查是否还有残留
Write-Host "检查残留文件..." -ForegroundColor Yellow
if (Test-Path "C:\Program Files\Python312") {
    Write-Host "  ⚠️  发现残留目录: C:\Program Files\Python312" -ForegroundColor Yellow
    Write-Host "  如果确认不再需要，可以手动删除此目录。" -ForegroundColor White
} else {
    Write-Host "  ✅ 未发现残留目录" -ForegroundColor Green
}

Write-Host ""
Write-Host "验证卸载结果..." -ForegroundColor Yellow
$remaining = Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue | 
    Where-Object { $_.DisplayName -like "*Python*3.12*" }

if ($remaining) {
    Write-Host "  ⚠️  仍有以下组件未卸载：" -ForegroundColor Yellow
    $remaining | ForEach-Object { Write-Host "    - $($_.DisplayName)" -ForegroundColor White }
} else {
    Write-Host "  ✅ Python 3.12 已完全卸载！" -ForegroundColor Green
}

Write-Host ""
Write-Host "请运行 'py -0' 验证 Python 版本列表。" -ForegroundColor Cyan





