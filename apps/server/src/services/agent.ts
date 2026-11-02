import type Anthropic from "@anthropic-ai/sdk";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { AgentMessage, AgentThread } from "@aravos/shared";
import type { AppContext } from "../app.ts";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { buildAgentSystemPrompt } from "../ai/agent-prompt.ts";
import { AiDisabledError, type AgentTool, type AgentTurnRequest, type AgentTurnResult } from "../ai/provider.ts";
import { HttpError, badRequest, notFound } from "../lib/errors.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { parseJson } from "../lib/json.ts";
import { runTool, stringifyResult, toolInputJsonSchema, toolsFor, type ToolDef } from "../tools/index.ts";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type ThreadRow = typeof schema.agentThreads.$inferSelect;
type MessageRow = typeof schema.agentMessages.$inferSelect;

export const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

export interface AgentImage {
  base64: string;
  mediaType: ImageMediaType;
}
export interface SendMessageInput {
  text: string;
  images?: AgentImage[];
}
export interface ToolCallSummary {
  name: string;
  input: unknown;
  ok: boolean;
  result: string;
}
export interface SendMessageResult {
  threadId: string;
  message: AgentMessage;
  toolCalls: ToolCallSummary[];
  layoutChanged: boolean;
  changed: string[];
}
export type SendMessageHandlers = Pick<AgentTurnRequest, "onText" | "onToolCall" | "onToolResult">;

export const HISTORY_LIMIT = 40;
export const QUICK_THREAD_TITLE = "Quick";
const TITLE_LENGTH = 40;
const RESULT_PREVIEW = 300;

const serializeThread = (r: ThreadRow): AgentThread => ({ id: r.id, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt });
const serializeMessage = (r: MessageRow): AgentMessage => ({ id: r.id, threadId: r.threadId, role: r.role as AgentMessage["role"], displayText: r.displayText, toolCalls: parseJson(r.toolCalls, []), createdAt: r.createdAt });

function threadRow(db: Db, id: string): ThreadRow {
  const row = db.select().from(schema.agentThreads).where(eq(schema.agentThreads.id, id)).get();
  if (!row) throw notFound("Thread");
  return row;
}

function messageRows(db: Db, threadId: string): MessageRow[] {
  return db.select().from(schema.agentMessages).where(eq(schema.agentMessages.threadId, threadId)).orderBy(asc(schema.agentMessages.createdAt), asc(sql`rowid`)).all();
}

export function listThreads(db: Db): AgentThread[] {
  return db.select().from(schema.agentThreads).orderBy(desc(schema.agentThreads.updatedAt)).all().map(serializeThread);
}

export function createThread(db: Db, title?: string): AgentThread {
  const id = newId();
  db.insert(schema.agentThreads).values({ id, title: title?.trim() || null }).run();
  return serializeThread(threadRow(db, id));
}

export function getThread(db: Db, id: string): AgentThread & { messages: AgentMessage[] } {
  return { ...serializeThread(threadRow(db, id)), messages: messageRows(db, id).map(serializeMessage) };
}

export function deleteThread(db: Db, id: string): void {
  threadRow(db, id);
  db.delete(schema.agentMessages).where(eq(schema.agentMessages.threadId, id)).run();
  db.delete(schema.agentThreads).where(eq(schema.agentThreads.id, id)).run();
}

/** The thread used by one-shot requests; created on first use. */
export function quickThread(db: Db): AgentThread {
  const row = db.select().from(schema.agentThreads).where(eq(schema.agentThreads.title, QUICK_THREAD_TITLE)).orderBy(desc(schema.agentThreads.updatedAt)).get();
  return row ? serializeThread(row) : createThread(db, QUICK_THREAD_TITLE);
}

function touchThread(db: Db, id: string): void {
  db.update(schema.agentThreads).set({ updatedAt: nowIso() }).where(eq(schema.agentThreads.id, id)).run();
}

function autoTitle(db: Db, thread: ThreadRow, text: string): void {
  if (thread.title) return;
  const title = text.replace(/\s+/g, " ").trim().slice(0, TITLE_LENGTH);
  if (title) db.update(schema.agentThreads).set({ title }).where(eq(schema.agentThreads.id, thread.id)).run();
}

function userContent(text: string, images: AgentImage[]): ContentBlockParam[] {
  const blocks: ContentBlockParam[] = images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }));
  if (text) blocks.unshift({ type: "text", text });
  return blocks;
}

function isMessageParam(x: unknown): x is MessageParam {
  return typeof x === "object" && x !== null && "role" in x && "content" in x;
}

/** Stored user rows hold content blocks; stored assistant rows hold the whole tool loop as messages. */
function replayRow(row: MessageRow): MessageParam[] {
  const role = row.role === "assistant" ? "assistant" : "user";
  const parsed = parseJson<unknown>(row.content, null);
  if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isMessageParam)) return parsed.filter((m) => m.role !== "system");
  if (Array.isArray(parsed) && parsed.length > 0) return [{ role, content: parsed as ContentBlockParam[] }];
  if (typeof parsed === "string" && parsed) return [{ role, content: parsed }];
  return row.displayText ? [{ role, content: row.displayText }] : [];
}

