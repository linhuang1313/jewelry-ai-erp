# jewelry-ai-erp 一键启动脚本
# 用法: 在项目根目录运行 .\start.ps1

$BACKEND_PORT = 9000
$FRONTEND_DIR = "frontend"
$BACKEND_DIR = "backend"

Write-Host "========== Jewelry AI ERP Startup ==========" -ForegroundColor Cyan

# 1. 清理占用后端端口的进程
Write-Host "[1/4] Cleaning port $BACKEND_PORT..." -ForegroundColor Yellow
$connections = Get-NetTCPConnection -LocalPort $BACKEND_PORT -ErrorAction SilentlyContinue
if ($connections) {
    $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
        if ($pid -ne 0) {
            Write-Host "  Killing PID $pid on port $BACKEND_PORT"
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 2
}
Write-Host "  Port $BACKEND_PORT is ready." -ForegroundColor Green

# 2. 清理占用前端端口的进程 (5173)
Write-Host "[2/4] Cleaning port 5173..." -ForegroundColor Yellow
$connections = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
if ($connections) {
    $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
        if ($pid -ne 0) {
            Write-Host "  Killing PID $pid on port 5173"
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 1
}
Write-Host "  Port 5173 is ready." -ForegroundColor Green

# 3. 启动后端
Write-Host "[3/4] Starting backend on port $BACKEND_PORT..." -ForegroundColor Yellow
$backendJob = Start-Process -FilePath "python" `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--port", "$BACKEND_PORT", "--workers", "4" `
    -WorkingDirectory $BACKEND_DIR `
    -PassThru -NoNewWindow
Write-Host "  Backend PID: $($backendJob.Id)" -ForegroundColor Green

Start-Sleep -Seconds 3

# 4. 启动前端
Write-Host "[4/4] Starting frontend..." -ForegroundColor Yellow
$frontendJob = Start-Process -FilePath "npm" `
    -ArgumentList "run", "dev" `
    -WorkingDirectory $FRONTEND_DIR `
    -PassThru -NoNewWindow
Write-Host "  Frontend PID: $($frontendJob.Id)" -ForegroundColor Green

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "========== All services started ==========" -ForegroundColor Cyan
Write-Host "  Backend:  http://localhost:$BACKEND_PORT" -ForegroundColor White
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C to stop all services." -ForegroundColor Gray

# 等待用户 Ctrl+C，然后清理
try {
    while ($true) { Start-Sleep -Seconds 5 }
} finally {
    Write-Host "`nShutting down..." -ForegroundColor Yellow
    if (!$backendJob.HasExited) { Stop-Process -Id $backendJob.Id -Force -ErrorAction SilentlyContinue }
    if (!$frontendJob.HasExited) { Stop-Process -Id $frontendJob.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "All services stopped." -ForegroundColor Green
}
