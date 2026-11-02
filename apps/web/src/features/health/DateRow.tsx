import { FieldRow } from "@/ui/Field";
import { fmtRelativeDate } from "@/lib/format";

/** A date row that reads like a person says it ("Today", "Mon 2 Nov"); the native picker sits invisibly on top. */
export function DateRow({ value, onChange, max, label = "Date" }: { value: string; onChange: (d: string) => void; max?: string; label?: string }) {
  return (
    <FieldRow label={label}>
      <span className="relative inline-flex items-center h-11 min-w-[44px] justify-end">
        <span className="text-body text-secondary tabular">{fmtRelativeDate(value)}</span>
        <input type="date" aria-label={label} value={value} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
      </span>
    </FieldRow>
  );
}
