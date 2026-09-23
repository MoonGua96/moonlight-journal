import type { AppState } from "./types";
import { initialState, todayKey } from "./types";
import { nearestPaletteId } from "./colors";
import { convertFileSrc } from "@tauri-apps/api/core";
import { legacyRecurringEventToTodo } from "./todos";

const STORAGE_KEY = "moonlight-journal.v0.2.state";
const DATA_DIR_KEY = "moonlight-journal.data-directory";
let activeDataDirectory = "";

const cloneInitial = (): AppState => structuredClone(initialState);

export const normalizeState = (value: Partial<AppState>): AppState => {
  const base = cloneInitial();
  const normalizeColored = <T extends { color?: string; customColor?: string }>(item: T) => {
    const { customColor, ...rest } = item;
    return { ...rest, color: nearestPaletteId(customColor || item.color) };
  };
  const normalizedTodos = (value.todos || []).map((todo) => {
    const normalized = normalizeColored(todo);
    const pausePeriods = (todo.pausePeriods || []).filter(
      (period) => Boolean(period?.startDate),
    );
    const hasActivePause = pausePeriods.some((period) => !period.endDate);
    return {
      ...normalized,
      kind: todo.kind || "task",
      startDate: todo.startDate ?? todo.dueDate ?? "",
      endDate: todo.endDate ?? todo.dueDate ?? "",
      dueDate: todo.dueDate ?? todo.endDate ?? "",
      completedDates: todo.completedDates || [],
      pausePeriods:
        todo.status === "paused" && !hasActivePause
          ? [...pausePeriods, { startDate: todayKey }]
          : pausePeriods,
      progressLogs: (todo.progressLogs || []).map((log) => ({
        ...log,
        text: log.text || "",
      })),
      recurrence: todo.recurrence
        ? {
            ...todo.recurrence,
            rules: (todo.recurrence.rules || []).map((rule) => ({
              ...rule,
              ...(rule.color ? { color: nearestPaletteId(rule.color) } : {}),
              weekdays: rule.weekdays || [],
            })),
            exceptions: todo.recurrence.exceptions || [],
            overrides: Object.fromEntries(
              Object.entries(todo.recurrence.overrides || {}).map(([date, override]) => [
                date,
                {
                  ...override,
                  ...(override.color ? { color: nearestPaletteId(override.color) } : {}),
                },
              ]),
            ),
          }
        : undefined,
    };
  });
  const legacyCalendarTodos = (value.calendarItems || [])
    .filter((item) => item.type === "todo")
    .filter((item) => !normalizedTodos.some((todo) => todo.legacyCalendarItemId === item.id))
    .map((item, index) => ({
      id: `todo-calendar-${item.id}`,
      legacyCalendarItemId: item.id,
      title: item.title,
      description: "",
      kind: "task" as const,
      status: "todo" as const,
      color: nearestPaletteId(item.color),
      dueDate: item.date,
      startDate: item.date,
      endDate: item.date,
      position: normalizedTodos.filter((todo) => todo.status === "todo").length + index,
      completedDates: [],
    }));
  const migratedIds = new Set(
    normalizedTodos.map((todo) => todo.legacyRecurringId).filter(Boolean),
  );
  let nextDoingPosition = Math.max(
    -1,
    ...normalizedTodos
      .filter((todo) => todo.status === "doing" && !todo.deletedAt)
      .map((todo) => todo.position),
  ) + 1;
  const migratedRecurringTodos = (value.recurringEvents || [])
    .filter((event) => !migratedIds.has(event.id))
    .map((event) => {
      const normalized = {
        ...event,
        color: nearestPaletteId(event.color),
        overrides: Object.fromEntries(
          Object.entries(event.overrides || {}).map(([date, override]) => [
            date,
            {
              ...override,
              ...(override.color ? { color: nearestPaletteId(override.color) } : {}),
            },
          ]),
        ),
      };
      const todo = legacyRecurringEventToTodo(normalized, nextDoingPosition);
      if (!event.deletedAt) nextDoingPosition++;
      return todo;
    });
  return {
    ...base,
    ...value,
    birthdays: value.birthdays || [],
    holidays: value.holidays || base.holidays,
    // Weekly schedules from v0.8.0 are converted into the unified recurring
    // todo model. Their full legacy record is retained on the todo via its
    // recurrence rule, exceptions, overrides, and legacyRecurringId.
    recurringEvents: [],
    ledgerEntries: value.ledgerEntries || [],
    ledgerCategories: (value.ledgerCategories || []).map((category) => ({
      ...category,
      color:
        category.color ||
        (category.type === "income" ? "#5e8f78" : "#9a647d"),
    })),
    noteFolders: value.noteFolders || [],
    calendarItems: (value.calendarItems || [])
      .filter((item) => item.type !== "todo")
      .map((item) => normalizeColored(item)),
    todos: [...normalizedTodos, ...legacyCalendarTodos, ...migratedRecurringTodos],
    notes: (value.notes || []).map((note, index) => ({
      ...note,
      position: note.position ?? index,
      folderId: note.folderId || undefined,
      tabs:
        note.tabs && note.tabs.length
          ? note.tabs.map((tab, tabIndex) => ({
              ...tab,
              position: tab.position ?? tabIndex,
              sections: (tab.sections || []).map((section) => ({
                ...section,
                blocks:
                  section.blocks && section.blocks.length
                    ? section.blocks
                    : section.body
                      ? [
                          {
                            id: `${section.id}-paragraph`,
                            type: "paragraph" as const,
                            content: section.body,
                          },
                        ]
                      : [],
              })),
            }))
          : [
              {
                id: `${note.id}-tab-legacy`,
                title: "內容",
                sections: (note.sections || []).map((section) => ({
                  ...section,
                  blocks:
                    section.blocks && section.blocks.length
                      ? section.blocks
                      : section.body
                        ? [
                            {
                              id: `${section.id}-paragraph`,
                              type: "paragraph" as const,
                              content: section.body,
                            },
                          ]
                        : [],
                })),
                position: 0,
              },
            ],
    })),
    albums: (value.albums || base.albums).map((album, index) => ({
      ...album,
      position: album.position ?? index,
      mediaFolder:
        album.mediaFolder ||
        `album-${album.id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 72)}`,
    })),
    inbox: (value.inbox || []).map((item, index) => ({
      ...item,
      position: item.position ?? index,
    })),
    photos: (value.photos || []).map((photo) => ({
      ...photo,
      mediaType: photo.mediaType || "image",
    })),
    settings: {
      ...base.settings,
      ...(value.settings || {}),
      fontScale: Math.min(
        1.4,
        Math.max(1, Number(value.settings?.fontScale ?? base.settings.fontScale) || 1),
      ),
    },
  };
};
async function dataDirectory() {
  if (!window.__TAURI_INTERNALS__) return "瀏覽器預覽資料";
  if (activeDataDirectory) return activeDataDirectory;
  const saved = localStorage.getItem(DATA_DIR_KEY);
  if (saved) {
    activeDataDirectory = saved;
    return saved;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  activeDataDirectory = await invoke<string>("default_data_directory");
  localStorage.setItem(DATA_DIR_KEY, activeDataDirectory);
  return activeDataDirectory;
}
export async function getDataDirectory() {
  return dataDirectory();
}

export async function loadState(): Promise<AppState> {
  try {
    if (window.__TAURI_INTERNALS__) {
      const { invoke } = await import("@tauri-apps/api/core");
      const value = await invoke<string | null>("load_state", {
        dataDir: await dataDirectory(),
      });
      return value ? normalizeState(JSON.parse(value)) : cloneInitial();
    }
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? normalizeState(JSON.parse(value)) : cloneInitial();
  } catch (error) {
    console.error("無法讀取月光簿資料，改用初始資料。", error);
    return cloneInitial();
  }
}

export async function saveState(state: AppState): Promise<void> {
  const value = JSON.stringify(state);
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_state", {
      dataDir: await dataDirectory(),
      valueJson: value,
    });
    return;
  }
  localStorage.setItem(STORAGE_KEY, value);
}

