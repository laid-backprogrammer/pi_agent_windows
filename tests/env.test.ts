import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeChatCompletionsUrl,
  readMimoEnv,
  toProviderBaseUrl,
} from "../.pi/extensions/computer-control/src/env.ts";

test("normalizes Xiaomi chat completions URL", () => {
  assert.equal(
    normalizeChatCompletionsUrl("https://api.xiaomimimo.com/v1"),
    "https://api.xiaomimimo.com/v1/chat/completions",
  );
  assert.equal(
    normalizeChatCompletionsUrl("https://api.xiaomimimo.com/v1/chat/completions"),
    "https://api.xiaomimimo.com/v1/chat/completions",
  );
});

test("derives provider base URL from chat completions URL", () => {
  assert.equal(
    toProviderBaseUrl("https://api.xiaomimimo.com/v1/chat/completions"),
    "https://api.xiaomimimo.com/v1",
  );
});

test("readMimoEnv throws a clear error without API key", () => {
  const original = process.env.XIAOMI_API_KEY;
  delete process.env.XIAOMI_API_KEY;
  try {
    assert.throws(() => readMimoEnv(), /Missing XIAOMI_API_KEY/);
  } finally {
    if (original !== undefined) process.env.XIAOMI_API_KEY = original;
  }
});

test("readMimoEnv separates text and vision models", () => {
  const original = {
    apiKey: process.env.XIAOMI_API_KEY,
    text: process.env.MIMO_TEXT_MODEL,
    vision: process.env.MIMO_VISION_MODEL,
  };
  process.env.XIAOMI_API_KEY = "sk-test-value";
  process.env.MIMO_TEXT_MODEL = "mimo-v2.5-pro";
  process.env.MIMO_VISION_MODEL = "mimo-v2.5";

  try {
    const env = readMimoEnv();
    assert.equal(env.textModel, "mimo-v2.5-pro");
    assert.equal(env.visionModel, "mimo-v2.5");
  } finally {
    restore("XIAOMI_API_KEY", original.apiKey);
    restore("MIMO_TEXT_MODEL", original.text);
    restore("MIMO_VISION_MODEL", original.vision);
  }
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

