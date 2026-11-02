import { useEffect, useState, type ReactNode } from "react";
import { Sheet } from "@/ui/Sheet";
import { Stepper } from "@/ui/Stepper";
import { Icon } from "@/ui/Icon";
import { cn } from "@/lib/cn";

/** Trailing "Done" for sheet headers. */
export function SheetDone({ onClick, disabled, label = "Done", testId }: { onClick: () => void; disabled?: boolean; label?: string; testId?: string }) {
  return (
    <button type="button" className="text-headline text-accent-text px-2 h-11 active:opacity-60 disabled:opacity-40" disabled={disabled} onClick={onClick} data-testid={testId}>
      {label}
    </button>
  );
}

export interface NumberSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  value: number;
  onSave: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  format?: (v: number) => string;
  hint?: ReactNode;
}

/** One hero number with a stepper. Done saves; Cancel or swipe discards. */
export function NumberSheet({ open, onClose, title, value, onSave, step = 1, min = 0, max = Infinity, unit, format, hint }: NumberSheetProps) {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (open) setV(value);
  }, [open, value]);
  return (
    <Sheet open={open} onClose={onClose} title={title} dirty={v !== value} trailing={<SheetDone onClick={() => { onSave(v); onClose(); }} testId="number-done" />}>
      <div className="pt-6 pb-4">
        <Stepper value={v} onChange={setV} step={step} min={min} max={max} unit={unit} format={format} size="lg" label={title} />
        {hint && <p className="text-footnote text-secondary text-center mt-4">{hint}</p>}
      </div>
    </Sheet>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** A list of choices with a check on the current one. Selecting closes the sheet. */
export function OptionSheet<T extends string>({ open, onClose, title, value, options, onSelect }: { open: boolean; onClose: () => void; title: string; value: T | null; options: Option<T>[]; onSelect: (v: T) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} leading={null}>
      <div className="pt-1 pb-2">
        <div className="rounded-md overflow-hidden group-rows bg-surface-2">
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className="row-sep relative w-full flex items-center gap-3 min-h-[44px] pl-4 pr-3 text-left active:bg-pressed transition-colors duration-100"
                onClick={() => {
                  onSelect(o.value);
                  onClose();
                }}
              >
                <span className="flex-1 min-w-0 py-[11px]">
                  <span className={cn("block text-body", selected ? "text-primary" : "text-primary")}>{o.label}</span>
                  {o.hint && <span className="block text-subhead text-secondary mt-0.5">{o.hint}</span>}
                </span>
                <span className={cn("w-6 shrink-0 text-accent-text", !selected && "invisible")}>
                  <Icon name="check" size={20} strokeWidth={2.25} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

/** Inline native time or date input used inside FieldRow. */
export function InlineInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("h-8 px-2 rounded-sm bg-surface-2 text-body text-primary outline-none focus:bg-surface focus:shadow-[0_0_0_1.5px_var(--accent)] tabular", className)} {...rest} />;
}
