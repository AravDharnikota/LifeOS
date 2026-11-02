import type { Context } from "hono";
import type { z } from "zod";
import { badRequest } from "./errors.ts";

export async function parseBody<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw badRequest("Invalid JSON body");
  }
  const r = schema.safeParse(json);
  if (!r.success) throw badRequest("Validation failed", r.error.issues);
  return r.data;
}

export function parseQuery<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw badRequest("Invalid query", r.error.issues);
  return r.data;
}
