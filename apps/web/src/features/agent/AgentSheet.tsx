import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useSettings } from "@/data/queries";
import { cn } from "@/lib/cn";
import { useHotkey, useIsDesktop } from "@/lib/hooks";
import { useUi } from "@/state/ui";
import { Sheet } from "@/ui/Sheet";
import type { Attachment } from "./images";
import { Turn } from "./Messages";
import { PromptLine } from "./PromptLine";
import { ErrorLine, WorkingLine } from "./Spinner";
import { describeWork, formatElapsed, promptHistory } from "./terminal";
import { ThreadList } from "./ThreadList";
import { useChat } from "./useAgent";

const SUGGESTIONS = ["What is left today", "Add a coffee counter", "Plan my day"];
type View = "chat" | "threads";

/** Keyboard inset from the visual viewport, so the prompt stays above the keyboard on iOS. */
function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setInset(0);
    };
  }, [active]);
  return inset;
}

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

function ChromeButton({ onClick, children, strong }: { onClick: () => void; children: ReactNode; strong?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("h-11 px-2 text-[12px] transition-colors duration-100 hover:text-term-fg", strong ? "text-term-fg" : "text-term-fg-dim")}>
      {children}
    </button>
  );
}

/**
 * The assistant as a terminal: a dark monospace panel (right side on the desktop, a tall sheet on the phone)
 * with a transcript, a `❯` prompt and a status line. The sheet keeps its grabber and drag-to-dismiss.
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
      className="term overflow-hidden"
      style={{ background: "var(--term-bg)", color: "var(--term-fg)", ...(isDesktop ? { maxWidth: 560 } : {}) }}
      title={
        <span className="text-[12px] font-normal tracking-wide text-term-fg-dim">
          {view === "threads" ? (
            "Threads"
          ) : (
            <>
              aravos <span className="text-term-prompt">❯</span> <span className="text-term-fg">Assistant</span>
            </>
          )}
        </span>
      }
      leading={view === "threads" ? <ChromeButton onClick={() => setView("chat")}>← back</ChromeButton> : <ChromeButton onClick={() => setView("threads")}>threads</ChromeButton>}
      trailing={
        <ChromeButton onClick={close} strong>
          done
        </ChromeButton>
      }
    >
      {open && <AgentBody view={view} onView={setView} prefill={prefill} isDesktop={isDesktop} />}
    </Sheet>
  );
}

function AgentBody({ view, onView, prefill, isDesktop }: { view: View; onView: (v: View) => void; prefill: string | null; isDesktop: boolean }) {
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
  const inset = useKeyboardInset(view === "chat");
  const elapsed = useTurnClock(chat.sending);
  const history = useMemo(() => promptHistory(chat.messages), [chat.messages]);

  useEffect(() => {
    if (prefill) setDraft(prefill);
  }, [prefill]);

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
    <div className="flex-1 min-h-0 flex flex-col" style={inset ? { paddingBottom: inset } : undefined} data-testid="agent-chat">
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
  );
}

/** The empty transcript: a boxed header like a shell's login banner, then suggested prompts as `❯` lines. */
function Banner({ model, configured, onPick }: { model: string | undefined; configured: boolean; onPick: (text: string) => void }) {
  return (
    <div className="py-4 flex flex-col gap-5">
      <div className="border border-term-line rounded-xs px-3 py-2.5 text-term-fg-dim">
        <div className="text-term-fg">AravOS assistant</div>
        <dl className="mt-1.5 grid grid-cols-[7ch_1fr] gap-y-0.5 m-0">
          <dt className="text-term-fg-faint">model</dt>
          <dd className="m-0 truncate">{model ?? "…"}</dd>
          <dt className="text-term-fg-faint">tools</dt>
          <dd className="m-0">tasks · calendar · health · goals · dashboard</dd>
        </dl>
      </div>
      <div>
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
    <div className="shrink-0 flex items-center gap-2 px-3 h-7 text-[11px] leading-none text-term-fg-faint bg-term-bg-raised border-t border-term-line pb-[var(--safe-bottom)] box-content" data-testid="agent-status">
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
