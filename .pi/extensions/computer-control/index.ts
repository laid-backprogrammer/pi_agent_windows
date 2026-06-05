import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  captureScreenshot,
  click,
  confirmSensitiveAction,
  doubleClick,
  drag,
  hotkey,
  moveMouse,
  pressKey,
  removeFileIfExists,
  resolvePointInput,
  runWindowsPowerShell,
  scroll,
  startWeChat,
  typeText,
  wait,
  type Region,
} from "./src/control.js";
import { loadDotEnv, readMimoEnv } from "./src/env.js";
import { buildScreenDescriptionPrompt, mimoTextClient, mimoVisionClient } from "./src/mimo.js";

const PointSchema = Type.Object({
  x: Type.Optional(Type.Number({ description: "Absolute screen X coordinate in pixels." })),
  y: Type.Optional(Type.Number({ description: "Absolute screen Y coordinate in pixels." })),
  nx: Type.Optional(Type.Number({ description: "Normalized X coordinate, 0..1 across the current virtual screen." })),
  ny: Type.Optional(Type.Number({ description: "Normalized Y coordinate, 0..1 across the current virtual screen." })),
  durationMs: Type.Optional(Type.Number({ description: "Optional movement duration in milliseconds." })),
});

const RegionSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number(),
  height: Type.Number(),
});

