import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { MimoEnv } from "./env.js";

export type Region = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenshotResult = {
  path: string;
  width: number;
  height: number;
  left: number;
  top: number;
};

export type Point = {
  x: number;
  y: number;
};

export type PointInput = {
  x?: number;
  y?: number;
  nx?: number;
  ny?: number;
};

export type ResolvedPoint = {
  point: Point;
  coordinateSource: "pixel" | "normalized";
  screen?: ScreenshotResult;
};

export type ApplicationCheckInput = {
  appName?: string;
  processNames?: string[];
  windowTitleIncludes?: string[];
};

export type NormalizedApplicationCheckInput = {
  appName?: string;
  processNames: string[];
  windowTitleIncludes: string[];
};

export type ApplicationProcessMatch = {
  id: number;
  processName: string;
  windowTitle?: string;
  path?: string;
};

export type ApplicationWindowMatch = ApplicationProcessMatch;

export type ApplicationCheckResult = {
  isOpen: boolean;
  matchedProcesses: ApplicationProcessMatch[];
  matchedWindows: ApplicationWindowMatch[];
};

export type StartWeChatResult = {
  started: boolean;
  isOpen: boolean;
  path?: string;
  check: ApplicationCheckResult;
  stdout: string;
  stderr: string;
};

export type WindowRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type WindowHandleInfo = {
  hwnd: number;
  title: string;
  className?: string;
  processId?: number;
  processName?: string;
  rect: WindowRect;
};

export type WindowCandidateDiagnostic = {
  window: WindowHandleInfo;
  score: number;
  reasons: string[];
};

export type WindowSelectionDiagnostics = {
  selected?: WindowHandleInfo;
  scannedCount: number;
  candidates: WindowCandidateDiagnostic[];
};

export type WindowTopmostResult = {
  hwnd: number;
  enabled: boolean;
};

export type OcrChunk = {
  index: number;
  path: string;
  y0: number;
  y1: number;
  width: number;
  height: number;
};

export type WeChatConversationListLocateInput = {
  chatName: string;
  screenshotPath: string;
  region: Region;
  attempt: number;
};

export type WeChatConversationListLocateResult = {
  found: boolean;
  x?: number;
  y?: number;
  nx?: number;
  ny?: number;
  label?: string;
  summary?: string;
  visibleText?: string[];
  rawText?: string;
};

export type WeChatChatOpenResult = {
  method: "conversation-list-vlm" | "search-fallback";
  searchFallbackUsed: boolean;
  attempts: Array<{
    attempt: number;
    screenshotPath: string;
    region: Region;
    found: boolean;
    point?: Point;
    label?: string;
    summary?: string;
    visibleText?: string[];
  }>;
};

export type ScrollTargetSource = "current-cursor" | "pixel" | "normalized" | "region-center";

export type ScrollActionParams = PointInput & {
  region?: Region;
  delta: number;
  repeat?: number;
  delayMs?: number;
};

export type ScrollActionDefaults = {
  repeat: number;
  delayMs: number;
};

export type ScrollActionResult = {
  delta: number;
  repeat: number;
  delayMs: number;
  target?: {
    point: Point;
    coordinateSource: ScrollTargetSource;
  };
};

export type ScrollDirection = "up" | "down";

export type ScrollInputMethod = "wheel" | "keyboard-page";

export type CaptureScrollRegionParams = {
  region: Region;
  direction?: ScrollDirection;
  scrollStep?: number;
  autoCalibrate?: boolean;
  calibrationStep?: number;
  overlapRatio?: number;
  minOverlapRatio?: number;
  restoreToBoundary?: boolean;
  restoreScrollStep?: number;
  restoreMaxAttempts?: number;
  restoreUnchangedFrameLimit?: number;
  maxFrames?: number;
  delayMs?: number;
  unchangedFrameLimit?: number;
  outputDir?: string;
  outputPath?: string;
  outputStitched?: boolean;
};

export type CaptureScrollRegionDefaults = {
  scrollStep: number;
  calibrationStep: number;
  overlapRatio: number;
  minOverlapRatio: number;
  maxFrames: number;
  delayMs: number;
  unchangedFrameLimit: number;
  outputDir: string;
  outputStitched: boolean;
};

export type CaptureScrollRegionStopReason =
  | "maxFrames"
  | "unchanged"
  | "boundaryRestoreFailed"
  | "calibrationFailed"
  | "overlapTooLow"
  | "overlapTooHigh"
  | "overlapMeasurementFailed";

export type ScrollBoundaryTarget = "top" | "bottom";

export type ScrollBoundaryRestoreStopReason = "disabled" | "unchanged" | "maxAttempts";

export type ScrollBoundaryRestoreResult = {
  enabled: boolean;
  targetBoundary?: ScrollBoundaryTarget;
  scrollDirection?: ScrollDirection;
  jumpKey?: "home" | "end";
  inputMethod?: ScrollInputMethod;
  scrollStep?: number;
  delta?: number;
  maxAttempts?: number;
  unchangedFrameLimit?: number;
  attempts: number;
  stopReason: ScrollBoundaryRestoreStopReason;
};

export type ScrollCalibrationResult = {
  autoCalibrate: boolean;
  calibrationStep: number;
  inputMethod: ScrollInputMethod;
  overlapRatio: number;
  targetPixels: number;
  measuredPixels?: number;
  bestStep?: number;
  score?: number;
  reliable: boolean;
  failureReason?: string;
};

