import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  captureScrollRegion,
  captureWechatChatRecords,
  captureScreenshot,
  checkApplicationOpen,
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
  scrollAtTarget,
  startWeChat,
  typeText,
  wait,
  type Region,
  type ScrollDirection,
  type WeChatConversationListLocateInput,
  type WeChatConversationListLocateResult,
} from "./src/control.js";
import { loadDotEnv, readMimoEnv, type MimoEnv } from "./src/env.js";
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

const ApplicationCheckSchema = Type.Object({
  appName: Type.Optional(Type.String({ description: "Friendly application name used as a fallback process/window match." })),
  processNames: Type.Optional(Type.Array(Type.String(), { description: "Process names such as WeChat or Weixin." })),
  windowTitleIncludes: Type.Optional(
    Type.Array(Type.String(), { description: "Case-insensitive substrings to match against visible window titles." }),
  ),
});

const ScrollDirectionSchema = Type.Union([Type.Literal("up"), Type.Literal("down")]);

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
    name: "check_application_open",
    label: "Check Application Open",
    description: "Check whether a Windows desktop application is already open by process name or window title.",
    promptSnippet: "Check whether the target Windows application is already open before interacting with it.",
    promptGuidelines: [
      "Use this before controlling desktop software unless a previous tool result already proves the app is open.",
      "Match by processNames for reliability, and use windowTitleIncludes when the visible title matters.",
    ],
    parameters: ApplicationCheckSchema,
    async execute(_toolCallId, params, signal) {
      const result = await checkApplicationOpen(params, signal);
      const screenshot = await captureScreenshot(undefined, signal);
      return {
        content: [
          {
            type: "text",
            text: result.isOpen
              ? `Application is open. Matched ${result.matchedProcesses.length} process(es) and ${result.matchedWindows.length} window(s). Captured follow-up screenshot at ${screenshot.path}.`
              : `Application is not open. Captured follow-up screenshot at ${screenshot.path}.`,
          },
        ],
        details: { ...result, afterScreenshot: screenshot },
      };
    },
  });

  pi.registerTool({
    name: "start_wechat",
    label: "Start WeChat",
    description: "Start the installed Windows WeChat/Weixin desktop application without using WSL or bash.",
    promptSnippet: "Open Windows WeChat/Weixin using a native PowerShell-backed tool.",
    promptGuidelines: [
      "Use start_wechat instead of bash when opening WeChat on Windows.",
      "This tool first checks whether WeChat/Weixin is already open and does not start a duplicate process when it is open.",
      "After start_wechat, call describe_screen before interacting with WeChat.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal) {
      const result = await startWeChat(signal);
      await wait(env.actionDelayMs);
      const screenshot = await captureScreenshot(undefined, signal);
      const text = result.started
        ? `Started WeChat from ${result.path}. Captured follow-up screenshot at ${screenshot.path}.`
        : `WeChat/Weixin is already open. Captured follow-up screenshot at ${screenshot.path}.`;
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
        details: { ...result, afterScreenshot: screenshot },
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
    description:
      "Scroll after optionally moving the mouse to a target region or coordinate. Positive delta scrolls up, negative scrolls down. Requires confirmation by default.",
    parameters: Type.Object({
      delta: Type.Optional(
        Type.Number({
          description:
            "Scroll clicks. Positive is up, negative is down. Defaults to -PI_CONTROL_SCROLL_STEP when omitted.",
        }),
      ),
      region: Type.Optional(RegionSchema),
      x: Type.Optional(Type.Number({ description: "Absolute target X coordinate in pixels." })),
      y: Type.Optional(Type.Number({ description: "Absolute target Y coordinate in pixels." })),
      nx: Type.Optional(Type.Number({ description: "Normalized target X coordinate, 0..1." })),
      ny: Type.Optional(Type.Number({ description: "Normalized target Y coordinate, 0..1." })),
      repeat: Type.Optional(Type.Number({ description: "Number of scroll events. Defaults to PI_CONTROL_SCROLL_REPEAT." })),
      delayMs: Type.Optional(
        Type.Number({ description: "Delay between repeated scroll events. Defaults to PI_CONTROL_SCROLL_DELAY_MS." }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const delta = typeof params.delta === "number" ? params.delta : -env.scrollStep;
      const repeat = params.repeat ?? env.scrollRepeat;
      const target = params.region
        ? `region (${params.region.x}, ${params.region.y}, ${params.region.width}x${params.region.height})`
        : typeof params.nx === "number" || typeof params.x === "number"
          ? "target coordinate"
          : "current cursor";
      const ok = await confirmSensitiveAction(
        ctx,
        env,
        "Allow scroll?",
        `Scroll ${target} by ${delta} for ${repeat} time(s).`,
      );
      if (!ok) return blocked("scroll");
      const result = await scrollAtTarget(
        {
          x: params.x,
          y: params.y,
          nx: params.nx,
          ny: params.ny,
          region: params.region as Region | undefined,
          delta,
          repeat: params.repeat,
          delayMs: params.delayMs,
        },
        { repeat: env.scrollRepeat, delayMs: env.scrollDelayMs },
        signal,
      );
      return doneWithScreenshot("scroll", result, signal);
    },
  });

  pi.registerTool({
    name: "capture_scroll_region",
    label: "Capture Scroll Region",
    description:
      "Calibrate a fixed scroll region, then save one region screenshot per scroll step with a manifest. Requires confirmation by default.",
    promptSnippet: "Calibrate a fixed scrollable region, save per-step region frames, and write a manifest.",
    promptGuidelines: [
      "Use this for fixed scroll regions such as WeChat chat history instead of full-screen repeated screenshots or overlong stitched images.",
      "Identify the exact scrollable region first with describe_screen or screenshot_screen.",
      "For WeChat chat history, default direction up captures older messages; the tool first restores the region to the bottom before upward capture.",
      "If WeChat ignores mouse-wheel scrolling, the tool may automatically fall back to PageUp/PageDown and records the inputMethod in the manifest.",
      "Leave outputStitched false unless the user explicitly needs a long PNG.",
    ],
    parameters: Type.Object({
      region: RegionSchema,
      direction: Type.Optional(ScrollDirectionSchema),
      scrollStep: Type.Optional(
        Type.Number({ description: "Positive fallback scroll step used only if calibration cannot infer a better value." }),
      ),
      maxFrames: Type.Optional(
        Type.Number({ description: "Maximum region frames to capture. Defaults to PI_CONTROL_LONG_CAPTURE_MAX_FRAMES." }),
      ),
      delayMs: Type.Optional(
        Type.Number({ description: "Delay after each scroll. Defaults to PI_CONTROL_SCROLL_DELAY_MS." }),
      ),
      unchangedFrameLimit: Type.Optional(
        Type.Number({
          description:
            "Stop after this many consecutive unchanged frames. Defaults to PI_CONTROL_LONG_CAPTURE_UNCHANGED_FRAMES.",
        }),
      ),
      outputDir: Type.Optional(Type.String({ description: "Directory for region frames and manifest.json." })),
      outputPath: Type.Optional(Type.String({ description: "Optional stitched PNG output path when outputStitched is true." })),
      outputStitched: Type.Optional(Type.Boolean({ description: "Whether to also generate a stitched PNG. Defaults to false." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const direction = (params.direction ?? "up") as ScrollDirection;
      const maxFrames = params.maxFrames ?? env.longCaptureMaxFrames;
      const calibrationStep = env.scrollCalibrationStep;
      const restoreToBoundary = direction === "up";
      const ok = await confirmSensitiveAction(
        ctx,
        env,
        "Allow scroll capture?",
        `Calibrate and capture region (${params.region.x}, ${params.region.y}, ${params.region.width}x${params.region.height}) while scrolling ${direction} up to ${maxFrames} frame(s) with calibration step ${calibrationStep}${restoreToBoundary ? " after first restoring the region to the bottom" : ""}.`,
      );
      if (!ok) return blocked("capture_scroll_region");
      const result = await captureScrollRegion(
        {
          region: params.region as Region,
          direction,
          scrollStep: params.scrollStep,
          autoCalibrate: true,
          calibrationStep: env.scrollCalibrationStep,
          overlapRatio: env.scrollOverlapRatio,
          minOverlapRatio: env.scrollMinOverlapRatio,
          restoreToBoundary,
          maxFrames: params.maxFrames,
          delayMs: params.delayMs,
          unchangedFrameLimit: params.unchangedFrameLimit,
          outputDir: params.outputDir,
          outputPath: params.outputPath,
          outputStitched: params.outputStitched,
        },
        {
          scrollStep: env.scrollStep,
          calibrationStep: env.scrollCalibrationStep,
          overlapRatio: env.scrollOverlapRatio,
          minOverlapRatio: env.scrollMinOverlapRatio,
          maxFrames: env.longCaptureMaxFrames,
          delayMs: env.scrollDelayMs,
          unchangedFrameLimit: env.longCaptureUnchangedFrames,
          outputDir: env.longCaptureOutputDir,
          outputStitched: env.scrollOutputStitched,
        },
        signal,
      );
      const stitchedText = result.stitchedPath ? ` Stitched PNG: ${result.stitchedPath}.` : "";
      return {
        content: [
          {
            type: "text",
            text: `Captured ${result.frameCount} region frame(s) using ${result.scroll.inputMethod}, stopped by ${result.stopReason}, and wrote manifest at ${result.manifestPath}.${stitchedText}`,
          },
        ],
        details: { blocked: false, toolName: "capture_scroll_region", ...result },
      };
    },
  });

  pi.registerTool({
    name: "capture_wechat_chat_records",
    label: "Capture WeChat Chat Records",
    description:
      "Open a WeChat chat by name, open its chat-records window, temporarily topmost the target windows, capture the scrollable records region, stitch a long PNG, and split it into OCR-friendly chunks. Requires confirmation by default.",
    promptSnippet: "Use this high-level tool for WeChat chat-record screenshot extraction instead of manual click-by-click control.",
    promptGuidelines: [
      "Use this when the user asks to capture or extract WeChat chat records/screenshots for a specific chat or group.",
      "Pass the target chat name as chatName. The tool handles WeChat startup, VLM-based conversation-list scanning, search fallback, chat-record window opening, topmost handling, scroll capture, stitching, and OCR chunking.",
      "Inspect the returned preflight screenshots and manifest paths for acceptance instead of manually navigating through WeChat.",
    ],
    parameters: Type.Object({
      chatName: Type.String({ description: "Target WeChat chat or group name, for example 论文抽屉." }),
      outputDir: Type.Optional(Type.String({ description: "Output directory for this capture run." })),
      maxFrames: Type.Optional(Type.Number({ description: "Maximum scroll frames to capture." })),
      ocrChunkHeight: Type.Optional(Type.Number({ description: "Maximum OCR chunk image height. Defaults to 3500." })),
      ocrChunkOverlap: Type.Optional(Type.Number({ description: "Vertical overlap between OCR chunks. Defaults to 80." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const maxFrames = params.maxFrames ?? env.longCaptureMaxFrames;
      const ok = await confirmSensitiveAction(
        ctx,
        env,
        "Allow WeChat records capture?",
        `Open WeChat, locate chat "${params.chatName}" from the conversation list with VLM-assisted scanning, open its chat-records window, temporarily topmost windows, and capture up to ${maxFrames} frame(s).`,
      );
      if (!ok) return blocked("capture_wechat_chat_records");
      const result = await captureWechatChatRecords(
        {
          chatName: params.chatName,
          outputDir: params.outputDir,
          maxFrames: params.maxFrames,
          ocrChunkHeight: params.ocrChunkHeight,
          ocrChunkOverlap: params.ocrChunkOverlap,
        },
        {
          scrollStep: env.scrollStep,
          calibrationStep: env.scrollCalibrationStep,
          overlapRatio: env.scrollOverlapRatio,
          minOverlapRatio: env.scrollMinOverlapRatio,
          maxFrames: env.longCaptureMaxFrames,
          delayMs: env.scrollDelayMs,
          unchangedFrameLimit: env.longCaptureUnchangedFrames,
          outputDir: env.longCaptureOutputDir,
          outputStitched: true,
          wechatRecordsOutputDir: ".wechat-audit/wechat-records",
          ocrChunkHeight: env.wechatRecordsOcrChunkHeight,
          ocrChunkOverlap: env.wechatRecordsOcrChunkOverlap,
        },
        signal,
        {
          locateConversationInList: (input: WeChatConversationListLocateInput, locateSignal?: AbortSignal) =>
            locateWechatConversationInList(env, input, locateSignal),
        },
      );
      return {
        content: [
          {
            type: "text",
            text: [
              `Captured WeChat records for "${result.chatName}".`,
              `Manifest: ${result.manifestPath}.`,
              result.stitchedPath ? `Long PNG: ${result.stitchedPath}.` : "",
              `OCR chunks: ${result.ocrChunks.length}.`,
              `Preflight screenshots: ${result.preflight.wechatTopmostScreenshot}, ${result.preflight.recordsWindowTopmostScreenshot}.`,
            ]
              .filter(Boolean)
              .join(" "),
          },
        ],
        details: { blocked: false, toolName: "capture_wechat_chat_records", ...result },
      };
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

async function locateWechatConversationInList(
  env: MimoEnv,
  input: WeChatConversationListLocateInput,
  signal?: AbortSignal,
): Promise<WeChatConversationListLocateResult> {
  const prompt = buildScreenDescriptionPrompt(
    [
      `This image is a cropped left conversation list from Windows WeChat.`,
      `Find the actual conversation row whose chat/group name is exactly or clearly "${input.chatName}".`,
      "Do not match the search box, online search results, message content, the right chat pane, or unrelated rows.",
      'If the target row is visible, return exactly one coordinate labeled "target_conversation" at the center of that row.',
      "If the target row is not visible, return an empty coordinates array.",
      "Include visible conversation row titles in visible_text.",
    ].join("\n"),
  );
  const result = await mimoVisionClient(env, input.screenshotPath, prompt, signal);
  const parsed = result.details.parsed;
  const coordinate =
    parsed?.coordinates.find((item) => item.label.toLowerCase().includes("target_conversation")) ??
    parsed?.coordinates[0];
  if (!coordinate) {
    return {
      found: false,
      summary: parsed?.summary,
      visibleText: parsed?.visible_text,
      rawText: result.text,
    };
  }
  return {
    found: true,
    x: coordinate.x,
    y: coordinate.y,
    nx: coordinate.nx,
    ny: coordinate.ny,
    label: coordinate.label,
    summary: parsed?.summary,
    visibleText: parsed?.visible_text,
    rawText: result.text,
  };
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
