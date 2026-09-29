import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LedgerPage from "../src/components/LedgerPage";
import { summarizeExpenses } from "../src/data/ledger";
import { clampFloatingMoonPosition } from "../src/data/floatingMoon";
import { normalizeState } from "../src/data/repository";
import { initialState, todayKey, type AppState } from "../src/data/types";

describe("v0.9.1 app 內月光精靈位置", () => {
  it("視窗縮小後會把角色位置限制在視窗範圍內", () => {
    expect(
      clampFloatingMoonPosition(
        { left: 900, top: 650 },
        86,
        { width: 500, height: 360 },
      ),
    ).toEqual({ left: 406, top: 254 });
  });
});

describe("記帳支出分類摘要", () => {
  const categories = [
    { id: "food", name: "餐飲", type: "expense" as const, position: 0, color: "#a05070" },
    { id: "transit", name: "交通", type: "expense" as const, position: 1, color: "#5080a0" },
    { id: "salary", name: "薪資", type: "income" as const, position: 2, color: "#508060" },
  ];
  const entries = [
    { id: "1", type: "expense" as const, amount: 100, date: "2026-09-01", categoryId: "food", account: "", note: "", createdAt: "" },
    { id: "2", type: "expense" as const, amount: 200, date: "2026-09-10", categoryId: "food", account: "", note: "", createdAt: "" },
    { id: "3", type: "expense" as const, amount: 300, date: "2026-09-10", categoryId: "transit", account: "", note: "", createdAt: "" },
    { id: "4", type: "income" as const, amount: 9000, date: "2026-09-10", categoryId: "salary", account: "", note: "", createdAt: "" },
    { id: "5", type: "expense" as const, amount: 20, date: "2026-10-01", categoryId: "food", account: "", note: "", createdAt: "" },
    { id: "6", type: "expense" as const, amount: 40, date: "2026-01-01", categoryId: "transit", account: "", note: "", createdAt: "", deletedAt: "2026-01-02" },
  ];

  it("月與年度統計只加總該期間未刪除的支出，收入不混入消費", () => {
    const month = summarizeExpenses(entries, categories, "2026-09");
    const year = summarizeExpenses(entries, categories, "2026");

    expect(month.total).toBe(600);
    expect(month.categories.map(({ name, amount }) => ({ name, amount }))).toEqual(
      expect.arrayContaining([
        { name: "餐飲", amount: 300 },
        { name: "交通", amount: 300 },
      ]),
    );
    expect(month.categories.find((category) => category.name === "餐飲")?.percentage).toBe(50);
    expect(year.total).toBe(620);
  });
});

describe("記帳表格與欄位", () => {
  function LedgerHarness() {
    const [state, setState] = useState<AppState>({
      ...initialState,
      ledgerCategories: [
        { id: "food", name: "餐飲", type: "expense", position: 0, color: "#a05070" },
      ],
      ledgerEntries: [
        {
          id: "legacy-entry",
          type: "expense",
          amount: 120,
          date: todayKey,
          categoryId: "food",
          account: "信用卡",
          note: "原有備註",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });
    return <LedgerPage state={state} setState={setState} />;
  }

  it("依指定順序顯示七個欄位，並讓舊付款帳戶資料可編輯", () => {
    render(<LedgerHarness />);
    const table = screen.getByRole("table");
    expect(
      within(table).getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["消費日期", "項目", "金額", "分類", "店家/品牌", "支付方式", "備註"]);

    const row = screen.getByText(todayKey).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      todayKey,
      "—",
      "−$120",
      "餐飲",
      "—",
      "信用卡",
      "原有備註",
    ]);

    fireEvent.click(row!);
    fireEvent.change(screen.getByLabelText("項目"), { target: { value: "午餐便當" } });
    fireEvent.change(screen.getByLabelText("店家/品牌"), { target: { value: "月光小館" } });
    fireEvent.change(screen.getByLabelText("支付方式"), { target: { value: "現金" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    const updatedRow = screen.getByText(todayKey).closest("tr");
    expect(within(updatedRow!).getAllByRole("cell").map((cell) => cell.textContent)).toContain("午餐便當");
    expect(within(updatedRow!).getAllByRole("cell").map((cell) => cell.textContent)).toContain("月光小館");
    expect(within(updatedRow!).getAllByRole("cell").map((cell) => cell.textContent)).toContain("現金");
    expect(screen.getByRole("region", { name: /月支出/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /年支出/ })).toBeInTheDocument();
  });

  it("載入舊版帳目時把付款帳戶沿用到支付方式，且保留備註", () => {
    const migrated = normalizeState({
      ledgerEntries: [
        {
          id: "old-ledger",
          type: "expense",
          amount: 50,
          date: todayKey,
          categoryId: "old-category",
          account: "悠遊卡",
          note: "舊資料",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });

    expect(migrated.ledgerEntries[0]).toMatchObject({
      item: "",
      shopBrand: "",
      paymentMethod: "悠遊卡",
      account: "悠遊卡",
      note: "舊資料",
    });
  });
});