export default function (pi: ExtensionAPI) {
  loadDotEnv(process.cwd());
  const env = readMimoEnv();

  pi.registerProvider("xiaomi-mimo-local", {
    name: "Xiaomi MiMo Local",
    baseUrl: env.providerBaseUrl,
    apiKey: "$XIAOMI_API_KEY",
    api: "openai-completions",
    authHeader: true,
    models: [
      {
        id: env.textModel,
        name: "Xiaomi MiMo V2.5 Pro",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 131072,
        compat: {},
      },
      {
        id: env.visionModel,
        name: "Xiaomi MiMo V2.5 Multimodal",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 131072,
        compat: {},
      },
    ],
  });

  pi.registerTool({
    name: "start_wechat",
    label: "Start WeChat",
    description: "Start the installed Windows WeChat/Weixin desktop application without using WSL or bash.",
    promptSnippet: "Open Windows WeChat/Weixin using a native PowerShell-backed tool.",
    promptGuidelines: [
      "Use start_wechat instead of bash when opening WeChat on Windows.",
      "After starting WeChat, call describe_screen before interacting with it.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal) {
      const result = await startWeChat(signal);
      await wait(env.actionDelayMs);
      const screenshot = await captureScreenshot(undefined, signal);
      return {
        content: [
          {
            type: "text",
            text: `Started WeChat from ${result.path}. Captured follow-up screenshot at ${screenshot.path}.`,
          },
        ],
        details: { path: result.path, afterScreenshot: screenshot },
      };
    },
  });

  pi.registerTool({
    name: "windows_powershell",
    label: "Windows PowerShell",
    description:
      "Run a native Windows PowerShell command. Use this instead of bash for Windows commands. Requires confirmation by default.",
    promptSnippet: "Run native Windows PowerShell, not WSL bash.",
    promptGuidelines: [
      "Use this for Windows commands such as Get-Process, Start-Process, and registry/app discovery.",
      "Do not use Pi's built-in bash for Windows desktop automation on this machine.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "PowerShell command text to run." }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const ok = await confirmSensitiveAction(
        ctx,
        env,
        "Allow PowerShell command?",
        truncateForDialog(params.command),
      );
      if (!ok) return blocked("windows_powershell");
      const result = await runWindowsPowerShell(params.command, signal);
      return {
        content: [
          {
            type: "text",
            text: [
              result.stdout ? `stdout:\n${result.stdout.trim()}` : "",
              result.stderr ? `stderr:\n${result.stderr.trim()}` : "",
            ]
              .filter(Boolean)
              .join("\n\n") || "PowerShell command completed with no output.",
          },
        ],
        details: { stdout: result.stdout, stderr: result.stderr },
      };
    },
  });

  pi.registerTool({
    name: "screenshot_screen",
    label: "Screenshot Screen",
    description: "Capture a screenshot of the Windows virtual desktop or an optional region.",
    promptSnippet: "Capture the current Windows screen for visual inspection.",
    promptGuidelines: [
      "Use screenshot_screen before coordinate-based computer-control actions when visual state is uncertain.",
    ],
    parameters: Type.Object({
      region: Type.Optional(RegionSchema),
    }),
    async execute(_toolCallId, params, signal) {
      const screenshot = await captureScreenshot(params.region as Region | undefined, signal);
      return {
        content: [
          {
            type: "text",
            text: `Captured screenshot ${screenshot.width}x${screenshot.height} at ${screenshot.path}`,
          },
        ],
        details: screenshot,
      };
    },
  });

  pi.registerTool({
    name: "describe_screen",
    label: "Describe Screen",
    description:
      "Capture the screen and ask Xiaomi mimo-v2.5, the multimodal model, to describe it and identify relevant UI coordinates.",
    promptSnippet: "Describe the current screen with Xiaomi mimo-v2.5 visual understanding.",
    promptGuidelines: [
      "Use describe_screen for visual understanding; it routes screenshots to the configured MiMo vision model.",
      "Use describe_screen to locate UI targets before click, double_click, right_click, drag, or type_text.",
    ],
    parameters: Type.Object({
      prompt: Type.String({ description: "What to inspect or find on the screen." }),
      region: Type.Optional(RegionSchema),
    }),
    async execute(_toolCallId, params, signal) {
      const screenshot = await captureScreenshot(params.region as Region | undefined, signal);
      try {
        const result = await mimoVisionClient(
          env,
          screenshot.path,
          buildScreenDescriptionPrompt(params.prompt),
          signal,
        );
        return {
          content: [{ type: "text", text: result.text }],
          details: {
            ...result.details,
            screenshot,
          },
        };
      } finally {
        await removeFileIfExists(screenshot.path);
      }
    },
  });

  pi.registerTool({
    name: "mimo_text",
    label: "MiMo Text",
    description: "Send a text-only prompt to the configured Xiaomi MiMo text model.",
    promptSnippet: "Call Xiaomi MiMo for text-only reasoning.",
    promptGuidelines: [
      "Use mimo_text only for text-only prompts; use describe_screen for screenshots and images.",
    ],
    parameters: Type.Object({
      prompt: Type.String(),
    }),
    async execute(_toolCallId, params, signal) {
      const result = await mimoTextClient(env, params.prompt, signal);
      return {
        content: [{ type: "text", text: result.text }],
        details: result.details,
      };
    },
  });

  pi.registerTool({
    name: "wait",
    label: "Wait",
    description: "Wait for a number of milliseconds without interacting with the desktop.",
    parameters: Type.Object({
      milliseconds: Type.Number({ description: "Positive wait duration in milliseconds." }),
    }),
    async execute(_toolCallId, params) {
      await wait(params.milliseconds);
      return {
        content: [{ type: "text", text: `Waited ${params.milliseconds} ms.` }],
        details: { milliseconds: params.milliseconds },
      };
    },
  });

  pi.registerTool({
    name: "move_mouse",
    label: "Move Mouse",
    description:
      "Move the mouse cursor. Prefer normalized nx/ny coordinates for cross-resolution accuracy. Requires confirmation by default.",
    parameters: PointSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const resolved = await resolvePointInput(params, signal);
      const ok = await confirmSensitiveAction(
        ctx,
        env,
        "Allow mouse move?",
        `Move cursor to (${resolved.point.x}, ${resolved.point.y}) from ${resolved.coordinateSource} coordinates.`,
      );
      if (!ok) return blocked("move_mouse");
      await moveMouse(resolved.point, params.durationMs, signal);
      return doneWithScreenshot("move_mouse", { ...params, ...resolved }, signal);
    },
  });

  pi.registerTool({
    name: "click",
    label: "Click",
    description:
      "Left-click. Prefer normalized nx/ny coordinates for cross-resolution accuracy. Requires confirmation by default.",
    parameters: PointSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const resolved = await resolvePointInput(params, signal);
      const ok = await confirmSensitiveAction(
        ctx,
        env,
        "Allow click?",
        `Left-click at (${resolved.point.x}, ${resolved.point.y}) from ${resolved.coordinateSource} coordinates.`,
      );
      if (!ok) return blocked("click");
      await click(resolved.point, "left", signal);
      return doneWithScreenshot("click", { ...params, ...resolved }, signal);
    },
  });

  pi.registerTool({
    name: "double_click",
    label: "Double Click",
    description:
      "Double-click. Prefer normalized nx/ny coordinates for cross-resolution accuracy. Requires confirmation by default.",
    parameters: PointSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const resolved = await resolvePointInput(params, signal);
      const ok = await confirmSensitiveAction(
        ctx,
        env,
        "Allow double-click?",
        `Double-click at (${resolved.point.x}, ${resolved.point.y}) from ${resolved.coordinateSource} coordinates.`,
      );
      if (!ok) return blocked("double_click");
      await doubleClick(resolved.point, signal);
      return doneWithScreenshot("double_click", { ...params, ...resolved }, signal);
    },
  });

  pi.registerTool({
    name: "right_click",
    label: "Right Click",
    description:
      "Right-click. Prefer normalized nx/ny coordinates for cross-resolution accuracy. Requires confirmation by default.",
    parameters: PointSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const resolved = await resolvePointInput(params, signal);
      const ok = await confirmSensitiveAction(
        ctx,
        env,
        "Allow right-click?",
        `Right-click at (${resolved.point.x}, ${resolved.point.y}) from ${resolved.coordinateSource} coordinates.`,
      );
      if (!ok) return blocked("right_click");
      await click(resolved.point, "right", signal);
      return doneWithScreenshot("right_click", { ...params, ...resolved }, signal);
    },
  });

  pi.registerTool({
    name: "drag",
    label: "Drag",
    description:
      "Drag from one coordinate to another. Prefer normalized fromNx/fromNy/toNx/toNy. Requires confirmation by default.",
    parameters: Type.Object({
      fromX: Type.Optional(Type.Number()),
      fromY: Type.Optional(Type.Number()),
      fromNx: Type.Optional(Type.Number({ description: "Normalized drag start X, 0..1." })),
      fromNy: Type.Optional(Type.Number({ description: "Normalized drag start Y, 0..1." })),
      toX: Type.Optional(Type.Number()),
      toY: Type.Optional(Type.Number()),
      toNx: Type.Optional(Type.Number({ description: "Normalized drag end X, 0..1." })),
      toNy: Type.Optional(Type.Number({ description: "Normalized drag end Y, 0..1." })),
      durationMs: Type.Optional(Type.Number()),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const from = await resolvePointInput(
        { x: params.fromX, y: params.fromY, nx: params.fromNx, ny: params.fromNy },
        signal,
      );
      const to = await resolvePointInput(
        { x: params.toX, y: params.toY, nx: params.toNx, ny: params.toNy },
        signal,
      );
      const ok = await confirmSensitiveAction(
        ctx,
        env,
        "Allow drag?",
        `Drag from (${from.point.x}, ${from.point.y}) to (${to.point.x}, ${to.point.y}).`,
      );
      if (!ok) return blocked("drag");
      await drag(from.point, to.point, params.durationMs, signal);
      return doneWithScreenshot("drag", { ...params, from, to }, signal);
    },
  });

  pi.registerTool({
    name: "scroll",
    label: "Scroll",
    description: "Scroll at the current cursor position. Positive delta scrolls up, negative scrolls down. Requires confirmation by default.",
    parameters: Type.Object({
      delta: Type.Number({ description: "Scroll clicks. Positive is up, negative is down." }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const ok = await confirmSensitiveAction(ctx, env, "Allow scroll?", `Scroll by ${params.delta}.`);
      if (!ok) return blocked("scroll");
      await scroll(params.delta, signal);
      return doneWithScreenshot("scroll", params, signal);
    },
  });

  pi.registerTool({
    name: "type_text",
    label: "Type Text",
    description: "Type text into the active application via clipboard paste. Requires confirmation by default.",
    parameters: Type.Object({
      text: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const ok = await confirmSensitiveAction(
        ctx,
        env,
        "Allow text entry?",
        `Type ${params.text.length} character(s) into the active application.`,
      );
      if (!ok) return blocked("type_text");
      await typeText(params.text, signal);
      return doneWithScreenshot("type_text", { characterCount: params.text.length }, signal);
    },
  });

  pi.registerTool({
    name: "press_key",
    label: "Press Key",
    description: "Press one keyboard key such as enter, tab, escape, f5, left, or a single character. Requires confirmation by default.",
    parameters: Type.Object({
      key: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const ok = await confirmSensitiveAction(ctx, env, "Allow key press?", `Press key: ${params.key}.`);
      if (!ok) return blocked("press_key");
      await pressKey(params.key, signal);
      return doneWithScreenshot("press_key", params, signal);
    },
  });

  pi.registerTool({
    name: "hotkey",
    label: "Hotkey",
    description: "Press a modifier hotkey such as ctrl+l, ctrl+shift+escape, or alt+tab. Requires confirmation by default.",
    parameters: Type.Object({
      keys: Type.Array(Type.String(), { minItems: 2 }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const ok = await confirmSensitiveAction(ctx, env, "Allow hotkey?", `Press hotkey: ${params.keys.join("+")}.`);
      if (!ok) return blocked("hotkey");
      await hotkey(params.keys, signal);
      return doneWithScreenshot("hotkey", params, signal);
    },
  });
}

function blocked(toolName: string) {
  return {
    content: [{ type: "text" as const, text: `${toolName} was blocked because confirmation was not granted.` }],
    details: { blocked: true, toolName },
  };
}

async function doneWithScreenshot(
  toolName: string,
  details: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const env = readMimoEnv();
  await wait(env.actionDelayMs);
  const afterScreenshot = await captureScreenshot(undefined, signal);
  return {
    content: [
      {
        type: "text" as const,
        text: `${toolName} completed. Waited ${env.actionDelayMs} ms and captured follow-up screenshot at ${afterScreenshot.path}.`,
      },
    ],
    details: { blocked: false, toolName, ...details, afterScreenshot },
  };
}

function truncateForDialog(value: string): string {
  return value.length > 800 ? `${value.slice(0, 800)}...` : value;
}
