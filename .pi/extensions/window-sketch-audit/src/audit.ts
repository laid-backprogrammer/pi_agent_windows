import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { MimoEnv } from "../../computer-control/src/env.js";

type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | {
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
    };

export type WindowSketchAuditParams = {
  imagePath: string;
  checklistPath?: string;
  outputDir?: string;
};

export type NormalizedAnchor = {
  nx: number;
  ny: number;
};

export type AuditIssue = {
  id: string;
  severity: "missing" | "unclear" | "conflict" | "info";
  message: string;
  evidence?: string;
  anchor?: NormalizedAnchor;
};

export type AuditConflict = {
  id?: string;
  message: string;
  evidence?: string;
  anchor?: NormalizedAnchor;
};

export type WindowSketchAuditJson = {
  summary: string;
  recognized: Record<string, string>;
  issues: AuditIssue[];
  conflicts: AuditConflict[];
};

export type ImageSize = {
  width: number;
  height: number;
  mime: "image/jpeg" | "image/png";
};

export type PixelPoint = {
  x: number;
  y: number;
};

export type WindowSketchAuditResult = {
  imagePath: string;
  checklistPath: string;
  outputPath: string;
  imageSize: ImageSize;
  summary: string;
  recognized: Record<string, string>;
  issues: AuditIssue[];
  conflicts: AuditConflict[];
  raw: WindowSketchAuditJson;
};

export async function auditWindowElevationSketch(
  env: MimoEnv,
  params: WindowSketchAuditParams,
  cwd = process.cwd(),
  signal?: AbortSignal,
): Promise<WindowSketchAuditResult> {
  const imagePath = resolve(cwd, params.imagePath);
  const checklistPath = resolve(
    cwd,
    params.checklistPath ?? ".pi/window-checklist.md",
  );
  const checklist = await readChecklist(checklistPath);
  const imageBytes = await readFile(imagePath);
  const imageSize = readImageSize(imageBytes);
  const prompt = buildAuditPrompt(checklist);
  const raw = await callVisionAudit(
    env,
    imageBytes,
    imageSize.mime,
    prompt,
    signal,
  );
  const audit = normalizeAuditJson(raw);
  const outputDir = resolve(
    cwd,
    params.outputDir ?? join(dirname(imagePath), "reports"),
  );
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(
    outputDir,
    `${basename(imagePath, extname(imagePath))}.audit.svg`,
  );
  const svg = renderAuditSvg({
    imagePath,
    imageBytes,
    imageSize,
    audit,
  });
  await writeFile(outputPath, svg, "utf8");
  return {
    imagePath,
    checklistPath,
    outputPath,
    imageSize,
    summary: audit.summary,
    recognized: audit.recognized,
    issues: audit.issues,
    conflicts: audit.conflicts,
    raw: audit,
  };
}

export async function readChecklist(path: string): Promise<string> {
  const text = await readFile(path, "utf8");
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`Checklist is empty: ${path}`);
  }
  return trimmed;
}

export function buildAuditPrompt(checklist: string): string {
  return [
    "你是门窗立面图手稿审图助手。请检查图片是否缺少客户确认单所需信息。",
    "缺失、看不清、表达有歧义的信息都要作为 issues 输出。",
    "",
    "检查清单 Markdown:",
    checklist,
    "",
    "只输出 JSON，不要输出 Markdown。JSON 格式必须是:",
    "{",
    '  "summary": "一句中文摘要",',
    '  "recognized": { "字段名": "识别到的值" },',
    '  "issues": [',
    '    { "id": "1", "severity": "missing|unclear|conflict|info", "message": "缺少或需确认的信息", "evidence": "图中依据", "anchor": { "nx": 0.5, "ny": 0.5 } }',
    "  ],",
    '  "conflicts": [',
    '    { "id": "C1", "message": "疑似冲突", "evidence": "图中依据", "anchor": { "nx": 0.5, "ny": 0.5 } }',
    "  ]",
    "}",
    "",
    "anchor 使用图片归一化坐标，0,0 是左上角，1,1 是右下角。",
    "如果缺项没有明确位置，将 anchor 放到最相关区域；全局性问题放到标题或备注区域。",
    "客户确认单优先检查：房间/位置、窗型名称或编号、数量、总宽、总高、必要分格尺寸、开启方式、开启方向、固定扇位置、执手/合页方向、型材、玻璃具体规格、颜色、五金、纱窗、特殊要求。",
  ].join("\n");
}

export function parseAuditJson(text: string): WindowSketchAuditJson {
  const jsonText = extractJsonObject(text);
  if (!jsonText)
    throw new Error("Audit response did not contain a JSON object.");
  const parsed = JSON.parse(jsonText) as Partial<WindowSketchAuditJson>;
  return normalizeAuditJson(parsed);
}

