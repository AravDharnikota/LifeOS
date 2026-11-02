import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { z } from "zod";
import type { App } from "../app.ts";
import { AiDisabledError } from "../ai/provider.ts";
import { HttpError } from "../lib/errors.ts";
import { parseBody } from "../lib/http.ts";
import { createThread, deleteThread, getThread, IMAGE_MEDIA_TYPES, listAgentTools, listThreads, quickThread, sendMessage, type SendMessageHandlers } from "../services/agent.ts";

const ThreadBody = z.object({ title: z.string().trim().max(120).optional() });
const MessageBody = z.object({
  text: z.string().max(20000).default(""),
  images: z.array(z.object({ base64: z.string().min(1).max(8_000_000), mediaType: z.enum(IMAGE_MEDIA_TYPES) })).max(4).optional(),
});
const QuickBody = z.object({ text: z.string().trim().min(1).max(20000) });

/** Serialises SSE writes so events reach the client in the order they were produced. */
function emitter(stream: SSEStreamingApi): { emit: (event: string, data: unknown) => void; flush: () => Promise<void> } {
  let queue = Promise.resolve();
  const emit = (event: string, data: unknown) => {
    queue = queue.then(() => stream.writeSSE({ event, data: JSON.stringify(data) })).catch(() => undefined);
  };
  return { emit, flush: () => queue };
}

export function agentRoutes(app: App): void {
  app.get("/api/agent/threads", (c) => c.json(listThreads(c.get("ctx").db)));
  app.post("/api/agent/threads", async (c) => c.json(createThread(c.get("ctx").db, (await parseBody(c, ThreadBody)).title), 201));
  app.get("/api/agent/threads/:id", (c) => c.json(getThread(c.get("ctx").db, c.req.param("id"))));
  app.delete("/api/agent/threads/:id", (c) => {
    deleteThread(c.get("ctx").db, c.req.param("id"));
    return c.json({ ok: true });
  });
  app.get("/api/agent/tools", (c) => c.json(listAgentTools()));

  app.post("/api/agent/quick", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, QuickBody);
    return c.json(await sendMessage(ctx, quickThread(ctx.db).id, body));
  });

  app.post("/api/agent/threads/:id/messages", async (c) => {
    const ctx = c.get("ctx");
    const threadId = c.req.param("id");
    const body = await parseBody(c, MessageBody);
    if (c.req.query("stream") === "false") return c.json(await sendMessage(ctx, threadId, body));
    // Fail before the stream opens so the client sees a real status code.
    if (!ctx.ai.enabled) throw new HttpError(503, new AiDisabledError().message);
    getThread(ctx.db, threadId);
    return streamSSE(c, async (stream) => {
      const { emit, flush } = emitter(stream);
      const handlers: SendMessageHandlers = {
        onText: (delta) => emit("text", { delta }),
        onToolCall: (call) => emit("tool_call", { name: call.name, input: call.input }),
        onToolResult: (r) => emit("tool_result", { name: r.name, ok: r.ok, summary: r.result.slice(0, 300) }),
      };
      try {
        emit("done", await sendMessage(ctx, threadId, body, handlers));
      } catch (e) {
        emit("error", { message: e instanceof Error ? e.message : String(e) });
      }
      await flush();
    });
  });
}
