import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { defineTool, type ToolDef } from "./types.ts";

export const MemoryKind = z.enum(["fact", "preference", "pattern"]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

type Row = typeof schema.memories.$inferSelect;

const serialize = (r: Row): Memory => ({ id: r.id, kind: r.kind as MemoryKind, content: r.content, source: r.source, createdAt: r.createdAt, updatedAt: r.updatedAt });

export function listMemories(db: Db): Memory[] {
  return db.select().from(schema.memories).orderBy(desc(schema.memories.updatedAt)).all().map(serialize);
}

export function recallMemories(db: Db, query: string | undefined, limit = 20): Memory[] {
  const all = listMemories(db);
  const words = (query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return all.slice(0, limit);
  const scored = all
    .map((m) => ({ m, score: words.filter((w) => m.content.toLowerCase().includes(w)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.m.updatedAt.localeCompare(a.m.updatedAt));
  return scored.slice(0, limit).map((s) => s.m);
}

export function rememberMemory(db: Db, input: { content: string; kind?: MemoryKind }, source = "agent"): { memory: Memory; duplicate: boolean } {
  const content = input.content.trim();
  const existing = listMemories(db).find((m) => m.content.toLowerCase() === content.toLowerCase());
  if (existing) {
    db.update(schema.memories).set({ kind: input.kind ?? existing.kind, updatedAt: nowIso() }).where(eq(schema.memories.id, existing.id)).run();
    return { memory: { ...existing, kind: input.kind ?? existing.kind }, duplicate: true };
  }
  const id = newId();
  db.insert(schema.memories).values({ id, kind: input.kind ?? "fact", content, source }).run();
  const row = db.select().from(schema.memories).where(eq(schema.memories.id, id)).get();
  if (!row) throw new Error("Memory was not saved");
  return { memory: serialize(row), duplicate: false };
}

export function forgetMemory(db: Db, id: string): Memory {
  const row = db.select().from(schema.memories).where(eq(schema.memories.id, id)).get();
  if (!row) throw new Error(`No memory with id ${id}`);
  db.delete(schema.memories).where(eq(schema.memories.id, id)).run();
  return serialize(row);
}

const remember = defineTool({
  name: "remember",
  description: "Store a durable fact, preference or pattern about the user so future conversations know it. Use it when the user states something lasting about themselves (for example: works out in the mornings, is vegetarian, hates early meetings). Not for one-off tasks or events.",
  input: z.object({
    content: z.string().trim().min(1).max(500).describe("One sentence, written in the third person, e.g. 'Arav prefers to work out before 8am'."),
    kind: MemoryKind.optional().describe("fact (default), preference, or pattern (a recurring behaviour you noticed)."),
  }),
  handler: (input, tc) => rememberMemory(tc.ctx.db, input, tc.actor),
});

const recall = defineTool({
  name: "recall",
  description: "Search stored memories about the user. All memories are already in your context, so only call this when you need to find an id or check for something specific.",
  input: z.object({
    query: z.string().max(200).optional().describe("Words to look for. Omit to list the most recent memories."),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  readOnly: true,
  handler: (input, tc) => ({ memories: recallMemories(tc.ctx.db, input.query, input.limit ?? 20) }),
});

const forget = defineTool({
  name: "forget",
  description: "Delete one stored memory by id. Use list_memories or recall to find the id first.",
  input: z.object({ id: z.string().min(1) }),
  destructive: true,
  handler: (input, tc) => ({ forgotten: forgetMemory(tc.ctx.db, input.id) }),
});

const list = defineTool({
  name: "list_memories",
  description: "List every stored memory with its id and kind.",
  input: z.object({}),
  readOnly: true,
  handler: (_input, tc) => ({ memories: listMemories(tc.ctx.db) }),
});

export const memoryTools: ToolDef[] = [remember, recall, forget, list] as ToolDef[];
