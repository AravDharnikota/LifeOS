import { useKeyboardHeight } from "@/lib/keyboard";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router";
import { useSettings } from "@/data/queries";
import { cn } from "@/lib/cn";
import { useHotkey, useIsDesktop } from "@/lib/hooks";
import { useUi } from "@/state/ui";
import { Sheet } from "@/ui/Sheet";
import { Icon } from "@/ui/Icon";
import type { Attachment } from "./images";
import { Turn } from "./Messages";
import { PromptLine } from "./PromptLine";
import { ErrorLine, WorkingLine } from "./Spinner";
import { describeWork, formatElapsed, promptHistory } from "./terminal";
import { ThreadList } from "./ThreadList";
import { useChat, useThreads } from "./useAgent";

const SUGGESTIONS = ["What is left today", "Add a coffee counter", "Plan my day"];
type View = "chat" | "threads";


/** Milliseconds since the turn started, ticking at 10Hz while it runs; keeps the final value until the next turn. */
function useTurnClock(running: boolean): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    setMs(0);
    const id = window.setInterval(() => setMs(performance.now() - start), 100);
    return () => {
      window.clearInterval(id);
      setMs(performance.now() - start);
    };
  }, [running]);
  return ms;
}

/** Round glass pill used in the sheet header (thread switcher, back, done). */
const pill = "glass pressable-spring inline-flex items-center rounded-full text-[14px] text-primary";

/**
 * The assistant: a glass sheet (right-side panel on the desktop, a tall sheet on the phone) holding a smoked-glass terminal:
 * monospace transcript, a `❯` prompt and a status line. The header carries the sparkle mark and a thread switcher.
 */
