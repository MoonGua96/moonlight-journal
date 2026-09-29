import type { LedgerCategory, LedgerEntry } from "./types";

export interface ExpenseCategoryTotal {
  id: string;
  name: string;
  color: string;
  amount: number;
  percentage: number;
}

export interface ExpenseBreakdown {
  total: number;
  categories: ExpenseCategoryTotal[];
}

const uncategorizedColor = "#9a91a2";

/** Summarizes all non-deleted expenses whose ISO date starts with the period. */
export function summarizeExpenses(
  entries: readonly LedgerEntry[],
  categories: readonly LedgerCategory[],
  periodPrefix: string,
): ExpenseBreakdown {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const totals = new Map<string, number>();

  for (const entry of entries) {
    if (
      entry.deletedAt ||
      entry.type !== "expense" ||
      !entry.date.startsWith(periodPrefix)
    ) {
      continue;
    }

    const id = categoryById.has(entry.categoryId)
      ? entry.categoryId
      : "__uncategorized__";
    totals.set(id, (totals.get(id) || 0) + entry.amount);
  }

  const total = [...totals.values()].reduce((sum, amount) => sum + amount, 0);
  const categoryTotals = [...totals.entries()]
    .map(([id, amount]) => {
      const category = id === "__uncategorized__" ? undefined : categoryById.get(id);
      return {
        id,
        name: category?.name || "未分類",
        color: category?.color || uncategorizedColor,
        amount,
        percentage: total > 0 ? (amount / total) * 100 : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "zh-TW"));

  return { total, categories: categoryTotals };
}
