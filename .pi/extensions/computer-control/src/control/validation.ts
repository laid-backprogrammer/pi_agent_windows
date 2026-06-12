import type { Point, Region, ScreenshotResult } from "./types.js";

export function ensureFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
}

export function ensureNormalizedNumber(value: number, name: string): void {
  ensureFiniteNumber(value, name);
  if (value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1.`);
  }
}

export function ensurePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

export function ensureNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
}

export function ensureRatio(value: number, name: string): void {
  ensureFiniteNumber(value, name);
  if (value <= 0 || value >= 1) {
    throw new Error(`${name} must be greater than 0 and less than 1.`);
  }
}

export function normalizeRegion(region: Region): Region {
  ensureFiniteNumber(region.x, "region.x");
  ensureFiniteNumber(region.y, "region.y");
  ensureFiniteNumber(region.width, "region.width");
  ensureFiniteNumber(region.height, "region.height");
  if (region.width <= 0 || region.height <= 0) {
    throw new Error("region.width and region.height must be positive.");
  }
  return {
    x: Math.round(region.x),
    y: Math.round(region.y),
    width: Math.round(region.width),
    height: Math.round(region.height),
  };
}

export function centerPointForScreenshot(
  screenshot: Pick<ScreenshotResult, "left" | "top" | "width" | "height">,
): Point {
  return {
    x: screenshot.left + Math.round(screenshot.width / 2),
    y: screenshot.top + Math.round(screenshot.height / 2),
  };
}