export function normalizeAuditJson(
  input: Partial<WindowSketchAuditJson>,
): WindowSketchAuditJson {
  const recognized: Record<string, string> = {};
  if (
    input.recognized &&
    typeof input.recognized === "object" &&
    !Array.isArray(input.recognized)
  ) {
    for (const [key, value] of Object.entries(input.recognized)) {
      if (typeof value === "string" && value.trim())
        recognized[key] = value.trim();
    }
  }
  const issues = Array.isArray(input.issues)
    ? input.issues
        .map(normalizeIssue)
        .filter((issue): issue is AuditIssue => issue !== undefined)
    : [];
  const conflicts = Array.isArray(input.conflicts)
    ? input.conflicts
        .map(normalizeConflict)
        .filter((conflict): conflict is AuditConflict => conflict !== undefined)
    : [];
  return {
    summary:
      typeof input.summary === "string" && input.summary.trim()
        ? input.summary.trim()
        : "门窗立面手稿审图",
    recognized,
    issues,
    conflicts,
  };
}

export function readImageSize(bytes: Buffer): ImageSize {
  if (bytes.length >= 24 && bytes.toString("ascii", 1, 4) === "PNG") {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      mime: "image/png",
    };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) throw new Error("Invalid JPEG marker.");
      const marker = bytes[offset + 1];
      const segmentLength = bytes.readUInt16BE(offset + 2);
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return {
          width: bytes.readUInt16BE(offset + 7),
          height: bytes.readUInt16BE(offset + 5),
          mime: "image/jpeg",
        };
      }
      offset += 2 + segmentLength;
    }
  }
  throw new Error("Unsupported image format. Use JPEG or PNG.");
}

export function normalizedToPixel(
  anchor: NormalizedAnchor | undefined,
  size: ImageSize,
): PixelPoint {
  const nx = clamp01(anchor?.nx ?? 0.08);
  const ny = clamp01(anchor?.ny ?? 0.12);
  return {
    x: Math.round(nx * size.width),
    y: Math.round(ny * size.height),
  };
}

