import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import {
  analyzeWeChatMainWindow,
  calculateAdditionalScrollStep,
  calculateCalibratedScrollStep,
  calculateOverlapRatio,
  captureScrollRegion,
  captureWechatChatRecords,
  confirmSensitiveAction,
  buildSetWindowTopmostScript,
  minimumMeaningfulScrollPixels,
  normalizeApplicationCheckInput,
  orderFramesForStitch,
  parseApplicationCheckResult,
  parseWindowEnumerationResult,
  recordsWindowContentRegion,
  resolvePointInput,
  selectChatRecordsWindow,
  selectWeChatMainWindow,
  setWindowTopmost,
  splitPngForOcr,
  scrollAtTarget,
  startWeChat,
  verticalOverlapRanges,
  weChatConversationListRegion,
  type Region,
  type WindowHandleInfo,
  type ScreenshotResult,
} from "../.pi/extensions/computer-control/src/control.ts";
import type { MimoEnv } from "../.pi/extensions/computer-control/src/env.ts";

const baseEnv: MimoEnv = {
  apiKey: "sk-test-value",
  chatCompletionsUrl: "https://api.xiaomimimo.com/v1/chat/completions",
  providerBaseUrl: "https://api.xiaomimimo.com/v1",
  textModel: "mimo-v2.5",
  visionModel: "mimo-v2.5",
  requireConfirm: true,
  actionDelayMs: 700,
  scrollStep: 6,
  scrollRepeat: 1,
  scrollDelayMs: 120,
  scrollOverlapRatio: 0.1,
  scrollMinOverlapRatio: 0.01,
  scrollCalibrationStep: 3,
  scrollOutputStitched: false,
  longCaptureMaxFrames: 40,
  longCaptureUnchangedFrames: 2,
  longCaptureOutputDir: ".wechat-audit/screenshots",
  wechatRecordsOcrChunkHeight: 3500,
  wechatRecordsOcrChunkOverlap: 80,
};

test("sensitive actions are blocked when confirmation is required but no UI is available", async () => {
  assert.equal(await confirmSensitiveAction(undefined, baseEnv, "Allow?", "Test action"), false);
});

test("sensitive actions can run when confirmation is explicitly disabled", async () => {
  assert.equal(
    await confirmSensitiveAction(undefined, { ...baseEnv, requireConfirm: false }, "Allow?", "Test action"),
    true,
  );
});

test("normalized coordinates resolve against current virtual screen", async () => {
  const resolved = await resolvePointInput({ nx: 0.5, ny: 0.5 });
  assert.equal(resolved.coordinateSource, "normalized");
  assert.ok(resolved.screen);
  assert.equal(resolved.point.x, resolved.screen.left + Math.round(resolved.screen.width * 0.5));
  assert.equal(resolved.point.y, resolved.screen.top + Math.round(resolved.screen.height * 0.5));
});

test("pixel coordinates remain supported", async () => {
  const resolved = await resolvePointInput({ x: 12, y: 34 });
  assert.deepEqual(resolved.point, { x: 12, y: 34 });
  assert.equal(resolved.coordinateSource, "pixel");
});

test("application check input requires at least one matching strategy", () => {
  assert.throws(() => normalizeApplicationCheckInput({}), /Provide appName/);

  assert.deepEqual(normalizeApplicationCheckInput({ appName: " WeChat " }), {
    appName: "WeChat",
    processNames: ["WeChat"],
    windowTitleIncludes: ["WeChat"],
  });
});

test("application check PowerShell JSON is parsed into stable arrays", () => {
  const result = parseApplicationCheckResult(
    JSON.stringify({
      isOpen: true,
      matchedProcesses: {
        id: 123,
        processName: "Weixin",
        windowTitle: "微信",
        path: "C:\\Program Files\\Tencent\\Weixin\\Weixin.exe",
      },
      matchedWindows: [],
    }),
  );

  assert.equal(result.isOpen, true);
  assert.deepEqual(result.matchedProcesses, [
    {
      id: 123,
      processName: "Weixin",
      windowTitle: "微信",
      path: "C:\\Program Files\\Tencent\\Weixin\\Weixin.exe",
    },
  ]);
  assert.deepEqual(result.matchedWindows, []);
});

test("startWeChat does not launch a duplicate process when WeChat is already open", async () => {
  const calls: string[] = [];
  const result = await startWeChat(undefined, async (script) => {
    calls.push(script);
    return {
      stdout: JSON.stringify({
        isOpen: true,
        matchedProcesses: [{ id: 1, processName: "Weixin", windowTitle: "微信" }],
        matchedWindows: [],
      }),
      stderr: "",
    };
  });

  assert.equal(result.started, false);
  assert.equal(result.isOpen, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /Get-Process/);
  assert.doesNotMatch(calls[0], /Start-Process/);
});

