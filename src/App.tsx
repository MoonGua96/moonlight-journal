import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  createFullBackup,
  exportState,
  removeMediaFiles,
  restoreFullBackup,
  saveState,
  setDesktopPetVisible,
} from "./data/repository";
import { birthdayOnDate, dateKey, lunarInfo } from "./data/calendar";
import {
  makeId,
  todayKey,
  type Album,
  type AlbumPhoto,
  type AppState,
  type CalendarItem,
  type CalendarItemType,
  type DiaryEntry,
  type Note,
  type PageName,
  type RecurringEvent,
  type Todo,
  type TodoStatus,
} from "./data/types";
import { useAppState } from "./data/useAppState";
import NoteCanvas from "./components/NoteCanvas";
import AlbumPage from "./components/AlbumPage";
import CalendarDataModal from "./components/CalendarDataModal";
import VaultPage from "./components/VaultPage";
import LedgerPage from "./components/LedgerPage";
import RecurringEventEditor from "./components/RecurringEventEditor";
import NotesWorkspace from "./components/NotesWorkspace";
import TrashPageNew from "./components/TrashPage";

const pageMeta: Record<PageName, [string, string]> = {
  today: [
    "今天",
    new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    }).format(new Date()),
  ],
  calendar: ["月曆", "安排與回看每一天"],
  todo: ["待辦事項", "讓事情慢慢往前走"],
  diary: ["日記", "今天想留下什麼"],
  notes: ["筆記", "把學習與經驗慢慢累積"],
  albums: ["相簿", "把值得記住的光收進來"],
  ledger: ["記帳", "偶爾記一筆，也能看見生活的流向"],
  vault: ["密碼保管庫", "只在解鎖時顯示的秘密"],
  inbox: ["收集箱", "還沒分類也沒關係"],
  trash: ["回收桶", "後悔時還有回頭路"],
  settings: ["設定", "把月光簿調成自己的樣子"],
};

const nav: Array<[PageName, string, string]> = [
  ["today", "⌂", "今天"],
  ["calendar", "▦", "月曆"],
  ["todo", "✓", "待辦事項"],
  ["diary", "✎", "日記"],
  ["notes", "▤", "筆記"],
  ["albums", "▧", "相簿"],
  ["ledger", "$", "記帳"],
  ["vault", "🔐", "密碼保管庫"],
  ["inbox", "⌑", "收集箱"],
  ["trash", "♲", "回收桶"],
];

type StateSetter = Dispatch<SetStateAction<AppState>>;
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(`${date}T12:00:00`));
const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

