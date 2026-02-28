@echo off
chcp 65001 >nul
title Jewelry ERP - Production Server

echo ============================================
echo   Jewelry ERP System - Production Start
echo ============================================
echo.

set PROJECT_DIR=C:\Users\Administrator\Desktop\jewelry-ai-erp

:: 1. Build Frontend (if dist doesn't exist)
if not exist "%PROJECT_DIR%\frontend\dist" (
    echo [1/2] Building frontend...
    cd /d %PROJECT_DIR%\frontend
    call npm install
    call npm run build
    echo Frontend build complete.
) else (
    echo [1/2] Frontend dist exists, skipping build.
)

:: 2. Start Backend
echo [2/2] Starting Backend on port 9000...
cd /d %PROJECT_DIR%\backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 9000 --workers 2

pause