test("window selection finds WeChat main and chat-records windows", () => {
  const windows = parseWindowEnumerationResult(
    JSON.stringify([
      windowInfo({ hwnd: 1, title: "Microsoft Edge", processName: "msedge" }),
      windowInfo({ hwnd: 2, title: "微信", processName: "Weixin", width: 1200, height: 900 }),
      windowInfo({ hwnd: 3, title: "“[论文抽屉] 会员群”的聊天记录(474)", processName: "Weixin", width: 700, height: 860 }),
    ]),
  );

  assert.equal(selectWeChatMainWindow(windows)?.hwnd, 2);
  assert.equal(selectChatRecordsWindow(windows, "论文抽屉")?.hwnd, 3);
});

test("window selection uses Weixin process and size when PowerShell title output is mojibake", () => {
  const windows = parseWindowEnumerationResult(
    JSON.stringify({
      windows: [
        windowInfo({ hwnd: 10, title: "wechat - 文件资源管理器", processName: "explorer", width: 1524, height: 793 }),
        windowInfo({ hwnd: 1574668, title: "΢��", processName: "Weixin", className: "Qt51514QWindowIcon", width: 1280, height: 1540 }),
        windowInfo({ hwnd: 20, title: "“论文抽屉”的聊天记录(474)", processName: "Weixin", className: "Qt51514QWindowIcon", width: 700, height: 860 }),
      ],
    }),
  );

  const selection = analyzeWeChatMainWindow(windows);

  assert.equal(selection.selected?.hwnd, 1574668);
  assert.equal(selection.scannedCount, 3);
  assert.equal(selection.candidates.some((candidate) => candidate.window.hwnd === 1574668), true);
});

test("window selection does not treat a non-WeChat title match as the main window", () => {
  const windows = [
    windowInfo({ hwnd: 10, title: "wechat - 文件资源管理器", processName: "explorer", width: 1524, height: 793 }),
  ];

  const selection = analyzeWeChatMainWindow(windows);

  assert.equal(selection.selected, undefined);
  assert.equal(selection.candidates.length, 1);
  assert.equal(selection.candidates[0].window.hwnd, 10);
});

test("setWindowTopmost calls SetWindowPos with topmost and notopmost handles", async () => {
  assert.match(buildSetWindowTopmostScript(123, true), /SetWindowPos/);
  assert.match(buildSetWindowTopmostScript(123, true), /\[IntPtr\]-1/);
  assert.match(buildSetWindowTopmostScript(123, false), /\[IntPtr\]-2/);

  const calls: string[] = [];
  const result = await setWindowTopmost(123, true, undefined, async (script) => {
    calls.push(script);
    return { stdout: JSON.stringify({ hwnd: 123, enabled: true }), stderr: "" };
  });

  assert.deepEqual(result, { hwnd: 123, enabled: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /HWND_TOPMOST|IntPtr\]-1|SetWindowPos/);
});

test("recordsWindowContentRegion skips the chat-record search header", () => {
  const region = recordsWindowContentRegion(
    windowInfo({ hwnd: 3, title: "聊天记录", processName: "Weixin", left: 100, top: 50, width: 700, height: 860 }),
  );

  assert.deepEqual(region, {
    x: 112,
    y: 170,
    width: 676,
    height: 734,
  });
});

