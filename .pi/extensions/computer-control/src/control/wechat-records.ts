import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { startWeChat } from "./application.js";
import { click, hotkey, pressKey, scrollAtTarget, typeText, wait } from "./input.js";
import { decodePng } from "./png.js";
import { captureScreenshotToPath } from "./screenshot.js";
import { captureScrollRegion } from "./scroll-capture.js";
import type { OcrChunk, Point, Region, WeChatChatOpenResult, WeChatChatRecordsCaptureParams, WeChatChatRecordsCaptureResult, WeChatChatRecordsDefaults, WeChatConversationListLocateInput, WeChatConversationListLocateResult, WindowHandleInfo, WindowRect, WindowSelectionDiagnostics } from "./types.js";
import { ensureNonNegativeInteger, ensurePositiveInteger } from "./validation.js";
import { activateWindow, findChatRecordsWindow, findWeChatMainWindow, inspectChatRecordsWindow, inspectWeChatMainWindow, setWindowTopmost } from "./windows.js";

export async function captureWechatChatRecords(
  params: WeChatChatRecordsCaptureParams,
  defaults: WeChatChatRecordsDefaults,
  signal?: AbortSignal,
  deps: {
    startWeChat?: typeof startWeChat;
    inspectWeChatMainWindow?: typeof inspectWeChatMainWindow;
    findWeChatMainWindow?: typeof findWeChatMainWindow;
    inspectChatRecordsWindow?: typeof inspectChatRecordsWindow;
    findChatRecordsWindow?: typeof findChatRecordsWindow;
    activateWindow?: typeof activateWindow;
    setWindowTopmost?: typeof setWindowTopmost;
    captureFrame?: typeof captureScreenshotToPath;
    locateConversationInList?: (
      input: WeChatConversationListLocateInput,
      signal?: AbortSignal,
    ) => Promise<WeChatConversationListLocateResult>;
    click?: typeof click;
    typeText?: typeof typeText;
    pressKey?: typeof pressKey;
    hotkey?: typeof hotkey;
    scrollAtTarget?: typeof scrollAtTarget;
    sleep?: typeof wait;
    captureScrollRegion?: typeof captureScrollRegion;
    splitPngForOcr?: typeof splitPngForOcr;
    writeManifest?: typeof writeWechatRecordsManifest;
  } = {},
): Promise<WeChatChatRecordsCaptureResult> {
  const chatName = params.chatName.trim();
  if (!chatName) {
    throw new Error("chatName is required.");
  }

  const sessionDir = resolve(
    params.outputDir ??
      join(defaults.wechatRecordsOutputDir, sanitizePathSegment(chatName), new Date().toISOString().replace(/[:.]/g, "-")),
  );
  const preflightDir = join(sessionDir, "preflight");
  const rawFramesDir = join(sessionDir, "raw_frames");
  const stitchedDir = join(sessionDir, "stitched");
  const ocrChunksDir = join(sessionDir, "ocr_chunks");
  const stitchedPath = join(stitchedDir, "long.png");
  const manifestPath = join(sessionDir, "manifest.json");
  await mkdir(preflightDir, { recursive: true });
  await mkdir(rawFramesDir, { recursive: true });
  await mkdir(stitchedDir, { recursive: true });
  await mkdir(ocrChunksDir, { recursive: true });

  const startedTopmost: number[] = [];
  const setTopmost = deps.setWindowTopmost ?? setWindowTopmost;
  const writeManifest = deps.writeManifest ?? writeWechatRecordsManifest;
  let mainWindow: WindowHandleInfo | undefined;
  let recordsWindow: WindowHandleInfo | undefined;
  let mainWindowSelection: WindowSelectionDiagnostics | undefined;
  let recordsWindowSelection: WindowSelectionDiagnostics | undefined;
  let menuFallbackUsed = false;
  let wechatTopmostScreenshot = "";
  let recordsWindowTopmostScreenshot = "";
  let chatOpen: WeChatChatOpenResult | undefined;

  const baseManifest = {
    chatName,
    outputDir: sessionDir,
    createdAt: new Date().toISOString(),
  };

  try {
    await (deps.startWeChat ?? startWeChat)(signal);
    await (deps.sleep ?? wait)(500);

    if (deps.findWeChatMainWindow) {
      mainWindow = await deps.findWeChatMainWindow(signal);
    } else {
      mainWindowSelection = await (deps.inspectWeChatMainWindow ?? inspectWeChatMainWindow)(signal);
      mainWindow = mainWindowSelection.selected;
    }
    if (!mainWindow) {
      throw new Error(
        `WeChat main window was not found.${formatWindowSelectionDiagnostics(mainWindowSelection)}`,
      );
    }

    await (deps.activateWindow ?? activateWindow)(mainWindow.hwnd, signal);
    await setTopmost(mainWindow.hwnd, true, signal);
    startedTopmost.push(mainWindow.hwnd);
    await (deps.sleep ?? wait)(250);

    wechatTopmostScreenshot = join(preflightDir, "wechat-topmost.png");
    await (deps.captureFrame ?? captureScreenshotToPath)(
      wechatTopmostScreenshot,
      windowRectToRegion(mainWindow.rect),
      signal,
    );

    chatOpen = await openWeChatChat(mainWindow, chatName, signal, deps, join(preflightDir, "conversation-list"));

    const openedFromMenu = await openChatRecordsFromMenu(mainWindow, chatName, signal, deps);
    if (openedFromMenu) {
      if (deps.findChatRecordsWindow) {
        recordsWindow = await deps.findChatRecordsWindow(chatName, signal);
      } else {
        recordsWindowSelection = await (deps.inspectChatRecordsWindow ?? inspectChatRecordsWindow)(chatName, signal);
        recordsWindow = recordsWindowSelection.selected;
      }
    } else {
      recordsWindow = undefined;
    }

    if (!recordsWindow) {
      menuFallbackUsed = true;
      await (deps.hotkey ?? hotkey)(["control", "f"], signal);
      recordsWindow = await waitForChatRecordsWindow(chatName, signal, deps, (selection) => {
        recordsWindowSelection = selection;
      });
    }

    if (!recordsWindow) {
      throw new Error(
        `Chat records window for "${chatName}" was not found.${formatWindowSelectionDiagnostics(recordsWindowSelection)}`,
      );
    }

    await (deps.activateWindow ?? activateWindow)(recordsWindow.hwnd, signal);
    await setTopmost(recordsWindow.hwnd, true, signal);
    startedTopmost.push(recordsWindow.hwnd);
    await (deps.sleep ?? wait)(250);

    recordsWindowTopmostScreenshot = join(preflightDir, "records-window-topmost.png");
    await (deps.captureFrame ?? captureScreenshotToPath)(
      recordsWindowTopmostScreenshot,
      windowRectToRegion(recordsWindow.rect),
      signal,
    );

    const recordsRegion = recordsWindowContentRegion(recordsWindow);
    const scrollCapture = await (deps.captureScrollRegion ?? captureScrollRegion)(
      {
        region: recordsRegion,
        direction: "up",
        restoreToBoundary: true,
        maxFrames: params.maxFrames,
        outputDir: rawFramesDir,
        outputPath: stitchedPath,
        outputStitched: true,
      },
      defaults,
      signal,
    );

    const effectiveStitchedPath = scrollCapture.stitchedPath ?? stitchedPath;
    const ocrChunks = scrollCapture.stitchedPath
      ? await (deps.splitPngForOcr ?? splitPngForOcr)(
          effectiveStitchedPath,
          ocrChunksDir,
          params.ocrChunkHeight ?? defaults.ocrChunkHeight,
          params.ocrChunkOverlap ?? defaults.ocrChunkOverlap,
        )
      : [];

    const result: WeChatChatRecordsCaptureResult = {
      manifestPath,
      outputDir: sessionDir,
      chatName,
      mainWindow,
      recordsWindow,
      recordsRegion,
      preflight: {
        wechatTopmostScreenshot,
        recordsWindowTopmostScreenshot,
      },
      menuFallbackUsed,
      chatOpen,
      scrollCapture,
      stitchedPath: scrollCapture.stitchedPath,
      ocrChunks,
      diagnostics: {
        mainWindowSelection,
        recordsWindowSelection,
      },
    };
    await writeManifest(manifestPath, result);
    return result;
  } catch (error) {
    await writeManifest(manifestPath, {
      ...baseManifest,
      error: error instanceof Error ? error.message : String(error),
      mainWindow,
      recordsWindow,
      preflight: {
        wechatTopmostScreenshot,
        recordsWindowTopmostScreenshot,
      },
      menuFallbackUsed,
      chatOpen,
      diagnostics: {
        mainWindowSelection,
        recordsWindowSelection,
      },
    });
    throw error;
  } finally {
    for (const hwnd of [...startedTopmost].reverse()) {
      try {
        await setTopmost(hwnd, false, signal);
      } catch {
        // Best-effort cleanup; preserve the original capture error.
      }
    }
  }
}

