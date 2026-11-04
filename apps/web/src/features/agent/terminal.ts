/** Pure helpers for the terminal transcript. No React in here so they are trivial to unit test. */

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

function formatValue(v: unknown): string {
  if (v == null) return "null";
  if (typeof v === "string") return JSON.stringify(clip(v.replace(/\s+/g, " ").trim(), 28));
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "object") return "{…}";
  return String(v);
}

/** One line of `key=value` pairs for a tool call: strings quoted and clipped, arrays and objects summarised by shape. */
export function formatToolArgs(input: unknown, max = 72): string {
  if (input == null) return "";
  if (typeof input !== "object") return clip(formatValue(input), max);
  const entries = Object.entries(input as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "";
  return clip(entries.map(([k, v]) => `${k}=${formatValue(v)}`).join(" "), max);
}

/**
 * Where ↑ / ↓ land in the prompt history. The history is newest first; `null` is the live draft.
 * ↑ from the draft goes to entry 0 and stops at the oldest; ↓ from entry 0 returns to the draft.
 */
export function stepHistory(length: number, index: number | null, direction: "older" | "newer"): number | null {
  if (length === 0) return null;
  if (direction === "older") return index === null ? 0 : Math.min(length - 1, index + 1);
  if (index === null || index === 0) return null;
  return index - 1;
}

/** Prompt history from the transcript: user turns, newest first, consecutive duplicates collapsed. */
export function promptHistory(turns: { role: string; text: string }[]): string[] {
  const out: string[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (!t || t.role !== "user") continue;
    const text = t.text.trim();
    if (!text || out[out.length - 1] === text) continue;
    out.push(text);
  }
  return out;
}

/** Elapsed time the way a shell prints it: tenths under a minute, then minutes and seconds. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.floor(s - m * 60)).padStart(2, "0")}s`;
}

/** Status-line summary of a turn's work. */
export function describeWork(toolCount: number, streaming: boolean): string {
  if (toolCount === 0) return streaming ? "thinking" : "";
  return `${toolCount} tool call${toolCount === 1 ? "" : "s"}`;
}
