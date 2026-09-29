import { describe, expect, it, vi } from "vitest";
import { normalizeState } from "../src/data/repository";
import {
  addRuleFromDate,
  changeTodoStatus,
  getMultiDayCompletedCount,
  getMultiDayLength,
  getTodoCalendarEntries,
  isMultiDayTodo,
  legacyRecurringEventToTodo,
  prepareTodoForSave,
  promoteDueTodos,
  toggleTodoCompletion,
} from "../src/data/todos";
import type { RecurringEvent, Todo } from "../src/data/types";

const baseTodo = (values: Partial<Todo>): Todo => ({
  id: "todo-1",
  title: "例行整理",
  description: "",
  kind: "task",
  status: "doing",
  color: "violet",
  dueDate: "",
  position: 0,
  ...values,
});

describe("v0.8.1 todo calendar rules", () => {
  it("repeated weekly days are independent completion instances", () => {
    const todo = baseTodo({
      startDate: "2026-09-21",
      recurrence: {
        rules: [{
          fromDate: "2026-09-21",
          frequency: "weekly",
          weekdays: [1, 2, 3],
        }],
        exceptions: [],
        overrides: {},
      },
    });
    const completedMonday = toggleTodoCompletion(todo, "2026-09-21");

    expect(getTodoCalendarEntries(completedMonday, "2026-09-21")[0].completed).toBe(true);
    expect(getTodoCalendarEntries(completedMonday, "2026-09-22")[0].completed).toBe(false);
    expect(getTodoCalendarEntries(completedMonday, "2026-09-23")[0].completed).toBe(false);
    expect(getTodoCalendarEntries(completedMonday, "2026-09-24")).toHaveLength(0);
    expect(completedMonday.status).toBe("doing");
  });

  it("monthly dates fall back to the last day of shorter months", () => {
    const todo = baseTodo({
      recurrence: {
        rules: [{ fromDate: "2027-01-31", frequency: "monthly", dayOfMonth: 31 }],
        exceptions: [],
        overrides: {},
      },
    });

    expect(getTodoCalendarEntries(todo, "2027-02-27")).toHaveLength(0);
    expect(getTodoCalendarEntries(todo, "2027-02-28")).toHaveLength(1);
    expect(getTodoCalendarEntries(todo, "2027-03-31")).toHaveLength(1);
  });

  it("future series edits split the rule at the selected occurrence", () => {
    const recurrence = {
      rules: [{ fromDate: "2026-09-21", untilDate: "2026-12-31", frequency: "weekly" as const, weekdays: [1] }],
      exceptions: ["2026-10-05"],
      overrides: { "2026-09-21": { title: "這一次的舊標題" } },
    };
    const changed = addRuleFromDate(recurrence, "2026-09-28", {
      frequency: "weekly",
      weekdays: [1, 3],
      startTime: "09:00",
      endTime: "10:00",
      untilDate: "2026-12-31",
    });

    expect(changed.rules).toEqual([
      { ...recurrence.rules[0], throughDate: "2026-09-27" },
      {
        fromDate: "2026-09-28",
        frequency: "weekly",
        weekdays: [1, 3],
        startTime: "09:00",
        endTime: "10:00",
        untilDate: "2026-12-31",
      },
    ]);
    expect(changed.exceptions).toEqual(["2026-10-05"]);
    expect(changed.overrides).toEqual(recurrence.overrides);
  });

  it("moving one repeated occurrence keeps its source completion date", () => {
    const todo = baseTodo({
      completedDates: ["2026-09-21"],
      recurrence: {
        rules: [{ fromDate: "2026-09-21", frequency: "weekly", weekdays: [1] }],
        exceptions: [],
        overrides: { "2026-09-21": { movedTo: "2026-09-22" } },
      },
    });

    expect(getTodoCalendarEntries(todo, "2026-09-21")[0]).toMatchObject({
      kind: "move-hint",
      movedTo: "2026-09-22",
    });
    expect(getTodoCalendarEntries(todo, "2026-09-22")[0]).toMatchObject({
      occurrenceDate: "2026-09-21",
      completed: true,
    });
    expect(getTodoCalendarEntries(todo, "2026-09-28")[0].completed).toBe(false);
  });

  it("multi-day tasks expose one independent checkbox per date", () => {
    const todo = baseTodo({
      startDate: "2026-09-20",
      endDate: "2026-09-22",
      dueDate: "2026-09-22",
    });
    const oneDayChecked = toggleTodoCompletion(todo, "2026-09-20");

    expect(isMultiDayTodo(oneDayChecked)).toBe(true);
    expect(getMultiDayLength(oneDayChecked)).toBe(3);
    expect(getMultiDayCompletedCount(oneDayChecked)).toBe(1);
    expect(getTodoCalendarEntries(oneDayChecked, "2026-09-20")[0].completed).toBe(true);
    expect(getTodoCalendarEntries(oneDayChecked, "2026-09-21")[0].completed).toBe(false);
    expect(oneDayChecked.status).toBe("doing");
  });

  it("dated todos appear in the calendar while still in the todo column", () => {
    const todo = baseTodo({ startDate: "2026-09-21", endDate: "2026-09-23" });
    expect(getTodoCalendarEntries({ ...todo, status: "todo" }, "2026-09-22")).toHaveLength(1);
    expect(getTodoCalendarEntries({ ...todo, status: "doing" }, "2026-09-22")).toHaveLength(1);
    expect(getTodoCalendarEntries({ ...todo, status: "done" }, "2026-09-22")).toHaveLength(1);
    expect(getTodoCalendarEntries({ ...todo, status: "done", archivedAt: "2026-09-24" }, "2026-09-22")).toHaveLength(1);
  });

  it("a paused recurring task keeps its pause day and hides later days", () => {
    const todo = baseTodo({
      recurrence: {
        rules: [{ fromDate: "2026-09-21", frequency: "daily" }],
        exceptions: [],
        overrides: {},
      },
    });
    const paused = changeTodoStatus(todo, "paused", "2026-09-22");

    expect(getTodoCalendarEntries(paused, "2026-09-21")).toHaveLength(1);
    expect(getTodoCalendarEntries(paused, "2026-09-22")[0]).toMatchObject({
      kind: "todo",
      pausedHint: true,
    });
    expect(getTodoCalendarEntries(paused, "2026-09-23")).toHaveLength(0);
  });

  it("shows a pause marker even when no recurring occurrence falls on that day", () => {
    const todo = baseTodo({
      recurrence: {
        rules: [{ fromDate: "2026-09-21", frequency: "weekly", weekdays: [1] }],
        exceptions: [],
        overrides: {},
      },
    });
    const paused = changeTodoStatus(todo, "paused", "2026-09-22");

    expect(getTodoCalendarEntries(paused, "2026-09-22")).toMatchObject([
      { kind: "paused-hint", title: "例行整理", time: "" },
    ]);
  });

  it("a resumed task records a closed pause range and resumes calendar occurrences", () => {
    const todo = baseTodo({
      recurrence: {
        rules: [{ fromDate: "2026-09-21", frequency: "daily" }],
        exceptions: [],
        overrides: {},
      },
    });
    const paused = changeTodoStatus(todo, "paused", "2026-09-22");
    const resumed = changeTodoStatus(paused, "doing", "2026-09-25");

    expect(resumed.pausePeriods).toEqual([{ startDate: "2026-09-22", endDate: "2026-09-24" }]);
    expect(getTodoCalendarEntries(resumed, "2026-09-23")).toHaveLength(0);
    expect(getTodoCalendarEntries(resumed, "2026-09-25")).toHaveLength(1);
  });

  it("legacy paused tasks get a stable first-open date", () => {
    const migrated = normalizeState({
      todos: [baseTodo({ status: "paused", startDate: "2026-09-20", endDate: "2026-09-30" })],
      calendarItems: [],
      recurringEvents: [],
    });
    const restored = normalizeState(migrated);

    expect(migrated.todos[0].pausePeriods).toEqual([{ startDate: expect.any(String) }]);
    expect(restored.todos[0].pausePeriods).toEqual(migrated.todos[0].pausePeriods);
  });

  it("legacy weekly schedules migrate once with their time and exceptions", () => {
    const event: RecurringEvent = {
      id: "old-schedule",
      title: "每週散步",
      weekday: 2,
      startTime: "18:00",
      endTime: "18:30",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      color: "sage",
      exceptions: ["2026-02-03"],
      overrides: { "2026-02-10": { startTime: "19:00" } },
    };
    const migrated = normalizeState({ recurringEvents: [event], todos: [], calendarItems: [] });
    const restoredAgain = normalizeState(migrated);

    expect(migrated.recurringEvents).toEqual([]);
    expect(migrated.todos).toHaveLength(1);
    expect(migrated.todos[0]).toMatchObject({
      legacyRecurringId: "old-schedule",
      status: "doing",
      recurrence: {
        rules: [{ startTime: "18:00", endTime: "18:30", weekdays: [2] }],
        exceptions: ["2026-02-03"],
        overrides: { "2026-02-10": { startTime: "19:00" } },
      },
    });
    expect(restoredAgain.todos).toHaveLength(1);
    expect(legacyRecurringEventToTodo(event, 0).title).toBe("每週散步");
  });

  it("long-term deadline is visible without a daily completion checkbox", () => {
    const todo = baseTodo({ kind: "progress", startDate: "2026-09-25", endDate: "2026-09-30", dueDate: "2026-09-30" });
    expect(getTodoCalendarEntries(todo, "2026-09-25")[0]).toMatchObject({
      kind: "progress",
      completed: false,
      time: "",
    });
    expect(getTodoCalendarEntries(todo, "2026-09-30")[0]).toMatchObject({
      kind: "progress",
      completed: false,
      time: "",
    });
    expect(getTodoCalendarEntries(todo, "2026-09-24")).toHaveLength(0);
  });

  it("reopening a long-term task preserves done dates and resumes from the reopened date", () => {
    const todo = baseTodo({ kind: "progress", startDate: "2026-09-20", endDate: "2026-10-05", dueDate: "2026-10-05" });
    const done = changeTodoStatus(todo, "done", "2026-09-24");
    const reopened = changeTodoStatus(done, "doing", "2026-09-27");

    expect(reopened.donePeriods).toEqual([{ startDate: "2026-09-24", endDate: "2026-09-26" }]);
    expect(getTodoCalendarEntries(reopened, "2026-09-24")).toHaveLength(1);
    expect(getTodoCalendarEntries(reopened, "2026-09-25")).toHaveLength(0);
    expect(getTodoCalendarEntries(reopened, "2026-09-26")).toHaveLength(0);
    expect(getTodoCalendarEntries(reopened, "2026-09-27")).toHaveLength(1);
  });

  it("promotes a dated todo on its local start date and leaves future items in todo", () => {
    const due = baseTodo({ status: "todo", startDate: "2026-09-27", endDate: "2026-09-30" });
    const future = baseTodo({ id: "future", status: "todo", startDate: "2026-09-29", endDate: "2026-09-30", position: 1 });
    const promoted = promoteDueTodos([due, future], "2026-09-28");

    expect(promoted[0]).toMatchObject({ status: "doing", position: 0 });
    expect(promoted[1]).toBe(future);
    expect(getTodoCalendarEntries(promoted[0], "2026-09-28")).toHaveLength(1);
  });

  it("a reopened long-term task displays a growing overdue marker after its deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T12:00:00+08:00"));
    try {
      const todo = baseTodo({ kind: "progress", status: "doing", startDate: "2026-09-20", endDate: "2026-09-27", dueDate: "2026-09-27" });
      expect(getTodoCalendarEntries(todo, "2026-09-28")[0]).toMatchObject({ kind: "progress", overdueDays: 1 });
      expect(getTodoCalendarEntries(todo, "2026-09-29")[0]).toMatchObject({ overdueDays: 2 });
      expect(getTodoCalendarEntries(todo, "2026-09-30")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves calendar gaps and overdue marks through the final completed day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T12:00:00+08:00"));
    try {
      const planned = baseTodo({ kind: "progress", startDate: "2026-09-01", endDate: "2026-09-30", dueDate: "2026-09-30" });
      const done = changeTodoStatus(planned, "done", "2026-09-20");
      expect(getTodoCalendarEntries(done, "2026-09-01")).toHaveLength(1);
      expect(getTodoCalendarEntries(done, "2026-09-20")[0]).toMatchObject({ completed: true });
      expect(getTodoCalendarEntries(done, "2026-09-21")).toHaveLength(0);
      const reopened = changeTodoStatus(done, "doing", "2026-09-29");

      expect(getTodoCalendarEntries(reopened, "2026-09-20")[0]).toMatchObject({ completed: true });
      expect(getTodoCalendarEntries(reopened, "2026-09-21")).toHaveLength(0);
      expect(getTodoCalendarEntries(reopened, "2026-09-28")).toHaveLength(0);
      expect(getTodoCalendarEntries(reopened, "2026-09-29")[0]).toMatchObject({ completed: false });
      expect(getTodoCalendarEntries(reopened, "2026-09-30")[0].overdueDays).toBeUndefined();
      expect(getTodoCalendarEntries(reopened, "2026-10-01")).toHaveLength(0);
      expect(getTodoCalendarEntries(reopened, "2026-10-02")).toHaveLength(0);

      vi.setSystemTime(new Date("2026-10-02T12:00:00+08:00"));
      expect(getTodoCalendarEntries(reopened, "2026-10-01")[0]).toMatchObject({ overdueDays: 1 });
      expect(getTodoCalendarEntries(reopened, "2026-10-02")[0]).toMatchObject({ overdueDays: 2 });

      const completedAgain = changeTodoStatus(reopened, "done", "2026-10-02");
      expect(getTodoCalendarEntries(completedAgain, "2026-10-01")[0]).toMatchObject({ overdueDays: 1 });
      expect(getTodoCalendarEntries(completedAgain, "2026-10-02")[0]).toMatchObject({ completed: true, overdueDays: 2 });
      expect(getTodoCalendarEntries(completedAgain, "2026-10-03")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("editing a done long-term task date range preserves history by default and can overwrite it", () => {
    const done = baseTodo({
      kind: "progress",
      status: "done",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      dueDate: "2026-09-30",
      donePeriods: [{ startDate: "2026-09-20" }],
      progressLogs: [{ id: "log-1", date: "2026-09-10", text: "已完成一部分", createdAt: "2026-09-10T12:00:00.000Z" }],
    });
    const edited = prepareTodoForSave(done, {
      ...done,
      startDate: "2026-09-20",
      endDate: "2026-09-21",
      dueDate: "2026-09-21",
    });
    const savedAgain = prepareTodoForSave(edited, { ...edited, title: "重新命名" });
    const overwritten = prepareTodoForSave(done, {
      ...done,
      startDate: "2026-09-20",
      endDate: "2026-09-21",
      dueDate: "2026-09-21",
    }, "2026-09-29", { overwriteProgressCalendarHistory: true });

    expect(edited.donePeriods).toEqual(done.donePeriods);
    expect(edited.progressLogs).toEqual(done.progressLogs);
    expect(savedAgain.donePeriods).toEqual(done.donePeriods);
    expect(getTodoCalendarEntries(edited, "2026-09-19")).toHaveLength(0);
    expect(getTodoCalendarEntries(edited, "2026-09-20")).toHaveLength(1);
    expect(getTodoCalendarEntries(edited, "2026-09-21")).toHaveLength(0);
    expect(getTodoCalendarEntries(edited, "2026-09-22")).toHaveLength(0);
    expect(overwritten.donePeriods).toEqual([]);
    expect(overwritten.progressLogs).toEqual(done.progressLogs);
    expect(getTodoCalendarEntries(overwritten, "2026-09-20")).toHaveLength(1);
    expect(getTodoCalendarEntries(overwritten, "2026-09-21")).toHaveLength(1);
  });

  it("editing dates while doing preserves prior done gaps and clips entries to the new range", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T12:00:00+08:00"));
    try {
    const todo = baseTodo({ kind: "progress", startDate: "2026-09-01", endDate: "2026-09-30", dueDate: "2026-09-30" });
    const done = changeTodoStatus(todo, "done", "2026-09-20");
    const reopened = changeTodoStatus(done, "doing", "2026-09-29");
    const startEdited = prepareTodoForSave(reopened, {
      ...reopened,
      startDate: "2026-09-22",
    });
    const edited = prepareTodoForSave(startEdited, {
      ...startEdited,
      endDate: "2026-10-03",
      dueDate: "2026-10-03",
    });

    expect(edited.donePeriods).toEqual(reopened.donePeriods);
    expect(getTodoCalendarEntries(startEdited, "2026-09-01")).toHaveLength(0);
    expect(getTodoCalendarEntries(startEdited, "2026-09-30")).toHaveLength(1);
    expect(getTodoCalendarEntries(startEdited, "2026-10-01")).toHaveLength(0);
    expect(getTodoCalendarEntries(edited, "2026-09-21")).toHaveLength(0);
    expect(getTodoCalendarEntries(edited, "2026-09-22")).toHaveLength(0);
    expect(getTodoCalendarEntries(edited, "2026-09-28")).toHaveLength(0);
    expect(getTodoCalendarEntries(edited, "2026-09-29")).toHaveLength(1);
    expect(getTodoCalendarEntries(edited, "2026-10-03")).toHaveLength(1);
    expect(getTodoCalendarEntries(edited, "2026-10-04")).toHaveLength(0);
    vi.setSystemTime(new Date("2026-10-04T12:00:00+08:00"));
    expect(getTodoCalendarEntries(edited, "2026-10-04")[0]).toMatchObject({ overdueDays: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});
