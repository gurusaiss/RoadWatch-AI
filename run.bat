@echo off
echo ============================================
echo  RoadWatch - AI Road Safety Platform
echo  National Road Safety Hackathon 2026
echo  IIT Madras CoERS - Track: RoadWatch
echo ============================================
echo.

cd /d "%~dp0backend"

echo [1/2] Installing dependencies...
pip install -r requirements.txt --quiet

echo [2/2] Starting RoadWatch server...
echo.
echo   Open your browser at: http://localhost:8000
echo   Press Ctrl+C to stop.
echo.
python main.py
