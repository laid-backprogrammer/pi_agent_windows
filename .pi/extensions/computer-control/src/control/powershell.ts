export async function runWindowsPowerShell(script: string, signal?: AbortSignal): Promise<{
  stdout: string;
  stderr: string;
}> {
  return runPowerShell(script, signal);
}

export async function runPowerShell(
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

export function mousePrelude(): string {
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

export function dpiAwarenessPrelude(): string {
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

export function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function psArray(values: string[]): string {
  if (values.length === 0) return "@()";
  return `@(${values.map(psString).join(", ")})`;
}
