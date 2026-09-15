import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { webcrypto } from "node:crypto";

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});

Object.defineProperty(window, "open", { value: vi.fn(), writable: true });
Object.defineProperty(window, "confirm", {
  value: vi.fn(() => true),
  writable: true,
});
Object.defineProperty(URL, "createObjectURL", {
  value: vi.fn(() => "blob:test"),
  writable: true,
});
Object.defineProperty(URL, "revokeObjectURL", {
  value: vi.fn(),
  writable: true,
});
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: vi.fn(() => ({
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "round",
    lineJoin: "round",
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  })),
  writable: true,
});
beforeEach(() => localStorage.clear());
afterEach(() => cleanup());
