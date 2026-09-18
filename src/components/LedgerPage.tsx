import {
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from "react";
import {
  makeId,
  todayKey,
  type AppState,
  type LedgerEntry,
} from "../data/types";

type Setter = Dispatch<SetStateAction<AppState>>;
const money = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0,
});
const defaults = {
  expense: ["餐飲", "交通", "購物", "娛樂", "醫療", "其他支出"],
  income: ["薪資", "獎金", "退款", "其他收入"],
};

export default function LedgerPage({
  state,
  setState,
}: {
  state: AppState;
  setState: Setter;
}) {
  const [month, setMonth] = useState(todayKey.slice(0, 7));
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const categoryDrag = useRef("");
  const categories = state.ledgerCategories.length
    ? [...state.ledgerCategories].sort((a, b) => a.position - b.position)
    : [
        ...defaults.expense.map((name, position) => ({
          id: `expense-${name}`,
          name,
          type: "expense" as const,
          position,
        })),
        ...defaults.income.map((name, position) => ({
          id: `income-${name}`,
          name,
          type: "income" as const,
          position,
        })),
      ];
  const entries = state.ledgerEntries
    .filter(
      (x) =>
        !x.deletedAt &&
        x.date.startsWith(month) &&
        (categoryFilter === "all" || x.categoryId === categoryFilter),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const summary = useMemo(
    () =>
      entries.reduce(
        (sum, item) => ({ ...sum, [item.type]: sum[item.type] + item.amount }),
        { income: 0, expense: 0 },
      ),
    [entries],
  );
  const save = (entry: LedgerEntry) =>
    setState((current) => ({
      ...current,
      ledgerCategories: current.ledgerCategories.length
        ? current.ledgerCategories
        : categories,
      ledgerEntries: current.ledgerEntries.some((x) => x.id === entry.id)
        ? current.ledgerEntries.map((x) => (x.id === entry.id ? entry : x))
        : [...current.ledgerEntries, entry],
    }));
  const ensureCategories = () =>
    setState((current) => ({
      ...current,
      ledgerCategories: current.ledgerCategories.length
        ? current.ledgerCategories
        : categories,
    }));
  const dropCategory = (targetId: string, event: DragEvent) => {
    event.preventDefault();
    const fromId = categoryDrag.current;
    categoryDrag.current = "";
    if (!fromId || fromId === targetId) return;
    const ordered = [...categories],
      from = ordered.findIndex((x) => x.id === fromId),
      to = ordered.findIndex((x) => x.id === targetId);
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    setState((current) => ({
      ...current,
      ledgerCategories: ordered.map((item, position) => ({
        ...item,
        position,
      })),
    }));
  };
  return (
    <div className="page ledger-page">
      <div className="page-tools">
        <input
          aria-label="記帳月份"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        <select
          aria-label="分類篩選"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">全部分類</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <button
          className="primary"
          onClick={() =>
            setEditing({
              id: makeId("ledger"),
              type: "expense",
              amount: 0,
              date: todayKey,
              categoryId:
                categories.find((x) => x.type === "expense")?.id || "",
              account: "",
              note: "",
              createdAt: new Date().toISOString(),
            })
          }
        >
          ＋ 記一筆
        </button>
      </div>
      <div className="ledger-categories">
        {categories.map((category) => (
          <span
            key={category.id}
            draggable
            onDragStart={() => {
              categoryDrag.current = category.id;
              ensureCategories();
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropCategory(category.id, event)}
          >
            <i>{category.type === "expense" ? "支" : "收"}</i>
            <button
              onClick={() => {
                const name = prompt("分類名稱", category.name)?.trim();
                if (!name) return;
                ensureCategories();
                setState((current) => ({
                  ...current,
                  ledgerCategories: (current.ledgerCategories.length
                    ? current.ledgerCategories
                    : categories
                  ).map((item) =>
                    item.id === category.id ? { ...item, name } : item,
                  ),
                }));
              }}
            >
              {category.name}
            </button>
            <button
              aria-label={`刪除 ${category.name}`}
              onClick={() => {
                const fallback = categories.find(
                  (item) =>
                    item.type === category.type && item.id !== category.id,
                );
                if (
                  !fallback ||
                  !confirm(
                    `刪除「${category.name}」？既有帳目會移到「${fallback.name}」。`,
                  )
                )
                  return;
                setState((current) => ({
                  ...current,
                  ledgerCategories: categories
                    .filter((item) => item.id !== category.id)
                    .map((item, position) => ({ ...item, position })),
                  ledgerEntries: current.ledgerEntries.map((entry) =>
                    entry.categoryId === category.id
                      ? { ...entry, categoryId: fallback.id }
                      : entry,
                  ),
                }));
              }}
            >
              ×
            </button>
          </span>
        ))}
        <button
          onClick={() => {
            const name = prompt("新增支出分類名稱")?.trim();
            if (name)
              setState((current) => ({
                ...current,
                ledgerCategories: [
                  ...categories,
                  {
                    id: makeId("ledger-category"),
                    name,
                    type: "expense",
                    position: categories.length,
                  },
                ],
              }));
          }}
        >
          ＋ 支出分類
        </button>
        <button
          onClick={() => {
            const name = prompt("新增收入分類名稱")?.trim();
            if (name)
              setState((current) => ({
                ...current,
                ledgerCategories: [
                  ...categories,
                  {
                    id: makeId("ledger-category"),
                    name,
                    type: "income",
                    position: categories.length,
                  },
                ],
              }));
          }}
        >
          ＋ 收入分類
        </button>
      </div>
      <div className="ledger-summary">
        <article>
          <small>收入</small>
          <strong>{money.format(summary.income)}</strong>
        </article>
        <article>
          <small>支出</small>
          <strong>{money.format(summary.expense)}</strong>
        </article>
        <article>
          <small>結餘</small>
          <strong>{money.format(summary.income - summary.expense)}</strong>
        </article>
      </div>
      <div className="panel ledger-list">
        {entries.length ? (
          entries.map((entry) => (
            <button key={entry.id} onClick={() => setEditing(entry)}>
              <span>
                <b>
                  {categories.find((x) => x.id === entry.categoryId)?.name ||
                    "未分類"}
                </b>
                <small>
                  {entry.date}
                  {entry.account ? ` · ${entry.account}` : ""}
                </small>
              </span>
              <strong className={entry.type}>
                {entry.type === "expense" ? "−" : "+"}
                {money.format(entry.amount)}
              </strong>
            </button>
          ))
        ) : (
          <p className="empty-ledger">這個月還沒有帳目。</p>
        )}
      </div>
      {editing && (
        <LedgerEditor
          value={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onDelete={() => {
            setState((current) => ({
              ...current,
              ledgerEntries: current.ledgerEntries.map((x) =>
                x.id === editing.id
                  ? { ...x, deletedAt: new Date().toISOString() }
                  : x,
              ),
            }));
            setEditing(null);
          }}
          onSave={(value) => {
            save(value);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function LedgerEditor({
  value,
  categories,
  onClose,
  onSave,
  onDelete,
}: {
  value: LedgerEntry;
  categories: AppState["ledgerCategories"];
  onClose: () => void;
  onSave: (value: LedgerEntry) => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState(value);
  const choices = categories.filter((x) => x.type === form.type);
  return (
    <div
      className="modal-layer"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section className="modal" role="dialog" aria-label="記帳">
        <header>
          <div>
            <small>LEDGER</small>
            <h2>{value.amount ? "編輯紀錄" : "記一筆"}</h2>
          </div>
          <button aria-label="關閉" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <label className="field">
            <span>類型</span>
            <select
              value={form.type}
              onChange={(e) => {
                const type = e.target.value as LedgerEntry["type"];
                setForm({
                  ...form,
                  type,
                  categoryId: categories.find((x) => x.type === type)?.id || "",
                });
              }}
            >
              <option value="expense">支出</option>
              <option value="income">收入</option>
            </select>
          </label>
          <label className="field">
            <span>金額</span>
            <input
              autoFocus
              aria-label="金額"
              type="number"
              min="0"
              step="1"
              value={form.amount || ""}
              onChange={(e) =>
                setForm({ ...form, amount: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>日期</span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label className="field">
            <span>分類</span>
            <select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              {choices.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>付款帳戶（可留空）</span>
            <input
              value={form.account}
              onChange={(e) => setForm({ ...form, account: e.target.value })}
              placeholder="例如：現金、信用卡"
            />
          </label>
          <label className="field">
            <span>備註</span>
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
        </div>
        <footer>
          {value.amount > 0 ? (
            <button className="danger-link" onClick={onDelete}>
              移到回收桶
            </button>
          ) : (
            <span />
          )}
          <button
            disabled={!form.amount || !form.date || !form.categoryId}
            onClick={() => onSave(form)}
          >
            儲存
          </button>
        </footer>
      </section>
    </div>
  );
}