export type ScrollMeasurementResult = {
  measuredPixels: number;
  score: number;
};

export type ScrollFrameOverlap = {
  frameIndex: number;
  previousFrameIndex: number;
  inputMethod: ScrollInputMethod;
  scrollStep: number;
  delta: number;
  measuredPixels: number;
  overlapRatio: number;
  score: number;
  adjustmentAttempts: number;
};

export type CaptureScrollRegionResult = {
  manifestPath: string;
  frames: ScreenshotResult[];
  frameCount: number;
  stopReason: CaptureScrollRegionStopReason;
  preflight: {
    boundaryRestore: ScrollBoundaryRestoreResult;
  };
  calibration: ScrollCalibrationResult;
  overlaps: ScrollFrameOverlap[];
  region: Region;
  scroll: {
    direction: ScrollDirection;
    inputMethod: ScrollInputMethod;
    scrollStep: number;
    delta: number;
    maxFrames: number;
    delayMs: number;
    unchangedFrameLimit: number;
    minOverlapRatio: number;
    maxOverlapRatio: number;
    restoreToBoundary: boolean;
    restoreScrollStep: number;
    restoreMaxAttempts: number;
    restoreUnchangedFrameLimit: number;
    outputStitched: boolean;
  };
  stitchedPath?: string;
};

export type WeChatChatRecordsCaptureParams = {
  chatName: string;
  outputDir?: string;
  maxFrames?: number;
  ocrChunkHeight?: number;
  ocrChunkOverlap?: number;
};

export type WeChatChatRecordsDefaults = CaptureScrollRegionDefaults & {
  wechatRecordsOutputDir: string;
  ocrChunkHeight: number;
  ocrChunkOverlap: number;
};

export type WeChatChatRecordsCaptureResult = {
  manifestPath: string;
  outputDir: string;
  chatName: string;
  mainWindow: WindowHandleInfo;
  recordsWindow: WindowHandleInfo;
  recordsRegion: Region;
  preflight: {
    wechatTopmostScreenshot: string;
    recordsWindowTopmostScreenshot: string;
  };
  menuFallbackUsed: boolean;
  chatOpen: WeChatChatOpenResult;
  scrollCapture: CaptureScrollRegionResult;
  stitchedPath?: string;
  ocrChunks: OcrChunk[];
  diagnostics?: {
    mainWindowSelection?: WindowSelectionDiagnostics;
    recordsWindowSelection?: WindowSelectionDiagnostics;
  };
};

type PowerShellRunner = (
  script: string,
  signal?: AbortSignal,
  singleThreadedApartment?: boolean,
) => Promise<{ stdout: string; stderr: string }>;

export async function captureScreenshot(region?: Region, signal?: AbortSignal): Promise<ScreenshotResult> {
  const dir = await mkdtemp(join(tmpdir(), "pi-mimo-screen-"));
  return captureScreenshotToPath(join(dir, "screen.png"), region, signal);
}

export async function captureScreenshotToPath(
  path: string,
  region?: Region,
  signal?: AbortSignal,
): Promise<ScreenshotResult> {
  await mkdir(dirname(path), { recursive: true });
  const script = `
${dpiAwarenessPrelude()}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"
$outPath = ${psString(path)}
$outDir = Split-Path -Parent $outPath
if ($outDir) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}
$virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen
$hasRegion = ${region ? "$true" : "$false"}
if ($hasRegion) {
  $srcX = $virtual.Left + ${region?.x ?? 0}
  $srcY = $virtual.Top + ${region?.y ?? 0}
  $width = ${region?.width ?? 0}
  $height = ${region?.height ?? 0}
} else {
  $srcX = $virtual.Left
  $srcY = $virtual.Top
  $width = $virtual.Width
  $height = $virtual.Height
}
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($srcX, $srcY, 0, 0, (New-Object System.Drawing.Size $width, $height))
$bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
[PSCustomObject]@{
  path = $outPath
  width = $width
  height = $height
  left = $srcX
  top = $srcY
} | ConvertTo-Json -Compress
`;
  const result = await runPowerShell(script, signal);
  return JSON.parse(result.stdout.trim()) as ScreenshotResult;
}

export async function resolvePointInput(input: PointInput, signal?: AbortSignal): Promise<ResolvedPoint> {
  if (typeof input.nx === "number" || typeof input.ny === "number") {
    if (typeof input.nx !== "number" || typeof input.ny !== "number") {
      throw new Error("Both nx and ny are required when using normalized coordinates.");
    }
    ensureNormalizedNumber(input.nx, "nx");
    ensureNormalizedNumber(input.ny, "ny");

    const screen = await captureScreenshot(undefined, signal);
    return {
      point: {
        x: screen.left + Math.round(input.nx * screen.width),
        y: screen.top + Math.round(input.ny * screen.height),
      },
      coordinateSource: "normalized",
      screen,
    };
  }

  if (typeof input.x !== "number" || typeof input.y !== "number") {
    throw new Error("Provide either x/y pixel coordinates or nx/ny normalized coordinates.");
  }

  ensureFiniteNumber(input.x, "x");
  ensureFiniteNumber(input.y, "y");
  return {
    point: { x: input.x, y: input.y },
    coordinateSource: "pixel",
  };
}

export async function runWindowsPowerShell(script: string, signal?: AbortSignal): Promise<{
  stdout: string;
  stderr: string;
}> {
  return runPowerShell(script, signal);
}