test("captureWechatChatRecords orchestrates WeChat navigation, fallback, capture, split, and topmost restore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wechat-records-"));
  const events: Array<[string, ...unknown[]]> = [];
  const mainWindow = windowInfo({ hwnd: 11, title: "微信", processName: "Weixin", left: 100, top: 50, width: 1000, height: 800 });
  const recordsWindow = windowInfo({
    hwnd: 22,
    title: "“论文抽屉”的聊天记录(474)",
    processName: "Weixin",
    left: 220,
    top: 90,
    width: 700,
    height: 860,
  });
  let recordsReady = false;

  const result = await captureWechatChatRecords(
    {
      chatName: "论文抽屉",
      outputDir: dir,
      maxFrames: 7,
      ocrChunkHeight: 3500,
      ocrChunkOverlap: 80,
    },
    {
      ...captureDefaults(join(dir, "unused-default")),
      outputStitched: true,
      wechatRecordsOutputDir: join(dir, "default-records"),
      ocrChunkHeight: 3500,
      ocrChunkOverlap: 80,
    },
    undefined,
    {
      startWeChat: async () => {
        events.push(["start"]);
        return { started: false, isOpen: true, check: { isOpen: true, matchedProcesses: [], matchedWindows: [] }, stdout: "", stderr: "" };
      },
      findWeChatMainWindow: async () => mainWindow,
      activateWindow: async (hwnd) => {
        events.push(["activate", hwnd]);
      },
      setWindowTopmost: async (hwnd, enabled) => {
        events.push(["topmost", hwnd, enabled]);
        return { hwnd, enabled };
      },
      captureFrame: async (path, region) => {
        events.push(["capture", path, region]);
        return screenshot(path, region?.width ?? 1, region?.height ?? 1, region?.x ?? 0, region?.y ?? 0);
      },
      click: async (point) => {
        events.push(["click", point.x, point.y]);
      },
      typeText: async (text) => {
        events.push(["type", text]);
      },
      hotkey: async (keys) => {
        events.push(["hotkey", keys.join("+")]);
        if (keys.map((key) => key.toLowerCase()).join("+") === "control+f") {
          recordsReady = true;
        }
      },
      pressKey: async (key) => {
        events.push(["key", key]);
      },
      sleep: async () => undefined,
      findChatRecordsWindow: async () => (recordsReady ? recordsWindow : undefined),
      captureScrollRegion: async (params) => {
        events.push(["scrollCapture", params.region, params.maxFrames, params.outputStitched]);
        return {
          manifestPath: join(dir, "raw_frames", "manifest.json"),
          frames: [],
          frameCount: 3,
          stopReason: "unchanged",
          preflight: { boundaryRestore: { enabled: false, attempts: 0, stopReason: "disabled" } },
          calibration: {
            autoCalibrate: true,
            calibrationStep: 3,
            inputMethod: "wheel",
            overlapRatio: 0.1,
            targetPixels: 100,
            reliable: true,
          },
          overlaps: [],
          region: params.region,
          scroll: {
            direction: "up",
            inputMethod: "wheel",
            scrollStep: 6,
            delta: 6,
            maxFrames: params.maxFrames ?? 40,
            delayMs: 120,
            unchangedFrameLimit: 2,
            minOverlapRatio: 0.01,
            maxOverlapRatio: 0.1,
            restoreToBoundary: true,
            restoreScrollStep: 48,
            restoreMaxAttempts: 80,
            restoreUnchangedFrameLimit: 3,
            outputStitched: true,
          },
          stitchedPath: join(dir, "stitched", "long.png"),
        };
      },
      splitPngForOcr: async (stitchedPath, outputDir, maxHeight, overlap) => {
        events.push(["split", stitchedPath, outputDir, maxHeight, overlap]);
        return [{ index: 1, path: join(outputDir, "chunk_001.png"), y0: 0, y1: 100, width: 10, height: 100 }];
      },
    },
  );

  assert.equal(result.chatName, "论文抽屉");
  assert.equal(result.menuFallbackUsed, true);
  assert.equal(result.mainWindow.hwnd, 11);
  assert.equal(result.recordsWindow.hwnd, 22);
  assert.equal(result.ocrChunks.length, 1);
  assert.equal(events.some((event) => event[0] === "scrollCapture"), true);
  assert.deepEqual(events.filter((event) => event[0] === "topmost"), [
    ["topmost", 11, true],
    ["topmost", 22, true],
    ["topmost", 22, false],
    ["topmost", 11, false],
  ]);

  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as { chatName: string; menuFallbackUsed: boolean };
  assert.equal(manifest.chatName, "论文抽屉");
  assert.equal(manifest.menuFallbackUsed, true);
});

test("captureWechatChatRecords opens a chat from the VLM-scanned conversation list before search fallback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wechat-records-vlm-"));
  const events: Array<[string, ...unknown[]]> = [];
  const mainWindow = windowInfo({ hwnd: 11, title: "微信", processName: "Weixin", left: 100, top: 50, width: 1000, height: 800 });
  const recordsWindow = windowInfo({
    hwnd: 22,
    title: "“论文抽屉”的聊天记录(474)",
    processName: "Weixin",
    left: 220,
    top: 90,
    width: 700,
    height: 860,
  });
  const listRegion = weChatConversationListRegion(mainWindow);

  const result = await captureWechatChatRecords(
    {
      chatName: "论文抽屉",
      outputDir: dir,
      maxFrames: 3,
    },
    {
      ...captureDefaults(join(dir, "unused-default")),
      outputStitched: true,
      wechatRecordsOutputDir: join(dir, "default-records"),
      ocrChunkHeight: 3500,
      ocrChunkOverlap: 80,
    },
    undefined,
    {
      startWeChat: async () => {
        events.push(["start"]);
        return { started: false, isOpen: true, check: { isOpen: true, matchedProcesses: [], matchedWindows: [] }, stdout: "", stderr: "" };
      },
      findWeChatMainWindow: async () => mainWindow,
      activateWindow: async (hwnd) => {
        events.push(["activate", hwnd]);
      },
      setWindowTopmost: async (hwnd, enabled) => {
        events.push(["topmost", hwnd, enabled]);
        return { hwnd, enabled };
      },
      captureFrame: async (path, region) => {
        events.push(["capture", path, region]);
        return screenshot(path, region?.width ?? 1, region?.height ?? 1, region?.x ?? 0, region?.y ?? 0);
      },
      locateConversationInList: async (input) => {
        events.push(["vlm", input.chatName, input.attempt, input.region]);
        return {
          found: true,
          x: 180,
          y: 116,
          label: "target_conversation",
          summary: "target row visible",
          visibleText: ["论文抽屉 会员群"],
        };
      },
      click: async (point) => {
        events.push(["click", point.x, point.y]);
      },
      typeText: async () => {
        throw new Error("search fallback should not type when VLM list scan succeeds");
      },
      hotkey: async (keys) => {
        events.push(["hotkey", keys.join("+")]);
      },
      pressKey: async (key) => {
        events.push(["key", key]);
      },
      sleep: async () => undefined,
      findChatRecordsWindow: async () => recordsWindow,
      captureScrollRegion: async (params) => {
        events.push(["scrollCapture", params.region, params.maxFrames, params.outputStitched]);
        return {
          manifestPath: join(dir, "raw_frames", "manifest.json"),
          frames: [],
          frameCount: 1,
          stopReason: "unchanged",
          preflight: { boundaryRestore: { enabled: false, attempts: 0, stopReason: "disabled" } },
          calibration: {
            autoCalibrate: true,
            calibrationStep: 3,
            inputMethod: "wheel",
            overlapRatio: 0.1,
            targetPixels: 100,
            reliable: true,
          },
          overlaps: [],
          region: params.region,
          scroll: {
            direction: "up",
            inputMethod: "wheel",
            scrollStep: 6,
            delta: 6,
            maxFrames: params.maxFrames ?? 40,
            delayMs: 120,
            unchangedFrameLimit: 2,
            minOverlapRatio: 0.01,
            maxOverlapRatio: 0.1,
            restoreToBoundary: true,
            restoreScrollStep: 48,
            restoreMaxAttempts: 80,
            restoreUnchangedFrameLimit: 3,
            outputStitched: true,
          },
          stitchedPath: join(dir, "stitched", "long.png"),
        };
      },
      splitPngForOcr: async () => [],
    },
  );

  assert.equal(result.chatOpen.method, "conversation-list-vlm");
  assert.equal(result.chatOpen.searchFallbackUsed, false);
  assert.deepEqual(result.chatOpen.attempts[0].point, { x: listRegion.x + 180, y: listRegion.y + 116 });
  assert.equal(events.some((event) => event[0] === "vlm"), true);
  assert.equal(events.some((event) => event[0] === "type"), false);
});

