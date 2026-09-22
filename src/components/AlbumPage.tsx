import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { prepareMedia } from "../data/media";
import {
  ensureAlbumMediaDirectory,
  loadMediaBlob,
  mediaSource,
  openMediaLocation,
  storeMedia,
} from "../data/repository";
import {
  makeId,
  todayKey,
  type Album,
  type AlbumPhoto,
  type AppState,
} from "../data/types";

type Setter = Dispatch<SetStateAction<AppState>>;
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="modal-layer"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button aria-label="關閉" className="close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
const durationLabel = (seconds?: number) => {
  if (!seconds) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};
const dataUrlFile = (dataUrl: string, name: string) => {
  const [header, body] = dataUrl.split(",", 2);
  const mime = header.match(/^data:([^;]+)/)?.[1] || "application/octet-stream";
  const binary = atob(body || "");
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const extension = mime.split("/")[1]?.replace("jpeg", "jpg") || "bin";
  return new File([bytes], `${name}.${extension}`, { type: mime });
};

function VideoPlayer({ media }: { media: AlbumPhoto }) {
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void loadMediaBlob(media)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "影片載入失敗"),
      );
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media.id, media.originalPath, media.dataUrl]);
  if (error) return <p className="media-load-error">{error}</p>;
  if (!source) return <p className="media-loading">正在準備影片……</p>;
  return (
    <video className="media-player" controls preload="metadata" src={source} />
  );
}

