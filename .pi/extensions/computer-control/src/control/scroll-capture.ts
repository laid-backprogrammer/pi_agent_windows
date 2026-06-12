import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { removeFileIfExists } from "./files.js";
import { click, moveMouse, pressKey, scroll, wait } from "./input.js";
import { calculateAdditionalScrollStep, calculateCalibratedScrollStep, calculateOverlapRatio, hashFile, measureScrollPixels, minimumMeaningfulScrollPixels, stitchPngFrames } from "./scroll-metrics.js";
import { mousePrelude, runPowerShell } from "./powershell.js";
import { captureScreenshotToPath } from "./screenshot.js";
import type { CaptureScrollRegionDefaults, CaptureScrollRegionParams, CaptureScrollRegionResult, CaptureScrollRegionStopReason, Region, ScreenshotResult, ScrollBoundaryRestoreResult, ScrollBoundaryTarget, ScrollCalibrationResult, ScrollDirection, ScrollFrameOverlap, ScrollInputMethod, ScrollMeasurementResult } from "./types.js";
import { centerPointForScreenshot, ensureNonNegativeInteger, ensurePositiveInteger, ensureRatio, normalizeRegion } from "./validation.js";

export async function captureScrollRegion(
  params: CaptureScrollRegionParams,
  defaults: CaptureScrollRegionDefaults,
  signal?: AbortSignal,
  deps: {
    captureFrame?: typeof captureScreenshotToPath;
    moveMouse?: typeof moveMouse;
    click?: typeof click;
    scroll?: typeof scroll;
    pressKey?: typeof pressKey;
    sleep?: typeof wait;
    hashFile?: typeof hashFile;
    measureScrollPixels?: typeof measureScrollPixels;
    stitchFrames?: typeof stitchPngFrames;
    writeManifest?: typeof writeScrollCaptureManifest;
    removeFileIfExists?: typeof removeFileIfExists;
  } = {},
): Promise<CaptureScrollRegionResult> {
  const region = normalizeRegion(params.region);
  const direction = params.direction ?? "up";
  if (direction !== "up" && direction !== "down") {
    throw new Error("direction must be up or down.");
  }

  const autoCalibrate = params.autoCalibrate ?? true;
  const requestedScrollStep = params.scrollStep ?? defaults.scrollStep;
  const calibrationStep = params.calibrationStep ?? defaults.calibrationStep;
  const overlapRatio = params.overlapRatio ?? defaults.overlapRatio;
  const minOverlapRatio = params.minOverlapRatio ?? defaults.minOverlapRatio;
  const maxFrames = params.maxFrames ?? defaults.maxFrames;
  const delayMs = params.delayMs ?? defaults.delayMs;
  const unchangedFrameLimit = params.unchangedFrameLimit ?? defaults.unchangedFrameLimit;
  const outputStitched = params.outputStitched ?? defaults.outputStitched;
  const restoreToBoundary = params.restoreToBoundary ?? false;
  const restoreScrollStep =
    params.restoreScrollStep ?? Math.max(48, requestedScrollStep * 8, calibrationStep * 16);
  const restoreMaxAttempts = params.restoreMaxAttempts ?? 80;
  const restoreUnchangedFrameLimit = params.restoreUnchangedFrameLimit ?? 3;
  ensurePositiveInteger(requestedScrollStep, "scrollStep");
  ensurePositiveInteger(calibrationStep, "calibrationStep");
  ensureRatio(overlapRatio, "overlapRatio");
  ensureRatio(minOverlapRatio, "minOverlapRatio");
  if (minOverlapRatio >= overlapRatio) {
    throw new Error("minOverlapRatio must be less than overlapRatio.");
  }
  ensurePositiveInteger(maxFrames, "maxFrames");
  ensureNonNegativeInteger(delayMs, "delayMs");
  ensureNonNegativeInteger(unchangedFrameLimit, "unchangedFrameLimit");
  ensurePositiveInteger(restoreScrollStep, "restoreScrollStep");
  ensurePositiveInteger(restoreMaxAttempts, "restoreMaxAttempts");
  ensurePositiveInteger(restoreUnchangedFrameLimit, "restoreUnchangedFrameLimit");

  const runId = `scroll-region-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outputDir = resolve(params.outputDir ?? (params.outputPath ? dirname(params.outputPath) : join(defaults.outputDir, runId)));
  const manifestPath = join(outputDir, "manifest.json");
  const stitchedOutputPath = params.outputPath ? resolve(params.outputPath) : join(outputDir, "stitched.png");
  await mkdir(outputDir, { recursive: true });

  const captureFrame = deps.captureFrame ?? captureScreenshotToPath;
  const focusClick = deps.click ?? (Object.keys(deps).length === 0 ? click : undefined);
  const scrollInputDeps = {
    scroll: deps.scroll ?? scroll,
    pressKey: deps.pressKey ?? pressKey,
  };
  const frames: ScreenshotResult[] = [];
  const overlaps: ScrollFrameOverlap[] = [];
  let previousHash: string | undefined;
  let unchangedRun = 0;
  let stopReason: CaptureScrollRegionStopReason = "maxFrames";
  let effectiveScrollStep = requestedScrollStep;
  let scrollInputMethod: ScrollInputMethod = "wheel";
  let calibration: ScrollCalibrationResult = buildInitialCalibration({
    autoCalibrate,
    calibrationStep,
    inputMethod: scrollInputMethod,
    overlapRatio,
    regionHeight: region.height,
    fallbackStep: requestedScrollStep,
  });

  const boundaryRestore = restoreToBoundary
    ? await restoreScrollBoundary(
        {
          outputDir,
          region,
          captureDirection: direction,
          scrollStep: restoreScrollStep,
          maxAttempts: restoreMaxAttempts,
          unchangedFrameLimit: restoreUnchangedFrameLimit,
          delayMs,
          canUseKeyboardFallback: Boolean(focusClick),
          signal,
        },
        {
          captureFrame,
          moveMouse: deps.moveMouse ?? moveMouse,
          click: focusClick,
          scroll: scrollInputDeps.scroll,
          pressKey: scrollInputDeps.pressKey,
          sleep: deps.sleep ?? wait,
          hashFile: deps.hashFile ?? hashFile,
          measureScrollPixels: deps.measureScrollPixels ?? (Object.keys(deps).length === 0 ? measureScrollPixels : undefined),
          removeFileIfExists: deps.removeFileIfExists ?? removeFileIfExists,
        },
      )
    : disabledBoundaryRestore();

  if (boundaryRestore.enabled && boundaryRestore.stopReason !== "unchanged") {
    const result: CaptureScrollRegionResult = {
      manifestPath,
      frames,
      frameCount: frames.length,
      stopReason: "boundaryRestoreFailed",
      preflight: {
        boundaryRestore,
      },
      calibration,
      overlaps,
      region,
        scroll: {
          direction,
          inputMethod: scrollInputMethod,
          scrollStep: effectiveScrollStep,
          delta: direction === "up" ? effectiveScrollStep : -effectiveScrollStep,
        maxFrames,
        delayMs,
        unchangedFrameLimit,
        minOverlapRatio,
        maxOverlapRatio: overlapRatio,
        restoreToBoundary,
        restoreScrollStep,
        restoreMaxAttempts,
        restoreUnchangedFrameLimit,
        outputStitched,
      },
      stitchedPath: undefined,
    };
    await (deps.writeManifest ?? writeScrollCaptureManifest)(manifestPath, result);
    return result;
  }

  const firstFrame = await captureFrame(framePath(outputDir, frames.length), region, signal);
  frames.push(firstFrame);
  previousHash = await (deps.hashFile ?? hashFile)(firstFrame.path);
  await (deps.moveMouse ?? moveMouse)(centerPointForScreenshot(firstFrame), 0, signal);
  if (focusClick) {
    await focusClick(centerPointForScreenshot(firstFrame), "left", signal);
  }

  if (autoCalibrate && frames.length < maxFrames) {
    const maxCalibrationAttempts = 5;

    const attemptCalibration = async (
      inputMethod: ScrollInputMethod,
      firstCalibrationStep: number,
    ): Promise<{ reliable: boolean; cumulativeStep: number; failureReason: string }> => {
      let nextCalibrationStep = firstCalibrationStep;
      let cumulativeCalibrationStep = 0;
      let calibrationFailureReason = "noReliableOverlap";
      const minCalibrationPixels = Math.max(8, Math.floor(region.height * 0.02));

      for (
        let attempt = 0;
        attempt < maxCalibrationAttempts && frames.length < maxFrames;
        attempt++, nextCalibrationStep *= 2
      ) {
        await scrollByStepWithMethod(nextCalibrationStep, direction, inputMethod, scrollInputDeps, signal);
        cumulativeCalibrationStep += nextCalibrationStep;
        if (delayMs > 0) {
      await (deps.sleep ?? wait)(delayMs);
    }

    const calibrationFrame = await captureFrame(framePath(outputDir, frames.length), region, signal);
    frames.push(calibrationFrame);
        const calibrationHash = await (deps.hashFile ?? hashFile)(calibrationFrame.path);

        if (calibrationHash === previousHash) {
          calibrationFailureReason = "unchangedAfterCalibration";
          previousHash = calibrationHash;
          if (inputMethod === "wheel" && focusClick) {
            break;
          }
          continue;
        }

        const measurement = await (deps.measureScrollPixels ?? measureScrollPixels)(
          firstFrame.path,
          calibrationFrame.path,
          direction,
        );
        if (!measurement || measurement.measuredPixels <= 0) {
          calibrationFailureReason = "noReliableOverlap";
          previousHash = calibrationHash;
          continue;
        }
        if (measurement.measuredPixels < minCalibrationPixels) {
          calibrationFailureReason = "tooLittleMovementAfterCalibration";
          previousHash = calibrationHash;
          if (inputMethod === "wheel" && focusClick) {
            break;
          }
          continue;
        }

        const bestStep = calculateCalibratedScrollStep({
          calibrationStep: cumulativeCalibrationStep,
          regionHeight: region.height,
          measuredPixels: measurement.measuredPixels,
          overlapRatio,
        });
        effectiveScrollStep = bestStep;
        scrollInputMethod = inputMethod;
        calibration = {
          ...calibration,
          inputMethod,
          calibrationStep: cumulativeCalibrationStep,
          measuredPixels: measurement.measuredPixels,
          bestStep,
          score: measurement.score,
          reliable: true,
        };
        previousHash = calibrationHash;
        return { reliable: true, cumulativeStep: cumulativeCalibrationStep, failureReason: calibrationFailureReason };
      }

      return {
        reliable: false,
        cumulativeStep: cumulativeCalibrationStep,
        failureReason: calibrationFailureReason,
      };
    };

    let calibrationAttempt = await attemptCalibration("wheel", calibrationStep);
    if (
      !calibrationAttempt.reliable &&
      ["unchangedAfterCalibration", "tooLittleMovementAfterCalibration"].includes(calibrationAttempt.failureReason) &&
      focusClick &&
      frames.length < maxFrames
    ) {
      scrollInputMethod = "keyboard-page";
      calibration = {
        ...calibration,
        inputMethod: "keyboard-page",
        calibrationStep: 1,
      };
      calibrationAttempt = await attemptCalibration("keyboard-page", 1);
    }

    if (!calibration.reliable) {
      stopReason = "calibrationFailed";
      calibration = {
        ...calibration,
        calibrationStep: calibrationAttempt.cumulativeStep || calibration.calibrationStep,
        reliable: false,
        failureReason: calibrationAttempt.failureReason,
      };
    }
  }

  while (stopReason !== "calibrationFailed" && frames.length < maxFrames) {
    const acceptedPreviousFrame = frames[frames.length - 1];
    const accepted = await captureNextAcceptedFrame({
      outputDir,
      frameIndex: frames.length,
      previousFrame: acceptedPreviousFrame,
      previousHash,
      direction,
      inputMethod: scrollInputMethod,
      initialScrollStep: effectiveScrollStep,
      region,
      delayMs,
      minOverlapRatio,
      maxOverlapRatio: overlapRatio,
      signal,
      deps: {
        captureFrame,
        scroll: scrollInputDeps.scroll,
        pressKey: scrollInputDeps.pressKey,
        sleep: deps.sleep ?? wait,
        hashFile: deps.hashFile ?? hashFile,
        measureScrollPixels: deps.measureScrollPixels ?? measureScrollPixels,
        removeFileIfExists: deps.removeFileIfExists ?? removeFileIfExists,
      },
    });

    if (accepted.stopReason) {
      stopReason = accepted.stopReason;
      break;
    }

    const frame = accepted.frame;
    frames.push(frame);
    overlaps.push(accepted.overlap);
    effectiveScrollStep = accepted.overlap.scrollStep;

    const currentHash = accepted.hash;
    if (previousHash !== undefined && currentHash === previousHash) {
      unchangedRun += 1;
    } else {
      unchangedRun = 0;
    }
    previousHash = currentHash;

    if (unchangedFrameLimit > 0 && unchangedRun >= unchangedFrameLimit) {
      stopReason = "unchanged";
      break;
    }
  }

  if (stopReason !== "calibrationFailed" && frames.length >= maxFrames) {
    stopReason = "maxFrames";
  }

  const stitchedPath = outputStitched
    ? await (deps.stitchFrames ?? stitchPngFrames)(frames, stitchedOutputPath, direction)
    : undefined;

  const result: CaptureScrollRegionResult = {
    manifestPath,
    frames,
    frameCount: frames.length,
    stopReason,
    preflight: {
      boundaryRestore,
    },
    calibration,
    overlaps,
    region,
    scroll: {
      direction,
      inputMethod: scrollInputMethod,
      scrollStep: effectiveScrollStep,
      delta: direction === "up" ? effectiveScrollStep : -effectiveScrollStep,
      maxFrames,
      delayMs,
      unchangedFrameLimit,
      minOverlapRatio,
      maxOverlapRatio: overlapRatio,
      restoreToBoundary,
      restoreScrollStep,
      restoreMaxAttempts,
      restoreUnchangedFrameLimit,
      outputStitched,
    },
    stitchedPath,
  };
  await (deps.writeManifest ?? writeScrollCaptureManifest)(manifestPath, result);
  return result;
}

function disabledBoundaryRestore(): ScrollBoundaryRestoreResult {
  return {
    enabled: false,
    attempts: 0,
    stopReason: "disabled",
  };
}

async function restoreScrollBoundary(
  input: {
    outputDir: string;
    region: Region;
    captureDirection: ScrollDirection;
    scrollStep: number;
    maxAttempts: number;
    unchangedFrameLimit: number;
    delayMs: number;
    canUseKeyboardFallback: boolean;
    signal?: AbortSignal;
  },
  deps: {
    captureFrame: typeof captureScreenshotToPath;
    moveMouse: typeof moveMouse;
    click?: typeof click;
    scroll: typeof scroll;
    pressKey: typeof pressKey;
    sleep: typeof wait;
    hashFile: typeof hashFile;
    measureScrollPixels?: typeof measureScrollPixels;
    removeFileIfExists: typeof removeFileIfExists;
  },
): Promise<ScrollBoundaryRestoreResult> {
  const targetBoundary: ScrollBoundaryTarget = input.captureDirection === "up" ? "bottom" : "top";
  const scrollDirection: ScrollDirection = input.captureDirection === "up" ? "down" : "up";
  const delta = scrollDirection === "up" ? input.scrollStep : -input.scrollStep;
  let attempts = 0;
  let unchangedRun = 0;
  let inputMethod: ScrollInputMethod = "wheel";
  const jumpKey = input.canUseKeyboardFallback ? (targetBoundary === "bottom" ? "end" : "home") : undefined;
  let preflightIndex = 0;

  let previousFrame = await deps.captureFrame(preflightFramePath(input.outputDir, 0), input.region, input.signal);
  let previousHash = await deps.hashFile(previousFrame.path);
  await deps.moveMouse(centerPointForScreenshot(previousFrame), 0, input.signal);
  if (deps.click) {
    await deps.click(centerPointForScreenshot(previousFrame), "left", input.signal);
  }
  const minimumMovementPixels = minimumMeaningfulScrollPixels(input.region.height);

  if (jumpKey) {
    await deps.pressKey(jumpKey, input.signal);
    if (input.delayMs > 0) {
      await deps.sleep(input.delayMs);
    }
    const frame = await deps.captureFrame(preflightFramePath(input.outputDir, ++preflightIndex), input.region, input.signal);
    const currentHash = await deps.hashFile(frame.path);
    await deps.removeFileIfExists(previousFrame.path);
    previousFrame = frame;
    previousHash = currentHash;
  }

  for (attempts = 1; attempts <= input.maxAttempts; attempts++) {
    const step = inputMethod === "wheel" ? input.scrollStep : 1;
    await scrollByStepWithMethod(
      step,
      scrollDirection,
      inputMethod,
      { scroll: deps.scroll, pressKey: deps.pressKey },
      input.signal,
    );
    if (input.delayMs > 0) {
      await deps.sleep(input.delayMs);
    }

    const path = preflightFramePath(input.outputDir, ++preflightIndex);
    const frame = await deps.captureFrame(path, input.region, input.signal);
    const currentHash = await deps.hashFile(frame.path);

    let movedMeaningfully = currentHash !== previousHash;
    if (movedMeaningfully && deps.measureScrollPixels) {
      const measurement = await deps.measureScrollPixels(previousFrame.path, frame.path, scrollDirection);
      if (measurement && measurement.measuredPixels < minimumMovementPixels) {
        movedMeaningfully = false;
      }
    }
    await deps.removeFileIfExists(previousFrame.path);

    if (!movedMeaningfully) {
      unchangedRun += 1;
    } else {
      unchangedRun = 0;
    }
    previousFrame = frame;
    previousHash = currentHash;

    if (unchangedRun >= input.unchangedFrameLimit) {
      await deps.removeFileIfExists(previousFrame.path);
      if (inputMethod === "wheel" && input.canUseKeyboardFallback && !jumpKey) {
        inputMethod = "keyboard-page";
        unchangedRun = 0;
        previousFrame = await deps.captureFrame(preflightFramePath(input.outputDir, attempts), input.region, input.signal);
        previousHash = await deps.hashFile(previousFrame.path);
        continue;
      }
      return {
        enabled: true,
        targetBoundary,
        scrollDirection,
        ...(jumpKey ? { jumpKey } : {}),
        inputMethod,
        scrollStep: input.scrollStep,
        delta,
        maxAttempts: input.maxAttempts,
        unchangedFrameLimit: input.unchangedFrameLimit,
        attempts,
        stopReason: "unchanged",
      };
    }
  }

  await deps.removeFileIfExists(previousFrame.path);
  return {
    enabled: true,
    targetBoundary,
    scrollDirection,
    ...(jumpKey ? { jumpKey } : {}),
    inputMethod,
    scrollStep: input.scrollStep,
    delta,
    maxAttempts: input.maxAttempts,
    unchangedFrameLimit: input.unchangedFrameLimit,
    attempts: input.maxAttempts,
    stopReason: "maxAttempts",
  };
}

async function captureNextAcceptedFrame(input: {
  outputDir: string;
  frameIndex: number;
  previousFrame: ScreenshotResult;
  previousHash?: string;
  direction: ScrollDirection;
  inputMethod: ScrollInputMethod;
  initialScrollStep: number;
  region: Region;
  delayMs: number;
  minOverlapRatio: number;
  maxOverlapRatio: number;
  signal?: AbortSignal;
  deps: {
    captureFrame: typeof captureScreenshotToPath;
    scroll: typeof scroll;
    pressKey: typeof pressKey;
    sleep: typeof wait;
    hashFile: typeof hashFile;
    measureScrollPixels: typeof measureScrollPixels;
    removeFileIfExists: typeof removeFileIfExists;
  };
}): Promise<
  | { frame: ScreenshotResult; hash: string; overlap: ScrollFrameOverlap; stopReason?: undefined }
  | { stopReason: CaptureScrollRegionStopReason }
> {
  let cumulativeStep = input.initialScrollStep;
  let nextStep = input.initialScrollStep;
  const maxAdjustmentAttempts = 12;
  const maxSingleScrollStep = 800;

  for (let attempt = 0; attempt <= maxAdjustmentAttempts; attempt++) {
    await scrollByStepWithMethod(
      nextStep,
      input.direction,
      input.inputMethod,
      { scroll: input.deps.scroll, pressKey: input.deps.pressKey },
      input.signal,
    );
    if (input.delayMs > 0) {
      await input.deps.sleep(input.delayMs);
    }

    const candidatePath = framePath(input.outputDir, input.frameIndex);
    const candidate = await input.deps.captureFrame(candidatePath, input.region, input.signal);
    const candidateHash = await input.deps.hashFile(candidate.path);
    if (input.previousHash !== undefined && candidateHash === input.previousHash) {
      await input.deps.removeFileIfExists(candidate.path);
      return { stopReason: "unchanged" };
    }
    const measurement = await input.deps.measureScrollPixels(
      input.previousFrame.path,
      candidate.path,
      input.direction,
    );

    if (!measurement || measurement.measuredPixels <= 0) {
      await input.deps.removeFileIfExists(candidate.path);
      return { stopReason: "overlapMeasurementFailed" };
    }
    if (measurement.measuredPixels < minimumMeaningfulScrollPixels(input.region.height)) {
      await input.deps.removeFileIfExists(candidate.path);
      return { stopReason: "unchanged" };
    }

    const actualOverlapRatio = calculateOverlapRatio(input.region.height, measurement.measuredPixels);
    if (actualOverlapRatio < input.minOverlapRatio) {
      await input.deps.removeFileIfExists(candidate.path);
      return { stopReason: "overlapTooLow" };
    }

    if (actualOverlapRatio > input.maxOverlapRatio) {
      await input.deps.removeFileIfExists(candidate.path);
      if (attempt >= maxAdjustmentAttempts) {
        return { stopReason: "overlapTooHigh" };
      }
      const additionalStep = calculateAdditionalScrollStep({
        cumulativeStep,
        regionHeight: input.region.height,
        measuredPixels: measurement.measuredPixels,
        targetOverlapRatio: input.maxOverlapRatio,
      });
      nextStep = Math.min(additionalStep, maxSingleScrollStep);
      cumulativeStep += nextStep;
      continue;
    }

    return {
      frame: candidate,
      hash: candidateHash,
      overlap: {
        frameIndex: input.frameIndex,
        previousFrameIndex: input.frameIndex - 1,
        inputMethod: input.inputMethod,
        scrollStep: cumulativeStep,
        delta: input.direction === "up" ? cumulativeStep : -cumulativeStep,
        measuredPixels: measurement.measuredPixels,
        overlapRatio: actualOverlapRatio,
        score: measurement.score,
        adjustmentAttempts: attempt,
      },
    };
  }

  return { stopReason: "overlapTooHigh" };
}

async function scrollByStep(
  step: number,
  direction: ScrollDirection,
  scrollFn: typeof scroll,
  signal?: AbortSignal,
): Promise<void> {
  ensurePositiveInteger(step, "step");
  const maxChunk = 12;

  if (scrollFn === scroll) {
    await scrollStepWithNativeLoop(step, direction, maxChunk, signal);
    return;
  }

  let remaining = step;
  const deltas: number[] = [];
  while (remaining > 0) {
    const chunk = Math.min(maxChunk, remaining);
    deltas.push(direction === "up" ? chunk : -chunk);
    remaining -= chunk;
  }

  for (const delta of deltas) {
    await scrollFn(delta, signal);
  }
}

async function scrollByStepWithMethod(
  step: number,
  direction: ScrollDirection,
  inputMethod: ScrollInputMethod,
  deps: {
    scroll: typeof scroll;
    pressKey: typeof pressKey;
  },
  signal?: AbortSignal,
): Promise<void> {
  if (inputMethod === "wheel") {
    await scrollByStep(step, direction, deps.scroll, signal);
    return;
  }

  ensurePositiveInteger(step, "step");
  // WeChat follows the normal page-key direction in the message panel.
  const key = direction === "up" ? "pageup" : "pagedown";
  for (let index = 0; index < step; index++) {
    await deps.pressKey(key, signal);
    if (index < step - 1) {
      await wait(80);
    }
  }
}

async function scrollStepWithNativeLoop(
  step: number,
  direction: ScrollDirection,
  maxChunk: number,
  signal?: AbortSignal,
): Promise<void> {
  const fullChunks = Math.floor(step / maxChunk);
  const remainder = step % maxChunk;
  const sign = direction === "up" ? 1 : -1;
  const chunkWheelDelta = sign * maxChunk * 120;
  const remainderWheelDelta = sign * remainder * 120;
  await runPowerShell(mousePrelude() + `
$chunkWheelDelta = ${chunkWheelDelta}
$fullChunks = ${fullChunks}
$remainderWheelDelta = ${remainderWheelDelta}
for ($index = 0; $index -lt $fullChunks; $index++) {
  [NativeMethods]::mouse_event(0x0800, 0, 0, $chunkWheelDelta, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 8
}
if ($remainderWheelDelta -ne 0) {
  [NativeMethods]::mouse_event(0x0800, 0, 0, $remainderWheelDelta, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 8
}
`, signal);
}

async function writeScrollCaptureManifest(
  manifestPath: string,
  result: CaptureScrollRegionResult,
): Promise<string> {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        ...result,
      },
      null,
      2,
    ),
    "utf8",
  );
  return manifestPath;
}

function framePath(outputDir: string, index: number): string {
  return join(outputDir, `frame-${String(index).padStart(3, "0")}.png`);
}

function preflightFramePath(outputDir: string, index: number): string {
  return join(outputDir, `preflight-boundary-${String(index).padStart(3, "0")}.png`);
}

function buildInitialCalibration(input: {
  autoCalibrate: boolean;
  calibrationStep: number;
  inputMethod: ScrollInputMethod;
  overlapRatio: number;
  regionHeight: number;
  fallbackStep: number;
}): ScrollCalibrationResult {
  const targetPixels = input.regionHeight * (1 - input.overlapRatio);
  return {
    autoCalibrate: input.autoCalibrate,
    calibrationStep: input.calibrationStep,
    inputMethod: input.inputMethod,
    overlapRatio: input.overlapRatio,
    targetPixels,
    bestStep: input.autoCalibrate ? undefined : input.fallbackStep,
    reliable: !input.autoCalibrate,
  };
}
