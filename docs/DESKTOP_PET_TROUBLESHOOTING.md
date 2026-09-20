# Tauri 透明桌面寵物踩雷紀錄

這份紀錄整理月光簿 v0.7.3 開發透明桌面寵物時遇到的問題，供後續維護與其他 Tauri 2 專案參考。

## 1. 全域最小寬度會把寵物推到視窗外

### 症狀

- 寵物視窗存在，也能接收滑鼠事件，但角色完全透明。
- DevTools 顯示寵物元素尺寸為 `1080 × 345`，實際 Tauri 視窗只有 `230 × 345`。
- 圖片使用 `object-fit: contain` 時，被置中到 1080px 容器中央，落在實際可見範圍之外。

### 原因

主程式使用的全域樣式也套到寵物頁面：

```css
body {
  min-width: 1080px;
}
```

### 解法

寵物頁面必須覆寫最小寬度：

```css
html.pet-root,
html.pet-root body,
html.pet-root #root {
  width: 100%;
  height: 100%;
  min-width: 0;
}
```

## 2. 前端視窗 API 需要明確權限

### 症狀

Console 依序出現：

```text
window.center not allowed
window.show not allowed
```

第一個 Promise 拋錯後，後面的 `show()` 不會執行。

### 解法

不要讓寵物頁面直接呼叫前端 `center()`、`show()` 或 `hide()`。改由已註冊的 Rust command 集中管理視窗：

```ts
invoke("set_pet_visible", { visible: true });
```

Rust 端取得 `pet` WebviewWindow 後呼叫 `show()` 或 `hide()`。這能縮小前端 capability，並讓主視窗設定與寵物啟動共用同一條控制路徑。

## 3. 不要在每次顯示時重新置中

桌面寵物的位置是使用者介面狀態。每次切換顯示都呼叫 `center()`，會破壞使用者拖曳後的位置。初始位置應由視窗設定決定，後續顯示只執行 `show()`。

## 4. 大型透明 PNG 不適合轉成行內 CSS

### 症狀

- 圖片預載成功，但 DOM 的行內 `style` 沒有背景圖片。
- 開發模式的 Network 看不到獨立 PNG 請求。

### 原因

將約 2 MB PNG 以 `?inline` 轉成 Base64 後，字串會接近 3 MB。把它塞進 CSS custom property 或行內背景可能被 WebView2 捨棄，也很難除錯。

### 解法

- 使用一般 Vite asset import，不加 `?inline`。
- 角色圖片優先使用真正的 `<img src={assetUrl}>`。
- 使用 `object-fit: contain` 保持原始比例。

## 5. Canvas 不是必要的圖片顯示備援

把 PNG 轉畫到 Canvas 會增加圖片載入、像素存取、透明合成與重繪時序。若需求只是顯示靜態透明角色，原生 `<img>` 更容易檢查，也更穩定。

## 6. 備援角色可能遮住正式角色

新增 CSS 備援時要注意 selector specificity 與 `z-index`。通用規則如 `.pet-character > span` 可能覆蓋備援層或正式圖層，造成只看到備援頭像。若正式資源已可驗證載入，應移除臨時備援，避免兩套渲染互相干擾。

## 7. 動畫應套在角色，不要晃動視窗

透明視窗維持固定尺寸與拖曳判定區；漂浮動畫只套在角色元素。按住角色拖曳時暫停動畫，放開後恢復，可避免拖曳座標與視覺位置互相影響。

## 建議除錯順序

1. 確認 Tauri `pet` 視窗已建立且 Rust `show()` 成功。
2. 在 Console 記錄圖片 URL、`onload`、naturalWidth 與 naturalHeight。
3. 在 Elements 查看角色實際 `getBoundingClientRect()`。
4. 確認寵物頁面的 body 沒有繼承主程式的最小寬高。
5. 使用 `<img>` 的 `src` 直接開啟圖片，排除透明素材與 asset path 問題。
6. 最後才檢查透明視窗合成、Wallpaper 或其他桌面美化工具。

最關鍵的判斷是：**視窗存在且可點擊，不代表角色位於視窗可見範圍內。**
