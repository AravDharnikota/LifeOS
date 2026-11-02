import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useSettings } from "@/data/queries";
import { useHotkey, useIsDesktop } from "@/lib/hooks";
import { useUi } from "@/state/ui";
import { Button, IconButton } from "@/ui/Button";
import { InlineError, Skeleton } from "@/ui/Empty";
import { Icon } from "@/ui/Icon";
import { Sheet } from "@/ui/Sheet";
import { Composer } from "./Composer";
import type { Attachment } from "./images";
import { MessageItem } from "./Messages";
import { ThreadList } from "./ThreadList";
import { useChat } from "./useAgent";

const SUGGESTIONS = ["What is left today", "Add a coffee counter", "Plan my day"];

/** Keyboard inset from the visual viewport, so the composer stays above the keyboard on iOS. */
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

/** The assistant: a large sheet on the phone, a right-side panel on the desktop. */
export function AgentSheet() {
  const open = useUi((s) => s.agentOpen);
  const prefill = useUi((s) => s.agentPrefill);
  const openAgent = useUi((s) => s.openAgent);
  const close = useUi((s) => s.closeAgent);
  const isDesktop = useIsDesktop();
  const toggle = useCallback(() => (open ? close() : openAgent()), [open, close, openAgent]);
  useHotkey("k", toggle, { meta: true, enabled: isDesktop });

  const [view, setView] = useState<"chat" | "threads">("chat");
  useEffect(() => {
    if (!open) setView("chat");
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={close}
      title={view === "threads" ? "Threads" : "Assistant"}
      detent="large"
      desktop="panel"
      leading={
        view === "threads" ? (
          <IconButton label="Back" onClick={() => setView("chat")}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        ) : (
          <button type="button" className="text-body text-accent-text px-2 h-11" onClick={() => setView("threads")}>
            Threads
          </button>
        )
      }
      trailing={
        <button type="button" className="text-headline text-accent-text px-2 h-11" onClick={close}>
          Done
        </button>
      }
    >
      {open && <AgentBody view={view} onView={setView} prefill={prefill} />}
    </Sheet>
  );
}

function AgentBody({ view, onView, prefill }: { view: "chat" | "threads"; onView: (v: "chat" | "threads") => void; prefill: string | null }) {
  const navigate = useNavigate();
  const close = useUi((s) => s.closeAgent);
  const settings = useSettings();
  const configured = settings.data?.integrations.anthropic.configured ?? true;
  const chat = useChat(true);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inset = useKeyboardInset(view === "chat");

  useEffect(() => {
    if (prefill) setDraft(prefill);
  }, [prefill]);

  // Follow the stream while the reader is at the bottom.
  const lastText = chat.messages[chat.messages.length - 1]?.text;
  const count = chat.messages.length;
  useEffect(() => {
    const el = listRef.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [count, lastText, view]);

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

  const empty = chat.messages.length === 0 && !chat.loading;
  return (
    <div className="h-full flex flex-col" style={inset ? { paddingBottom: inset } : undefined} data-testid="agent-chat">
      {!configured && (
        <div className="mt-2 mb-1 rounded-md bg-surface-2 px-3.5 py-3 flex items-start justify-between gap-3" role="status">
          <p className="text-footnote text-secondary">Assistant needs an API key. Add ANTHROPIC_API_KEY on the server.</p>
          <button type="button" className="text-footnote text-accent-text font-medium shrink-0 min-h-[20px]" onClick={() => { close(); navigate("/settings"); }}>
            Settings
          </button>
        </div>
      )}
      <div ref={listRef} onScroll={onScroll} className="flex-1 min-h-0 scroller -mx-[var(--gutter)] px-[var(--gutter)]" data-testid="agent-messages">
        {chat.loading ? (
          <Skeleton rows={3} className="mx-0 mt-4" />
        ) : chat.error ? (
          <InlineError onRetry={() => void chat.refetch()}>Unable to load the conversation.</InlineError>
        ) : empty ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-5 pb-8">
            <p className="text-callout text-secondary max-w-[30ch]">Ask about the day or change the dashboard.</p>
            <div className="flex flex-wrap justify-center gap-2 max-w-[360px]">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="secondary" size="sm" className="font-medium" disabled={!configured} onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 py-3">
            {chat.messages.map((m) => (
              <MessageItem key={m.id} message={m} />
            ))}
            {chat.messages.some((m) => m.failed) && <InlineError onRetry={chat.retry}>{chat.messages.find((m) => m.failed)?.failed?.message}</InlineError>}
          </div>
        )}
      </div>
      <Composer
        value={draft}
        onChange={setDraft}
        attachments={attachments}
        onAttachments={setAttachments}
        onSend={() => send()}
        sending={chat.sending}
        disabled={!configured}
        onFocus={() => {
          window.setTimeout(() => {
            const el = listRef.current;
            if (el && stick.current) el.scrollTop = el.scrollHeight;
          }, 300);
        }}
      />
    </div>
  );
}

