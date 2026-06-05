import { mkdtemp, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

export async function captureScreenshot(region?: Region, signal?: AbortSignal): Promise<ScreenshotResult> {
  const dir = await mkdtemp(join(tmpdir(), "pi-mimo-screen-"));
  return captureScreenshotToPath(join(dir, "screen.png"), region, signal);
}

async function captureScreenshotToPath(
  path: string,
  region?: Region,
  signal?: AbortSignal,
): Promise<ScreenshotResult> {
  const script = `
${dpiAwarenessPrelude()}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"
$outPath = ${psString(path)}
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

export async function startWeChat(signal?: AbortSignal): Promise<{ path: string; stdout: string; stderr: string }> {
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
  const result = await runPowerShell(script, signal);
  const parsed = JSON.parse(result.stdout.trim()) as { path: string };
  return { path: parsed.path, stdout: result.stdout, stderr: result.stderr };
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
  ensurePositiveInteger(milliseconds, "milliseconds");
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    ...(singleThreadedApartment ? ["-Sta"] : []),
    "-Command",
    script,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
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