test("splitPngForOcr creates bounded overlapping chunks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ocr-chunks-"));
  const source = join(dir, "source.png");
  await writeFile(source, tinyPng2x3());

  const chunks = await splitPngForOcr(source, join(dir, "chunks"), 2, 1);

  assert.deepEqual(
    chunks.map((chunk) => ({ y0: chunk.y0, y1: chunk.y1, height: chunk.height })),
    [
      { y0: 0, y1: 2, height: 2 },
      { y0: 1, y1: 3, height: 2 },
    ],
  );
  for (const chunk of chunks) {
    const bytes = await readFile(chunk.path);
    assert.equal(bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  }
});

test("scrollAtTarget moves to a region center before scrolling with configured repeat", async () => {
  const events: Array<[string, ...unknown[]]> = [];
  const region: Region = { x: 10, y: 20, width: 100, height: 200 };

  const result = await scrollAtTarget(
    { region, delta: -6, repeat: 2, delayMs: 5 },
    { repeat: 1, delayMs: 120 },
    undefined,
    {
      captureScreenshot: async (capturedRegion) => {
        events.push(["capture", capturedRegion]);
        return screenshot("region.png", 100, 200, 110, 220);
      },
      removeFileIfExists: async (path) => {
        events.push(["remove", path]);
      },
      moveMouse: async (point) => {
        events.push(["move", point]);
      },
      scroll: async (delta) => {
        events.push(["scroll", delta]);
      },
      sleep: async (milliseconds) => {
        events.push(["sleep", milliseconds]);
      },
    },
  );

  assert.deepEqual(result.target, {
    point: { x: 160, y: 320 },
    coordinateSource: "region-center",
  });
  assert.deepEqual(events, [
    ["capture", region],
    ["remove", "region.png"],
    ["move", { x: 160, y: 320 }],
    ["scroll", -6],
    ["sleep", 5],
    ["scroll", -6],
  ]);
});

test("calibrated scroll step keeps the configured overlap ratio", () => {
  assert.equal(
    calculateCalibratedScrollStep({
      calibrationStep: 6,
      regionHeight: 900,
      measuredPixels: 420,
      overlapRatio: 0.1,
    }),
    12,
  );
});

test("overlap helpers quantify accepted production-frame overlap", () => {
  assert.equal(calculateOverlapRatio(1000, 900), 0.1);
  assert.equal(minimumMeaningfulScrollPixels(100), 8);
  assert.equal(minimumMeaningfulScrollPixels(1000), 20);
  assert.equal(
    calculateAdditionalScrollStep({
      cumulativeStep: 6,
      regionHeight: 1000,
      measuredPixels: 600,
      targetOverlapRatio: 0.1,
    }),
    3,
  );
});

test("vertical overlap ranges match scroll direction", () => {
  assert.deepEqual(verticalOverlapRanges("up", 100, 20), {
    beforeY: 0,
    afterY: 20,
    height: 80,
  });
  assert.deepEqual(verticalOverlapRanges("down", 100, 20), {
    beforeY: 20,
    afterY: 0,
    height: 80,
  });
});

