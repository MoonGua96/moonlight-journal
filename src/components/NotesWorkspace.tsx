import {
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import {
  makeId,
  type AppState,
  type Note,
  type NoteSection,
  type NoteTab,
} from "../data/types";
import NoteCanvas from "./NoteCanvas";

type Setter = Dispatch<SetStateAction<AppState>>;
type PointerDrag = {
  kind: "note" | "folder" | "tab";
  id: string;
  startX: number;
  startY: number;
  moved: boolean;
  overKind?: "note" | "folder" | "tab";
  overId?: string;
};

const byPosition = <T extends { position?: number }>(items: T[]) =>
  [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
const tabsForNote = (note?: Note): NoteTab[] =>
  note?.tabs?.length
    ? byPosition(note.tabs)
    : note
      ? [
          {
            id: `${note.id}-tab-legacy`,
            title: "內容",
            sections: note.sections,
            position: 0,
          },
        ]
      : [];

const moveById = <T extends { id: string }>(
  items: T[],
  fromId: string,
  toId: string,
) => {
  const next = [...items];
  const from = next.findIndex((item) => item.id === fromId);
  const to = next.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0 || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

export default function NotesWorkspace({
  state,
  setState,
}: {
  state: AppState;
  setState: Setter;
}) {
  const notes = byPosition(state.notes.filter((note) => !note.deletedAt));
  const [noteId, setNoteId] = useState(notes[0]?.id || "");
  const note = notes.find((item) => item.id === noteId) || notes[0];
  const tabs = tabsForNote(note);
  const [tabId, setTabId] = useState(tabs[0]?.id || "");
  const tab = tabs.find((item) => item.id === tabId) || tabs[0];
  const [sectionId, setSectionId] = useState(tab?.sections[0]?.id || "");
  const section =
    tab?.sections.find((item) => item.id === sectionId) || tab?.sections[0];
  const pointerDrag = useRef<PointerDrag | null>(null);
  const [dragView, setDragView] = useState<PointerDrag | null>(null);
  const folders = [...state.noteFolders].sort((a, b) => a.position - b.position);

  const updateNote = (next: Note) =>
    setState((current) => ({
      ...current,
      notes: current.notes.map((item) =>
        item.id === next.id
          ? {
              ...next,
              sections: next.tabs?.[0]?.sections || next.sections,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    }));

  const addNote = () => {
    const firstSection: NoteSection = {
      id: makeId("section"),
      title: "第一節",
      body: "",
      assets: [],
      blocks: [{ id: makeId("block"), type: "paragraph", content: "" }],
    };
    const firstTab: NoteTab = {
      id: makeId("tab"),
      title: "第一個主題",
      sections: [firstSection],
      position: 0,
    };
    const next: Note = {
      id: makeId("note"),
      title: "未命名筆記本",
      folder: "我的筆記",
      sections: [firstSection],
      tabs: [firstTab],
      position: notes.length,
      updatedAt: new Date().toISOString(),
    };
    setState((current) => ({ ...current, notes: [...current.notes, next] }));
    setNoteId(next.id);
    setTabId(firstTab.id);
    setSectionId(firstSection.id);
  };

  const reorderNote = (source: string, target: Note) => {
    if (!source || source === target.id) return;
    const reordered = moveById(notes, source, target.id);
    setState((current) => ({
      ...current,
      notes: current.notes.map((item) => {
        const position = reordered.findIndex((entry) => entry.id === item.id);
        return item.id === source
          ? { ...item, folderId: target.folderId, folder: "", position }
          : position < 0
            ? item
            : { ...item, position };
      }),
    }));
  };
  const reorderTab = (source: string, targetId: string) => {
    if (!note || !source || source === targetId) return;
    updateNote({
      ...note,
      tabs: moveById(tabs, source, targetId).map((item, position) => ({
        ...item,
        position,
      })),
    });
  };

  const selectNote = (next: Note) => {
    const nextTabs = tabsForNote(next);
    setNoteId(next.id);
    setTabId(nextTabs[0]?.id || "");
    setSectionId(nextTabs[0]?.sections[0]?.id || "");
  };
  const updateTab = (nextTab: NoteTab) =>
    note &&
    updateNote({
      ...note,
      tabs: tabs.map((item) => (item.id === nextTab.id ? nextTab : item)),
    });
  const moveToFolder = (id: string, folderId?: string) =>
    setState((current) => ({
      ...current,
      notes: current.notes.map((item) =>
        item.id === id ? { ...item, folderId, folder: "" } : item,
      ),
    }));

  const reorderFolder = (source: string, target: string) => {
    if (!source || source === target) return;
    const ordered = moveById(folders, source, target);
    setState((current) => ({
      ...current,
      noteFolders: current.noteFolders.map((item) => {
        const position = ordered.findIndex((entry) => entry.id === item.id);
        return position < 0 ? item : { ...item, position };
      }),
    }));
  };

  const startPointerDrag = (
    kind: PointerDrag["kind"],
    id: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = { kind, id, startX: event.clientX, startY: event.clientY, moved: false };
    pointerDrag.current = next;
    setDragView(next);
  };

  const movePointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = pointerDrag.current;
    if (!current) return;
    event.preventDefault();
    const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 4;
    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const noteTarget = target?.closest<HTMLElement>("[data-note-sort]");
    const folderTarget = target?.closest<HTMLElement>("[data-note-folder]");
    const tabTarget = target?.closest<HTMLElement>("[data-tab-sort]");
    const overKind: PointerDrag["overKind"] = current.kind === "note"
      ? noteTarget ? "note" : folderTarget ? "folder" : undefined
      : current.kind === "folder"
        ? folderTarget?.dataset.noteFolder ? "folder" : undefined
        : tabTarget ? "tab" : undefined;
    const overId = overKind === "note"
      ? noteTarget?.dataset.noteSort
      : overKind === "folder"
        ? folderTarget?.dataset.noteFolder
        : overKind === "tab"
          ? tabTarget?.dataset.tabSort
          : undefined;
    const next = { ...current, moved, overKind, overId };
    pointerDrag.current = next;
    setDragView(next);
  };

  const endPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = pointerDrag.current;
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    if (current.moved) {
      if (current.kind === "note" && current.overKind === "note") {
        const target = notes.find((item) => item.id === current.overId);
        if (target) reorderNote(current.id, target);
      } else if (current.kind === "note" && current.overKind === "folder") {
        moveToFolder(current.id, current.overId || undefined);
      } else if (current.kind === "folder" && current.overId) {
        reorderFolder(current.id, current.overId);
      } else if (current.kind === "tab" && current.overId) {
        reorderTab(current.id, current.overId);
      }
    }
    pointerDrag.current = null;
    setDragView(null);
  };

  const pointerHandle = (kind: PointerDrag["kind"], id: string, label: string) => (
    <button
      type="button"
      className="sort-handle"
      title="按住拖曳排序"
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => startPointerDrag(kind, id, event)}
      onPointerMove={movePointerDrag}
      onPointerUp={endPointerDrag}
      onPointerCancel={endPointerDrag}
    >⋮⋮</button>
  );

  const noteRow = (item: Note) => (
    <div
      key={item.id}
      data-note-sort={item.id}
      className={`sortable-note ${item.id === note.id ? "active" : ""} ${dragView?.overKind === "note" && dragView.overId === item.id ? "drag-over" : ""}`}
    >
      <button onClick={() => selectNote(item)}>
        <strong>{item.title}</strong>
        <small>{item.tabs?.length || 0} 個標籤</small>
      </button>
      {pointerHandle("note", item.id, `拖曳 ${item.title} 排序`)}
    </div>
  );

  if (!note)
    return (
      <div className="page">
        <p className="empty">還沒有筆記本</p>
        <button className="primary" onClick={addNote}>
          新增第一本筆記
        </button>
      </div>
    );
  return (
    <div className="page notes-layout notes-workspace">
      <aside>
        <div className="aside-head">
          <strong>我的筆記本</strong>
          <button aria-label="新增筆記本" onClick={addNote}>
            ＋
          </button>
        </div>
        <button
          className="add-note-folder"
          onClick={() => {
            const name = prompt("資料夾名稱")?.trim();
            if (!name) return;
            setState((current) => ({
              ...current,
              noteFolders: [...current.noteFolders, { id: makeId("note-folder"), name, position: current.noteFolders.length }],
            }));
          }}
        >＋ 新增資料夾</button>
        <section data-note-folder="" className={`note-folder ${dragView?.overKind === "folder" && dragView.overId === "" ? "drag-over" : ""}`}>
          <header><strong>未分類</strong><small>{notes.filter((item) => !item.folderId).length}</small></header>
          {notes.filter((item) => !item.folderId).map(noteRow)}
        </section>
        {folders.map((folder) => (
          <details data-note-folder={folder.id} className={`note-folder ${dragView?.overKind === "folder" && dragView.overId === folder.id ? "drag-over" : ""}`} key={folder.id} open>
            <summary>
              <span>▾ {folder.name}</span>
              <small>{notes.filter((item) => item.folderId === folder.id).length}</small>
              {pointerHandle("folder", folder.id, `拖曳資料夾 ${folder.name} 排序`)}
              <button aria-label={`編輯資料夾 ${folder.name}`} onClick={(event) => { event.preventDefault(); const name = prompt("資料夾名稱", folder.name)?.trim(); if (name) setState((current) => ({ ...current, noteFolders: current.noteFolders.map((item) => item.id === folder.id ? { ...item, name } : item) })); }}>✎</button>
              <button aria-label={`刪除資料夾 ${folder.name}`} onClick={(event) => { event.preventDefault(); if (!confirm(`刪除「${folder.name}」資料夾？裡面的筆記會移到未分類。`)) return; setState((current) => ({ ...current, noteFolders: current.noteFolders.filter((item) => item.id !== folder.id), notes: current.notes.map((item) => item.folderId === folder.id ? { ...item, folderId: undefined } : item) })); }}>×</button>
            </summary>
            {notes.filter((item) => item.folderId === folder.id).map(noteRow)}
          </details>
        ))}
      </aside>
      <article>
        <div className="note-sticky-head">
        <div className="note-meta">
          <select aria-label="筆記資料夾" value={note.folderId || ""} onChange={(event) => updateNote({ ...note, folderId: event.target.value || undefined, folder: "" })}>
            <option value="">未分類</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
          <details className="note-action-menu">
            <summary aria-label="筆記操作">•••</summary>
            <div>
              <button onClick={() => setState((current) => ({ ...current, notes: current.notes.map((item) => item.id === note.id ? { ...item, deletedAt: new Date().toISOString() } : item) }))}>將整本筆記移到回收桶</button>
            </div>
          </details>
        </div>
        <input
          aria-label="筆記本名稱"
          className="note-title"
          value={note.title}
          onChange={(event) =>
            updateNote({ ...note, title: event.target.value })
          }
        />
        <div className="tabs true-tabs">
          {tabs.map((item) => (
            <div
              key={item.id}
              data-tab-sort={item.id}
              className={`sortable-tab ${item.id === tab?.id ? "active" : ""} ${dragView?.overKind === "tab" && dragView.overId === item.id ? "drag-over" : ""}`}
            >
              <button
                onClick={() => {
                  setTabId(item.id);
                  setSectionId(item.sections[0]?.id || "");
                }}
              >
                {item.title}
              </button>
              {pointerHandle("tab", item.id, `拖曳 ${item.title} 排序`)}
            </div>
          ))}
          <button
            aria-label="新增標籤"
            onClick={() => {
              const first = {
                id: makeId("section"),
                title: "第一節",
                body: "",
                assets: [],
                blocks: [{ id: makeId("block"), type: "paragraph" as const, content: "" }],
              };
              const next = {
                id: makeId("tab"),
                title: `新標籤 ${tabs.length + 1}`,
                sections: [first],
                position: tabs.length,
              };
              updateNote({ ...note, tabs: [...tabs, next] });
              setTabId(next.id);
              setSectionId(first.id);
            }}
          >
            ＋
          </button>
        </div>
        </div>
        {tab && section && (
          <div className="note-work">
            <aside className="toc">
              <strong>本標籤目錄</strong>
              {tab.sections.map((item) => (
                <button
                  className={item.id === section.id ? "active" : ""}
                  key={item.id}
                  onClick={() => setSectionId(item.id)}
                >
                  {item.title}
                </button>
              ))}
              <button
                aria-label="新增章節"
                className="toc-add"
                onClick={() => {
                  const next = {
                    id: makeId("section"),
                    title: `新章節 ${tab.sections.length + 1}`,
                    body: "",
                    assets: [],
                    blocks: [
                      { id: makeId("block"), type: "paragraph" as const, content: "" },
                    ],
                  };
                  updateTab({ ...tab, sections: [...tab.sections, next] });
                  setSectionId(next.id);
                }}
              >
                ＋ 新增目錄章節
              </button>
            </aside>
            <div>
              <div className="section-toolbar">
                <input
                  aria-label="標籤名稱"
                  value={tab.title}
                  onChange={(event) =>
                    updateTab({ ...tab, title: event.target.value })
                  }
                />
                <details className="note-action-menu">
                  <summary aria-label="標籤與章節操作">•••</summary>
                  <div>
                    <button disabled={tab.sections.length === 1} onClick={() => { const rest = tab.sections.filter((item) => item.id !== section.id); updateTab({ ...tab, sections: rest }); setSectionId(rest[0]?.id || ""); }}>刪除目前章節</button>
                    <button disabled={tabs.length === 1} onClick={() => { const rest = tabs.filter((item) => item.id !== tab.id).map((item, position) => ({ ...item, position })); updateNote({ ...note, tabs: rest }); setTabId(rest[0]?.id || ""); setSectionId(rest[0]?.sections[0]?.id || ""); }}>刪除目前標籤</button>
                  </div>
                </details>
              </div>
              <input
                aria-label="章節名稱"
                className="section-title"
                value={section.title}
                onChange={(event) =>
                  updateTab({
                    ...tab,
                    sections: tab.sections.map((item) =>
                      item.id === section.id
                        ? { ...item, title: event.target.value }
                        : item,
                    ),
                  })
                }
              />
              <NoteCanvas
                blocks={section.blocks || []}
                onChange={(blocks) =>
                  updateTab({
                    ...tab,
                    sections: tab.sections.map((item) =>
                      item.id === section.id ? { ...item, blocks } : item,
                    ),
                  })
                }
              />
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