export async function moveDataDirectory(path: string, state: AppState) {
  const clean = path.trim();
  if (!clean) throw new Error("資料夾不可空白");
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("move_data_directory", {
      sourceDir: await dataDirectory(),
      targetDir: clean,
      valueJson: JSON.stringify(state),
    });
  }
  activeDataDirectory = clean;
  localStorage.setItem(DATA_DIR_KEY, clean);
}

export async function storeMedia(
  id: string,
  file: File,
  previewDataUrl: string,
  albumFolder?: string,
) {
  if (!window.__TAURI_INTERNALS__) {
    return {
      dataUrl: previewDataUrl,
      originalDataUrl: await fileToDataUrl(file),
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<{ originalPath: string; previewPath: string }>("store_media", {
    dataDir: await dataDirectory(),
    mediaId: id,
    originalName: file.name,
    albumFolder: albumFolder || null,
    originalBase64: await fileToBase64(file),
    previewBase64: previewDataUrl.split(",", 2)[1] || "",
  });
}

export async function ensureAlbumMediaDirectory(folder: string) {
  if (!window.__TAURI_INTERNALS__) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("ensure_album_media_directory", {
    dataDir: await dataDirectory(),
    albumFolder: folder,
  });
}

export async function openMediaLocation(relativePath?: string) {
  if (!relativePath || !window.__TAURI_INTERNALS__) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reveal_media_location", {
    dataDir: await dataDirectory(),
    relativePath,
  });
}

