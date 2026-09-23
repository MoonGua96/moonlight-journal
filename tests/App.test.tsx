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
import { parseGovernmentCalendarCsv } from "../src/components/CalendarDataModal";
import { sanitizeRichText } from "../src/components/RichTextEditor";
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
    calendarItems: [
      {
        id: "event-1",
        type: "note",
        date: todayKey,
        title: "整理求職資料",
        time: "10:00",
        color: "violet",
      },
    ],
    todos: [
      {
        id: "todo-1",
        title: "確認第一版資訊架構",
        description: "檢查左側導航與頁面關係。",
        status: "todo",
        color: "violet",
        dueDate: todayKey,
        position: 0,
      },
      {
        id: "todo-2",
        title: "製作測試版本",
        description: "",
        status: "doing",
        color: "sky",
        dueDate: "",
        position: 0,
      },
    ],
    inbox: [
      {
        id: "inbox-1",
        text: "整理一份今年的學習地圖",
        createdAt: new Date().toISOString(),
      },
    ],
    notes: [
      {
        id: "note-1",
        title: "React 學習歷程",
        folder: "學習筆記",
        updatedAt: new Date().toISOString(),
        sections: [{ id: "section-1", title: "測試章節", body: "測試內容" }],
      },
    ],
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

describe("月光簿 v0.8.0", () => {
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

  it("公開版新使用者初始資料為空白", () => {
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
    expect(initialState.settings).toMatchObject({ userName: "", chatUrl: "", backupDirectory: "" });
  });

  it("首次啟動可設定顯示名稱", async () => {
    render(<App />);
    fireEvent.change(await screen.findByLabelText("首次設定名稱"), { target: { value: "測試使用者" } });
    fireEvent.click(screen.getByRole("button", { name: "開始使用" }));
    expect(await screen.findByRole("heading", { name: /測試使用者/ })).toBeInTheDocument();
  });

  it("設定中可編輯顯示名稱", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.change(screen.getByLabelText("顯示名稱"), { target: { value: "新名稱" } });
    expect(screen.getByLabelText("顯示名稱")).toHaveValue("新名稱");
  });

  it("可正確顯示農曆春節", () => {
    const value = lunarInfo(new Date("2026-02-17T12:00:00"));
    expect(value.month).toBe(1);
    expect(value.day).toBe(1);
    expect(value.festival).toBe("春節");
  });

  it("可以切換所有主要功能", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "行事曆" }));
    expect(
      screen.getByRole("heading", { name: "行事曆", level: 1 }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    expect(
      screen.getByRole("heading", { name: "待辦事項", level: 1 }),
    ).toBeInTheDocument();
  });

  it("月曆空白時不能儲存且隨時可以關閉", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "行事曆" }));
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

  it("月檢視快速列出事項，不顯示行程時間", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "行事曆" }));
    const entry = screen.getByText("整理求職資料").closest(".calendar-month-entry")!;
    expect(entry).not.toHaveTextContent("10:00");
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

  it("多日待辦可逐日勾選，且看板系列卡維持進行中", async () => {
    await renderReady();
    const end = new Date(`${todayKey}T12:00:00`);
    end.setDate(end.getDate() + 2);
    const endKey = end.toLocaleDateString("sv-SE");
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增待辦" }));
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "逐日完成的工作" } });
    fireEvent.change(screen.getByLabelText("起始日"), { target: { value: todayKey } });
    fireEvent.change(screen.getByLabelText("截止日"), { target: { value: endKey } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    const card = screen.getByText("逐日完成的工作").closest("article")!;
    expect(card).toHaveClass("multi-day");
    expect(within(card).getByText("進行中")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "行事曆" }));
    const first = screen.getByLabelText(`完成 逐日完成的工作（${todayKey}）`);
    const secondDate = new Date(`${todayKey}T12:00:00`);
    secondDate.setDate(secondDate.getDate() + 1);
    const second = screen.getByLabelText(`完成 逐日完成的工作（${secondDate.toLocaleDateString("sv-SE")}）`);
    fireEvent.click(first);
    expect(first).toBeChecked();
    expect(second).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    expect(screen.getByText("1/3 天完成")).toBeInTheDocument();
    expect(within(screen.getByText("逐日完成的工作").closest("article")!).getByText("進行中")).toBeInTheDocument();
  });

  it("待辦編輯器可建立每週多日重複系列", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增待辦" }));
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "每週整理工作桌" } });
    fireEvent.change(screen.getByLabelText("重複頻率"), { target: { value: "weekly" } });
    const weekdays = within(screen.getByRole("group", { name: "重複星期" })).getAllByRole("button");
    weekdays.forEach((button, day) => {
      const shouldBeSelected = day === 1 || day === 2;
      const selected = button.getAttribute("aria-pressed") === "true";
      if (selected !== shouldBeSelected) fireEvent.click(button);
    });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(localStorage.getItem("moonlight-journal.v0.2.state")).toContain("每週整理工作桌"));
    const saved = JSON.parse(localStorage.getItem("moonlight-journal.v0.2.state")!);
    const todo = saved.todos.find((item: { title: string }) => item.title === "每週整理工作桌");
    expect(todo.recurrence.rules[0]).toMatchObject({ frequency: "weekly", weekdays: [1, 2] });
    expect(todo.status).toBe("todo");
  });

  it("長期進度任務可在同一天新增多筆文字紀錄", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增待辦" }));
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "整理研究計畫" } });
    fireEvent.change(screen.getByLabelText("任務類型"), { target: { value: "progress" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    fireEvent.click(screen.getByText("整理研究計畫"));
    fireEvent.change(screen.getByLabelText("新增進度紀錄"), { target: { value: "完成研究問題草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "新增紀錄" }));
    fireEvent.change(screen.getByLabelText("新增進度紀錄"), { target: { value: "補上參考資料" } });
    fireEvent.click(screen.getByRole("button", { name: "新增紀錄" }));

    expect(screen.getByText("完成研究問題草稿")).toBeInTheDocument();
    expect(screen.getAllByText("補上參考資料")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.getByText("補上參考資料")).toBeInTheDocument();
  });

  it("待辦卡片可以拖到另一個狀態欄", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    const source = screen.getByText("確認第一版資訊架構").closest("article")!;
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
    expect(within(target).getByText("確認第一版資訊架構")).toBeInTheDocument();
  });

  it("空白快速記錄不能儲存", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "＋ 快速記錄" }));
    expect(screen.getByRole("button", { name: "儲存" })).toBeDisabled();
  });

  it("週檢視可新增記事，行事曆不提供新增待辦按鈕", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "行事曆" }));
    expect(screen.queryByRole("button", { name: "＋ 新增待辦" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "週" }));
    const weekView = screen.getByRole("button", { name: `新增 ${todayKey} 記事` }).closest(".calendar-week-view")!;
    expect(weekView.querySelectorAll(".calendar-week-time-axis .calendar-timeline-hour")).toHaveLength(24);
    expect(weekView.querySelectorAll(".calendar-week-timelines > section")).toHaveLength(7);
    expect(weekView.querySelectorAll(".calendar-week-all-day-cells > .calendar-all-day")).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: `新增 ${todayKey} 記事` }));
    fireEvent.change(screen.getByLabelText("內容"), {
      target: { value: "週檢視記事測試" },
    });
    fireEvent.change(screen.getByLabelText("開始時間"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("結束時間"), { target: { value: "10:30" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    expect(screen.getByText("週檢視記事測試")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "＋ 新增待辦" })).not.toBeInTheDocument();
  });

  it("月曆可以直接跳到選取日期的日記", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "行事曆" }));
    fireEvent.click(screen.getByRole("button", { name: todayKey }));
    fireEvent.click(screen.getByRole("button", { name: /前往這天的日記/ }));
    expect(
      screen.getByRole("heading", { name: "日記", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue(todayKey)).toBeInTheDocument();
  });

  it("可新增每年重複的農曆生日", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "行事曆" }));
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
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "收集箱" }));
    const row = screen.getByText("整理一份今年的學習地圖").closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "轉待辦" }));
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    expect(screen.getByText("整理一份今年的學習地圖")).toBeInTheDocument();
  });

  it("刪除的待辦可以從回收桶復原", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    const card = screen.getByText("確認第一版資訊架構").closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "刪除" }));
    fireEvent.click(screen.getByRole("button", { name: "回收桶" }));
    const row = screen.getByText("確認第一版資訊架構").closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "復原" }));
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    expect(screen.getByText("確認第一版資訊架構")).toBeInTheDocument();
  });

  it("筆記提供章節、圖片與簡易畫筆", async () => {
    await renderReady();
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
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "搜尋" }));
    fireEvent.change(screen.getByPlaceholderText("輸入關鍵字……"), {
      target: { value: "React" },
    });
    expect(screen.getByText("React 學習歷程")).toBeInTheDocument();
  });

  it("搜尋可依內容類型篩選", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "搜尋" }));
    fireEvent.change(screen.getByPlaceholderText("輸入關鍵字……"), {
      target: { value: "React" },
    });
    fireEvent.change(screen.getByLabelText("內容類型"), {
      target: { value: "月曆" },
    });
    expect(screen.queryByText("React 學習歷程")).not.toBeInTheDocument();
    expect(screen.getByText("沒有找到符合的記錄")).toBeInTheDocument();
  });

  it("Ctrl+N 可開啟快速記錄", async () => {
    await renderReady();
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(
      screen.getByRole("dialog", { name: "先記下來" }),
    ).toBeInTheDocument();
  });

  it("桌面月光精靈保留拖曳與雙擊開啟行為", async () => {
    const { container } = render(<PetApp />);
    expect(screen.getByRole("button", { name: "打開月光簿" })).toHaveAttribute(
      "title",
      "按住月光精靈移動；連點兩下打開月光簿",
    );
    expect(container.querySelector(".spirit-orb")).toBeInTheDocument();
  });

  it("文字格式工具會保留文字顏色、螢光筆與字型樣式", () => {
    const html = sanitizeRichText(
      '<span style="font-weight: bold; font-style: italic; text-decoration: underline line-through; color: rgb(10, 20, 30); background-color: rgb(240, 220, 100)">格式測試</span>',
    );
    expect(html).toContain("font-weight: bold");
    expect(html).toContain("font-style: italic");
    expect(html).toContain("text-decoration: underline line-through");
    expect(html).toContain("color: rgb(10, 20, 30)");
    expect(html).toContain("background-color: rgb(240, 220, 100)");
  });

  it("可讀取政府行事曆 CSV 的 YYYYMMDD 日期與放假代碼", () => {
    const values = parseGovernmentCalendarCsv(
      "\uFEFF西元日期,星期,是否放假,備註\n" +
        "20270101,五,2,開國紀念日\n" +
        "20270102,六,2,\n" +
        "20270104,一,0,\n" +
        "20270109,六,0,補班日\n",
    );
    expect(values).toEqual([
      expect.objectContaining({
        date: "2027-01-01",
        name: "開國紀念日",
        type: "national",
      }),
      expect.objectContaining({
        date: "2027-01-09",
        name: "補班日",
        type: "makeup",
      }),
    ]);
  });

  it("App內月光精靈不會被介面字體縮放容器影響", async () => {
    await renderReady();
    expect(screen.getByRole("button", { name: "找月光精靈聊聊" }).closest(".app")).toBeNull();
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

  it("相簿初始為空並可新增相簿", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "相簿" }));
    fireEvent.click(screen.getByRole("button", { name: "新增相簿" }));
    fireEvent.change(screen.getByPlaceholderText("例如：旅行回憶"), {
      target: { value: "生活小記" },
    });
    fireEvent.click(screen.getByRole("button", { name: "建立" }));
    expect(screen.getByDisplayValue("生活小記")).toBeInTheDocument();
  });

  it("相簿接受照片、影片與 HEIC", async () => {
    await renderReady({
      albums: [{
        id: "album-test",
        title: "旅行回憶",
        description: "",
        createdAt: new Date().toISOString(),
        mediaFolder: "album-test",
      }],
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
      albums: [{
        id: "album-test",
        title: "旅行回憶",
        description: "",
        createdAt: new Date().toISOString(),
        mediaFolder: "album-test",
      }],
    });
    fireEvent.click(screen.getByRole("button", { name: "相簿" }));
    fireEvent.click(screen.getByRole("button", { name: /刪除相簿/ }));
    fireEvent.click(screen.getByRole("button", { name: "回收桶" }));
    const row = screen.getByText("旅行回憶").closest("article")!;
    expect(within(row).getByText("相簿")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "復原" }));
    fireEvent.click(screen.getByRole("button", { name: "相簿" }));
    expect(screen.getByDisplayValue("旅行回憶")).toBeInTheDocument();
  });

  it("設定頁會顯示資料儲存位置", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(screen.getByDisplayValue("瀏覽器預覽資料")).toBeDisabled();
  });
});
