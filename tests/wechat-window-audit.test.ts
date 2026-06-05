import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import {
  MediaType,
  type DownloadedMedia,
  type IncomingMessage,
  type SendContent,
  type UploadOptions,
  type UploadResult,
} from "@wechatbot/wechatbot";
import {
  defaultAuditDirs,
  handleWechatAuditMessage,
  isAuditableImageMessage,
  renderAuditSvgToPng,
  saveIncomingImage,
  type AuditBotLike,
} from "../.pi/extensions/wechat-window-audit/src/bridge.ts";
import type { MimoEnv } from "../.pi/extensions/computer-control/src/env.ts";
import { readImageSize, type WindowSketchAuditResult } from "../.pi/extensions/window-sketch-audit/src/audit.ts";

const tinyPng = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000200000003080600000000000000000000000049454e44ae426082",
  "hex",
);

const svgText =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="white"/><text x="10" y="40" font-size="18" fill="red">audit</text></svg>';

const env: MimoEnv = {
  apiKey: "test-key",
  chatCompletionsUrl: "https://example.invalid/v1/chat/completions",
  providerBaseUrl: "https://example.invalid/v1",
  textModel: "text-model",
  visionModel: "vision-model",
  requireConfirm: false,
  actionDelayMs: 0,
};

class MockBot implements AuditBotLike {
  replies: SendContent[] = [];
  uploads: UploadOptions[] = [];
  rawMessages: unknown[] = [];
  downloads = 0;
  typing: string[] = [];
  stoppedTyping: string[] = [];

  constructor(
    private media: DownloadedMedia | null,
    private uploadError?: Error,
  ) {}

  async download(): Promise<DownloadedMedia | null> {
    this.downloads += 1;
    return this.media;
  }

  async reply(_message: IncomingMessage, content: SendContent): Promise<void> {
    this.replies.push(content);
  }

  async upload(options: UploadOptions): Promise<UploadResult> {
    this.uploads.push(options);
    if (this.uploadError) throw this.uploadError;
    return {
      media: {
        encrypt_query_param: "encrypted-param",
        aes_key: "YWVzLWtleQ==",
        encrypt_type: 1,
      },
      aesKey: Buffer.alloc(16),
      encryptedFileSize: options.data.length + 16,
    };
  }

  async sendRaw(payload: unknown): Promise<void> {
    this.rawMessages.push(payload);
  }

  async sendTyping(userId: string): Promise<void> {
    this.typing.push(userId);
  }

  async stopTyping(userId: string): Promise<void> {
    this.stoppedTyping.push(userId);
  }
}

test("defaultAuditDirs resolves stable WeChat audit paths", () => {
  const dirs = defaultAuditDirs("C:\\work\\wechat");
  assert.equal(dirs.baseDir, "C:\\work\\wechat\\.wechat-audit");
  assert.equal(dirs.inputDir, "C:\\work\\wechat\\.wechat-audit\\inputs");
  assert.equal(dirs.reportDir, "C:\\work\\wechat\\.wechat-audit\\reports");
  assert.equal(dirs.storageDir, "C:\\work\\wechat\\.wechat-audit\\session");
  assert.equal(dirs.qrPath, "C:\\work\\wechat\\.wechat-audit-qrcode.png");
});

test("saveIncomingImage stores downloaded PNG media and validates dimensions", async () => {
  const dir = await testDir("wechat-audit-save-");
  const path = await saveIncomingImage(dir, {
    data: tinyPng,
    type: "image",
    fileName: "Sketch.PNG",
  });

  assert.equal(basename(path), "Sketch.PNG");
  assert.deepEqual(readImageSize(await readFile(path)), {
    width: 2,
    height: 3,
    mime: "image/png",
  });
});

