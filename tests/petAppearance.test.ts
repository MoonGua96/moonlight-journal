import { describe, expect, it } from "vitest";
import {
  hasTransparentSpriteGrid,
  looksLikeSvgDocument,
  petAppearanceFileError,
} from "../src/data/petAppearance";

describe("pet appearance image restrictions", () => {
  it("accepts supported static image names within the size limit", () => {
    expect(petAppearanceFileError("pet.png", 1024)).toBeNull();
    expect(petAppearanceFileError("my-pet.jpeg", 1024, "image/jpeg")).toBeNull();
  });

  it("explains unsupported animation, vector, and video formats", () => {
    expect(petAppearanceFileError("pet.gif", 100)).toContain("GIF");
    expect(petAppearanceFileError("pet.apng", 100)).toContain("APNG");
    expect(petAppearanceFileError("pet.svg", 100)).toContain("SVG");
    expect(petAppearanceFileError("pet.mp4", 100, "video/mp4")).toContain("影片");
    expect(petAppearanceFileError("pet.webp", 100, "image/webp")).toContain("動畫版本");
  });

  it("recognizes SVG documents without mistaking PNG binary metadata for SVG", () => {
    expect(looksLikeSvgDocument('<svg xmlns="http://www.w3.org/2000/svg">')).toBe(true);
    expect(looksLikeSvgDocument('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">')).toBe(true);
    expect(looksLikeSvgDocument("<!-- artwork --><!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN'>")).toBe(true);
    expect(looksLikeSvgDocument("\uFFFDPNG\r\n\u001A\n<svg xmlns=\"metadata only\"/>"))
      .toBe(false);
  });

  it("explains file-size and atlas restrictions", () => {
    expect(petAppearanceFileError("pet.png", 10 * 1024 * 1024 + 1)).toContain("10 MB");
    expect(petAppearanceFileError("pet-spritesheet.png", 1024)).toContain("精靈圖集");
  });

  it("detects a regular transparent atlas grid without rejecting one image", () => {
    const width = 8;
    const height = 8;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (const [left, top] of [[0, 0], [5, 0], [0, 5], [5, 5]]) {
      for (let y = top; y < top + 3; y++) {
        for (let x = left; x < left + 3; x++) pixels[(y * width + x) * 4 + 3] = 255;
      }
    }
    expect(hasTransparentSpriteGrid(width, height, pixels)).toBe(true);
    expect(hasTransparentSpriteGrid(8, 8, new Uint8ClampedArray(8 * 8 * 4).fill(255))).toBe(false);

    const whiteGrid = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index++) {
      whiteGrid[index * 4] = 255;
      whiteGrid[index * 4 + 1] = 255;
      whiteGrid[index * 4 + 2] = 255;
      whiteGrid[index * 4 + 3] = 255;
    }
    for (const [left, top] of [[0, 0], [5, 0], [0, 5], [5, 5]]) {
      for (let y = top; y < top + 3; y++) {
        for (let x = left; x < left + 3; x++) {
          const pixel = (y * width + x) * 4;
          whiteGrid[pixel] = 40;
          whiteGrid[pixel + 1] = 40;
          whiteGrid[pixel + 2] = 40;
        }
      }
    }
    expect(hasTransparentSpriteGrid(width, height, whiteGrid)).toBe(true);
  });
});
