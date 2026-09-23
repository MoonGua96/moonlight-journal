import type {
  RecurrenceRuleSegment,
  RecurringEvent,
  Todo,
  TodoOccurrenceOverride,
  TodoStatus,
} from "./types";
import { todayKey } from "./types";

export interface TodoCalendarEntry {
  id: string;
  todoId: string;
  date: string;
  occurrenceDate?: string;
  kind: "todo" | "progress" | "move-hint" | "paused-hint";
  title: string;
  time: string;
  endTime?: string;
  color: Todo["color"];
  completed: boolean;
  movedTo?: string;
  pausedHint?: boolean;
}

const parseDate = (value: string) => new Date(`${value}T12:00:00`);
const dayKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
const daysInMonth = (year: number, month: number) =>
  new Date(year, month + 1, 0).getDate();

export const isMultiDayTodo = (todo: Todo) =>
  (todo.kind || "task") === "task" &&
  !todo.recurrence &&
  Boolean(todo.startDate && todo.endDate && todo.startDate < todo.endDate);

export const getMultiDayLength = (todo: Todo) => {
  if (!isMultiDayTodo(todo)) return 0;
  const start = parseDate(todo.startDate!);
  const end = parseDate(todo.endDate!);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
};

export const getMultiDayCompletedCount = (todo: Todo) => {
  if (!isMultiDayTodo(todo)) return 0;
  const completed = new Set(todo.completedDates || []);
  let count = 0;
  const date = parseDate(todo.startDate!);
  const end = todo.endDate!;
  while (dayKey(date) <= end) {
    if (completed.has(dayKey(date))) count++;
    date.setDate(date.getDate() + 1);
  }
  return count;
};

export const toggleTodoCompletion = (todo: Todo, occurrenceDate: string): Todo => {
  const values = new Set(todo.completedDates || []);
  if (values.has(occurrenceDate)) values.delete(occurrenceDate);
  else values.add(occurrenceDate);
  return { ...todo, completedDates: [...values].sort() };
};

const previousDay = (date: string) => {
  const value = parseDate(date);
  value.setDate(value.getDate() - 1);
  return dayKey(value);
};

export function changeTodoStatus(todo: Todo, status: TodoStatus, date = todayKey): Todo {
  const pausePeriods = [...(todo.pausePeriods || [])];
  const openIndex = pausePeriods.reduce(
    (last, period, index) => !period.endDate ? index : last,
    -1,
  );

  if (todo.status === status) {
    if (status === "paused" && openIndex < 0) pausePeriods.push({ startDate: date });
    return { ...todo, pausePeriods };
  }

  if (status === "paused") {
    pausePeriods.push({ startDate: date });
  } else if (todo.status === "paused" && openIndex >= 0) {
    const period = pausePeriods[openIndex];
    if (period.startDate < date) {
      pausePeriods[openIndex] = { ...period, endDate: previousDay(date) };
    } else {
      pausePeriods.splice(openIndex, 1);
    }
  }

  return { ...todo, status, pausePeriods };
}

const isPausedAfterStart = (todo: Todo, date: string) =>
  (todo.pausePeriods || []).some(
    (period) => date > period.startDate && (!period.endDate || date <= period.endDate),
  );

const pauseStartsOn = (todo: Todo, date: string) =>
  (todo.pausePeriods || []).some((period) => period.startDate === date);

export const getRuleForDate = (rules: RecurrenceRuleSegment[], date: string) =>
  [...rules]
    .sort((a, b) => b.fromDate.localeCompare(a.fromDate))
    .find(
      (rule) =>
        date >= rule.fromDate &&
        (!rule.throughDate || date <= rule.throughDate) &&
        (!rule.untilDate || date <= rule.untilDate),
    );

const isRuleOccurrence = (rule: RecurrenceRuleSegment, date: string) => {
  const current = parseDate(date);
  if (rule.frequency === "daily") return true;
  if (rule.frequency === "weekly") {
    const weekdays = rule.weekdays?.length
      ? rule.weekdays
      : [parseDate(rule.fromDate).getDay()];
    return weekdays.includes(current.getDay());
  }
  const dayOfMonth = Math.max(1, Math.min(31, rule.dayOfMonth || 1));
  return current.getDate() === Math.min(dayOfMonth, daysInMonth(current.getFullYear(), current.getMonth()));
};

const entryFromOccurrence = (
  todo: Todo,
  occurrenceDate: string,
  displayDate: string,
  override: TodoOccurrenceOverride | undefined,
  rule: RecurrenceRuleSegment,
): TodoCalendarEntry => ({
  id: `${todo.id}:${occurrenceDate}:${displayDate}`,
  todoId: todo.id,
  date: displayDate,
  occurrenceDate,
  kind: "todo",
  title: override?.title || rule.title || todo.title,
  time: override?.startTime ?? rule.startTime ?? "",
  endTime: override?.endTime ?? rule.endTime,
  color: override?.color || rule.color || todo.color,
  completed: (todo.completedDates || []).includes(occurrenceDate),
});