test("captureScrollRegion calibrates once, captures per-step frames, and writes a manifest by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scroll-capture-"));
  const region: Region = { x: 8, y: 16, width: 80, height: 100 };
  const events: Array<[string, ...unknown[]]> = [];
  let measurementIndex = 0;

  const result = await captureScrollRegion(
    {
      region,
      maxFrames: 4,
      outputDir: dir,
    },
    captureDefaults(dir),
    undefined,
    {
      captureFrame: async (path, capturedRegion) => {
        events.push(["capture", path, capturedRegion]);
        return screenshot(path, 80, 100, 108, 216);
      },
      moveMouse: async (point) => {
        events.push(["move", point]);
      },
      scroll: async (delta) => {
        events.push(["scroll", delta]);
      },
      sleep: async (milliseconds) => {
        events.push(["sleep", milliseconds]);
      },
      hashFile: async (path) => path,
      measureScrollPixels: async () => ({
        measuredPixels: measurementIndex++ === 0 ? 30 : 90,
        score: 0,
      }),
      stitchFrames: async () => {
        throw new Error("stitch should not run by default");
      },
      writeManifest: async (manifestPath, manifest) => {
        events.push(["manifest", manifestPath, manifest.frameCount, manifest.calibration.bestStep, manifest.overlaps.length]);
        return manifestPath;
      },
    },
  );

  assert.equal(result.stopReason, "maxFrames");
  assert.equal(result.frameCount, 4);
  assert.equal(result.stitchedPath, undefined);
  assert.equal(result.manifestPath, join(dir, "manifest.json"));
  assert.deepEqual(result.preflight.boundaryRestore, {
    enabled: false,
    attempts: 0,
    stopReason: "disabled",
  });
  assert.deepEqual(result.calibration, {
    autoCalibrate: true,
    calibrationStep: 3,
    inputMethod: "wheel",
    overlapRatio: 0.1,
    targetPixels: 90,
    measuredPixels: 30,
    bestStep: 9,
    score: 0,
    reliable: true,
  });
  assert.deepEqual(result.scroll, {
    direction: "up",
    inputMethod: "wheel",
    scrollStep: 9,
    delta: 9,
    maxFrames: 4,
    delayMs: 120,
    unchangedFrameLimit: 2,
    minOverlapRatio: 0.01,
    maxOverlapRatio: 0.1,
    restoreToBoundary: false,
    restoreScrollStep: 48,
    restoreMaxAttempts: 80,
    restoreUnchangedFrameLimit: 3,
    outputStitched: false,
  });
  assert.deepEqual(result.overlaps.map((overlap) => overlap.overlapRatio), [0.1, 0.1]);
  assert.deepEqual(events.slice(0, 8), [
    ["capture", join(dir, "frame-000.png"), region],
    ["move", { x: 148, y: 266 }],
    ["scroll", 3],
    ["sleep", 120],
    ["capture", join(dir, "frame-001.png"), region],
    ["scroll", 9],
    ["sleep", 120],
    ["capture", join(dir, "frame-002.png"), region],
  ]);
  assert.deepEqual(events.at(-1), ["manifest", join(dir, "manifest.json"), 4, 9, 2]);
});

test("captureScrollRegion can restore the start boundary before saving frame-000", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scroll-restore-"));
  const region: Region = { x: 8, y: 16, width: 80, height: 100 };
  const events: Array<[string, ...unknown[]]> = [];

  const result = await captureScrollRegion(
    {
      region,
      maxFrames: 1,
      outputDir: dir,
      restoreToBoundary: true,
      restoreScrollStep: 24,
      restoreMaxAttempts: 5,
      restoreUnchangedFrameLimit: 1,
    },
    captureDefaults(dir),
    undefined,
    {
      captureFrame: async (path, capturedRegion) => {
        events.push(["capture", path, capturedRegion]);
        return screenshot(path, 80, 100, 108, 216);
      },
      moveMouse: async (point) => {
        events.push(["move", point]);
      },
      scroll: async (delta) => {
        events.push(["scroll", delta]);
      },
      sleep: async (milliseconds) => {
        events.push(["sleep", milliseconds]);
      },
      hashFile: async (path) => (path.includes("preflight-boundary") ? "boundary" : path),
      removeFileIfExists: async (path) => {
        events.push(["remove", path]);
      },
      writeManifest: async (manifestPath) => manifestPath,
    },
  );

  assert.equal(result.stopReason, "maxFrames");
  assert.equal(result.frameCount, 1);
  assert.deepEqual(result.preflight.boundaryRestore, {
    enabled: true,
    targetBoundary: "bottom",
    scrollDirection: "down",
    inputMethod: "wheel",
    scrollStep: 24,
    delta: -24,
    maxAttempts: 5,
    unchangedFrameLimit: 1,
    attempts: 1,
    stopReason: "unchanged",
  });
  assert.deepEqual(events, [
    ["capture", join(dir, "preflight-boundary-000.png"), region],
    ["move", { x: 148, y: 266 }],
    ["scroll", -12],
    ["scroll", -12],
    ["sleep", 120],
    ["capture", join(dir, "preflight-boundary-001.png"), region],
    ["remove", join(dir, "preflight-boundary-000.png")],
    ["remove", join(dir, "preflight-boundary-001.png")],
    ["capture", join(dir, "frame-000.png"), region],
    ["move", { x: 148, y: 266 }],
  ]);
});

