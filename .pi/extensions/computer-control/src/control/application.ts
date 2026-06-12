import { psArray, runPowerShell } from "./powershell.js";
import type { ApplicationCheckInput, ApplicationCheckResult, NormalizedApplicationCheckInput, PowerShellRunner, StartWeChatResult } from "./types.js";
import { asArray, normalizeApplicationMatch, trimOptional, uniqueTrimmed } from "./utils.js";

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