export function getTodoCalendarEntries(todo: Todo, date: string): TodoCalendarEntry[] {
  if (todo.deletedAt || todo.status === "todo" || isPausedAfterStart(todo, date)) return [];
  const kind = todo.kind || "task";
  let entries: TodoCalendarEntry[];
  if (kind === "progress") {
    const dueDate = todo.dueDate || todo.endDate || "";
    entries = dueDate === date
      ? [{
          id: `${todo.id}:deadline:${date}`,
          todoId: todo.id,
          date,
          kind: "progress",
          title: todo.title,
          time: "",
          color: todo.color,
          completed: false,
        }]
      : [];
  } else if (todo.recurrence?.rules?.length) {
    entries = [];
    const rule = getRuleForDate(todo.recurrence.rules, date);
    const exceptions = new Set(todo.recurrence.exceptions || []);
    if (rule && isRuleOccurrence(rule, date) && !exceptions.has(date)) {
      const override = todo.recurrence.overrides?.[date];
      if (!override?.cancelled) {
        if (override?.movedTo && override.movedTo !== date) {
          entries.push({
            id: `${todo.id}:moved:${date}`,
            todoId: todo.id,
            date,
            occurrenceDate: date,
            kind: "move-hint",
            title: todo.title,
            time: "",
            color: override.color || rule.color || todo.color,
            completed: false,
            movedTo: override.movedTo,
          });
        } else {
          entries.push(entryFromOccurrence(todo, date, date, override, rule));
        }
      }
    }
    for (const [occurrenceDate, override] of Object.entries(todo.recurrence.overrides || {})) {
      if (override.cancelled || override.movedTo !== date || occurrenceDate === date || exceptions.has(occurrenceDate)) continue;
      if (isPausedAfterStart(todo, occurrenceDate)) continue;
      const sourceRule = getRuleForDate(todo.recurrence.rules, occurrenceDate);
      if (!sourceRule || !isRuleOccurrence(sourceRule, occurrenceDate)) continue;
      entries.push(entryFromOccurrence(todo, occurrenceDate, date, override, sourceRule));
    }
  } else {
    const start = todo.startDate || todo.dueDate || "";
    const end = todo.endDate || todo.dueDate || start;
    entries = !start || !end || date < start || date > end
      ? []
      : [{
          id: `${todo.id}:${date}`,
          todoId: todo.id,
          date,
          occurrenceDate: date,
          kind: "todo",
          title: todo.title,
          time: todo.startTime || "",
          endTime: todo.endTime,
          color: todo.color,
          completed: (todo.completedDates || []).includes(date),
        }];
  }

  if (pauseStartsOn(todo, date)) {
    const occurrence = entries.find((entry) => entry.kind === "todo" && entry.date === date);
    if (occurrence) occurrence.pausedHint = true;
    else {
      entries.push({
        id: `${todo.id}:paused:${date}`,
        todoId: todo.id,
        date,
        kind: "paused-hint",
        title: todo.title,
        time: "",
        color: todo.color,
        completed: false,
      });
    }
  }

  return entries;
}

export function legacyRecurringEventToTodo(event: RecurringEvent, position: number): Todo {
  const rule: RecurrenceRuleSegment = {
    fromDate: event.startDate,
    untilDate: event.endDate,
    frequency: "weekly",
    weekdays: [event.weekday],
    startTime: event.startTime,
    endTime: event.endTime,
    title: event.title,
    color: event.color,
  };
  const overrides: NonNullable<Todo["recurrence"]>["overrides"] = {};
  for (const [date, value] of Object.entries(event.overrides || {})) {
    overrides[date] = {
      title: value.title,
      startTime: value.startTime,
      endTime: value.endTime,
      color: value.color,
    };
  }
  return {
    id: `todo-legacy-${event.id}`,
    legacyRecurringId: event.id,
    title: event.title,
    description: "",
    kind: "task",
    status: "doing",
    color: event.color,
    dueDate: event.endDate,
    startDate: event.startDate,
    endDate: event.endDate,
    position,
    completedDates: [],
    recurrence: {
      rules: [rule],
      exceptions: [...(event.exceptions || [])],
      overrides,
    },
    deletedAt: event.deletedAt,
  };
}

export function addRuleFromDate(
  recurrence: NonNullable<Todo["recurrence"]>,
  fromDate: string,
  nextRule: Omit<RecurrenceRuleSegment, "fromDate" | "throughDate">,
) {
  const before = new Date(`${fromDate}T12:00:00`);
  before.setDate(before.getDate() - 1);
  const cutoff = dayKey(before);
  const kept = recurrence.rules
    .filter((rule) => rule.fromDate < fromDate)
    .map((rule) => ({ ...rule, throughDate: rule.throughDate && rule.throughDate < cutoff ? rule.throughDate : cutoff }));
  return {
    ...recurrence,
    rules: [...kept, { ...nextRule, fromDate }].sort((a, b) => a.fromDate.localeCompare(b.fromDate)),
  };
}
