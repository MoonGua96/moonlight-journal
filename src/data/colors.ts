export const palette = [
  { id: "violet", label: "紫藤", base: "#7d63a8", light: "#eee8f7", dark: "#57456f" },
  { id: "lavender", label: "薰衣草", base: "#9a82c5", light: "#f0ebfa", dark: "#665582" },
  { id: "berry", label: "莓果", base: "#a85b83", light: "#faeaf2", dark: "#71405c" },
  { id: "coral", label: "珊瑚紅", base: "#d06a65", light: "#fff0ee", dark: "#803f42" },
  { id: "peach", label: "蜜桃橘", base: "#d58a63", light: "#fff1e8", dark: "#7f503b" },
  { id: "amber", label: "琥珀黃", base: "#c79a45", light: "#fff6df", dark: "#765c2e" },
  { id: "sage", label: "鼠尾草綠", base: "#6e9b80", light: "#eaf5ee", dark: "#3e6554" },
  { id: "mint", label: "薄荷綠", base: "#6db29b", light: "#e8f8f2", dark: "#397261" },
  { id: "teal", label: "青綠", base: "#4e9a9a", light: "#e5f6f5", dark: "#2f6668" },
  { id: "sky", label: "天空藍", base: "#6699c7", light: "#e8f2fc", dark: "#3c597b" },
  { id: "indigo", label: "靛藍", base: "#596ba8", light: "#e9edfb", dark: "#3f4d82" },
  { id: "slate", label: "灰藍", base: "#71849c", light: "#edf1f6", dark: "#4d5c70" },
] as const;

export type PaletteId = (typeof palette)[number]["id"];
export const paletteIds = palette.map((item) => item.id) as PaletteId[];
const legacyMap: Record<string, PaletteId> = {
  purple: "violet",
  gold: "amber",
  sage: "sage",
  blue: "sky",
  gray: "slate",
};

const rgb = (value: string) => {
  const raw = value.trim().replace(/^#/, "");
  const normalized = raw.length === 3 ? raw.split("").map((x) => x + x).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
};

export const nearestPaletteId = (value?: string): PaletteId => {
  if (value && legacyMap[value]) return legacyMap[value];
  if (value && palette.some((item) => item.id === value)) return value as PaletteId;
  const source = value ? rgb(value) : null;
  if (!source) return "violet";
  return palette.reduce((best, item) => {
    const candidate = rgb(item.base)!;
    const distance = candidate.reduce((sum, channel, index) => sum + (channel - source[index]) ** 2, 0);
    return distance < best.distance ? { id: item.id, distance } : best;
  }, { id: "violet" as PaletteId, distance: Number.POSITIVE_INFINITY }).id;
};

export const paletteItem = (id?: string) => palette.find((item) => item.id === nearestPaletteId(id)) || palette[0];

export const paletteStyle = (id?: string): CSSProperties => {
  const item = paletteItem(id);
  return {
    "--item-bg": item.light,
    "--item-bg-dark": item.dark,
    "--item-accent": item.base,
  } as CSSProperties;
};
import type { CSSProperties } from "react";
