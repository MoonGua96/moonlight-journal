import {
  act,
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
import RichTextEditor, { sanitizeRichText } from "../src/components/RichTextEditor";
import { initialState, todayKey } from "../src/data/types";
import { lunarInfo } from "../src/data/calendar";
import { normalizeState } from "../src/data/repository";
import * as repositoryModule from "../src/data/repository";
import * as mediaModule from "../src/data/media";
import {
  changeVaultPassword,
  emptyVault,
  sealVault,
  unlockVault,
} from "../src/data/vault";

const testDate = (offset: number) => {
  const date = new Date(`${todayKey}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString("sv-SE");
};

function testState() {
  const state = structuredClone(initialState);
  state.settings = { ...state.settings, userName: "測試使用者", setupCompleted: true };
  state.calendarItems = [
    { id: "event-test-today", type: "note", date: todayKey, title: "準備會議資料", time: "10:00", color: "violet" },
  ];
  state.todos = [
    { id: "todo-test-1", title: "確認第一版資訊架構", description: "整理頁面與導覽。", status: "todo", color: "violet", dueDate: testDate(1), position: 0 },
    { id: "todo-test-2", title: "整理 React 筆記", description: "整理元件與狀態管理。", status: "todo", color: "sky", dueDate: testDate(3), position: 1 },
    { id: "todo-test-3", title: "建立測試流程", description: "", status: "doing", color: "violet", dueDate: todayKey, position: 0 },
    { id: "todo-test-4", title: "安排日常練習", description: "", status: "paused", color: "sage", dueDate: "", position: 0, pausePeriods: [{ startDate: todayKey }] },
    { id: "todo-test-5", title: "完成需求規格", description: "", status: "done", color: "sage", dueDate: testDate(-1), position: 0 },
  ];
  state.diaries = [{
    date: todayKey,
    title: "測試日記",
    body: "今天完成一項小目標。",
    updatedAt: new Date().toISOString(),
    snippets: [{ id: "snippet-test", text: "今天完成一項小目標。", createdAt: new Date().toISOString() }],
  }];
  state.notes = [{
    id: "note-test",
    title: "React 學習歷程",
    folder: "工作與學習",
    updatedAt: new Date().toISOString(),
    sections: [{ id: "section-test", title: "基礎觀念", body: "整理元件與狀態管理。" }],
  }];
  state.albums = [{ id: "album-test", title: "旅行相簿", description: "", createdAt: new Date().toISOString(), mediaFolder: "album-test" }];
  state.inbox = [{ id: "inbox-test", text: "整理學習清單", createdAt: new Date().toISOString() }];
  return state;
}

async function renderReady() {
  const storageKey = "moonlight-journal.v0.2.state";
  const stored = localStorage.getItem(storageKey);
  if (!stored) {
    localStorage.setItem(storageKey, JSON.stringify(testState()));
  } else {
    const state = JSON.parse(stored);
    state.settings = { ...initialState.settings, ...state.settings, setupCompleted: true };
    localStorage.setItem(storageKey, JSON.stringify(state));
  }
  render(<App />);
  await screen.findByRole("heading", { name: "今天", level: 1 });
}

async function unlockPrivatePages(target: "日記" | "相簿" = "相簿") {
  fireEvent.click(screen.getByRole("button", { name: "密碼保管庫" }));
  fireEvent.change(screen.getByLabelText("保管庫帳號"), { target: { value: "moon" } });
  const passwordInputs = screen.getAllByLabelText(/主密碼|再輸入一次/);
  fireEvent.change(passwordInputs[0], { target: { value: "correct-horse-2026" } });
  fireEvent.change(passwordInputs[1], { target: { value: "correct-horse-2026" } });
  fireEvent.click(screen.getByRole("button", { name: "建立並解鎖" }));
  await screen.findByText(/0 筆已加密的帳密/);
  fireEvent.click(screen.getByRole("button", { name: target }));
  expect(await screen.findByRole("heading", { name: "日記與相簿已上鎖" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("保管庫帳號"), { target: { value: "moon" } });
  fireEvent.change(screen.getByLabelText("主密碼"), { target: { value: "correct-horse-2026" } });
  fireEvent.click(screen.getByRole("button", { name: "解鎖日記與相簿" }));
  if (target === "相簿") await screen.findByDisplayValue("旅行相簿");
  else await screen.findByDisplayValue(todayKey);
}

describe("月光簿 v0.9.1", () => {
  it("首次開啟可設定顯示名稱，且可稍後修改", async () => {
    localStorage.removeItem("moonlight-journal.v0.2.state");
    render(<App />);
    expect(await screen.findByRole("dialog", { name: "歡迎來到月光簿" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("首次設定名稱"), {
      target: { value: "新使用者" },
    });
    fireEvent.click(screen.getByRole("button", { name: "開始使用" }));
    expect(screen.queryByRole("dialog", { name: "歡迎來到月光簿" })).not.toBeInTheDocument();
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("moonlight-journal.v0.2.state") || "{}");
      expect(saved.settings).toMatchObject({ userName: "新使用者", setupCompleted: true });
    });
  });

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

  it("游標停在螢幕最左側一小段時間後快速展開功能列", async () => {
    await renderReady();
    const edge = document.querySelector(".sidebar-edge-trigger")!;
    const sidebar = document.querySelector(".sidebar")!;
    vi.useFakeTimers();
    try {
      fireEvent.mouseEnter(edge);
      act(() => vi.advanceTimersByTime(119));
      expect(sidebar).not.toHaveClass("open");
      act(() => vi.advanceTimersByTime(1));
      expect(sidebar).toHaveClass("open");
    } finally {
      vi.useRealTimers();
    }
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
    const entry = screen.getByText("準備會議資料").closest(".calendar-month-entry")!;
    expect(entry).not.toHaveTextContent("10:00");
  });

  it("重點代辦逾期只在標題前顯示警告符號，不顯示輔助灰字", async () => {
    const seeded = structuredClone(initialState);
    const due = new Date(`${todayKey}T12:00:00`);
    due.setDate(due.getDate() - 4);
    const dueKey = due.toLocaleDateString("sv-SE");
    seeded.todos.push({
      id: "overdue-long-term",
      title: "準備九版測試",
      description: "",
      kind: "progress",
      status: "doing",
      color: "violet",
      dueDate: dueKey,
      startDate: dueKey,
      endDate: dueKey,
      position: 99,
    });
    localStorage.setItem("moonlight-journal.v0.2.state", JSON.stringify(seeded));
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "行事曆" }));
    const entry = [...document.querySelectorAll<HTMLElement>(".calendar-month-entry")]
      .find((item) => item.textContent?.includes("準備九版測試") && item.querySelector(".calendar-overdue-mark"))!;
    expect(entry).toBeInTheDocument();
    expect(entry.querySelector(".calendar-overdue-mark")).toHaveTextContent("⚠");
    expect(entry.querySelector(".calendar-overdue-mark")).not.toHaveTextContent("⚠⚠");
    expect(entry).not.toHaveTextContent("重點代辦");
    expect(entry).not.toHaveTextContent("逾期事件");
  });

  it("可新增待辦並保存到畫面", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增待辦" }));
    fireEvent.change(screen.getByLabelText("標題"), {
      target: { value: "測試新的待辦" },
    });
    fireEvent.change(screen.getByLabelText("一般待辦開始日期"), {
      target: { value: "2026-09-18" },
    });
    fireEvent.change(screen.getByLabelText("一般待辦結束日期"), {
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

  it("一般跨日待辦保持一般卡片並可逐日勾選", async () => {
    await renderReady();
    const end = new Date(`${todayKey}T12:00:00`);
    end.setDate(end.getDate() + 2);
    const endKey = end.toLocaleDateString("sv-SE");
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增待辦" }));
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "逐日完成的工作" } });
    fireEvent.change(screen.getByLabelText("一般待辦開始日期"), { target: { value: todayKey } });
    fireEvent.change(screen.getByLabelText("一般待辦結束日期"), { target: { value: endKey } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    const card = screen.getByText("逐日完成的工作").closest("article")!;
    expect(card).not.toHaveClass("multi-day");
    expect(card).not.toHaveClass("recurring-compact");
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

  it("一般待辦在行事曆勾選與取消會同步完成狀態", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增待辦" }));
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "出門買禮物" } });
    fireEvent.change(screen.getByLabelText("一般待辦開始日期"), { target: { value: todayKey } });
    fireEvent.change(screen.getByLabelText("待辦開始時間"), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText("待辦結束時間"), { target: { value: "12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    fireEvent.click(screen.getByRole("button", { name: "行事曆" }));

    const checkbox = screen.getByLabelText(`完成 出門買禮物（${todayKey}）`);
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    expect(within(screen.getByText("出門買禮物").closest("article")!).getByText("完成")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "行事曆" }));
    fireEvent.click(screen.getByLabelText(`完成 出門買禮物（${todayKey}）`));
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    expect(within(screen.getByText("出門買禮物").closest("article")!).getByText("進行中")).toBeInTheDocument();
  });

  it("週期代辦可建立每週多日重複系列", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增待辦" }));
    expect(screen.getByRole("option", { name: "週期代辦" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "重點代辦" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "每週整理工作桌" } });
    fireEvent.change(screen.getByLabelText("任務類型"), { target: { value: "recurring" } });
    expect(screen.getByText("週期頻率")).toBeInTheDocument();
    expect(screen.getByText("週期期限")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("重複頻率"), { target: { value: "weekly" } });
    const weekdays = within(screen.getByRole("group", { name: "重複星期" })).getAllByRole("button");
    weekdays.forEach((button, day) => {
      const shouldBeSelected = day === 1 || day === 2;
      const selected = button.getAttribute("aria-pressed") === "true";
      if (selected !== shouldBeSelected) fireEvent.click(button);
    });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    const card = screen.getByText("每週整理工作桌").closest("article")!;
    expect(card).toHaveClass("recurring-compact");
    expect(within(card).getByRole("button", { name: "刪除 每週整理工作桌" })).toBeInTheDocument();
    expect(within(card).queryByText(/週一|週二|進行中/)).not.toBeInTheDocument();
    fireEvent.click(card);
    expect(screen.getByRole("heading", { name: "編輯待辦" })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("moonlight-journal.v0.2.state")).toContain("每週整理工作桌"));
    const saved = JSON.parse(localStorage.getItem("moonlight-journal.v0.2.state")!);
    const todo = saved.todos.find((item: { title: string }) => item.title === "每週整理工作桌");
    expect(todo.recurrence.rules[0]).toMatchObject({ frequency: "weekly", weekdays: [1, 2] });
    expect(todo.status).toBe("doing");
  });

  it("重點代辦可在同一天新增多筆文字紀錄", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增待辦" }));
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "整理研究計畫" } });
    fireEvent.change(screen.getByLabelText("任務類型"), { target: { value: "progress" } });
    const end = new Date(`${todayKey}T12:00:00`);
    end.setDate(end.getDate() + 10);
    fireEvent.change(screen.getByLabelText("重點代辦開始日期"), { target: { value: todayKey } });
    fireEvent.change(screen.getByLabelText("重點代辦結束日期"), { target: { value: end.toLocaleDateString("sv-SE") } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    const card = screen.getByText("整理研究計畫").closest("article")!;
    expect(card).not.toHaveClass("multi-day");
    fireEvent.click(card);
    fireEvent.click(screen.getByRole("button", { name: "查看進度紀錄" }));
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
    expect(await screen.findByRole("heading", { name: "日記與相簿已上鎖" })).toBeInTheDocument();
    await unlockPrivatePages("日記");
    expect(screen.getByRole("heading", { name: "日記", level: 1 })).toBeInTheDocument();
    expect(screen.getByDisplayValue(todayKey)).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "文字格式" })).toHaveClass("hidden");
    expect(screen.getByRole("toolbar", { name: "文字格式" }).parentElement).toHaveClass("contextual");
  });

  it("左側小月曆選日期會跳到指定月份", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "行事曆" }));
    fireEvent.change(screen.getByLabelText("選擇年月"), { target: { value: "2026-11" } });
    fireEvent.click(screen.getByRole("button", { name: "快速前往 2026-11-15" }));
    expect(screen.getByRole("heading", { name: "2026 年 11 月" })).toBeInTheDocument();
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
    const row = screen.getByText("整理學習清單").closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "轉待辦" }));
    fireEvent.click(screen.getByRole("button", { name: "待辦事項" }));
    expect(screen.getByText("整理學習清單")).toBeInTheDocument();
  });

  it("收集箱可免密碼轉成碎念，但進入日記頁仍需密碼", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "收集箱" }));
    const row = screen.getByText("整理學習清單").closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "轉碎念" }));
    fireEvent.click(screen.getByRole("button", { name: "今天" }));
    expect(screen.getByText("整理學習清單")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "日記" }));
    expect(await screen.findByRole("heading", { name: "日記與相簿已上鎖" })).toBeInTheDocument();
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
    const editor = document.querySelector(".block-editor")!;
    expect(screen.queryByText(/在任一區塊按右鍵/)).not.toBeInTheDocument();
    fireEvent.contextMenu(editor, {
      clientX: 480,
      clientY: 420,
    });
    expect(screen.queryByText(/在任一區塊按右鍵/)).not.toBeInTheDocument();
    expect(screen.getByText("▧ 加入圖片")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "✎ 簡易畫筆" }));
    expect(
      screen.getByRole("dialog", { name: "簡易畫筆" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "關閉" }));
  });

  it("筆記區塊可由選項選單刪除", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "筆記" }));
    const tab = document.querySelector<HTMLElement>(".sortable-tab")!;
    fireEvent.change(within(tab).getByLabelText(/標籤顏色/), { target: { value: "#aa3344" } });
    expect(tab.style.getPropertyValue("--tab-color")).toBe("#aa3344");
    const editor = document.querySelector(".block-editor")!;
    const initialBlockCount = document.querySelectorAll(".note-block").length;
    fireEvent.contextMenu(editor, { clientX: 480, clientY: 420 });
    fireEvent.click(screen.getByRole("button", { name: "＋ 文字" }));
    const blocks = document.querySelectorAll<HTMLElement>(".note-block");
    expect(blocks).toHaveLength(initialBlockCount + 1);
    const block = blocks[blocks.length - 1];
    expect(block).toBeInTheDocument();
    expect(within(block).queryByRole("button", { name: "區塊選項" })).not.toBeInTheDocument();
    fireEvent.click(within(block).getByRole("button", { name: "區塊排序與選項" }));
    fireEvent.click(screen.getByRole("button", { name: "刪除此區塊" }));
    await waitFor(() => expect(document.querySelectorAll(".note-block")).toHaveLength(initialBlockCount));
  });

  it("筆記清單可以逐項移除，也能建立自訂資料夾", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "筆記" }));
    const editor = document.querySelector(".block-editor")!;
    fireEvent.contextMenu(editor, { clientX: 480, clientY: 420 });
    fireEvent.click(screen.getByRole("button", { name: "＋ 編號列表" }));
    for (let index = 1; index <= 4; index += 1) {
      const input = screen.getByLabelText(`列表項目 ${index}`);
      fireEvent.change(input, { target: { value: `項目 ${index}` } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
    expect(screen.getByLabelText("列表項目 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刪除列表項目 5" }));
    expect(screen.queryByLabelText("列表項目 5")).not.toBeInTheDocument();
    expect(screen.getByLabelText("列表項目 4")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "＋ 新增資料夾" }));
    const dialog = screen.getByRole("dialog", { name: "新增資料夾" });
    expect(within(dialog).queryByRole("button", { name: "取消" })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("資料夾名稱"), { target: { value: "工作與學習" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "建立資料夾" }));
    expect(screen.getByText("工作與學習")).toBeInTheDocument();
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

  it("桌面月光精靈可拖曳並可開啟月光簿", async () => {
    render(<PetApp />);
    expect(screen.getByRole("button", { name: "打開月光簿" })).toHaveAttribute(
      "title",
      "按住月光精靈移動；連點兩下打開月光簿",
    );
    expect(
      screen.getByRole("button", { name: "打開月光簿" }),
    ).toBeInTheDocument();
    expect(document.querySelector(".spirit-orb")).toBeInTheDocument();
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

  it("文字格式工具只在選取文字時出現，選一個字也會出現", () => {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 40, right: 50, top: 40, bottom: 60, width: 10, height: 20 }),
    });
    render(<RichTextEditor html="一段文字" onChange={() => undefined} contextualToolbar />);
    const editor = screen.getByRole("textbox");
    const toolbar = screen.getByRole("toolbar", { name: "文字格式" });
    expect(toolbar).toHaveClass("hidden");
    const range = document.createRange();
    range.setStart(editor.firstChild!, 0);
    range.setEnd(editor.firstChild!, 1);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(editor);
    expect(toolbar).not.toHaveClass("hidden");
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

  it("縮小主視窗時會重新限制 App 內月光精靈的位置", async () => {
    await renderReady();
    const moon = screen.getByRole("button", { name: "找月光精靈聊聊" });
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 360,
    });
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(Number.parseFloat(moon.style.left)).toBe(406);
      expect(Number.parseFloat(moon.style.top)).toBe(254);
    });

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalWidth,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalHeight,
    });
    fireEvent(window, new Event("resize"));
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

  it("相簿可新增相簿", async () => {
    await renderReady();
    await unlockPrivatePages();
    expect(screen.getByDisplayValue("旅行相簿")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新增相簿" }));
    fireEvent.change(screen.getByPlaceholderText("例如：旅行回憶"), {
      target: { value: "生活紀錄" },
    });
    fireEvent.click(screen.getByRole("button", { name: "建立" }));
    expect(screen.getByDisplayValue("生活紀錄")).toBeInTheDocument();
  });

  it("相簿接受照片、影片與 HEIC", async () => {
    await renderReady();
    await unlockPrivatePages();
    const picker = screen.getByText("＋ 加入照片或影片").querySelector("input");
    expect(picker).toHaveAttribute(
      "accept",
      expect.stringContaining("video/*"),
    );
    expect(picker).toHaveAttribute("accept", expect.stringContaining(".heic"));
  });

  it("相簿可以移到回收桶並復原", async () => {
    await renderReady();
    await unlockPrivatePages();
    fireEvent.click(screen.getByRole("button", { name: /刪除相簿/ }));
    fireEvent.click(screen.getByRole("button", { name: "回收桶" }));
    const row = screen.getByText("旅行相簿").closest("article")!;
    expect(within(row).getByText("相簿")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "復原" }));
    fireEvent.click(screen.getByRole("button", { name: "相簿" }));
    expect(screen.getByDisplayValue("旅行相簿")).toBeInTheDocument();
  });

  it("收集箱可保存照片與影片並顯示兩種預覽", async () => {
    vi.spyOn(mediaModule, "prepareMedia").mockImplementation(async (file) => ({
      mediaType: file.type.startsWith("video/") ? "video" : "image",
      previewDataUrl: "data:image/jpeg;base64,AA==",
      duration: 3,
    }));
    vi.spyOn(repositoryModule, "storeMedia").mockImplementation(async (_id, file, previewDataUrl) => ({
      dataUrl: previewDataUrl,
      originalDataUrl: `data:${file.type};base64,AA==`,
    }));
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "收集箱" }));
    expect(within(document.querySelector(".inbox-add-fields")!).getByText("新增影音")).toBeInTheDocument();
    const picker = document.querySelector(".inbox-file-picker input")!;
    fireEvent.change(picker, { target: { files: [new File(["img"], "idea.png", { type: "image/png" }), new File(["vid"], "clip.mp4", { type: "video/mp4" })] } });
    fireEvent.click(screen.getByRole("button", { name: "加入收集箱" }));

    expect(await screen.findByRole("button", { name: "預覽素材 idea.png" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "預覽素材 clip.mp4" })).toBeInTheDocument();
    expect(document.querySelectorAll(".inbox-attachment-item")).toHaveLength(2);
    expect(document.querySelector(".inbox-attachments img")).toBeInTheDocument();
    expect(document.querySelector(".inbox-attachments video")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "預覽素材 idea.png" }));
    expect(screen.getByRole("dialog", { name: "idea.png" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "關閉預覽" }));
    await waitFor(() => expect(localStorage.getItem("moonlight-journal.v0.2.state")).toContain("clip.mp4"));
  });

  it("首頁顯示今日碎念，但日記頁仍上鎖且搜尋與快速記錄不洩漏內容", async () => {
    const seeded = structuredClone(initialState);
    seeded.diaries = [{ date: todayKey, title: "日記私密標題", body: "只有密碼解鎖後可見", snippets: [{ id: "private-snippet", text: "首頁可以看到的碎念", createdAt: new Date().toISOString() }], updatedAt: new Date().toISOString() }];
    localStorage.setItem("moonlight-journal.v0.2.state", JSON.stringify(seeded));
    await renderReady();
    expect(screen.getByText("首頁可以看到的碎念")).toBeInTheDocument();
    expect(screen.queryByText("日記私密標題")).not.toBeInTheDocument();
    expect(screen.queryByText("只有密碼解鎖後可見")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "搜尋" }));
    fireEvent.change(screen.getByPlaceholderText("輸入關鍵字……"), { target: { value: "首頁可以看到的碎念" } });
    expect(screen.getByText("沒有找到符合的記錄")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "關閉" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ 快速記錄" }));
    expect(within(screen.getByRole("dialog", { name: "先記下來" })).queryByRole("button", { name: /日記/ })).not.toBeInTheDocument();
    expect(localStorage.getItem("moonlight-journal.v0.2.state")).toContain("首頁可以看到的碎念");
    fireEvent.click(screen.getByRole("button", { name: "關閉" }));
    fireEvent.click(screen.getByRole("button", { name: "日記" }));
    expect(await screen.findByRole("heading", { name: "日記與相簿已上鎖" })).toBeInTheDocument();
  });

  it("設定頁會顯示資料儲存位置", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(screen.getByDisplayValue("瀏覽器預覽資料")).toBeDisabled();
  });
});
