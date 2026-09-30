import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  createFullBackup,
  exportState,
  normalizeState,
  removeMediaFiles,
  mediaSource,
  restoreFullBackup,
  saveState,
  storeMedia,
  setDesktopPetVisible,
  resolvePetAppearance,
  storePetAppearance,
} from "./data/repository";
import { inspectPetAppearanceFile } from "./data/petAppearance";
import { prepareMedia } from "./data/media";
import { birthdayOnDate, dateKey, lunarInfo } from "./data/calendar";
import {
  makeId,
  todayKey,
  type Album,
  type AlbumPhoto,
  type AppState,
  type CalendarItem,
  type DiaryEntry,
  type InboxAttachment,
  type Note,
  type PageName,
  type RecurrenceFrequency,
  type RecurrenceRuleSegment,
  type TodoKind,
  type Todo,
  type TodoStatus,
} from "./data/types";
import {
  addRuleFromDate,
  changeTodoStatus,
  getRuleForDate,
  getMultiDayCompletedCount,
  getMultiDayLength,
  getTodoCalendarEntries,
  isMultiDayTodo,
  prepareTodoForSave,
  promoteDueTodos,
  toggleTodoCompletion,
} from "./data/todos";
import { useAppState } from "./data/useAppState";
import { clampFloatingMoonPosition } from "./data/floatingMoon";
import SpritePetApp from "./SpritePetApp";
import { nearestPaletteId, palette, paletteItem, paletteStyle, type PaletteId } from "./data/colors";
import NoteCanvas from "./components/NoteCanvas";
import AlbumPage from "./components/AlbumPage";
import CalendarDataModal from "./components/CalendarDataModal";
import VaultPage from "./components/VaultPage";
import { unlockVault } from "./data/vault";
import LedgerPage from "./components/LedgerPage";
import NotesWorkspace from "./components/NotesWorkspace";
import RichTextEditor from "./components/RichTextEditor";
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
  calendar: ["行事曆", "安排與回看每一天"],
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
  ["calendar", "▦", "行事曆"],
  ["todo", "✓", "待辦事項"],
  ["diary", "✎", "日記"],
  ["notes", "▤", "筆記"],
  ["albums", "▧", "相簿"],
  ["ledger", "$", "記帳"],
  ["vault", "🔐", "密碼保管庫"],
  ["inbox", "✧", "收集箱"],
  ["trash", "♲", "回收桶"],
];

type StateSetter = Dispatch<SetStateAction<AppState>>;

