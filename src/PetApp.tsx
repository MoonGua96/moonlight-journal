import { useEffect, type KeyboardEvent, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadState } from "./data/repository";

export default function PetApp() {
  useEffect(() => {
    document.documentElement.classList.add("pet-root");
    void loadState().then((state) => {
      if (window.__TAURI_INTERNALS__) {
        void invoke("set_pet_visible", { visible: state.settings.showDesktopPet });
      }
    });
    return () => document.documentElement.classList.remove("pet-root");
  }, []);

  const openJournal = async () => {
    if (window.__TAURI_INTERNALS__) {
      await invoke("show_main_window");
    }
  };

  const startDragging = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !window.__TAURI_INTERNALS__) return;
    event.preventDefault();
    void invoke("start_pet_drag");
  };

  const openWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void openJournal();
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