export async function removeMediaFiles(photo: {
  originalPath?: string;
  previewPath?: string;
}) {
  if (!window.__TAURI_INTERNALS__) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("remove_media", {
    dataDir: await dataDirectory(),
    originalPath: photo.originalPath || "",
    previewPath: photo.previewPath || "",
  });
}

export async function loadMediaBlob(photo: {
  dataUrl?: string;
  originalPath?: string;
  mimeType?: string;
}) {
  if (!window.__TAURI_INTERNALS__) {
    if (!photo.dataUrl) throw new Error("找不到影片資料");
    return fetch(photo.dataUrl).then((response) => response.blob());
  }
  if (!photo.originalPath) throw new Error("找不到影片原始檔");
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await invoke<ArrayBuffer>("load_media", {
    dataDir: await dataDirectory(),
    relativePath: photo.originalPath,
  });
  return new Blob([bytes], { type: photo.mimeType || "video/mp4" });
}

export function mediaSource(
  photo: { dataUrl?: string; originalPath?: string; previewPath?: string },
  dataDir: string,
  original = false,
) {
  const path = original ? photo.originalPath : photo.previewPath;
  if (window.__TAURI_INTERNALS__ && path) {
    const normalized = `${dataDir.replace(/[\\/]$/, "")}/${path.replaceAll("\\", "/")}`;
    return convertFileSrc(normalized);
  }
  return original
    ? photo.dataUrl || ""
    : (photo as { previewDataUrl?: string }).previewDataUrl ||
        photo.dataUrl ||
        "";
}

const fileToBase64 = async (file: Blob) =>
  (await fileToDataUrl(file)).split(",", 2)[1] || "";

const fileToDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error || new Error("無法讀取媒體檔案"));
    reader.readAsDataURL(file);
  });

export async function exportState(state: AppState): Promise<void> {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `月光簿備份-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function createFullBackup(
  state: AppState,
  targetDir: string,
): Promise<string> {
  if (!window.__TAURI_INTERNALS__) throw new Error("完整備份只能在桌面版使用");
  await saveState(state);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("create_full_backup", {
    dataDir: await dataDirectory(),
    targetDir: targetDir.trim(),
    manifestJson: JSON.stringify({
      app: "moonlight-journal",
      version: 1,
      createdAt: new Date().toISOString(),
    }),
  });
}

export async function restoreFullBackup(backupDir: string): Promise<string> {
  if (!window.__TAURI_INTERNALS__) throw new Error("完整還原只能在桌面版使用");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("restore_full_backup", {
    dataDir: await dataDirectory(),
    backupDir: backupDir.trim(),
  });
}

export async function setDesktopPetVisible(visible: boolean) {
  if (!window.__TAURI_INTERNALS__) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_pet_visible", { visible });
}