export function AgentSheet() {
  const open = useUi((s) => s.agentOpen);
  const prefill = useUi((s) => s.agentPrefill);
  const openAgent = useUi((s) => s.openAgent);
  const close = useUi((s) => s.closeAgent);
  const isDesktop = useIsDesktop();
  const toggle = useCallback(() => (open ? close() : openAgent()), [open, close, openAgent]);
  useHotkey("k", toggle, { meta: true, enabled: isDesktop });

  const [view, setView] = useState<View>("chat");
  const [threadId, setThreadId] = useState<string | null>(null);
  const threads = useThreads(open);
  // The switcher names the current thread once it has a title; an untitled or new thread just reads "Threads".
  const threadTitle = (threadId && threads.data?.find((t) => t.id === threadId)?.title?.trim()) || null;
  useEffect(() => {
    if (!open) setView("chat");
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={close}
      detent="large"
      desktop="panel"
      flush
      className="overflow-hidden lg:m-2 lg:rounded-[28px] lg:h-[calc(100%-16px)]"
      style={isDesktop ? { maxWidth: 560 } : undefined}
      title={
        view === "threads" ? (
          "Threads"
        ) : (
          <span className="inline-flex items-center gap-2 font-normal">
            <span className="w-6 h-6 rounded-[8px] bg-primary text-canvas inline-flex items-center justify-center shrink-0">
              <Icon name="sparkle" size={13} strokeWidth={2} />
            </span>
            Assistant
          </span>
        )
      }
      leading={
        view === "threads" ? (
          <button type="button" aria-label="Back" onClick={() => setView("chat")} className={cn(pill, "ml-1 w-9 h-9 justify-center")}>
            <Icon name="chevron-left" size={18} strokeWidth={1.8} />
          </button>
        ) : (
          <button type="button" aria-label={threadTitle ? `Threads: ${threadTitle}` : "Threads"} title={threadTitle ?? undefined} onClick={() => setView("threads")} className={cn(pill, "ml-1 h-9 max-w-[128px] lg:max-w-[180px] pl-2.5 pr-2 gap-1.5 !text-[13px] !text-secondary")}>
            <Icon name="list" size={15} strokeWidth={1.8} className="shrink-0" />
            <span className="truncate">{threadTitle ?? "Threads"}</span>
            <Icon name="chevron-down" size={12} strokeWidth={2} className="shrink-0 text-tertiary" />
          </button>
        )
      }
      trailing={
        <button type="button" onClick={close} className={cn(pill, "mr-1 h-9 px-4")}>
          Done
        </button>
      }
    >
      {open && <AgentBody view={view} onView={setView} onThread={setThreadId} prefill={prefill} isDesktop={isDesktop} />}
    </Sheet>
  );
}

function AgentBody({ view, onView, onThread, prefill, isDesktop }: { view: View; onView: (v: View) => void; onThread: (id: string | null) => void; prefill: string | null; isDesktop: boolean }) {
  const navigate = useNavigate();
  const close = useUi((s) => s.closeAgent);
  const settings = useSettings();
  const configured = settings.data?.integrations.anthropic.configured ?? true;
  const model = settings.data?.integrations.anthropic.model;
  const chat = useChat(true);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // The sheet itself rides up with the keyboard; here we only drop the safe-area padding while it is open.
  const kb = useKeyboardHeight();
  const elapsed = useTurnClock(chat.sending);
  const history = useMemo(() => promptHistory(chat.messages), [chat.messages]);

  useEffect(() => {
    if (prefill) setDraft(prefill);
  }, [prefill]);

  // The header's thread switcher shows the current thread's title.
  useEffect(() => {
    onThread(chat.threadId);
  }, [chat.threadId, onThread]);

  // Follow the stream while the reader is at the bottom. Text length and tool count both move the end of the transcript.
  const last = chat.messages[chat.messages.length - 1];
  const tail = `${chat.messages.length}:${last?.text.length ?? 0}:${last?.tools.length ?? 0}:${last?.streaming ? 1 : 0}`;
  useEffect(() => {
    const el = listRef.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [tail, view]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const send = (text = draft) => {
    if (!configured) return;
    stick.current = true;
    void chat.send(text, attachments);
    setDraft("");
    setAttachments([]);
  };

  if (view === "threads")
    return (
      <ThreadList
        current={chat.threadId}
        onSelect={(id) => {
          chat.setThreadId(id);
          onView("chat");
        }}
      />
    );

  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");
  const work = describeWork(lastAssistant?.tools.length ?? 0, Boolean(lastAssistant?.streaming));
  const failed = chat.messages.find((m) => m.failed);
  const empty = chat.messages.length === 0 && !chat.loading;

  return (
    <div className="flex-1 min-h-0 flex flex-col px-2 pb-[max(8px,var(--safe-bottom))]" style={kb > 0 && view === "chat" ? { paddingBottom: 8 } : undefined}>
      <div className="term flex-1 min-h-0 flex flex-col rounded-[22px] overflow-hidden bg-term-bg text-term-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_0_0_1px_var(--term-line),var(--shadow-card)]" data-testid="agent-chat">
      {!configured && (
        <div className="px-3 pt-3 grid grid-cols-[2ch_1fr_auto] items-start" role="status">
          <span aria-hidden="true" className="text-term-err select-none">✗</span>
          <p className="text-term-fg-dim">Assistant needs an API key. Add ANTHROPIC_API_KEY on the server.</p>
          <button type="button" className="pl-3 text-term-tool hover:underline underline-offset-2 min-h-[20px]" onClick={() => { close(); navigate("/settings"); }}>
            settings
          </button>
        </div>
      )}
      <div ref={listRef} onScroll={onScroll} className="flex-1 min-h-0 scroller px-3" data-testid="agent-messages">
        {chat.loading ? (
          <div className="py-3">
            <WorkingLine>loading thread…</WorkingLine>
          </div>
        ) : chat.error ? (
          <div className="py-3">
            <ErrorLine onRetry={() => void chat.refetch()}>Unable to load the conversation.</ErrorLine>
          </div>
        ) : empty ? (
          <Banner model={model} configured={configured} onPick={send} />
        ) : (
          <div className="flex flex-col gap-3 py-3">
            {chat.messages.map((m) => (
              <Turn key={m.id} message={m} onRetry={m.failed ? chat.retry : undefined} />
            ))}
          </div>
        )}
      </div>
      <PromptLine
        value={draft}
        onChange={setDraft}
        attachments={attachments}
        onAttachments={setAttachments}
        onSend={() => send()}
        onCancel={chat.stop}
        history={history}
        sending={chat.sending}
        disabled={!configured}
        onFocus={() => {
          window.setTimeout(() => {
            const el = listRef.current;
            if (el && stick.current) el.scrollTop = el.scrollHeight;
          }, 300);
        }}
      />
      <StatusLine model={model} configured={configured} work={work} elapsed={elapsed} sending={chat.sending} failed={Boolean(failed)} isDesktop={isDesktop} />
      </div>
    </div>
  );
}

/**
 * The empty transcript: a quiet greeting with a thin blinking caret ("Hey, need help? / Just ask me anything"),
 * the session facts in mono, and suggested prompts as `❯` lines at the bottom.
 */
function Banner({ model, configured, onPick }: { model: string | undefined; configured: boolean; onPick: (text: string) => void }) {
  return (
    <div className="min-h-full flex flex-col py-4">
      <div className="pt-[8vh] lg:pt-16 px-0.5">
        <div className="rise font-ui inline-flex items-center gap-2 text-[15px] text-term-fg-dim">
          <span className="w-6 h-6 rounded-[8px] bg-term-fg text-term-bg inline-flex items-center justify-center shrink-0" aria-hidden="true">
            <Icon name="sparkle" size={13} strokeWidth={2} />
          </span>
          Hey, need help?
        </div>
        <p className="rise font-ui mt-2.5 text-[30px] leading-[38px] font-light tracking-[-0.025em] text-term-fg" style={{ "--i": 1 } as CSSProperties}>
          <span aria-hidden="true" className="term-cursor inline-block w-[2px] h-[30px] bg-term-prompt align-[-5px] mr-1.5 rounded-full" />
          Just ask me anything
        </p>
        <dl className="rise mt-5 grid grid-cols-[7ch_1fr] gap-y-0.5 m-0 text-[12px] leading-[18px] text-term-fg-dim" style={{ "--i": 2 } as CSSProperties}>
          <dt className="text-term-fg-faint">model</dt>
          <dd className="m-0 truncate">{model ?? "…"}</dd>
          <dt className="text-term-fg-faint">tools</dt>
          <dd className="m-0">tasks · calendar · health · goals · dashboard</dd>
        </dl>
      </div>
      <div className="mt-auto pt-8 rise" style={{ "--i": 3 } as CSSProperties}>
        <div className="text-term-fg-faint mb-1">try:</div>
        <div className="flex flex-col">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" disabled={!configured} onClick={() => onPick(s)} className="group grid grid-cols-[2ch_1fr] w-[calc(100%+8px)] -mx-1 px-1 text-left items-center min-h-[40px] lg:min-h-[28px] rounded-xs text-term-fg-dim hover:text-term-fg hover:bg-term-bg-hover active:bg-term-bg-hover disabled:opacity-50 disabled:hover:bg-transparent">
              <span aria-hidden="true" className="select-none text-term-fg-faint group-hover:text-term-prompt transition-colors duration-100">❯</span>
              <span>{s}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Thin footer: model on the left, the turn's work and clock in the middle, key hints on the right. */
function StatusLine({ model, configured, work, elapsed, sending, failed, isDesktop }: { model: string | undefined; configured: boolean; work: string; elapsed: number; sending: boolean; failed: boolean; isDesktop: boolean }) {
  const hint = sending ? (isDesktop ? "esc to cancel" : "■ to cancel") : isDesktop ? "↵ send · ⇧↵ newline · ↑ history" : null;
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 h-7 text-[11px] leading-none text-term-fg-faint bg-term-bg-raised border-t border-term-line" data-testid="agent-status">
      <span className={cn("truncate", configured ? "text-term-fg-dim" : "text-term-err")} title={model}>
        {configured ? (model ?? "…") : "no api key"}
      </span>
      {work && (
        <>
          <span aria-hidden="true">·</span>
          <span className={cn("shrink-0", failed && "text-term-err")}>{work}</span>
        </>
      )}
      {elapsed > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span className={cn("shrink-0 tabular", sending && "text-term-fg-dim")}>{formatElapsed(elapsed)}</span>
        </>
      )}
      {hint && <span className={cn("ml-auto shrink-0 truncate", sending && "text-term-prompt")}>{hint}</span>}
    </div>
  );
}
