import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { decodePng, pixelOffset, type DecodedPng } from "./png.js";
import type { ScreenshotResult, ScrollDirection, ScrollMeasurementResult } from "./types.js";
import { ensurePositiveInteger, ensureRatio } from "./validation.js";

export async function hashFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

export function calculateCalibratedScrollStep(input: {
  calibrationStep: number;
  regionHeight: number;
  measuredPixels: number;
  overlapRatio: number;
}): number {
  ensurePositiveInteger(input.calibrationStep, "calibrationStep");
  ensurePositiveInteger(input.regionHeight, "regionHeight");
  ensurePositiveInteger(input.measuredPixels, "measuredPixels");
  ensureRatio(input.overlapRatio, "overlapRatio");
  const targetPixels = input.regionHeight * (1 - input.overlapRatio);
  return Math.max(1, Math.round((input.calibrationStep * targetPixels) / input.measuredPixels));
}

export function calculateAdditionalScrollStep(input: {
  cumulativeStep: number;
  regionHeight: number;
  measuredPixels: number;
  targetOverlapRatio: number;
}): number {
  ensurePositiveInteger(input.cumulativeStep, "cumulativeStep");
  ensurePositiveInteger(input.regionHeight, "regionHeight");
  ensurePositiveInteger(input.measuredPixels, "measuredPixels");
  ensureRatio(input.targetOverlapRatio, "targetOverlapRatio");
  const targetPixels = input.regionHeight * (1 - input.targetOverlapRatio);
  const remainingPixels = targetPixels - input.measuredPixels;
  if (remainingPixels <= 0) return 1;
  return Math.max(1, Math.round((input.cumulativeStep * remainingPixels) / input.measuredPixels));
}

export function calculateOverlapRatio(regionHeight: number, measuredPixels: number): number {
  ensurePositiveInteger(regionHeight, "regionHeight");
  ensurePositiveInteger(measuredPixels, "measuredPixels");
  return Math.max(0, Math.min(1, (regionHeight - measuredPixels) / regionHeight));
}

export function minimumMeaningfulScrollPixels(regionHeight: number): number {
  ensurePositiveInteger(regionHeight, "regionHeight");
  return Math.max(8, Math.floor(regionHeight * 0.02));
}

export function verticalOverlapRanges(
  direction: ScrollDirection,
  height: number,
  shift: number,
): { beforeY: number; afterY: number; height: number } {
  ensurePositiveInteger(height, "height");
  ensurePositiveInteger(shift, "shift");
  if (shift >= height) {
    throw new Error("shift must be smaller than height.");
  }
  const overlapHeight = height - shift;
  if (direction === "up") {
    return { beforeY: 0, afterY: shift, height: overlapHeight };
  }
  return { beforeY: shift, afterY: 0, height: overlapHeight };
}

export async function measureScrollPixels(
  beforePath: string,
  afterPath: string,
  direction: ScrollDirection,
): Promise<ScrollMeasurementResult | undefined> {
  const before = decodePng(await readFile(beforePath));
  const after = decodePng(await readFile(afterPath));
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("Scroll calibration frames must have the same dimensions.");
  }
  return measureVerticalShift(before, after, direction);
}

function measureVerticalShift(
  before: DecodedPng,
  after: DecodedPng,
  direction: ScrollDirection,
): ScrollMeasurementResult | undefined {
  const maxShift = Math.max(1, Math.floor(before.height * 0.95));
  const coarseStep = Math.max(1, Math.floor(before.height / 180));
  let best: ScrollMeasurementResult | undefined;

  for (let shift = 1; shift <= maxShift; shift += coarseStep) {
    const score = scoreVerticalShift(before, after, direction, shift);
    if (!best || score < best.score) {
      best = { measuredPixels: shift, score };
    }
  }

  if (!best) return undefined;
  const refineStart = Math.max(1, best.measuredPixels - coarseStep);
  const refineEnd = Math.min(maxShift, best.measuredPixels + coarseStep);
  for (let shift = refineStart; shift <= refineEnd; shift++) {
    const score = scoreVerticalShift(before, after, direction, shift);
    if (score < best.score) {
      best = { measuredPixels: shift, score };
    }
  }

  return best.score <= 45 ? best : undefined;
}

function scoreVerticalShift(
  before: DecodedPng,
  after: DecodedPng,
  direction: ScrollDirection,
  shift: number,
): number {
  const overlap = verticalOverlapRanges(direction, before.height, shift);
  const xSamples = Math.min(24, before.width);
  const ySamples = Math.min(48, overlap.height);
  let total = 0;
  let count = 0;

  for (let xi = 0; xi < xSamples; xi++) {
    const x = Math.min(before.width - 1, Math.floor(((xi + 0.5) * before.width) / xSamples));
    for (let yi = 0; yi < ySamples; yi++) {
      const y = Math.min(overlap.height - 1, Math.floor(((yi + 0.5) * overlap.height) / ySamples));
      const beforeOffset = pixelOffset(before, x, overlap.beforeY + y);
      const afterOffset = pixelOffset(after, x, overlap.afterY + y);
      total += Math.abs(before.data[beforeOffset] - after.data[afterOffset]);
      total += Math.abs(before.data[beforeOffset + 1] - after.data[afterOffset + 1]);
      total += Math.abs(before.data[beforeOffset + 2] - after.data[afterOffset + 2]);
      count += 3;
    }
  }

  return count === 0 ? Number.POSITIVE_INFINITY : total / count;
}

export function orderFramesForStitch<T>(frames: T[], direction: ScrollDirection): T[] {
  return direction === "up" ? [...frames].reverse() : [...frames];
}

export async function stitchPngFrames(
  frames: ScreenshotResult[],
  outputPath: string,
  direction: ScrollDirection,
): Promise<string> {
  if (frames.length === 0) {
    throw new Error("At least one frame is required to stitch a screenshot.");
  }

  const ordered = orderFramesForStitch(frames, direction);
  const width = Math.max(...ordered.map((frame) => frame.width));
  const height = ordered.reduce((sum, frame) => sum + frame.height, 0);
  let y = 0;
  const imageNodes: string[] = [];
  for (const frame of ordered) {
    const data = (await readFile(frame.path)).toString("base64");
    imageNodes.push(
      `<image x="0" y="${y}" width="${frame.width}" height="${frame.height}" href="data:image/png;base64,${data}"/>`,
    );
    y += frame.height;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="white"/>${imageNodes.join("")}</svg>`;
  const rendered = new Resvg(svg).render();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(rendered.asPng()));
  return outputPath;
}

