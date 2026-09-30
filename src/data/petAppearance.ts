export const MAX_PET_IMAGE_BYTES = 10 * 1024 * 1024;

export function petAppearanceFileError(
  fileName: string,
  fileSize: number,
  mimeType = "",
): string | null {
  const name = fileName.toLocaleLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const type = mimeType.toLocaleLowerCase();

  if (fileSize > MAX_PET_IMAGE_BYTES) {
    return "圖片檔案超過 10 MB，請縮小後再匯入。";
  }
  if (extension === ".svg" || type === "image/svg+xml") {
    return "不支援 SVG 向量圖；請匯入靜態 PNG、JPG 或 JPEG 圖片。";
  }
  if (extension === ".gif" || extension === ".apng" || type === "image/gif" || type === "image/apng") {
    return "不支援 GIF、APNG 或動畫圖片；請匯出單張靜態 PNG、JPG 或 JPEG。";
  }
  if (extension === ".webp" || extension === ".avif") {
    return "不支援 WebP 或 AVIF（含動畫版本）；目前只支援靜態 PNG、JPG 或 JPEG。";
  }
  if (
    /\.(mp4|m4v|mov|avi|wmv|webm|mkv|mpeg|mpg)$/.test(name) ||
    type.startsWith("video/")
  ) {
    return "不支援影片；請選擇一張靜態 PNG、JPG 或 JPEG 圖片。";
  }
  if (/sprite.?sheet|spritesheet|atlas|tileset|contact.?sheet|圖集|精靈圖集|動畫影格/.test(name)) {
    return "不支援精靈圖集或多格動畫影格；請改用一張完整的靜態角色圖片。";
  }
  if (![".png", ".jpg", ".jpeg"].includes(extension)) {
    return "目前只支援靜態 PNG、JPG 或 JPEG 圖片。";
  }
  return null;
}

export function looksLikeSvgDocument(text: string): boolean {
  let candidate = text.replace(/^\uFEFF/, "").trimStart();
  while (true) {
    if (candidate.startsWith("<!--")) {
      const end = candidate.indexOf("-->");
      if (end < 0) return false;
      candidate = candidate.slice(end + 3).trimStart();
      continue;
    }
    if (/^<\?xml\b/i.test(candidate)) {
      const end = candidate.indexOf("?>");
      if (end < 0) return false;
      candidate = candidate.slice(end + 2).trimStart();
      continue;
    }
    break;
  }
  return /^<!doctype\s+svg(?:\s|>)/i.test(candidate) || /^<svg(?:\s|\/?>)/i.test(candidate);
}

/** Detect the common transparent-cell layout used by PNG sprite atlases. */
export function hasTransparentSpriteGrid(
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): boolean {
  if (width < 4 || height < 4 || pixels.length < width * height * 4) return false;
  const isSeparatorLine = (length: number, pixelIndexAt: (position: number) => number) => {
    let transparent = 0;
    let opaque = 0;
    const min = [255, 255, 255];
    const max = [0, 0, 0];
    for (let position = 0; position < length; position++) {
      const index = pixelIndexAt(position);
      if (pixels[index + 3] <= 4) {
        transparent++;
        continue;
      }
      opaque++;
      for (let channel = 0; channel < 3; channel++) {
        min[channel] = Math.min(min[channel], pixels[index + channel]);
        max[channel] = Math.max(max[channel], pixels[index + channel]);
      }
    }
    if (transparent / length >= 0.99) return true;
    if (opaque / length < 0.99) return false;
    if (max.some((value, channel) => value - min[channel] > 3)) return false;
    return min.every((value) => value >= 248) || max.every((value) => value <= 8);
  };
  const blankRows = Array.from({ length: height }, (_, y) =>
    isSeparatorLine(width, (x) => (y * width + x) * 4),
  );
  const blankColumns = Array.from({ length: width }, (_, x) =>
    isSeparatorLine(height, (y) => (y * width + x) * 4),
  );
  const segments = (blank: boolean[]) => {
    const result: [number, number][] = [];
    let start = -1;
    for (let index = 0; index <= blank.length; index++) {
      if (index < blank.length && !blank[index]) {
        if (start < 0) start = index;
      } else if (start >= 0) {
        if (index - start >= 2) result.push([start, index]);
        start = -1;
      }
    }
    return result;
  };
  const rows = segments(blankRows);
  const columns = segments(blankColumns);
  if (rows.length < 2 || columns.length < 2 || rows.length * columns.length < 4) return false;

  let populatedCells = 0;
  for (const [top, bottom] of rows) {
    for (const [left, right] of columns) {
      let opaque = 0;
      const area = (bottom - top) * (right - left);
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          if (pixels[(y * width + x) * 4 + 3] > 24) opaque++;
        }
      }
      if (opaque / area >= 0.015) populatedCells++;
    }
  }
  return populatedCells >= 4;
}

