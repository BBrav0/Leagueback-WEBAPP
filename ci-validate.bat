@echo off
setlocal

pnpm run lint
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

pnpm run static-check
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

pnpm run typecheck
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

pnpm test
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

pnpm run build
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

exit /b 0
