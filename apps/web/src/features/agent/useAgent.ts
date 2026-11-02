import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentMessage, AgentThread } from "@aravos/shared";
import { api, ApiError, streamEvents } from "@/lib/api";
import { invalidateAll } from "@/data/queries";
import type { Attachment } from "./images";

const THREAD_KEY = "aravos.agent.thread";

export interface ChatTool {
  id: string;
  name: string;
  input: unknown;
  pending: boolean;
  ok?: boolean;
  summary?: string;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: string[];
  tools: ChatTool[];
  streaming?: boolean;
  /** Set on the assistant placeholder when the turn failed; carries what to resend. */
  failed?: { text: string; images: Attachment[]; message: string };
}

export function readStoredThread(): string | null {
  try {
    return localStorage.getItem(THREAD_KEY);
  } catch {
    return null;
  }
}
function storeThread(id: string | null): void {
  try {
    if (id) localStorage.setItem(THREAD_KEY, id);
    else localStorage.removeItem(THREAD_KEY);
  } catch {
    /* ignore */
  }
}

export const threadKeys = { list: ["agent", "threads"] as const, one: (id: string) => ["agent", "thread", id] as const };

export const useThreads = (enabled: boolean) => useQuery({ queryKey: threadKeys.list, queryFn: () => api.get<AgentThread[]>("/api/agent/threads"), enabled, staleTime: 15_000 });
export const useThread = (id: string | null, enabled: boolean) =>
  useQuery({ queryKey: threadKeys.one(id ?? ""), queryFn: () => api.get<AgentThread & { messages: AgentMessage[] }>(`/api/agent/threads/${id}`), enabled: enabled && Boolean(id), staleTime: 5_000, retry: false });

function fromServer(m: AgentMessage): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    text: m.displayText ?? "",
    tools: m.toolCalls.map((t, i) => ({ id: `${m.id}-${i}`, name: t.name, input: t.input, pending: false, ok: t.ok, summary: t.result })),
  };
}

let seq = 0;
const nextId = () => `local-${Date.now()}-${seq++}`;

/** The chat for one thread: server history plus the live turn. The thread is created on the first send. */
export function useChat(open: boolean) {
  const qc = useQueryClient();
  const [threadId, setThreadIdState] = useState<string | null>(() => readStoredThread());
  const [live, setLive] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const thread = useThread(threadId, open);

  // A stored thread that no longer exists starts fresh.
  useEffect(() => {
    if (thread.isError && thread.error instanceof ApiError && thread.error.status === 404) {
      storeThread(null);
      setThreadIdState(null);
    }
  }, [thread.isError, thread.error]);

  const setThreadId = useCallback((id: string | null) => {
    abort.current?.abort();
    abort.current = null;
    setSending(false);
    setLive([]);
    storeThread(id);
    setThreadIdState(id);
  }, []);

  const history = (thread.data?.messages ?? []).map(fromServer);
  const liveIds = new Set(live.map((m) => m.id));
  const messages: ChatMessage[] = [...history.filter((m) => !liveIds.has(m.id)), ...live];

  const send = useCallback(
    async (text: string, images: Attachment[] = []) => {
      const body = text.trim();
      if ((!body && images.length === 0) || sending) return;
      setSending(true);
      const userId = nextId();
      const assistantId = nextId();
      setLive((prev) => [
        ...prev.filter((m) => !m.failed),
        { id: userId, role: "user", text: body, images: images.map((i) => i.dataUrl), tools: [] },
        { id: assistantId, role: "assistant", text: "", tools: [], streaming: true },
      ]);
      const patch = (fn: (m: ChatMessage) => ChatMessage) => setLive((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));
      const controller = new AbortController();
      abort.current = controller;
      let id = threadId;
      try {
        if (!id) {
          const created = await api.post<AgentThread>("/api/agent/threads", {});
          id = created.id;
          storeThread(id);
          setThreadIdState(id);
          void qc.invalidateQueries({ queryKey: threadKeys.list });
        }
        let serverAssistantId: string | null = null;
        let finished = false;
        await streamEvents(
          `/api/agent/threads/${id}/messages`,
          { text: body, images: images.map((i) => ({ base64: i.base64, mediaType: i.mediaType })) },
          (event, data) => {
            const d = (data ?? {}) as Record<string, unknown>;
            if (event === "text") patch((m) => ({ ...m, text: m.text + String(d.delta ?? "") }));
            else if (event === "tool_call") patch((m) => ({ ...m, tools: [...m.tools, { id: nextId(), name: String(d.name ?? ""), input: d.input, pending: true }] }));
            else if (event === "tool_result")
              patch((m) => {
                const idx = m.tools.findIndex((t) => t.pending && t.name === d.name);
                if (idx < 0) return m;
                const tools = m.tools.slice();
                tools[idx] = { ...tools[idx]!, pending: false, ok: Boolean(d.ok), summary: typeof d.summary === "string" ? d.summary : undefined };
                return { ...m, tools };
              });
            else if (event === "done") {
              const msg = d.message as AgentMessage | undefined;
              serverAssistantId = msg?.id ?? null;
              finished = true;
              patch((m) => ({ ...m, streaming: false, text: msg?.displayText ?? m.text, tools: m.tools.map((t) => ({ ...t, pending: false })) }));
              const changed = Array.isArray(d.changed) ? (d.changed as string[]) : [];
              if (changed.length || d.layoutChanged) invalidateAll(qc);
              else if (d.layoutChanged) invalidateAll(qc, ["layout"]);
            } else if (event === "error") throw new Error(String(d.message ?? "The assistant could not answer."));
          },
          controller.signal,
        );
        if (!finished) throw new Error("The reply was cut off.");
        // Reload the thread; the live copies go only once the server has the turn, so nothing vanishes on a failed refetch.
        await qc.invalidateQueries({ queryKey: threadKeys.one(id) }).catch(() => undefined);
        void qc.invalidateQueries({ queryKey: threadKeys.list });
        const fresh = qc.getQueryData<AgentThread & { messages: AgentMessage[] }>(threadKeys.one(id));
        if (serverAssistantId && fresh?.messages.some((m) => m.id === serverAssistantId)) setLive((prev) => prev.filter((m) => m.id !== userId && m.id !== assistantId));
      } catch (e) {
        if (controller.signal.aborted) return;
        const message = e instanceof ApiError && e.status === 503 ? "Assistant needs an API key on the server." : e instanceof Error ? e.message : "The assistant could not answer.";
        patch((m) => ({ ...m, streaming: false, failed: { text: body, images, message } }));
      } finally {
        if (abort.current === controller) abort.current = null;
        setSending(false);
      }
    },
    [qc, sending, threadId],
  );

  const retry = useCallback(() => {
    const failed = live.find((m) => m.failed)?.failed;
    if (!failed) return;
    setLive((prev) => {
      const i = prev.findIndex((m) => m.failed);
      // Remove the failed assistant placeholder and the user message before it.
      return i >= 0 ? prev.filter((_, j) => j !== i && j !== i - 1) : prev;
    });
    void send(failed.text, failed.images);
  }, [live, send]);

  const stop = useCallback(() => {
    abort.current?.abort();
  }, []);

  return { threadId, setThreadId, messages, send, retry, stop, sending, loading: Boolean(threadId) && thread.isPending && open, error: thread.isError && !(thread.error instanceof ApiError && thread.error.status === 404), refetch: thread.refetch };
}

export async function deleteThread(id: string): Promise<void> {
  await api.delete(`/api/agent/threads/${id}`);
}
export async function createThread(): Promise<AgentThread> {
  return api.post<AgentThread>("/api/agent/threads", {});
}