export const WECHAT_APPLICATION_CHECK: NormalizedApplicationCheckInput = {
  appName: "WeChat",
  processNames: ["WeChat", "Weixin"],
  windowTitleIncludes: ["WeChat", "Weixin", "微信"],
};

export function normalizeApplicationCheckInput(input: ApplicationCheckInput): NormalizedApplicationCheckInput {
  const appName = trimOptional(input.appName);
  const processNames = uniqueTrimmed([
    ...(input.processNames ?? []),
    ...(appName ? [appName] : []),
  ]);
  const windowTitleIncludes = uniqueTrimmed([
    ...(input.windowTitleIncludes ?? []),
    ...(appName ? [appName] : []),
  ]);

  if (processNames.length === 0 && windowTitleIncludes.length === 0) {
    throw new Error("Provide appName, processNames, or windowTitleIncludes to check an application.");
  }

  return { appName, processNames, windowTitleIncludes };
}

export function parseApplicationCheckResult(stdout: string): ApplicationCheckResult {
  const raw = JSON.parse(stdout.trim()) as {
    isOpen?: unknown;
    matchedProcesses?: unknown;
    matchedWindows?: unknown;
  };
  const matchedProcesses = asArray(raw.matchedProcesses).map(normalizeApplicationMatch);
  const matchedWindows = asArray(raw.matchedWindows).map(normalizeApplicationMatch);
  return {
    isOpen: Boolean(raw.isOpen) || matchedProcesses.length > 0 || matchedWindows.length > 0,
    matchedProcesses,
    matchedWindows,
  };
}

export function buildApplicationCheckScript(input: NormalizedApplicationCheckInput): string {
  return `
$ErrorActionPreference = "Stop"
$processNames = ${psArray(input.processNames)}
$titleIncludes = ${psArray(input.windowTitleIncludes)}
$allProcesses = @(Get-Process | ForEach-Object {
  $path = $null
  try { $path = $_.Path } catch { $path = $null }
  [PSCustomObject]@{
    id = $_.Id
    processName = $_.ProcessName
    windowTitle = $_.MainWindowTitle
    path = $path
  }
})
$matchedProcesses = @()
$matchedWindows = @()
foreach ($process in $allProcesses) {
  $processName = [string]$process.processName
  foreach ($candidate in $processNames) {
    $normalizedCandidate = [System.IO.Path]::GetFileNameWithoutExtension([string]$candidate)
    if ($processName.Equals($normalizedCandidate, [System.StringComparison]::OrdinalIgnoreCase)) {
      $matchedProcesses += $process
      break
    }
  }
  $title = [string]$process.windowTitle
  if (-not [string]::IsNullOrWhiteSpace($title)) {
    foreach ($needle in $titleIncludes) {
      if ($title.IndexOf([string]$needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $matchedWindows += $process
        break
      }
    }
  }
}
[PSCustomObject]@{
  isOpen = (($matchedProcesses.Count -gt 0) -or ($matchedWindows.Count -gt 0))
  matchedProcesses = @($matchedProcesses)
  matchedWindows = @($matchedWindows)
} | ConvertTo-Json -Compress -Depth 4
`;
}

export async function checkApplicationOpen(
  input: ApplicationCheckInput,
  signal?: AbortSignal,
  runner: PowerShellRunner = runPowerShell,
): Promise<ApplicationCheckResult> {
  const normalized = normalizeApplicationCheckInput(input);
  const result = await runner(buildApplicationCheckScript(normalized), signal);
  return parseApplicationCheckResult(result.stdout);
}

