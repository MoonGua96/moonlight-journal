import type {
  RecurrenceRuleSegment,
  RecurringEvent,
  Todo,
  TodoOccurrenceOverride,
  TodoStatus,
} from "./types";

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
  overdueDays?: number;
}

const parseDate = (value: string) => new Date(`${value}T12:00:00`);
const dayKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
const todayLocal = () => dayKey(new Date());
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

export function changeTodoStatus(todo: Todo, status: TodoStatus, date = todayLocal()): Todo {
  const pausePeriods = [...(todo.pausePeriods || [])];
  const donePeriods = [...(todo.donePeriods || [])];
  const openIndex = pausePeriods.reduce(
    (last, period, index) => !period.endDate ? index : last,
    -1,
  );
  const openDoneIndex = donePeriods.reduce(
    (last, period, index) => !period.endDate ? index : last,
    -1,
  );

  if (todo.status === status) {
    return { ...todo, pausePeriods, donePeriods };
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

  if (status === "done") {
    donePeriods.push({ startDate: date });
  } else if (todo.status === "done" && openDoneIndex >= 0) {
    const period = donePeriods[openDoneIndex];
    if (period.startDate < date) {
      donePeriods[openDoneIndex] = { ...period, endDate: previousDay(date) };
    } else {
      donePeriods.splice(openDoneIndex, 1);
    }
  }

  return { ...todo, status, pausePeriods, donePeriods };
}

/** Calendar history is preserved by default; callers may explicitly replace it on a date edit. */
export function resetProgressCalendarHistoryOnDateEdit(previous: Todo, updated: Todo, overwrite = false): Todo {
  const rangeChanged = previous.startDate !== updated.startDate || previous.endDate !== updated.endDate;
  if (
    overwrite &&
    previous.kind === "progress" &&
    updated.kind === "progress" &&
    rangeChanged
  ) {
    return { ...updated, donePeriods: [] };
  }
  return updated;
}

export function ensureTodoStatusPeriod(todo: Todo, date = todayLocal()): Todo {
  const pausePeriods = [...(todo.pausePeriods || [])];
  const donePeriods = [...(todo.donePeriods || [])];
  if (todo.status === "paused" && !pausePeriods.some((period) => !period.endDate)) {
    pausePeriods.push({ startDate: date });
  }
  if (todo.status === "done" && !donePeriods.some((period) => !period.endDate)) {
    donePeriods.push({ startDate: date });
  }
  return { ...todo, pausePeriods, donePeriods };
}

export function prepareTodoForSave(
  previous: Todo | undefined,
  updated: Todo,
  date = todayLocal(),
  options: { overwriteProgressCalendarHistory?: boolean } = {},
): Todo {
  if (!previous) return ensureTodoStatusPeriod(updated, date);
  const transition = previous.status === updated.status
    ? previous
    : changeTodoStatus(previous, updated.status, date);
  const transitioned = {
    ...updated,
    pausePeriods: transition.pausePeriods || [],
    donePeriods: transition.donePeriods || [],
  };
  return resetProgressCalendarHistoryOnDateEdit(previous, transitioned, options.overwriteProgressCalendarHistory);
}

export function promoteDueTodos(todos: Todo[], date = todayLocal()): Todo[] {
  let nextPosition = Math.max(
    -1,
    ...todos
      .filter((todo) => todo.status === "doing" && !todo.deletedAt && !todo.archivedAt)
      .map((todo) => todo.position),
  ) + 1;
  let changed = false;
  const next = todos.map((todo) => {
    const start = todo.startDate || todo.dueDate;
    if (todo.status !== "todo" || todo.deletedAt || todo.archivedAt || !start || start > date)
      return todo;
    changed = true;
    return { ...todo, status: "doing" as const, position: nextPosition++ };
  });
  return changed ? next : todos;
}

const oneCalendarMonthAfter = (date: string) => {
  const value = parseDate(date);
  const originalDay = value.getDate();
  value.setDate(1);
  value.setMonth(value.getMonth() + 1);
  const lastDay = daysInMonth(value.getFullYear(), value.getMonth());
  value.setDate(Math.min(originalDay, lastDay));
  return dayKey(value);
};

export function updateTodoLifecycle(todos: Todo[], date = todayLocal()): Todo[] {
  const promoted = promoteDueTodos(todos, date);
  let changed = promoted !== todos;
  const next = promoted.map((todo) => {
    if (todo.deletedAt || todo.archivedAt || todo.status !== "done") return todo;
    const completedOn = [...(todo.donePeriods || [])]
      .reverse()
      .find((period) => !period.endDate)?.startDate;
    if (!completedOn || oneCalendarMonthAfter(completedOn) > date) return todo;
    changed = true;
    return { ...todo, archivedAt: new Date().toISOString() };
  });
  return changed ? next : todos;
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
  const archivedAt = todo.archivedAt ? new Date(todo.archivedAt) : undefined;
  const archivedOn = archivedAt && !Number.isNaN(archivedAt.getTime())
    ? dayKey(archivedAt)
    : undefined;
  if (todo.deletedAt || (archivedOn && date > archivedOn) || isPausedAfterStart(todo, date)) return [];
  const inCompletedGap = (todo.donePeriods || []).some(
    (period) => date > period.startDate && (!period.endDate || date <= period.endDate),
  );
  if (inCompletedGap) return [];
  const kind = todo.kind || "task";
  let entries: TodoCalendarEntry[];
  if (kind === "progress") {
    const start = todo.startDate || todo.dueDate || "";
    const end = todo.endDate || todo.dueDate || start;
    const withinRange = Boolean(start && end && date >= start && date <= end);
    const completedOnDate = (todo.donePeriods || []).some((period) => period.startDate === date);
    const wasActiveOnDate = todo.status === "doing" || completedOnDate;
    const overdueDays = todo.status !== "done" && Boolean(end) && wasActiveOnDate && date > end && date <= todayLocal()
      ? Math.round((parseDate(date).getTime() - parseDate(end).getTime()) / 86_400_000)
      : 0;
    entries = withinRange || overdueDays > 0 || completedOnDate
      ? [{
          id: `${todo.id}:progress:${date}`,
          todoId: todo.id,
          date,
          kind: "progress",
          title: todo.title,
          time: "",
          color: todo.color,
          completed: completedOnDate,
          overdueDays: overdueDays || undefined,
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
    kind: "recurring",
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
