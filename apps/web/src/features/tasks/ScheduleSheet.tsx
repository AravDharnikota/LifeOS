import { useState } from "react";
import { addDays, startOfWeek, format } from "date-fns";
import { parseDateString, toDateString, todayString } from "@aravos/shared";
import { useAppSettings } from "@/data/queries";
import { Sheet } from "@/ui/Sheet";
import { Group, Row } from "@/ui/List";
import { Icon } from "@/ui/Icon";

/** Small "When" picker: Today, Tomorrow, Next week, Pick date, plus Clear when a date is set. */
export function ScheduleSheet({ open, onClose, current, onPick, title = "When" }: { open: boolean; onClose: () => void; current: string | null; onPick: (date: string | null) => void; title?: string }) {
  const { weekStartsOn } = useAppSettings();
  const [picking, setPicking] = useState(false);
  const today = todayString();
  const tomorrow = toDateString(addDays(parseDateString(today), 1));
  const nextWeek = toDateString(addDays(startOfWeek(parseDateString(today), { weekStartsOn }), 7));
  const pick = (d: string | null) => {
    onPick(d);
    setPicking(false);
    onClose();
  };
  const close = () => {
    setPicking(false);
    onClose();
  };
  const trailing = (d: string) => <span className="text-subhead text-secondary tabular">{format(parseDateString(d), "EEE d MMM")}</span>;
  return (
    <Sheet open={open} onClose={close} title={title} leading={null} trailing={<button type="button" className="text-headline text-accent-text px-2 h-11" onClick={close}>Done</button>}>
      <div className="pt-1 pb-2">
        <Group inset={false}>
          <Row title="Today" leading={<Icon name="sun" size={20} className={current === today ? "text-accent-text" : "text-secondary"} />} trailing={trailing(today)} onPress={() => pick(today)} />
          <Row title="Tomorrow" leading={<Icon name="arrow-right" size={20} className="text-secondary" />} trailing={trailing(tomorrow)} onPress={() => pick(tomorrow)} />
          <Row title="Next week" leading={<Icon name="calendar" size={20} className="text-secondary" />} trailing={trailing(nextWeek)} onPress={() => pick(nextWeek)} />
          <Row
            title="Pick date"
            leading={<Icon name="grid" size={20} className="text-secondary" />}
            trailing={picking ? <input type="date" aria-label="Pick date" autoFocus defaultValue={current ?? today} onChange={(e) => e.target.value && pick(e.target.value)} className="text-subhead tabular text-primary bg-transparent outline-none" /> : current ? trailing(current) : undefined}
            chevron={!picking}
            onPress={picking ? undefined : () => setPicking(true)}
          />
          {current && <Row title="Clear date" onPress={() => pick(null)} className="text-danger-text [&_div]:text-danger-text" />}
        </Group>
      </div>
    </Sheet>
  );
}
