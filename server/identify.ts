import { ApiError, GoogleGenAI } from "@google/genai";
import type { Plugin, Connect } from "vite";
import fs from "node:fs";
import path from "node:path";

export const SHAPES = ["rectangle", "circle", "triangle", "diamond", "star", "other"] as const;
export interface AiShape {
  shape: (typeof SHAPES)[number];
  /** Outline traced along the drawn line, normalized image coords (0..1, [x, y]), clockwise. */
  points: [number, number][];
  /** Handwritten text inside the shape (e.g. "F#", "kick"), or "". */
  label: string;
}

// Gemini is trained to give image positions as [y, x] on a 0–1000 grid, so we ask in that form.
const SCHEMA = {
  type: "object",
  required: ["shapes"],
  properties: {
    shapes: {
      type: "array",
      items: {
        type: "object",
        required: ["shape", "points", "label"],
        properties: {
          shape: { type: "string", enum: [...SHAPES] },
          points: {
            type: "array",
            minItems: 3,
            maxItems: 16,
            items: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
          },
          label: { type: "string" },
        },
      },
    },
  },
};

const PROMPT = `This is a camera photo, usually taken at a steep angle (a laptop webcam looking down at a sheet of paper on a desk), of shapes someone DREW by hand with a pen, pencil or marker to make a music controller.

Find every hand-drawn closed shape. Ignore everything printed or physical: ruled notebook lines, margin lines, punched binder holes (small filled circles near the paper edge), torn spiral edges, shadows, the keyboard, the desk, hands.

For each drawn shape return:
- shape: rectangle (any 4-sided box, including slanted/trapezoid-looking ones from perspective), circle (circles and ovals), triangle, diamond (a square or rhombus standing on a corner), star, or other.
- points: the outline as it appears in THIS image (keep the perspective, never straighten), as [y, x] on the 0-1000 grid, clockwise. Put points exactly ON the drawn pencil/pen line, at the centre of the stroke.
  rectangle: its 4 corners. triangle: its 3 corners. diamond: its 4 corners. star: its 10 tip and inner points. circle/other: 12 points evenly spaced along the line.
- label: letters, note names or words written INSIDE the shape, copied exactly (e.g. "C", "F#", "Bb4", "kick"); "" if none. Do not invent a label.

Shapes that touch must keep their own outlines. If nothing is drawn, return an empty list.`;

/** One Gemini vision call: camera JPEG (base64) -> drawn shapes. */
export async function identifyShapes(
  ai: GoogleGenAI,
  model: string,
  jpegBase64: string,
): Promise<{ shapes: AiShape[]; inTokens: number; outTokens: number }> {
  const response = await ai.models.generateContent({
    model,
    contents: [
      { inlineData: { mimeType: "image/jpeg", data: jpegBase64 } },
      { text: PROMPT },
    ],
    config: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, temperature: 0 },
  });
  if (!response.text) throw new Error("The AI returned no shapes.");
  const shapes: { shape: AiShape["shape"]; points: number[][]; label: string }[] =
    JSON.parse(response.text).shapes ?? [];
  // [y, x] on 0–1000 -> [x, y] on 0–1. aiToControls validates the rest.
  const u = response.usageMetadata;
  return {
    shapes: shapes.map((s) => ({
      ...s,
      points: (s.points ?? []).map(([y, x]) => [x / 1000, y / 1000] as [number, number]),
    })),
    inTokens: u?.promptTokenCount ?? 0,
    // Thinking tokens are billed as output.
    outTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
  };
}

// US$ per 1M tokens [input, output], paid tier (flash-lite-latest = gemini-3.5-flash-lite, Nov 2026).
// shortcut: unknown models are priced like flash-lite; add a row if you switch GEMINI_MODEL.
const PRICES: Record<string, [number, number]> = { "gemini-flash-lite-latest": [0.3, 2.5] };
const USAGE_FILE = path.resolve(".gemini-usage.json");
export interface Usage { scans: number; inTokens: number; outTokens: number; costUsd: number }

function readUsage(): Usage {
  try {
    return { scans: 0, inTokens: 0, outTokens: 0, costUsd: 0, ...JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) };
  } catch {
    return { scans: 0, inTokens: 0, outTokens: 0, costUsd: 0 };
  }
}

/** Adds one call to the running total kept in .gemini-usage.json (survives restarts). */
export function addUsage(prev: Usage, model: string, inTokens: number, outTokens: number): Usage {
  const [pin, pout] = PRICES[model] ?? PRICES["gemini-flash-lite-latest"];
  return {
    scans: prev.scans + 1,
    inTokens: prev.inTokens + inTokens,
    outTokens: prev.outTokens + outTokens,
    costUsd: prev.costUsd + (inTokens * pin + outTokens * pout) / 1e6,
  };
}

function readBody(req: Connect.IncomingMessage, limit = 8_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) reject(new Error("Image too large."));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** POST /api/identify — keeps the API key on the local dev/preview server, never in the browser. */
export function identifyPlugin(apiKey: string | undefined, model = "gemini-flash-lite-latest"): Plugin {
  const budgetUsd = 5; // prepaid credit on the current key
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const reply = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/usage") return reply(200, { ...readUsage(), budgetUsd, ai: !!apiKey });
    if (req.url !== "/api/identify") return next();
    if (req.method !== "POST") return reply(405, { error: "POST only." });
    if (!apiKey) return reply(501, { error: "AI is off: add GEMINI_API_KEY to .env.local and restart." });
    try {
      const { image } = JSON.parse(await readBody(req));
      if (typeof image !== "string" || !image.startsWith("data:image/jpeg;base64,"))
        return reply(400, { error: "Expected a JPEG data URL." });
      const ai = new GoogleGenAI({ apiKey, apiVersion: "v1beta", httpOptions: { timeout: 45_000 } });
      const data = image.slice("data:image/jpeg;base64,".length);
      // A busy or missing model shouldn't kill a live demo: fall through to the next one.
      const models = [...new Set([model, "gemini-flash-lite-latest"])];
      for (const [i, m] of models.entries()) {
        try {
          const r = await identifyShapes(ai, m, data);
          const usage = addUsage(readUsage(), m, r.inTokens, r.outTokens);
          try {
            fs.writeFileSync(USAGE_FILE, JSON.stringify(usage));
          } catch (e) {
            console.warn("[identify] could not save usage:", e);
          }
          return reply(200, { shapes: r.shapes, model: m, usage: { ...usage, budgetUsd } });
        } catch (e) {
          // Bad key/request won't fix itself on another model; busy, missing or timed-out will.
          const fatal = e instanceof ApiError && [400, 401, 403].includes(e.status);
          if (fatal || i === models.length - 1) throw e;
          console.warn(`[identify] ${m} failed, trying next model:`, (e as Error).message.slice(0, 120));
        }
      }
    } catch (e) {
      reply(502, { error: e instanceof Error ? e.message : "AI request failed." });
    }
  };
  return {
    name: "paperpilot-identify",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}
