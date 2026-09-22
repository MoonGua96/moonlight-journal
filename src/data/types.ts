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

export interface CalendarItem {
  id: string;
  type: CalendarItemType;
  date: string;
  title: string;
  time: string;
  color: "purple" | "gold" | "sage" | "blue";
  customColor?: string;
  deletedAt?: string;
}

export interface Todo {
  id: string;
  title: string;
  description: string;
  status: TodoStatus;
  color: "purple" | "gold" | "sage" | "blue";
  customColor?: string;
  dueDate: string;
  startDate?: string;
  endDate?: string;
  position: number;
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

export type NoteBlockType = "paragraph" | "heading" | "bulletList" | "numberList" | "checkList" | "quote" | "image" | "drawing" | "table" | "divider";
export interface NoteBlock {
  id: string;
  type: NoteBlockType;
  content?: string;
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
  color: "purple" | "gold" | "sage" | "blue";
  customColor?: string;
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
