@echo off
powershell -NoProfile -Command "$resp = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3005 -ErrorAction SilentlyContinue; if (-not $resp -or $resp.StatusCode -lt 200 -or $resp.StatusCode -ge 400) { exit 1 }"
exit /b %ERRORLEVEL%
