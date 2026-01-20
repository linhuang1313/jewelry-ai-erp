# 简单的环境变量编辑脚本 - 仅修改用户 PATH（不需要管理员权限）
# 使用方法：直接运行此脚本

Write-Host "正在配置 Python 3.10 环境变量..." -ForegroundColor Green
Write-Host ""

# Python 3.10 路径
$python310Paths = @(
    'C:\Users\hlin2\AppData\Local\Programs\Python\Python310',
    'C:\Users\hlin2\AppData\Local\Programs\Python\Python310\Scripts'
)

# 获取当前用户 PATH
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$paths = $userPath -split ';' | Where-Object { $_ }

Write-Host "当前用户 PATH 中的 Python 路径：" -ForegroundColor Yellow
$paths | Where-Object { $_ -match 'Python' } | ForEach-Object { Write-Host "  $_" }

# 移除重复的 Python 3.10 路径
$otherPaths = $paths | Where-Object { $_ -notin $python310Paths }

# 重新排列：Python 3.10 在最前面
$newUserPath = ($python310Paths + $otherPaths) -join ';'

# 保存
[Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')

Write-Host ""
Write-Host "✅ 用户 PATH 已更新！" -ForegroundColor Green
Write-Host ""
Write-Host "新的用户 PATH 中的 Python 路径：" -ForegroundColor Yellow
$newUserPath -split ';' | Where-Object { $_ -match 'Python' } | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "⚠️  注意：" -ForegroundColor Yellow
Write-Host "1. 请关闭并重新打开所有终端窗口，使更改生效" -ForegroundColor White
Write-Host "2. 如果系统 PATH 中有 Python 3.14，它仍然可能优先" -ForegroundColor White
Write-Host "3. 要完全移除系统 PATH 中的 Python 3.14，需要以管理员身份运行 set_python310_default.ps1" -ForegroundColor White
Write-Host ""
Write-Host "验证命令：" -ForegroundColor Cyan
Write-Host "  python --version" -ForegroundColor White
Write-Host "  where.exe python" -ForegroundColor White








