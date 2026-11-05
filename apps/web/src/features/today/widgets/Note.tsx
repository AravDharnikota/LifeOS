import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useLayoutActions } from "../useLayoutActions";
import type { WidgetOf, WidgetProps } from "../types";
import { WidgetLabel, WriteError } from "./shared";

/** Freeform text. Tap to edit in place; saves on blur or Done. */
export function NoteWidget({ widget, editing }: WidgetProps<WidgetOf<"note">>) {
  const actions = useLayoutActions();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(widget.text);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) setDraft(widget.text);
  }, [widget.text, open]);
  useEffect(() => {
    if (open) {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }
    }
  }, [open]);

  const save = async () => {
    setOpen(false);
    const text = draft.trim();
    if (text === widget.text) return;
    setError(false);
    try {
      await actions.updateWidget(widget.id, { text });
    } catch {
      setError(true);
    }
  };

  const lines = widget.text.split("\n").filter((l, i, a) => l.trim() || (i > 0 && a[i - 1]?.trim()));
  return (
    <>
      <WidgetLabel>{widget.title ?? "Note"}</WidgetLabel>
      {open ? (
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setDraft(widget.text); setOpen(false); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          }}
          maxLength={2000}
          aria-label="Note"
          className="flex-1 w-full resize-none well rounded-md px-3 py-2 text-[15px] text-primary outline-none leading-[22px] min-h-[66px]"
        />
      ) : (
        <button type="button" disabled={editing} onClick={() => setOpen(true)} className={cn("flex-1 flex flex-col items-stretch justify-start text-left rounded-md -m-1 p-1 min-h-[44px] active:bg-pressed transition-colors duration-100", editing && "pointer-events-none")} aria-label="Edit note">
          {widget.text.trim() ? (
            <div className="text-[15px] leading-[22px] text-primary whitespace-pre-wrap break-words">{lines.join("\n")}</div>
          ) : (
            <span className="text-[15px] leading-[22px] text-tertiary">Add a note</span>
          )}
        </button>
      )}
      {error && <WriteError message="Unable to save note." onRetry={() => void save()} />}
    </>
  );
}
