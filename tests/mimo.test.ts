import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { MimoEnv } from "../.pi/extensions/computer-control/src/env.ts";
import {
  buildScreenDescriptionPrompt,
  mimoTextClient,
  mimoVisionClient,
  parseScreenDescription,
} from "../.pi/extensions/computer-control/src/mimo.ts";

const env: MimoEnv = {
  apiKey: "sk-test-value",
  chatCompletionsUrl: "https://api.xiaomimimo.com/v1/chat/completions",
  providerBaseUrl: "https://api.xiaomimimo.com/v1",
  textModel: "mimo-v2.5",
  visionModel: "mimo-v2.5",
  requireConfirm: true,
  actionDelayMs: 700,
  scrollStep: 6,
  scrollRepeat: 1,
  scrollDelayMs: 120,
  scrollOverlapRatio: 0.1,
  scrollMinOverlapRatio: 0.01,
  scrollCalibrationStep: 3,
  scrollOutputStitched: false,
  longCaptureMaxFrames: 40,
  longCaptureUnchangedFrames: 2,
  longCaptureOutputDir: ".wechat-audit/screenshots",
  wechatRecordsOcrChunkHeight: 3500,
  wechatRecordsOcrChunkOverlap: 80,
};

test("mimoTextClient routes to mimo-v2.5", async () => {
  const calls: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(calls, "text ok");
  try {
    const result = await mimoTextClient(env, "plan this");
    assert.equal(result.details.route, "text");
    assert.equal(result.details.model, "mimo-v2.5");

    const body = JSON.parse((calls[0] as RequestInit).body as string);
    assert.equal(body.model, "mimo-v2.5");
    assert.equal(body.messages[1].content, "plan this");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mimoVisionClient routes image prompts to mimo-v2.5", async () => {
  const calls: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(
    calls,
    JSON.stringify({
      summary: "screen",
      visible_text: ["OK"],
      suggested_actions: ["click OK"],
      coordinates: [{ label: "OK", x: 10, y: 20 }],
    }),
  );
  const dir = await mkdtemp(join(tmpdir(), "mimo-test-"));
  const imagePath = join(dir, "screen.png");
  await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  try {
    const result = await mimoVisionClient(env, imagePath, buildScreenDescriptionPrompt("describe"));
    assert.equal(result.details.route, "vision");
    assert.equal(result.details.model, "mimo-v2.5");
    assert.equal(result.details.parsed?.summary, "screen");

    const body = JSON.parse((calls[0] as RequestInit).body as string);
    assert.equal(body.model, "mimo-v2.5");
    assert.equal(body.messages[1].content[0].type, "image_url");
    assert.match(body.messages[1].content[0].image_url.url, /^data:image\/png;base64,/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parseScreenDescription accepts fenced JSON", () => {
  const parsed = parseScreenDescription(`\`\`\`json
{"summary":"A","visible_text":["B"],"suggested_actions":["C"],"coordinates":[{"label":"D","x":1,"y":2,"nx":0.1,"ny":0.2}]}
\`\`\``);
  assert.deepEqual(parsed, {
    summary: "A",
    visible_text: ["B"],
    suggested_actions: ["C"],
    coordinates: [{ label: "D", x: 1, y: 2, nx: 0.1, ny: 0.2 }],
  });
});

test("parseScreenDescription accepts normalized-only coordinates", () => {
  const parsed = parseScreenDescription(
    '{"summary":"A","visible_text":[],"suggested_actions":[],"coordinates":[{"label":"center","nx":0.5,"ny":0.5}]}',
  );
  assert.deepEqual(parsed?.coordinates, [{ label: "center", nx: 0.5, ny: 0.5 }]);
});

function mockFetch(calls: unknown[], content: string): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
}