const dailyMoonNotes = [
  ["今天不用很厲害", "有記下一點點，就已經替未來的自己留下光了。"],
  ["慢一點也沒關係", "你正在走的路，會把今天的努力帶到未來。"],
  ["留一點空白給自己", "休息不是停下來，是讓心重新有力氣。"],
  ["小小完成也值得", "每一個勾起來的瞬間，都是你照顧自己的證明。"],
  ["今天也有好好生活", "不必把所有事做完，願意開始就很珍貴。"],
  ["把心放回當下", "窗外的光、手邊的事，都是此刻溫柔的提醒。"],
  ["你已經比昨天更靠近了", "不急著抵達，沿途留下的足跡也很閃亮。"],
] as const;
const dayOfYear = (value: Date) => {
  const start = new Date(value.getFullYear(), 0, 1);
  return Math.floor((value.getTime() - start.getTime()) / 86400000);
};
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
  className = "",
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
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
        className={`modal ${className}`.trim()}
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
  open,
  setOpen,
}: {
  page: PageName;
  setPage: (p: PageName) => void;
  inboxCount: number;
  trashCount: number;
  onCapture: () => void;
  open: boolean;
  setOpen: (value: boolean) => void;
}) {
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const scheduleOpen = () => {
    window.clearTimeout(closeTimer.current);
    if (open) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), 120);
  };
  const scheduleClose = () => {
    window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 360);
  };
  useEffect(() => () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);
  return (
    <>
    <div className="sidebar-edge-trigger" aria-hidden="true" onMouseEnter={scheduleOpen} onMouseLeave={() => window.clearTimeout(openTimer.current)} />
    <aside className={`sidebar ${open ? "open" : ""}`} onMouseEnter={() => window.clearTimeout(closeTimer.current)} onMouseLeave={scheduleClose}>
      <div className="brand">
        <span>◐</span>
        <div>
          <strong>月光簿</strong>
          <small>Moonlight Journal</small>
        </div>
      </div>
          <button className="capture" onClick={() => { onCapture(); setOpen(false); }}>
        ＋ 快速記錄
      </button>
      <nav>
        {nav.map(([key, icon, label]) => (
          <button
            aria-label={label}
            key={key}
            className={page === key ? "active" : ""}
            onClick={() => { setPage(key); setOpen(false); }}
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
        onClick={() => { setPage("settings"); setOpen(false); }}
      >
        <i>⚙</i>
        <span>設定</span>
      </button>
    </aside>
    </>
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
  const moonNote = dailyMoonNotes[dayOfYear(new Date()) % dailyMoonNotes.length];
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
          <h2>{greeting}{state.settings.userName.trim() ? `，${state.settings.userName.trim()}` : ""}</h2>
          <p>今天想留下什麼？一句碎念也算數。</p>
        </div>
        <button onClick={onCapture}>寫點東西</button>
      </section>
      <div className="dashboard">
        <Panel
          title="今日安排"
          action="看行事曆 →"
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
            <h3>{moonNote[0]}</h3>
            <p>{moonNote[1]}</p>
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

const colors: PaletteId[] = palette.map((item) => item.id);
type CalendarDisplayType = "note" | "todo" | "progress" | "move-hint" | "paused-hint";
interface CalendarDisplayItem {
  id: string;
  type: CalendarDisplayType;
  date: string;
  title: string;
  time: string;
  endTime?: string;
  color: Todo["color"];
  todoId?: string;
  occurrenceDate?: string;
  completed?: boolean;
  movedTo?: string;
  pausedHint?: boolean;
  overdueDays?: number;
}
const timeToMinutes = (value?: string) => {
  if (!value) return 0;
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes)
    ? Math.max(0, Math.min(24 * 60, hours * 60 + minutes))
    : 0;
};
function CalendarEntryControl({
  item,
  className = "",
  showTime = false,
  style,
  onOpen,
  onToggle,
}: {
  item: CalendarDisplayItem;
  className?: string;
  showTime?: boolean;
  style?: CSSProperties;
  onOpen: (item: CalendarDisplayItem) => void;
  onToggle?: (item: CalendarDisplayItem) => void;
}) {
  const checkable = item.type === "todo" && Boolean(item.todoId && item.occurrenceDate);
  const overdueMarker = item.overdueDays ? "⚠" : "";
  return (
    <div
      className={`calendar-entry-control ${className} ${checkable ? "checkable" : ""} ${item.completed ? "completed" : ""}`}
      style={{ ...paletteStyle(item.color), ...style }}
    >
      {checkable && (
        <input
          type="checkbox"
          aria-label={`完成 ${item.title}（${item.occurrenceDate}）`}
          checked={Boolean(item.completed)}
          onClick={(event) => event.stopPropagation()}
          onChange={() => onToggle?.(item)}
        />
      )}
      <button
        type="button"
        className="calendar-entry-open"
        aria-label={item.type === "move-hint" ? `${item.title} 已改至 ${item.movedTo}` : item.title}
        onClick={(event) => {
          event.stopPropagation();
          onOpen(item);
        }}
      >
        {showTime && item.time && (
          <small>{item.time}{item.endTime ? `–${item.endTime}` : ""}</small>
        )}
        <span className="calendar-entry-title">
          {overdueMarker && <b className="calendar-overdue-mark" aria-label={`逾期 ${item.overdueDays} 天`}>{overdueMarker}</b>}
          {item.title}
        </span>
        {item.type === "move-hint" && <small>已改至 {item.movedTo}</small>}
        {(item.type === "paused-hint" || item.pausedHint) && <small className="calendar-paused-hint">已暫停</small>}
      </button>
    </div>
  );
}

const timedItems = (items: CalendarDisplayItem[]) => {
  const timed = items
    .filter((item) => item.time)
    .map((item, order) => {
      const start = timeToMinutes(item.time);
      const requestedEnd = item.endTime ? timeToMinutes(item.endTime) : start + 60;
      return {
        item,
        order,
        start,
        end: Math.max(start + 30, requestedEnd > start ? requestedEnd : start + 60),
      };
    })
    // Put longer events behind shorter overlapping entries while preserving
    // every event's real start and duration on the timeline.
    .sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start || a.order - b.order);
  const placed: typeof timed = [];
  return timed.map((entry) => {
    const overlapDepth = placed.filter(
      (other) => entry.start < other.end && other.start < entry.end,
    ).length;
    placed.push(entry);
    const inset = Math.min(overlapDepth * 28, 56);
    return {
      ...entry,
      style: {
        "--event-top": `${(entry.start / 60) * 34}px`,
        "--event-height": `${Math.max(34, ((entry.end - entry.start) / 60) * 34 - 3)}px`,
        left: `${inset}%`,
        width: `${100 - inset}%`,
        zIndex: 3 + overlapDepth,
      } as CSSProperties,
    };
  });
};
const calendarTimelineHours = (className = "calendar-timeline-hours") => (
  <div className={className}>
    {Array.from({ length: 24 }, (_, hour) => (
      <div className="calendar-timeline-hour" key={hour}>
        <time>{String(hour).padStart(2, "0")}:00</time>
        <span />
      </div>
    ))}
  </div>
);
const calendarTimeline = (
  items: CalendarDisplayItem[],
  itemClass: "calendar-view-item" | "calendar-day-item",
  onOpen: (item: CalendarDisplayItem) => void,
  onToggle: (item: CalendarDisplayItem) => void,
  showHours = true,
) => {
  const positionedItems = timedItems(items);
  return (
    <div className="calendar-timeline">
      {showHours && calendarTimelineHours()}
      <div className="calendar-timeline-events">
        {positionedItems.map(({ item, style }) => (
          <CalendarEntryControl
            key={item.id}
            item={item}
            className={`${itemClass} calendar-timeline-event`}
            showTime
            style={style}
            onOpen={onOpen}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
};
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
  const [calendarView, setCalendarView] = useState<"month" | "week" | "day">("month");
  const [miniMonth, setMiniMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [dialog, setDialog] = useState<{ item?: CalendarItem } | null>(null);
  const [todoEditor, setTodoEditor] = useState<Todo | null | undefined>(undefined);
  const [progressEditor, setProgressEditor] = useState<Todo | null>(null);
  const [progressDate, setProgressDate] = useState(todayKey);
  const [todoEditorDate, setTodoEditorDate] = useState(todayKey);
  const [occurrenceEditor, setOccurrenceEditor] = useState<{
    todo: Todo;
    occurrenceDate: string;
    displayDate: string;
  } | null>(null);
  const [popover, setPopover] = useState<{ x: number; y: number } | null>(null);
  const [calendarData, setCalendarData] = useState(false);
  const itemsForDate = (date: string): CalendarDisplayItem[] => {
    return [
      ...state.calendarItems
        .filter((x) => !x.deletedAt && x.date === date)
        .map((x) => ({ ...x, type: "note" as const })),
      ...state.todos.flatMap((todo) =>
        getTodoCalendarEntries(todo, date).map((entry) => ({
          id: entry.id,
          type: entry.kind,
          date: entry.date,
          title: entry.title,
          time: entry.time,
          endTime: entry.endTime,
          color: entry.color,
          todoId: entry.todoId,
          occurrenceDate: entry.occurrenceDate,
          completed: entry.completed,
          movedTo: entry.movedTo,
          pausedHint: entry.pausedHint,
          overdueDays: entry.overdueDays,
        })),
      ),
    ].sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
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
  const visibleDates = cells.map((cell) =>
    dateKey(new Date(year, m + cell.offset, cell.day)),
  );
  const miniYear = miniMonth.getFullYear();
  const miniMonthIndex = miniMonth.getMonth();
  const miniFirst = new Date(miniYear, miniMonthIndex, 1).getDay();
  const miniDays = new Date(miniYear, miniMonthIndex + 1, 0).getDate();
  const miniPrevDays = new Date(miniYear, miniMonthIndex, 0).getDate();
  const miniDates = Array.from({ length: 42 }, (_, index) => {
    const day = index - miniFirst + 1;
    const date = day < 1
      ? new Date(miniYear, miniMonthIndex - 1, miniPrevDays + day)
      : day > miniDays
        ? new Date(miniYear, miniMonthIndex + 1, day - miniDays)
        : new Date(miniYear, miniMonthIndex, day);
    return { date: dateKey(date), inMonth: date.getMonth() === miniMonthIndex };
  });
  const selectedDate = new Date(`${selected}T12:00:00`);
  const weekStart = new Date(selectedDate);
  weekStart.setDate(selectedDate.getDate() - selectedDate.getDay());
  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return dateKey(date);
  });
  const openDisplayItem = (item: CalendarDisplayItem) => {
    if (item.todoId) {
      const todo = state.todos.find((value) => value.id === item.todoId);
      if (!todo) return;
      if (item.type === "progress") {
        setTodoEditorDate(item.date);
        setTodoEditor(todo);
      } else if (item.type === "paused-hint") {
        setTodoEditorDate(item.date);
        setTodoEditor(todo);
      } else if (todo.recurrence) {
        setOccurrenceEditor({
          todo,
          occurrenceDate: item.occurrenceDate || item.date,
          displayDate: item.date,
        });
      } else if (item.type === "move-hint") {
        setOccurrenceEditor({
          todo,
          occurrenceDate: item.occurrenceDate || item.date,
          displayDate: item.date,
        });
      } else {
        setTodoEditorDate(item.date);
        setTodoEditor(todo);
      }
      return;
    }
    setDialog({ item: item as CalendarItem });
  };
  const openNote = (date = selected) => {
    setSelected(date);
    setPopover(null);
    setDialog({});
  };
  const toggleCalendarTodo = (item: CalendarDisplayItem) => {
    if (!item.todoId || !item.occurrenceDate) return;
    setState((current) => ({
      ...current,
      todos: current.todos.map((todo) => {
        if (todo.id !== item.todoId) return todo;
        const toggled = toggleTodoCompletion(todo, item.occurrenceDate!);
        if (todo.recurrence || isMultiDayTodo(todo)) return toggled;
        const completed = (toggled.completedDates || []).includes(item.occurrenceDate!);
        return changeTodoStatus(toggled, completed ? "done" : "doing", item.occurrenceDate!);
      }),
    }));
  };
  const shiftCalendar = (direction: number) => {
    if (calendarView === "month") {
      const next = new Date(year, m + direction, 1);
      setMonth(next);
      setMiniMonth(next);
      return;
    }
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + direction * (calendarView === "week" ? 7 : 1));
    setSelected(dateKey(next));
    const nextMonth = new Date(next.getFullYear(), next.getMonth(), 1);
    setMonth(nextMonth);
    setMiniMonth(nextMonth);
  };
  const save = (item: CalendarItem) =>
    setState((s) => ({
      ...s,
      calendarItems: s.calendarItems.some((x) => x.id === item.id)
        ? s.calendarItems.map((x) => (x.id === item.id ? item : x))
        : [...s.calendarItems, item],
    }));
  const remove = (item: CalendarItem) =>
    setState((s) => ({
      ...s,
      calendarItems: s.calendarItems.map((x) =>
        x.id === item.id ? { ...x, deletedAt: new Date().toISOString() } : x,
      ),
    }));
  return (
    <div className="page calendar-page">
      <div className="page-tools">
        <div className="month-switch">
          <button onClick={() => shiftCalendar(-1)}>‹</button>
          <h2>
            {calendarView === "day" ? dateLabel(selected) : calendarView === "week" ? `${weekDates[0]} ～ ${weekDates[6]}` : `${year} 年 ${m + 1} 月`}
          </h2>
          <button onClick={() => shiftCalendar(1)}>›</button>
        </div>
        <div className="calendar-view-tabs" role="tablist" aria-label="行事曆檢視方式">
          {(["month", "week", "day"] as const).map((view) => (
            <button
              type="button"
              key={view}
              className={calendarView === view ? "active" : ""}
              onClick={() => setCalendarView(view)}
            >
              {view === "month" ? "月" : view === "week" ? "週" : "日"}
            </button>
          ))}
        </div>
        <div className="calendar-tools">
          <button className="secondary" onClick={() => setCalendarData(true)}>
            ◫ 管理生日與假日
          </button>
          <button
            className="secondary"
            onClick={() => {
              const todayMonth = new Date(now.getFullYear(), now.getMonth(), 1);
              setMonth(todayMonth);
              setMiniMonth(todayMonth);
              setSelected(todayKey);
            }}
          >
            回到今天
          </button>
        </div>
      </div>
      <div className="calendar-workspace">
      <aside className="calendar-mini panel" aria-label="快速選擇日期">
        <header>
          <button type="button" aria-label="上一個月" onClick={() => setMiniMonth(new Date(miniYear, miniMonthIndex - 1, 1))}>‹</button>
          <input
            aria-label="選擇年月"
            type="month"
            value={miniYear + "-" + String(miniMonthIndex + 1).padStart(2, "0")}
            onChange={(event) => {
              const [nextYear, nextMonth] = event.target.value.split("-").map(Number);
              if (nextYear && nextMonth) setMiniMonth(new Date(nextYear, nextMonth - 1, 1));
            }}
          />
          <button type="button" aria-label="下一個月" onClick={() => setMiniMonth(new Date(miniYear, miniMonthIndex + 1, 1))}>›</button>
        </header>
        <div className="calendar-mini-weekdays">{"日一二三四五六".split("").map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-mini-days">
          {miniDates.map(({ date, inMonth }) => (
            <button
              type="button"
              key={date}
              aria-label={`快速前往 ${date}`}
              aria-current={date === selected ? "date" : undefined}
              className={[!inMonth && "other", date === selected && "selected", date === todayKey && "today"].filter(Boolean).join(" ")}
              onClick={() => {
                setSelected(date);
                const targetMonth = new Date(date + "T12:00:00");
                const firstOfMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
                setMonth(firstOfMonth);
                setMiniMonth(firstOfMonth);
                setPopover(null);
              }}
            >{Number(date.slice(-2))}</button>
          ))}
        </div>
      </aside>
      <div className="calendar-main">
      {calendarView === "month" ? <div className="calendar panel">
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
            const openDate = (target: HTMLElement) => {
              const r = target.getBoundingClientRect();
              setSelected(key);
              const targetDate = new Date(key + "T12:00:00");
              const targetMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
              setMonth(targetMonth);
              setMiniMonth(targetMonth);
              setPopover({
                x: Math.min(innerWidth - 340, Math.max(235, r.left)),
                y: r.bottom + 360 > innerHeight ? Math.max(10, r.top - 330) : r.bottom + 8,
              });
            };
            return (
              <div
                key={`${key}-${i}`}
                style={{
                  gridColumn: `${(i % 7) + 1}`,
                  gridRow: `${Math.floor(i / 7) + 1}`,
                }}
                className={`calendar-day-cell ${c.offset ? "other" : ""} ${key === todayKey ? "today" : ""} ${weekend ? "weekend" : ""} ${holiday?.type === "national" ? "holiday" : ""} ${holiday?.type === "makeup" ? "makeup-day" : ""}`}
              >
                <button type="button" className="day-select" aria-label={key} onClick={(e) => openDate(e.currentTarget)}>
                  <span className="day-heading"><b>{c.day}</b><em>{lunar.shortLabel}</em></span>
                </button>
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
                <div className="calendar-day-entries">
                  {items.map((item) => (
                    <CalendarEntryControl
                      key={item.id}
                      item={item}
                      className="calendar-month-entry"
                      onOpen={openDisplayItem}
                      onToggle={toggleCalendarTodo}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div> : calendarView === "week" ? (
        <div className="calendar-week-view panel">
          <div className="calendar-week-heads">
            <div className="calendar-week-gutter" aria-hidden="true" />
            {weekDates.map((date) => {
              const day = new Date(`${date}T12:00:00`);
              return (
                <header key={date} className={date === todayKey ? "today" : ""}>
                  <button type="button" onClick={(event) => { setSelected(date); const targetMonth = new Date(date + "T12:00:00"); const firstOfMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1); setMonth(firstOfMonth); setMiniMonth(firstOfMonth); setPopover({ x: event.currentTarget.getBoundingClientRect().left, y: event.currentTarget.getBoundingClientRect().bottom }); }}>
                    <b>{day.getDate()}</b><span>{["日", "一", "二", "三", "四", "五", "六"][day.getDay()]}</span>
                  </button>
                  <button type="button" className="calendar-week-add-note" aria-label={`新增 ${date} 記事`} title="新增記事" onClick={() => openNote(date)}>＋</button>
                </header>
              );
            })}
          </div>
          <div className="calendar-week-all-day-row">
            <div className="calendar-week-all-day-cells">
              <div className="calendar-week-gutter calendar-week-all-day-label">全天</div>
              {weekDates.map((date) => {
                const allDay = itemsForDate(date).filter((item) => !item.time);
                return (
                  <div className="calendar-all-day" key={date}>
                    {allDay.map((item) => (
                      <CalendarEntryControl key={item.id} item={item} className="calendar-view-item" onOpen={openDisplayItem} onToggle={toggleCalendarTodo} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="calendar-week-timelines">
            {calendarTimelineHours("calendar-week-time-axis")}
            {weekDates.map((date) => (
              <section key={date} className={date === todayKey ? "today" : ""}>
                {calendarTimeline(itemsForDate(date), "calendar-view-item", openDisplayItem, toggleCalendarTodo, false)}
              </section>
            ))}
          </div>
        </div>
      ) : (
        <div className="calendar-day-view panel">
          <header><strong>{dateLabel(selected)}</strong><span>{selectedItems.length} 項安排</span></header>
          <div className="calendar-day-actions">
            <button type="button" onClick={() => openNote()}>＋ 新增記事</button>
          </div>
          <div className="calendar-all-day calendar-day-all-day">
            <strong>全天</strong>
            {selectedItems.filter((item) => !item.time).map((item) => (
              <CalendarEntryControl key={item.id} item={item} className="calendar-day-item" onOpen={openDisplayItem} onToggle={toggleCalendarTodo} />
            ))}
          </div>
          <div className="calendar-day-hours">
            {calendarTimeline(selectedItems, "calendar-day-item", openDisplayItem, toggleCalendarTodo)}
          </div>
        </div>
      )}
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
                <div className="calendar-pop-row" key={item.id}>
                  <i className={`dot ${item.color}`}></i>
                  <CalendarEntryControl
                    item={item}
                    showTime
                    onOpen={openDisplayItem}
                    onToggle={toggleCalendarTodo}
                  />
                  {item.type === "note" && (
                    <button
                      aria-label={`刪除 ${item.title}`}
                      className="delete"
                      onClick={() => remove(item as CalendarItem)}
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
            <button onClick={() => openNote()}>
              ＋ 新增記事
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
        />
      )}
      {todoEditor !== undefined && (
        <TodoEditor
          value={todoEditor}
          initialRecordDate={todoEditorDate}
          onOpenRecords={(todo, date) => {
            setProgressEditor(todo);
            setProgressDate(date);
            setTodoEditor(undefined);
          }}
          onClose={() => setTodoEditor(undefined)}
          onSave={(todo, options) => {
            setState((current) => {
              const existing = current.todos.find((item) => item.id === todo.id);
              const next = prepareTodoForSave(existing, todo, dateKey(new Date()), options);
              const todos = existing
                ? current.todos.map((item) => item.id === todo.id ? next : item)
                : [...current.todos, next];
              return { ...current, todos: promoteDueTodos(todos, dateKey(new Date())) };
            });
            setTodoEditor(undefined);
          }}
        />
      )}
      {progressEditor && (
        <TodoRecords
          todo={state.todos.find((item) => item.id === progressEditor.id) || progressEditor}
          initialDate={progressDate}
          onClose={() => setProgressEditor(null)}
          onEdit={() => {
            setTodoEditorDate(progressDate);
            setTodoEditor(progressEditor);
            setProgressEditor(null);
          }}
          onSave={(todo) => setState((current) => ({
            ...current,
            todos: current.todos.map((item) => item.id === todo.id ? todo : item),
          }))}
        />
      )}
      {occurrenceEditor && (
        <TodoOccurrenceEditor
          todo={occurrenceEditor.todo}
          occurrenceDate={occurrenceEditor.occurrenceDate}
          displayDate={occurrenceEditor.displayDate}
          onOpenRecords={(todo, date) => {
            setProgressEditor(todo);
            setProgressDate(date);
            setOccurrenceEditor(null);
          }}
          onClose={() => setOccurrenceEditor(null)}
          onSave={(todo) => {
            setState((current) => ({
              ...current,
              todos: current.todos.map((item) => item.id === todo.id ? todo : item),
            }));
            setOccurrenceEditor(null);
          }}
        />
      )}
    </div>
  );
}

function CalendarEditor({
  date,
  value,
  onClose,
  onSave,
}: {
  date: string;
  value?: CalendarItem;
  onClose: () => void;
  onSave: (v: CalendarItem) => void;
}) {
  const [form, setForm] = useState<CalendarItem>(
    value || {
      id: makeId("event"),
      type: "note",
      date,
      title: "",
      time: "",
      endTime: "",
      color: "violet",
    },
  );
  const valid = Boolean(
    form.date &&
      form.title.trim() &&
      form.time && form.endTime && form.time < form.endTime,
  );
  return (
    <Modal
      eyebrow="CALENDAR"
      title={`${value ? "編輯" : "新增"}記事`}
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
          aria-label="日期"
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
      <div className="field-row">
          <Field label="開始時間">
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
          </Field>
          <Field label="結束時間">
            <input
              type="time"
              min={form.time || undefined}
              value={form.endTime || ""}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
            />
          </Field>
      </div>
      <Field label="顏色">
        <div className="color-picks">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={paletteItem(c).label}
              title={paletteItem(c).label}
              className={`palette-swatch ${form.color === c ? "selected" : ""}`}
              style={{ backgroundColor: paletteItem(c).base }}
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
const activeColumns = columns;
const statusName = Object.fromEntries(columns) as Record<TodoStatus, string>;
const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
function recurrenceSummary(rule?: RecurrenceRuleSegment) {
  if (!rule) return "重複待辦";
  const repeat = rule.frequency === "daily"
    ? "每日"
    : rule.frequency === "weekly"
      ? `每週${(rule.weekdays?.length ? rule.weekdays : []).slice().sort((a, b) => a - b).map((day) => ` ${weekdayLabels[day]}`).join("、") || ""}`
      : `每月 ${rule.dayOfMonth || 1} 日`;
  const time = rule.startTime ? ` · ${rule.startTime}${rule.endTime ? `–${rule.endTime}` : ""}` : " · 全天";
  return `${repeat}${time} · ${rule.untilDate ? `至 ${rule.untilDate}` : "永不結束"}`;
}
function TodoPage({
  state,
  setState,
}: {
  state: AppState;
  setState: StateSetter;
}) {
  const [editing, setEditing] = useState<Todo | null | undefined>(undefined);
  const [progressTaskId, setProgressTaskId] = useState<string | null>(null);
  const [recordsDate, setRecordsDate] = useState(todayKey);
  const [showCompleted, setShowCompleted] = useState(false);
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
    over?: TodoStatus | "archive";
  } | null>(null);
  const todos = state.todos.filter((x) => !x.deletedAt);
  const save = (todo: Todo, options?: { overwriteProgressCalendarHistory?: boolean }) =>
    setState((s) => {
      const existing = s.todos.find((item) => item.id === todo.id);
      const next = prepareTodoForSave(existing, todo, dateKey(new Date()), options);
      const todos = promoteDueTodos(existing
        ? s.todos.map((item) => item.id === todo.id ? next : item)
        : [...s.todos, next], dateKey(new Date()));
      return {
        ...s,
        todos,
      };
    });
  const move = (id: string, status: TodoStatus) =>
    setState((s) => ({
      ...s,
      todos: s.todos.map((x) =>
        x.id === id
          ? {
              ...changeTodoStatus(x, status),
              archivedAt: undefined,
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
  const statusAt = (x: number, y: number): TodoStatus | "archive" | undefined => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-todo-status], [data-todo-archive]");
    if (element?.dataset.todoArchive) return "archive";
    return element?.dataset.todoStatus as TodoStatus | undefined;
  };
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
      if (status === "archive") {
        setState((state) => ({ ...state, todos: state.todos.map((todo) => todo.id === current.id ? { ...changeTodoStatus(todo, "done"), archivedAt: new Date().toISOString() } : todo) }));
      } else if (status) move(current.id, status);
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
        {activeColumns.map(([status, label]) => (
          <section
            key={status}
            data-todo-status={status}
            className={dragPreview?.over === status ? "drag-over" : ""}
          >
            <header>
              <i
                className={`dot ${status === "doing" ? "purple" : status === "paused" ? "gold" : "gray"}`}
              ></i>
              <h3>{label}</h3>
              <b>{todos.filter((x) => x.status === status && !x.archivedAt).length}</b>
              <button
                onClick={() =>
                  setEditing({
                    id: makeId("todo"),
                    title: "",
                    description: "",
                    status,
                    color: "violet",
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
                .filter((x) => x.status === status && !x.archivedAt)
                .sort((a, b) => {
                  const isRecurring = (todo: Todo) => todo.kind === "recurring" || Boolean(todo.recurrence?.rules.length);
                  return status === "doing" && isRecurring(a) !== isRecurring(b)
                    ? isRecurring(a) ? 1 : -1
                    : a.position - b.position;
                })
                .map((todo) => {
                  const recurring = todo.kind === "recurring" || Boolean(todo.recurrence?.rules.length);
                  const compact = status === "doing" && recurring;
                  return (
                  <article
                    key={todo.id}
                    className={["todo-card", todo.color, status === "done" && "completed", recurring && compact && "recurring-compact", todo.kind === "progress" && "progress-task"].filter(Boolean).join(" ")}
                    style={paletteStyle(todo.color)}
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
                    {todo.recurrence && compact ? (
                      <div className="recurring-compact-row">
                        <h4 title={todo.title}>{todo.title}</h4>
                        <button type="button" aria-label={`刪除 ${todo.title}`} onClick={(e) => { e.stopPropagation(); remove(todo.id); }}>刪除</button>
                      </div>
                    ) : (
                      <>
                        <small>
                          {todo.kind === "progress"
                            ? todo.dueDate ? `期限 ${todo.dueDate}` : "重點進度任務"
                            : todo.recurrence
                              ? recurrenceSummary(todo.recurrence.rules[0])
                              : todo.startDate
                            ? `${todo.startDate}${todo.endDate && todo.endDate !== todo.startDate ? ` → ${todo.endDate}` : ""}`
                            : "沒有期限"}
                        </small>
                        <h4>{todo.title}</h4>
                        {todo.kind === "progress" ? (
                          todo.progressLogs?.length ? (
                            <p className="progress-preview">{todo.progressLogs.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0].text}</p>
                          ) : <p className="progress-preview muted">還沒有進度紀錄</p>
                        ) : todo.description && !compact && <p>{todo.description}</p>}
                        {isMultiDayTodo(todo) && (
                          <small className="multi-day-progress">{getMultiDayCompletedCount(todo)}/{getMultiDayLength(todo)} 天完成</small>
                        )}
                        <footer>
                          <span>{statusName[status]}</span>
                          <span className="todo-card-actions">
                            {status === "done" && <button onClick={(e) => { e.stopPropagation(); setState((current) => ({ ...current, todos: current.todos.map((item) => item.id === todo.id ? { ...item, archivedAt: new Date().toISOString() } : item) })); }}>移入已完成</button>}
                            <button onClick={(e) => { e.stopPropagation(); remove(todo.id); }}>刪除</button>
                          </span>
                        </footer>
                      </>
                    )}
                  </article>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
      <section className={`todo-completed-archive ${dragPreview?.over === "archive" ? "drag-over" : ""}`} data-todo-archive="true">
        <button
          type="button"
          className="archive-toggle"
          aria-expanded={showCompleted}
          onClick={() => setShowCompleted((value) => !value)}
        >
          {showCompleted ? "⌄" : "›"} 已完成（{todos.filter((todo) => todo.archivedAt).length}）
        </button>
        {showCompleted && (
          <div className="completed-list">
            {todos.filter((todo) => todo.archivedAt).map((todo) => (
              <button type="button" className="completed-row" key={todo.id} onClick={() => setEditing(todo)}>
                <span className="completed-check">✓</span>
                <span>{todo.title}</span>
                <small>{todo.endDate || todo.dueDate || "已完成"}</small>
              </button>
            ))}
          </div>
        )}
      </section>
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
          onSave={(v, options) => {
            save(v, options);
            setEditing(undefined);
          }}
          onOpenRecords={(todo, date) => {
            setRecordsDate(date);
            setProgressTaskId(todo.id);
            setEditing(undefined);
          }}
        />
      )}
      {progressTaskId && (
        <TodoRecords
          todo={todos.find((todo) => todo.id === progressTaskId)!}
          initialDate={recordsDate}
          onClose={() => setProgressTaskId(null)}
          onEdit={() => {
            const todo = todos.find((item) => item.id === progressTaskId);
            if (todo) setEditing(todo);
            setProgressTaskId(null);
          }}
          onSave={(todo) => setState((current) => ({
            ...current,
            todos: current.todos.map((item) => item.id === todo.id ? todo : item),
          }))}
        />
      )}
    </div>
  );
}
function TodoEditor({
  value,
  onClose,
  onSave,
  onOpenRecords,
  initialRecordDate,
}: {
  value: Todo | null;
  onClose: () => void;
  onSave: (v: Todo, options?: { overwriteProgressCalendarHistory?: boolean }) => void;
  onOpenRecords?: (todo: Todo, date: string) => void;
  initialRecordDate?: string;
}) {
  const [form, setForm] = useState<Todo>(
    value || {
      id: makeId("todo"),
      title: "",
      description: "",
      status: "todo",
      color: "violet",
      dueDate: "",
      startDate: "",
      endDate: "",
      position: 99,
    },
  );
  const firstRule = value?.recurrence?.rules[0];
  const initialKind: TodoKind = value?.kind === "progress" ? "progress" : value?.recurrence?.rules?.length ? "recurring" : value?.kind || "task";
  const [kind, setKind] = useState<TodoKind>(initialKind);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(firstRule?.frequency || "daily");
  const [weekdays, setWeekdays] = useState<number[]>(firstRule?.weekdays || []);
  const [dayOfMonth, setDayOfMonth] = useState(firstRule?.dayOfMonth || 1);
  const [repeatFrom, setRepeatFrom] = useState(firstRule?.fromDate || value?.startDate || todayKey);
  const [repeatUntil, setRepeatUntil] = useState(firstRule?.untilDate || "");
  const [repeatForever, setRepeatForever] = useState(!firstRule?.untilDate);
  const [startTime, setStartTime] = useState(firstRule?.startTime || value?.startTime || "");
  const [endTime, setEndTime] = useState(firstRule?.endTime || value?.endTime || "");
  const startDate = form.startDate || form.dueDate || form.endDate || "";
  const endDate = form.endDate || form.dueDate || form.startDate || "";
  const [overwriteProgressCalendarHistory, setOverwriteProgressCalendarHistory] = useState(false);
  const progressDateRangeChanged = Boolean(
    value && initialKind === "progress" && kind === "progress" &&
    (startDate !== (value.startDate || value.dueDate || value.endDate || "") ||
      endDate !== (value.endDate || value.dueDate || value.startDate || "")),
  );
  const dateRangeValid = !startDate || !endDate || startDate <= endDate;
  const timeValid = (!startTime && !endTime) || Boolean(startTime && endTime && endTime > startTime);
  const recurrenceValid = kind !== "recurring" || Boolean(
    repeatFrom &&
      (repeatForever || (repeatUntil && repeatUntil >= repeatFrom)) &&
      (frequency !== "weekly" || weekdays.length > 0) &&
      (frequency !== "monthly" || (dayOfMonth >= 1 && dayOfMonth <= 31)),
  );
  const longTermDatesValid = kind !== "progress" || Boolean(startDate && endDate && startDate <= endDate);
  const valid = Boolean(
    form.title.trim() &&
      dateRangeValid && longTermDatesValid &&
      (kind === "progress" || (kind === "recurring" ? recurrenceValid && timeValid : timeValid)),
  );
  const toggleWeekday = (day: number) => setWeekdays((current) =>
    current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort((a, b) => a - b),
  );
  const commit = () => {
    const common = {
      ...form,
      title: form.title.trim(),
      kind,
      completedDates: form.completedDates || [],
    };
    if (kind === "progress") {
      onSave({
        ...common,
        kind: "progress",
        dueDate: endDate,
        startDate,
        endDate,
        startTime: undefined,
        endTime: undefined,
        recurrence: undefined,
        progressLogs: form.progressLogs || [],
      }, { overwriteProgressCalendarHistory });
      return;
    }
    if (kind === "recurring") {
      const rule: RecurrenceRuleSegment = {
        fromDate: repeatFrom,
        ...(repeatForever ? {} : { untilDate: repeatUntil }),
        frequency,
        ...(frequency === "weekly" ? { weekdays } : {}),
        ...(frequency === "monthly" ? { dayOfMonth } : {}),
        ...(startTime && endTime ? { startTime, endTime } : {}),
        color: form.color,
      };
      onSave({
        ...common,
        status: form.status,
        dueDate: repeatForever ? "" : repeatUntil,
        startDate: repeatFrom,
        endDate: repeatForever ? "" : repeatUntil,
        startTime: undefined,
        endTime: undefined,
        recurrence: {
          rules: [rule],
          exceptions: form.recurrence?.exceptions || [],
          overrides: form.recurrence?.overrides || {},
        },
      });
      return;
    }
    const normalizedStart = startDate || endDate;
    const normalizedEnd = endDate || startDate;
    onSave({
      ...common,
      kind: "task",
      startDate: normalizedStart,
      endDate: normalizedEnd,
      dueDate: normalizedEnd || normalizedStart,
      startTime: startTime && endTime ? startTime : undefined,
      endTime: startTime && endTime ? endTime : undefined,
      recurrence: undefined,
    });
  };
  return (
    <Modal
      eyebrow="TO DO"
      title={value ? "編輯待辦" : "新增待辦"}
      onClose={onClose}
      footer={
        <>
          <span>{kind === "progress" ? "進度以文字紀錄" : "日期與時間可依需要設定"}</span>
          <button
            disabled={!valid}
            onClick={commit}
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
      <Field label="任務類型">
        <select value={kind} onChange={(e) => {
          const next = e.target.value as TodoKind;
          setKind(next);
          if (next === "recurring" && !value?.recurrence) setFrequency("daily");
        }}>
          <option value="task">一般待辦</option>
          <option value="recurring">週期代辦</option>
          <option value="progress">重點代辦</option>
        </select>
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
      {kind === "progress" ? (
        <>
          <div className="field-row">
            <Field label="開始日期">
              <input type="date" aria-label="重點代辦開始日期" value={startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} />
            </Field>
            <Field label="結束日期">
              <input type="date" aria-label="重點代辦結束日期" min={startDate || undefined} value={endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value, dueDate: event.target.value })} />
            </Field>
          </div>
          <small className="field-hint">日期範圍中的每天都會顯示在行事曆。</small>
          {progressDateRangeChanged && (
            <label className="field-hint progress-history-option">
              <input
                type="checkbox"
                checked={overwriteProgressCalendarHistory}
                onChange={(event) => setOverwriteProgressCalendarHistory(event.target.checked)}
              />
              重建行事曆歷程，清除原有空檔並依新日期範圍連續顯示
            </label>
          )}
        </>
      ) : kind === "recurring" ? (
        <>
          <Field label="週期頻率">
            <select aria-label="重複頻率" value={frequency} onChange={(event) => {
              const next = event.target.value as RecurrenceFrequency;
              setFrequency(next);
              if (next === "weekly" && weekdays.length === 0) setWeekdays([new Date(repeatFrom + "T12:00:00").getDay()]);
            }}>
              <option value="daily">每日</option>
              <option value="weekly">每週</option>
              <option value="monthly">每月</option>
            </select>
          </Field>
          <div className="field-row">
            <Field label="開始日期">
              <input type="date" aria-label="重複開始日期" value={repeatFrom} onChange={(event) => setRepeatFrom(event.target.value)} />
            </Field>
            <Field label="週期期限">
              <select aria-label="重複期限" value={repeatForever ? "forever" : "until"} onChange={(event) => setRepeatForever(event.target.value === "forever")}>
                <option value="forever">永不結束</option>
                <option value="until">設定截止日</option>
              </select>
            </Field>
          </div>
          {!repeatForever && <Field label="截止日期"><input type="date" aria-label="重複截止日期" min={repeatFrom} value={repeatUntil} onChange={(event) => setRepeatUntil(event.target.value)} /></Field>}
          {frequency === "weekly" && (
            <Field label="重複星期">
              <div className="weekday-picks" role="group" aria-label="重複星期">
                {weekdayLabels.map((label, day) => <button type="button" key={day} aria-pressed={weekdays.includes(day)} className={weekdays.includes(day) ? "selected" : ""} onClick={() => toggleWeekday(day)}>週{label}</button>)}
              </div>
            </Field>
          )}
          {frequency === "monthly" && <Field label="每月日期"><input aria-label="每月日期" type="number" min={1} max={31} value={dayOfMonth} onChange={(event) => setDayOfMonth(Math.max(1, Math.min(31, Number(event.target.value) || 1)))} /><small className="field-hint">當月沒有該日期時，改在月底出現。</small></Field>}
          <div className="field-row">
            <Field label="開始時間（選填）"><input aria-label="待辦開始時間" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></Field>
            <Field label="結束時間（選填）"><input aria-label="待辦結束時間" type="time" min={startTime || undefined} value={endTime} onChange={(event) => setEndTime(event.target.value)} /></Field>
          </div>
          {(startTime || endTime) && !timeValid && <small className="calendar-data-error">請同時填入開始與結束時間，且結束時間晚於開始時間。</small>}
          {value && <button type="button" className="secondary todo-records-open" onClick={() => onOpenRecords?.(form, initialRecordDate || todayKey)}>查看每日紀錄</button>}
        </>
      ) : (
        <>
          <div className="field-row">
            <Field label="開始日期（選填）"><input type="date" aria-label="一般待辦開始日期" value={startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value, dueDate: form.dueDate || event.target.value })} /></Field>
            <Field label="結束日期（選填）"><input type="date" aria-label="一般待辦結束日期" min={startDate || undefined} value={endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value, dueDate: event.target.value })} /></Field>
          </div>
          <div className="field-row">
            <Field label="開始時間（選填）"><input aria-label="待辦開始時間" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></Field>
            <Field label="結束時間（選填）"><input aria-label="待辦結束時間" type="time" min={startTime || undefined} value={endTime} onChange={(event) => setEndTime(event.target.value)} /></Field>
          </div>
          {(startTime || endTime) && !timeValid && <small className="calendar-data-error">請同時填入開始與結束時間，且結束時間晚於開始時間。</small>}
        </>
      )}
      {kind === "progress" && value && <button type="button" className="secondary todo-records-open" onClick={() => onOpenRecords?.(form, initialRecordDate || todayKey)}>查看進度紀錄</button>}
      <Field label="顏色">
        <div className="color-picks">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={paletteItem(c).label}
              title={paletteItem(c).label}
              className={`palette-swatch ${form.color === c ? "selected" : ""}`}
              style={{ backgroundColor: paletteItem(c).base }}
              onClick={() => setForm({ ...form, color: c })}
            />
          ))}
        </div>
      </Field>
    </Modal>
  );
}

function TodoRecords({
  todo,
  initialDate,
  onClose,
  onEdit,
  onSave,
}: {
  todo: Todo;
  initialDate: string;
  onClose: () => void;
  onEdit: () => void;
  onSave: (todo: Todo) => void;
}) {
  const [date, setDate] = useState(initialDate || todayKey);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editDate, setEditDate] = useState("");
  const logs = todo.progressLogs || [];
  const saveLogs = (next: Todo["progressLogs"]) => onSave({ ...todo, progressLogs: next || [] });
  const addLog = () => {
    if (!draft.trim() || !date) return;
    saveLogs([
      ...logs,
      { id: makeId("progress"), date, text: draft.trim(), createdAt: new Date().toISOString() },
    ]);
    setDraft("");
  };
  const sortedLogs = logs.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const longTerm = todo.kind === "progress";
  return (
    <Modal
      eyebrow={longTerm ? "LONG-TERM TODO" : "RECURRING TODO"}
      title={longTerm ? `「${todo.title}」進度紀錄` : `「${todo.title}」每日紀錄`}
      onClose={onClose}
      className="todo-records-modal"
      footer={<><button className="secondary" onClick={onEdit}>回到編輯代辦</button><button onClick={onClose}>完成</button></>}
    >
      {todo.description && <p className="progress-task-description">{todo.description}</p>}
      <section className="progress-log-compose">
        <div className="progress-log-compose-date">
          <input type="date" aria-label="紀錄日期" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <textarea className="progress-log-draft" aria-label="新增進度紀錄" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={longTerm ? "記下這一天的進度……" : "記下這一天的狀況……"} />
        <div className="progress-log-compose-actions">
          <button type="button" disabled={!draft.trim() || !date} onClick={addLog}>新增紀錄</button>
        </div>
      </section>
      <div className="progress-log-list">
        {sortedLogs.length ? sortedLogs.map((log) => (
          <article key={log.id} className={`progress-log ${editingId === log.id ? "editing" : ""}`}>
            <header><time>{log.date}{log.updatedAt ? " · 已編輯" : ""}</time><span><button type="button" onClick={() => { setEditingId(log.id); setEditDraft(log.text); setEditDate(log.date); }}>編輯</button><button type="button" onClick={() => { if (confirm("確定刪除這筆紀錄？")) saveLogs(logs.filter((item) => item.id !== log.id)); }}>刪除</button></span></header>
            {editingId === log.id ? <div className="progress-log-edit-form"><input aria-label={`編輯紀錄日期 ${log.date}`} type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} /><textarea aria-label={`編輯紀錄 ${log.date}`} value={editDraft} onChange={(event) => setEditDraft(event.target.value)} /><div className="progress-log-actions"><button type="button" onClick={() => { if (!editDraft.trim() || !editDate) return; saveLogs(logs.map((item) => item.id === log.id ? { ...item, date: editDate, text: editDraft.trim(), updatedAt: new Date().toISOString() } : item)); setEditingId(null); }}>儲存</button><button type="button" onClick={() => setEditingId(null)}>取消</button></div></div> : <p>{log.text}</p>}
          </article>
        )) : <Empty text="還沒有紀錄。" />}
      </div>
    </Modal>
  );
}

function TodoOccurrenceEditor({
  todo,
  occurrenceDate,
  displayDate,
  onClose,
  onSave,
  onOpenRecords,
}: {
  todo: Todo;
  occurrenceDate: string;
  displayDate: string;
  onClose: () => void;
  onSave: (todo: Todo) => void;
  onOpenRecords?: (todo: Todo, date: string) => void;
}) {
  const rule = getRuleForDate(todo.recurrence?.rules || [], occurrenceDate);
  const previousOverride = todo.recurrence?.overrides?.[occurrenceDate] || {};
  const [title, setTitle] = useState(previousOverride.title || rule?.title || todo.title);
  const [date, setDate] = useState(previousOverride.movedTo || displayDate);
  const [startTime, setStartTime] = useState(previousOverride.startTime ?? rule?.startTime ?? "");
  const [endTime, setEndTime] = useState(previousOverride.endTime ?? rule?.endTime ?? "");
  const [color, setColor] = useState<PaletteId>(nearestPaletteId(previousOverride.color || rule?.color || todo.color));
  const [scope, setScope] = useState<"occurrence" | "future" | "series">("occurrence");
  const valid = Boolean(title.trim() && date && (!startTime || !endTime || endTime > startTime));
  const save = () => {
    if (!valid) return;
    const current = todo.recurrence || { rules: [], exceptions: [], overrides: {} };
    const timing = startTime ? { startTime, ...(endTime ? { endTime } : {}) } : { startTime: "", endTime: "" };
    let next: Todo = todo;
    if (scope === "occurrence") {
      next = {
        ...todo,
        recurrence: {
          ...current,
          overrides: {
            ...current.overrides,
            [occurrenceDate]: {
              ...previousOverride,
              title: title.trim() === (rule?.title || todo.title) ? undefined : title.trim(),
              ...timing,
              color,
              movedTo: date === occurrenceDate ? undefined : date,
            },
          },
        },
      };
    } else if (scope === "future" && rule) {
      const split = addRuleFromDate(current, occurrenceDate, {
        frequency: rule.frequency,
        ...(rule.weekdays ? { weekdays: rule.weekdays } : {}),
        ...(rule.dayOfMonth ? { dayOfMonth: rule.dayOfMonth } : {}),
        ...(rule.untilDate ? { untilDate: rule.untilDate } : {}),
        ...(title.trim() === todo.title ? {} : { title: title.trim() }),
        ...timing,
        color,
      });
      const overrides = { ...split.overrides };
      delete overrides[occurrenceDate];
      if (date !== occurrenceDate) overrides[occurrenceDate] = { movedTo: date };
      next = { ...todo, recurrence: { ...split, overrides } };
    } else {
      const rules = current.rules.map((segment) => ({
        ...segment,
        title: title.trim() === todo.title ? undefined : title.trim(),
        ...timing,
        color,
      }));
      const overrides = Object.fromEntries(Object.entries(current.overrides).map(([key, override]) => [key, {
        ...(override.movedTo ? { movedTo: override.movedTo } : {}),
        ...(override.cancelled ? { cancelled: true } : {}),
      }]));
      if (date !== occurrenceDate) overrides[occurrenceDate] = { ...(overrides[occurrenceDate] || {}), movedTo: date };
      next = { ...todo, title: title.trim(), color, recurrence: { ...current, rules, overrides } };
    }
    onSave(next);
  };
  return (
    <Modal eyebrow="REPEATING TODO" title="編輯這次出現" onClose={onClose} footer={<><span>預設只套用這一次</span><button disabled={!valid} onClick={save}>儲存</button></>}>
      <Field label="標題"><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div className="field-row">
        <Field label="開始時間（選填）"><input type="time" aria-label="這次開始時間" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
        <Field label="結束時間（選填）"><input type="time" aria-label="這次結束時間" min={startTime || undefined} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
      </div>
      <button type="button" className="secondary todo-records-open" onClick={() => onOpenRecords?.(todo, occurrenceDate)}>查看這天紀錄</button>
      <Field label="修改範圍"><select aria-label="修改範圍" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
        <option value="occurrence">只修改這一次</option>
        <option value="future">從這次起修改後續</option>
        <option value="series">修改整個系列的規則／時間</option>
      </select></Field>
      <Field label="顏色"><div className="color-picks">{colors.map((item) => <button type="button" key={item} aria-label={paletteItem(item).label} title={paletteItem(item).label} className={`palette-swatch ${color === item ? "selected" : ""}`} style={{ backgroundColor: paletteItem(item).base }} onClick={() => setColor(item)} />)}</div></Field>
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
    bodyHtml: "",
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
        <RichTextEditor
          html={entry.bodyHtml}
          text={entry.body}
          ariaLabel="日記內容"
          placeholder="慢慢寫，不用一次寫完……"
          contextualToolbar
          onChange={(bodyHtml, body) =>
            save({
              ...entry,
              body,
              bodyHtml,
              updatedAt: new Date().toISOString(),
            })
          }
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
  dataDirectory,
}: {
  state: AppState;
  setState: StateSetter;
  dataDirectory: string;
}) {
  const [text, setText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyItemId, setBusyItemId] = useState("");
  const [message, setMessage] = useState("");
  const [previewAttachment, setPreviewAttachment] = useState<{
    attachment: InboxAttachment;
    preview: string;
    original: string;
  } | null>(null);
  const inboxDrag = useRef<{
    id: string;
    startY: number;
    active: boolean;
  } | null>(null);
  const items = state.inbox
    .filter((x) => !x.deletedAt)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const prepareAttachments = async (files: File[]) => {
    const attachments: InboxAttachment[] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const id = makeId("inbox-media");
        const prepared = await prepareMedia(file);
        const stored = await storeMedia(id, file, prepared.previewDataUrl, "inbox");
        if ("originalDataUrl" in stored) {
          attachments.push({
            id,
            mediaType: prepared.mediaType,
            originalName: file.name,
            mimeType: file.type,
            size: file.size,
            duration: prepared.duration,
            dataUrl: prepared.mediaType === "video" ? stored.originalDataUrl : prepared.previewDataUrl,
            previewDataUrl: prepared.previewDataUrl,
          });
        } else {
          attachments.push({
            id,
            mediaType: prepared.mediaType,
            originalName: file.name,
            mimeType: file.type,
            size: file.size,
            duration: prepared.duration,
            originalPath: stored.originalPath,
            previewPath: stored.previewPath,
          });
        }
      } catch (error) {
        failures.push(`${file.name}：${error instanceof Error ? error.message : "匯入失敗"}`);
      }
    }
    return { attachments, failures };
  };
  const addItem = async () => {
    const trimmedText = text.trim();
    if (!trimmedText && !selectedFiles.length) return;
    setBusy(true);
    setMessage("正在整理素材……");
    const { attachments, failures } = await prepareAttachments(selectedFiles);
    if (trimmedText || attachments.length) {
      setState((current) => ({
        ...current,
        inbox: [
          { id: makeId("inbox"), text: trimmedText, attachments, createdAt: new Date().toISOString(), position: 0 },
          ...current.inbox.map((item) => ({ ...item, position: (item.position ?? 0) + 1 })),
        ],
      }));
      setText("");
      setSelectedFiles([]);
    }
    setMessage(failures.length ? `已加入 ${attachments.length} 個素材；${failures.join("、")}` : `已加入 ${attachments.length} 個素材`);
    setBusy(false);
  };
  const addAttachments = async (itemId: string, files: File[]) => {
    if (!files.length) return;
    setBusyItemId(itemId);
    const { attachments, failures } = await prepareAttachments(files);
    if (attachments.length) {
      setState((current) => ({
        ...current,
        inbox: current.inbox.map((item) => item.id === itemId
          ? { ...item, attachments: [...(item.attachments || []), ...attachments] }
          : item),
      }));
    }
    setMessage(failures.length ? `已加入 ${attachments.length} 個素材；${failures.join("、")}` : `已加入 ${attachments.length} 個素材`);
    setBusyItemId("");
  };
  const removeAttachment = (itemId: string, attachment: InboxAttachment) => {
    if (!confirm(`要移除「${attachment.originalName}」嗎？`)) return;
    void removeMediaFiles(attachment);
    setState((current) => ({
      ...current,
      inbox: current.inbox.map((item) => item.id === itemId
        ? { ...item, attachments: (item.attachments || []).filter((value) => value.id !== attachment.id) }
        : item),
    }));
  };
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
  const convert = (id: string, type: "todo" | "snippet") =>
    setState((s) => {
      const item = s.inbox.find((x) => x.id === id)!;
      const title = item.text.trim() || item.attachments?.[0]?.originalName || "蒐集素材";
      return type === "todo"
        ? {
            ...s,
            inbox: s.inbox.map((x) => x.id === id ? { ...x, deletedAt: new Date().toISOString() } : x),
            todos: [...s.todos, { id: makeId("todo"), title, description: "", status: "todo", color: "violet", dueDate: "", position: 99 }],
          }
        : {
            ...s,
            inbox: s.inbox.map((x) => x.id === id ? { ...x, deletedAt: new Date().toISOString() } : x),
            diaries: s.diaries.some((x) => x.date === todayKey)
              ? s.diaries.map((x) => x.date === todayKey ? { ...x, snippets: [...x.snippets, { id: makeId("snippet"), text: title, createdAt: new Date().toISOString() }] } : x)
              : [...s.diaries, { date: todayKey, title: "", body: "", updatedAt: new Date().toISOString(), snippets: [{ id: makeId("snippet"), text: title, createdAt: new Date().toISOString() }] }],
          };
    });
  return (
    <div className="page inbox-page">
      <form onSubmit={(event) => { event.preventDefault(); void addItem(); }}>
        <div className="inbox-add-fields">
          <input value={text} onChange={(event) => setText(event.target.value)} placeholder="先丟進來，之後再整理……" />
          <label className="inbox-file-picker inbox-add-media">新增影音<input aria-label="新增影音" type="file" accept="image/*,video/*" multiple onChange={(event) => { setSelectedFiles((current) => [...current, ...Array.from(event.target.files || [])]); event.target.value = ""; }} /></label>
          {selectedFiles.length > 0 && <div className="inbox-selected-files">{selectedFiles.map((file, index) => <button type="button" key={`${file.name}-${index}`} onClick={() => setSelectedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{file.name} ×</button>)}</div>}
          {message && <small className="inbox-import-message">{message}</small>}
        </div>
        <button disabled={busy || (!text.trim() && !selectedFiles.length)}>{busy ? "整理中……" : "加入收集箱"}</button>
      </form>
      <div className="inbox-items">
        {items.map((item) => (
          <article key={item.id} data-inbox-sort={item.id}>
            <span className="sort-handle" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); inboxDrag.current = { id: item.id, startY: event.clientY, active: false }; }} onPointerMove={(event) => { if (inboxDrag.current && Math.abs(event.clientY - inboxDrag.current.startY) > 5) inboxDrag.current.active = true; }} onPointerUp={(event) => { const drag = inboxDrag.current; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-inbox-sort]")?.dataset.inboxSort; inboxDrag.current = null; if (drag?.active && target) reorder(drag.id, target); }}>⋮⋮</span>
            <div className="inbox-item-main">
              {editingId === item.id ? (
                <textarea className="inbox-edit-area" autoFocus value={item.text} placeholder="補充素材說明……" onChange={(event) => setState((current) => ({ ...current, inbox: current.inbox.map((value) => value.id === item.id ? { ...value, text: event.target.value } : value) }))} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") setEditingId(""); }} />
              ) : <strong>{item.text || "素材收藏"}</strong>}
              <small>{new Date(item.createdAt).toLocaleString("zh-TW")}</small>
              {item.attachments?.length ? <div className="inbox-attachments" aria-label={`${item.attachments.length} 個素材預覽`}>{item.attachments.map((attachment, index) => {
                const preview = mediaSource(attachment, dataDirectory);
                const original = mediaSource(attachment, dataDirectory, true);
                return <div className="inbox-attachment-item" key={attachment.id} style={{ zIndex: index + 1 }}>
                  <button type="button" className="inbox-attachment-preview" title={attachment.originalName} aria-label={`預覽素材 ${attachment.originalName}`} onClick={() => setPreviewAttachment({ attachment, preview, original })}>
                    {attachment.mediaType === "video" ? <video muted preload="metadata" poster={preview} src={original} /> : <img src={preview} alt="" />}
                    <span className="inbox-attachment-name">{attachment.originalName}</span>
                  </button>
                  <button type="button" className="inbox-attachment-remove" aria-label={`移除 ${attachment.originalName}`} title={`移除 ${attachment.originalName}`} onClick={() => removeAttachment(item.id, attachment)}>×</button>
                </div>;
              })}</div> : null}
            </div>
            <div className="inbox-item-actions">
              <button onClick={() => setEditingId(editingId === item.id ? "" : item.id)}>{editingId === item.id ? "完成" : "編輯"}</button>
              <label className={`inbox-attach-more ${busyItemId === item.id ? "busy" : ""}`}>{busyItemId === item.id ? "匯入中…" : "新增影音"}<input aria-label={`新增影音到 ${item.text || "素材收藏"}`} type="file" accept="image/*,video/*" multiple disabled={Boolean(busyItemId)} onChange={(event) => { void addAttachments(item.id, Array.from(event.target.files || [])); event.target.value = ""; }} /></label>
              <button onClick={() => convert(item.id, "todo")}>轉待辦</button>
              <button onClick={() => convert(item.id, "snippet")}>轉碎念</button>
              <button onClick={() => remove(item.id)}>刪除</button>
            </div>
          </article>
        ))}
      </div>
      {previewAttachment && (
        <Modal
          eyebrow={previewAttachment.attachment.mediaType === "video" ? "VIDEO" : "PHOTO"}
          title={previewAttachment.attachment.originalName}
          onClose={() => setPreviewAttachment(null)}
          className="inbox-media-modal"
          footer={<button type="button" onClick={() => setPreviewAttachment(null)}>關閉預覽</button>}
        >
          <div className="inbox-media-stage">
            {previewAttachment.attachment.mediaType === "video"
              ? <video controls autoPlay preload="metadata" poster={previewAttachment.preview} src={previewAttachment.original} />
              : <img src={previewAttachment.original || previewAttachment.preview} alt={previewAttachment.attachment.originalName} />}
          </div>
        </Modal>
      )}
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
        type: "行事曆",
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
        title: x.text || x.attachments?.[0]?.originalName || "素材收藏",
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
    if (kind === "inbox") {
      state.inbox
        .find((item) => item.id === id)
        ?.attachments?.forEach((attachment) => void removeMediaFiles(attachment));
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
  isUat,
}: {
  state: AppState;
  setState: StateSetter;
  dataDirectory: string;
  changeDataDirectory: (path: string) => Promise<void>;
  isUat: boolean;
}) {
  const settings = state.settings;
  const [path, setPath] = useState(dataDirectory);
  const [pathMessage, setPathMessage] = useState("");
  const [backupPath, setBackupPath] = useState(settings.backupDirectory);
  const [restorePath, setRestorePath] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [petAppearanceUrl, setPetAppearanceUrl] = useState("");
  const [petAppearanceMessage, setPetAppearanceMessage] = useState("");
  const [petAppearanceBusy, setPetAppearanceBusy] = useState(false);
  const petAppearanceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!settings.petAppearancePath) {
      setPetAppearanceUrl("");
      return;
    }
    let active = true;
    void resolvePetAppearance(settings.petAppearancePath)
      .then((url) => {
        if (active) setPetAppearanceUrl(url);
      })
      .catch((error) => {
        if (active) {
          setPetAppearanceUrl("");
          setPetAppearanceMessage(
            `找不到已匯入的寵物圖片，將顯示內建預設外觀。${String(error)}`,
          );
        }
      });
    return () => {
      active = false;
    };
  }, [settings.petAppearancePath]);

  const importPetAppearance = async (file?: File) => {
    if (!file) return;
    setPetAppearanceMessage("");
    setPetAppearanceBusy(true);
    try {
      const fileError = await inspectPetAppearanceFile(file);
      if (fileError) {
        setPetAppearanceMessage(fileError);
        return;
      }
      if (!window.__TAURI_INTERNALS__) {
        setPetAppearanceMessage("請在 Windows 桌面版匯入，圖片才會保存到本機資料夾並在重開後保留。");
        return;
      }
      const relativePath = await storePetAppearance(file);
      const previewUrl = await resolvePetAppearance(relativePath);
      if (!previewUrl) throw new Error("無法預覽已匯入圖片，請重新選擇檔案。");
      setState((current) => ({
        ...current,
        settings: { ...current.settings, petAppearancePath: relativePath },
      }));
      setPetAppearanceUrl(previewUrl);
      setPetAppearanceMessage("匯入完成；App 內與桌面寵物已共用這張靜態圖片。原始檔可移動或刪除。 ");
    } catch (error) {
      setPetAppearanceMessage(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setPetAppearanceBusy(false);
    }
  };

  const restoreDefaultPetAppearance = () => {
    setState((current) => ({
      ...current,
      settings: { ...current.settings, petAppearancePath: "" },
    }));
    setPetAppearanceUrl("");
    setPetAppearanceMessage(`已還原${isUat ? " Q 版月娘" : "月光精靈"}內建預設外觀。`);
  };
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
        setState((current) => normalizeState({
          ...value,
          settings: { ...current.settings, ...value.settings },
        }));
    } catch {
      alert("這不是有效的月光簿備份檔。");
    }
  };
  return (
    <div className="page settings-grid">
      <Panel title="外觀">
        <Field label="顯示名稱">
          <input
            aria-label="顯示名稱"
            value={settings.userName}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                settings: { ...current.settings, userName: event.target.value },
              }))
            }
          />
        </Field>
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
        <Field label="介面字體大小">
          <select
            aria-label="介面字體大小"
            value={settings.fontScale || 1}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                settings: {
                  ...s.settings,
                  fontScale: Number(e.target.value),
                },
              }))
            }
          >
            <option value="1">標準（100%）</option>
            <option value="1.1">稍大（110%）</option>
            <option value="1.2">大（120%）</option>
            <option value="1.3">特大（130%）</option>
            <option value="1.4">更大（140%）</option>
          </select>
        </Field>
        <p className="setting-hint">調整介面文字與控制項的閱讀尺寸，不會改變資料內容。</p>
      </Panel>
      <Panel title="月光精靈設定">
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
            placeholder="貼上自訂聊天網址"
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
          可貼上外部聊天對話網址；月光精靈只有在你點擊時才會開啟此網址。
        </p>
      </Panel>
      <Panel title="寵物外觀自訂">
        <p className="setting-hint">
          同一張自訂圖片會用於 App 內寵物與 Windows 桌面寵物。未自訂時，{isUat ? "私人 UAT 使用 Q 版月娘" : "共用版使用月光精靈"}。
        </p>
        <div className="pet-appearance-preview" aria-live="polite">
          {petAppearanceUrl ? (
            <img src={petAppearanceUrl} alt="目前自訂的寵物外觀預覽" />
          ) : (
            <div className="pet-appearance-default">
              <span>內建預設</span>
              <strong>{isUat ? "Q 版月娘" : "月光精靈"}</strong>
            </div>
          )}
        </div>
        <div className="pet-appearance-actions">
          <label className="secondary pet-appearance-select">
            {petAppearanceBusy ? "正在匯入…" : "選擇圖片"}
            <input
              ref={petAppearanceInput}
              hidden
              type="file"
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              disabled={petAppearanceBusy}
              onChange={(event) => {
                void importPetAppearance(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button
            className="secondary"
            type="button"
            disabled={!settings.petAppearancePath || petAppearanceBusy}
            onClick={restoreDefaultPetAppearance}
          >
            還原預設外觀
          </button>
        </div>
        <ul className="pet-appearance-help">
          <li>支援靜態 PNG、JPG、JPEG；建議使用透明背景 PNG。</li>
          <li>檔案上限 10 MB；寬與高各須為 128–4096 px，不限制長寬比例。</li>
          <li>圖片會完整保留比例顯示，不會拉伸或裁切；自訂圖以靜態方式顯示，不提供動畫、影格或 FPS 設定。</li>
          <li>不支援 GIF、APNG、SVG、動畫圖片、精靈圖集或影片。</li>
          <li>匯入後會複製到目前月光簿的本機資料目錄並保存相對路徑；移動原始檔仍可使用。</li>
        </ul>
        {petAppearanceMessage && (
          <p className="pet-appearance-message" role="status">{petAppearanceMessage}</p>
        )}
      </Panel>
      <Panel title="資料與備份">
        <p className="muted">
          正式桌面版會把記錄保存到 SQLite，照片與影片原檔會依相簿放在同一資料位置的
          media/albums 資料夾；瀏覽器預覽使用 localStorage。
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
              placeholder="選擇備份資料夾"
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
            disabled={!window.__TAURI_INTERNALS__ || isUat}
            onChange={(e) => setPath(e.target.value)}
            placeholder={isUat ? "本機 UAT 專用資料夾" : "選擇資料夾"}
          />
        </Field>
        <button
          className="secondary"
          disabled={
            !window.__TAURI_INTERNALS__ || isUat || path.trim() === dataDirectory
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
        {isUat ? (
          <p className="setting-hint">
            UAT 測試資料固定保存在本機 D 槽，不會使用正式資料庫路徑。
          </p>
        ) : (
          pathMessage && <p className="path-message">{pathMessage}</p>
        )}
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
  privateUnlocked,
}: {
  onClose: () => void;
  setState: StateSetter;
  privateUnlocked: boolean;
}) {
  const [text, setText] = useState("");
  const [type, setType] = useState<"inbox" | "todo" | "diary">("inbox");
  useEffect(() => {
    if (!privateUnlocked && type === "diary") setType("inbox");
  }, [privateUnlocked, type]);
  const save = () => {
    if (!text.trim() || (type === "diary" && !privateUnlocked)) return;
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
                  color: "violet",
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
        {(privateUnlocked ? ["inbox", "todo", "diary"] as const : ["inbox", "todo"] as const).map((x) => (
          <button
            className={type === x ? "active" : ""}
            key={x}
            onClick={() => setType(x)}
          >
            {x === "inbox" ? "✧ 收集箱" : x === "todo" ? "✓ 待辦" : "✎ 日記"}
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
  privateUnlocked,
}: {
  state: AppState;
  onClose: () => void;
  setPage: (p: PageName) => void;
  privateUnlocked: boolean;
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
          type: "行事曆",
          title: x.title,
          page: "calendar" as PageName,
          date: x.date,
          status: "",
          hasImage: false,
        })),
      ...(privateUnlocked ? state.diaries : [])
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
        .filter(
          (x) =>
            !x.deletedAt &&
            (find(x.text) || (x.attachments || []).some((file) => find(file.originalName))),
        )
        .map((x) => ({
          type: "收集箱",
          title: x.text || x.attachments?.[0]?.originalName || "素材收藏",
          page: "inbox" as PageName,
          date: x.createdAt.slice(0, 10),
          status: "",
          hasImage: Boolean(x.attachments?.length),
        })),
      ...(privateUnlocked ? state.photos : [])
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
  }, [from, hasImage, privateUnlocked, q, state, status, to, type]);
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
          {["全部", "待辦", "行事曆", "日記", "筆記", "相簿", "收集箱"].map(
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

type FloatingPetAppearance = "shared-spirit" | "local-pet";
type LocalUatPetAssets = { rootDir: string; manifestJson: string };

function FloatingMoon({
  state,
  setState,
  isUat,
}: {
  state: AppState;
  setState: StateSetter;
  isUat: boolean;
}) {
  const s = state.settings;
  const appearance: FloatingPetAppearance = isUat ? "local-pet" : "shared-spirit";
  const [localPetAssets, setLocalPetAssets] = useState<LocalUatPetAssets | null>(null);
  const [customPetImageUrl, setCustomPetImageUrl] = useState("");
  const [interactionTrigger, setInteractionTrigger] = useState(0);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [drag, setDrag] = useState<{
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    if (appearance !== "local-pet" || !window.__TAURI_INTERNALS__) {
      setLocalPetAssets(null);
      return;
    }
    let active = true;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<LocalUatPetAssets>("load_local_uat_pet_assets"))
      .then((assets) => {
        if (active) setLocalPetAssets(assets);
      })
      .catch((error) => console.error("[UAT 寵物] 動畫素材載入失敗", error));
    return () => {
      active = false;
    };
  }, [appearance]);
  useEffect(() => {
    if (!s.petAppearancePath) {
      setCustomPetImageUrl("");
      return;
    }
    let active = true;
    void resolvePetAppearance(s.petAppearancePath)
      .then((url) => {
        if (active) setCustomPetImageUrl(url);
      })
      .catch((error) => {
        console.error("[寵物外觀] 自訂圖片載入失敗，改用內建預設", error);
        if (active) setCustomPetImageUrl("");
      });
    return () => {
      active = false;
    };
  }, [s.petAppearancePath]);
  useEffect(() => {
    const updateViewport = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);
  if (!s.showMoon) return null;
  const moonPosition = clampFloatingMoonPosition(
    {
      left: s.moonPosition.x * viewport.width,
      top: s.moonPosition.y * viewport.height,
    },
    s.moonSize,
    viewport,
  );
  const pointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false });
  };
  const pointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const { left: x, top: y } = clampFloatingMoonPosition(
      { left: e.clientX - drag.dx, top: e.clientY - drag.dy },
      s.moonSize,
      viewport,
    );
    setDrag({ ...drag, moved: true });
    setState((st) => ({
      ...st,
      settings: {
        ...st.settings,
        moonPosition: {
          x: x / Math.max(1, viewport.width),
          y: y / Math.max(1, viewport.height),
        },
      },
    }));
  };
  const pointerUp = async () => {
    if (drag && !drag.moved) {
      setInteractionTrigger((trigger) => trigger + 1);
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
      aria-label={appearance === "local-pet" ? "找寵物聊聊" : "找月光精靈聊聊"}
      className={`floating-moon${localPetAssets && !customPetImageUrl ? " uat-moon-lady" : ""}${customPetImageUrl ? " has-custom-pet" : ""}`}
      style={{
        width: s.moonSize,
        height: s.moonSize + 18,
        left: moonPosition.left,
        top: moonPosition.top,
      }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
    >
      {customPetImageUrl ? (
        <img className="custom-pet-image" src={customPetImageUrl} alt="自訂寵物外觀" />
      ) : localPetAssets ? (
        <SpritePetApp
          rootDir={localPetAssets.rootDir}
          manifestJson={localPetAssets.manifestJson}
          mode="inline"
          interactionTrigger={interactionTrigger}
        />
      ) : (
        <>
          <i className="spirit-orb">
            <i className="spirit-crescent" />
            <i className="spirit-eye left" />
            <i className="spirit-eye right" />
            <i className="spirit-smile" />
          </i>
          <span>✦</span>
        </>
      )}
      <small>{localPetAssets ? "月娘" : "月光精靈"}</small>
    </button>
  );
}

function PrivateAreaGate({
  state,
  onUnlock,
  onOpenVault,
}: {
  state: AppState;
  onUnlock: () => void;
  onOpenVault: () => void;
}) {
  const [username, setUsername] = useState(state.vault?.username || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setUsername(state.vault?.username || ""), [state.vault?.username]);
  const verify = async () => {
    if (!state.vault || !username.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      await unlockVault(state.vault, username.trim(), password);
      setPassword("");
      onUnlock();
    } catch {
      setError("帳號或主密碼錯誤，請再試一次。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page vault-lock">
      <section className="panel vault-gate private-area-gate">
        <div className="vault-mark">☾</div>
        <small>PRIVATE PAGES</small>
        <h2>日記與相簿已上鎖</h2>
        <p>使用密碼保管庫的帳號與主密碼解鎖。內容維持原本的本機儲存方式。</p>
        {state.vault ? (
          <>
            <label><span>保管庫帳號</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label><span>主密碼</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void verify(); }} /></label>
            {error && <p className="vault-error">{error}</p>}
            <button className="primary" disabled={busy || !username.trim() || !password} onClick={() => void verify()}>{busy ? "正在確認……" : "解鎖日記與相簿"}</button>
          </>
        ) : (
          <>
            <p className="vault-warning">請先建立密碼保管庫，日記與相簿會共用那組帳密。</p>
            <button className="primary" onClick={onOpenVault}>前往密碼保管庫</button>
          </>
        )}
      </section>
    </div>
  );
}

export default function App() {
  const {
    state,
    setState,
    ready,
    saveStatus,
    dataDirectory,
    isUat,
    changeDataDirectory,
  } = useAppState();
  const [page, setPage] = useState<PageName>("today");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [privacyUnlocked, setPrivacyUnlocked] = useState(false);
  const [privacyVaultFingerprint, setPrivacyVaultFingerprint] = useState("");
  const privacyIdle = useRef<number | undefined>(undefined);
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
  const currentVaultFingerprint = state.vault ? state.vault.username + "|" + state.vault.salt : "";
  useEffect(() => {
    if (!privacyUnlocked) return;
    const lock = () => {
      setPrivacyUnlocked(false);
      setPrivacyVaultFingerprint("");
    };
    const reset = () => {
      window.clearTimeout(privacyIdle.current);
      privacyIdle.current = window.setTimeout(lock, 5 * 60 * 1000);
    };
    const hidden = () => { if (document.hidden) lock(); };
    if (privacyVaultFingerprint !== currentVaultFingerprint) {
      lock();
      return;
    }
    for (const name of ["pointerdown", "keydown"] as const) window.addEventListener(name, reset);
    document.addEventListener("visibilitychange", hidden);
    reset();
    return () => {
      window.clearTimeout(privacyIdle.current);
      for (const name of ["pointerdown", "keydown"] as const) window.removeEventListener(name, reset);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [privacyUnlocked, privacyVaultFingerprint, currentVaultFingerprint]);
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
    (page === "diary" || page === "albums") && !privacyUnlocked ? (
      <PrivateAreaGate
        state={state}
        onUnlock={() => {
          setPrivacyVaultFingerprint(currentVaultFingerprint);
          setPrivacyUnlocked(true);
        }}
        onOpenVault={() => setPage("vault")}
      />
    ) : page === "today" ? (
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
      <InboxPage state={state} setState={setState} dataDirectory={dataDirectory} />
    ) : page === "trash" ? (
      <TrashPageNew state={state} setState={setState} />
    ) : (
      <SettingsPage
        state={state}
        setState={setState}
        dataDirectory={dataDirectory}
        changeDataDirectory={changeDataDirectory}
        isUat={isUat}
      />
    );
  return (
    <>
      <div
        className={`app ${state.settings.theme}`}
      style={{ "--font-scale": String(state.settings.fontScale || 1) } as CSSProperties}
    >
      <Sidebar
        page={page}
        setPage={setPage}
        inboxCount={state.inbox.filter((x) => !x.deletedAt).length}
        trashCount={trashCount}
        onCapture={() => setCapture(true)}
        open={sidebarOpen}
        setOpen={setSidebarOpen}
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
      {capture && (
        <QuickCapture onClose={() => setCapture(false)} setState={setState} privateUnlocked={privacyUnlocked} />
      )}{" "}
      {search && (
        <Search
          state={state}
          onClose={() => setSearch(false)}
          setPage={setPage}
          privateUnlocked={privacyUnlocked}
        />
      )}
      {!state.settings.setupCompleted && (
        <Modal
          title="歡迎來到月光簿"
          eyebrow="FIRST SETUP"
          onClose={() => setState((current) => ({
            ...current,
            settings: { ...current.settings, setupCompleted: true },
          }))}
          footer={
            <>
              <button
                className="secondary"
                onClick={() => setState((current) => ({
                  ...current,
                  settings: { ...current.settings, setupCompleted: true },
                }))}
              >
                稍後再設定
              </button>
              <button
                className="primary"
                disabled={!profileName.trim()}
                onClick={() => setState((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    userName: profileName.trim(),
                    setupCompleted: true,
                  },
                }))}
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
      <FloatingMoon state={state} setState={setState} isUat={isUat} />
    </>
  );
}
