@echo off
echo ========================================
echo   Jewelry AI-ERP Frontend Starting...
echo ========================================
echo.

cd /d "%~dp0frontend"
if not exist "node_modules" (
    echo [INFO] node_modules not found, running npm install...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed. Please check Node.js is installed.
        echo Download: https://nodejs.org/
        echo.
        pause
        exit /b 1
    )
)

echo [START] npm run dev
echo.
call npm run dev

if errorlevel 1 (
    echo.
    echo ========================================
    echo   [ERROR] Frontend failed to start!
    echo   Check error messages above.
    echo ========================================
    echo.
)

pause