export async function startWeChat(
  signal?: AbortSignal,
  runner: PowerShellRunner = runPowerShell,
): Promise<StartWeChatResult> {
  const check = await checkApplicationOpen(WECHAT_APPLICATION_CHECK, signal, runner);
  if (check.isOpen) {
    return { started: false, isOpen: true, check, stdout: "", stderr: "" };
  }

  const script = `
$ErrorActionPreference = "Stop"
$candidates = @(
  "D:\\Program Files\\Tencent\\Weixin\\Weixin.exe",
  "D:\\Program Files\\Tencent\\WeChat\\WeChat.exe",
  "C:\\Program Files\\Tencent\\Weixin\\Weixin.exe",
  "C:\\Program Files\\Tencent\\WeChat\\WeChat.exe",
  "C:\\Program Files (x86)\\Tencent\\Weixin\\Weixin.exe",
  "C:\\Program Files (x86)\\Tencent\\WeChat\\WeChat.exe"
)
$target = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $target) { throw "WeChat/Weixin executable was not found in known install locations." }
Start-Process -FilePath $target
Start-Sleep -Milliseconds 1200
[PSCustomObject]@{ path = $target } | ConvertTo-Json -Compress
`;
  const result = await runner(script, signal);
  const parsed = JSON.parse(result.stdout.trim()) as { path: string };
  return {
    started: true,
    isOpen: true,
    path: parsed.path,
    check,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function buildEnumerateWindowsScript(): string {
  return `
${dpiAwarenessPrelude()}
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PiWindowEnum {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
public struct RECT {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
"@
$windows = New-Object System.Collections.Generic.List[object]
$callback = [PiWindowEnum+EnumWindowsProc]{
  param([IntPtr]$hwnd, [IntPtr]$lParam)
  if (-not [PiWindowEnum]::IsWindowVisible($hwnd)) { return $true }
  $rect = New-Object RECT
  if (-not [PiWindowEnum]::GetWindowRect($hwnd, [ref]$rect)) { return $true }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 100 -or $height -lt 100) { return $true }
  [uint32]$processId = 0
  [PiWindowEnum]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null
  $processName = $null
  try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch { $processName = $null }
  $length = [PiWindowEnum]::GetWindowTextLengthW($hwnd)
  $titleBuilder = New-Object System.Text.StringBuilder ([Math]::Max($length + 1, 256))
  [PiWindowEnum]::GetWindowTextW($hwnd, $titleBuilder, $titleBuilder.Capacity) | Out-Null
  $title = $titleBuilder.ToString()
  $isWeChatProcess = ($processName -match '^(WeChat|Weixin)$')
  if ([string]::IsNullOrWhiteSpace($title) -and -not $isWeChatProcess) { return $true }
  $classBuilder = New-Object System.Text.StringBuilder 256
  [PiWindowEnum]::GetClassNameW($hwnd, $classBuilder, $classBuilder.Capacity) | Out-Null
  $windows.Add([PSCustomObject]@{
    hwnd = $hwnd.ToInt64()
    title = $title
    className = $classBuilder.ToString()
    processId = [int]$processId
    processName = $processName
    rect = [PSCustomObject]@{
      left = $rect.Left
      top = $rect.Top
      right = $rect.Right
      bottom = $rect.Bottom
      width = $width
      height = $height
    }
  }) | Out-Null
  return $true
}
[PiWindowEnum]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
[PSCustomObject]@{ windows = $windows.ToArray() } | ConvertTo-Json -Compress -Depth 5
`;
}

export function parseWindowEnumerationResult(stdout: string): WindowHandleInfo[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  const windows =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) && "windows" in parsed
      ? (parsed as { windows?: unknown }).windows
      : parsed;
  return asArray(windows).map((value) => normalizeWindowHandleInfo(value));
}

export async function enumerateWindows(
  signal?: AbortSignal,
  runner: PowerShellRunner = runPowerShell,
): Promise<WindowHandleInfo[]> {
  const result = await runner(buildEnumerateWindowsScript(), signal);
  return parseWindowEnumerationResult(result.stdout);
}

export function analyzeWeChatMainWindow(windows: WindowHandleInfo[]): WindowSelectionDiagnostics {
  const candidates = windows
    .map(scoreWeChatMainWindow)
    .filter((candidate): candidate is WindowCandidateDiagnostic => Boolean(candidate))
    .sort((a, b) => b.score - a.score || windowArea(b.window) - windowArea(a.window));
  return {
    selected: candidates.find((candidate) => candidate.score >= 50)?.window,
    scannedCount: windows.length,
    candidates,
  };
}

export function selectWeChatMainWindow(windows: WindowHandleInfo[]): WindowHandleInfo | undefined {
  return analyzeWeChatMainWindow(windows).selected;
}

export async function inspectWeChatMainWindow(
  signal?: AbortSignal,
  runner: PowerShellRunner = runPowerShell,
): Promise<WindowSelectionDiagnostics> {
  return analyzeWeChatMainWindow(await enumerateWindows(signal, runner));
}

export async function findWeChatMainWindow(
  signal?: AbortSignal,
  runner: PowerShellRunner = runPowerShell,
): Promise<WindowHandleInfo | undefined> {
  return (await inspectWeChatMainWindow(signal, runner)).selected;
}

export function selectChatRecordsWindow(
  windows: WindowHandleInfo[],
  chatName: string,
): WindowHandleInfo | undefined {
  return analyzeChatRecordsWindow(windows, chatName).selected;
}

export function analyzeChatRecordsWindow(
  windows: WindowHandleInfo[],
  chatName: string,
): WindowSelectionDiagnostics {
  const normalizedChatName = chatName.trim().toLowerCase();
  const candidates = windows
    .map((window) => scoreChatRecordsWindow(window, normalizedChatName))
    .filter((candidate): candidate is WindowCandidateDiagnostic => Boolean(candidate))
    .sort((a, b) => b.score - a.score || windowArea(b.window) - windowArea(a.window));
  return {
    selected: candidates.find((candidate) => candidate.score >= 50)?.window,
    scannedCount: windows.length,
    candidates,
  };
}

export async function inspectChatRecordsWindow(
  chatName: string,
  signal?: AbortSignal,
  runner: PowerShellRunner = runPowerShell,
): Promise<WindowSelectionDiagnostics> {
  return analyzeChatRecordsWindow(await enumerateWindows(signal, runner), chatName);
}

export async function findChatRecordsWindow(
  chatName: string,
  signal?: AbortSignal,
  runner: PowerShellRunner = runPowerShell,
): Promise<WindowHandleInfo | undefined> {
  return (await inspectChatRecordsWindow(chatName, signal, runner)).selected;
}

function scoreWeChatMainWindow(window: WindowHandleInfo): WindowCandidateDiagnostic | undefined {
  const processName = normalizedProcessName(window);
  const title = window.title.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  const isMainProcess = isWeChatMainProcess(processName);

  if (isMainProcess) {
    score += 100;
    reasons.push(`process:${window.processName}`);
  } else if (hasWeChatTitle(title)) {
    score += 10;
    reasons.push("diagnostic:title-wechat");
    return { window, score, reasons };
  } else {
    return undefined;
  }

  if (hasWeChatTitle(title)) {
    score += 20;
    reasons.push("title:main");
  }
  if (hasChatRecordsTitle(title)) {
    score -= 120;
    reasons.push("penalty:chat-records-title");
  }
  if (window.className?.toLowerCase().includes("qt")) {
    score += 8;
    reasons.push("class:qt");
  }
  const area = windowArea(window);
  if (area >= 250_000) {
    score += 20;
    reasons.push("size:window");
  }
  if (area >= 800_000) {
    score += 20;
    reasons.push("size:large");
  }
  if (window.rect.width >= 500 && window.rect.height >= 500) {
    score += 10;
    reasons.push("size:usable");
  }

  return score >= 50 ? { window, score, reasons } : undefined;
}

function scoreChatRecordsWindow(window: WindowHandleInfo, normalizedChatName: string): WindowCandidateDiagnostic | undefined {
  const processName = normalizedProcessName(window);
  const title = window.title.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  const isMainProcess = isWeChatMainProcess(processName);

  if (isMainProcess) {
    score += 60;
    reasons.push(`process:${window.processName}`);
  } else if (hasWeChatTitle(title)) {
    score += 10;
    reasons.push("diagnostic:title-wechat");
    return { window, score, reasons };
  } else {
    return undefined;
  }

  if (hasChatRecordsTitle(title)) {
    score += 90;
    reasons.push("title:chat-records");
  }
  if (normalizedChatName && title.includes(normalizedChatName)) {
    score += 45;
    reasons.push("title:chat-name");
  }
  if (hasWeChatTitle(title) && !hasChatRecordsTitle(title)) {
    score -= 45;
    reasons.push("penalty:main-title");
  }
  const area = windowArea(window);
  if (area >= 250_000 && area <= 1_200_000) {
    score += 25;
    reasons.push("size:popup");
  }
  if (area > 1_500_000) {
    score -= 60;
    reasons.push("penalty:large-main-like");
  }
  if (window.className?.toLowerCase().includes("qt")) {
    score += 5;
    reasons.push("class:qt");
  }

  return score >= 50 ? { window, score, reasons } : undefined;
}

function normalizedProcessName(window: WindowHandleInfo): string {
  return (window.processName ?? "").trim().toLowerCase();
}

function isWeChatMainProcess(processName: string): boolean {
  return processName === "wechat" || processName === "weixin";
}

function hasWeChatTitle(title: string): boolean {
  return title.includes("wechat") || title.includes("weixin") || title.includes("微信");
}

function hasChatRecordsTitle(title: string): boolean {
  return title.includes("聊天记录") || title.includes("chat records");
}

function windowArea(window: WindowHandleInfo): number {
  return window.rect.width * window.rect.height;
}

export function buildSetWindowTopmostScript(hwnd: number, enabled: boolean): string {
  ensurePositiveInteger(Math.round(hwnd), "hwnd");
  return `
${dpiAwarenessPrelude()}
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PiWindowTopmost {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
$hwnd = [IntPtr]${Math.round(hwnd)}
$insertAfter = [IntPtr]${enabled ? "-1" : "-2"}
$flags = 0x0001 -bor 0x0002 -bor 0x0040
if (-not [PiWindowTopmost]::SetWindowPos($hwnd, $insertAfter, 0, 0, 0, 0, $flags)) {
  throw "SetWindowPos failed for hwnd=${Math.round(hwnd)}"
}
[PSCustomObject]@{ hwnd = ${Math.round(hwnd)}; enabled = ${enabled ? "$true" : "$false"} } | ConvertTo-Json -Compress
`;
}

export async function setWindowTopmost(
  hwnd: number,
  enabled: boolean,
  signal?: AbortSignal,
  runner: PowerShellRunner = runPowerShell,
): Promise<WindowTopmostResult> {
  const result = await runner(buildSetWindowTopmostScript(hwnd, enabled), signal);
  const parsed = JSON.parse(result.stdout.trim()) as { hwnd?: unknown; enabled?: unknown };
  return { hwnd: Number(parsed.hwnd ?? hwnd), enabled: Boolean(parsed.enabled) };
}

export function buildActivateWindowScript(hwnd: number): string {
  ensurePositiveInteger(Math.round(hwnd), "hwnd");
  return `
${dpiAwarenessPrelude()}
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PiWindowActivate {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$hwnd = [IntPtr]${Math.round(hwnd)}
[PiWindowActivate]::ShowWindow($hwnd, 9) | Out-Null
Start-Sleep -Milliseconds 120
[PiWindowActivate]::SetForegroundWindow($hwnd) | Out-Null
`;
}

export async function activateWindow(
  hwnd: number,
  signal?: AbortSignal,
  runner: PowerShellRunner = runPowerShell,
): Promise<void> {
  await runner(buildActivateWindowScript(hwnd), signal);
}

export async function removeFileIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Temp screenshot cleanup is best-effort.
  }
  try {
    await rmdir(dirname(path));
  } catch {
    // Leave non-empty directories alone.
  }
}

