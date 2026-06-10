import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildAuditPrompt,
  normalizedToPixel,
  parseAuditJson,
  readChecklist,
  readImageSize,
  renderAuditSvg,
  type WindowSketchAuditJson,
} from "../.pi/extensions/window-sketch-audit/src/audit.ts";

const sampleImagePath = "sample-window-sketch.jpg";
const sampleJpegBytes = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffc000110805d3041f03011100021100031100ffd9",
  "hex",
);

test("reads Markdown checklist and builds audit prompt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "window-audit-"));
  const path = join(dir, "checklist.md");
  await writeFile(path, "# 清单\n\n- 数量\n- 玻璃规格", "utf8");

  const checklist = await readChecklist(path);
  const prompt = buildAuditPrompt(checklist);
  assert.match(prompt, /数量/);
  assert.match(prompt, /玻璃规格/);
  assert.match(prompt, /只输出 JSON/);
});

test("parseAuditJson accepts fenced JSON and normalizes anchors", () => {
  const parsed = parseAuditJson(`\`\`\`json
{
  "summary": "主卧窗信息基本完整，但有缺项",
  "recognized": {"宽": "2400", "高": "1500"},
  "issues": [
    {"id":"1","severity":"missing","message":"缺少数量","evidence":"图中未见数量","anchor":{"nx":1.3,"ny":-1}}
  ],
  "conflicts": []
}
\`\`\``);

  assert.equal(parsed.summary, "主卧窗信息基本完整，但有缺项");
  assert.equal(parsed.recognized["宽"], "2400");
  assert.equal(parsed.issues[0].severity, "missing");
  assert.deepEqual(parsed.issues[0].anchor, { nx: 1, ny: 0 });
});

test("parseAuditJson rejects invalid JSON", () => {
  assert.throws(() => parseAuditJson("not json"), /JSON object/);
});

test("readImageSize reads PNG dimensions", () => {
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d494844520000000200000003080600000000000000000000000049454e44ae426082",
    "hex",
  );
  const size = readImageSize(png);
  assert.deepEqual(size, { width: 2, height: 3, mime: "image/png" });
});

test("readImageSize reads the provided JPG dimensions when available", async () => {
  const size = readImageSize(sampleJpegBytes);
  assert.equal(size.width, 1055);
  assert.equal(size.height, 1491);
  assert.equal(size.mime, "image/jpeg");
});

test("normalizedToPixel scales anchors by actual image size", () => {
  const point = normalizedToPixel(
    { nx: 0.5, ny: 0.25 },
    { width: 1055, height: 1491, mime: "image/jpeg" },
  );
  assert.deepEqual(point, { x: 528, y: 373 });
});

test("renderAuditSvg includes image, red markers, arrows, and issue list", async () => {
  const imageBytes = sampleJpegBytes;
  const imageSize = readImageSize(imageBytes);
  const audit: WindowSketchAuditJson = {
    summary: "测试审图",
    recognized: { 宽: "2400" },
    issues: [
      {
        id: "1",
        severity: "missing",
        message: "缺少数量或窗型编号",
        evidence: "图中未见数量",
        anchor: { nx: 0.35, ny: 0.84 },
      },
      {
        id: "2",
        severity: "unclear",
        message: "玻璃缺少具体规格",
        evidence: "仅写双层中空",
        anchor: { nx: 0.24, ny: 0.79 },
      },
    ],
    conflicts: [
      {
        id: "C1",
        message: "执手/合页方向需分别确认",
        anchor: { nx: 0.78, ny: 0.78 },
      },
    ],
  };

  const svg = renderAuditSvg({
    imagePath: sampleImagePath,
    imageBytes,
    imageSize,
    audit,
  });
  assert.match(svg, /<svg/);
  assert.match(svg, /data:image\/jpeg;base64/);
  assert.match(svg, /marker-end="url\(#arrow-red\)"/);
  assert.match(svg, /缺少数量或窗型编号/);
  assert.match(svg, /玻璃缺少具体规格/);
  assert.match(svg, /执手\/合页方向需分别确认/);
});
