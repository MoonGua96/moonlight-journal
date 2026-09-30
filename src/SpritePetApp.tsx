import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { loadState } from "./data/repository";

type AnimationKey =
  | "idle"
  | "click"
  | "double_click"
  | "stretch"
  | "look"
  | "hair_tuck"
  | "page_turn"
  | "rest"
  | "sleep_loop"
  | "wake";
type AnimationInfo = {
  label: string;
  frame_count: number;
  fps: number;
  loop_mode?: string;
  pages: string[];
};
type AnimationManifest = {
  render_fps: number;
  cell_px: [number, number];
  animations: Record<AnimationKey, AnimationInfo>;
};
type SpritePetAppProps = {
  rootDir: string;
  manifestJson: string;
  mode?: "desktop" | "inline";
  interactionTrigger?: number;
};
type PetStateKind = "loading" | "idle" | "action" | "sleep_enter" | "sleep" | "wake";
type PetAnimationState = {
  kind: PetStateKind;
  animation: AnimationKey;
  startedAt: number;
  duration: number;
};
type PointerTracking = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  cleanup: () => void;
};

const RANDOM_ACTIONS: AnimationKey[] = ["look", "hair_tuck", "page_turn", "stretch"];
const CELL_WIDTH = 320;
const CELL_HEIGHT = 384;
const FRAME_CONTENT_X = 32;
const FRAME_CONTENT_WIDTH = 256;
const ATLAS_COLUMNS = 4;
const FRAMES_PER_PAGE = 40;
const RENDER_FPS = 24;
const CLICK_DELAY_MS = 240;