export async function confirmSensitiveAction(
  ctx: ExtensionContext | undefined,
  env: MimoEnv,
  title: string,
  message: string,
): Promise<boolean> {
  if (!env.requireConfirm) return true;
  if (!ctx?.ui?.confirm) return false;
  return ctx.ui.confirm(title, message);
}

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

export async function moveMouse(point: Point, durationMs = 0, signal?: AbortSignal): Promise<void> {
  ensureFiniteNumber(point.x, "x");
  ensureFiniteNumber(point.y, "y");
  await runPowerShell(mousePrelude() + `
Move-Cursor -X ${Math.round(point.x)} -Y ${Math.round(point.y)} -DurationMs ${Math.max(250, Math.round(durationMs))}
`, signal);
}

export async function click(point: Point, button: "left" | "right" = "left", signal?: AbortSignal): Promise<void> {
  const flags =
    button === "right"
      ? { down: "0x0008", up: "0x0010" }
      : { down: "0x0002", up: "0x0004" };

  await runPowerShell(mousePrelude() + `
Move-Cursor -X ${Math.round(point.x)} -Y ${Math.round(point.y)} -DurationMs 0
[NativeMethods]::mouse_event(${flags.down}, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120
[NativeMethods]::mouse_event(${flags.up}, 0, 0, 0, [UIntPtr]::Zero)
`, signal);
}

