export interface FloatingMoonPosition {
  x: number;
  y: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface PixelPosition {
  left: number;
  top: number;
}

/** Keeps the in-app moon fully reachable when its host window is resized. */
export function clampFloatingMoonPosition(
  position: PixelPosition,
  size: number,
  viewport: ViewportSize,
): PixelPosition {
  const minLeft = 8;
  const minTop = 8;
  const maxLeft = Math.max(minLeft, viewport.width - size - 8);
  const maxTop = Math.max(minTop, viewport.height - size - 20);

  return {
    left: Math.max(minLeft, Math.min(maxLeft, position.left)),
    top: Math.max(minTop, Math.min(maxTop, position.top)),
  };
}
