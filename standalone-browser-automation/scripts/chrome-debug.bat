@echo off
REM Debug Chrome — extension popup auto-click ke liye
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%CD%\.chrome-cdp-profile" --no-first-run
echo Chrome debug mode started on port 9222
echo Now run: npm run visitor-cdp-bridge -- --server ws://YOUR_SERVER:8791