export async function doubleClick(point: Point, signal?: AbortSignal): Promise<void> {
  await runPowerShell(mousePrelude() + `
Move-Cursor -X ${Math.round(point.x)} -Y ${Math.round(point.y)} -DurationMs 0
for ($i = 0; $i -lt 2; $i++) {
  [NativeMethods]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120
  [NativeMethods]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 180
}
`, signal);
}

export async function drag(from: Point, to: Point, durationMs = 300, signal?: AbortSignal): Promise<void> {
  await runPowerShell(mousePrelude() + `
Move-Cursor -X ${Math.round(from.x)} -Y ${Math.round(from.y)} -DurationMs 0
[NativeMethods]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 150
Move-Cursor -X ${Math.round(to.x)} -Y ${Math.round(to.y)} -DurationMs ${Math.max(450, Math.round(durationMs))}
Start-Sleep -Milliseconds 150
[NativeMethods]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`, signal);
}

export async function scroll(delta: number, signal?: AbortSignal): Promise<void> {
  ensureFiniteNumber(delta, "delta");
  await runPowerShell(mousePrelude() + `
[NativeMethods]::mouse_event(0x0800, 0, 0, ${Math.round(delta * 120)}, [UIntPtr]::Zero)
`, signal);
}

export async function scrollMany(deltas: number[], signal?: AbortSignal): Promise<void> {
  if (deltas.length === 0) return;
  const wheelDeltas = deltas.map((delta, index) => {
    ensureFiniteNumber(delta, `deltas[${index}]`);
    return Math.round(delta * 120);
  });
  await runPowerShell(mousePrelude() + `
$wheelDeltas = @(${wheelDeltas.join(", ")})
foreach ($wheelDelta in $wheelDeltas) {
  [NativeMethods]::mouse_event(0x0800, 0, 0, $wheelDelta, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 8
}
`, signal);
}

export async function scrollAtTarget(
  params: ScrollActionParams,
  defaults: ScrollActionDefaults,
  signal?: AbortSignal,
  deps: {
    captureScreenshot?: typeof captureScreenshot;
    removeFileIfExists?: typeof removeFileIfExists;
    resolvePointInput?: typeof resolvePointInput;
    moveMouse?: typeof moveMouse;
    scroll?: typeof scroll;
    sleep?: typeof sleep;
  } = {},
): Promise<ScrollActionResult> {
  ensureFiniteNumber(params.delta, "delta");
  const repeat = params.repeat ?? defaults.repeat;
  const delayMs = params.delayMs ?? defaults.delayMs;
  ensurePositiveInteger(repeat, "repeat");
  ensureNonNegativeInteger(delayMs, "delayMs");

  const target = await resolveScrollTarget(params, signal, deps);
  if (target) {
    await (deps.moveMouse ?? moveMouse)(target.point, 0, signal);
  }

  for (let index = 0; index < repeat; index++) {
    await (deps.scroll ?? scroll)(params.delta, signal);
    if (index < repeat - 1 && delayMs > 0) {
      await (deps.sleep ?? sleep)(delayMs);
    }
  }

  return {
    delta: params.delta,
    repeat,
    delayMs,
    target,
  };
}

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
    sleep?: typeof sleep;
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
          sleep: deps.sleep ?? sleep,
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
      await (deps.sleep ?? sleep)(delayMs);
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
        sleep: deps.sleep ?? sleep,
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
    sleep?: typeof sleep;
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
    await (deps.sleep ?? sleep)(500);

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
    await (deps.sleep ?? sleep)(250);

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
    await (deps.sleep ?? sleep)(250);

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
    sleep?: typeof sleep;
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
    sleep?: typeof sleep;
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
  const sleepFn = deps.sleep ?? sleep;

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
    sleep?: typeof sleep;
  },
): Promise<WeChatChatOpenResult> {
  const doClick = deps.click ?? click;
  await doClick(relativePoint(mainWindow, 0.12, 0.045, { minX: 80, maxX: 180, minY: 45, maxY: 75 }), "left", signal);
  await (deps.sleep ?? sleep)(150);
  await (deps.hotkey ?? hotkey)(["control", "a"], signal);
  await (deps.typeText ?? typeText)(chatName, signal);
  await (deps.sleep ?? sleep)(900);
  await doClick(relativePoint(mainWindow, 0.13, 0.095, { minX: 105, maxX: 230, minY: 105, maxY: 155 }), "left", signal);
  await (deps.sleep ?? sleep)(1000);
  return { method: "search-fallback", searchFallbackUsed: true, attempts: [] };
}

