import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { Icon } from "@/ui/Icon";
import { Spinner } from "@/ui/Spinner";
import { AgentText } from "./text";
import { toolLabel } from "./tools";
import type { ChatMessage, ChatTool } from "./useAgent";

/** User text right-aligned on a surface, assistant text plain on the canvas, tool activity as footnotes. */
export function MessageItem({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1.5" data-role="user">
        {message.images?.map((src, i) => (
          <img key={i} src={src} alt="" className="max-w-[60%] max-h-48 rounded-lg object-cover" />
        ))}
        {message.text && <div className="max-w-[85%] bg-surface-2 rounded-lg px-3.5 py-2.5 text-body text-primary whitespace-pre-wrap break-words">{message.text}</div>}
      </div>
    );
  }
  const empty = !message.text && message.tools.length === 0;
  return (
    <div className="flex flex-col gap-1.5 items-start max-w-full" data-role="assistant">
      {message.tools.length > 0 && (
        <div className="flex flex-col gap-1 w-full">
          {message.tools.map((t) => (
            <ToolLine key={t.id} tool={t} />
          ))}
        </div>
      )}
      {(message.text || message.streaming) && (
        <div className="text-body text-primary break-words max-w-full">
          <AgentText text={message.text} />
          {message.streaming && <Cursor inline={Boolean(message.text) && !empty} />}
        </div>
      )}
      {message.streaming && empty && (
        <div className="flex items-center gap-2 text-footnote text-tertiary h-5">
          <Cursor />
        </div>
      )}
    </div>
  );
}

function ToolLine({ tool }: { tool: ChatTool }) {
  const [open, setOpen] = useState(false);
  const label = toolLabel(tool.name, tool.input, tool.pending);
  const failed = tool.ok === false;
  const detail = tool.summary?.trim();
  return (
    <div className="flex flex-col">
      <button
        type="button"
        disabled={!detail}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn("flex items-center gap-1.5 min-h-[28px] text-left text-footnote", failed ? "text-danger-text" : "text-secondary", detail && "active:opacity-60")}
      >
        {tool.pending ? <Spinner size={12} className="text-tertiary" /> : <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", failed ? "bg-danger" : "bg-quaternary")} />}
        <span className="truncate">{failed ? `Could not: ${label.toLowerCase()}` : label}</span>
        {detail && <Icon name={open ? "chevron-up" : "chevron-down"} size={14} className="text-quaternary shrink-0" />}
      </button>
      {open && detail && <div className="pl-3 pb-1 text-caption-1 text-tertiary whitespace-pre-wrap break-words">{detail}</div>}
    </div>
  );
}

/** A 2px bar that blinks slowly. Opacity only, so reduced motion is respected. */
function Cursor({ inline }: { inline?: boolean }) {
  return <motion.span aria-hidden="true" className={cn("inline-block w-[2px] h-[1em] bg-primary align-text-bottom rounded-full", inline ? "ml-0.5" : "")} animate={{ opacity: [1, 1, 0.15, 0.15, 1] }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear", times: [0, 0.45, 0.5, 0.95, 1] }} />;
}
