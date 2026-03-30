@echo off
setlocal
call pnpm run dev
exit /b %ERRORLEVEL%
