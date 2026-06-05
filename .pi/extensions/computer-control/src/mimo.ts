import { readFile } from "node:fs/promises";
import type { MimoEnv } from "./env.js";

type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | {
      role: "user";
      content:
        | string
        | Array<
            | { type: "text"; text: string }
            | { type: "image_url"; image_url: { url: string } }
          >;
    };

export type MimoUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type MimoClientResult<TDetails extends Record<string, unknown>> = {
  text: string;
  details: TDetails & {
    model: string;
    usage?: MimoUsage;
  };
};

export async function mimoTextClient(
  env: MimoEnv,
  prompt: string,
  signal?: AbortSignal,
): Promise<MimoClientResult<{ route: "text" }>> {
  const text = await callMimoChat(
    env,
    env.textModel,
    [
      {
        role: "system",
        content:
          "You are MiMo, an AI assistant developed by Xiaomi. Respond concisely and accurately.",
      },
      { role: "user", content: prompt },
    ],
    signal,
  );

  return {
    text: text.text,
    details: { route: "text", model: env.textModel, usage: text.usage },
  };
}

export async function mimoVisionClient(
  env: MimoEnv,
  imagePath: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<
  MimoClientResult<{
    route: "vision";
    imagePath: string;
    parsed?: ScreenDescription;
  }>
> {
  const image = await readFile(imagePath);
  const imageUrl = `data:image/png;base64,${image.toString("base64")}`;

  const result = await callMimoChat(
    env,
    env.visionModel,
    [
      {
        role: "system",
        content:
          "You are MiMo, an AI assistant developed by Xiaomi. Return screen descriptions as JSON when requested.",
      },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: prompt },
        ],
      },
    ],
    signal,
  );

  return {
    text: result.text,
    details: {
      route: "vision",
      model: env.visionModel,
      imagePath,
      usage: result.usage,
      parsed: parseScreenDescription(result.text),
    },
  };
}

export type ScreenDescription = {
  summary: string;
  visible_text: string[];
  suggested_actions: string[];
  coordinates: Array<{
    label: string;
    x?: number;
    y?: number;
    nx?: number;
    ny?: number;
  }>;
};

export function buildScreenDescriptionPrompt(prompt: string): string {
  return [
    prompt,
    "",
    "Return a compact JSON object with exactly these keys:",
    "- summary: string",
    "- visible_text: string[]",
    "- suggested_actions: string[]",
    "- coordinates: array of { label: string, nx: number, ny: number, x: number, y: number } for relevant visible UI targets",
    "Prefer normalized coordinates nx and ny in the range 0..1, where 0,0 is the top-left of the captured image and 1,1 is the bottom-right.",
    "Also include best-effort pixel x and y relative to the captured image when possible.",
  ].join("\n");
}

export function parseScreenDescription(text: string): ScreenDescription | undefined {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return undefined;

  try {
    const parsed = JSON.parse(jsonText) as Partial<ScreenDescription>;
    if (typeof parsed.summary !== "string") return undefined;
    if (!Array.isArray(parsed.visible_text)) return undefined;
    if (!Array.isArray(parsed.suggested_actions)) return undefined;
    if (!Array.isArray(parsed.coordinates)) return undefined;
    return {
      summary: parsed.summary,
      visible_text: parsed.visible_text.filter((item): item is string => typeof item === "string"),
      suggested_actions: parsed.suggested_actions.filter(
        (item): item is string => typeof item === "string",
      ),
      coordinates: parsed.coordinates
        .filter(
          (
            item,
          ): item is { label: string; x?: number; y?: number; nx?: number; ny?: number } =>
            item !== null &&
            typeof item === "object" &&
            typeof item.label === "string" &&
            ((typeof item.x === "number" && typeof item.y === "number") ||
              (typeof item.nx === "number" && typeof item.ny === "number")),
        )
        .map((item) => {
          const coordinate: { label: string; x?: number; y?: number; nx?: number; ny?: number } = {
            label: item.label,
          };
          if (typeof item.x === "number") coordinate.x = item.x;
          if (typeof item.y === "number") coordinate.y = item.y;
          if (typeof item.nx === "number") coordinate.nx = item.nx;
          if (typeof item.ny === "number") coordinate.ny = item.ny;
          return coordinate;
        }),
    };
  } catch {
    return undefined;
  }
}

async function callMimoChat(
  env: MimoEnv,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<{ text: string; usage?: MimoUsage }> {
  const response = await fetch(env.chatCompletionsUrl, {
    method: "POST",
    headers: {
      "api-key": env.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: 1024,
      stream: false,
      thinking: { type: "disabled" },
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Xiaomi MiMo request failed (${response.status}): ${redactSecrets(body)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: MimoUsage;
  };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error("Xiaomi MiMo response did not contain assistant text.");
  }
  return { text, usage: data.usage };
}

function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  return candidate.slice(start, end + 1);
}

function redactSecrets(text: string): string {
  return text.replace(/sk-[a-zA-Z0-9_-]{8,}/g, "sk-REDACTED");
}
