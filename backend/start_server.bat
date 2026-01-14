@echo off
echo Starting backend server with Python 3.10...
py -3.10 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
pause