export async function inspectPetAppearanceFile(file: File): Promise<string | null> {
  const quickError = petAppearanceFileError(file.name, file.size, file.type);
  if (quickError) return quickError;
  const extension = file.name.toLocaleLowerCase().slice(file.name.lastIndexOf("."));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPng = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const head = new TextDecoder().decode(bytes.subarray(0, 4096)).trimStart();

  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "不支援 GIF 動畫圖片；請匯出單張靜態 PNG、JPG 或 JPEG。";
  }
  if (looksLikeSvgDocument(head)) {
    return "不支援 SVG 向量圖；請匯入靜態 PNG、JPG 或 JPEG 圖片。";
  }
  const container = String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp"
    ? String.fromCharCode(...bytes.subarray(8, 12))
    : "";
  const isWebp =
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  if (isWebp || container === "avif" || container === "avis") {
    return "不支援 WebP 或 AVIF（含動畫版本）；目前只支援靜態 PNG、JPG 或 JPEG。";
  }
  const isVideo =
    (container !== "" && container !== "avif" && container !== "avis") ||
    (String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8, 12)) === "AVI ") ||
    [0x1a, 0x45, 0xdf, 0xa3].every((value, index) => bytes[index] === value) ||
    [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11].every((value, index) => bytes[index] === value) ||
    (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && [0xba, 0xb3].includes(bytes[3]));
  if (isVideo) return "不支援影片；請選擇一張靜態 PNG、JPG 或 JPEG 圖片。";
  if (extension === ".webp" || extension === ".avif") {
    return "不支援 WebP 或 AVIF（含動畫版本）；目前只支援靜態 PNG、JPG 或 JPEG。";
  }
  if (isPng) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
      const chunkType = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (chunkType === "acTL") {
        return "不支援 APNG 或動畫圖片；請匯出單張靜態 PNG、JPG 或 JPEG。";
      }
      if (length > bytes.length - offset - 12) break;
      offset += 12 + length;
      if (chunkType === "IEND") break;
    }
  }
  if ((extension === ".png" && !isPng) || ([".jpg", ".jpeg"].includes(extension) && !isJpeg)) {
    return "檔案內容與副檔名不符，或圖片資料損毀；請選擇有效的靜態 PNG、JPG 或 JPEG。";
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return "圖片資料損毀或無法解碼；請另存為有效的靜態 PNG、JPG 或 JPEG。";
  }
  try {
    if (bitmap.width < 128 || bitmap.height < 128 || bitmap.width > 4096 || bitmap.height > 4096) {
      return `圖片尺寸為 ${bitmap.width}×${bitmap.height} px；寬與高都必須在 128–4096 px 之間。`;
    }
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    if (hasTransparentSpriteGrid(width, height, context.getImageData(0, 0, width, height).data)) {
      return "偵測到多格透明圖集；目前只支援單張靜態角色圖片，請改用單張 PNG/JPG/JPEG。";
    }
    return null;
  } finally {
    bitmap.close();
  }
}
