import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadDotEnv, readMimoEnv } from "../computer-control/src/env.js";
import {
  auditWindowElevationSketch,
  formatAuditToolText,
  type WindowSketchAuditParams,
} from "./src/audit.js";

export default function (pi: ExtensionAPI) {
  loadDotEnv(process.cwd());
  const env = readMimoEnv();

  pi.registerTool({
    name: "audit_window_elevation_sketch",
    label: "Audit Window Elevation Sketch",
    description:
      "Audit a door/window elevation sketch image for missing or unclear customer-confirmation information, then create a red-marked SVG annotation.",
    promptSnippet:
      "Use audit_window_elevation_sketch for door/window elevation sketch review and missing-information redline output.",
    promptGuidelines: [
      "Use this tool when the user provides a door/window elevation sketch image and asks what information is missing.",
      "The tool reads a Markdown checklist, asks the Xiaomi MiMo vision model to inspect the sketch, and writes an SVG redline annotation.",
      "Report the generated SVG path and the numbered missing/unclear items.",
    ],
    parameters: Type.Object({
      imagePath: Type.String({
        description: "Path to the door/window elevation sketch image.",
      }),
      checklistPath: Type.Optional(
        Type.String({
          description:
            "Optional Markdown checklist path. Defaults to .pi/window-checklist.md.",
        }),
      ),
      outputDir: Type.Optional(
        Type.String({
          description:
            "Optional output directory. Defaults to a reports folder next to the input image.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const result = await auditWindowElevationSketch(
        env,
        params as WindowSketchAuditParams,
        process.cwd(),
        signal,
      );
      return {
        content: [{ type: "text", text: formatAuditToolText(result) }],
        details: result,
      };
    },
  });
}
