import type { Birthday } from "./types";

const lunarFormatter = new Intl.DateTimeFormat("zh-TW-u-ca-chinese", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const monthNumbers: Record<string, number> = {
  正月: 1,
  二月: 2,
  三月: 3,
  四月: 4,
  五月: 5,
  六月: 6,
  七月: 7,
  八月: 8,
  九月: 9,
  十月: 10,
  冬月: 11,
  臘月: 12,
  十一月: 11,
  十二月: 12,
};

const lunarFestivals: Record<string, string> = {
  "1-1": "春節",
  "1-15": "元宵節",
  "5-5": "端午節",
  "7-7": "七夕",
  "7-15": "中元節",
  "8-15": "中秋節",
  "9-9": "重陽節",
  "12-8": "臘八",
};

const lunarDays = [
  "",
  "初一",
  "初二",
  "初三",
  "初四",
  "初五",
  "初六",
  "初七",
  "初八",
  "初九",
  "初十",
  "十一",
  "十二",
  "十三",
  "十四",
  "十五",
  "十六",
  "十七",
  "十八",
  "十九",
  "二十",
  "廿一",
  "廿二",
  "廿三",
  "廿四",
  "廿五",
  "廿六",
  "廿七",
  "廿八",
  "廿九",
  "三十",
];

const leapMonthCache = new Map<string, boolean>();
function lunarYearHasLeapMonth(lunarYear: number, month: number) {
  const key = `${lunarYear}-${month}`;
  const known = leapMonthCache.get(key);
  if (known !== undefined) return known;
  let found = false;
  const cursor = new Date(lunarYear - 1, 11, 1, 12);
  const end = new Date(lunarYear + 1, 2, 1, 12);
  while (cursor <= end) {
    const info = lunarInfo(cursor);
    if (info.year === lunarYear && info.month === month && info.leap) {
      found = true;
      break;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  leapMonthCache.set(key, found);
  return found;
}

export interface LunarInfo {
  year: number;
  month: number;
  day: number;
  leap: boolean;
  monthText: string;
  shortLabel: string;
  festival?: string;
}

export function lunarInfo(date: Date): LunarInfo {
  const parts = lunarFormatter.formatToParts(date);
  const monthText = parts.find((part) => part.type === "month")?.value || "";
  const leap = monthText.startsWith("閏");
  const cleanMonth = monthText.replace(/^閏/, "");
  const month = monthNumbers[cleanMonth] || 0;
  const day = Number(parts.find((part) => part.type === "day")?.value || 0);
  const year = Number(
    parts.find((part) => String(part.type) === "relatedYear")?.value ||
      date.getFullYear(),
  );
  const festival = leap ? undefined : lunarFestivals[`${month}-${day}`];
  return {
    year,
    month,
    day,
    leap,
    monthText,
    festival,
    shortLabel:
      festival || (day === 1 ? monthText : lunarDays[day] || String(day)),
  };
}

export function birthdayOnDate(birthday: Birthday, date: Date) {
  if (birthday.calendar === "solar")
    return (
      birthday.month === date.getMonth() + 1 && birthday.day === date.getDate()
    );
  const lunar = lunarInfo(date);
  const sameDay = birthday.month === lunar.month && birthday.day === lunar.day;
  if (!sameDay) return false;
  if (!birthday.leapMonth) return !lunar.leap;
  if (lunar.leap) return true;
  return (
    birthday.leapFallback === "regular" &&
    !lunarYearHasLeapMonth(lunar.year, birthday.month)
  );
}

export const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
