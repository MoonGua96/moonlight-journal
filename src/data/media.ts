export type PreparedMedia = {
  mediaType: "image" | "video";
  previewDataUrl: string;
  duration?: number;
};

const PREVIEW_MAX = 1600;

export async function prepareMedia(file: File): Promise<PreparedMedia> {
  const mediaType = await detectMediaType(file);
  if (mediaType === "image") {
    const source = isHeic(file) ? await convertHeic(file) : file;
    return { mediaType, previewDataUrl: await imagePreview(source) };
  }
  const result = await videoPreview(file);
  return { mediaType, ...result };
}

async function detectMediaType(file: File): Promise<"image" | "video"> {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (
    [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "webp",
      "bmp",
      "avif",
      "heic",
      "heif",
      "tif",
      "tiff",
    ].includes(ext)
  )
    return "image";
  if (["mp4", "mov", "m4v", "webm", "avi", "mkv"].includes(ext)) return "video";

  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image";
  if (
    ascii.includes("PNG") ||
    ascii.startsWith("GIF8") ||
    ascii.includes("WEBP")
  )
    return "image";
  if (ascii.includes("ftyp") || ascii.includes("webm")) return "video";
  throw new Error(`無法辨識「${file.name}」的媒體格式`);
}

function isHeic(file: File) {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

async function convertHeic(file: File) {
  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.9,
  });
  return Array.isArray(converted) ? converted[0] : converted;
}

async function imagePreview(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const scale = Math.min(
      1,
      PREVIEW_MAX / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("無法建立圖片預覽");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    throw new Error("這張圖片的格式目前無法解碼，原始檔沒有被修改");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("圖片解碼失敗"));
    image.src = url;
  });
}

function videoPreview(file: File) {
  return new Promise<{ previewDataUrl: string; duration?: number }>(
    (resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      let finished = false;
      const timeout = window.setTimeout(
        () => finish(new Error("影片讀取逾時")),
        15000,
      );
      const finish = (
        error?: Error,
        value?: { previewDataUrl: string; duration?: number },
      ) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        URL.revokeObjectURL(url);
        video.removeAttribute("src");
        video.load();
        error ? reject(error) : resolve(value!);
      };
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.onerror = () => finish(new Error("這段影片的編碼目前無法產生預覽"));
      video.onloadedmetadata = () => {
        const duration = Number.isFinite(video.duration)
          ? video.duration
          : undefined;
        video.currentTime = Math.min(duration ? duration / 2 : 0, 1);
      };
      video.onseeked = () => {
        const scale = Math.min(
          1,
          PREVIEW_MAX / Math.max(video.videoWidth, video.videoHeight),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) return finish(new Error("無法建立影片封面"));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(undefined, {
          previewDataUrl: canvas.toDataURL("image/jpeg", 0.82),
          duration: Number.isFinite(video.duration)
            ? video.duration
            : undefined,
        });
      };
      video.src = url;
    },
  );
}
