import { describe, it, expect, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { desc } from "drizzle-orm";
import { makeTestApp, type TestApp } from "./helpers.ts";
import { schema } from "../src/db/client.ts";

const t = makeTestApp();
afterAll(() => t.cleanup());

const MCP_URL = "http://test.local/mcp";

async function connect(app: TestApp, opts: { name?: string; headers?: Record<string, string> } = {}): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (url, init) => app.fetch(String(url), init),
    requestInit: opts.headers ? { headers: opts.headers } : undefined,
  });
  const client = new Client({ name: opts.name ?? "vitest-client", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

function textOf(result: unknown): Record<string, unknown> {
  const content = (result as { content?: { type: string; text?: string }[] }).content;
  const block = content?.find((b) => b.type === "text");
  return JSON.parse(block?.text ?? "{}") as Record<string, unknown>;
}

function resourceJson<T>(result: { contents: unknown[] }): T {
  const first = result.contents[0] as { text?: string } | undefined;
  return JSON.parse(first?.text ?? "{}") as T;
}

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const initBody = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "curl", version: "1" } } };

describe("mcp server", () => {
  it("initializes with server info and instructions", async () => {
    const client = await connect(t);
    expect(client.getServerVersion()?.name).toBe("aravos");
    expect(client.getInstructions()).toContain("Arav");
    expect(client.getServerCapabilities()?.tools).toBeTruthy();
    await client.close();
  });

  it("lists tools with schemas and annotations", async () => {
    const client = await connect(t);
    const { tools } = await client.listTools();
    const names = tools.map((x) => x.name);
    for (const n of ["whoami", "get_day_summary", "list_tasks", "add_task", "complete_task", "delete_task", "get_events", "find_free_time", "list_goals", "log_goal_progress", "list_trackers", "log_water", "log_meal_text", "recent_activity"]) expect(names).toContain(n);
    const add = tools.find((x) => x.name === "add_task")!;
    expect(add.inputSchema.type).toBe("object");
    expect(Object.keys(add.inputSchema.properties ?? {})).toContain("title");
    expect(add.inputSchema.required).toEqual(["title"]);
    expect(add.description).toContain("YYYY-MM-DD");
    expect(tools.find((x) => x.name === "list_tasks")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((x) => x.name === "delete_task")?.annotations?.destructiveHint).toBe(true);
    const whoami = tools.find((x) => x.name === "whoami")!;
    expect(whoami.inputSchema.type).toBe("object");
    await client.close();
  });

  it("calls tools and records the client name as actor", async () => {
    const client = await connect(t, { name: "Claude Code" });
    const added = textOf(await client.callTool({ name: "add_task", arguments: { title: "From MCP", dueDate: "2026-11-02" } }));
    expect(added.title).toBe("From MCP");
    const listed = textOf(await client.callTool({ name: "list_tasks", arguments: { view: "today", date: "2026-11-02" } }));
    expect((listed.tasks as { id: string }[]).some((x) => x.id === added.id)).toBe(true);
    const log = t.ctx.db.select().from(schema.activityLog).orderBy(desc(schema.activityLog.at)).limit(1).get();
    expect(log?.actor).toBe("mcp:claude-code");
    expect(log?.summary).toContain("From MCP");
    const task = t.ctx.db.select().from(schema.tasks).all().find((x) => x.id === added.id);
    expect(task?.source).toBe("mcp:claude-code");
    const bad = await client.callTool({ name: "add_task", arguments: { title: "" } });
    expect(bad.isError).toBe(true);
    const whoami = textOf(await client.callTool({ name: "whoami", arguments: {} }));
    expect(whoami.actor).toBe("mcp:claude-code");
    await client.close();
  });

  it("honors the X-Actor header", async () => {
    const client = await connect(t, { name: "Muse", headers: { "X-Actor": "muse" } });
    const me = textOf(await client.callTool({ name: "whoami", arguments: {} }));
    expect(me.actor).toBe("mcp:muse");
    await client.close();
  });

  it("serves resources and the resource template", async () => {
    const client = await connect(t);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(expect.arrayContaining(["aravos://today", "aravos://tasks/today", "aravos://goals"]));
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((r) => r.uriTemplate)).toContain("aravos://day/{date}");
    const today = await client.readResource({ uri: "aravos://today" });
    const summary = resourceJson<{ date: string; tasks: unknown; nutrition: unknown }>(today);
    expect(summary.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(summary.tasks).toBeTruthy();
    expect(summary.nutrition).toBeTruthy();
    const day = await client.readResource({ uri: "aravos://day/2026-11-02" });
    const parsed = resourceJson<{ date: string; tasks: { due: { title: string }[] } }>(day);
    expect(parsed.date).toBe("2026-11-02");
    expect(parsed.tasks.due.some((x) => x.title === "From MCP")).toBe(true);
    const goals = await client.readResource({ uri: "aravos://goals" });
    expect(resourceJson<Record<string, unknown>>(goals)).toHaveProperty("goals");
    await expect(client.readResource({ uri: "aravos://day/not-a-date" })).rejects.toThrow();
    await client.close();
  });

  it("serves the daily_plan prompt", async () => {
    const client = await connect(t);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("daily_plan");
    const prompt = await client.getPrompt({ name: "daily_plan", arguments: { focus: "deep work" } });
    const text = (prompt.messages[0]?.content as { text: string }).text;
    expect(text).toContain("get_day_summary");
    expect(text).toContain("plan_schedule");
    expect(text).toContain("deep work");
    await client.close();
  });

  it("answers raw JSON-RPC over plain HTTP", async () => {
    const res = await t.fetch(MCP_URL, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(initBody) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe("aravos");
    const call = await t.fetch(MCP_URL, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami", arguments: {} } }) });
    const callBody = (await call.json()) as { result: { content: { text: string }[] } };
    expect(JSON.parse(callBody.result.content[0]!.text).app).toBe("AravOS");
    const invalid = await t.fetch(MCP_URL, { method: "POST", headers: JSON_HEADERS, body: "{not json" });
    expect(invalid.status).toBe(400);
    const get = await t.fetch(MCP_URL, { method: "GET", headers: { accept: "text/event-stream" } });
    expect(get.status).toBe(405);
    const del = await t.fetch(MCP_URL, { method: "DELETE" });
    expect(del.status).toBe(200);
  });

  it("requires the bearer token when one is set", async () => {
    const secured = makeTestApp({ token: "secret" });
    const res = await secured.fetch(MCP_URL, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(initBody) });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Unauthorized");
    await expect(connect(secured)).rejects.toThrow();
    const client = await connect(secured, { headers: { Authorization: "Bearer secret" } });
    const me = textOf(await client.callTool({ name: "whoami", arguments: {} }));
    expect(me.app).toBe("AravOS");
    await client.close();
    secured.cleanup();
  });
});
