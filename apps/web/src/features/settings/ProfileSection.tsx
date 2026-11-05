import { useEffect, useState } from "react";
import type { AppSettings } from "@aravos/shared";
import { Section, ValueRow } from "@/ui/List";
import { FieldRow, Switch } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { fmtClock } from "@/lib/format";
import { useUpdateApp } from "./api";
import { NumberSheet } from "./sheets";
import { IconGroup, IconLabel, RowIcon } from "./parts";

export function ProfileSection({ app }: { app: AppSettings }) {
  const update = useUpdateApp();
  const [name, setName] = useState(app.name);
  const [rest, setRest] = useState(false);
  useEffect(() => setName(app.name), [app.name]);
  const commitName = () => {
    const n = name.trim();
    if (!n) return setName(app.name);
    if (n !== app.name) update.mutate({ name: n });
  };
  return (
    <Section title="Profile" footer="Haptics play on check-ins and stepper ticks.">
      <IconGroup>
        <FieldRow label={<IconLabel icon="user">Name</IconLabel>}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            }}
            enterKeyHint="done"
            autoCapitalize="words"
            aria-label="Name"
            className="w-full max-w-[60%] h-11 text-[16px] text-right text-secondary focus:text-primary bg-transparent outline-none"
            data-testid="name-input"
          />
        </FieldRow>
        <FieldRow label={<IconLabel icon="scale">Units</IconLabel>}>
          <Segmented options={[{ value: "metric", label: "Metric" }, { value: "imperial", label: "Imperial" }]} value={app.units} onChange={(v) => update.mutate({ units: v })} size="sm" className="w-full max-w-[176px]" />
        </FieldRow>
        <FieldRow label={<IconLabel icon="calendar">Week starts</IconLabel>}>
          <Segmented options={[{ value: "1", label: "Monday" }, { value: "0", label: "Sunday" }]} value={String(app.weekStartsOn) as "0" | "1"} onChange={(v) => update.mutate({ weekStartsOn: v === "0" ? 0 : 1 })} size="sm" className="w-full max-w-[176px]" />
        </FieldRow>
        <FieldRow label={<IconLabel icon="clock">Clock</IconLabel>}>
          <Segmented options={[{ value: "24", label: "24-hour" }, { value: "12", label: "12-hour" }]} value={app.hour12 ? "12" : "24"} onChange={(v) => update.mutate({ hour12: v === "12" })} size="sm" className="w-full max-w-[176px]" />
        </FieldRow>
        <FieldRow label={<IconLabel icon="moon">Theme</IconLabel>}>
          <Segmented options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} value={app.theme} onChange={(v) => update.mutate({ theme: v })} size="sm" className="w-full max-w-[228px]" />
        </FieldRow>
        <FieldRow label={<IconLabel icon="bolt">Haptics</IconLabel>}>
          <Switch checked={app.haptics} onChange={(v) => update.mutate({ haptics: v })} label="Haptics" />
        </FieldRow>
        <ValueRow leading={<RowIcon name="timer" />} title="Rest timer" value={fmtClock(app.defaultRestSeconds)} chevron onPress={() => setRest(true)} data-testid="rest-timer" />
      </IconGroup>
      <NumberSheet open={rest} onClose={() => setRest(false)} title="Rest Timer" value={app.defaultRestSeconds} step={5} min={0} max={600} format={fmtClock} onSave={(v) => update.mutate({ defaultRestSeconds: v })} hint="Starts after each set." />
    </Section>
  );
}
