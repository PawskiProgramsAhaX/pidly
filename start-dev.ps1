# PDF Viewer Dev Server Launcher
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Starting PDF Viewer Development Servers" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Start detector server (Python/PaddleOCR)
Write-Host "Starting Detector Server (PaddleOCR)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$scriptDir\backend\python-detector'; & '$scriptDir\backend\venv\Scripts\Activate.ps1'; python detector_server.py" -WindowStyle Normal

# Wait for detector to initialize
Start-Sleep -Seconds 2

# Start backend
Write-Host "Starting Backend Server..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$scriptDir\backend'; npm start" -WindowStyle Normal

# Wait for backend to initialize
Start-Sleep -Seconds 3

# Start frontend (using 'dev' script for Vite)
Write-Host "Starting Frontend Server..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$scriptDir\frontend'; npm run dev" -WindowStyle Normal

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "All servers are starting!" -ForegroundColor Green
Write-Host "Detector: http://localhost:5001" -ForegroundColor White
Write-Host "Backend:  http://localhost:5000" -ForegroundColor White
Write-Host "Frontend: http://localhost:5173 (or 3000)" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "To stop: Close the server windows" -ForegroundColor Gray
Write-Host ""

Read-Host "Press Enter to exit this launcher"
