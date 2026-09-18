import { argon2id } from "@noble/hashes/argon2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import type { VaultEnvelope } from "./types";

export interface VaultEntry {
  id: string;
  service: string;
  url: string;
  account: string;
  password: string;
  note: string;
  tags: string[];
  categoryId?: string;
  position?: number;
  updatedAt: string;
}

export interface VaultCategory {
  id: string;
  name: string;
  position: number;
}

export interface VaultContents {
  entries: VaultEntry[];
  categories: VaultCategory[];
}

const defaultCategories = (): VaultCategory[] =>
  ["遊戲", "金融", "社交軟體", "其他"].map((name, position) => ({
    id: `vault-category-${position}`,
    name,
    position,
  }));

const encode = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const decode = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const deriveKey = async (password: string, salt: Uint8Array) => {
  const raw = argon2id(utf8ToBytes(password), salt, {
    t: 2,
    m: 19 * 1024,
    p: 1,
    dkLen: 32,
  });
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
};

export async function sealVault(
  username: string,
  password: string,
  contents: VaultContents | { entries: VaultEntry[] },
  existingSalt?: string,
): Promise<VaultEnvelope> {
  const salt = existingSalt
    ? decode(existingSalt)
    : crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(contents));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  return {
    version: 1,
    username,
    salt: encode(salt),
    iv: encode(iv),
    ciphertext: encode(ciphertext),
    updatedAt: new Date().toISOString(),
  };
}

export async function unlockVault(
  envelope: VaultEnvelope,
  username: string,
  password: string,
): Promise<VaultContents> {
  if (username.trim() !== envelope.username)
    throw new Error("帳號或主密碼錯誤");
  try {
    const key = await deriveKey(password, decode(envelope.salt));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decode(envelope.iv) },
      key,
      decode(envelope.ciphertext),
    );
    const value = JSON.parse(
      new TextDecoder().decode(plaintext),
    ) as VaultContents;
    if (!Array.isArray(value.entries)) throw new Error("invalid vault");
    const categories =
      Array.isArray(value.categories) && value.categories.length
        ? value.categories
        : defaultCategories();
    return {
      categories,
      entries: value.entries.map((entry, position) => ({
        ...entry,
        categoryId: entry.categoryId || categories[0].id,
        position: entry.position ?? position,
      })),
    };
  } catch {
    throw new Error("帳號或主密碼錯誤");
  }
}

export async function changeVaultPassword(
  envelope: VaultEnvelope,
  currentPassword: string,
  newPassword: string,
): Promise<VaultEnvelope> {
  const contents = await unlockVault(
    envelope,
    envelope.username,
    currentPassword,
  );
  return sealVault(envelope.username, newPassword, contents);
}

export const emptyVault = (): VaultContents => ({
  entries: [],
  categories: defaultCategories(),
});
