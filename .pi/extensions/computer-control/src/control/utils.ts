import type { ApplicationProcessMatch, WindowHandleInfo } from "./types.js";

export function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function uniqueTrimmed(values: string[]): string[] {
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

export function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function normalizeApplicationMatch(value: unknown): ApplicationProcessMatch {
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

export function normalizeWindowHandleInfo(value: unknown): WindowHandleInfo {
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
