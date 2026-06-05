import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { WeChatBot } from "@wechatbot/wechatbot";
import { loadDotEnv, readMimoEnv } from "../computer-control/src/env.js";
import {
  createQrCallbacks,
  createWechatAuditHandler,
  defaultAuditDirs,
  formatStatusText,
  type AuditBot,
} from "./src/bridge.js";

let activeBot: AuditBot | undefined;
let activeStart: Promise<void> | undefined;

export default function (pi: ExtensionAPI) {
  loadDotEnv(process.cwd());

  pi.registerCommand("wechat-audit", {
    description: "Start a WeChat image audit bot for door/window elevation sketches.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const force = args.split(/\s+/).includes("--force");
      if (activeBot?.isRunning && !force) {
        announce(pi, "WeChat audit bot is already running. Use /wechat-audit-disconnect first or /wechat-audit --force.");
        return;
      }
      if (activeBot && force) {
        activeBot.stop();
        activeBot = undefined;
        activeStart = undefined;
      }

      const cwd = ctx.cwd || process.cwd();
      const dirs = defaultAuditDirs(cwd);
      const env = readMimoEnv();
      const qrCallbacks = createQrCallbacks({
        qrPath: dirs.qrPath,
        onStatus: (text) => announce(pi, text),
      });
      const bot = new WeChatBot({
        storage: "file",
        storageDir: dirs.storageDir,
        logLevel: "info",
        loginCallbacks: qrCallbacks,
      }) as AuditBot;

      activeBot = bot;
      announce(pi, "Starting WeChat audit bot. Scan the QR image when it opens.");
      bot.onMessage(
        createWechatAuditHandler(bot, {
          env,
          cwd,
          inputDir: dirs.inputDir,
          outputDir: dirs.reportDir,
          onStatus: (text) => announce(pi, text),
        }),
      );
      await bot.login({ force, callbacks: qrCallbacks });
      activeStart = bot.start().catch((error) => {
        announce(pi, `WeChat audit bot stopped with error: ${error instanceof Error ? error.message : String(error)}`);
        activeBot = undefined;
        activeStart = undefined;
      });
      void activeStart;
      announce(pi, formatStatusText(dirs));
    },
  });

  pi.registerCommand("wechat-audit-disconnect", {
    description: "Stop the WeChat image audit bot.",
    async handler() {
      if (!activeBot) {
        announce(pi, "WeChat audit bot is not running.");
        return;
      }
      activeBot.stop();
      activeBot = undefined;
      activeStart = undefined;
      announce(pi, "WeChat audit bot disconnected.");
    },
  });
}

function announce(pi: ExtensionAPI, text: string): void {
  console.log(`[wechat-audit] ${text}`);
  pi.sendMessage(
    {
      customType: "wechat-window-audit-status",
      display: true,
      content: text,
      details: { source: "wechat-window-audit" },
    },
    { triggerTurn: false },
  );
}
