import * as chrono from "chrono-node";
import { toDateString } from "./dates.ts";

export interface ParsedTaskInput {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: number;
  estimateMinutes: number | null;
  tags: string[];
}

/**
 * Parse quick-capture text like:
 *   "Call dentist tomorrow 4pm !high 30m #health"
 * Natural language dates are removed from the title; chips (!p, 30m, #tag) are extracted.
 */
export function parseTaskInput(raw: string, now = new Date()): ParsedTaskInput {
  let text = raw.trim();
  let priority = 0;
  let estimateMinutes: number | null = null;
  const tags: string[] = [];

  text = text.replace(/(^|\s)!(high|h|3)\b/i, (_m, p) => { priority = 3; return p; });
  text = text.replace(/(^|\s)!(med|medium|m|2)\b/i, (_m, p) => { priority = Math.max(priority, 2); return p; });
  text = text.replace(/(^|\s)!(low|l|1)\b/i, (_m, p) => { priority = Math.max(priority, 1); return p; });
  text = text.replace(/(^|\s)~?(\d+(?:\.\d+)?)\s?(h|hr|hrs|hours?)\b(?:\s?(\d+)\s?(m|min|mins)\b)?/i, (_m, p, h, _u, m) => {
    estimateMinutes = Math.round(Number(h) * 60 + (m ? Number(m) : 0));
    return p;
  });
  if (estimateMinutes == null) {
    text = text.replace(/(^|\s)~?(\d+)\s?(m|min|mins|minutes?)\b/i, (_m, p, m) => { estimateMinutes = Number(m); return p; });
  }
  text = text.replace(/(^|\s)#([\w-]+)/g, (_m, p, t) => { tags.push(String(t).toLowerCase()); return p; });

  let dueDate: string | null = null;
  let dueTime: string | null = null;
  const results = chrono.parse(text, now, { forwardDate: true });
  const r = results[0];
  if (r) {
    const d = r.start.date();
    dueDate = toDateString(d);
    if (r.start.isCertain("hour")) {
      dueTime = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    text = (text.slice(0, r.index) + " " + text.slice(r.index + r.text.length)).replace(/\s+(at|on|by|due)\s*$/i, "");
  }
  const title = text.replace(/\s{2,}/g, " ").replace(/\s+(at|on|by|due)$/i, "").trim();
  return { title, dueDate, dueTime, priority, estimateMinutes, tags };
}
