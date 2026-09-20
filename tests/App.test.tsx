import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../src/App";
import PetApp from "../src/PetApp";
import { initialState, todayKey, type AppState } from "../src/data/types";
import { lunarInfo } from "../src/data/calendar";
import { normalizeState } from "../src/data/repository";
import {
  changeVaultPassword,
  emptyVault,
  sealVault,
  unlockVault,
} from "../src/data/vault";

const STORAGE_KEY = "moonlight-journal.v0.2.state";

function testState(overrides: Partial<AppState> = {}): AppState {
  return {
    ...structuredClone(initialState),
    ...overrides,
    settings: {
      ...initialState.settings,
      setupCompleted: true,
      ...(overrides.settings || {}),
    },
  };
}

async function renderReady(overrides: Partial<AppState> = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(testState(overrides)));
  render(<App />);
  await screen.findByRole("heading", { name: "今天", level: 1 });
}

describe("月光簿 v0.6.0", () => {
  it("舊待辦期限與舊筆記會自動轉成新版結構", () => {
    const migrated = normalizeState({
      todos: [
        {
          id: "legacy-todo",
          title: "舊待辦",
          description: "",
          status: "todo",
          color: "purple",
          dueDate: "2026-09-20",
          position: 0,
        },
      ],
      notes: [
        {
          id: "legacy-note",
          title: "舊筆記",
          folder: "",
          sections: [{ id: "legacy-section", title: "章節", body: "內容" }],
          updatedAt: "2026-01-01",
        },
      ],
    });
    expect(migrated.todos[0]).toMatchObject({
      startDate: "2026-09-20",
      endDate: "2026-09-20",
    });
    expect(migrated.notes[0].tabs?.[0].sections[0].body).toBe("內容");
  });
  it("公開版初始資料完全空白", () => {
    expect(initialState.calendarItems).toEqual([]);
    expect(initialState.todos).toEqual([]);
    expect(initialState.diaries).toEqual([]);
    expect(initialState.notes).toEqual([]);
    expect(initialState.albums).toEqual([]);
    expect(initialState.photos).toEqual([]);
    expect(initialState.birthdays).toEqual([]);
    expect(initialState.holidays).toEqual([]);
    expect(initialState.inbox).toEqual([]);
    expect(initialState.vault).toBeUndefined();
    expect(initialState.settings).toMatchObject({
      userName: "",
      chatUrl: "",
      backupDirectory: "",
    });
  });

  it("首次啟動可設定顯示名稱", async () => {
    render(<App />);
    fireEvent.change(await screen.findByLabelText("首次設定名稱"), {
      target: { value: "測試使用者" },
    });
    fireEvent.click(screen.getByRole("button", { name: "開始使用" }));
    expect(
      await screen.findByRole("heading", { name: /測試使用者/ }),
    ).toBeInTheDocument();
  });

  it("可正確顯示農曆春節", () => {
    const value = lunarInfo(new Date("2026-02-17T12:00:00"));
    expect(value.month).toBe(1);
    expect(value.day).toBe(1);
    expect(value.festival).toBe("春節");
  });

  it("可以切換所有主要功能", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "月曆" }));
    expect(
      screen.getByRole("heading", { name: "月曆", level: 1 }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    expect(
      screen.getByRole("heading", { name: "待辦事項", level: 1 }),
    ).toBeInTheDocument();
  });

  it("月曆空白時不能儲存且隨時可以關閉", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "月曆" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: new Date().toLocaleDateString("sv-SE"),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增記事" }));
    expect(screen.getByRole("button", { name: "儲存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "關閉" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("可新增待辦並保存到畫面", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增待辦" }));
    fireEvent.change(screen.getByLabelText("標題"), {
      target: { value: "測試新的待辦" },
    });
    fireEvent.change(screen.getByLabelText("起始日"), {
      target: { value: "2026-09-18" },
    });
    fireEvent.change(screen.getByLabelText("截止日"), {
      target: { value: "2026-09-20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    expect(screen.getByText("測試新的待辦")).toBeInTheDocument();
    await waitFor(() =>
      expect(localStorage.getItem("moonlight-journal.v0.2.state")).toContain(
        "測試新的待辦",
      ),
    );
  });

  it("待辦卡片可以拖到另一個狀態欄", async () => {
    await renderReady({
      todos: [
        {
          id: "todo-drag",
          title: "測試拖曳待辦",
          description: "",
          status: "todo",
          color: "purple",
          dueDate: "",
          position: 0,
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    const source = screen.getByText("測試拖曳待辦").closest("article")!;
    const target = screen
      .getByRole("heading", { name: "進行中" })
      .closest("section")!;
    Object.defineProperties(source, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: vi.fn() },
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });
    fireEvent.pointerDown(source, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(source, {
      pointerId: 1,
      clientX: 100,
      clientY: 80,
    });
    fireEvent.pointerUp(source, {
      pointerId: 1,
      clientX: 100,
      clientY: 80,
    });
    expect(within(target).getByText("測試拖曳待辦")).toBeInTheDocument();
  });

  it("空白快速記錄不能儲存", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "＋ 快速記錄" }));
    expect(screen.getByRole("button", { name: "儲存" })).toBeDisabled();
  });

  it("月曆待辦會同步出現在待辦看板", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "月曆" }));
    fireEvent.click(screen.getByRole("button", { name: todayKey }));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增待辦" }));
    fireEvent.change(screen.getByLabelText("內容"), {
      target: { value: "月曆同步測試" },
    });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    expect(screen.getByText("月曆同步測試")).toBeInTheDocument();
  });

  it("月曆可以直接跳到選取日期的日記", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "月曆" }));
    fireEvent.click(screen.getByRole("button", { name: todayKey }));
    fireEvent.click(screen.getByRole("button", { name: /前往這天的日記/ }));
    expect(
      screen.getByRole("heading", { name: "日記", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue(todayKey)).toBeInTheDocument();
  });

  it("可新增每年重複的農曆生日", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "月曆" }));
    fireEvent.click(screen.getByRole("button", { name: /管理生日與假日/ }));
    fireEvent.change(screen.getByLabelText("生日姓名"), {
      target: { value: "測試壽星" },
    });
    fireEvent.change(screen.getByLabelText("生日曆法"), {
      target: { value: "lunar" },
    });
    fireEvent.change(screen.getByLabelText("生日月"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("生日日"), {
      target: { value: "15" },
    });
    fireEvent.click(screen.getByRole("button", { name: /加入生日/ }));
    expect(screen.getByText("測試壽星")).toBeInTheDocument();
    expect(screen.getByText(/農曆 8\/15/)).toBeInTheDocument();
  });

  it("收集箱內容可轉成待辦", async () => {
    await renderReady({
      inbox: [
        {
          id: "inbox-test",
          text: "待整理的測試想法",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "收集箱" }));
    const row = screen.getByText("待整理的測試想法").closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "轉待辦" }));
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    expect(screen.getByText("待整理的測試想法")).toBeInTheDocument();
  });

  it("刪除的待辦可以從回收桶復原", async () => {
    await renderReady({
      todos: [
        {
          id: "todo-restore",
          title: "測試復原待辦",
          description: "",
          status: "todo",
          color: "gold",
          dueDate: "",
          position: 0,
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    const card = screen.getByText("測試復原待辦").closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "刪除" }));
    fireEvent.click(screen.getByRole("button", { name: "回收桶" }));
    const row = screen.getByText("測試復原待辦").closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "復原" }));
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    expect(screen.getByText("測試復原待辦")).toBeInTheDocument();
  });

  it("筆記提供章節、圖片與簡易畫筆", async () => {
    await renderReady({
      notes: [
        {
          id: "note-tools",
          title: "測試筆記工具",
          folder: "測試",
          sections: [{ id: "section-tools", title: "第一節", body: "" }],
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "筆記" }));
    expect(
      screen.getByRole("button", { name: "新增章節" }),
    ).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText(/在任一區塊按右鍵/).closest("section")!, {
      clientX: 480,
      clientY: 420,
    });
    expect(screen.getByText("▧ 加入圖片")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "✎ 簡易畫筆" }));
    expect(
      screen.getByRole("dialog", { name: "簡易畫筆" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "關閉" }));
  });

  it("可以搜尋所有記錄", async () => {
    await renderReady({
      notes: [
        {
          id: "note-search",
          title: "搜尋測試筆記",
          folder: "測試",
          sections: [
            { id: "section-search", title: "內容", body: "特殊搜尋詞" },
          ],
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "搜尋" }));
    fireEvent.change(screen.getByPlaceholderText("輸入關鍵字……"), {
      target: { value: "特殊搜尋詞" },
    });
    expect(screen.getByText("搜尋測試筆記")).toBeInTheDocument();
  });

  it("搜尋可依內容類型篩選", async () => {
    await renderReady({
      notes: [
        {
          id: "note-filter",
          title: "篩選測試筆記",
          folder: "測試",
          sections: [
            { id: "section-filter", title: "內容", body: "篩選專用詞" },
          ],
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "搜尋" }));
    fireEvent.change(screen.getByPlaceholderText("輸入關鍵字……"), {
      target: { value: "篩選專用詞" },
    });
    fireEvent.change(screen.getByLabelText("內容類型"), {
      target: { value: "月曆" },
    });
    expect(screen.queryByText("篩選測試筆記")).not.toBeInTheDocument();
    expect(screen.getByText("沒有找到符合的記錄")).toBeInTheDocument();
  });

  it("Ctrl+N 可開啟快速記錄", async () => {
    await renderReady();
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(
      screen.getByRole("dialog", { name: "先記下來" }),
    ).toBeInTheDocument();
  });

  it("桌面月光精靈本身可拖曳並可開啟月光簿", async () => {
    render(<PetApp />);
    expect(screen.getByRole("button", { name: "打開月光簿" })).toHaveAttribute(
      "title",
      "按住月光精靈移動；連點兩下打開月光簿",
    );
    expect(
      screen.getByRole("button", { name: "打開月光簿" }),
    ).toBeInTheDocument();
  });

  it("可建立加密密碼保管庫", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "密碼保管庫" }));
    fireEvent.change(screen.getByLabelText("保管庫帳號"), {
      target: { value: "moon" },
    });
    const passwordInputs = screen.getAllByLabelText(/主密碼|再輸入一次/);
    fireEvent.change(passwordInputs[0], {
      target: { value: "correct-horse-2026" },
    });
    fireEvent.change(passwordInputs[1], {
      target: { value: "correct-horse-2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "建立並解鎖" }));
    expect(await screen.findByText(/0 筆已加密的帳密/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "變更主密碼" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      const saved = localStorage.getItem("moonlight-journal.v0.2.state") || "";
      expect(saved).toContain("ciphertext");
      expect(saved).not.toContain("correct-horse-2026");
    });
  });

  it("保管庫輸錯密碼不會破壞加密資料", async () => {
    const envelope = await sealVault(
      "moon",
      "correct-horse-2026",
      emptyVault(),
    );
    const originalCiphertext = envelope.ciphertext;
    await expect(
      unlockVault(envelope, "moon", "wrong-password"),
    ).rejects.toThrow("帳號或主密碼錯誤");
    expect(envelope.ciphertext).toBe(originalCiphertext);
    await expect(
      unlockVault(envelope, "moon", "correct-horse-2026"),
    ).resolves.toMatchObject({ entries: [], categories: expect.any(Array) });
  });

  it("可變更主密碼並讓舊密碼失效", async () => {
    const original = await sealVault("moon", "old-password-2026", {
      entries: [
        {
          id: "secret-1",
          service: "測試網站",
          url: "",
          account: "moon",
          password: "protected-value",
          note: "",
          tags: [],
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const changed = await changeVaultPassword(
      original,
      "old-password-2026",
      "new-password-2026",
    );
    expect(changed.salt).not.toBe(original.salt);
    await expect(
      unlockVault(changed, "moon", "old-password-2026"),
    ).rejects.toThrow("帳號或主密碼錯誤");
    await expect(
      unlockVault(changed, "moon", "new-password-2026"),
    ).resolves.toMatchObject({
      entries: [{ service: "測試網站", password: "protected-value" }],
    });
  });

  it("相簿初始為空白並可新增相簿", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "相簿" }));
    expect(
      screen.getByRole("button", { name: "＋ 建立第一本相簿" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新增相簿" }));
    fireEvent.change(screen.getByPlaceholderText("例如：旅行回憶"), {
      target: { value: "生活小記" },
    });
    fireEvent.click(screen.getByRole("button", { name: "建立" }));
    expect(screen.getByDisplayValue("生活小記")).toBeInTheDocument();
  });

  it("相簿接受照片、影片與 HEIC", async () => {
    await renderReady({
      albums: [
        {
          id: "album-media",
          title: "媒體測試",
          description: "",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "相簿" }));
    const picker = screen.getByText("＋ 加入照片或影片").querySelector("input");
    expect(picker).toHaveAttribute(
      "accept",
      expect.stringContaining("video/*"),
    );
    expect(picker).toHaveAttribute("accept", expect.stringContaining(".heic"));
  });

  it("相簿可以移到回收桶並復原", async () => {
    await renderReady({
      albums: [
        {
          id: "album-restore",
          title: "測試相簿",
          description: "",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "相簿" }));
    fireEvent.click(screen.getByRole("button", { name: "刪除相簿 測試相簿" }));
    fireEvent.click(screen.getByRole("button", { name: "回收桶" }));
    const row = screen.getByText("測試相簿").closest("article")!;
    expect(within(row).getByText("相簿")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "復原" }));
    fireEvent.click(screen.getByRole("button", { name: "相簿" }));
    expect(screen.getByDisplayValue("測試相簿")).toBeInTheDocument();
  });

  it("設定頁會顯示資料儲存位置", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(screen.getByDisplayValue("瀏覽器預覽資料")).toBeDisabled();
  });
});
