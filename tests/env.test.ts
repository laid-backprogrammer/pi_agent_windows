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
  process.env.MIMO_TEXT_MODEL = "mimo-v2.5";
  process.env.MIMO_VISION_MODEL = "mimo-v2.5";

  try {
    const env = readMimoEnv();
    assert.equal(env.textModel, "mimo-v2.5");
    assert.equal(env.visionModel, "mimo-v2.5");
  } finally {
    restore("XIAOMI_API_KEY", original.apiKey);
    restore("MIMO_TEXT_MODEL", original.text);
    restore("MIMO_VISION_MODEL", original.vision);
  }
});

test("readMimoEnv exposes computer-control scroll defaults", () => {
  const original = {
    apiKey: process.env.XIAOMI_API_KEY,
    scrollStep: process.env.PI_CONTROL_SCROLL_STEP,
    scrollRepeat: process.env.PI_CONTROL_SCROLL_REPEAT,
    scrollDelay: process.env.PI_CONTROL_SCROLL_DELAY_MS,
    overlap: process.env.PI_CONTROL_SCROLL_OVERLAP_RATIO,
    minOverlap: process.env.PI_CONTROL_SCROLL_MIN_OVERLAP_RATIO,
    calibrationStep: process.env.PI_CONTROL_SCROLL_CALIBRATION_STEP,
    outputStitched: process.env.PI_CONTROL_SCROLL_OUTPUT_STITCHED,
    maxFrames: process.env.PI_CONTROL_LONG_CAPTURE_MAX_FRAMES,
    unchanged: process.env.PI_CONTROL_LONG_CAPTURE_UNCHANGED_FRAMES,
    outputDir: process.env.PI_CONTROL_LONG_CAPTURE_OUTPUT_DIR,
    ocrChunkHeight: process.env.PI_CONTROL_WECHAT_RECORDS_OCR_CHUNK_HEIGHT,
    ocrChunkOverlap: process.env.PI_CONTROL_WECHAT_RECORDS_OCR_CHUNK_OVERLAP,
  };
  process.env.XIAOMI_API_KEY = "sk-test-value";
  process.env.PI_CONTROL_SCROLL_STEP = "12";
  process.env.PI_CONTROL_SCROLL_REPEAT = "3";
  process.env.PI_CONTROL_SCROLL_DELAY_MS = "50";
  process.env.PI_CONTROL_SCROLL_OVERLAP_RATIO = "0.1";
  process.env.PI_CONTROL_SCROLL_MIN_OVERLAP_RATIO = "0.01";
  process.env.PI_CONTROL_SCROLL_CALIBRATION_STEP = "4";
  process.env.PI_CONTROL_SCROLL_OUTPUT_STITCHED = "true";
  process.env.PI_CONTROL_LONG_CAPTURE_MAX_FRAMES = "25";
  process.env.PI_CONTROL_LONG_CAPTURE_UNCHANGED_FRAMES = "0";
  process.env.PI_CONTROL_LONG_CAPTURE_OUTPUT_DIR = ".custom-scroll";
  process.env.PI_CONTROL_WECHAT_RECORDS_OCR_CHUNK_HEIGHT = "4200";
  process.env.PI_CONTROL_WECHAT_RECORDS_OCR_CHUNK_OVERLAP = "120";

  try {
    const env = readMimoEnv();
    assert.equal(env.scrollStep, 12);
    assert.equal(env.scrollRepeat, 3);
    assert.equal(env.scrollDelayMs, 50);
    assert.equal(env.scrollOverlapRatio, 0.1);
    assert.equal(env.scrollMinOverlapRatio, 0.01);
    assert.equal(env.scrollCalibrationStep, 4);
    assert.equal(env.scrollOutputStitched, true);
    assert.equal(env.longCaptureMaxFrames, 25);
    assert.equal(env.longCaptureUnchangedFrames, 0);
    assert.equal(env.longCaptureOutputDir, ".custom-scroll");
    assert.equal(env.wechatRecordsOcrChunkHeight, 4200);
    assert.equal(env.wechatRecordsOcrChunkOverlap, 120);
  } finally {
    restore("XIAOMI_API_KEY", original.apiKey);
    restore("PI_CONTROL_SCROLL_STEP", original.scrollStep);
    restore("PI_CONTROL_SCROLL_REPEAT", original.scrollRepeat);
    restore("PI_CONTROL_SCROLL_DELAY_MS", original.scrollDelay);
    restore("PI_CONTROL_SCROLL_OVERLAP_RATIO", original.overlap);
    restore("PI_CONTROL_SCROLL_MIN_OVERLAP_RATIO", original.minOverlap);
    restore("PI_CONTROL_SCROLL_CALIBRATION_STEP", original.calibrationStep);
    restore("PI_CONTROL_SCROLL_OUTPUT_STITCHED", original.outputStitched);
    restore("PI_CONTROL_LONG_CAPTURE_MAX_FRAMES", original.maxFrames);
    restore("PI_CONTROL_LONG_CAPTURE_UNCHANGED_FRAMES", original.unchanged);
    restore("PI_CONTROL_LONG_CAPTURE_OUTPUT_DIR", original.outputDir);
    restore("PI_CONTROL_WECHAT_RECORDS_OCR_CHUNK_HEIGHT", original.ocrChunkHeight);
    restore("PI_CONTROL_WECHAT_RECORDS_OCR_CHUNK_OVERLAP", original.ocrChunkOverlap);
  }
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
