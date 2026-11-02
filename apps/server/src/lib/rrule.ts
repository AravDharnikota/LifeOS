import rrulePkg from "rrule";
import type { RRule as RRuleType } from "rrule";
import { badRequest } from "./errors.ts";

const { RRule, rrulestr } = rrulePkg;
const ALLOWED_FREQ = new Set([RRule.YEARLY, RRule.MONTHLY, RRule.WEEKLY, RRule.DAILY]);

/** Validate a user-supplied recurrence rule. Only one RRULE line with a daily or coarser frequency. */
export function validateRrule(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = input.trim();
  if (!s) return null;
  if (s.length > 500 || /[\r\n]/.test(s)) throw badRequest("Recurrence must be a single RRULE line");
  const text = s.startsWith("RRULE:") ? s : `RRULE:${s}`;
  let rule: RRuleType;
  try {
    const parsed = rrulestr(text);
    if (!(parsed instanceof RRule) || parsed.constructor !== RRule) throw new Error("not a plain rule");
    rule = parsed;
  } catch {
    throw badRequest("Recurrence rule is not valid");
  }
  if (!ALLOWED_FREQ.has(rule.options.freq)) throw badRequest("Recurrence must repeat daily, weekly, monthly or yearly");
  if ((rule.options.interval ?? 1) < 1) throw badRequest("Recurrence interval must be at least 1");
  return text.replace(/^RRULE:/, "");
}

/** Build a rule anchored at dtstart from a stored (validated) rrule string. */
export function buildRule(stored: string, dtstart: Date): RRuleType {
  const parsed = rrulestr(stored.startsWith("RRULE:") ? stored : `RRULE:${stored}`, { dtstart });
  return parsed instanceof RRule ? parsed : new RRule({ ...(parsed as RRuleType).origOptions, dtstart });
}

/** Occurrences within [from, to], capped. */
export function occurrencesBetween(rule: RRuleType, from: Date, to: Date, cap = 400): Date[] {
  const out: Date[] = [];
  rule.between(from, to, true, (d, i) => {
    out.push(d);
    return i < cap - 1;
  });
  return out;
}