async function openWeChatChat(
  mainWindow: WindowHandleInfo,
  chatName: string,
  signal: AbortSignal | undefined,
  deps: {
    captureFrame?: typeof captureScreenshotToPath;
    locateConversationInList?: (
      input: WeChatConversationListLocateInput,
      signal?: AbortSignal,
    ) => Promise<WeChatConversationListLocateResult>;
    click?: typeof click;
    typeText?: typeof typeText;
    hotkey?: typeof hotkey;
    pressKey?: typeof pressKey;
    scrollAtTarget?: typeof scrollAtTarget;
    sleep?: typeof wait;
  },
  scanDir: string,
): Promise<WeChatChatOpenResult> {
  const locate = deps.locateConversationInList;
  if (locate) {
    const result = await openWeChatChatFromConversationList(mainWindow, chatName, signal, deps, scanDir);
    if (!result.searchFallbackUsed) return result;
    const fallback = await openWeChatChatBySearch(mainWindow, chatName, signal, deps);
    return { ...fallback, attempts: result.attempts };
  }
  return openWeChatChatBySearch(mainWindow, chatName, signal, deps);
}

async function openWeChatChatFromConversationList(
  mainWindow: WindowHandleInfo,
  chatName: string,
  signal: AbortSignal | undefined,
  deps: {
    captureFrame?: typeof captureScreenshotToPath;
    locateConversationInList?: (
      input: WeChatConversationListLocateInput,
      signal?: AbortSignal,
    ) => Promise<WeChatConversationListLocateResult>;
    click?: typeof click;
    hotkey?: typeof hotkey;
    pressKey?: typeof pressKey;
    scrollAtTarget?: typeof scrollAtTarget;
    sleep?: typeof wait;
  },
  scanDir: string,
): Promise<WeChatChatOpenResult> {
  const locate = deps.locateConversationInList;
  if (!locate) {
    return { method: "search-fallback", searchFallbackUsed: true, attempts: [] };
  }

  await mkdir(scanDir, { recursive: true });
  const region = weChatConversationListRegion(mainWindow);
  const attempts: WeChatChatOpenResult["attempts"] = [];
  const doClick = deps.click ?? click;
  const sleepFn = deps.sleep ?? wait;

  await doClick({ x: region.x + Math.round(region.width / 2), y: region.y + Math.min(region.height - 1, 120) }, "left", signal);
  await sleepFn(150);
  await (deps.pressKey ?? pressKey)("home", signal);
  await sleepFn(300);

  for (let attempt = 1; attempt <= 8; attempt++) {
    const screenshotPath = join(scanDir, `conversation-list-${String(attempt).padStart(3, "0")}.png`);
    await (deps.captureFrame ?? captureScreenshotToPath)(screenshotPath, region, signal);
    const located = await locate({ chatName, screenshotPath, region, attempt }, signal);
    const point = located.found ? locateResultPoint(region, located) : undefined;
    attempts.push({
      attempt,
      screenshotPath,
      region,
      found: Boolean(point),
      point,
      label: located.label,
      summary: located.summary,
      visibleText: located.visibleText,
    });

    if (point) {
      await doClick(point, "left", signal);
      await sleepFn(900);
      return { method: "conversation-list-vlm", searchFallbackUsed: false, attempts };
    }

    if (attempt < 8) {
      await (deps.scrollAtTarget ?? scrollAtTarget)(
        { region, delta: -6, repeat: 8, delayMs: 70 },
        { repeat: 1, delayMs: 120 },
        signal,
      );
      await sleepFn(350);
    }
  }

  return { method: "search-fallback", searchFallbackUsed: true, attempts };
}

