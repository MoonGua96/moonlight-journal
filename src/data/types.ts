import type { PaletteId } from "./colors";

export type LegacyPaletteId = "purple" | "gold" | "sage" | "blue" | "gray";

export type PageName =
  | "today"
  | "calendar"
  | "todo"
  | "diary"
  | "notes"
  | "albums"
  | "ledger"
  | "vault"
  | "inbox"
  | "trash"
  | "settings";
export type CalendarItemType = "note" | "todo";
export type TodoStatus = "todo" | "doing" | "paused" | "done";
export type TodoKind = "task" | "progress";
export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export interface TodoOccurrenceOverride {
  movedTo?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  color?: PaletteId | LegacyPaletteId;
  cancelled?: boolean;
}

/** A rule segment lets a repeating series change from a selected occurrence onward. */
export interface RecurrenceRuleSegment {
  fromDate: string;
  throughDate?: string;
  untilDate?: string;
  frequency: RecurrenceFrequency;
  weekdays?: number[];
  dayOfMonth?: number;
  startTime?: string;
  endTime?: string;
  title?: string;
  color?: PaletteId | LegacyPaletteId;
}

export interface TodoRecurrence {
  rules: RecurrenceRuleSegment[];
  exceptions: string[];
  overrides: Record<string, TodoOccurrenceOverride>;
}

export interface ProgressLog {
  id: string;
  date: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
}

export interface TodoPausePeriod {
  startDate: string;
  /** Inclusive final day of the pause. Missing means the pause is still active. */
  endDate?: string;
}

export interface CalendarItem {
  id: string;
  type: CalendarItemType;
  date: string;
  title: string;
  time: string;
  endTime?: string;
  color: PaletteId | LegacyPaletteId;
  deletedAt?: string;
}

export interface Todo {
  id: string;
  title: string;
  description: string;
  kind?: TodoKind;
  status: TodoStatus;
  color: PaletteId | LegacyPaletteId;
  dueDate: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  position: number;
  /** Per-day completion for ordinary date-range tasks; per-occurrence completion for series. */
  completedDates?: string[];
  recurrence?: TodoRecurrence;
  progressLogs?: ProgressLog[];
  /** Paused periods are retained so calendar entries can resume correctly later. */
  pausePeriods?: TodoPausePeriod[];
  /** Keeps the legacy source identity available for migration auditing. */
  legacyRecurringId?: string;
  legacyCalendarItemId?: string;
  archivedAt?: string;
  deletedAt?: string;
}

export interface DiarySnippet {
  id: string;
  text: string;
  createdAt: string;
}

export interface DiaryEntry {
  date: string;
  title: string;
  body: string;
  /** Rich-text HTML added in v0.8; body remains for plain-text exports/backward compatibility. */
  bodyHtml?: string;
  snippets: DiarySnippet[];
  updatedAt: string;
  deletedAt?: string;
}

export interface Note {
  id: string;
  title: string;
  folder: string;
  folderId?: string;
  sections: NoteSection[];
  tabs?: NoteTab[];
  position?: number;
  updatedAt: string;
  deletedAt?: string;
}

export interface NoteFolder {
  id: string;
  name: string;
  position: number;
}

export type NoteBlockType =
  | "paragraph"
  | "heading"
  | "bulletList"
  | "numberList"
  | "checkList"
  | "quote"
  | "image"
  | "drawing"
  | "table"
  | "divider";

export interface NoteBlock {
  id: string;
  type: NoteBlockType;
  content?: string;
  /** Rich-text HTML for paragraph/heading/quote blocks. */
  html?: string;
  checked?: boolean[];
  dataUrl?: string;
  width?: number;
  rows?: number;
  columns?: number;
  cells?: string[];
}

export interface NoteTab {
  id: string;
  title: string;
  sections: NoteSection[];
  position: number;
}

export interface NoteAsset {
  id: string;
  type: "image" | "drawing";
  dataUrl: string;
  x: number;
  y: number;
  width: number;
}

