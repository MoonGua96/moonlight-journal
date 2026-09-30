import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadState, resolvePetAppearance } from "./data/repository";
import SpritePetApp from "./SpritePetApp";

type LocalUatPetAssets = { rootDir: string; manifestJson: string };

export default function PetApp() {
  const [assets, setAssets] = useState<LocalUatPetAssets | null>(null);
  const [customImageUrl, setCustomImageUrl] = useState("");

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    const refreshAppearance = async () => {
      try {
        const state = await loadState();
        if (!active) return;
        if (state.settings.petAppearancePath) {
          try {
            const url = await resolvePetAppearance(state.settings.petAppearancePath);
            if (active && url) {
              setCustomImageUrl(url);
              return;
            }
          } catch (error) {
            console.error("[桌面寵物] 自訂圖片載入失敗，改用內建預設", error);
          }
        }
        let localAssets: LocalUatPetAssets | null = null;
        try {
          localAssets = await invoke<LocalUatPetAssets>("load_local_uat_pet_assets");
        } catch {
          // The shared build has no private UAT pet assets and uses its neutral default.
        }
        if (active) {
          setCustomImageUrl("");
          setAssets(localAssets);
        }
      } catch (error) {
        console.error("[桌面寵物] 無法讀取外觀設定", error);
      }
    };
    void refreshAppearance();
    void listen("pet-appearance-changed", () => void refreshAppearance()).then((dispose) => {
      if (active) unlisten = dispose;
      else dispose();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  if (customImageUrl) return <CustomImagePet imageUrl={customImageUrl} />;
  return assets ? (
    <SpritePetApp rootDir={assets.rootDir} manifestJson={assets.manifestJson} />
  ) : (
    <NeutralPetApp />
  );
}

function CustomImagePet({ imageUrl }: { imageUrl: string }) {
  const [chatUrl, setChatUrl] = useState("");
  const clickTimer = useRef<number | null>(null);
  const tracking = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
    cleanup: () => void;
  } | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("pet-root");
    let active = true;
    void loadState().then((state) => {
      if (!active) return;
      setChatUrl(state.settings.chatUrl);
      const image = new Image();
      image.onload = () => {
        if (active && window.__TAURI_INTERNALS__) {
          void invoke("set_pet_visible", { visible: state.settings.showDesktopPet });
        }
      };
      image.onerror = () => console.error("[桌面寵物] 無法顯示自訂圖片");
      image.src = imageUrl;
    });
    return () => {
      active = false;
      document.documentElement.classList.remove("pet-root");
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      tracking.current?.cleanup();
      tracking.current = null;
    };
  }, [imageUrl]);

  const openJournal = () => {
    if (window.__TAURI_INTERNALS__) {
      void invoke("show_main_window").catch((error) => console.error("[桌面寵物] 開啟月光簿失敗", error));
    }
  };
  const queueClick = () => {
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      openJournal();
      return;
    }
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      if (chatUrl.trim()) {
        void import("@tauri-apps/plugin-opener")
          .then(({ openUrl }) => openUrl(chatUrl))
          .catch((error) => console.error("[桌面寵物] 開啟聊天網址失敗", error));
      } else {
        openJournal();
      }
    }, 240);
  };
  const startPointerTracking = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    tracking.current?.cleanup();
    const current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      cleanup: () => {},
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    const onMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== current.pointerId || current.moved) return;
      if (Math.hypot(pointerEvent.clientX - current.x, pointerEvent.clientY - current.y) < 5) return;
      current.moved = true;
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      if (window.__TAURI_INTERNALS__) {
        void invoke("start_pet_drag").catch((error) => console.error("[桌面寵物] 拖曳視窗失敗", error));
      }
    };
    const onEnd = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== current.pointerId) return;
      cleanup();
      if (tracking.current === current) tracking.current = null;
      if (!current.moved) queueClick();
    };
    current.cleanup = cleanup;
    tracking.current = current;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };
  const openWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openJournal();
  };

  return (
    <main className="desktop-pet">
      <button
        className="pet-character pet-custom-image"
        aria-label="打開月光簿"
        title="拖曳寵物移動；單擊互動；雙擊開啟"
        onPointerDown={startPointerTracking}
        onKeyDown={openWithKeyboard}
      >
        <img src={imageUrl} alt="自訂寵物" />
        <small>單擊互動・雙擊開啟</small>
      </button>
    </main>
  );
}

function NeutralPetApp() {
  useEffect(() => {
    document.documentElement.classList.add("pet-root");
    void loadState().then((state) => {
      if (window.__TAURI_INTERNALS__) {
        void invoke("set_pet_visible", { visible: state.settings.showDesktopPet });
      }
    });
    return () => document.documentElement.classList.remove("pet-root");
  }, []);

  const openWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void invoke("show_main_window");
  };

  const startDragging = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !window.__TAURI_INTERNALS__) return;
    event.preventDefault();
    void invoke("start_pet_drag");
  };

  return (
    <main className="desktop-pet">
      <button
        className="pet-character"
        aria-label="打開月光簿"
        title="按住月光精靈移動；連點兩下打開月光簿"
        onMouseDown={startDragging}
        onKeyDown={openWithKeyboard}
      >
        <i className="spirit-orb">
          <i className="spirit-crescent"></i>
          <i className="spirit-eye left"></i>
          <i className="spirit-eye right"></i>
          <i className="spirit-smile"></i>
        </i>
        <span>✦</span>
        <small>打開月光簿</small>
      </button>
    </main>
  );
}