async function openWeChatChatBySearch(
  mainWindow: WindowHandleInfo,
  chatName: string,
  signal: AbortSignal | undefined,
  deps: {
    click?: typeof click;
    typeText?: typeof typeText;
    hotkey?: typeof hotkey;
    sleep?: typeof wait;
  },
): Promise<WeChatChatOpenResult> {
  const doClick = deps.click ?? click;
  await doClick(relativePoint(mainWindow, 0.12, 0.045, { minX: 80, maxX: 180, minY: 45, maxY: 75 }), "left", signal);
  await (deps.sleep ?? wait)(150);
  await (deps.hotkey ?? hotkey)(["control", "a"], signal);
  await (deps.typeText ?? typeText)(chatName, signal);
  await (deps.sleep ?? wait)(900);
  await doClick(relativePoint(mainWindow, 0.13, 0.095, { minX: 105, maxX: 230, minY: 105, maxY: 155 }), "left", signal);
  await (deps.sleep ?? wait)(1000);
  return { method: "search-fallback", searchFallbackUsed: true, attempts: [] };
}

async function openChatRecordsFromMenu(
  mainWindow: WindowHandleInfo,
  chatName: string,
  signal: AbortSignal | undefined,
  deps: {
    click?: typeof click;
    pressKey?: typeof pressKey;
    sleep?: typeof wait;
    findChatRecordsWindow?: typeof findChatRecordsWindow;
  },
): Promise<boolean> {
  const doClick = deps.click ?? click;
  const sleepFn = deps.sleep ?? wait;
  const findRecords = deps.findChatRecordsWindow ?? findChatRecordsWindow;
  await doClick({ x: mainWindow.rect.right - 36, y: mainWindow.rect.top + 55 }, "left", signal);
  await sleepFn(700);

  const candidatePoints: Point[] = [
    { x: mainWindow.rect.right - 175, y: mainWindow.rect.top + 150 },
    { x: mainWindow.rect.right - 175, y: mainWindow.rect.top + 220 },
    { x: mainWindow.rect.right - 175, y: mainWindow.rect.top + 300 },
    { x: mainWindow.rect.right - 175, y: mainWindow.rect.top + 390 },
  ];

  for (let attempt = 0; attempt < candidatePoints.length; attempt++) {
    await doClick(candidatePoints[attempt], "left", signal);
    await sleepFn(800);
    if (await findRecords(chatName, signal)) {
      return true;
    }
    if (attempt === 1) {
      await (deps.pressKey ?? pressKey)("pagedown", signal);
      await sleepFn(300);
    }
  }

  return false;
}

