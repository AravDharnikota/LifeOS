import { describe, it, expect, afterAll } from "vitest";
import type { AgentMessage, AgentThread, Layout, Tracker } from "@aravos/shared";
import { disabledProvider, type AgentTurnRequest, type AgentTurnResult } from "../src/ai/provider.ts";
import { runTool } from "../src/tools/types.ts";
import { layoutTools } from "../src/tools/layout.ts";
import { agentToolsFor, trimHistory, type SendMessageResult } from "../src/services/agent.ts";
import { makeTestApp } from "./helpers.ts";

const t = makeTestApp();
afterAll(() => t.cleanup());

type Thread = AgentThread & { messages: AgentMessage[] };
type ToolOutcome = { result: string; ok: boolean };

function reply(text: string): AgentTurnResult {
  return { text, content: [{ type: "text", text, citations: null }], newMessages: [{ role: "assistant", content: [{ type: "text", text }] }], toolCalls: [], stopReason: "end_turn" };
}

/** Runs a tool the way the real provider does, including the stream callbacks. */
async function useTool(req: AgentTurnRequest, name: string, input: unknown): Promise<ToolOutcome> {
  const tool = req.tools.find((x) => x.name === name);
  if (!tool) throw new Error(`tool ${name} missing`);
  req.onToolCall?.({ name, input });
  let result = "";
  let ok = true;
  try {
    result = await tool.run(input);
  } catch (e) {
    ok = false;
    result = e instanceof Error ? e.message : String(e);
  }
  req.onToolResult?.({ name, input, result, ok });
  return { result, ok };
}

function toolTurn(name: string, input: unknown, outcome: ToolOutcome, text: string): AgentTurnResult {
  const id = `toolu_${name}`;
  return {
    text,
    content: [{ type: "text", text, citations: null }],
    newMessages: [
      { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: outcome.result, is_error: !outcome.ok }] },
      { role: "assistant", content: [{ type: "text", text }] },
    ],
    toolCalls: [{ name, input, result: outcome.result, ok: outcome.ok }],
    stopReason: "end_turn",
  };
}
function parseSse(body: string): { event: string; data: unknown }[] {
  return body
    .split("\n\n")
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const lines = chunk.split("\n");
      const event = lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "message";
      const data = lines.filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
      return { event, data: JSON.parse(data) as unknown };
    });
}

async function newThread(title?: string): Promise<AgentThread> {
  return (await t.api<AgentThread>("POST", "/api/agent/threads", title ? { title } : {})).data;
}

async function send(threadId: string, text: string, extra: Record<string, unknown> = {}): Promise<SendMessageResult> {
  return (await t.api<SendMessageResult>("POST", `/api/agent/threads/${threadId}/messages?stream=false`, { text, ...extra })).data;
}

