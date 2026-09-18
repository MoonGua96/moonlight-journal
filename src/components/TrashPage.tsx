import { useState, type Dispatch, type SetStateAction } from "react";
import { removeMediaFiles } from "../data/repository";
import type { AppState } from "../data/types";

type Setter = Dispatch<SetStateAction<AppState>>;
type Kind =
  | "calendarItems"
  | "recurringEvents"
  | "todos"
  | "diaries"
  | "notes"
  | "albums"
  | "photos"
  | "ledgerEntries"
  | "inbox";
type Row = { kind: Kind; id: string; title: string; type: string };
const keyOf = (row: Row) => `${row.kind}:${row.id}`;

export default function TrashPage({
  state,
  setState,
}: {
  state: AppState;
  setState: Setter;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows: Row[] = [
    ...state.calendarItems
      .filter((x) => x.deletedAt)
      .map((x) => ({
        kind: "calendarItems" as const,
        id: x.id,
        title: x.title,
        type: "月曆",
      })),
    ...state.recurringEvents
      .filter((x) => x.deletedAt)
      .map((x) => ({
        kind: "recurringEvents" as const,
        id: x.id,
        title: x.title,
        type: "固定行程",
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
        type: "相片／影片",
      })),
    ...state.ledgerEntries
      .filter((x) => x.deletedAt)
      .map((x) => ({
        kind: "ledgerEntries" as const,
        id: x.id,
        title: x.note || `${x.date} ${x.amount}`,
        type: "帳目",
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
  const chosen = rows.filter((row) => selected.has(keyOf(row)));
  const mutate = (
    current: AppState,
    targets: Row[],
    purge: boolean,
  ): AppState => {
    const ids = (kind: Kind) =>
      new Set(targets.filter((row) => row.kind === kind).map((row) => row.id));
    const update = <T extends { id: string; deletedAt?: string }>(
      items: T[],
      kind: Kind,
    ) =>
      purge
        ? items.filter((item) => !ids(kind).has(item.id))
        : items.map((item) =>
            ids(kind).has(item.id) ? { ...item, deletedAt: undefined } : item,
          );
    const diaryIds = ids("diaries");
    const albumIds = ids("albums");
    return {
      ...current,
      calendarItems: update(current.calendarItems, "calendarItems"),
      recurringEvents: update(current.recurringEvents, "recurringEvents"),
      todos: update(current.todos, "todos"),
      diaries: purge
        ? current.diaries.filter((item) => !diaryIds.has(item.date))
        : current.diaries.map((item) =>
            diaryIds.has(item.date) ? { ...item, deletedAt: undefined } : item,
          ),
      notes: update(current.notes, "notes"),
      albums: update(current.albums, "albums"),
      photos: purge
        ? update(current.photos, "photos").filter(
            (item) => !albumIds.has(item.albumId),
          )
        : update(current.photos, "photos"),
      ledgerEntries: update(current.ledgerEntries, "ledgerEntries"),
      inbox: update(current.inbox, "inbox"),
    };
  };
  const restore = (targets: Row[]) => {
    setState((current) => mutate(current, targets, false));
    setSelected(new Set());
  };
  const purge = (targets: Row[]) => {
    if (
      !targets.length ||
      !confirm(`確定永久刪除 ${targets.length} 個項目？這個動作無法復原。`)
    )
      return;
    const albumIds = new Set(
      targets.filter((row) => row.kind === "albums").map((row) => row.id),
    );
    state.photos
      .filter(
        (photo) =>
          targets.some((row) => row.kind === "photos" && row.id === photo.id) ||
          albumIds.has(photo.albumId),
      )
      .forEach((photo) => void removeMediaFiles(photo));
    setState((current) => mutate(current, targets, true));
    setSelected(new Set());
  };
  const toggle = (row: Row) =>
    setSelected((current) => {
      const next = new Set(current);
      const key = keyOf(row);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  if (!rows.length)
    return (
      <div className="page trash-page">
        <p className="empty">回收桶是空的。很好，沒有東西在哭。</p>
      </div>
    );
  return (
    <div className="page trash-page">
      <div className="trash-batch">
        <label>
          <input
            type="checkbox"
            checked={selected.size === rows.length}
            onChange={(event) =>
              setSelected(
                event.target.checked ? new Set(rows.map(keyOf)) : new Set(),
              )
            }
          />{" "}
          全選
        </label>
        <span>已選 {selected.size} 項</span>
        <button disabled={!selected.size} onClick={() => restore(chosen)}>
          批次復原
        </button>
        <button
          className="purge"
          disabled={!selected.size}
          onClick={() => purge(chosen)}
        >
          批次永久刪除
        </button>
      </div>
      {rows.map((row) => (
        <article key={keyOf(row)}>
          <input
            aria-label={`選取 ${row.title}`}
            type="checkbox"
            checked={selected.has(keyOf(row))}
            onChange={() => toggle(row)}
          />
          <span>{row.type}</span>
          <strong>{row.title}</strong>
          <div>
            <button onClick={() => restore([row])}>復原</button>
            <button className="purge" onClick={() => purge([row])}>
              永久刪除
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
