import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { MimoEnv } from "../env.js";

export async function confirmSensitiveAction(
  ctx: ExtensionContext | undefined,
  env: MimoEnv,
  title: string,
  message: string,
): Promise<boolean> {
  if (!env.requireConfirm) return true;
  if (!ctx?.ui?.confirm) return false;
  return ctx.ui.confirm(title, message);
}
