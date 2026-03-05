@echo off
echo Starting backend server with Python 3.10...
.venv\scripts\python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 9000
pause