test("renderAuditSvgToPng writes a PNG next to the SVG", async () => {
  const dir = await testDir("wechat-audit-render-");
  const svgPath = join(dir, "main-bedroom.audit.svg");
  await writeFile(svgPath, svgText, "utf8");

  const pngPath = await renderAuditSvgToPng(svgPath);
  const png = await readFile(pngPath);

  assert.equal(basename(pngPath), "main-bedroom.audit.png");
  assert.equal(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
});

test("non-image WeChat messages reply with help and do not run audit", async () => {
  const bot = new MockBot(null);
  await handleWechatAuditMessage(bot, message({ type: "text", text: "hello" }), {
    env,
    cwd: process.cwd(),
    inputDir: "unused-input",
    outputDir: "unused-output",
    audit: async () => {
      throw new Error("audit should not be called");
    },
  });

  assert.equal(bot.downloads, 0);
  assert.equal(bot.uploads.length, 0);
  assert.equal(bot.rawMessages.length, 0);
  assert.equal(bot.replies.length, 1);
  assert.equal(typeof bot.replies[0], "string");
});

test("image WeChat messages are downloaded, audited, summarized, and replied with PNG image item", async () => {
  const dir = await testDir("wechat-audit-handler-");
  const inputDir = join(dir, "inputs");
  const outputDir = join(dir, "reports");
  const bot = new MockBot({
    data: tinyPng,
    type: "image",
    fileName: "main-bedroom.png",
  });

  let auditedImagePath = "";
  let auditedOutputDir = "";
  await handleWechatAuditMessage(bot, message({ type: "image", images: [{}] }), {
    env,
    cwd: dir,
    inputDir,
    outputDir,
    audit: async (params): Promise<WindowSketchAuditResult> => {
      auditedImagePath = params.imagePath;
      auditedOutputDir = params.outputDir ?? "";
      const imageSize = readImageSize(await readFile(params.imagePath));
      await mkdir(params.outputDir ?? outputDir, { recursive: true });
      const outputPath = join(params.outputDir ?? outputDir, "main-bedroom.audit.svg");
      await writeFile(outputPath, svgText, "utf8");
      return auditResult(dir, params.imagePath, outputPath, imageSize);
    },
  });

  assert.equal(bot.downloads, 1);
  assert.deepEqual(bot.typing, ["tester@im.wechat"]);
  assert.deepEqual(bot.stoppedTyping, ["tester@im.wechat"]);
  assert.equal(auditedOutputDir, outputDir);
  assert.match(auditedImagePath, /main-bedroom\.png$/);
  assert.equal((await stat(auditedImagePath)).isFile(), true);

  const textReplies = bot.replies.filter((reply): reply is string => typeof reply === "string");
  assert.equal(textReplies.length, 2);
  assert.match(textReplies[0], /received|已收到|Auditing|审图/i);
  assert.match(textReplies[1], /Missing quantity/);
  assert.match(textReplies[1], /Glass spec is not detailed/);
  assert.match(textReplies[1], /main-bedroom\.audit\.png/);
  assert.equal(bot.replies.some(isFileReply), false);

  assert.equal(bot.uploads.length, 1);
  assert.equal(bot.uploads[0].mediaType, MediaType.IMAGE);
  assert.equal(bot.uploads[0].userId, "tester@im.wechat");
  assert.equal(bot.uploads[0].data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);

  assert.equal(bot.rawMessages.length, 1);
  const raw = bot.rawMessages[0] as {
    to_user_id: string;
    context_token: string;
    item_list: Array<{ type: number; image_item?: { media?: unknown; mid_size?: number } }>;
  };
  assert.equal(raw.to_user_id, "tester@im.wechat");
  assert.equal(raw.context_token, "context-token");
  assert.equal(raw.item_list[0].type, 2);
  assert.ok(raw.item_list[0].image_item?.media);
  assert.equal(typeof raw.item_list[0].image_item?.mid_size, "number");
});

test("PNG upload failure keeps audit success and replies with local report fallback", async () => {
  const dir = await testDir("wechat-audit-upload-failure-");
  const inputDir = join(dir, "inputs");
  const outputDir = join(dir, "reports");
  const bot = new MockBot(
    {
      data: tinyPng,
      type: "image",
      fileName: "main-bedroom.png",
    },
    new Error("CDN upload server error: HTTP 500"),
  );

  await handleWechatAuditMessage(bot, message({ type: "image", images: [{}] }), {
    env,
    cwd: dir,
    inputDir,
    outputDir,
    audit: async (params): Promise<WindowSketchAuditResult> => {
      const imageSize = readImageSize(await readFile(params.imagePath));
      await mkdir(params.outputDir ?? outputDir, { recursive: true });
      const outputPath = join(params.outputDir ?? outputDir, "main-bedroom.audit.svg");
      await writeFile(outputPath, svgText, "utf8");
      return auditResult(dir, params.imagePath, outputPath, imageSize);
    },
  });

  assert.equal(bot.uploads.length, 1);
  assert.equal(bot.uploads[0].mediaType, MediaType.IMAGE);
  assert.equal(bot.rawMessages.length, 0);

  const textReplies = bot.replies.filter((reply): reply is string => typeof reply === "string");
  assert.equal(textReplies.length, 3);
  assert.match(textReplies[1], /Missing quantity/);
  assert.match(textReplies[2], /审图已完成/);
  assert.match(textReplies[2], /main-bedroom\.audit\.png/);
  assert.match(textReplies[2], /HTTP 500/);
  assert.equal(textReplies.some((reply) => reply.includes("审图失败")), false);
});

test("isAuditableImageMessage accepts image type and jpg/png file messages", () => {
  assert.equal(isAuditableImageMessage(message({ type: "image", images: [{}] })), true);
  assert.equal(
    isAuditableImageMessage(
      message({
        type: "file",
        files: [{ fileName: "window.jpg" }],
      }),
    ),
    true,
  );
  assert.equal(isAuditableImageMessage(message({ type: "file", files: [{ fileName: "notes.txt" }] })), false);
});

function auditResult(
  dir: string,
  imagePath: string,
  outputPath: string,
  imageSize: WindowSketchAuditResult["imageSize"],
): WindowSketchAuditResult {
  return {
    imagePath,
    checklistPath: join(dir, ".pi", "window-checklist.md"),
    outputPath,
    imageSize,
    summary: "Audit complete",
    recognized: { room: "main bedroom", width: "2400" },
    issues: [
      {
        id: "1",
        severity: "missing",
        message: "Missing quantity",
        evidence: "No quantity found",
        anchor: { nx: 0.5, ny: 0.5 },
      },
      {
        id: "2",
        severity: "unclear",
        message: "Glass spec is not detailed",
        evidence: "Only says double layer",
        anchor: { nx: 0.25, ny: 0.75 },
      },
    ],
    conflicts: [],
    raw: {
      summary: "Audit complete",
      recognized: { room: "main bedroom", width: "2400" },
      issues: [],
      conflicts: [],
    },
  };
}

function isFileReply(content: SendContent): content is { file: Buffer; fileName: string; caption?: string } {
  return typeof content === "object" && content !== null && "file" in content;
}

function message(partial: Partial<IncomingMessage>): IncomingMessage {
  return {
    userId: "tester@im.wechat",
    text: "",
    type: "text",
    timestamp: new Date("2026-06-05T00:00:00Z"),
    images: [],
    voices: [],
    files: [],
    videos: [],
    raw: {} as IncomingMessage["raw"],
    _contextToken: "context-token",
    ...partial,
  };
}

async function testDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}
