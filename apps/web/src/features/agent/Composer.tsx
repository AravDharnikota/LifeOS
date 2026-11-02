import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/hooks";
import { Icon } from "@/ui/Icon";
import { Spinner } from "@/ui/Spinner";
import { prepareImage, type Attachment } from "./images";

const LINE = 22;
const MAX_LINES = 5;

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  attachments: Attachment[];
  onAttachments: (a: Attachment[]) => void;
  onSend: () => void;
  disabled?: boolean;
  sending?: boolean;
  onFocus?: () => void;
}

/** Multiline field that grows to five lines, an image button and a send glyph tinted when there is something to send. */
export function Composer({ value, onChange, attachments, onAttachments, onSend, disabled, sending, onFocus }: ComposerProps) {
  const isDesktop = useIsDesktop();
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const canSend = !disabled && !sending && (value.trim().length > 0 || attachments.length > 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, LINE * MAX_LINES + 20)}px`;
  }, [value]);

  useEffect(() => {
    if (isDesktop && !disabled) ref.current?.focus();
  }, [isDesktop, disabled]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && isDesktop && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
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

  return (
    <div className={cn("shrink-0 flex flex-col gap-2 pt-2", disabled && "opacity-40 pointer-events-none")}>
      {attachments.length > 0 && (
        <div className="flex gap-2 px-1">
          {attachments.map((a) => (
            <button key={a.id} type="button" aria-label="Remove image" onClick={() => onAttachments(attachments.filter((x) => x.id !== a.id))} className="relative w-12 h-12 rounded-sm overflow-hidden bg-surface-2 pressable">
              <img src={a.dataUrl} alt="" className="w-full h-full object-cover" />
              <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-primary text-canvas inline-flex items-center justify-center">
                <Icon name="x" size={10} strokeWidth={2.5} />
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1">
        <button type="button" aria-label="Attach image" disabled={disabled || attachments.length >= 4} onClick={() => fileRef.current?.click()} className="hit-44 w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-md text-secondary active:bg-pressed transition-colors duration-100 disabled:opacity-40">
          {preparing ? <Spinner size={18} /> : <Icon name="image" size={22} />}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void pick(e)} />
        <div className="flex-1 min-w-0 flex items-end bg-surface-2 rounded-md border border-transparent focus-within:border-accent transition-colors duration-150 min-h-[44px] pl-3 pr-1">
          <textarea
            ref={ref}
            value={value}
            rows={1}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKey}
            onFocus={onFocus}
            disabled={disabled}
            placeholder="Message"
            aria-label="Message"
            enterKeyHint={isDesktop ? "send" : "enter"}
            autoCapitalize="sentences"
            className="flex-1 min-w-0 resize-none bg-transparent text-body text-primary outline-none py-[10px] leading-[22px] max-h-[130px] scroller no-scrollbar"
          />
          <button type="button" aria-label="Send" disabled={!canSend} onClick={onSend} className={cn("hit-44 w-11 h-11 shrink-0 -mr-1 inline-flex items-center justify-center rounded-md transition-colors duration-150", canSend ? "text-accent-text" : "text-quaternary")}>
            {sending ? <Spinner size={18} className="text-secondary" /> : <Icon name="send" size={22} />}
          </button>
        </div>
      </div>
    </div>
  );
}