function hasBlock(m: MessageParam, type: string): boolean {
  return Array.isArray(m.content) && m.content.some((b) => b.type === type);
}

/** Keep the tail of the history, starting on a plain user message so tool_use/tool_result pairs stay intact. */
export function trimHistory(messages: MessageParam[], limit = HISTORY_LIMIT): MessageParam[] {
  const tail = messages.slice(-limit);
  while (tail.length && !(tail[0]!.role === "user" && !hasBlock(tail[0]!, "tool_result"))) tail.shift();
  return tail;
}

export function buildHistory(db: Db, threadId: string): MessageParam[] {
  return trimHistory(messageRows(db, threadId).flatMap(replayRow));
}

export function agentToolsFor(ctx: AppContext, actor = "agent", defs: ToolDef[] = toolsFor("agent")): AgentTool[] {
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    input_schema: toolInputJsonSchema(def),
    run: async (input) => {
      const r = await runTool(def, input, { ctx, actor });
      const out = stringifyResult(r.result);
      if (!r.ok) throw new Error(out);
      return out;
    },
  }));
}

export function listAgentTools(): { name: string; description: string; readOnly: boolean; destructive: boolean }[] {
  return toolsFor("agent").map((d) => ({ name: d.name, description: d.description, readOnly: Boolean(d.readOnly), destructive: Boolean(d.destructive) }));
}

const KIND_BY_KEYWORD: [string, string][] = [
  ["layout", "layout"],
  ["widget", "layout"],
  ["section", "layout"],
  ["task", "task"],
  ["event", "event"],
  ["calendar", "event"],
  ["schedul", "event"],
  ["timebox", "event"],
  ["goal", "goal"],
  ["habit", "goal"],
  ["milestone", "goal"],
  ["tracker", "tracker"],
  ["meal", "meal"],
  ["food", "meal"],
  ["nutrition", "meal"],
  ["water", "water"],
  ["weight", "weight"],
  ["memor", "memory"],
  ["remember", "memory"],
  ["forget", "memory"],
  ["workout", "workout"],
];
const READ_NAME = /^(get|list|search|find|recall|summar)/;

export function entityKinds(name: string): string[] {
  return [...new Set(KIND_BY_KEYWORD.filter(([kw]) => name.includes(kw)).map(([, kind]) => kind))];
}

export function changedKinds(defs: ToolDef[], calls: AgentTurnResult["toolCalls"]): string[] {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const out = new Set<string>();
  for (const call of calls) {
    if (!call.ok) continue;
    const def = byName.get(call.name);
    if (def?.readOnly || READ_NAME.test(call.name)) continue;
    for (const k of entityKinds(call.name)) out.add(k);
  }
  return [...out];
}

const summarize = (c: AgentTurnResult["toolCalls"][number]): ToolCallSummary => ({ name: c.name, input: c.input, ok: c.ok, result: c.result.slice(0, RESULT_PREVIEW) });

function insertMessage(db: Db, row: { threadId: string; role: "user" | "assistant"; content: unknown; displayText: string | null; toolCalls?: ToolCallSummary[] }): MessageRow {
  const id = newId();
  db.insert(schema.agentMessages).values({ id, threadId: row.threadId, role: row.role, content: JSON.stringify(row.content), displayText: row.displayText, toolCalls: JSON.stringify(row.toolCalls ?? []) }).run();
  touchThread(db, row.threadId);
  return db.select().from(schema.agentMessages).where(eq(schema.agentMessages.id, id)).get()!;
}

export async function sendMessage(ctx: AppContext, threadId: string, input: SendMessageInput, handlers: SendMessageHandlers = {}): Promise<SendMessageResult> {
  if (!ctx.ai.enabled) throw new HttpError(503, new AiDisabledError().message);
  const { db } = ctx;
  const thread = threadRow(db, threadId);
  const text = input.text.trim();
  const images = input.images ?? [];
  if (!text && images.length === 0) throw badRequest("Message is empty");

  insertMessage(db, { threadId, role: "user", content: userContent(text, images), displayText: text });
  autoTitle(db, thread, text || "Image");

  const defs = toolsFor("agent");
  const result = await ctx.ai.runAgentTurn({
    system: buildAgentSystemPrompt(ctx),
    messages: buildHistory(db, threadId),
    tools: agentToolsFor(ctx, "agent", defs),
    onText: handlers.onText,
    onToolCall: handlers.onToolCall,
    onToolResult: handlers.onToolResult,
  });

  const toolCalls = result.toolCalls.map(summarize);
  const stored = result.newMessages.length ? result.newMessages : [{ role: "assistant" as const, content: result.text }];
  const row = insertMessage(db, { threadId, role: "assistant", content: stored, displayText: result.text, toolCalls });
  const changed = changedKinds(defs, result.toolCalls);
  return { threadId, message: serializeMessage(row), toolCalls, layoutChanged: changed.includes("layout"), changed };
}