function Modal({
  title,
  eyebrow,
  onClose,
  children,
  footer,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className="modal-layer"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            {eyebrow && <small>{eyebrow}</small>}
            <h2>{title}</h2>
          </div>
          <button
            className="close"
            type="button"
            onClick={onClose}
            aria-label="關閉"
          >
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}

function Sidebar({
  page,
  setPage,
  inboxCount,
  trashCount,
  onCapture,
}: {
  page: PageName;
  setPage: (p: PageName) => void;
  inboxCount: number;
  trashCount: number;
  onCapture: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span>◐</span>
        <div>
          <strong>月光簿</strong>
          <small>Moonlight Journal</small>
        </div>
      </div>
      <button className="capture" onClick={onCapture}>
        ＋ 快速記錄
      </button>
      <nav>
        {nav.map(([key, icon, label]) => (
          <button
            aria-label={label}
            key={key}
            className={page === key ? "active" : ""}
            onClick={() => setPage(key)}
          >
            <i>{icon}</i>
            <span>{label}</span>
            {key === "inbox" && inboxCount > 0 ? (
              <b>{inboxCount}</b>
            ) : key === "trash" && trashCount > 0 ? (
              <b>{trashCount}</b>
            ) : null}
          </button>
        ))}
      </nav>
      <button
        aria-label="設定"
        className={`settings ${page === "settings" ? "active" : ""}`}
        onClick={() => setPage("settings")}
      >
        <i>⚙</i>
        <span>設定</span>
      </button>
    </aside>
  );
}

function Today({
  state,
  setPage,
  onCapture,
}: {
  state: AppState;
  setPage: (p: PageName) => void;
  onCapture: () => void;
}) {
  const todayItems: CalendarItem[] = [
    ...state.calendarItems.filter((x) => !x.deletedAt && x.date === todayKey),
    ...state.todos
      .filter((x) => !x.deletedAt && x.dueDate === todayKey)
      .map((x) => ({
        id: x.id,
        type: "todo" as const,
        date: x.dueDate,
        title: x.title,
        time: "",
        color: x.color,
      })),
  ];
  const focus = state.todos
    .filter((x) => !x.deletedAt && x.status !== "done")
    .slice(0, 3);
  const diary = state.diaries.find((x) => x.date === todayKey && !x.deletedAt);
  const hour = new Date().getHours(),
    greeting = hour < 11 ? "早安" : hour < 17 ? "午安" : "晚上好",
    weekday = new Intl.DateTimeFormat("zh-TW", { weekday: "long" }).format(
      new Date(),
    );
  return (
    <div className="page">
      <section className="hero">
        <div>
          <small>{weekday} · 慢慢來也可以</small>
          <h2>
            {greeting}
            {state.settings.userName.trim()
              ? `，${state.settings.userName.trim()}`
              : ""}
          </h2>
          <p>今天想留下什麼？一句碎念也算數。</p>
        </div>
        <button onClick={onCapture}>寫點東西</button>
      </section>
      <div className="dashboard">
        <Panel
          title="今日安排"
          action="看月曆 →"
          onAction={() => setPage("calendar")}
        >
          <div className="timeline">
            {todayItems.length ? (
              todayItems.map((x) => (
                <div key={x.id}>
                  <time>{x.time || "待辦"}</time>
                  <i className={`dot ${x.color}`}></i>
                  <span>{x.title}</span>
                </div>
              ))
            ) : (
              <Empty text="今天沒有安排" />
            )}
          </div>
        </Panel>
        <Panel
          title="正在進行"
          action="看全部 →"
          onAction={() => setPage("todo")}
        >
          <div className="focus-list">
            {focus.map((x) => (
              <div key={x.id}>
                <i className={`dot ${x.color}`}></i>
                <span>{x.title}</span>
                <small>{statusName[x.status]}</small>
              </div>
            ))}
          </div>
        </Panel>
        <Panel
          title="今天的碎念"
          action="前往日記 →"
          onAction={() => setPage("diary")}
        >
          <div className="murmur-preview">
            {diary?.snippets.length ? (
              diary.snippets.slice(-2).map((x) => (
                <p key={x.id}>
                  <time>{timeLabel(x.createdAt)}</time>
                  {x.text}
                </p>
              ))
            ) : (
              <Empty text="還沒有碎念，空白也很安靜。" />
            )}
          </div>
        </Panel>
        <article className="panel moon-note">
          <span>☾</span>
          <div>
            <small>MOON NOTE</small>
            <h3>今天不用很厲害</h3>
            <p>有記下一點點，就已經替未來的自己留下光了。</p>
          </div>
        </article>
      </div>
    </div>
  );
}

function Panel({
  title,
  action,
  onAction,
  children,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <article className="panel">
      <header>
        <h3>{title}</h3>
        {action && <button onClick={onAction}>{action}</button>}
      </header>
      {children}
    </article>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}

const colors: CalendarItem["color"][] = ["purple", "gold", "sage", "blue"];
type CalendarDisplayItem = CalendarItem & {
  completed?: boolean;
  recurringId?: string;
  occurrenceDate?: string;
  rangeStart?: string;
  rangeEnd?: string;
};
const dateInRange = (date: string, start?: string, end?: string) =>
  Boolean(start && end && date >= start && date <= end);
function CalendarPage({
  state,
  setState,
  openDiary,
}: {
  state: AppState;
  setState: StateSetter;
  openDiary: (date: string) => void;
}) {
  const now = new Date();
  const [month, setMonth] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const [selected, setSelected] = useState(todayKey);
  const [dialog, setDialog] = useState<{
    type: CalendarItemType;
    item?: CalendarItem;
  } | null>(null);
  const [popover, setPopover] = useState<{ x: number; y: number } | null>(null);
  const [calendarData, setCalendarData] = useState(false);
  const [recurringDialog, setRecurringDialog] = useState<{
    event?: RecurringEvent;
    occurrenceDate?: string;
  } | null>(null);
  const itemsForDate = (date: string): CalendarDisplayItem[] => {
    const weekday = new Date(`${date}T12:00:00`).getDay();
    const recurring = state.recurringEvents
      .filter(
        (event) =>
          !event.deletedAt &&
          event.weekday === weekday &&
          dateInRange(date, event.startDate, event.endDate) &&
          !event.exceptions.includes(date),
      )
      .map((event) => {
        const override = event.overrides[date] || {};
        return {
          id: `recurring:${event.id}:${date}`,
          recurringId: event.id,
          occurrenceDate: date,
          type: "note" as const,
          date,
          title: override.title || event.title,
          time: override.startTime || event.startTime,
          color: override.color || event.color,
        };
      });
    return [
      ...state.calendarItems.filter((x) => !x.deletedAt && x.date === date),
      ...state.todos
        .filter(
          (x) =>
            !x.deletedAt &&
            dateInRange(date, x.startDate || x.dueDate, x.endDate || x.dueDate),
        )
        .map((x) => ({
          id: x.id,
          type: "todo" as const,
          date,
          title: x.title,
          time: "",
          color: x.color,
          completed: x.status === "done",
          rangeStart: x.startDate || x.dueDate,
          rangeEnd: x.endDate || x.dueDate,
        })),
      ...recurring,
    ];
  };
  const selectedItems = itemsForDate(selected).sort((a, b) =>
    (a.time || "99").localeCompare(b.time || "99"),
  );
  const selectedHolidays = state.holidays.filter(
    (item) => !item.deletedAt && item.date === selected,
  );
  const selectedBirthdays = state.birthdays.filter(
    (item) =>
      !item.deletedAt && birthdayOnDate(item, new Date(`${selected}T12:00:00`)),
  );
  const year = month.getFullYear(),
    m = month.getMonth(),
    first = new Date(year, m, 1).getDay(),
    days = new Date(year, m + 1, 0).getDate(),
    prev = new Date(year, m, 0).getDate();
  const cells: Array<{ day: number; offset: number }> = [];
  for (let i = first - 1; i >= 0; i--)
    cells.push({ day: prev - i, offset: -1 });
  for (let d = 1; d <= days; d++) cells.push({ day: d, offset: 0 });
  while (cells.length < 42)
    cells.push({ day: cells.length - first - days + 1, offset: 1 });
  const save = (item: CalendarItem) =>
    setState((s) =>
      item.type === "todo"
        ? {
            ...s,
            todos: s.todos.some((x) => x.id === item.id)
              ? s.todos.map((x) =>
                  x.id === item.id
                    ? {
                        ...x,
                        title: item.title,
                        color: item.color,
                      }
                    : x,
                )
              : [
                  ...s.todos,
                  {
                    id: item.id,
                    title: item.title,
                    description: "",
                    status: "todo",
                    color: item.color,
                    dueDate: item.date,
                    startDate: item.date,
                    endDate: item.date,
                    position: s.todos.filter(
                      (x) => !x.deletedAt && x.status === "todo",
                    ).length,
                  },
                ],
          }
        : {
            ...s,
            calendarItems: s.calendarItems.some((x) => x.id === item.id)
              ? s.calendarItems.map((x) => (x.id === item.id ? item : x))
              : [...s.calendarItems, item],
          },
    );
  const remove = (item: CalendarItem) =>
    setState((s) =>
      item.type === "todo"
        ? {
            ...s,
            todos: s.todos.map((x) =>
              x.id === item.id
                ? { ...x, deletedAt: new Date().toISOString() }
                : x,
            ),
          }
        : {
            ...s,
            calendarItems: s.calendarItems.map((x) =>
              x.id === item.id
                ? { ...x, deletedAt: new Date().toISOString() }
                : x,
            ),
          },
    );
  return (
    <div className="page calendar-page">
      <div className="page-tools">
        <div className="month-switch">
          <button onClick={() => setMonth(new Date(year, m - 1, 1))}>‹</button>
          <h2>
            {year} 年 {m + 1} 月
          </h2>
          <button onClick={() => setMonth(new Date(year, m + 1, 1))}>›</button>
        </div>
        <div className="calendar-tools">
          <button className="secondary" onClick={() => setCalendarData(true)}>
            ◫ 管理生日與假日／固定行程
          </button>
          <button
            className="secondary"
            onClick={() => {
              setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              setSelected(todayKey);
            }}
          >
            回到今天
          </button>
        </div>
      </div>
      <div className="calendar panel">
        <div className="week">
          {["日", "一", "二", "三", "四", "五", "六"].map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>
        <div className="days">
          {cells.map((c, i) => {
            const d = new Date(year, m + c.offset, c.day),
              key = dateKey(d),
              items = itemsForDate(key),
              lunar = lunarInfo(d),
              holiday = state.holidays.find(
                (item) => !item.deletedAt && item.date === key,
              ),
              birthdays = state.birthdays.filter(
                (item) => !item.deletedAt && birthdayOnDate(item, d),
              ),
              weekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <button
                aria-label={key}
                key={`${key}-${i}`}
                className={`${c.offset ? "other" : ""} ${key === todayKey ? "today" : ""} ${weekend ? "weekend" : ""} ${holiday?.type === "national" ? "holiday" : ""} ${holiday?.type === "makeup" ? "makeup-day" : ""}`}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setSelected(key);
                  setPopover({
                    x: Math.min(innerWidth - 340, Math.max(235, r.left)),
                    y:
                      r.bottom + 360 > innerHeight
                        ? Math.max(10, r.top - 330)
                        : r.bottom + 8,
                  });
                }}
              >
                <div className="day-heading">
                  <b>{c.day}</b>
                  <em>{lunar.shortLabel}</em>
                </div>
                {holiday && (
                  <small className={`calendar-special ${holiday.type}`}>
                    {holiday.name}
                  </small>
                )}
                {birthdays.slice(0, 1).map((birthday) => (
                  <small
                    key={birthday.id}
                    className={`calendar-birthday ${birthday.calendar}`}
                  >
                    {birthday.calendar === "lunar" ? "☾" : "🎂"} {birthday.name}
                  </small>
                ))}
                {items.slice(0, 2).map((x) => {
                  const range = x.type === "todo" && x.rangeStart && x.rangeEnd;
                  const continuesBefore = Boolean(range && key > x.rangeStart! && d.getDay() !== 0);
                  const continuesAfter = Boolean(range && key < x.rangeEnd! && d.getDay() !== 6);
                  const showRangeTitle = !continuesBefore;
                  return <small key={x.id} title={x.title} className={`${x.color} ${x.completed ? "calendar-todo-complete" : ""} ${range ? "calendar-range" : ""} ${continuesBefore ? "continues-before" : ""} ${continuesAfter ? "continues-after" : ""}`}>{x.type === "todo" && showRangeTitle ? "▰ " : ""}{range && !showRangeTitle ? "\u00a0" : x.title}</small>;
                })}
              </button>
            );
          })}
        </div>
      </div>
      {popover && (
        <div
          className="calendar-pop"
        >
          <header>
            <div>
              <small>{dateLabel(selected).split(" ")[0]}</small>
              <strong>{dateLabel(selected)}</strong>
              <span className="lunar-full">
                農曆 {lunarInfo(new Date(`${selected}T12:00:00`)).monthText}
                {lunarInfo(new Date(`${selected}T12:00:00`)).day} 日
              </span>
            </div>
            <button aria-label="關閉日期視窗" onClick={() => setPopover(null)}>
              ×
            </button>
          </header>
          <div className="pop-items">
            {selectedHolidays.map((item) => (
              <div className="special-row" key={item.id}>
                <i
                  className={`dot ${item.type === "makeup" ? "blue" : "gold"}`}
                ></i>
                <span>{item.name}</span>
              </div>
            ))}
            {selectedBirthdays.map((item) => (
              <div
                className={`special-row birthday-row ${item.calendar}`}
                key={item.id}
              >
                <i>{item.calendar === "lunar" ? "☾" : "🎂"}</i>
                <span>
                  {item.name}的生日
                  <small>
                    {item.calendar === "lunar" ? "農曆生日" : "陽曆生日"}
                  </small>
                  {item.birthYear
                    ? ` · ${new Date(`${selected}T12:00:00`).getFullYear() - item.birthYear} 歲`
                    : ""}
                </span>
              </div>
            ))}
            {selectedItems.length ? (
              selectedItems.map((item) => (
                <div key={item.id}>
                  <i className={`dot ${item.color}`}></i>
                  <button
                    className="item-text"
                    onClick={() =>
                      item.recurringId
                        ? setRecurringDialog({
                            event: state.recurringEvents.find(
                              (event) => event.id === item.recurringId,
                            ),
                            occurrenceDate: item.occurrenceDate,
                          })
                        : setDialog({ type: item.type, item })
                    }
                  >
                    <small>
                      {item.type === "todo" ? "待辦" : item.time || "記事"}
                    </small>
                    <span>{item.title}</span>
                  </button>
                  {!item.recurringId && (
                    <button
                      aria-label={`刪除 ${item.title}`}
                      className="delete"
                      onClick={() => remove(item)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))
            ) : selectedHolidays.length === 0 &&
              selectedBirthdays.length === 0 ? (
              <Empty text="這天還是空白的。" />
            ) : null}
          </div>
          <div className="pop-add">
            <button onClick={() => setDialog({ type: "note" })}>
              ＋ 新增記事
            </button>
            <button onClick={() => setDialog({ type: "todo" })}>
              ＋ 新增待辦
            </button>
          </div>
          <button className="diary-jump" onClick={() => openDiary(selected)}>
            ✎ 前往這天的日記 <b>→</b>
          </button>
        </div>
      )}
      {dialog && (
        <CalendarEditor
          date={selected}
          value={dialog.item}
          type={dialog.type}
          onClose={() => setDialog(null)}
          onSave={(item) => {
            save(item);
            setSelected(item.date);
            setDialog(null);
          }}
        />
      )}
      {calendarData && (
        <CalendarDataModal
          state={state}
          setState={setState}
          onClose={() => setCalendarData(false)}
          onManageRecurring={(event) => {
            setCalendarData(false);
            setRecurringDialog({ event, occurrenceDate: selected });
          }}
        />
      )}
      {recurringDialog && (
        <RecurringEventEditor
          value={recurringDialog.event}
          occurrenceDate={recurringDialog.occurrenceDate || selected}
          onClose={() => setRecurringDialog(null)}
          onSave={(event) => {
            setState((current) => ({
              ...current,
              recurringEvents: current.recurringEvents.some(
                (item) => item.id === event.id,
              )
                ? current.recurringEvents.map((item) =>
                    item.id === event.id ? event : item,
                  )
                : [...current.recurringEvents, event],
            }));
            setRecurringDialog(null);
          }}
          onDeleteOccurrence={(event, date) => {
            setState((current) => ({
              ...current,
              recurringEvents: current.recurringEvents.map((item) =>
                item.id === event.id
                  ? {
                      ...item,
                      exceptions: [...new Set([...item.exceptions, date])],
                    }
                  : item,
              ),
            }));
            setRecurringDialog(null);
          }}
          onDeleteSeries={(event) => {
            setState((current) => ({
              ...current,
              recurringEvents: current.recurringEvents.map((item) =>
                item.id === event.id
                  ? { ...item, deletedAt: new Date().toISOString() }
                  : item,
              ),
            }));
            setRecurringDialog(null);
          }}
        />
      )}
    </div>
  );
}

function CalendarEditor({
  date,
  value,
  type,
  onClose,
  onSave,
}: {
  date: string;
  value?: CalendarItem;
  type: CalendarItemType;
  onClose: () => void;
  onSave: (v: CalendarItem) => void;
}) {
  const [form, setForm] = useState<CalendarItem>(
    value || {
      id: makeId("event"),
      type,
      date,
      title: "",
      time: "",
      color: type === "todo" ? "gold" : "purple",
    },
  );
  const valid = Boolean(form.date && form.title.trim());
  return (
    <Modal
      eyebrow="CALENDAR"
      title={`${value ? "編輯" : "新增"}${type === "todo" ? "待辦" : "記事"}`}
      onClose={onClose}
      footer={
        <>
          <span>內容會自動保存在本機</span>
          <button
            disabled={!valid}
            onClick={() =>
              valid && onSave({ ...form, title: form.title.trim() })
            }
          >
            儲存
          </button>
        </>
      }
    >
      <Field label="日期">
        <input
          type="date"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
      </Field>
      <Field label="內容">
        <input
          autoFocus
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="例如：下午去復健"
        />
      </Field>
      {type === "note" && (
        <Field label="時間">
          <input
            type="time"
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
          />
        </Field>
      )}
      <Field label="顏色">
        <div className="color-picks">
          {colors.map((c) => (
            <button
              key={c}
              className={`${c} ${form.color === c ? "selected" : ""}`}
              onClick={() => setForm({ ...form, color: c })}
            />
          ))}
        </div>
      </Field>
    </Modal>
  );
}

const columns: Array<[TodoStatus, string]> = [
  ["todo", "待辦事項"],
  ["doing", "進行中"],
  ["paused", "暫停"],
  ["done", "完成"],
];
const statusName = Object.fromEntries(columns) as Record<TodoStatus, string>;
function TodoPage({
  state,
  setState,
}: {
  state: AppState;
  setState: StateSetter;
}) {
  const [editing, setEditing] = useState<Todo | null | undefined>(undefined);
  const dragged = useRef(false);
  const pointerDrag = useRef<{
    id: string;
    title: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    title: string;
    x: number;
    y: number;
    over?: TodoStatus;
  } | null>(null);
  const todos = state.todos.filter((x) => !x.deletedAt);
  const save = (todo: Todo) =>
    setState((s) => ({
      ...s,
      todos: s.todos.some((x) => x.id === todo.id)
        ? s.todos.map((x) => (x.id === todo.id ? todo : x))
        : [...s.todos, todo],
    }));
  const move = (id: string, status: TodoStatus) =>
    setState((s) => ({
      ...s,
      todos: s.todos.map((x) =>
        x.id === id
          ? {
              ...x,
              status,
              position: s.todos.filter(
                (t) => !t.deletedAt && t.status === status,
              ).length,
            }
          : x,
      ),
    }));
  const remove = (id: string) =>
    setState((s) => ({
      ...s,
      todos: s.todos.map((x) =>
        x.id === id ? { ...x, deletedAt: new Date().toISOString() } : x,
      ),
    }));
  const statusAt = (x: number, y: number) =>
    document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-todo-status]")
      ?.dataset.todoStatus as TodoStatus | undefined;
  const pointerDown = (e: ReactPointerEvent, todo: Todo) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerDrag.current = {
      id: todo.id,
      title: todo.title,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
  };
  const pointerMove = (e: ReactPointerEvent) => {
    const current = pointerDrag.current;
    if (!current) return;
    if (
      !current.active &&
      Math.hypot(e.clientX - current.startX, e.clientY - current.startY) < 6
    )
      return;
    e.preventDefault();
    current.active = true;
    setDragPreview({
      title: current.title,
      x: e.clientX,
      y: e.clientY,
      over: statusAt(e.clientX, e.clientY),
    });
  };
  const pointerUp = (e: ReactPointerEvent) => {
    const current = pointerDrag.current;
    if (!current) return;
    if (current.active) {
      const status = statusAt(e.clientX, e.clientY);
      if (status) move(current.id, status);
      dragged.current = true;
    }
    pointerDrag.current = null;
    setDragPreview(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const pointerCancel = () => {
    pointerDrag.current = null;
    setDragPreview(null);
  };
  return (
    <div className="page">
      <div className="page-tools">
        <p>拖拉卡片，就能改變事情的狀態。</p>
        <button className="primary" onClick={() => setEditing(null)}>
          ＋ 新增待辦
        </button>
      </div>
      <div className="kanban">
        {columns.map(([status, label]) => (
          <section
            key={status}
            data-todo-status={status}
            className={dragPreview?.over === status ? "drag-over" : ""}
          >
            <header>
              <i
                className={`dot ${status === "doing" ? "purple" : status === "paused" ? "gold" : status === "done" ? "sage" : "gray"}`}
              ></i>
              <h3>{label}</h3>
              <b>{todos.filter((x) => x.status === status).length}</b>
              <button
                onClick={() =>
                  setEditing({
                    id: makeId("todo"),
                    title: "",
                    description: "",
                    status,
                    color: "purple",
                    dueDate: "",
                    startDate: "",
                    endDate: "",
                    position: 99,
                  })
                }
              >
                ＋
              </button>
            </header>
            <div className="todo-list">
              {todos
                .filter((x) => x.status === status)
                .sort((a, b) => a.position - b.position)
                .map((todo) => (
                  <article
                    key={todo.id}
                    className={`todo-card ${todo.color} ${status === "done" ? "completed" : ""}`}
                    onPointerDown={(e) => pointerDown(e, todo)}
                    onPointerMove={pointerMove}
                    onPointerUp={pointerUp}
                    onPointerCancel={pointerCancel}
                    onClick={() => {
                      if (dragged.current) {
                        dragged.current = false;
                        return;
                      }
                      setEditing(todo);
                    }}
                  >
                    <small>
                      {todo.startDate
                        ? `${todo.startDate}${todo.endDate && todo.endDate !== todo.startDate ? ` → ${todo.endDate}` : ""}`
                        : "沒有期限"}
                    </small>
                    <h4>{todo.title}</h4>
                    {todo.description && <p>{todo.description}</p>}
                    <footer>
                      <span>{statusName[status]}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(todo.id);
                        }}
                      >
                        刪除
                      </button>
                    </footer>
                  </article>
                ))}
            </div>
          </section>
        ))}
      </div>
      {dragPreview && (
        <div
          className="todo-drag-ghost"
          style={{ left: dragPreview.x + 14, top: dragPreview.y + 14 }}
        >
          {dragPreview.title}
        </div>
      )}
      {editing !== undefined && (
        <TodoEditor
          value={editing}
          onClose={() => setEditing(undefined)}
          onSave={(v) => {
            save(v);
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}
function TodoEditor({
  value,
  onClose,
  onSave,
}: {
  value: Todo | null;
  onClose: () => void;
  onSave: (v: Todo) => void;
}) {
  const [form, setForm] = useState<Todo>(
    value || {
      id: makeId("todo"),
      title: "",
      description: "",
      status: "todo",
      color: "purple",
      dueDate: "",
      startDate: "",
      endDate: "",
      position: 99,
    },
  );
  const validDates = Boolean(
    form.startDate && form.endDate && form.startDate <= form.endDate,
  );
  return (
    <Modal
      eyebrow="TO DO"
      title={value ? "編輯待辦" : "新增待辦"}
      onClose={onClose}
      footer={
        <>
          <span>請填標題、起始日與截止日</span>
          <button
            disabled={!form.title.trim() || !validDates}
            onClick={() =>
              onSave({
                ...form,
                title: form.title.trim(),
                dueDate: form.endDate || form.startDate || "",
              })
            }
          >
            儲存
          </button>
        </>
      }
    >
      <Field label="標題">
        <input
          autoFocus
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </Field>
      <Field label="描述">
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>
      <Field label="狀態">
        <select
          value={form.status}
          onChange={(e) =>
            setForm({ ...form, status: e.target.value as TodoStatus })
          }
        >
          {columns.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <div className="field-row">
        <Field label="起始日">
          <input
            type="date"
            value={form.startDate || form.dueDate || ""}
            onChange={(e) =>
              setForm({
                ...form,
                startDate: e.target.value,
                endDate: form.endDate || e.target.value,
              })
            }
          />
        </Field>
        <Field label="截止日">
          <input
            type="date"
            min={form.startDate || undefined}
            value={form.endDate || form.dueDate || ""}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          />
        </Field>
      </div>
      <Field label="顏色">
        <div className="color-picks">
          {colors.map((c) => (
            <button
              key={c}
              className={`${c} ${form.color === c ? "selected" : ""}`}
              onClick={() => setForm({ ...form, color: c })}
            />
          ))}
        </div>
      </Field>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function DiaryPage({
  state,
  setState,
  initialDate,
}: {
  state: AppState;
  setState: StateSetter;
  initialDate: string;
}) {
  const [date, setDate] = useState(initialDate);
  const [snippet, setSnippet] = useState("");
  const found = state.diaries.find((x) => x.date === date && !x.deletedAt);
  const entry: DiaryEntry = found || {
    date,
    title: "",
    body: "",
    snippets: [],
    updatedAt: new Date().toISOString(),
  };
  const save = (next: DiaryEntry) =>
    setState((s) => ({
      ...s,
      diaries: s.diaries.some((x) => x.date === date)
        ? s.diaries.map((x) => (x.date === date ? next : x))
        : [...s.diaries, next],
    }));
  const recent = state.diaries
    .filter((x) => !x.deletedAt)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);
  return (
    <div className="page diary-layout">
      <aside>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {recent.map((x) => (
          <button
            className={x.date === date ? "active" : ""}
            key={x.date}
            onClick={() => setDate(x.date)}
          >
            <b>{x.date.slice(-2)}</b>
            <span>
              {dateLabel(x.date)}
              <small>{x.snippets.length} 則碎念</small>
            </span>
          </button>
        ))}
      </aside>
      <article className="paper">
        <small>DAILY JOURNAL</small>
        <h2>{dateLabel(date)}</h2>
        <div className="snippets">
          {entry.snippets.map((x) => (
            <div key={x.id}>
              <time>{timeLabel(x.createdAt)}</time>
              <input
                value={x.text}
                onChange={(e) =>
                  save({
                    ...entry,
                    snippets: entry.snippets.map((s) =>
                      s.id === x.id ? { ...s, text: e.target.value } : s,
                    ),
                    updatedAt: new Date().toISOString(),
                  })
                }
              />
              <button
                aria-label="刪除碎念"
                onClick={() =>
                  save({
                    ...entry,
                    snippets: entry.snippets.filter((s) => s.id !== x.id),
                    updatedAt: new Date().toISOString(),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <form
          className="snippet-add"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!snippet.trim()) return;
            save({
              ...entry,
              snippets: [
                ...entry.snippets,
                {
                  id: makeId("snippet"),
                  text: snippet.trim(),
                  createdAt: new Date().toISOString(),
                },
              ],
              updatedAt: new Date().toISOString(),
            });
            setSnippet("");
          }}
        >
          <input
            value={snippet}
            onChange={(e) => setSnippet(e.target.value)}
            placeholder="留下一句碎念……"
          />
          <button aria-label="加入碎念" disabled={!snippet.trim()}>
            ＋
          </button>
        </form>
        <hr />
        <input
          className="entry-title"
          value={entry.title}
          onChange={(e) =>
            save({
              ...entry,
              title: e.target.value,
              updatedAt: new Date().toISOString(),
            })
          }
          placeholder="今天的標題"
        />
        <textarea
          className="entry-body"
          value={entry.body}
          onChange={(e) =>
            save({
              ...entry,
              body: e.target.value,
              updatedAt: new Date().toISOString(),
            })
          }
          placeholder="慢慢寫，不用一次寫完……"
        />
        {found && (
          <button
            className="danger-link"
            onClick={() =>
              setState((s) => ({
                ...s,
                diaries: s.diaries.map((x) =>
                  x.date === date
                    ? { ...x, deletedAt: new Date().toISOString() }
                    : x,
                ),
              }))
            }
          >
            將這天移到回收桶
          </button>
        )}
      </article>
    </div>
  );
}

function NotesPage({
  state,
  setState,
}: {
  state: AppState;
  setState: StateSetter;
}) {
  const activeNotes = state.notes.filter((x) => !x.deletedAt);
  const [noteId, setNoteId] = useState(activeNotes[0]?.id || "");
  const note = activeNotes.find((x) => x.id === noteId) || activeNotes[0];
  const [sectionId, setSectionId] = useState(note?.sections[0]?.id || "");
  const section =
    note?.sections.find((x) => x.id === sectionId) || note?.sections[0];
  const update = (next: Note) =>
    setState((s) => ({
      ...s,
      notes: s.notes.map((x) =>
        x.id === next.id ? { ...next, updatedAt: new Date().toISOString() } : x,
      ),
    }));
  const addNote = () => {
    const n: Note = {
      id: makeId("note"),
      title: "未命名筆記",
      folder: "我的筆記",
      updatedAt: new Date().toISOString(),
      sections: [
        { id: makeId("section"), title: "第一章", body: "", assets: [] },
      ],
    };
    setState((s) => ({ ...s, notes: [...s.notes, n] }));
    setNoteId(n.id);
    setSectionId(n.sections[0].id);
  };
  if (!note)
    return (
      <div className="page">
        <Empty text="還沒有筆記" />
        <button className="primary" onClick={addNote}>
          新增第一篇筆記
        </button>
      </div>
    );
  return (
    <div className="page notes-layout">
      <aside>
        <div className="aside-head">
          <strong>我的筆記</strong>
          <button aria-label="新增筆記" onClick={addNote}>
            ＋
          </button>
        </div>
        {activeNotes.map((n) => (
          <button
            className={n.id === note.id ? "active" : ""}
            key={n.id}
            onClick={() => {
              setNoteId(n.id);
              setSectionId(n.sections[0]?.id || "");
            }}
          >
            <strong>{n.title}</strong>
            <small>{n.sections.length} 個章節</small>
          </button>
        ))}
      </aside>
      <article>
        <div className="note-meta">
          <input
            aria-label="筆記分類"
            value={note.folder}
            onChange={(e) => update({ ...note, folder: e.target.value })}
          />
          <button
            onClick={() =>
              setState((s) => ({
                ...s,
                notes: s.notes.map((x) =>
                  x.id === note.id
                    ? { ...x, deletedAt: new Date().toISOString() }
                    : x,
                ),
              }))
            }
          >
            移到回收桶
          </button>
        </div>
        <input
          aria-label="筆記名稱"
          className="note-title"
          value={note.title}
          onChange={(e) => update({ ...note, title: e.target.value })}
        />
        <div className="tabs">
          {note.sections.map((s) => (
            <button
              className={s.id === section?.id ? "active" : ""}
              key={s.id}
              onClick={() => setSectionId(s.id)}
            >
              {s.title}
            </button>
          ))}
          <button
            aria-label="新增章節"
            onClick={() => {
              const s = {
                id: makeId("section"),
                title: `第 ${note.sections.length + 1} 章`,
                body: "",
                assets: [],
                blocks: [{ id: makeId("block"), type: "paragraph" as const, content: "" }],
              };
              update({ ...note, sections: [...note.sections, s] });
              setSectionId(s.id);
            }}
          >
            ＋
          </button>
        </div>
        {section && (
          <div className="note-work">
            <aside className="toc">
              <strong>本章目錄</strong>
              {note.sections.map((s) => (
                <button
                  className={s.id === section.id ? "active" : ""}
                  key={s.id}
                  onClick={() => setSectionId(s.id)}
                >
                  {s.title}
                </button>
              ))}
            </aside>
            <div>
              <input
                aria-label="章節名稱"
                className="section-title"
                value={section.title}
                onChange={(e) =>
                  update({
                    ...note,
                    sections: note.sections.map((s) =>
                      s.id === section.id ? { ...s, title: e.target.value } : s,
                    ),
                  })
                }
              />
              <NoteCanvas
                blocks={section.blocks || []}
                onChange={(blocks) =>
                  update({
                    ...note,
                    sections: note.sections.map((s) =>
                      s.id === section.id ? { ...s, blocks } : s,
                    ),
                  })
                }
              />
              <button
                className="danger-link"
                disabled={note.sections.length === 1}
                onClick={() => {
                  const rest = note.sections.filter((s) => s.id !== section.id);
                  update({ ...note, sections: rest });
                  setSectionId(rest[0].id);
                }}
              >
                刪除本章
              </button>
            </div>
          </div>
        )}
      </article>
    </div>
  );
}

function InboxPage({
  state,
  setState,
}: {
  state: AppState;
  setState: StateSetter;
}) {
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState("");
  const inboxDrag = useRef<{
    id: string;
    startY: number;
    active: boolean;
  } | null>(null);
  const items = state.inbox
    .filter((x) => !x.deletedAt)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const reorder = (fromId: string, toId: string) =>
    setState((current) => {
      const ordered = current.inbox
        .filter((x) => !x.deletedAt)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const from = ordered.findIndex((x) => x.id === fromId),
        to = ordered.findIndex((x) => x.id === toId);
      if (from < 0 || to < 0 || from === to) return current;
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      return {
        ...current,
        inbox: current.inbox.map((x) => {
          const position = ordered.findIndex((item) => item.id === x.id);
          return position < 0 ? x : { ...x, position };
        }),
      };
    });
  const remove = (id: string) =>
    setState((s) => ({
      ...s,
      inbox: s.inbox.map((x) =>
        x.id === id ? { ...x, deletedAt: new Date().toISOString() } : x,
      ),
    }));
  const convert = (id: string, type: "todo" | "diary") =>
    setState((s) => {
      const item = s.inbox.find((x) => x.id === id)!;
      return type === "todo"
        ? {
            ...s,
            inbox: s.inbox.map((x) =>
              x.id === id ? { ...x, deletedAt: new Date().toISOString() } : x,
            ),
            todos: [
              ...s.todos,
              {
                id: makeId("todo"),
                title: item.text,
                description: "",
                status: "todo",
                color: "purple",
                dueDate: "",
                position: 99,
              },
            ],
          }
        : {
            ...s,
            inbox: s.inbox.map((x) =>
              x.id === id ? { ...x, deletedAt: new Date().toISOString() } : x,
            ),
            diaries: s.diaries.some((x) => x.date === todayKey)
              ? s.diaries.map((x) =>
                  x.date === todayKey
                    ? {
                        ...x,
                        snippets: [
                          ...x.snippets,
                          {
                            id: makeId("snippet"),
                            text: item.text,
                            createdAt: new Date().toISOString(),
                          },
                        ],
                      }
                    : x,
                )
              : [
                  ...s.diaries,
                  {
                    date: todayKey,
                    title: "",
                    body: "",
                    updatedAt: new Date().toISOString(),
                    snippets: [
                      {
                        id: makeId("snippet"),
                        text: item.text,
                        createdAt: new Date().toISOString(),
                      },
                    ],
                  },
                ],
          };
    });
  return (
    <div className="page inbox-page">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          setState((s) => ({
            ...s,
            inbox: [
              {
                id: makeId("inbox"),
                text: text.trim(),
                createdAt: new Date().toISOString(),
                position: 0,
              },
              ...s.inbox.map((item) => ({
                ...item,
                position: (item.position ?? 0) + 1,
              })),
            ],
          }));
          setText("");
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="先丟進來，之後再整理……"
        />
        <button disabled={!text.trim()}>加入收集箱</button>
      </form>
      <div className="inbox-items">
        {items.map((x) => (
          <article key={x.id} data-inbox-sort={x.id}>
            <span
              className="sort-handle"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                inboxDrag.current = {
                  id: x.id,
                  startY: event.clientY,
                  active: false,
                };
              }}
              onPointerMove={(event) => {
                if (!inboxDrag.current) return;
                if (Math.abs(event.clientY - inboxDrag.current.startY) > 5)
                  inboxDrag.current.active = true;
              }}
              onPointerUp={(event) => {
                const drag = inboxDrag.current;
                const target = document
                  .elementFromPoint(event.clientX, event.clientY)
                  ?.closest<HTMLElement>("[data-inbox-sort]")
                  ?.dataset.inboxSort;
                inboxDrag.current = null;
                if (drag?.active && target) reorder(drag.id, target);
              }}
            >
              ⋮⋮
            </span>
            <div>
              {editingId === x.id ? (
                <textarea
                  className="inbox-edit-area"
                  autoFocus
                  value={x.text}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      inbox: current.inbox.map((item) =>
                        item.id === x.id
                          ? { ...item, text: event.target.value }
                          : item,
                      ),
                    }))
                  }
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") setEditingId("");
                  }}
                />
              ) : (
                <strong>{x.text}</strong>
              )}
              <small>{new Date(x.createdAt).toLocaleString("zh-TW")}</small>
            </div>
            <div>
              <button
                onClick={() => setEditingId(editingId === x.id ? "" : x.id)}
              >
                {editingId === x.id ? "完成" : "編輯"}
              </button>
              <button onClick={() => convert(x.id, "todo")}>轉待辦</button>
              <button onClick={() => convert(x.id, "diary")}>轉日記</button>
              <button onClick={() => remove(x.id)}>刪除</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function TrashPage({
  state,
  setState,
}: {
  state: AppState;
  setState: StateSetter;
}) {
  const rows = [
    ...state.calendarItems
      .filter((x) => x.deletedAt)
      .map((x) => ({
        kind: "calendarItems" as const,
        id: x.id,
        title: x.title,
        type: "月曆",
      })),
    ...state.todos
      .filter((x) => x.deletedAt)
      .map((x) => ({
        kind: "todos" as const,
        id: x.id,
        title: x.title,
        type: "待辦",
      })),
    ...state.diaries
      .filter((x) => x.deletedAt)
      .map((x) => ({
        kind: "diaries" as const,
        id: x.date,
        title: x.title || x.date,
        type: "日記",
      })),
    ...state.notes
      .filter((x) => x.deletedAt)
      .map((x) => ({
        kind: "notes" as const,
        id: x.id,
        title: x.title,
        type: "筆記",
      })),
    ...state.albums
      .filter((x) => x.deletedAt)
      .map((x) => ({
        kind: "albums" as const,
        id: x.id,
        title: x.title,
        type: "相簿",
      })),
    ...state.photos
      .filter((x) => x.deletedAt)
      .map((x) => ({
        kind: "photos" as const,
        id: x.id,
        title: x.title,
        type: "相片",
      })),
    ...state.inbox
      .filter((x) => x.deletedAt)
      .map((x) => ({
        kind: "inbox" as const,
        id: x.id,
        title: x.text,
        type: "收集箱",
      })),
  ];
  type Kind = (typeof rows)[number]["kind"];
  const restore = (kind: Kind, id: string) =>
    setState((s) => {
      switch (kind) {
        case "calendarItems":
          return {
            ...s,
            calendarItems: s.calendarItems.map((x) =>
              x.id === id ? { ...x, deletedAt: undefined } : x,
            ),
          };
        case "todos":
          return {
            ...s,
            todos: s.todos.map((x) =>
              x.id === id ? { ...x, deletedAt: undefined } : x,
            ),
          };
        case "diaries":
          return {
            ...s,
            diaries: s.diaries.map((x) =>
              x.date === id ? { ...x, deletedAt: undefined } : x,
            ),
          };
        case "notes":
          return {
            ...s,
            notes: s.notes.map((x) =>
              x.id === id ? { ...x, deletedAt: undefined } : x,
            ),
          };
        case "albums":
          return {
            ...s,
            albums: s.albums.map((x) =>
              x.id === id ? { ...x, deletedAt: undefined } : x,
            ),
          };
        case "photos":
          return {
            ...s,
            photos: s.photos.map((x) =>
              x.id === id ? { ...x, deletedAt: undefined } : x,
            ),
          };
        case "inbox":
          return {
            ...s,
            inbox: s.inbox.map((x) =>
              x.id === id ? { ...x, deletedAt: undefined } : x,
            ),
          };
      }
    });
  const purge = (kind: Kind, id: string) => {
    if (!confirm("確定永久刪除？這個動作無法復原。")) return;
    if (kind === "photos") {
      const media = state.photos.find((item) => item.id === id);
      if (media) void removeMediaFiles(media);
    }
    if (kind === "albums") {
      state.photos
        .filter((item) => item.albumId === id)
        .forEach((item) => void removeMediaFiles(item));
    }
    setState((s) => {
      switch (kind) {
        case "calendarItems":
          return {
            ...s,
            calendarItems: s.calendarItems.filter((x) => x.id !== id),
          };
        case "todos":
          return { ...s, todos: s.todos.filter((x) => x.id !== id) };
        case "diaries":
          return { ...s, diaries: s.diaries.filter((x) => x.date !== id) };
        case "notes":
          return { ...s, notes: s.notes.filter((x) => x.id !== id) };
        case "albums":
          return {
            ...s,
            albums: s.albums.filter((x) => x.id !== id),
            photos: s.photos.filter((x) => x.albumId !== id),
          };
        case "photos":
          return { ...s, photos: s.photos.filter((x) => x.id !== id) };
        case "inbox":
          return { ...s, inbox: s.inbox.filter((x) => x.id !== id) };
      }
    });
  };
  return (
    <div className="page trash-page">
      {rows.length ? (
        rows.map((x) => (
          <article key={`${x.kind}-${x.id}`}>
            <span>{x.type}</span>
            <strong>{x.title}</strong>
            <div>
              <button onClick={() => restore(x.kind, x.id)}>復原</button>
              <button className="purge" onClick={() => purge(x.kind, x.id)}>
                永久刪除
              </button>
            </div>
          </article>
        ))
      ) : (
        <Empty text="回收桶是空的。很好，沒有東西在哭。" />
      )}
    </div>
  );
}

function SettingsPage({
  state,
  setState,
  dataDirectory,
  changeDataDirectory,
}: {
  state: AppState;
  setState: StateSetter;
  dataDirectory: string;
  changeDataDirectory: (path: string) => Promise<void>;
}) {
  const settings = state.settings;
  const [path, setPath] = useState(dataDirectory);
  const [pathMessage, setPathMessage] = useState("");
  const [backupPath, setBackupPath] = useState(settings.backupDirectory);
  const [restorePath, setRestorePath] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text()) as AppState;
      if (
        !Array.isArray(value.todos) ||
        !Array.isArray(value.notes) ||
        !value.settings
      )
        throw new Error("invalid");
      if (confirm("匯入會取代目前資料，確定繼續嗎？"))
        setState((current) => ({
          ...current,
          ...value,
          birthdays: value.birthdays || [],
          holidays: value.holidays || current.holidays,
          albums: value.albums || current.albums,
          photos: value.photos || [],
          recurringEvents: value.recurringEvents || [],
          ledgerEntries: value.ledgerEntries || [],
          ledgerCategories: value.ledgerCategories || [],
          settings: { ...current.settings, ...value.settings },
        }));
    } catch {
      alert("這不是有效的月光簿備份檔。");
    }
  };
  return (
    <div className="page settings-grid">
      <Panel title="個人化">
        <Field label="使用者名稱">
          <input
            aria-label="使用者名稱"
            placeholder="希望月光簿怎麼稱呼你？"
            value={settings.userName}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                settings: { ...s.settings, userName: e.target.value },
              }))
            }
          />
        </Field>
        <p className="setting-hint">名稱只保存在你的電腦上，也可以隨時修改。</p>
      </Panel>
      <Panel title="外觀">
        <Field label="主題">
          <select
            value={settings.theme}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                settings: {
                  ...s.settings,
                  theme: e.target.value as "light" | "dark",
                },
              }))
            }
          >
            <option value="light">淺色</option>
            <option value="dark">深色</option>
          </select>
        </Field>
      </Panel>
      <Panel title="月光精靈">
        <Field label="顯示">
          <input
            type="checkbox"
            checked={settings.showMoon}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                settings: { ...s.settings, showMoon: e.target.checked },
              }))
            }
          />
        </Field>
        <Field label="尺寸">
          <input
            type="range"
            min="64"
            max="120"
            value={settings.moonSize}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                settings: { ...s.settings, moonSize: Number(e.target.value) },
              }))
            }
          />
        </Field>
        <Field label="Windows 桌面寵物">
          <input
            type="checkbox"
            checked={settings.showDesktopPet}
            onChange={(e) => {
              const visible = e.target.checked;
              setState((s) => ({
                ...s,
                settings: { ...s.settings, showDesktopPet: visible },
              }));
              void setDesktopPetVisible(visible);
            }}
          />
        </Field>
        <Field label="自訂聊天網址">
          <input
            placeholder="例如：https://chatgpt.com/"
            value={settings.chatUrl}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                settings: { ...s.settings, chatUrl: e.target.value },
              }))
            }
          />
        </Field>
        <p className="setting-hint">
          選填。點擊 App 內的月光精靈時，會在瀏覽器開啟這個網址。
        </p>
      </Panel>
      <Panel title="資料與備份">
        <p className="muted">
          正式桌面版會把記錄保存到 SQLite，照片與影片原檔放在同一資料位置的
          media 資料夾；瀏覽器預覽使用 localStorage。
        </p>
        <div className="backup-actions">
          <button className="secondary" onClick={() => exportState(state)}>
            匯出 JSON 記錄備份
          </button>
          <label className="secondary">
            匯入備份
            <input
              hidden
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                void importBackup(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="muted">
          JSON 只包含記錄與相簿索引；完整備份時也要保留 media 資料夾。
        </p>
        <div className="full-backup-box">
          <Field label="完整備份位置">
            <input
              value={backupPath}
              disabled={!window.__TAURI_INTERNALS__}
              onChange={(e) => setBackupPath(e.target.value)}
              placeholder="請選擇或輸入備份資料夾"
            />
          </Field>
          <button
            className="primary"
            disabled={!window.__TAURI_INTERNALS__ || !backupPath.trim()}
            onClick={async () => {
              try {
                setBackupMessage("正在完整備份……");
                setState((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    backupDirectory: backupPath.trim(),
                  },
                }));
                const stateForBackup = {
                  ...state,
                  settings: {
                    ...state.settings,
                    backupDirectory: backupPath.trim(),
                  },
                };
                const saved = await createFullBackup(
                  stateForBackup,
                  backupPath,
                );
                setBackupMessage(`✓ 備份完成：${saved}`);
              } catch {
                setBackupMessage("備份失敗；請確認隨身硬碟已連接並可以寫入。");
              }
            }}
          >
            立即完整備份
          </button>
          <details>
            <summary>從完整備份還原</summary>
            <Field label="備份資料夾">
              <input
                value={restorePath}
                disabled={!window.__TAURI_INTERNALS__}
                onChange={(e) => setRestorePath(e.target.value)}
                placeholder="貼上某一份月光簿完整備份路徑"
              />
            </Field>
            <button
              className="danger"
              disabled={!window.__TAURI_INTERNALS__ || !restorePath.trim()}
              onClick={async () => {
                if (
                  !confirm(
                    "還原會取代目前資料；月光簿會先自動保留還原前備份。確定繼續嗎？",
                  )
                )
                  return;
                try {
                  setBackupMessage("正在安全還原……");
                  const safety = await restoreFullBackup(restorePath);
                  alert(`還原完成，還原前資料保存於：${safety}`);
                  location.reload();
                } catch {
                  setBackupMessage("還原失敗，現有資料沒有被刪除。");
                }
              }}
            >
              開始還原
            </button>
          </details>
          {backupMessage && <p className="path-message">{backupMessage}</p>}
        </div>
        <Field label="資料位置">
          <input
            value={path}
            disabled={!window.__TAURI_INTERNALS__}
            onChange={(e) => setPath(e.target.value)}
            placeholder="請選擇或輸入資料儲存位置"
          />
        </Field>
        <button
          className="secondary"
          disabled={
            !window.__TAURI_INTERNALS__ || path.trim() === dataDirectory
          }
          onClick={async () => {
            try {
              await changeDataDirectory(path);
              setPathMessage("✓ 已搬到新位置，原資料仍保留作為安全備份");
            } catch {
              setPathMessage("無法使用這個位置，請確認磁碟存在且可以寫入。");
            }
          }}
        >
          套用並複製目前資料
        </button>
        {pathMessage && <p className="path-message">{pathMessage}</p>}
      </Panel>
      <Panel title="隱私">
        <p className="muted">
          月光簿不會自動把日記、筆記或待辦傳送到
          ChatGPT。只有你點擊月光精靈時，才會開啟設定的網址。
        </p>
      </Panel>
      <Panel title="鍵盤快捷鍵">
        <div className="shortcut-list">
          <span>
            <kbd>Ctrl</kbd> + <kbd>N</kbd>
            <b>快速記錄</b>
          </span>
          <span>
            <kbd>Ctrl</kbd> + <kbd>F</kbd>
            <b>搜尋</b>
          </span>
          <span>
            <kbd>Ctrl</kbd> + <kbd>S</kbd>
            <b>立即儲存</b>
          </span>
          <span>
            <kbd>Ctrl</kbd> + <kbd>1–9</kbd>
            <b>切換功能</b>
          </span>
          <span>
            <kbd>Esc</kbd>
            <b>關閉快速視窗</b>
          </span>
        </div>
      </Panel>
    </div>
  );
}

