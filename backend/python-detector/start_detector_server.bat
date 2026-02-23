@echo off
echo Starting Detector Server (PaddleOCR)...
echo.
echo This server keeps PaddleOCR loaded in memory for fast OCR.
echo Leave this window open while using the PDF Viewer app.
echo.

cd /d "%~dp0"
call C:\Users\KirstyDellow-Pawski\Downloads\venv\Scripts\activate.bat

python detector_server.py

pause
