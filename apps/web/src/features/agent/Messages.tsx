import { useState } from "react";
import { cn } from "@/lib/cn";
import { useSpinnerFrame, WorkingLine } from "./Spinner";
import { formatToolArgs } from "./terminal";
import { AgentText } from "./text";
import type { ChatMessage, ChatTool } from "./useAgent";

/**
 * One turn of the transcript on a 2ch gutter grid.
 * User turns are prompt lines (`❯ text`). Assistant turns are tool entries (glyph in the gutter) and then plain text indented under the caret.
 */
export function Turn({ message, onRetry }: { message: ChatMessage; onRetry?: () => void }) {
  if (message.role === "user") {
    return (
      <div data-role="user" className="grid grid-cols-[2ch_1fr]">
        <span aria-hidden="true" className="text-term-prompt select-none">❯</span>
        <div className="min-w-0 text-term-fg whitespace-pre-wrap break-words">{message.text}</div>
        {message.images && message.images.length > 0 && (
          <div className="col-start-2 mt-1.5 flex flex-wrap gap-1.5">
            {message.images.map((src, i) => (
              <img key={i} src={src} alt={`attached image ${i + 1}`} className="w-14 h-14 object-cover rounded-xs border border-term-line" />
            ))}
          </div>
        )}
      </div>
    );
  }
  const empty = !message.text && message.tools.length === 0;
  return (
    <div data-role="assistant" className="flex flex-col gap-0.5">
      {message.tools.map((t) => (
        <ToolEntry key={t.id} tool={t} />
      ))}
      {message.streaming && empty && <WorkingLine>thinking…</WorkingLine>}
      {!empty && (message.text || message.streaming) && (
        <div className="pl-[2ch] text-term-fg break-words">
          <AgentText text={message.text} trailing={message.streaming ? <BlockCursor /> : undefined} />
        </div>
      )}
      {message.cancelled && (
        <div className="pl-[2ch] text-term-fg-faint">
          ^C <span className="text-term-fg-dim">cancelled</span>
        </div>
      )}
      {message.failed && (
        <div className="grid grid-cols-[2ch_1fr]" role="alert">
          <span aria-hidden="true" className="text-term-err select-none">✗</span>
          <div className="text-term-err break-words">
            {message.failed.message}
            {onRetry && (
              <>
                {"  "}
                <button type="button" onClick={onRetry} className="text-term-fg-dim underline underline-offset-2 hover:text-term-fg">
                  retry
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** `⠋ name(args)` while running, `✓` / `✗` when done, `–` when the turn was cancelled before it answered. Click to show the result under a `⎿`. */
function ToolEntry({ tool }: { tool: ChatTool }) {
  const [open, setOpen] = useState(false);
  const frame = useSpinnerFrame(tool.pending);
  const args = formatToolArgs(tool.input);
  const detail = tool.summary?.trim();
  const failed = tool.ok === false;
  const interrupted = !tool.pending && tool.ok === undefined;
  const expandable = Boolean(detail) && !tool.pending;
  const state = tool.pending ? "running" : failed ? "failed" : interrupted ? "interrupted" : "ok";
  return (
    <div className="flex flex-col" data-tool={tool.name} data-state={state}>
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn("grid grid-cols-[2ch_1fr_auto] items-start text-left min-h-[32px] lg:min-h-[24px] py-1.5 lg:py-0.5 -mx-1 px-1 rounded-xs", expandable && "hover:bg-term-bg-hover active:bg-term-bg-hover")}
      >
        <span aria-hidden="true" className={cn("select-none", tool.pending ? "text-term-prompt" : failed ? "text-term-err" : interrupted ? "text-term-fg-faint" : "text-term-ok")}>
          {tool.pending ? frame : failed ? "✗" : interrupted ? "–" : "✓"}
        </span>
        <span className="min-w-0 truncate">
          <span className="text-term-tool">{tool.name}</span>
          <span className="text-term-fg-dim">({args})</span>
        </span>
        {expandable && (
          <span aria-hidden="true" className="text-term-fg-faint pl-2 select-none">
            {open ? "▾" : "▸"}
          </span>
        )}
      </button>
      {open && detail && (
        <div className="grid grid-cols-[2ch_1fr] pb-1 text-term-fg-dim">
          <span aria-hidden="true" className="select-none text-term-fg-faint">⎿</span>
          <pre className="m-0 font-mono whitespace-pre-wrap break-words text-[0.92em] leading-[18px]">{detail}</pre>
        </div>
      )}
    </div>
  );
}

/** Block cursor that blinks on a 1s step; reduced motion keeps it solid. */
export function BlockCursor() {
  return <span aria-hidden="true" className="term-cursor inline-block w-[0.55em] h-[1.05em] bg-term-cursor align-[-0.15em] ml-px" />;
}
