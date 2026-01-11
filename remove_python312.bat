@echo off
REM 此脚本需要管理员权限运行
REM 用于从系统 PATH 中移除 Python 3.12

echo ========================================
echo 移除 Python 3.12 环境变量配置
echo ========================================
echo.
echo 此脚本将从系统 PATH 中移除 Python 3.12
echo.
echo 需要管理员权限！
echo.
pause

REM 检查管理员权限
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo [错误] 此脚本需要管理员权限！
    echo 请右键点击此文件，选择"以管理员身份运行"
    echo.
    pause
    exit /b 1
)

echo.
echo [信息] 正在修改系统 PATH...
echo.

REM 使用 PowerShell 修改系统 PATH
powershell -ExecutionPolicy Bypass -Command ^
"$systemPath = [Environment]::GetEnvironmentVariable('Path', 'Machine'); " ^
"$paths = $systemPath -split ';' | Where-Object { $_ -and $_ -notmatch 'Python312' }; " ^
"$newSystemPath = $paths -join ';'; " ^
"[Environment]::SetEnvironmentVariable('Path', $newSystemPath, 'Machine'); " ^
"Write-Host '系统 PATH 已更新！' -ForegroundColor Green"

if %errorLevel% equ 0 (
    echo.
    echo [成功] Python 3.12 已从系统 PATH 中移除！
    echo.
    echo 请关闭所有终端窗口并重新打开，然后运行：
    echo   py -0
    echo.
) else (
    echo.
    echo [错误] 修改失败，请检查权限
    echo.
)

pause






