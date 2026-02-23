@echo off
echo ========================================
echo Starting PDF Viewer Development Servers
echo ========================================
echo.

REM Start detector server (Python/PaddleOCR) in new window
echo Starting Detector Server (PaddleOCR)...
start "Detector Server" cmd /k "cd /d "%~dp0backend\python-detector" && call "%~dp0backend\venv\Scripts\activate.bat" && python detector_server.py"

REM Wait a moment for detector to start
timeout /t 2 /nobreak > nul

REM Start backend in new window
echo Starting Backend Server...
start "Backend Server" cmd /k "cd backend && npm start"

REM Wait a moment for backend to start
timeout /t 3 /nobreak > nul

REM Start frontend in new window (using 'dev' script)
echo Starting Frontend Server...
start "Frontend Server" cmd /k "cd frontend && npm run dev"

echo.
echo ========================================
echo All servers are starting!
echo Detector: http://localhost:5001
echo Backend:  http://localhost:5000
echo Frontend: http://localhost:5173 (or 3000)
echo ========================================
echo.
echo Close this window when you're done working.
echo To stop servers, close the Detector, Backend and Frontend windows.
echo.
pause
