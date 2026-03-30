@echo off
powershell -NoProfile -Command "$pids = Get-NetTCPConnection -LocalPort 3005 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($proc in $pids) { Stop-Process -Id $proc -Force }"
exit /b 0