async function waitForChatRecordsWindow(
  chatName: string,
  signal: AbortSignal | undefined,
  deps: {
    inspectChatRecordsWindow?: typeof inspectChatRecordsWindow;
    findChatRecordsWindow?: typeof findChatRecordsWindow;
    sleep?: typeof wait;
  },
  onSelection?: (selection: WindowSelectionDiagnostics) => void,
): Promise<WindowHandleInfo | undefined> {
  for (let attempt = 0; attempt < 12; attempt++) {
    let found: WindowHandleInfo | undefined;
    if (deps.findChatRecordsWindow) {
      found = await deps.findChatRecordsWindow(chatName, signal);
    } else {
      const selection = await (deps.inspectChatRecordsWindow ?? inspectChatRecordsWindow)(chatName, signal);
      onSelection?.(selection);
      found = selection.selected;
    }
    if (found) return found;
    await (deps.sleep ?? wait)(500);
  }
  return undefined;
}

function relativePoint(
  window: WindowHandleInfo,
  ratioX: number,
  ratioY: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): Point {
  return {
    x: window.rect.left + Math.max(bounds.minX, Math.min(bounds.maxX, Math.round(window.rect.width * ratioX))),
    y: window.rect.top + Math.max(bounds.minY, Math.min(bounds.maxY, Math.round(window.rect.height * ratioY))),
  };
}