test("captureScrollRegion stops before capture when boundary restore cannot settle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scroll-restore-fail-"));
  const events: Array<[string, ...unknown[]]> = [];
  let hashIndex = 0;

  const result = await captureScrollRegion(
    {
      region: { x: 0, y: 0, width: 20, height: 20 },
      maxFrames: 3,
      outputDir: dir,
      restoreToBoundary: true,
      restoreScrollStep: 12,
      restoreMaxAttempts: 1,
      restoreUnchangedFrameLimit: 2,
    },
    captureDefaults(dir),
    undefined,
    {
      captureFrame: async (path, capturedRegion) => {
        events.push(["capture", path, capturedRegion]);
        return screenshot(path, 20, 20, 0, 0);
      },
      moveMouse: async (point) => {
        events.push(["move", point]);
      },
      scroll: async (delta) => {
        events.push(["scroll", delta]);
      },
      sleep: async () => undefined,
      hashFile: async () => `hash-${hashIndex++}`,
      removeFileIfExists: async (path) => {
        events.push(["remove", path]);
      },
      writeManifest: async (manifestPath) => manifestPath,
    },
  );

  assert.equal(result.stopReason, "boundaryRestoreFailed");
  assert.equal(result.frameCount, 0);
  assert.deepEqual(result.preflight.boundaryRestore, {
    enabled: true,
    targetBoundary: "bottom",
    scrollDirection: "down",
    inputMethod: "wheel",
    scrollStep: 12,
    delta: -12,
    maxAttempts: 1,
    unchangedFrameLimit: 2,
    attempts: 1,
    stopReason: "maxAttempts",
  });
  assert.equal(events.some((event) => event[1] === join(dir, "frame-000.png")), false);
});

test("captureScrollRegion boundary restore treats tiny measured movement as unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scroll-restore-tiny-"));
  const events: Array<[string, ...unknown[]]> = [];

  const result = await captureScrollRegion(
    {
      region: { x: 0, y: 0, width: 20, height: 100 },
      autoCalibrate: false,
      maxFrames: 1,
      outputDir: dir,
      restoreToBoundary: true,
      restoreScrollStep: 12,
      restoreMaxAttempts: 5,
      restoreUnchangedFrameLimit: 2,
    },
    captureDefaults(dir),
    undefined,
    {
      captureFrame: async (path, capturedRegion) => {
        events.push(["capture", path, capturedRegion]);
        return screenshot(path, 20, 100, 0, 0);
      },
      moveMouse: async (point) => {
        events.push(["move", point]);
      },
      scroll: async (delta) => {
        events.push(["scroll", delta]);
      },
      sleep: async () => undefined,
      hashFile: async (path) => path,
      measureScrollPixels: async () => ({ measuredPixels: 1, score: 0 }),
      removeFileIfExists: async (path) => {
        events.push(["remove", path]);
      },
      writeManifest: async (manifestPath) => manifestPath,
    },
  );

  assert.equal(result.frameCount, 1);
  assert.equal(result.preflight.boundaryRestore.stopReason, "unchanged");
  assert.equal(result.preflight.boundaryRestore.attempts, 2);
  assert.equal(events.filter((event) => event[0] === "scroll").length, 2);
});

test("captureScrollRegion uses End before confirming the bottom boundary when focus is available", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scroll-restore-end-"));
  const events: Array<[string, ...unknown[]]> = [];

  const result = await captureScrollRegion(
    {
      region: { x: 0, y: 0, width: 20, height: 100 },
      autoCalibrate: false,
      maxFrames: 1,
      outputDir: dir,
      restoreToBoundary: true,
      restoreScrollStep: 12,
      restoreMaxAttempts: 5,
      restoreUnchangedFrameLimit: 1,
    },
    captureDefaults(dir),
    undefined,
    {
      captureFrame: async (path, capturedRegion) => {
        events.push(["capture", path, capturedRegion]);
        return screenshot(path, 20, 100, 0, 0);
      },
      moveMouse: async (point) => {
        events.push(["move", point]);
      },
      click: async (point) => {
        events.push(["click", point]);
      },
      scroll: async (delta) => {
        events.push(["scroll", delta]);
      },
      pressKey: async (key) => {
        events.push(["key", key]);
      },
      sleep: async () => undefined,
      hashFile: async () => "boundary",
      measureScrollPixels: async () => ({ measuredPixels: 1, score: 0 }),
      removeFileIfExists: async (path) => {
        events.push(["remove", path]);
      },
      writeManifest: async (manifestPath) => manifestPath,
    },
  );

  assert.equal(result.frameCount, 1);
  assert.equal(result.preflight.boundaryRestore.stopReason, "unchanged");
  assert.equal(result.preflight.boundaryRestore.jumpKey, "end");
  assert.deepEqual(events.filter((event) => event[0] === "key"), [["key", "end"]]);
});

