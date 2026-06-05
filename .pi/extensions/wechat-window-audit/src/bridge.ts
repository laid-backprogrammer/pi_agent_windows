import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { Resvg } from "@resvg/resvg-js";
import {
  MediaType,
  MessageBuilder,
  type DownloadedMedia,
  type IncomingMessage,
  type SendContent,
  type UploadOptions,
  type UploadResult,
} from "@wechatbot/wechatbot";
import QRCode from "qrcode";
import type { MimoEnv } from "../../computer-control/src/env.js";
import {
  auditWindowElevationSketch,
  readImageSize,
  type WindowSketchAuditParams,
  type WindowSketchAuditResult,
} from "../../window-sketch-audit/src/audit.js";

const execFileAsync = promisify(execFile);
type RawMessagePayload = ReturnType<MessageBuilder["build"]>;

export type AuditBot = {
  login(options?: { force?: boolean; callbacks?: QrCallbacks }): Promise<unknown>;
  start(): Promise<void>;
  stop(): void;
  get isRunning(): boolean;
  onMessage(handler: (msg: IncomingMessage) => void | Promise<void>): unknown;
  download(message: IncomingMessage): Promise<DownloadedMedia | null>;
  reply(message: IncomingMessage, content: SendContent): Promise<void>;
  upload(options: UploadOptions): Promise<UploadResult>;
  sendRaw(payload: RawMessagePayload): Promise<void>;
  sendTyping?(userId: string): Promise<void>;
  stopTyping?(userId: string): Promise<void>;
};

export type QrCallbacks = {
  onQrUrl?: (url: string) => void;
  onScanned?: () => void;
  onExpired?: () => void;
};

export type AuditBotLike = Pick<AuditBot, "download" | "reply" | "upload" | "sendRaw"> &
  Partial<Pick<AuditBot, "sendTyping" | "stopTyping">>;

export type AuditDirs = {
  baseDir: string;
  inputDir: string;
  reportDir: string;
  storageDir: string;
  qrPath: string;
};

export type WechatAuditHandlerOptions = {
  env: MimoEnv;
  cwd: string;
  inputDir: string;
  outputDir: string;
  onStatus?: (text: string) => void;
  audit?: (params: WindowSketchAuditParams) => Promise<WindowSketchAuditResult>;
};

export function defaultAuditDirs(cwd: string): AuditDirs {
  const baseDir = join(cwd, ".wechat-audit");
  return {
    baseDir,
    inputDir: join(baseDir, "inputs"),
    reportDir: join(baseDir, "reports"),
    storageDir: join(baseDir, "session"),
    qrPath: join(cwd, ".wechat-audit-qrcode.png"),
  };
}