export function renderAuditSvg(input: {
  imagePath: string;
  imageBytes: Buffer;
  imageSize: ImageSize;
  audit: WindowSketchAuditJson;
}): string {
  const { imageBytes, imageSize, audit } = input;
  const panelTop = imageSize.height + 24;
  const rows = Math.max(1, audit.issues.length + audit.conflicts.length);
  const panelHeight = 96 + rows * 42;
  const width = Math.max(imageSize.width, 900);
  const height = imageSize.height + panelHeight;
  const imageHref = `data:${imageSize.mime};base64,${imageBytes.toString("base64")}`;
  const issuesSvg = audit.issues
    .map((issue, index) => renderIssueMarker(issue, index + 1, imageSize))
    .join("\n");
  const conflictSvg = audit.conflicts
    .map((conflict, index) =>
      renderConflictMarker(
        conflict,
        audit.issues.length + index + 1,
        imageSize,
      ),
    )
    .join("\n");
  const listItems = [
    ...audit.issues.map((issue, index) => ({
      number: index + 1,
      text: `${severityLabel(issue.severity)}：${issue.message}${issue.evidence ? `（依据：${issue.evidence}）` : ""}`,
    })),
    ...audit.conflicts.map((conflict, index) => ({
      number: audit.issues.length + index + 1,
      text: `疑似冲突：${conflict.message}${conflict.evidence ? `（依据：${conflict.evidence}）` : ""}`,
    })),
  ];
  const listSvg = listItems
    .map((item, index) => {
      const y = panelTop + 74 + index * 42;
      return [
        `<circle cx="34" cy="${y - 7}" r="13" fill="#d71920"/>`,
        `<text x="34" y="${y - 2}" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">${item.number}</text>`,
        `<text x="58" y="${y}" font-size="24" fill="#222">${escapeXml(item.text)}</text>`,
      ].join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow-red" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">
      <path d="M 0 0 L 12 6 L 0 12 z" fill="#d71920"/>
    </marker>
  </defs>
  <rect width="${width}" height="${height}" fill="#f7f7f7"/>
  <image href="${imageHref}" x="0" y="0" width="${imageSize.width}" height="${imageSize.height}" preserveAspectRatio="xMinYMin meet"/>
  ${issuesSvg}
  ${conflictSvg}
  <rect x="0" y="${panelTop}" width="${width}" height="${panelHeight - 24}" fill="#fff" stroke="#d71920" stroke-width="3"/>
  <text x="24" y="${panelTop + 38}" font-size="28" font-weight="700" fill="#d71920">门窗客户确认缺项标注</text>
  <text x="24" y="${panelTop + 64}" font-size="18" fill="#555">${escapeXml(audit.summary)}</text>
  ${listSvg}
</svg>
`;
}

export function formatAuditToolText(result: WindowSketchAuditResult): string {
  const issueLines = result.issues.map(
    (issue, index) =>
      `${index + 1}. ${severityLabel(issue.severity)}: ${issue.message}`,
  );
  const conflictLines = result.conflicts.map(
    (conflict, index) => `C${index + 1}. ${conflict.message}`,
  );
  return [
    `Generated redline SVG: ${result.outputPath}`,
    `Image: ${result.imageSize.width}x${result.imageSize.height}`,
    `Summary: ${result.summary}`,
    "",
    "Recognized:",
    ...Object.entries(result.recognized).map(
      ([key, value]) => `- ${key}: ${value}`,
    ),
    "",
    "Issues:",
    ...(issueLines.length ? issueLines : ["- None"]),
    "",
    "Conflicts:",
    ...(conflictLines.length ? conflictLines : ["- None"]),
  ].join("\n");
}

async function callVisionAudit(
  env: MimoEnv,
  imageBytes: Buffer,
  mime: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<WindowSketchAuditJson> {
  const imageUrl = `data:${mime};base64,${imageBytes.toString("base64")}`;
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a precise door/window sketch audit assistant. Return strict JSON only.",
    },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageUrl } },
        { type: "text", text: prompt },
      ],
    },
  ];
  const response = await fetch(env.chatCompletionsUrl, {
    method: "POST",
    headers: {
      "api-key": env.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.visionModel,
      messages,
      max_completion_tokens: 2048,
      stream: false,
      thinking: { type: "disabled" },
    }),
    signal,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Xiaomi MiMo vision audit failed (${response.status}): ${redactSecrets(body)}`,
    );
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string")
    throw new Error("Xiaomi MiMo response did not contain assistant text.");
  return parseAuditJson(text);
}

function renderIssueMarker(
  issue: AuditIssue,
  number: number,
  size: ImageSize,
): string {
  const point = normalizedToPixel(issue.anchor, size);
  const label = labelPoint(point, size, number);
  return renderMarker(number, point, label, "#d71920");
}

function renderConflictMarker(
  conflict: AuditConflict,
  number: number,
  size: ImageSize,
): string {
  const point = normalizedToPixel(conflict.anchor, size);
  const label = labelPoint(point, size, number);
  return renderMarker(number, point, label, "#b00020");
}

function renderMarker(
  number: number,
  point: PixelPoint,
  label: PixelPoint,
  color: string,
): string {
  return [
    `<line x1="${label.x}" y1="${label.y}" x2="${point.x}" y2="${point.y}" stroke="${color}" stroke-width="4" marker-end="url(#arrow-red)"/>`,
    `<circle cx="${label.x}" cy="${label.y}" r="22" fill="${color}" stroke="#fff" stroke-width="4"/>`,
    `<text x="${label.x}" y="${label.y + 7}" text-anchor="middle" font-size="24" font-weight="700" fill="#fff">${number}</text>`,
  ].join("\n");
}

function labelPoint(
  point: PixelPoint,
  size: ImageSize,
  index: number,
): PixelPoint {
  const side = point.x < size.width * 0.58 ? 1 : -1;
  const stagger = ((index - 1) % 3) * 28;
  return {
    x: clamp(point.x + side * 88, 28, size.width - 28),
    y: clamp(point.y - 48 + stagger, 28, size.height - 28),
  };
}

function normalizeIssue(input: unknown): AuditIssue | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Partial<AuditIssue>;
  if (typeof obj.message !== "string" || !obj.message.trim()) return undefined;
  return {
    id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : "",
    severity: normalizeSeverity(obj.severity),
    message: obj.message.trim(),
    evidence:
      typeof obj.evidence === "string" ? obj.evidence.trim() : undefined,
    anchor: normalizeAnchor(obj.anchor),
  };
}

function normalizeConflict(input: unknown): AuditConflict | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Partial<AuditConflict>;
  if (typeof obj.message !== "string" || !obj.message.trim()) return undefined;
  return {
    id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : undefined,
    message: obj.message.trim(),
    evidence:
      typeof obj.evidence === "string" ? obj.evidence.trim() : undefined,
    anchor: normalizeAnchor(obj.anchor),
  };
}

function normalizeAnchor(input: unknown): NormalizedAnchor | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Partial<NormalizedAnchor>;
  if (typeof obj.nx !== "number" || typeof obj.ny !== "number")
    return undefined;
  return { nx: clamp01(obj.nx), ny: clamp01(obj.ny) };
}

function normalizeSeverity(value: unknown): AuditIssue["severity"] {
  if (
    value === "missing" ||
    value === "unclear" ||
    value === "conflict" ||
    value === "info"
  )
    return value;
  return "unclear";
}

function severityLabel(value: AuditIssue["severity"]): string {
  if (value === "missing") return "缺失";
  if (value === "conflict") return "冲突";
  if (value === "info") return "提示";
  return "需确认";
}

function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  return candidate.slice(start, end + 1);
}

function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function redactSecrets(text: string): string {
  return text.replace(/sk-[a-zA-Z0-9_-]{8,}/g, "sk-REDACTED");
}