test("captureScrollRegion only stitches when outputStitched is true", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scroll-stitch-"));
  const events: Array<[string, ...unknown[]]> = [];

  const result = await captureScrollRegion(
    {
      region: { x: 0, y: 0, width: 20, height: 20 },
      maxFrames: 2,
      outputDir: dir,
      outputStitched: true,
      outputPath: join(dir, "stitched.png"),
    },
    captureDefaults(dir),
    undefined,
    {
      captureFrame: async (path) => screenshot(path, 20, 20, 0, 0),
      moveMouse: async () => undefined,
      scroll: async () => undefined,
      sleep: async () => undefined,
      hashFile: async (path) => path,
      measureScrollPixels: async () => ({ measuredPixels: 10, score: 0 }),
      stitchFrames: async (frames, outputPath, direction) => {
        events.push(["stitch", frames.map((frame) => frame.path), outputPath, direction]);
        return outputPath;
      },
      writeManifest: async (manifestPath) => manifestPath,
    },
  );

  assert.equal(result.stitchedPath, join(dir, "stitched.png"));
  assert.deepEqual(events, [
    ["stitch", [join(dir, "frame-000.png"), join(dir, "frame-001.png")], join(dir, "stitched.png"), "up"],
  ]);
});

test("captureScrollRegion retakes a production frame when overlap is too high", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scroll-retake-"));
  const events: Array<[string, ...unknown[]]> = [];
  const measurements = [30, 80, 90];

  const result = await captureScrollRegion(
    {
      region: { x: 0, y: 0, width: 20, height: 100 },
      maxFrames: 3,
      outputDir: dir,
    },
    captureDefaults(dir),
    undefined,
    {
      captureFrame: async (path) => {
        events.push(["capture", path]);
        return screenshot(path, 20, 100, 0, 0);
      },
      moveMouse: async () => undefined,
      scroll: async (delta) => {
        events.push(["scroll", delta]);
      },
      sleep: async () => undefined,
      hashFile: async (path) => `${path}:${events.length}`,
      measureScrollPixels: async () => ({
        measuredPixels: measurements.shift() ?? 90,
        score: 0,
      }),
      removeFileIfExists: async (path) => {
        events.push(["remove", path]);
      },
      writeManifest: async (manifestPath) => manifestPath,
    },
  );

  assert.equal(result.frameCount, 3);
  assert.deepEqual(result.overlaps, [
    {
      frameIndex: 2,
      previousFrameIndex: 1,
      inputMethod: "wheel",
      scrollStep: 10,
      delta: 10,
      measuredPixels: 90,
      overlapRatio: 0.1,
      score: 0,
      adjustmentAttempts: 1,
    },
  ]);
  assert.deepEqual(events, [
    ["capture", join(dir, "frame-000.png")],
    ["scroll", 3],
    ["capture", join(dir, "frame-001.png")],
    ["scroll", 9],
    ["capture", join(dir, "frame-002.png")],
    ["remove", join(dir, "frame-002.png")],
    ["scroll", 1],
    ["capture", join(dir, "frame-002.png")],
  ]);
});

test("captureScrollRegion falls back to page keys when wheel calibration does not move", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scroll-keyboard-fallback-"));
  const events: Array<[string, ...unknown[]]> = [];
  let captureIndex = 0;

  const result = await captureScrollRegion(
    {
      region: { x: 0, y: 0, width: 20, height: 100 },
      maxFrames: 5,
      outputDir: dir,
    },
    captureDefaults(dir),
    undefined,
    {
      captureFrame: async (path) => {
        events.push(["capture", path]);
        captureIndex += 1;
        return screenshot(path, 20, 100, 0, 0);
      },
      moveMouse: async (point) => {
        events.push(["move", point]);
      },
      click: async (point) => {
        events.push(["click", point]);
      },
      scroll: async (delta) => {
        events.push(["scroll", delta]);
      },
      pressKey: async (key) => {
        events.push(["key", key]);
      },
      sleep: async () => undefined,
      hashFile: async () => (captureIndex <= 2 ? "bottom" : `frame-${captureIndex}`),
      measureScrollPixels: async () => ({ measuredPixels: 90, score: 0 }),
      writeManifest: async (manifestPath) => manifestPath,
    },
  );

  assert.equal(result.stopReason, "maxFrames");
  assert.equal(result.calibration.inputMethod, "keyboard-page");
  assert.equal(result.calibration.calibrationStep, 1);
  assert.equal(result.calibration.bestStep, 1);
  assert.equal(result.scroll.inputMethod, "keyboard-page");
  assert.deepEqual(result.overlaps.map((overlap) => overlap.inputMethod), ["keyboard-page", "keyboard-page"]);
  assert.deepEqual(events.filter((event) => event[0] === "scroll"), [["scroll", 3]]);
  assert.deepEqual(events.filter((event) => event[0] === "key"), [["key", "pageup"], ["key", "pageup"], ["key", "pageup"]]);
});

