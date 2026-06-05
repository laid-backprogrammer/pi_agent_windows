import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmSensitiveAction, resolvePointInput } from "../.pi/extensions/computer-control/src/control.ts";
import type { MimoEnv } from "../.pi/extensions/computer-control/src/env.ts";

const baseEnv: MimoEnv = {
  apiKey: "sk-test-value",
  chatCompletionsUrl: "https://api.xiaomimimo.com/v1/chat/completions",
  providerBaseUrl: "https://api.xiaomimimo.com/v1",
  textModel: "mimo-v2.5-pro",
  visionModel: "mimo-v2.5",
  requireConfirm: true,
  actionDelayMs: 700,
};

test("sensitive actions are blocked when confirmation is required but no UI is available", async () => {
  assert.equal(await confirmSensitiveAction(undefined, baseEnv, "Allow?", "Test action"), false);
});

test("sensitive actions can run when confirmation is explicitly disabled", async () => {
  assert.equal(
    await confirmSensitiveAction(undefined, { ...baseEnv, requireConfirm: false }, "Allow?", "Test action"),
    true,
  );
});

test("normalized coordinates resolve against current virtual screen", async () => {
  const resolved = await resolvePointInput({ nx: 0.5, ny: 0.5 });
  assert.equal(resolved.coordinateSource, "normalized");
  assert.ok(resolved.screen);
  assert.equal(resolved.point.x, resolved.screen.left + Math.round(resolved.screen.width * 0.5));
  assert.equal(resolved.point.y, resolved.screen.top + Math.round(resolved.screen.height * 0.5));
});

test("pixel coordinates remain supported", async () => {
  const resolved = await resolvePointInput({ x: 12, y: 34 });
  assert.deepEqual(resolved.point, { x: 12, y: 34 });
  assert.equal(resolved.coordinateSource, "pixel");
});
