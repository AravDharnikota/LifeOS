import { z } from "zod";
import type { AppContext } from "../app.ts";

/**
 * One tool definition shared by the in-app agent (Anthropic tool use) and the MCP server.
 * - `name`: snake_case, globally unique.
 * - `input`: a zod object schema. Inputs are validated before `handler` runs.
 * - `handler` returns any JSON-serializable value (it is stringified for the model).
 */
export interface ToolContext {
  ctx: AppContext;
  actor: string;
}

export interface ToolDef<I extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>> {
  name: string;
  description: string;
  input: I;
  /** Hint for MCP annotations and for the agent UI. */
  readOnly?: boolean;
  destructive?: boolean;
  /** Which surfaces expose this tool. Default: both. */
  surfaces?: ("agent" | "mcp")[];
  handler: (input: z.infer<I>, tc: ToolContext) => Promise<unknown> | unknown;
}

export function defineTool<I extends z.ZodObject<z.ZodRawShape>>(def: ToolDef<I>): ToolDef<I> {
  return def;
}

/** JSON Schema for a tool input, in the shape Anthropic and MCP expect. */
export function toolInputJsonSchema(def: ToolDef): Record<string, unknown> {
  const js = z.toJSONSchema(def.input, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export async function runTool(def: ToolDef, rawInput: unknown, tc: ToolContext): Promise<{ ok: boolean; result: unknown }> {
  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false, result: { error: "Invalid input", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } };
  try {
    const result = await def.handler(parsed.data, tc);
    return { ok: true, result: result ?? { ok: true } };
  } catch (e) {
    return { ok: false, result: { error: e instanceof Error ? e.message : String(e) } };
  }
}

export function stringifyResult(r: unknown): string {
  if (typeof r === "string") return r;
  return JSON.stringify(r, null, 0);
}