describe("agent threads", () => {
  it("plain reply persists both messages and auto-titles the thread", async () => {
    t.ai.agentHandler = async (req) => {
      expect(req.system).toContain("AravOS");
      expect(req.system).toContain("Dashboard layout");
      return reply("Nothing due. Enjoy the afternoon.");
    };
    const thread = await newThread();
    expect(thread.title).toBeNull();
    const r = await send(thread.id, "What is left today, and is there anything I forgot about?");
    expect(r.message.role).toBe("assistant");
    expect(r.message.displayText).toBe("Nothing due. Enjoy the afternoon.");
    expect(r.toolCalls).toEqual([]);
    expect(r.layoutChanged).toBe(false);
    expect(r.changed).toEqual([]);
    const full = await t.api<Thread>("GET", `/api/agent/threads/${thread.id}`);
    expect(full.data.title).toBe("What is left today, and is there anythin");
    expect(full.data.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(full.data.messages[0]?.displayText).toContain("What is left today");
    const list = await t.api<AgentThread[]>("GET", "/api/agent/threads");
    expect(list.data[0]?.id).toBe(thread.id);
  });

  it("lists tools for the help sheet", async () => {
    const r = await t.api<{ name: string; description: string; readOnly: boolean; destructive: boolean }[]>("GET", "/api/agent/tools");
    const names = r.data.map((x) => x.name);
    expect(names).toContain("add_widget");
    expect(names).toContain("remember");
    expect(r.data.find((x) => x.name === "remove_widget")?.destructive).toBe(true);
    expect(r.data.find((x) => x.name === "get_layout")?.readOnly).toBe(true);
  });

  it("deletes a thread", async () => {
    const thread = await newThread("Temp");
    await t.api("DELETE", `/api/agent/threads/${thread.id}`);
    const gone = await t.api("GET", `/api/agent/threads/${thread.id}`, undefined, { allowError: true });
    expect(gone.status).toBe(404);
  });

  it("rejects empty messages and unknown threads", async () => {
    const thread = await newThread();
    const empty = await t.api("POST", `/api/agent/threads/${thread.id}/messages?stream=false`, { text: "   " }, { allowError: true });
    expect(empty.status).toBe(400);
    const missing = await t.api("POST", "/api/agent/threads/nope/messages", { text: "hi" }, { allowError: true });
    expect(missing.status).toBe(404);
  });
});

describe("agent layout changes", () => {
  it("adds a countdown widget over SSE and bumps the layout version", async () => {
    const before = (await t.api<Layout>("GET", "/api/layout/today")).data;
    const input = { widget: { type: "countdown", date: "2026-12-25", label: "Christmas" }, sectionId: "top", position: "top" };
    t.ai.agentHandler = async (req) => {
      req.onText?.("Added a Christmas countdown ");
      const outcome = await useTool(req, "add_widget", input);
      req.onText?.("to the top of your dashboard. You can revert it.");
      return toolTurn("add_widget", input, outcome, "Added a Christmas countdown to the top of your dashboard. You can revert it.");
    };
    const thread = await newThread();
    const res = await t.fetch(`/api/agent/threads/${thread.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Add a countdown to Christmas" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSse(await res.text());
    const kinds = events.map((e) => e.event);
    expect(kinds).toEqual(["text", "tool_call", "tool_result", "text", "done"]);
    const call = events.find((e) => e.event === "tool_call")?.data as { name: string; input: unknown };
    expect(call.name).toBe("add_widget");
    const result = events.find((e) => e.event === "tool_result")?.data as { name: string; ok: boolean; summary: string };
    expect(result.ok).toBe(true);
    expect(result.summary.length).toBeLessThanOrEqual(300);
    const done = events.find((e) => e.event === "done")?.data as SendMessageResult;
    expect(done.layoutChanged).toBe(true);
    expect(done.changed).toEqual(["layout"]);
    expect(done.toolCalls[0]?.ok).toBe(true);
    expect(done.message.displayText).toContain("Christmas countdown");

    const after = (await t.api<Layout>("GET", "/api/layout/today")).data;
    expect(after.version).toBe(before.version + 1);
    const top = after.spec.sections.find((s) => s.id === "top");
    const widget = top?.widgets[0];
    expect(widget?.type).toBe("countdown");
    expect(widget?.id.startsWith("countdown-")).toBe(true);
    const stored = await t.api<Thread>("GET", `/api/agent/threads/${thread.id}`);
    expect(stored.data.messages[1]?.toolCalls[0]?.name).toBe("add_widget");
  });

  it("creates a tracker with its widget, which then logs through the trackers API", async () => {
    const input = { name: "Coffee", unit: "cups", target: 3 };
    t.ai.agentHandler = async (req) => toolTurn("create_tracker_widget", input, await useTool(req, "create_tracker_widget", input), "Added a coffee counter to your dashboard.");
    const thread = await newThread();
    const r = await send(thread.id, "Add a coffee counter");
    expect(r.changed.sort()).toEqual(["layout", "tracker"]);
    expect(r.toolCalls[0]?.result.length).toBeLessThanOrEqual(300);
    const trackers = (await t.api<Tracker[]>("GET", "/api/trackers")).data;
    const coffee = trackers.find((x) => x.name === "Coffee");
    expect(coffee).toBeTruthy();
    const layout = (await t.api<Layout>("GET", "/api/layout/today")).data;
    const widget = layout.spec.sections.flatMap((s) => s.widgets).find((w) => w.type === "tracker" && w.trackerId === coffee!.id);
    expect(widget?.title).toBe("Coffee");
    const logged = await t.api<Tracker>("POST", `/api/trackers/${coffee!.id}/log`, {});
    expect(logged.data.todayValue).toBe(1);
  });

  it("returns a tool error for an invalid widget instead of throwing", async () => {
    const before = (await t.api<Layout>("GET", "/api/layout/today")).data;
    const input = { widget: { type: "countdown", label: "No date" } };
    let outcome: ToolOutcome | null = null;
    t.ai.agentHandler = async (req) => {
      outcome = await useTool(req, "add_widget", input);
      return toolTurn("add_widget", input, outcome, "I could not add that: a countdown needs a date.");
    };
    const thread = await newThread();
    const r = await send(thread.id, "Add a countdown");
    expect(outcome!.ok).toBe(false);
    expect(outcome!.result).toContain("date");
    expect(r.layoutChanged).toBe(false);
    expect(r.toolCalls[0]?.ok).toBe(false);
    expect((await t.api<Layout>("GET", "/api/layout/today")).data.version).toBe(before.version);

    const def = layoutTools.find((d) => d.name === "add_widget")!;
    const bad = await runTool(def, { widget: { type: "nope" } }, { ctx: t.ctx, actor: "agent" });
    expect(bad.ok).toBe(false);
    expect((bad.result as { error: string }).error).toBe("Invalid input");
  });

  it("update, move, section, history and revert work through the tool catalog", async () => {
    const tc = { ctx: t.ctx, actor: "agent" };
    const tool = (name: string) => layoutTools.find((d) => d.name === name)!;
    const types = await runTool(tool("list_widget_types"), {}, tc);
    expect(types.ok).toBe(true);
    const infos = (types.result as { types: { type: string; required: string[] }[] }).types;
    expect(infos.find((x) => x.type === "countdown")?.required).toEqual(["date", "label"]);

    const section = await runTool(tool("add_section"), { title: "Reading", widgets: [{ type: "note", text: "Read 20 pages" }] }, tc);
    expect(section.ok).toBe(true);
    const sectionId = (section.result as { section: { id: string; widgets: { id: string }[] } }).section.id;
    expect(sectionId).toBe("reading");
    const noteId = (section.result as { section: { widgets: { id: string }[] } }).section.widgets[0]!.id;

    const upd = await runTool(tool("update_widget"), { widgetId: noteId, patch: { size: "l", text: "Read 30 pages" } }, tc);
    expect(upd.ok).toBe(true);
    const badUpd = await runTool(tool("update_widget"), { widgetId: noteId, patch: { size: "xl" } }, tc);
    expect(badUpd.ok).toBe(false);

    const moved = await runTool(tool("move_widget"), { widgetId: noteId, sectionId: "top", index: 0 }, tc);
    expect(moved.ok).toBe(true);
    const layout = (await t.api<Layout>("GET", "/api/layout/today")).data;
    expect(layout.spec.sections.find((s) => s.id === "top")?.widgets[0]?.id).toBe(noteId);
    expect(layout.spec.sections.some((s) => s.id === "reading")).toBe(false);

    const history = await runTool(tool("layout_history"), {}, tc);
    expect((history.result as { versions: unknown[] }).versions.length).toBeGreaterThan(0);
    const reverted = await runTool(tool("revert_layout"), {}, tc);
    expect(reverted.ok).toBe(true);
    const back = (await t.api<Layout>("GET", "/api/layout/today")).data;
    expect(back.version).toBe(layout.version - 1);
    expect(back.spec.sections.some((s) => s.id === "reading")).toBe(true);

    const removed = await runTool(tool("remove_widget"), { widgetId: noteId }, tc);
    expect(removed.ok).toBe(true);
    const missing = await runTool(tool("remove_widget"), { widgetId: noteId }, tc);
    expect(missing.ok).toBe(false);
  });

  it("create_goal_widget needs an existing goal", async () => {
    const tc = { ctx: t.ctx, actor: "agent" };
    const def = layoutTools.find((d) => d.name === "create_goal_widget")!;
    const nope = await runTool(def, { goalId: "missing" }, tc);
    expect(nope.ok).toBe(false);
    const goal = await t.api<{ id: string }>("POST", "/api/goals", { title: "Read 12 books", kind: "number", targetValue: 12, unit: "books" });
    const ok = await runTool(def, { goalId: goal.data.id, size: "l" }, tc);
    expect(ok.ok).toBe(true);
    expect((ok.result as { widget: { goalId: string; title: string } }).widget.title).toBe("Read 12 books");
  });
});

describe("agent memory", () => {
  it("remembers, recalls and shows memories in the next system prompt", async () => {
    const input = { content: "Arav prefers morning workouts", kind: "preference" };
    t.ai.agentHandler = async (req) => {
      const remembered = await useTool(req, "remember", input);
      expect(remembered.ok).toBe(true);
      const recalled = await useTool(req, "recall", { query: "workouts" });
      expect(recalled.ok).toBe(true);
      expect(recalled.result).toContain("morning workouts");
      const again = await useTool(req, "remember", input);
      expect(JSON.parse(again.result).duplicate).toBe(true);
      return toolTurn("remember", input, remembered, "Noted: you prefer morning workouts.");
    };
    const thread = await newThread();
    const r = await send(thread.id, "I prefer to work out in the morning");
    expect(r.changed).toEqual(["memory"]);

    let system = "";
    t.ai.agentHandler = async (req) => {
      system = req.system;
      return reply("ok");
    };
    await send(thread.id, "thanks");
    expect(system).toContain("[preference] Arav prefers morning workouts");

    const direct: AgentTurnRequest = { system: "", messages: [], tools: agentToolsFor(t.ctx) };
    const all = await useTool(direct, "list_memories", {});
    const memories = (JSON.parse(all.result) as { memories: { id: string; content: string }[] }).memories;
    expect(memories).toHaveLength(1);
    const forgot = await useTool(direct, "forget", { id: memories[0]!.id });
    expect(forgot.ok).toBe(true);
    const none = await useTool(direct, "forget", { id: memories[0]!.id });
    expect(none.ok).toBe(false);
  });
});

describe("agent history", () => {
  it("replays previous content blocks, including tool exchanges, on the next turn", async () => {
    const input = { widget: { type: "note", text: "hello" } };
    t.ai.agentHandler = async (req) => toolTurn("add_widget", input, await useTool(req, "add_widget", input), "Added a note.");
    const thread = await newThread();
    await send(thread.id, "Add a note that says hello");

    let seen: AgentTurnRequest["messages"] = [];
    t.ai.agentHandler = async (req) => {
      seen = req.messages;
      return reply("Done.");
    };
    await send(thread.id, "Now remove it", { images: [{ base64: "aGVsbG8=", mediaType: "image/png" }] });
    expect(seen).toHaveLength(5);
    expect(seen.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    const first = seen[0]!.content as { type: string; text?: string }[];
    expect(first[0]).toEqual({ type: "text", text: "Add a note that says hello" });
    const uses = seen[1]!.content as { type: string; name?: string }[];
    expect(uses[0]?.type).toBe("tool_use");
    expect(uses[0]?.name).toBe("add_widget");
    const results = seen[2]!.content as { type: string; tool_use_id?: string }[];
    expect(results[0]?.type).toBe("tool_result");
    expect(results[0]?.tool_use_id).toBe("toolu_add_widget");
    const last = seen[4]!.content as { type: string; source?: { media_type: string } }[];
    expect(last.map((b) => b.type)).toEqual(["text", "image"]);
    expect(last[1]?.source?.media_type).toBe("image/png");
  });

  it("trims history so it starts on a plain user message", async () => {
    const msgs: AgentTurnRequest["messages"] = [
      { role: "user", content: "a" },
      { role: "assistant", content: [{ type: "tool_use", id: "x", name: "get_layout", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "{}" }] },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    expect(trimHistory(msgs, 4).map((m) => m.content)).toEqual(["c"]);
    expect(trimHistory(msgs, 5)).toHaveLength(5);
    expect(trimHistory(msgs, 40)).toHaveLength(5);
  });
});

describe("agent quick + disabled", () => {
  it("quick uses a thread named Quick", async () => {
    t.ai.agentHandler = async () => reply("Two tasks left.");
    const a = await t.api<SendMessageResult>("POST", "/api/agent/quick", { text: "what's left today" });
    const b = await t.api<SendMessageResult>("POST", "/api/agent/quick", { text: "and tomorrow?" });
    expect(a.data.message.displayText).toBe("Two tasks left.");
    expect(b.data.threadId).toBe(a.data.threadId);
    const thread = await t.api<Thread>("GET", `/api/agent/threads/${a.data.threadId}`);
    expect(thread.data.title).toBe("Quick");
    expect(thread.data.messages).toHaveLength(4);
  });

  it("returns 503 when AI is disabled", async () => {
    const d = makeTestApp();
    d.ctx.ai = disabledProvider(d.ctx.env);
    const thread = (await d.api<AgentThread>("POST", "/api/agent/threads", {})).data;
    const json = await d.api<{ error: string }>("POST", `/api/agent/threads/${thread.id}/messages?stream=false`, { text: "hi" }, { allowError: true });
    expect(json.status).toBe(503);
    expect(json.data.error).toContain("ANTHROPIC_API_KEY");
    const sse = await d.fetch(`/api/agent/threads/${thread.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }) });
    expect(sse.status).toBe(503);
    const quick = await d.api("POST", "/api/agent/quick", { text: "hi" }, { allowError: true });
    expect(quick.status).toBe(503);
    d.cleanup();
  });
});