export default function AlbumPage({
  state,
  setState,
  openDiary,
  dataDirectory,
}: {
  state: AppState;
  setState: Setter;
  openDiary: (date: string) => void;
  dataDirectory: string;
}) {
  const albums = state.albums
    .filter((x) => !x.deletedAt)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const albumDrag = useRef<{
    id: string;
    startY: number;
    active: boolean;
  } | null>(null);
  const [albumId, setAlbumId] = useState(albums[0]?.id || "");
  const album = albums.find((x) => x.id === albumId) || albums[0];
  const [editing, setEditing] = useState<AlbumPhoto | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const migrating = useRef(false);
  const albumFolder = (value?: Album) =>
    value?.mediaFolder || `album-${(value?.id || "legacy").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 72)}`;
  const photos = state.photos.filter(
    (x) => !x.deletedAt && x.albumId === album?.id,
  );

  // v0.3 stored complete data URLs in SQLite. Move them to v0.4 media folders once.
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__ || migrating.current) return;
    const legacy = state.photos.filter(
      (photo) => photo.dataUrl && !photo.originalPath,
    );
    if (!legacy.length) return;
    migrating.current = true;
    void (async () => {
      for (const photo of legacy) {
        try {
          const file = dataUrlFile(
            photo.dataUrl!,
            photo.title || "legacy-photo",
          );
          const prepared = await prepareMedia(file);
          const stored = await storeMedia(
            photo.id,
            file,
            prepared.previewDataUrl,
            albumFolder(state.albums.find((item) => item.id === photo.albumId) || albums[0]),
          );
          if (!("originalPath" in stored)) continue;
          setState((current) => ({
            ...current,
            photos: current.photos.map((item) =>
              item.id === photo.id
                ? {
                    ...item,
                    dataUrl: undefined,
                    previewDataUrl: undefined,
                    mediaType: prepared.mediaType,
                    originalName: file.name,
                    mimeType: file.type,
                    size: file.size,
                    originalPath: stored.originalPath,
                    previewPath: stored.previewPath,
                  }
                : item,
            ),
          }));
        } catch (error) {
          console.warn(`舊照片「${photo.title}」暫時無法搬移`, error);
        }
      }
      migrating.current = false;
    })();
  }, [setState, state.photos]);

  const addAlbum = () => {
    if (!name.trim()) return;
    const id = makeId("album");
    const folderTitle = name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 48) || "相簿";
    const next: Album = {
      id,
      title: name.trim(),
      description: "",
      createdAt: new Date().toISOString(),
      mediaFolder: `${folderTitle}-${id.slice(-8)}`,
      position: albums.length,
    };
    setState((current) => ({ ...current, albums: [...current.albums, next] }));
    void ensureAlbumMediaDirectory(next.mediaFolder!).catch((error) =>
      setImportMessage(`相簿已建立，但資料夾尚未建立：${error instanceof Error ? error.message : "請稍後重試"}`),
    );
    setAlbumId(next.id);
    setName("");
    setCreating(false);
  };

  const importMedia = async (files: FileList | null) => {
    if (!files || !album) return;
    let imported = 0;
    const failures: string[] = [];
    setImportMessage(`正在整理 ${files.length} 個媒體檔……`);
    for (const file of [...files]) {
      try {
        const id = makeId("media");
        const prepared = await prepareMedia(file);
        const folder = albumFolder(album);
        if (!album.mediaFolder) {
          setState((current) => ({
            ...current,
            albums: current.albums.map((item) =>
              item.id === album.id ? { ...item, mediaFolder: folder } : item,
            ),
          }));
        }
        const stored = await storeMedia(id, file, prepared.previewDataUrl, folder);
        const browser = "originalDataUrl" in stored;
        const item: AlbumPhoto = {
          id,
          albumId: album.id,
          title: file.name.replace(/\.[^.]+$/, ""),
          caption: "",
          takenDate: todayKey,
          tags: [],
          favorite: false,
          mediaType: prepared.mediaType,
          originalName: file.name,
          mimeType: file.type,
          size: file.size,
          duration: prepared.duration,
          dataUrl: browser
            ? prepared.mediaType === "video"
              ? stored.originalDataUrl
              : prepared.previewDataUrl
            : undefined,
          previewDataUrl: browser ? prepared.previewDataUrl : undefined,
          originalPath: browser ? undefined : stored.originalPath,
          previewPath: browser ? undefined : stored.previewPath,
          createdAt: new Date().toISOString(),
        };
        setState((current) => ({
          ...current,
          photos: [...current.photos, item],
        }));
        imported++;
      } catch (error) {
        failures.push(
          `${file.name}：${error instanceof Error ? error.message : "匯入失敗"}`,
        );
      }
    }
    setImportMessage(
      failures.length
        ? `已加入 ${imported} 個；${failures.length} 個未加入。${failures.join("、")}`
        : `✓ 已加入 ${imported} 個回憶`,
    );
  };

  const update = (item: AlbumPhoto) => {
    setEditing(item);
    setState((current) => ({
      ...current,
      photos: current.photos.map((photo) =>
        photo.id === item.id ? item : photo,
      ),
    }));
  };

  const removeAlbum = (target: Album) => {
    const count = state.photos.filter(
      (item) => !item.deletedAt && item.albumId === target.id,
    ).length;
    if (
      !confirm(
        `要把「${target.title}」${count ? `與裡面的 ${count} 個回憶` : ""}移到回收桶嗎？`,
      )
    )
      return;
    const deletedAt = new Date().toISOString();
    setState((current) => ({
      ...current,
      albums: current.albums.map((item) =>
        item.id === target.id ? { ...item, deletedAt } : item,
      ),
    }));
    if (albumId === target.id)
      setAlbumId(albums.find((item) => item.id !== target.id)?.id || "");
  };
  const finishAlbumDrag = (event: ReactPointerEvent) => {
    const drag = albumDrag.current;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-album-sort]")?.dataset.albumSort;
    albumDrag.current = null;
    if (!drag?.active || !target || target === drag.id) return;
    const ordered = [...albums];
    const from = ordered.findIndex((item) => item.id === drag.id),
      to = ordered.findIndex((item) => item.id === target);
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    setState((current) => ({
      ...current,
      albums: current.albums.map((item) => {
        const position = ordered.findIndex((entry) => entry.id === item.id);
        return position < 0 ? item : { ...item, position };
      }),
    }));
  };

  return (
    <div className="page album-layout">
      <aside>
        <div className="aside-head">
          <strong>我的相簿</strong>
          <button aria-label="新增相簿" onClick={() => setCreating(true)}>
            ＋
          </button>
        </div>
        {albums.map((item) => (
          <div
            className={`album-list-row ${item.id === album?.id ? "active" : ""}`}
            key={item.id}
            data-album-sort={item.id}
          >
            <span
              className="sort-handle"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                albumDrag.current = {
                  id: item.id,
                  startY: event.clientY,
                  active: false,
                };
              }}
              onPointerMove={(event) => {
                if (
                  albumDrag.current &&
                  Math.abs(event.clientY - albumDrag.current.startY) > 5
                )
                  albumDrag.current.active = true;
              }}
              onPointerUp={finishAlbumDrag}
            >
              ⋮⋮
            </span>
            <button
              className="album-select"
              onClick={() => setAlbumId(item.id)}
            >
              <strong>{item.title}</strong>
              <small>
                {
                  state.photos.filter(
                    (media) => !media.deletedAt && media.albumId === item.id,
                  ).length
                }{" "}
                個回憶
              </small>
            </button>
            <button
              className="album-delete"
              aria-label={`刪除相簿 ${item.title}`}
              title="刪除相簿"
              onClick={() => removeAlbum(item)}
            >
              ×
            </button>
          </div>
        ))}
      </aside>
      <article>
        {album ? (
          <>
            <div className="album-head">
              <div>
                <small>MEMORY ALBUM</small>
                <input
                  aria-label="相簿名稱"
                  value={album.title}
                  onChange={(e) =>
                    setState((current) => ({
                      ...current,
                      albums: current.albums.map((item) =>
                        item.id === album.id
                          ? { ...item, title: e.target.value }
                          : item,
                      ),
                    }))
                  }
                />
                <textarea
                  aria-label="相簿說明"
                  value={album.description}
                  onChange={(e) =>
                    setState((current) => ({
                      ...current,
                      albums: current.albums.map((item) =>
                        item.id === album.id
                          ? { ...item, description: e.target.value }
                          : item,
                      ),
                    }))
                  }
                />
              </div>
              <label className="primary">
                ＋ 加入照片或影片
                <input
                  hidden
                  multiple
                  type="file"
                  accept="image/*,video/*,.heic,.heif"
                  onChange={(e) => {
                    void importMedia(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {importMessage && (
              <p className="media-message" role="status">
                {importMessage}
              </p>
            )}
            {photos.length ? (
              <div className="photo-grid">
                {photos.map((item) => {
                  const type = item.mediaType || "image";
                  return (
                    <button key={item.id} onClick={() => setEditing(item)}>
                      <span className="media-thumb">
                        <img
                          src={mediaSource(item, dataDirectory)}
                          alt={item.title}
                        />
                        {type === "video" && (
                          <i className="video-badge">
                            ▶ {durationLabel(item.duration)}
                          </i>
                        )}
                      </span>
                      <span>
                        {item.favorite ? "★ " : ""}
                        {item.title}
                      </span>
                      <small>
                        {item.takenDate} · {type === "video" ? "影片" : "照片"}
                      </small>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="album-empty">
                <b>☾</b>
                <h3>這本相簿正在等第一道光</h3>
                <p>把珍貴的照片或影片放進來吧。</p>
              </div>
            )}
          </>
        ) : (
          <button className="primary" onClick={() => setCreating(true)}>
            ＋ 建立第一本相簿
          </button>
        )}
      </article>

      {creating && (
        <Modal title="建立相簿" onClose={() => setCreating(false)}>
          <Field label="名稱">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：旅行回憶"
            />
          </Field>
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={addAlbum}
          >
            建立
          </button>
        </Modal>
      )}

      {editing && (
        <Modal
          title={`編輯${(editing.mediaType || "image") === "video" ? "影片" : "照片"}`}
          onClose={() => setEditing(null)}
        >
          {(editing.mediaType || "image") === "video" ? (
            <VideoPlayer media={editing} />
          ) : (
            <img
              className="photo-preview"
              src={mediaSource(editing, dataDirectory)}
              alt={editing.title}
            />
          )}
          <Field label="標題">
            <input
              value={editing.title}
              onChange={(e) => update({ ...editing, title: e.target.value })}
            />
          </Field>
          <Field label="日期">
            <input
              type="date"
              value={editing.takenDate}
              onChange={(e) =>
                update({ ...editing, takenDate: e.target.value })
              }
            />
          </Field>
          <Field label="回憶">
            <textarea
              value={editing.caption}
              onChange={(e) => update({ ...editing, caption: e.target.value })}
            />
          </Field>
          <div className="photo-actions">
            <button
              className={`favorite ${editing.favorite ? "active" : ""}`}
              onClick={() =>
                update({ ...editing, favorite: !editing.favorite })
              }
            >
              {editing.favorite ? "★ 已收藏" : "☆ 收藏"}
            </button>
            <button
              className="secondary"
              disabled={!editing.originalPath}
              title={editing.originalPath ? "在檔案總管中選取原始檔" : "瀏覽器預覽沒有本機檔案位置"}
              onClick={() => {
                if (!editing.originalPath) {
                  setImportMessage("瀏覽器預覽沒有可開啟的本機檔案位置。桌面版可直接開啟。");
                  return;
                }
                void openMediaLocation(editing.originalPath).catch((error) =>
                  setImportMessage(error instanceof Error ? error.message : "無法開啟檔案位置"),
                );
              }}
            >
              ⌂ 開啟檔案位置
            </button>
            <button
              className="secondary"
              onClick={() => openDiary(editing.takenDate)}
            >
              ✎ 前往這天的日記
            </button>
            <button
              className="danger-link"
              onClick={() => {
                setState((current) => ({
                  ...current,
                  photos: current.photos.map((item) =>
                    item.id === editing.id
                      ? { ...item, deletedAt: new Date().toISOString() }
                      : item,
                  ),
                }));
                setEditing(null);
              }}
            >
              移到回收桶
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