export function weChatConversationListRegion(window: WindowHandleInfo): Region {
  const navWidth = Math.min(72, Math.max(48, Math.round(window.rect.width * 0.045)));
  const availableWidth = Math.max(260, window.rect.width - navWidth - 320);
  const listWidth = Math.min(460, Math.max(320, availableWidth));
  return {
    x: window.rect.left + navWidth,
    y: window.rect.top,
    width: Math.min(listWidth, Math.max(220, window.rect.width - navWidth)),
    height: window.rect.height,
  };
}

function locateResultPoint(region: Region, located: WeChatConversationListLocateResult): Point | undefined {
  let x: number | undefined;
  let y: number | undefined;
  if (typeof located.x === "number" && typeof located.y === "number") {
    x = region.x + Math.round(located.x);
    y = region.y + Math.round(located.y);
  } else if (typeof located.nx === "number" && typeof located.ny === "number") {
    x = region.x + Math.round(region.width * located.nx);
    y = region.y + Math.round(region.height * located.ny);
  }
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  const minX = region.x;
  const maxX = region.x + region.width - 1;
  const minY = region.y;
  const maxY = region.y + region.height - 1;
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  };
}

function windowRectToRegion(rect: WindowRect): Region {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function formatWindowSelectionDiagnostics(selection: WindowSelectionDiagnostics | undefined): string {
  if (!selection) return " Window enumeration did not run.";
  const candidates = selection.candidates.slice(0, 5);
  if (candidates.length === 0) {
    return ` Scanned ${selection.scannedCount} windows; no WeChat-like candidates were found.`;
  }
  const summary = candidates
    .map(({ window, score, reasons }) => {
      const title = window.title ? window.title.slice(0, 80) : "<empty>";
      const processName = window.processName ?? "<unknown>";
      return `hwnd=${window.hwnd}, process=${processName}, size=${window.rect.width}x${window.rect.height}, score=${score}, title=${title}, reasons=${reasons.join("|")}`;
    })
    .join("; ");
  return ` Scanned ${selection.scannedCount} windows; candidates: ${summary}`;
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").replace(/\s+/g, "_");
  return sanitized || "wechat-chat";
}

export function recordsWindowContentRegion(window: WindowHandleInfo): Region {
  const leftInset = 12;
  const topInset = Math.min(140, Math.max(110, Math.round(window.rect.height * 0.14)));
  const rightInset = 12;
  const bottomInset = 6;
  return {
    x: window.rect.left + leftInset,
    y: window.rect.top + topInset,
    width: Math.max(100, window.rect.width - leftInset - rightInset),
    height: Math.max(120, window.rect.height - topInset - bottomInset),
  };
}

export async function splitPngForOcr(
  stitchedPath: string,
  outputDir: string,
  maxHeight: number,
  overlap: number,
): Promise<OcrChunk[]> {
  ensurePositiveInteger(maxHeight, "ocrChunkHeight");
  ensureNonNegativeInteger(overlap, "ocrChunkOverlap");
  if (overlap >= maxHeight) {
    throw new Error("ocrChunkOverlap must be smaller than ocrChunkHeight.");
  }

  await mkdir(outputDir, { recursive: true });
  const bytes = await readFile(stitchedPath);
  const image = decodePng(bytes);
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  const chunks: OcrChunk[] = [];
  let y = 0;
  let index = 1;

  while (y < image.height) {
    const y1 = Math.min(image.height, y + maxHeight);
    const height = y1 - y;
    const outputPath = join(outputDir, `chunk_${String(index).padStart(3, "0")}.png`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${height}" viewBox="0 0 ${image.width} ${height}"><image x="0" y="${-y}" width="${image.width}" height="${image.height}" href="${dataUrl}"/></svg>`;
    const rendered = new Resvg(svg).render();
    await writeFile(outputPath, Buffer.from(rendered.asPng()));
    chunks.push({ index, path: outputPath, y0: y, y1, width: image.width, height });
    if (y1 >= image.height) break;
    y = y1 - overlap;
    index += 1;
  }

  return chunks;
}

export async function writeWechatRecordsManifest(manifestPath: string, value: unknown): Promise<string> {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        ...((value && typeof value === "object") ? value : { value }),
      },
      null,
      2,
    ),
    "utf8",
  );
  return manifestPath;
}
