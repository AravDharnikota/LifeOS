import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/hooks";
import { Icon } from "@/ui/Icon";
import { prepareImage, type Attachment } from "./images";
import { useSpinnerFrame } from "./Spinner";
import { stepHistory } from "./terminal";

const LINE = 20;
const MAX_LINES = 6;

export interface PromptLineProps {
  value: string;
  onChange: (v: string) => void;
  attachments: Attachment[];
  onAttachments: (a: Attachment[]) => void;
  onSend: () => void;
  onCancel: () => void;
  /** Earlier prompts, newest first, for ↑ / ↓ recall. */
  history: string[];
  disabled?: boolean;
  sending?: boolean;
  onFocus?: () => void;
}

/**
 * The prompt: `❯` caret, a bare textarea that grows to six lines, an attach glyph and (on touch) a send key.
 * Enter sends, Shift+Enter breaks the line, Esc cancels a running turn, ↑ / ↓ walk the prompt history like a shell.
 */
export function PromptLine({ value, onChange, attachments, onAttachments, onSend, onCancel, history, disabled, sending, onFocus }: PromptLineProps) {
  const isDesktop = useIsDesktop();
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const savedDraft = useRef("");
  const frame = useSpinnerFrame(preparing);
  const canSend = !disabled && !sending && (value.trim().length > 0 || attachments.length > 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, LINE * MAX_LINES + 12)}px`;
  }, [value]);

  useEffect(() => {
    if (isDesktop && !disabled) ref.current?.focus();
  }, [isDesktop, disabled]);

  /** Replace the draft with a history entry; the live draft is kept so ↓ past the newest entry restores it. */
  const recall = (direction: "older" | "newer"): boolean => {
    const next = stepHistory(history.length, histIdx, direction);
    if (next === histIdx) return false;
    if (histIdx === null) savedDraft.current = value;
    setHistIdx(next);
    onChange(next === null ? savedDraft.current : (history[next] ?? ""));
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });
    return true;
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        setHistIdx(null);
        onSend();
      }
      return;
    }
    if (e.key === "Escape" && sending) {
      // Stop here so the sheet does not also close.
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const el = e.currentTarget;
    const firstBreak = value.indexOf("\n");
    const onFirstLine = el.selectionStart <= (firstBreak === -1 ? value.length : firstBreak);
    const onLastLine = el.selectionEnd >= value.lastIndexOf("\n") + 1;
    if (e.key === "ArrowUp" && (value === "" || (histIdx !== null && onFirstLine))) {
      if (recall("older")) e.preventDefault();
    } else if (e.key === "ArrowDown" && histIdx !== null && onLastLine) {
      e.preventDefault();
      recall("newer");
    }
  };

  const onInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (histIdx !== null) setHistIdx(null);
    onChange(e.target.value);
  };

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 4 - attachments.length);
    e.target.value = "";
    if (!files.length) return;
    setPreparing(true);
    try {
      const prepared = await Promise.all(files.map(prepareImage));
      onAttachments([...attachments, ...prepared]);
    } catch {
      /* unreadable file: nothing to attach */
    } finally {
      setPreparing(false);
    }
  };

  const glyphButton = "shrink-0 inline-flex items-center justify-center w-11 h-11 lg:w-8 lg:h-8 rounded-xs transition-colors duration-100 disabled:opacity-40";

  return (
    <div className={cn("shrink-0 flex flex-col border-t border-term-line", disabled && "opacity-50")} data-testid="agent-prompt">
      {attachments.length > 0 && (
        <div className="flex gap-1.5 pt-2 pl-[calc(12px+2ch)] pr-3">
          {attachments.map((a) => (
            <button key={a.id} type="button" aria-label="Remove image" onClick={() => onAttachments(attachments.filter((x) => x.id !== a.id))} className="relative w-12 h-12 rounded-xs overflow-hidden border border-term-line pressable">
              <img src={a.dataUrl} alt="" className="w-full h-full object-cover" />
              <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-term-fg text-term-bg inline-flex items-center justify-center">
                <Icon name="x" size={10} strokeWidth={2.5} />
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-start px-3">
        <span aria-hidden="true" className={cn("w-[2ch] shrink-0 select-none pt-3 lg:pt-1.5 transition-colors duration-150", sending ? "text-term-fg-faint" : "text-term-prompt")}>
          ❯
        </span>
        <textarea
          ref={ref}
          value={value}
          rows={1}
          onChange={onInput}
          onKeyDown={onKey}
          onFocus={onFocus}
          disabled={disabled}
          placeholder={sending ? "" : "type a message"}
          aria-label="Message"
          enterKeyHint="send"
          autoCapitalize="sentences"
          spellCheck={false}
          className="flex-1 min-w-0 resize-none bg-transparent text-term-fg placeholder:text-term-fg-faint caret-term-prompt outline-none py-3 lg:py-1.5 leading-[20px] max-h-[132px] scroller no-scrollbar"
        />
        <div className="flex items-center shrink-0 -mr-2">
          <button type="button" aria-label="Attach image" disabled={disabled || attachments.length >= 4} onClick={() => fileRef.current?.click()} className={cn(glyphButton, "text-term-fg-faint hover:text-term-fg-dim")}>
            {preparing ? <span className="text-term-prompt">{frame}</span> : <Icon name="image" size={16} />}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void pick(e)} />
          {sending ? (
            <button type="button" aria-label="Cancel" onClick={onCancel} className={cn(glyphButton, "text-term-err")}>
              <span aria-hidden="true" className="block w-[10px] h-[10px] bg-current rounded-[1px]" />
            </button>
          ) : (
            !isDesktop && (
              <button type="button" aria-label="Send" disabled={!canSend} onClick={onSend} className={cn(glyphButton, canSend ? "text-term-prompt" : "text-term-fg-faint")}>
                <Icon name="arrow-up" size={18} strokeWidth={2.2} />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
