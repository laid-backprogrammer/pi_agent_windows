import { removeFileIfExists } from "./files.js";
import { mousePrelude, psString, runPowerShell } from "./powershell.js";
import { captureScreenshot } from "./screenshot.js";
import type { Point, PointInput, Region, ResolvedPoint, ScrollActionDefaults, ScrollActionParams, ScrollActionResult } from "./types.js";
import { centerPointForScreenshot, ensureFiniteNumber, ensureNonNegativeInteger, ensureNormalizedNumber, ensurePositiveInteger, normalizeRegion } from "./validation.js";

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
