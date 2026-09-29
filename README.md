# 月光簿

月光簿是以 React、TypeScript、Tauri 2 與 SQLite 製作的 Windows 本地端生活記錄工具。資料預設留在自己的裝置上；初次使用時可設定顯示名稱，所有功能都從空白資料開始。

## 主要功能

- **今天**：快速記錄、查看當日安排與待辦、預覽今日碎念；可從行事曆日期前往對應日記。
- **行事曆**：月／週／日檢視、全天與固定時段安排、記事、生日與假日；可直接勾選當日待辦。
- **待辦事項**：一般待辦、週期代辦、重點代辦；支援看板狀態、日期與時間、每日／每週／每月規則、每日完成狀態及重點進度文字紀錄。
- **日記**：每日書寫與碎念、文字格式工具；日記頁可使用密碼保管庫的帳號與主密碼上鎖。
- **筆記**：筆記本、資料夾、彩色標籤與章節；可插入文字、標題、清單、引言、圖片、表格和手繪內容。
- **收集箱**：先收文字、照片或影片，再整理成待辦或今日碎念。
- **相簿**：建立相簿、整理照片與影片、加入說明和標籤、標記喜愛項目；日記與相簿共用密碼保護。可播放格式依 Windows WebView2 支援而定。
- **記帳**：記錄收入與支出，管理分類；欄位包含消費日期、項目、金額、分類、店家／品牌、支付方式與備註，並查看月／年分類支出圖表。
- **密碼保管庫**：以帳號和主密碼保護密碼資料；忘記主密碼時無法復原已加密內容。
- **回收桶**：復原或刪除移除的資料。
- **月光精靈**：App 內精靈可開啟自訂聊天網址；桌面精靈可拖曳移動、連點兩下開啟月光簿，主視窗關閉後程式會留在系統匣。
- **搜尋與設定**：跨功能搜尋、深色模式、字體大小、資料位置與備份；可調整 App 內精靈及桌面精靈顯示。

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

也可以雙擊 `在Windows建立安裝檔.bat`。安裝檔會輸出到：

```text
src-tauri\target\release\bundle\nsis\
```

## 基本操作

- 第一次開啟時可設定顯示名稱，之後可在「設定」修改。
- 左側功能列可切換各項功能；滑鼠移到畫面最左側可叫出功能列。
- 待辦建立與管理集中在「待辦事項」；行事曆用來查看日期安排與編輯當日紀錄。
- 日記與相簿需先建立密碼保管庫，再用相同帳號與主密碼解鎖。
- 在「設定」可以匯出或匯入備份，也可以變更資料位置。
- 關閉主視窗後程式會留在系統匣；要完全結束，請在系統匣圖示上按右鍵並選擇「完全結束」。
