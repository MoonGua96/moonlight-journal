# 月光簿

月光簿是以 React、TypeScript、Tauri 2 與 SQLite 製作的 Windows 本地端生活記錄工具。

## 需要安裝的軟體

- [Node.js](https://nodejs.org/)（建議使用 LTS 版本）
- [Rust](https://www.rust-lang.org/tools/install)
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（安裝「使用 C++ 的桌面開發」）
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
- [Git for Windows](https://git-scm.com/download/win)（只有下載原始碼時需要）

## 開發與測試

在專案資料夾開啟 PowerShell：

```powershell
npm install
npm run tauri dev
```

執行測試與前端建置檢查：

```powershell
npm test
npm run build
```

## 建立 Windows 安裝檔

```powershell
npm install
npm run tauri build
```

也可以直接雙擊 `在Windows建立安裝檔.bat`。完成後，安裝檔位於：

```text
src-tauri\target\release\bundle\nsis\
```

## 操作方法

- 第一次開啟時可以設定顯示名稱；之後可在「設定」修改。
- 從左側選單切換今日、月曆、待辦事項、日記、筆記、相簿、密碼保管庫、收集箱、回收桶與設定。
- 待辦卡片可以拖曳到其他狀態欄。
- 月曆可新增記事與待辦，並連到指定日期的日記。
- 相簿可加入照片或影片；實際可播放格式取決於 Windows WebView2 支援能力。
- 密碼保管庫需另外建立帳號與主密碼；忘記主密碼時無法復原內容。
- 可在設定中更改資料位置、建立完整備份或還原備份。
- App 內的月光精靈可開啟自行設定的外部聊天網址。
- 桌面月光精靈可按住拖曳；快速連點兩下可開啟月光簿。
- 關閉主視窗後程式會留在系統匣；要完全結束，請在系統匣圖示上按右鍵並選擇「完全結束」。