test("captureScrollRegion stops when calibration has no reliable overlap", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scroll-calibration-fail-"));
  const events: Array<[string, ...unknown[]]> = [];

  const result = await captureScrollRegion(
    {
      region: { x: 0, y: 0, width: 20, height: 20 },
      maxFrames: 5,
      outputDir: dir,
    },
    captureDefaults(dir),
    undefined,
    {
      captureFrame: async (path) => screenshot(path, 20, 20, 0, 0),
      moveMouse: async () => undefined,
      scroll: async (delta) => {
        events.push(["scroll", delta]);
      },
      sleep: async () => undefined,
      hashFile: async (path) => path,
      measureScrollPixels: async () => undefined,
      writeManifest: async (manifestPath) => manifestPath,
    },
  );

  assert.equal(result.stopReason, "calibrationFailed");
  assert.equal(result.frameCount, 5);
  assert.equal(result.calibration.reliable, false);
  assert.equal(result.calibration.calibrationStep, 45);
  assert.equal(result.calibration.failureReason, "noReliableOverlap");
  assert.deepEqual(events, [["scroll", 3], ["scroll", 6], ["scroll", 12], ["scroll", 12], ["scroll", 12]]);
});

test("captureScrollRegion stops without saving an unchanged production frame", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scroll-unchanged-"));
  const events: Array<[string, ...unknown[]]> = [];

  const result = await captureScrollRegion(
    {
      region: { x: 0, y: 0, width: 20, height: 20 },
      autoCalibrate: false,
      maxFrames: 5,
      unchangedFrameLimit: 2,
      outputDir: dir,
      scrollStep: 4,
    },
    captureDefaults(dir),
    undefined,
    {
      captureFrame: async (path) => {
        events.push(["capture", path]);
        return screenshot(path, 20, 20, 0, 0);
      },
      moveMouse: async () => undefined,
      scroll: async (delta) => {
        events.push(["scroll", delta]);
      },
      sleep: async () => undefined,
      hashFile: async () => "same",
      removeFileIfExists: async (path) => {
        events.push(["remove", path]);
      },
      writeManifest: async (manifestPath) => manifestPath,
    },
  );

  assert.equal(result.stopReason, "unchanged");
  assert.equal(result.frameCount, 1);
  assert.equal(result.calibration.autoCalibrate, false);
  assert.equal(result.calibration.bestStep, 4);
  assert.deepEqual(result.overlaps, []);
  assert.deepEqual(events, [
    ["capture", join(dir, "frame-000.png")],
    ["scroll", 4],
    ["capture", join(dir, "frame-001.png")],
    ["remove", join(dir, "frame-001.png")],
  ]);
});

test("captureScrollRegion stops without saving a production frame when measured movement is tiny", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scroll-tiny-move-"));
  const events: Array<[string, ...unknown[]]> = [];

  const result = await captureScrollRegion(
    {
      region: { x: 0, y: 0, width: 20, height: 100 },
      autoCalibrate: false,
      maxFrames: 5,
      outputDir: dir,
      scrollStep: 4,
    },
    captureDefaults(dir),
    undefined,
    {
      captureFrame: async (path) => {
        events.push(["capture", path]);
        return screenshot(path, 20, 100, 0, 0);
      },
      moveMouse: async () => undefined,
      scroll: async (delta) => {
        events.push(["scroll", delta]);
      },
      sleep: async () => undefined,
      hashFile: async (path) => path,
      measureScrollPixels: async () => ({ measuredPixels: 1, score: 0 }),
      removeFileIfExists: async (path) => {
        events.push(["remove", path]);
      },
      writeManifest: async (manifestPath) => manifestPath,
    },
  );

  assert.equal(result.stopReason, "unchanged");
  assert.equal(result.frameCount, 1);
  assert.deepEqual(result.overlaps, []);
  assert.deepEqual(events, [
    ["capture", join(dir, "frame-000.png")],
    ["scroll", 4],
    ["capture", join(dir, "frame-001.png")],
    ["remove", join(dir, "frame-001.png")],
  ]);
});

test("upward scroll capture stitches older frames above newer frames", () => {
  const frames = ["newest", "middle", "oldest"];
  assert.deepEqual(orderFramesForStitch(frames, "up"), ["oldest", "middle", "newest"]);
  assert.deepEqual(orderFramesForStitch(frames, "down"), ["newest", "middle", "oldest"]);
});

function screenshot(
  path: string,
  width: number,
  height: number,
  left: number,
  top: number,
): ScreenshotResult {
  return { path, width, height, left, top };
}

function windowInfo(input: {
  hwnd: number;
  title: string;
  className?: string;
  processName?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}): WindowHandleInfo {
  const left = input.left ?? 0;
  const top = input.top ?? 0;
  const width = input.width ?? 400;
  const height = input.height ?? 300;
  return {
    hwnd: input.hwnd,
    title: input.title,
    className: input.className,
    processName: input.processName,
    rect: {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    },
  };
}

function tinyPng2x3(): Buffer {
  const width = 2;
  const height = 3;
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    scanlines[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const offset = rowStart + 1 + x * 3;
      scanlines[offset] = x * 80;
      scanlines[offset + 1] = y * 70;
      scanlines[offset + 2] = 180;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  return Buffer.concat([u32(data.length), Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function captureDefaults(outputDir: string) {
  return {
    scrollStep: 6,
    calibrationStep: 3,
    overlapRatio: 0.1,
    minOverlapRatio: 0.01,
    maxFrames: 40,
    delayMs: 120,
    unchangedFrameLimit: 2,
    outputDir,
    outputStitched: false,
  };
}
