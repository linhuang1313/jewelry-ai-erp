# PowerShell script to start backend server with Python 3.10
Write-Host "Starting backend server with Python 3.10..." -ForegroundColor Green
Write-Host "Python version:" -ForegroundColor Yellow
py -3.10 --version
Write-Host "`nStarting uvicorn server..." -ForegroundColor Yellow
py -3.10 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000







