import type Anthropic from "@anthropic-ai/sdk";
import type { BodyComparisonRequest, DurationEstimateRequest, FoodAnalysisRequest } from "./provider.ts";

export const FOOD_SYSTEM_PROMPT = `You are the nutrition analyst inside AravOS, a personal health app for one user.
Given a photo and/or a text description of food, identify every distinct item, estimate the portion in grams using plate size, utensils, hands, and packaging as references, and estimate nutrition per item.
Rules:
- Prefer USDA-style reference values. Round calories to the nearest 5 and macros to one decimal.
- If something is ambiguous (sauce, oil, dressing, cooking method), make the most likely assumption and say so in notes. Do not refuse to estimate.
- Packaged items with a visible label: read the label and use it.
- confidence is 0 to 1 per item: how sure you are about identity and portion.
- healthScore is 0 to 10 for this meal relative to a balanced diet (whole foods, protein, fiber, low added sugar and sodium).
- mealType: infer from the food and the local time given.
- notes: one or two short sentences, no exclamation marks, no emoji.
- mealName: a short label like "Chicken burrito bowl".
Return only the JSON object.`;

export function foodUserContent(req: FoodAnalysisRequest): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.image) blocks.push({ type: "image", source: { type: "base64", media_type: req.image.mediaType, data: req.image.base64 } });
  const lines = [`Local time: ${req.localTime}.`];
  if (req.text) lines.push(`Description: ${req.text}`);
  if (req.correction) lines.push(`Previous analysis: ${JSON.stringify(req.correction.previous)}`, `User correction: ${req.correction.note}. Re-estimate everything with this correction applied and keep items the user did not mention.`);
  if (!req.image && !req.text) lines.push("No image or description was provided.");
  blocks.push({ type: "text", text: lines.join("\n") });
  return blocks;
}

export const BODY_SYSTEM_PROMPT = `You help one person track physical progress from photos they took of themselves. Compare the current photo with the previous one (if given) and describe visible changes honestly and specifically: muscle definition, waist and shoulder proportions, posture, overall leanness. Account for lighting, pose, distance, and clothing differences before attributing a change to the body; say when a difference might be due to those.
Rules:
- No medical claims, no body-fat percentages, no diagnoses, no comments on attractiveness.
- Be concrete and neutral. Two to four observations. One summary sentence.
- progressScore: -2 (clearly regressed), -1, 0 (no visible change), 1, 2 (clearly progressed) relative to the previous photo, or null if there is no previous photo.
Return only the JSON object.`;

export function bodyUserContent(req: BodyComparisonRequest): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.previous) {
    blocks.push({ type: "text", text: `Previous photo, taken ${req.previous.date}${req.previous.weightKg ? ` at ${req.previous.weightKg} kg` : ""}:` });
    blocks.push({ type: "image", source: { type: "base64", media_type: req.previous.mediaType, data: req.previous.base64 } });
  }
  blocks.push({ type: "text", text: `Current photo, taken ${req.current.date}${req.current.weightKg ? ` at ${req.current.weightKg} kg` : ""}:` });
  blocks.push({ type: "image", source: { type: "base64", media_type: req.current.mediaType, data: req.current.base64 } });
  blocks.push({ type: "text", text: req.goal ? `The user's stated goal: ${req.goal}.` : "No stated goal." });
  return blocks;
}

export const DURATION_SYSTEM_PROMPT = `You estimate how many minutes each task will take for one specific person. You are given their history of estimated vs actual durations for similar tasks. Use it: if they consistently take longer than estimated, scale up. Return realistic working-time estimates in minutes (multiples of 5, between 10 and 480). Return only the JSON object.`;

export function durationUserContent(req: DurationEstimateRequest): string {
  const hist = req.history.slice(0, 60).map((h) => `- "${h.title}": estimated ${h.estimateMinutes ?? "?"}, actual ${h.actualMinutes}`).join("\n") || "(no history yet)";
  const tasks = req.tasks.map((t) => `- id=${t.id} "${t.title}"${t.notes ? ` notes: ${t.notes.slice(0, 200)}` : ""}${t.tags?.length ? ` tags: ${t.tags.join(", ")}` : ""}`).join("\n");
  return `History:\n${hist}\n\nTasks to estimate:\n${tasks}`;
}