function QuickCapture({
  onClose,
  setState,
}: {
  onClose: () => void;
  setState: StateSetter;
}) {
  const [text, setText] = useState("");
  const [type, setType] = useState<"inbox" | "todo" | "diary">("inbox");
  const save = () => {
    if (!text.trim()) return;
    setState((s) =>
      type === "inbox"
        ? {
            ...s,
            inbox: [
              {
                id: makeId("inbox"),
                text: text.trim(),
                createdAt: new Date().toISOString(),
              },
              ...s.inbox,
            ],
          }
        : type === "todo"
          ? {
              ...s,
              todos: [
                ...s.todos,
                {
                  id: makeId("todo"),
                  title: text.trim(),
                  description: "",
                  status: "todo",
                  color: "purple",
                  dueDate: "",
                  position: 99,
                },
              ],
            }
          : {
              ...s,
              diaries: s.diaries.some((x) => x.date === todayKey)
                ? s.diaries.map((x) =>
                    x.date === todayKey
                      ? {
                          ...x,
                          snippets: [
                            ...x.snippets,
                            {
                              id: makeId("snippet"),
                              text: text.trim(),
                              createdAt: new Date().toISOString(),
                            },
                          ],
                        }
                      : x,
                  )
                : [
                    ...s.diaries,
                    {
                      date: todayKey,
                      title: "",
                      body: "",
                      updatedAt: new Date().toISOString(),
                      snippets: [
                        {
                          id: makeId("snippet"),
                          text: text.trim(),
                          createdAt: new Date().toISOString(),
                        },
                      ],
                    },
                  ],
            },
    );
    onClose();
  };
  return (
    <Modal
      eyebrow="QUICK CAPTURE"
      title="先記下來"
      onClose={onClose}
      footer={
        <>
          <span>不用先整理</span>
          <button disabled={!text.trim()} onClick={save}>
            儲存
          </button>
        </>
      }
    >
      <textarea
        autoFocus
        className="capture-area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="碎念、靈感、網址……什麼都可以"
      />
      <div className="type-tabs">
        {(["inbox", "todo", "diary"] as const).map((x) => (
          <button
            className={type === x ? "active" : ""}
            key={x}
            onClick={() => setType(x)}
          >
            {x === "inbox" ? "⌑ 收集箱" : x === "todo" ? "✓ 待辦" : "✎ 日記"}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function Search({
  state,
  onClose,
  setPage,
}: {
  state: AppState;
  onClose: () => void;
  setPage: (p: PageName) => void;
}) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("全部");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("全部");
  const [hasImage, setHasImage] = useState(false);
  const results = useMemo(() => {
    const hasCriteria =
      q.trim() ||
      type !== "全部" ||
      from ||
      to ||
      status !== "全部" ||
      hasImage;
    if (!hasCriteria) return [];
    const find = (v: string) =>
      !q.trim() || v.toLowerCase().includes(q.toLowerCase());
    const raw = [
      ...state.todos
        .filter((x) => !x.deletedAt && (find(x.title) || find(x.description)))
        .map((x) => ({
          type: "待辦",
          title: x.title,
          page: "todo" as PageName,
          date: x.dueDate,
          status: x.status,
          hasImage: false,
        })),
      ...state.calendarItems
        .filter((x) => !x.deletedAt && find(x.title))
        .map((x) => ({
          type: "月曆",
          title: x.title,
          page: "calendar" as PageName,
          date: x.date,
          status: "",
          hasImage: false,
        })),
      ...state.diaries
        .filter(
          (x) =>
            !x.deletedAt &&
            (find(x.title) ||
              find(x.body) ||
              x.snippets.some((s) => find(s.text))),
        )
        .map((x) => ({
          type: "日記",
          title: x.title || x.date,
          page: "diary" as PageName,
          date: x.date,
          status: "",
          hasImage: false,
        })),
      ...state.notes
        .filter(
          (x) =>
            !x.deletedAt &&
            (find(x.title) ||
              x.sections.some((s) => find(s.title) || find(s.body))),
        )
        .map((x) => ({
          type: "筆記",
          title: x.title,
          page: "notes" as PageName,
          date: x.updatedAt.slice(0, 10),
          status: "",
          hasImage: x.sections.some((section) =>
            Boolean(section.assets?.length),
          ),
        })),
      ...state.inbox
        .filter((x) => !x.deletedAt && find(x.text))
        .map((x) => ({
          type: "收集箱",
          title: x.text,
          page: "inbox" as PageName,
          date: x.createdAt.slice(0, 10),
          status: "",
          hasImage: false,
        })),
      ...state.photos
        .filter(
          (x) =>
            !x.deletedAt &&
            (find(x.title) || find(x.caption) || (x.tags || []).some(find)),
        )
        .map((x) => ({
          type: "相簿",
          title: x.title || x.originalName || "未命名回憶",
          page: "albums" as PageName,
          date: x.takenDate,
          status: "",
          hasImage: true,
        })),
    ];
    return raw.filter(
      (item) =>
        (type === "全部" || item.type === type) &&
        (!from || Boolean(item.date && item.date >= from)) &&
        (!to || Boolean(item.date && item.date <= to)) &&
        (status === "全部" || item.status === status) &&
        (!hasImage || item.hasImage),
    );
  }, [from, hasImage, q, state, status, to, type]);
  const searching = Boolean(
    q.trim() || type !== "全部" || from || to || status !== "全部" || hasImage,
  );
  return (
    <Modal title="搜尋所有記錄" onClose={onClose}>
      <input
        autoFocus
        className="search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="輸入關鍵字……"
      />
      <div className="search-filters">
        <select
          aria-label="內容類型"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {["全部", "待辦", "月曆", "日記", "筆記", "相簿", "收集箱"].map(
            (value) => (
              <option key={value}>{value}</option>
            ),
          )}
        </select>
        <input
          aria-label="起始日期"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          aria-label="結束日期"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <select
          aria-label="待辦狀態"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="全部">全部狀態</option>
          <option value="todo">待辦</option>
          <option value="doing">進行中</option>
          <option value="paused">暫停</option>
          <option value="done">完成</option>
        </select>
        <label className="check-line">
          <input
            type="checkbox"
            checked={hasImage}
            onChange={(e) => setHasImage(e.target.checked)}
          />
          <span>含圖片</span>
        </label>
      </div>
      <div className="search-results">
        {searching && !results.length ? (
          <Empty text="沒有找到符合的記錄" />
        ) : (
          results.map((r, i) => (
            <button
              key={i}
              onClick={() => {
                setPage(r.page);
                onClose();
              }}
            >
              <small>{r.type}</small>
              <span>{r.title}</span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}

function FloatingSpirit({
  state,
  setState,
}: {
  state: AppState;
  setState: StateSetter;
}) {
  const s = state.settings;
  const [drag, setDrag] = useState<{
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);
  if (!s.showMoon) return null;
  const pointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false });
  };
  const pointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const x = Math.max(
        5,
        Math.min(innerWidth - s.moonSize, e.clientX - drag.dx),
      ),
      y = Math.max(
        5,
        Math.min(innerHeight - s.moonSize - 20, e.clientY - drag.dy),
      );
    setDrag({ ...drag, moved: true });
    setState((st) => ({
      ...st,
      settings: {
        ...st.settings,
        moonPosition: { x: x / innerWidth, y: y / innerHeight },
      },
    }));
  };
  const pointerUp = async () => {
    if (drag && !drag.moved && s.chatUrl.trim()) {
      try {
        if (window.__TAURI_INTERNALS__) {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(s.chatUrl);
        } else window.open(s.chatUrl, "_blank", "noopener");
      } catch (e) {
        console.error(e);
      }
    }
    setDrag(null);
  };
  return (
    <button
      aria-label="找月光精靈聊聊"
      className="floating-moon"
      style={{
        width: s.moonSize,
        height: s.moonSize + 18,
        left: `${s.moonPosition.x * 100}%`,
        top: `${s.moonPosition.y * 100}%`,
      }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
    >
      <i className="spirit-orb">
        <i className="spirit-crescent"></i>
        <i className="spirit-eye left"></i>
        <i className="spirit-eye right"></i>
        <i className="spirit-smile"></i>
      </i>
      <span>✦</span>
      <small>月光精靈</small>
    </button>
  );
}

export default function App() {
  const {
    state,
    setState,
    ready,
    saveStatus,
    dataDirectory,
    changeDataDirectory,
  } = useAppState();
  const [page, setPage] = useState<PageName>("today");
  const [diaryDate, setDiaryDate] = useState(todayKey);
  const [capture, setCapture] = useState(false);
  const [search, setSearch] = useState(false);
  const [profileName, setProfileName] = useState("");
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCapture(false);
        setSearch(false);
        return;
      }
      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === "f" || key === "k") {
        event.preventDefault();
        setSearch(true);
      } else if (key === "n") {
        event.preventDefault();
        setCapture(true);
      } else if (key === "s") {
        event.preventDefault();
        void saveState(state);
      } else if (/^[1-9]$/.test(key) && nav[Number(key) - 1]) {
        event.preventDefault();
        setPage(nav[Number(key) - 1][0]);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [state]);
  const trashCount =
    state.calendarItems.filter((x) => x.deletedAt).length +
    state.recurringEvents.filter((x) => x.deletedAt).length +
    state.todos.filter((x) => x.deletedAt).length +
    state.diaries.filter((x) => x.deletedAt).length +
    state.notes.filter((x) => x.deletedAt).length +
    state.albums.filter((x) => x.deletedAt).length +
    state.photos.filter((x) => x.deletedAt).length +
    state.ledgerEntries.filter((x) => x.deletedAt).length +
    state.inbox.filter((x) => x.deletedAt).length;
  if (!ready)
    return (
      <div className="loading">
        ☾<span>月光正在整理房間……</span>
      </div>
    );
  const openDiary = (date: string) => {
    setDiaryDate(date);
    setPage("diary");
  };
  const content =
    page === "today" ? (
      <Today
        state={state}
        setPage={setPage}
        onCapture={() => setCapture(true)}
      />
    ) : page === "calendar" ? (
      <CalendarPage state={state} setState={setState} openDiary={openDiary} />
    ) : page === "todo" ? (
      <TodoPage state={state} setState={setState} />
    ) : page === "diary" ? (
      <DiaryPage
        key={diaryDate}
        state={state}
        setState={setState}
        initialDate={diaryDate}
      />
    ) : page === "notes" ? (
      <NotesWorkspace state={state} setState={setState} />
    ) : page === "albums" ? (
      <AlbumPage
        state={state}
        setState={setState}
        openDiary={openDiary}
        dataDirectory={dataDirectory}
      />
    ) : page === "ledger" ? (
      <LedgerPage state={state} setState={setState} />
    ) : page === "vault" ? (
      <VaultPage state={state} setState={setState} />
    ) : page === "inbox" ? (
      <InboxPage state={state} setState={setState} />
    ) : page === "trash" ? (
      <TrashPageNew state={state} setState={setState} />
    ) : (
      <SettingsPage
        state={state}
        setState={setState}
        dataDirectory={dataDirectory}
        changeDataDirectory={changeDataDirectory}
      />
    );
  return (
    <div className={`app ${state.settings.theme}`}>
      <Sidebar
        page={page}
        setPage={setPage}
        inboxCount={state.inbox.filter((x) => !x.deletedAt).length}
        trashCount={trashCount}
        onCapture={() => setCapture(true)}
      />
      <main>
        <header className="topbar">
          <div>
            <small>{pageMeta[page][1]}</small>
            <h1>{pageMeta[page][0]}</h1>
          </div>
          <div>
            <span className={`save ${saveStatus}`}>
              {saveStatus === "saved"
                ? "✓ 已儲存"
                : saveStatus === "saving"
                  ? "儲存中…"
                  : "儲存失敗"}
            </span>
            <button aria-label="搜尋" onClick={() => setSearch(true)}>
              ⌕
            </button>
          </div>
        </header>
        {content}
      </main>
      <FloatingSpirit state={state} setState={setState} />
      {capture && (
        <QuickCapture onClose={() => setCapture(false)} setState={setState} />
      )}{" "}
      {search && (
        <Search
          state={state}
          onClose={() => setSearch(false)}
          setPage={setPage}
        />
      )}
      {!state.settings.setupCompleted && (
        <Modal
          title="歡迎來到月光簿"
          eyebrow="FIRST SETUP"
          onClose={() =>
            setState((current) => ({
              ...current,
              settings: { ...current.settings, setupCompleted: true },
            }))
          }
          footer={
            <>
              <button
                className="secondary"
                onClick={() =>
                  setState((current) => ({
                    ...current,
                    settings: { ...current.settings, setupCompleted: true },
                  }))
                }
              >
                稍後再設定
              </button>
              <button
                className="primary"
                disabled={!profileName.trim()}
                onClick={() =>
                  setState((current) => ({
                    ...current,
                    settings: {
                      ...current.settings,
                      userName: profileName.trim(),
                      setupCompleted: true,
                    },
                  }))
                }
              >
                開始使用
              </button>
            </>
          }
        >
          <p>希望月光簿怎麼稱呼你？之後可以在設定中修改。</p>
          <Field label="顯示名稱">
            <input
              autoFocus
              aria-label="首次設定名稱"
              placeholder="輸入你的名稱或暱稱"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
            />
          </Field>
        </Modal>
      )}
    </div>
  );
}
