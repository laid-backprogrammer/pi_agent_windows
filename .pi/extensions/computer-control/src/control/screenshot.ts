import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { dpiAwarenessPrelude, psString, runPowerShell } from "./powershell.js";
import type { Region, ScreenshotResult } from "./types.js";

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