async function openChatRecordsFromMenu(
  mainWindow: WindowHandleInfo,
  chatName: string,
  signal: AbortSignal | undefined,
  deps: {
    click?: typeof click;
    pressKey?: typeof pressKey;
    sleep?: typeof sleep;
    findChatRecordsWindow?: typeof findChatRecordsWindow;
  },
): Promise<boolean> {
  const doClick = deps.click ?? click;
  const sleepFn = deps.sleep ?? sleep;
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
    sleep?: typeof sleep;
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
    await (deps.sleep ?? sleep)(500);
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
    sleep: typeof sleep;
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

export async function hashFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
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
    sleep: typeof sleep;
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
      await sleep(80);
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

type DecodedPng = {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Uint8Array;
};

function decodePng(bytes: Buffer): DecodedPng {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error("Scroll calibration frames must be PNG files.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error("Invalid PNG chunk length.");
    }
    const chunk = bytes.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      const interlace = chunk[12];
      if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error("Only non-interlaced 8-bit RGB/RGBA PNG screenshots are supported.");
      }
    } else if (type === "IDAT") {
      idatChunks.push(chunk);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const output = new Uint8Array(height * stride);
  let inputOffset = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[inputOffset++];
    const rowStart = y * stride;
    const previousRowStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const raw = inflated[inputOffset++];
      const left = x >= channels ? output[rowStart + x - channels] : 0;
      const up = y > 0 ? output[previousRowStart + x] : 0;
      const upLeft = y > 0 && x >= channels ? output[previousRowStart + x - channels] : 0;
      output[rowStart + x] = unfilterPngByte(filter, raw, left, up, upLeft);
    }
  }

  return { width, height, channels, data: output };
}

function unfilterPngByte(filter: number, raw: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return raw;
    case 1:
      return (raw + left) & 0xff;
    case 2:
      return (raw + up) & 0xff;
    case 3:
      return (raw + Math.floor((left + up) / 2)) & 0xff;
    case 4:
      return (raw + paethPredictor(left, up, upLeft)) & 0xff;
    default:
      throw new Error(`Unsupported PNG filter: ${filter}`);
  }
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function pixelOffset(image: DecodedPng, x: number, y: number): number {
  return (y * image.width + x) * image.channels;
}

export async function typeText(text: string, signal?: AbortSignal): Promise<void> {
  await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference = "Stop"
$text = ${psString(text)}
$hadText = [System.Windows.Forms.Clipboard]::ContainsText()
$oldText = if ($hadText) { [System.Windows.Forms.Clipboard]::GetText() } else { $null }
[System.Windows.Forms.Clipboard]::SetText($text)
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 300
if ($hadText) {
  [System.Windows.Forms.Clipboard]::SetText($oldText)
}
`, signal, true);
}

export async function pressKey(key: string, signal?: AbortSignal): Promise<void> {
  await sendKeys(toSendKey(key), signal);
}

export async function hotkey(keys: string[], signal?: AbortSignal): Promise<void> {
  if (keys.length < 2) {
    throw new Error("hotkey requires at least two keys.");
  }

  const modifiers = keys.slice(0, -1).map((key) => key.toLowerCase());
  const finalKey = keys[keys.length - 1];
  let prefix = "";

  for (const modifier of modifiers) {
    if (modifier === "ctrl" || modifier === "control") prefix += "^";
    else if (modifier === "alt") prefix += "%";
    else if (modifier === "shift") prefix += "+";
    else if (modifier === "win" || modifier === "windows") throw new Error("Windows-key hotkeys are not supported.");
    else throw new Error(`Unsupported hotkey modifier: ${modifier}`);
  }

  await sendKeys(prefix + toSendKey(finalKey), signal);
}

export async function wait(milliseconds: number): Promise<void> {
  await sleep(milliseconds);
}

async function sleep(milliseconds: number): Promise<void> {
  ensureNonNegativeInteger(milliseconds, "milliseconds");
  if (milliseconds === 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function resolveScrollTarget(
  params: ScrollActionParams,
  signal?: AbortSignal,
  deps: {
    captureScreenshot?: typeof captureScreenshot;
    removeFileIfExists?: typeof removeFileIfExists;
    resolvePointInput?: typeof resolvePointInput;
  } = {},
): Promise<ScrollActionResult["target"] | undefined> {
  const hasRegion = params.region !== undefined;
  const hasPoint = hasPointInput(params);
  if (hasRegion && hasPoint) {
    throw new Error("Provide either region or x/y/nx/ny for scroll targeting, not both.");
  }

  if (hasRegion) {
    const region = normalizeRegion(params.region as Region);
    const screenshot = await (deps.captureScreenshot ?? captureScreenshot)(region, signal);
    try {
      return {
        point: centerPointForScreenshot(screenshot),
        coordinateSource: "region-center",
      };
    } finally {
      await (deps.removeFileIfExists ?? removeFileIfExists)(screenshot.path);
    }
  }

  if (hasPoint) {
    const resolved = await (deps.resolvePointInput ?? resolvePointInput)(params, signal);
    return {
      point: resolved.point,
      coordinateSource: resolved.coordinateSource,
    };
  }

  return undefined;
}

function hasPointInput(input: PointInput): boolean {
  return (
    typeof input.x === "number" ||
    typeof input.y === "number" ||
    typeof input.nx === "number" ||
    typeof input.ny === "number"
  );
}

function sendKeys(sequence: string, signal?: AbortSignal): Promise<void> {
  return runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference = "Stop"
[System.Windows.Forms.SendKeys]::SendWait(${psString(sequence)})
`, signal, true).then(() => undefined);
}

function toSendKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  const map: Record<string, string> = {
    enter: "{ENTER}",
    return: "{ENTER}",
    tab: "{TAB}",
    escape: "{ESC}",
    esc: "{ESC}",
    backspace: "{BACKSPACE}",
    delete: "{DELETE}",
    del: "{DELETE}",
    insert: "{INSERT}",
    home: "{HOME}",
    end: "{END}",
    pageup: "{PGUP}",
    pagedown: "{PGDN}",
    up: "{UP}",
    down: "{DOWN}",
    left: "{LEFT}",
    right: "{RIGHT}",
    space: " ",
    f1: "{F1}",
    f2: "{F2}",
    f3: "{F3}",
    f4: "{F4}",
    f5: "{F5}",
    f6: "{F6}",
    f7: "{F7}",
    f8: "{F8}",
    f9: "{F9}",
    f10: "{F10}",
    f11: "{F11}",
    f12: "{F12}",
  };
  if (map[normalized]) return map[normalized];
  if (key.length === 1) return escapeSendKeysLiteral(key);
  throw new Error(`Unsupported key: ${key}`);
}

function escapeSendKeysLiteral(value: string): string {
  return value.replace(/[+^%~(){}\[\]]/g, (char) => `{${char}}`);
}

async function runPowerShell(
  script: string,
  signal?: AbortSignal,
  singleThreadedApartment = false,
): Promise<{ stdout: string; stderr: string }> {
  const { spawn } = await import("node:child_process");
  const encodedScript = `
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
${script}
`;
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    ...(singleThreadedApartment ? ["-Sta"] : []),
    "-Command",
    encodedScript,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", args, { windowsHide: true });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = decodePowerShellOutput(stdoutChunks);
      const stderr = decodePowerShellOutput(stderrChunks);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`PowerShell exited with code ${code}: ${stderr || stdout}`));
      }
    });

    signal?.addEventListener(
      "abort",
      () => {
        child.kill();
        reject(new Error("Operation cancelled."));
      },
      { once: true },
    );
  });
}

function decodePowerShellOutput(chunks: Buffer[]): string {
  const bytes = Buffer.concat(chunks);
  const utf8 = bytes.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    const decoded = new TextDecoder("gb18030").decode(bytes);
    return replacementCharacterCount(decoded) < replacementCharacterCount(utf8) ? decoded : utf8;
  } catch {
    return utf8;
  }
}

function replacementCharacterCount(value: string): number {
  return [...value].filter((char) => char === "\uFFFD").length;
}

function mousePrelude(): string {
  return `
${dpiAwarenessPrelude()}
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeMethods {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
}
public struct POINT {
  public int X;
  public int Y;
}
"@
function Move-Cursor {
  param([int]$X, [int]$Y, [int]$DurationMs)
  if ($DurationMs -le 0) {
    [NativeMethods]::SetCursorPos($X, $Y) | Out-Null
    return
  }
  $point = New-Object POINT
  [NativeMethods]::GetCursorPos([ref]$point) | Out-Null
  $steps = [Math]::Max(1, [Math]::Min(60, [Math]::Ceiling($DurationMs / 16)))
  for ($i = 1; $i -le $steps; $i++) {
    $nextX = [int]($point.X + (($X - $point.X) * $i / $steps))
    $nextY = [int]($point.Y + (($Y - $point.Y) * $i / $steps))
    [NativeMethods]::SetCursorPos($nextX, $nextY) | Out-Null
    Start-Sleep -Milliseconds ([Math]::Max(1, [Math]::Floor($DurationMs / $steps)))
  }
}
`;
}

function dpiAwarenessPrelude(): string {
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PiDpiAwareness {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
"@
[PiDpiAwareness]::SetProcessDPIAware() | Out-Null
`;
}

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function psArray(values: string[]): string {
  if (values.length === 0) return "@()";
  return `@(${values.map(psString).join(", ")})`;
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeApplicationMatch(value: unknown): ApplicationProcessMatch {
  const item = value as {
    id?: unknown;
    processName?: unknown;
    windowTitle?: unknown;
    path?: unknown;
  };
  return {
    id: typeof item.id === "number" ? item.id : Number(item.id ?? 0),
    processName: String(item.processName ?? ""),
    windowTitle: typeof item.windowTitle === "string" && item.windowTitle ? item.windowTitle : undefined,
    path: typeof item.path === "string" && item.path ? item.path : undefined,
  };
}

function normalizeWindowHandleInfo(value: unknown): WindowHandleInfo {
  const item = value as {
    hwnd?: unknown;
    title?: unknown;
    className?: unknown;
    processId?: unknown;
    processName?: unknown;
    rect?: {
      left?: unknown;
      top?: unknown;
      right?: unknown;
      bottom?: unknown;
      width?: unknown;
      height?: unknown;
    };
  };
  const rect = item.rect ?? {};
  const left = Number(rect.left ?? 0);
  const top = Number(rect.top ?? 0);
  const right = Number(rect.right ?? left + Number(rect.width ?? 0));
  const bottom = Number(rect.bottom ?? top + Number(rect.height ?? 0));
  return {
    hwnd: Number(item.hwnd ?? 0),
    title: String(item.title ?? ""),
    className: typeof item.className === "string" && item.className ? item.className : undefined,
    processId: item.processId === undefined ? undefined : Number(item.processId),
    processName: typeof item.processName === "string" && item.processName ? item.processName : undefined,
    rect: {
      left,
      top,
      right,
      bottom,
      width: Number(rect.width ?? right - left),
      height: Number(rect.height ?? bottom - top),
    },
  };
}
