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
    textModel: process.env.MIMO_TEXT_MODEL ?? "mimo-v2.5-pro",
    visionModel: process.env.MIMO_VISION_MODEL ?? "mimo-v2.5",
    requireConfirm: parseBoolean(process.env.PI_CONTROL_REQUIRE_CONFIRM, true),
    actionDelayMs: parseInteger(process.env.PI_CONTROL_ACTION_DELAY_MS, 700),
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