export default function SpritePetApp({
  rootDir,
  manifestJson,
  mode = "desktop",
  interactionTrigger = 0,
}: SpritePetAppProps) {
  const animationManifest = JSON.parse(manifestJson) as AnimationManifest;
  const ANIMATIONS = animationManifest.animations;
  const [enabled, setEnabled] = useState<boolean | null>(mode === "inline" ? true : null);
  const [artReady, setArtReady] = useState(false);
  const artRef = useRef<HTMLCanvasElement>(null);
  const interactionRef = useRef<{ singleClick: () => void; doubleClick: () => void }>({
    singleClick: () => undefined,
    doubleClick: () => undefined,
  });
  const pendingClickRef = useRef<number | null>(null);
  const pointerTrackingRef = useRef<PointerTracking | null>(null);
  const lastInteractionTriggerRef = useRef(interactionTrigger);

  useEffect(() => {
    if (mode !== "desktop") return;
    document.documentElement.classList.add("pet-root");
    void loadState()
      .then((state) => {
        console.info("[桌面寵物] 設定讀取成功", { showDesktopPet: state.settings.showDesktopPet });
        setEnabled(state.settings.showDesktopPet);
      })
      .catch((error) => console.error("[桌面寵物] 設定讀取失敗", error));
    return () => document.documentElement.classList.remove("pet-root");
  }, [mode]);

  useEffect(() => {
    if (mode !== "desktop" || enabled === null || !window.__TAURI_INTERNALS__) return;
    const visible = enabled && artReady;
    console.info("[桌面寵物] 準備切換視窗", { enabled, artReady, visible });
    void invoke("set_pet_visible", { visible })
      .then(() => console.info("[桌面寵物] 視窗切換成功", { visible }))
      .catch((error) => console.error("[桌面寵物] 視窗切換失敗", error));
  }, [mode, enabled, artReady]);

  useEffect(() => {
    if (mode !== "inline" || !artReady || interactionTrigger === lastInteractionTriggerRef.current) return;
    lastInteractionTriggerRef.current = interactionTrigger;
    interactionRef.current.singleClick();
  }, [mode, artReady, interactionTrigger]);

  useEffect(() => {
    const canvas = artRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let canvasWidth = 0;
    let canvasHeight = 0;
    const resizeCanvas = () => {
      canvasWidth = canvas.clientWidth;
      canvasHeight = canvas.clientHeight;
      const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(canvasWidth * pixelRatio);
      canvas.height = Math.round(canvasHeight * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const animationCache = new Map<AnimationKey, HTMLImageElement[]>();
    const loadingAnimations = new Map<AnimationKey, Promise<HTMLImageElement[]>>();
    let animationFrame = 0;
    let disposed = false;
    let wallElapsed = 0;
    let scheduleElapsed = 0;
    let previousTick = 0;
    let lastDraw = 0;
    let sequenceRequest = 0;
    let pendingSequenceRequest = 0;
    let lastRandomAction: AnimationKey | "" = "";
    let nextVariationAt = randomBetween(30, 60);
    let nextSleepCheckAt = randomBetween(120, 180);
    let state: PetAnimationState = { kind: "loading", animation: "idle", startedAt: 0, duration: 0 };

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const pageUrl = (manifestPage: string) => {
      const filename = manifestPage.split("/").pop() ?? manifestPage;
      const base = rootDir.replace(/[\\/]+$/, "");
      return convertFileSrc(`${base}\\public\\media\\official\\${filename}`);
    };

    const loadAnimation = (animation: AnimationKey): Promise<HTMLImageElement[]> => {
      const cached = animationCache.get(animation);
      if (cached) return Promise.resolve(cached);
      const pending = loadingAnimations.get(animation);
      if (pending) return pending;

      const task = Promise.all(
        ANIMATIONS[animation].pages.map(
          (manifestPage) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const image = new Image();
              image.onload = () => resolve(image);
              image.onerror = () => reject(new Error(`無法載入動畫素材：${pageUrl(manifestPage)}`));
              image.src = pageUrl(manifestPage);
            }),
        ),
      )
        .then((pages) => {
          animationCache.set(animation, pages);
          loadingAnimations.delete(animation);
          return pages;
        })
        .catch((error: unknown) => {
          loadingAnimations.delete(animation);
          throw error;
        });
      loadingAnimations.set(animation, task);
      return task;
    };

    const releaseAnimation = (animation: AnimationKey) => {
      if (animation !== "idle") animationCache.delete(animation);
    };

    const releaseUnusedAnimations = (activeAnimation: AnimationKey, preserved: AnimationKey[] = []) => {
      const retained = new Set<AnimationKey>(["idle", activeAnimation, ...preserved]);
      for (const animation of animationCache.keys()) {
        if (!retained.has(animation)) releaseAnimation(animation);
      }
    };

    const resetScheduleAfterInteraction = () => {
      nextVariationAt = scheduleElapsed + randomBetween(30, 60);
      nextSleepCheckAt = scheduleElapsed + randomBetween(120, 180);
    };

    const setAnimationState = (kind: PetStateKind, animation: AnimationKey, duration = 0) => {
      state = { kind, animation, startedAt: wallElapsed, duration };
    };

    const playSequence = async (kind: PetStateKind, animation: AnimationKey) => {
      const request = ++sequenceRequest;
      pendingSequenceRequest = request;
      const previousAnimation = state.animation;
      try {
        await loadAnimation(animation);
      } catch (error) {
        if (request === sequenceRequest) {
          pendingSequenceRequest = 0;
          console.error("[桌面寵物] 動畫素材載入失敗", error);
        }
        return;
      }
      if (disposed || request !== sequenceRequest) return;
      pendingSequenceRequest = 0;
      setAnimationState(kind, animation, ANIMATIONS[animation].frame_count / ANIMATIONS[animation].fps);
      releaseUnusedAnimations(animation);
      if (previousAnimation !== animation && previousAnimation !== "idle") releaseAnimation(previousAnimation);
    };

    const startSleep = () => {
      void (async () => {
        const request = ++sequenceRequest;
        pendingSequenceRequest = request;
        const previousAnimation = state.animation;
        try {
          await Promise.all([loadAnimation("rest"), loadAnimation("sleep_loop")]);
        } catch (error) {
          if (request === sequenceRequest) {
            pendingSequenceRequest = 0;
            console.error("[桌面寵物] 休息動畫載入失敗", error);
          }
          return;
        }
        if (disposed || request !== sequenceRequest) return;
        pendingSequenceRequest = 0;
        setAnimationState("sleep_enter", "rest", ANIMATIONS.rest.frame_count / ANIMATIONS.rest.fps);
        releaseUnusedAnimations("rest", ["sleep_loop"]);
        if (previousAnimation !== "idle" && previousAnimation !== "rest") releaseAnimation(previousAnimation);
      })();
    };

    const startWake = () => {
      void playSequence("wake", "wake");
    };

    const startAction = (animation: AnimationKey) => {
      lastRandomAction = animation;
      void playSequence("action", animation);
    };

    const beginClickResponse = () => {
      const isSleeping = state.kind === "sleep" || state.kind === "sleep_enter";
      resetScheduleAfterInteraction();
      if (isSleeping) startWake();
      else void playSequence("action", "click");
    };

    const beginLaunchResponse = () => {
      const isSleeping = state.kind === "sleep" || state.kind === "sleep_enter";
      resetScheduleAfterInteraction();
      if (isSleeping) startWake();
      else void playSequence("action", "double_click");
      if (window.__TAURI_INTERNALS__) {
        void invoke("show_main_window").catch((error) => console.error("[桌面寵物] 開啟主視窗失敗", error));
      }
    };

    const drawSequence = (animation: AnimationKey, frame: number) => {
      const pages = animationCache.get(animation);
      if (!pages) return false;
      const pageIndex = Math.floor(frame / FRAMES_PER_PAGE);
      const localFrame = frame - pageIndex * FRAMES_PER_PAGE;
      const image = pages[pageIndex];
      if (!image) return false;

      const sourceX = (localFrame % ATLAS_COLUMNS) * CELL_WIDTH + FRAME_CONTENT_X;
      const sourceY = Math.floor(localFrame / ATLAS_COLUMNS) * CELL_HEIGHT;
      context.clearRect(0, 0, canvasWidth, canvasHeight);
      const scale = Math.min(canvasWidth / FRAME_CONTENT_WIDTH, canvasHeight / CELL_HEIGHT);
      const drawWidth = FRAME_CONTENT_WIDTH * scale;
      const drawHeight = CELL_HEIGHT * scale;
      const breathing = animation === "idle" || animation === "rest" || animation === "sleep_loop";
      const breathPhase = wallElapsed * (Math.PI * 2 / 4.8);
      const offsetX = breathing ? Math.sin(breathPhase) * 2.5 * scale : 0;
      const offsetY = breathing ? Math.sin(breathPhase - Math.PI / 2) * 3.5 * scale : 0;
      // The atlas cell includes 32 px of transparent side padding around the 2:3 video frame.
      // Crop that padding before drawing so the character's original proportions stay unchanged.
      // Idle/rest/sleep gently move this whole frame inside the existing transparent canvas;
      // clearing before every draw prevents trails and no frame blending or scaling is used.
      context.drawImage(
        image,
        sourceX,
        sourceY,
        FRAME_CONTENT_WIDTH,
        CELL_HEIGHT,
        (canvasWidth - drawWidth) / 2 + offsetX,
        (canvasHeight - drawHeight) / 2 + offsetY,
        drawWidth,
        drawHeight,
      );
      return true;
    };

    const idleFrameAt = (seconds: number) =>
      Math.floor(seconds * ANIMATIONS.idle.fps) % ANIMATIONS.idle.frame_count;

    const drawCurrentFrame = () => {
      let animation = state.animation;
      let frame = 0;
      if (state.kind === "idle" || state.kind === "loading") {
        animation = "idle";
        frame = idleFrameAt(Math.max(0, wallElapsed - state.startedAt));
      } else if (state.kind === "sleep") {
        animation = "sleep_loop";
        frame = Math.floor(Math.max(0, wallElapsed - state.startedAt) * ANIMATIONS.sleep_loop.fps) % ANIMATIONS.sleep_loop.frame_count;
      } else {
        frame = Math.min(
          ANIMATIONS[animation].frame_count - 1,
          Math.floor(Math.max(0, wallElapsed - state.startedAt) * ANIMATIONS[animation].fps),
        );
      }
      if (!drawSequence(animation, frame) && animation !== "idle") {
        drawSequence("idle", idleFrameAt(wallElapsed));
      }
    };

    const chooseRandomAction = () => {
      const choices = RANDOM_ACTIONS.filter((animation) => animation !== lastRandomAction);
      startAction(choices[Math.floor(Math.random() * choices.length)]);
    };

    const updateState = () => {
      if (pendingSequenceRequest || state.kind === "sleep" || state.kind === "loading") return;

      if (state.duration > 0 && wallElapsed >= state.startedAt + state.duration) {
        if (state.kind === "sleep_enter") {
          setAnimationState("sleep", "sleep_loop");
          releaseUnusedAnimations("sleep_loop");
          releaseAnimation("rest");
          return;
        }
        const previousAnimation = state.animation;
        if (state.kind === "action") nextVariationAt = scheduleElapsed + randomBetween(30, 60);
        setAnimationState("idle", "idle");
        releaseAnimation(previousAnimation);
        return;
      }
      if (state.kind !== "idle") return;

      if (scheduleElapsed >= nextSleepCheckAt) {
        if (Math.random() < 0.22) {
          startSleep();
          return;
        }
        nextSleepCheckAt = scheduleElapsed + randomBetween(30, 60);
      }
      if (scheduleElapsed >= nextVariationAt) chooseRandomAction();
    };

    const tick = (now: number) => {
      if (!previousTick) previousTick = now;
      const delta = Math.min(0.1, (now - previousTick) / 1000);
      previousTick = now;
      wallElapsed += delta;
      scheduleElapsed += delta;
      updateState();
      if (animationCache.has("idle") && now - lastDraw >= 1000 / RENDER_FPS) {
        lastDraw = now;
        drawCurrentFrame();
      }
      animationFrame = window.requestAnimationFrame(tick);
    };

    interactionRef.current = { singleClick: beginClickResponse, doubleClick: beginLaunchResponse };

    const start = async () => {
      try {
        await loadAnimation("idle");
        if (disposed) return;
        setAnimationState("idle", "idle");
        drawCurrentFrame();
        console.info("[桌面寵物] 動畫素材載入完成", {
          frameCount: ANIMATIONS.idle.frame_count,
          fps: ANIMATIONS.idle.fps,
          animations: Object.keys(ANIMATIONS).length,
        });
        setArtReady(true);
        previousTick = performance.now();
        animationFrame = window.requestAnimationFrame(tick);
      } catch (error) {
        console.error("[桌面寵物] 動畫素材載入失敗", error);
      }
    };
    void start();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resizeCanvas);
      if (pendingClickRef.current !== null) window.clearTimeout(pendingClickRef.current);
      pendingClickRef.current = null;
      pointerTrackingRef.current?.cleanup();
      pointerTrackingRef.current = null;
      interactionRef.current = { singleClick: () => undefined, doubleClick: () => undefined };
      for (const pages of animationCache.values()) {
        for (const image of pages) {
          image.onload = null;
          image.onerror = null;
        }
      }
      animationCache.clear();
    };
  }, []);

  const queueTap = () => {
    if (pendingClickRef.current !== null) {
      window.clearTimeout(pendingClickRef.current);
      pendingClickRef.current = null;
      interactionRef.current.doubleClick();
      return;
    }
    pendingClickRef.current = window.setTimeout(() => {
      pendingClickRef.current = null;
      interactionRef.current.singleClick();
    }, CLICK_DELAY_MS);
  };

  const startPointerTracking = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointerTrackingRef.current?.cleanup();

    const tracking: PointerTracking = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      cleanup: () => undefined,
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    const onMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== tracking.pointerId || tracking.moved) return;
      if (Math.hypot(pointerEvent.clientX - tracking.startX, pointerEvent.clientY - tracking.startY) < 5) return;
      tracking.moved = true;
      if (pendingClickRef.current !== null) window.clearTimeout(pendingClickRef.current);
      pendingClickRef.current = null;
      if (window.__TAURI_INTERNALS__) {
        void invoke("start_pet_drag").catch((error) => console.error("[桌面寵物] 拖曳視窗失敗", error));
      }
    };
    const onEnd = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== tracking.pointerId) return;
      cleanup();
      if (pointerTrackingRef.current === tracking) pointerTrackingRef.current = null;
      if (!tracking.moved) queueTap();
    };
    tracking.cleanup = cleanup;
    pointerTrackingRef.current = tracking;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  const openWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (window.__TAURI_INTERNALS__) {
      void invoke("show_main_window").catch((error) => console.error("[桌面寵物] 開啟主視窗失敗", error));
    }
  };

  const canvas = (
    <canvas
      ref={artRef}
      className={mode === "desktop" ? "pet-art pet-canvas" : "pet-canvas"}
      width={230}
      height={345}
      data-pet-frames={Object.values(ANIMATIONS).reduce((sum, animation) => sum + animation.frame_count, 0)}
      data-pet-fps={animationManifest.render_fps}
      data-pet-animations={Object.keys(ANIMATIONS).length}
      role="img"
      aria-label={mode === "desktop" ? "動畫桌面寵物" : "App 內動畫月娘"}
    />
  );
  if (mode === "inline") return canvas;

  return (
    <main className="desktop-pet">
      <button
        className="pet-character"
        aria-label="打開月光簿"
        title="拖曳寵物移動；單擊互動；雙擊開啟"
        onPointerDown={startPointerTracking}
        onKeyDown={openWithKeyboard}
      >
        {canvas}
        <small>單擊互動・雙擊開啟</small>
      </button>
    </main>
  );
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}