export interface NoteSection {
  id: string;
  title: string;
  body: string;
  assets?: NoteAsset[];
  blocks?: NoteBlock[];
}

export interface InboxItem {
  id: string;
  text: string;
  createdAt: string;
  position?: number;
  deletedAt?: string;
}

export interface Album {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  coverPhotoId?: string;
  /** Stable folder name under media/albums; does not change when title is edited. */
  mediaFolder?: string;
  position?: number;
  deletedAt?: string;
}

export interface RecurringEvent {
  id: string;
  title: string;
  weekday: number;
  startTime: string;
  endTime: string;
  startDate: string;
  endDate: string;
  color: PaletteId | LegacyPaletteId;
  exceptions: string[];
  overrides: Record<
    string,
    Partial<Omit<RecurringEvent, "id" | "exceptions" | "overrides">>
  >;
  deletedAt?: string;
}

export interface LedgerEntry {
  id: string;
  type: "income" | "expense";
  amount: number;
  date: string;
  categoryId: string;
  account: string;
  note: string;
  createdAt: string;
  deletedAt?: string;
}

export interface LedgerCategory {
  id: string;
  name: string;
  type: "income" | "expense";
  position: number;
  color?: string;
}
export interface AlbumPhoto {
  id: string;
  albumId: string;
  title: string;
  caption: string;
  takenDate: string;
  tags: string[];
  favorite: boolean;
  /** v0.3 legacy/browser-preview source. Desktop v0.4 keeps media outside SQLite. */
  dataUrl?: string;
  previewDataUrl?: string;
  mediaType?: "image" | "video";
  originalName?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  originalPath?: string;
  previewPath?: string;
  createdAt: string;
  deletedAt?: string;
}

export interface Birthday {
  id: string;
  name: string;
  calendar: "solar" | "lunar";
  month: number;
  day: number;
  birthYear?: number;
  leapMonth?: boolean;
  leapFallback?: "regular" | "skip";
  note?: string;
  deletedAt?: string;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  type: "national" | "makeup" | "custom";
  deletedAt?: string;
}

export interface VaultEnvelope {
  version: 1;
  username: string;
  salt: string;
  iv: string;
  ciphertext: string;
  updatedAt: string;
}

export interface AppSettings {
  userName: string;
  setupCompleted: boolean;
  chatUrl: string;
  showMoon: boolean;
  moonSize: number;
  moonPosition: { x: number; y: number };
  theme: "light" | "dark";
  showDesktopPet: boolean;
  backupDirectory: string;
  /** 1 = default; larger values improve readability without changing stored content. */
  fontScale: number;
}

export interface AppState {
  calendarItems: CalendarItem[];
  todos: Todo[];
  diaries: DiaryEntry[];
  notes: Note[];
  noteFolders: NoteFolder[];
  albums: Album[];
  photos: AlbumPhoto[];
  birthdays: Birthday[];
  holidays: Holiday[];
  recurringEvents: RecurringEvent[];
  ledgerEntries: LedgerEntry[];
  ledgerCategories: LedgerCategory[];
  vault?: VaultEnvelope;
  inbox: InboxItem[];
  settings: AppSettings;
}

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const todayKey = localDateKey(new Date());
export const makeId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const initialState: AppState = {
  calendarItems: [],
  todos: [],
  diaries: [],
  notes: [],
  noteFolders: [],
  albums: [],
  photos: [],
  birthdays: [],
  holidays: [],
  recurringEvents: [],
  ledgerEntries: [],
  ledgerCategories: [],
  inbox: [],
  settings: {
    userName: "",
    setupCompleted: false,
    chatUrl: "",
    showMoon: true,
    moonSize: 86,
    moonPosition: { x: 0.88, y: 0.78 },
    theme: "light",
    showDesktopPet: true,
    backupDirectory: "",
    fontScale: 1,
  },
};