export function createQrCallbacks(options: { qrPath: string; onStatus?: (text: string) => void }): QrCallbacks {
  return {
    onQrUrl(url: string) {
      void writeQrPng(options.qrPath, url)
        .then(() => openFile(options.qrPath))
        .then(() => options.onStatus?.(`QR image saved and opened: ${options.qrPath}`))
        .catch((error) => {
          options.onStatus?.(`QR image failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    },
    onScanned() {
      options.onStatus?.("QR scanned. Waiting for confirmation on phone.");
    },
    onExpired() {
      options.onStatus?.("QR expired. Run /wechat-audit --force to request a new one.");
    },
  };
}

export function createWechatAuditHandler(bot: AuditBotLike, options: WechatAuditHandlerOptions) {
  return async function handle(msg: IncomingMessage): Promise<void> {
    await handleWechatAuditMessage(bot, msg, options);
  };
}

export async function handleWechatAuditMessage(
  bot: AuditBotLike,
  msg: IncomingMessage,
  options: WechatAuditHandlerOptions,
): Promise<void> {
  if (!isAuditableImageMessage(msg)) {
    await bot.reply(msg, "请发送门窗立面图手稿图片。我会下载图片、生成红笔缺项标注 PNG，并把结果发回微信。");
    return;
  }

  const start = Date.now();
  options.onStatus?.(`Received image from ${msg.userId}. Auditing...`);
  await bot.sendTyping?.(msg.userId);
  try {
    await bot.reply(msg, "已收到图片，正在审图，请稍等。");
    const media = await bot.download(msg);
    if (!media?.data) {
      await bot.reply(msg, "图片下载失败：未能从微信消息中取得媒体内容。");
      return;
    }

    const imagePath = await saveIncomingImage(options.inputDir, media);
    const audit =
      options.audit ??
      ((params: WindowSketchAuditParams) => auditWindowElevationSketch(options.env, params, options.cwd));
    const result = await audit({ imagePath, outputDir: options.outputDir });
    const pngPath = await renderAuditSvgToPng(result.outputPath);
    const elapsedMs = Date.now() - start;
    await bot.reply(msg, formatWechatSummary(result, elapsedMs, pngPath));

    try {
      await replyAuditPngImage(bot, msg, pngPath);
    } catch (uploadError) {
      await bot.reply(msg, formatPngUploadFailure(pngPath, uploadError));
      options.onStatus?.(
        `Audit PNG upload failed after audit finished: ${
          uploadError instanceof Error ? uploadError.message : String(uploadError)
        }`,
      );
    }
    options.onStatus?.(`Audit finished in ${(elapsedMs / 1000).toFixed(1)}s: ${pngPath}`);
  } catch (error) {
    await bot.reply(msg, `审图失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await bot.stopTyping?.(msg.userId);
  }
}

export function isAuditableImageMessage(msg: IncomingMessage): boolean {
  return msg.type === "image" || msg.images.length > 0 || msg.files.some((file) => /\.(jpe?g|png)$/i.test(file.fileName || ""));
}

export async function saveIncomingImage(inputDir: string, media: DownloadedMedia): Promise<string> {
  await mkdir(inputDir, { recursive: true });
  const ext = detectImageExtension(media);
  if (!ext) throw new Error("只支持 JPEG/PNG 图片。");
  readImageSize(media.data);
  const baseName = sanitizeName(media.fileName || `wechat-image-${Date.now()}-${randomUUID()}.${ext}`);
  const path = join(inputDir, baseName.toLowerCase().endsWith(`.${ext}`) ? baseName : `${baseName}.${ext}`);
  await writeFile(path, media.data);
  return path;
}

export async function renderAuditSvgToPng(svgPath: string): Promise<string> {
  const svg = await readFile(svgPath, "utf8");
  const rendered = new Resvg(svg).render();
  const png = Buffer.from(rendered.asPng());
  const pngPath = auditPngPath(svgPath);
  await writeFile(pngPath, png);
  return pngPath;
}

export async function replyAuditPngImage(
  bot: Pick<AuditBot, "upload" | "sendRaw">,
  msg: IncomingMessage,
  pngPath: string,
): Promise<void> {
  const png = await readFile(pngPath);
  const upload = await bot.upload({
    data: png,
    userId: msg.userId,
    mediaType: MediaType.IMAGE,
  });
  const payload = MessageBuilder.to(msg.userId, msg._contextToken)
    .image({
      media: upload.media,
      midSize: upload.encryptedFileSize,
    })
    .build();
  await bot.sendRaw(payload);
}

export function formatWechatSummary(result: WindowSketchAuditResult, elapsedMs: number, reportPath = result.outputPath): string {
  const topIssues = result.issues
    .slice(0, 5)
    .map((issue, index) => `${index + 1}. ${issue.message}`)
    .join("\n");
  const recognized = Object.entries(result.recognized)
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${value}`)
    .join("；");
  return [
    `审图完成，用时 ${(elapsedMs / 1000).toFixed(1)} 秒。`,
    `缺项/需确认：${result.issues.length} 项；疑似冲突：${result.conflicts.length} 项。`,
    recognized ? `已识别：${recognized}` : "",
    topIssues ? `主要问题：\n${topIssues}` : "未发现明显缺项。",
    `本地报告：${reportPath}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatPngUploadFailure(pngPath: string, error: unknown): string {
  return [
    "审图已完成，但微信 PNG 图片上传失败。",
    `本地报告：${pngPath}`,
    `上传错误：${error instanceof Error ? error.message : String(error)}`,
  ].join("\n");
}

export function formatStatusText(dirs: AuditDirs): string {
  return [
    "WeChat audit bot connected.",
    `QR: ${dirs.qrPath}`,
    `Inputs: ${dirs.inputDir}`,
    `Reports: ${dirs.reportDir}`,
    "Send a door/window sketch image from WeChat to audit it.",
  ].join("\n");
}

async function writeQrPng(path: string, url: string): Promise<void> {
  await QRCode.toFile(path, url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
  });
}

async function openFile(path: string): Promise<void> {
  if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", path], { windowsHide: true });
    return;
  }
  if (process.platform === "darwin") {
    await execFileAsync("open", [path]);
    return;
  }
  await execFileAsync("xdg-open", [path]);
}

function auditPngPath(svgPath: string): string {
  return extname(svgPath).toLowerCase() === ".svg" ? `${svgPath.slice(0, -4)}.png` : `${svgPath}.png`;
}

function detectImageExtension(media: DownloadedMedia): "jpg" | "png" | undefined {
  if (
    media.data.length >= 8 &&
    media.data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (media.data.length >= 3 && media.data[0] === 0xff && media.data[1] === 0xd8 && media.data[2] === 0xff) {
    return "jpg";
  }
  if (media.fileName && /\.png$/i.test(media.fileName)) return "png";
  if (media.fileName && /\.jpe?g$/i.test(media.fileName)) return "jpg";
  return undefined;
}

function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 160);
}
