@echo off
chcp 65001 >nul
title 月光簿 Windows 安裝檔建立工具
where node >nul 2>nul || (echo [缺少 Node.js] 請先依照 README 安裝 & pause & exit /b 1)
where cargo >nul 2>nul || (echo [缺少 Rust] 請先依照 README 安裝 & pause & exit /b 1)
if not exist node_modules call npm install || (pause & exit /b 1)
call npm run tauri build
if errorlevel 1 (echo 建立失敗，請檢查上方錯誤訊息。) else (echo 完成！安裝檔位於 src-tauri\target\release\bundle)
pause
