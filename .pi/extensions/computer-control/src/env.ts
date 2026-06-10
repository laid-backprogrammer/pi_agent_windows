import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type MimoEnv = {
  apiKey: string;
  chatCompletionsUrl: string;
  providerBaseUrl: string;
  textModel: string;
  visionModel: string;
  requireConfirm: boolean;
  actionDelayMs: number;
  scrollStep: number;
  scrollRepeat: number;
  scrollDelayMs: number;
  scrollOverlapRatio: number;
  scrollMinOverlapRatio: number;
  scrollCalibrationStep: number;
  scrollOutputStitched: boolean;
  longCaptureMaxFrames: number;
  longCaptureUnchangedFrames: number;
  longCaptureOutputDir: string;
  wechatRecordsOcrChunkHeight: number;
  wechatRecordsOcrChunkOverlap: number;
};

export function loadDotEnv(cwd: string): void {
  const envPath = resolve(cwd, ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function readMimoEnv(): MimoEnv {
  const apiKey = process.env.XIAOMI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing XIAOMI_API_KEY. Add it to .env or the process environment.");
  }

  const configuredBaseUrl =
    process.env.XIAOMI_BASE_URL ?? "https://api.xiaomimimo.com/v1/chat/completions";
  const chatCompletionsUrl = normalizeChatCompletionsUrl(configuredBaseUrl);
  const providerBaseUrl = toProviderBaseUrl(chatCompletionsUrl);

  return {
    apiKey,
    chatCompletionsUrl,
    providerBaseUrl,
    textModel: process.env.MIMO_TEXT_MODEL ?? "mimo-v2.5",
    visionModel: process.env.MIMO_VISION_MODEL ?? "mimo-v2.5",
    requireConfirm: parseBoolean(process.env.PI_CONTROL_REQUIRE_CONFIRM, false),
    actionDelayMs: parseInteger(process.env.PI_CONTROL_ACTION_DELAY_MS, 700),
    scrollStep: parsePositiveInteger(process.env.PI_CONTROL_SCROLL_STEP, 6),
    scrollRepeat: parsePositiveInteger(process.env.PI_CONTROL_SCROLL_REPEAT, 1),
    scrollDelayMs: parseInteger(process.env.PI_CONTROL_SCROLL_DELAY_MS, 120),
    scrollOverlapRatio: parseRatio(process.env.PI_CONTROL_SCROLL_OVERLAP_RATIO, 0.1),
    scrollMinOverlapRatio: parseRatio(process.env.PI_CONTROL_SCROLL_MIN_OVERLAP_RATIO, 0.01),
    scrollCalibrationStep: parsePositiveInteger(process.env.PI_CONTROL_SCROLL_CALIBRATION_STEP, 3),
    scrollOutputStitched: parseBoolean(process.env.PI_CONTROL_SCROLL_OUTPUT_STITCHED, false),
    longCaptureMaxFrames: parsePositiveInteger(process.env.PI_CONTROL_LONG_CAPTURE_MAX_FRAMES, 40),
    longCaptureUnchangedFrames: parseInteger(process.env.PI_CONTROL_LONG_CAPTURE_UNCHANGED_FRAMES, 2),
    longCaptureOutputDir: process.env.PI_CONTROL_LONG_CAPTURE_OUTPUT_DIR ?? ".wechat-audit/screenshots",
    wechatRecordsOcrChunkHeight: parsePositiveInteger(process.env.PI_CONTROL_WECHAT_RECORDS_OCR_CHUNK_HEIGHT, 3500),
    wechatRecordsOcrChunkOverlap: parseInteger(process.env.PI_CONTROL_WECHAT_RECORDS_OCR_CHUNK_OVERLAP, 80),
  };
}

export function normalizeChatCompletionsUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return trimmed;
}

export function toProviderBaseUrl(chatCompletionsUrl: string): string {
  return chatCompletionsUrl.replace(/\/chat\/completions$/, "");
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRatio(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : fallback;
}
