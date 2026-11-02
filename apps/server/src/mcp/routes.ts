import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Context } from "hono";
import type { App, AppVariables } from "../app.ts";
import { createMcpServer } from "./server.ts";

const MAX_REMEMBERED_CLIENTS = 50;
/** Client names seen in initialize requests, keyed by User-Agent: the transport is stateless, so later calls carry no clientInfo. */
const clientNames = new Map<string, string>();

function rememberClient(userAgent: string, name: string): void {
  clientNames.delete(userAgent);
  clientNames.set(userAgent, name);
  if (clientNames.size > MAX_REMEMBERED_CLIENTS) {
    const oldest = clientNames.keys().next().value;
    if (oldest !== undefined) clientNames.delete(oldest);
  }
}

function sanitizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clientNameFromInitialize(body: unknown): string | null {
  const messages = Array.isArray(body) ? body : [body];
  for (const m of messages) {
    if (!isRecord(m) || m.method !== "initialize" || !isRecord(m.params) || !isRecord(m.params.clientInfo)) continue;
    const name = m.params.clientInfo.name;
    if (typeof name === "string" && sanitizeName(name)) return sanitizeName(name);
  }
  return null;
}

/** Actor recorded in the activity log: X-Actor header, else the MCP client name, else plain mcp. */
export function resolveMcpActor(c: Context<{ Variables: AppVariables }>, body: unknown): string {
  const explicit = c.req.header("x-actor")?.trim();
  if (explicit) return (explicit.startsWith("mcp:") ? explicit : `mcp:${explicit}`).slice(0, 60);
  const userAgent = c.req.header("user-agent") ?? "";
  const fromInit = clientNameFromInitialize(body);
  if (fromInit) {
    rememberClient(userAgent, fromInit);
    return `mcp:${fromInit}`;
  }
  const remembered = clientNames.get(userAgent);
  return remembered ? `mcp:${remembered}` : "mcp";
}

function jsonRpcError(c: Context<{ Variables: AppVariables }>, status: 400 | 405, code: number, message: string) {
  return c.json({ jsonrpc: "2.0", error: { code, message }, id: null }, status);
}

function newTransport(): WebStandardStreamableHTTPServerTransport {
  return new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
}

export function mcpRoutes(app: App): void {
  app.post("/mcp", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonRpcError(c, 400, -32700, "Parse error: Invalid JSON");
    }
    const server = createMcpServer(c.get("ctx"), resolveMcpActor(c, body));
    const transport = newTransport();
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw, { parsedBody: body });
    } finally {
      await server.close().catch(() => undefined);
    }
  });

  // Stateless: there are no server-initiated messages to stream, which the spec lets a server signal with 405.
  app.get("/mcp", (c) => jsonRpcError(c, 405, -32000, "Method not allowed: this server is stateless and does not open server-to-client streams. Send JSON-RPC requests with POST."));

  app.delete("/mcp", async (c) => {
    const server = createMcpServer(c.get("ctx"), resolveMcpActor(c, null));
    const transport = newTransport();
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}
