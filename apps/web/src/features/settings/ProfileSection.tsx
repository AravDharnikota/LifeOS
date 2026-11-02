import { useEffect, useState } from "react";
import type { AppSettings } from "@aravos/shared";
import { Section, Group, ValueRow } from "@/ui/List";
import { FieldRow, Switch } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { fmtClock } from "@/lib/format";
import { useUpdateApp } from "./api";
import { NumberSheet } from "./sheets";

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
      <Group>
        <FieldRow label="Name">
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
            className="w-full max-w-[60%] h-11 text-body text-right text-secondary focus:text-primary bg-transparent outline-none"
            data-testid="name-input"
          />
        </FieldRow>
        <FieldRow label="Units">
          <Segmented options={[{ value: "metric", label: "Metric" }, { value: "imperial", label: "Imperial" }]} value={app.units} onChange={(v) => update.mutate({ units: v })} className="w-[176px]" />
        </FieldRow>
        <FieldRow label="Week starts">
          <Segmented options={[{ value: "1", label: "Monday" }, { value: "0", label: "Sunday" }]} value={String(app.weekStartsOn) as "0" | "1"} onChange={(v) => update.mutate({ weekStartsOn: v === "0" ? 0 : 1 })} className="w-[176px]" />
        </FieldRow>
        <FieldRow label="Clock">
          <Segmented options={[{ value: "24", label: "24-hour" }, { value: "12", label: "12-hour" }]} value={app.hour12 ? "12" : "24"} onChange={(v) => update.mutate({ hour12: v === "12" })} className="w-[176px]" />
        </FieldRow>
        <FieldRow label="Theme">
          <Segmented options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} value={app.theme} onChange={(v) => update.mutate({ theme: v })} className="w-[216px]" />
        </FieldRow>
        <FieldRow label="Haptics">
          <Switch checked={app.haptics} onChange={(v) => update.mutate({ haptics: v })} label="Haptics" />
        </FieldRow>
        <ValueRow title="Rest timer" value={fmtClock(app.defaultRestSeconds)} chevron onPress={() => setRest(true)} data-testid="rest-timer" />
      </Group>
      <NumberSheet open={rest} onClose={() => setRest(false)} title="Rest Timer" value={app.defaultRestSeconds} step={5} min={0} max={600} format={fmtClock} onSave={(v) => update.mutate({ defaultRestSeconds: v })} hint="Starts after each set." />
    </Section>
  );
}
