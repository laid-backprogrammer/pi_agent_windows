import { dpiAwarenessPrelude, runPowerShell } from "./powershell.js";
import type { PowerShellRunner, WindowCandidateDiagnostic, WindowHandleInfo, WindowSelectionDiagnostics, WindowTopmostResult } from "./types.js";
import { ensurePositiveInteger } from "./validation.js";
import { asArray, normalizeWindowHandleInfo } from "./utils.js";

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
