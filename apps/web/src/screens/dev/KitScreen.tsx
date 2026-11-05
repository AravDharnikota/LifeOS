import { useState, type CSSProperties } from "react";
import { Screen } from "@/ui/Screen";
import { Section, Group, Row, ValueRow } from "@/ui/List";
import { Button, IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Checkbox } from "@/ui/Checkbox";
import { Stepper } from "@/ui/Stepper";
import { Ring, Bar } from "@/ui/Ring";
import { Segmented } from "@/ui/Segmented";
import { Sheet, ActionSheet } from "@/ui/Sheet";
import { TextField, Switch, Chip, FieldRow } from "@/ui/Field";
import { toast } from "@/ui/Toast";
import { Empty, Skeleton } from "@/ui/Empty";
import { ArcRing, BigNumber, CapsuleBars, CardHeader, DotBars, Gauge, GlassCard, Legend, SegmentBar, Sparkline, StatusPill, TickBars, Trend, Wave } from "@/ui/viz";

/** Internal component gallery at /dev/kit. Not linked from the app. */
export default function KitScreen() {
  const [checked, setChecked] = useState(false);
  const [n, setN] = useState(135);
  const [seg, setSeg] = useState("W");
  const [sheet, setSheet] = useState(false);
  const [sheetL, setSheetL] = useState(false);
  const [act, setAct] = useState(false);
  const [sw, setSw] = useState(true);
  return (
    <Screen title="Kit" subtitle="Component gallery" actions={<IconButton label="Add" tinted><Icon name="plus" /></IconButton>}>
      <Section title="Glass kit" footer="ui/viz.tsx. Charts carry the color; chrome stays neutral.">
        <div className="px-[var(--gutter)] grid grid-cols-1 sm:grid-cols-2 gap-3">
          <GlassCard className="rise">
            <CardHeader icon="bolt" title="Energy" sub="Last 7 days" trailing={<StatusPill tone="success" dot>Live</StatusPill>} />
            <div className="flex items-baseline gap-2 mt-3">
              <BigNumber value="2,410" unit="kcal" />
              <Trend value="18%" up />
            </div>
            <TickBars className="mt-3" values={[3, 5, 4, 6, 7, 5, 8, 6, 9, 7, 5, 6, 8, 4, 3, 2, 4, 5]} current={11} accentAt={{ 7: "var(--danger)" }} />
          </GlassCard>
          <GlassCard className="rise" style={{ "--i": 1 } as CSSProperties}>
            <CardHeader icon="drop" title="Water" sub="Today" trailing={<StatusPill tone="warning">On going</StatusPill>} />
            <BigNumber className="mt-3" value="1.7" unit="L" />
            <Sparkline className="mt-2" values={[2, 3, 2.5, 4, 3.6, 5, 4.4, 6]} color="var(--water)" />
          </GlassCard>
          <GlassCard className="rise flex flex-col items-center" style={{ "--i": 2 } as CSSProperties}>
            <Gauge value={0.94} size={170} label="Coverage 94%">
              <BigNumber value="94%" size={30} />
            </Gauge>
          </GlassCard>
          <GlassCard className="rise" style={{ "--i": 3 } as CSSProperties}>
            <CardHeader icon="bars" title="Activity" sub="Weekly" />
            <CapsuleBars className="mt-3" values={[23, 55, 50, 70, 40, 65, 30]} labels={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]} max={100} height={110} activeIndex={3} showPct />
          </GlassCard>
          <GlassCard className="rise sm:col-span-2" style={{ "--i": 4 } as CSSProperties}>
            <CardHeader icon="target" title="Forecast" />
            <SegmentBar className="mt-3" segments={[{ value: 60, color: "var(--water)", style: "ticks" }, { value: 30, color: "var(--energy)", style: "solid" }, { value: 45, color: "var(--protein)", style: "cells" }]} />
            <div className="flex gap-4 mt-3">
              <Legend color="var(--water)">Unused</Legend>
              <Legend color="var(--energy)">Used</Legend>
              <Legend color="var(--protein)">Reserved</Legend>
            </div>
            <div className="flex gap-6 mt-4 items-center">
              <ArcRing progress={0.62} size={72} stroke={6} color="var(--accent)" color2="var(--accent-2)"><span className="num text-[18px]">62%</span></ArcRing>
              <DotBars className="flex-1" values={[3, 5, 2, 6, 4, 7, 5, 3, 6, 4]} color="var(--carbs)" />
            </div>
            <Wave className="mt-3" colors={["var(--accent)", "var(--energy)"]} />
          </GlassCard>
        </div>
      </Section>
      <Section title="Buttons">
        <div className="px-[var(--gutter)] flex flex-col gap-3">
          <Button variant="primary" size="lg" full>Start Workout</Button>
          <div className="flex gap-3">
            <Button variant="secondary">Add Set</Button>
            <Button variant="plain">Skip</Button>
            <Button variant="destructive">Delete</Button>
            <Button variant="secondary" loading>Save</Button>
          </div>
        </div>
      </Section>
      <Section title="Rows" footer="Rows are 44px minimum with hairlines inset to the text edge.">
        <Group>
          <Row leading={<Checkbox checked={checked} onChange={setChecked} />} title="Call dentist" subtitle="Tomorrow 16:00" trailing="30m" />
          <Row title="Bench Press (Barbell)" subtitle="3 sets · 60 kg x 8" chevron onPress={() => toast("Opened")} />
          <ValueRow title="Rest timer" value="1:30" chevron onPress={() => undefined} />
          <FieldRow label="Haptics"><Switch checked={sw} onChange={setSw} /></FieldRow>
        </Group>
      </Section>
      <Section title="Numbers">
        <div className="px-[var(--gutter)] flex items-center gap-6">
          <Ring progress={0.72} size={100} stroke={10} color="var(--energy)" label="Calories, 1,840 of 2,400">
            <span className="num text-title-1">1,840</span>
            <span className="text-footnote text-secondary">kcal</span>
          </Ring>
          <Ring progress={1.2} size={56} stroke={6} color="var(--protein)"><span className="num text-footnote">120%</span></Ring>
          <div className="flex-1 flex flex-col gap-3">
            <Bar progress={0.45} color="var(--carbs)" />
            <Bar progress={0.8} color="var(--fat)" />
            <Bar progress={0.3} color="var(--water)" />
          </div>
        </div>
        <div className="px-[var(--gutter)] mt-6">
          <Stepper value={n} onChange={setN} step={2.5} unit="lb" size="lg" />
        </div>
      </Section>
      <Section title="Controls">
        <div className="px-[var(--gutter)] flex flex-col gap-4">
          <Segmented options={[{ value: "D", label: "Day" }, { value: "W", label: "Week" }, { value: "M", label: "Month" }, { value: "Y", label: "Year" }]} value={seg} onChange={setSeg} />
          <TextField label="Weight" placeholder="72.5" inputMode="decimal" trailing={<span className="text-subhead text-secondary">kg</span>} />
          <TextField label="Search" placeholder="Search foods" leading={<Icon name="search" size={18} className="text-tertiary" />} />
          <div className="flex gap-2 flex-wrap">
            <Chip selected>250 ml</Chip>
            <Chip>500 ml</Chip>
            <Chip>750 ml</Chip>
            <Chip color="var(--cal-green)">Personal</Chip>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => setSheet(true)}>Open Sheet</Button>
            <Button onClick={() => setSheetL(true)}>Large Sheet</Button>
            <Button onClick={() => setAct(true)}>Action Sheet</Button>
            <Button onClick={() => toast("Workout saved.", { label: "Undo", onPress: () => undefined })}>Toast</Button>
          </div>
        </div>
      </Section>
      <Section title="Calendar fills">
        <div className="px-[var(--gutter)] grid grid-cols-4 gap-2">
          {["blue", "green", "yellow", "orange", "red", "pink", "purple", "gray"].map((c) => (
            <div key={c} className="cal-fill rounded-xs px-2 py-1.5 text-footnote font-medium" style={{ ["--cal-color" as string]: `var(--cal-${c})` }}>
              {c}
              <div className="text-caption-1 font-normal opacity-80">09:00</div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="States">
        <Skeleton rows={2} />
        <Empty action={<Button variant="plain">Add Task</Button>}>No tasks today.</Empty>
      </Section>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Log Water" trailing={<button type="button" className="text-headline text-accent-text px-2 h-11" onClick={() => setSheet(false)}>Done</button>}>
        <div className="py-4"><Stepper value={n} onChange={setN} step={50} unit="ml" size="lg" /></div>
        <div className="flex gap-2 justify-center"><Chip>250</Chip><Chip selected>500</Chip><Chip>750</Chip></div>
      </Sheet>
      <Sheet open={sheetL} onClose={() => setSheetL(false)} title="Edit Task" detent="large" dirty trailing={<button type="button" className="text-headline text-accent-text px-2 h-11" onClick={() => setSheetL(false)}>Done</button>}>
        <div className="flex flex-col gap-4 py-4">
          <TextField label="Title" defaultValue="Write report" />
          <TextField label="When" defaultValue="Tomorrow" />
        </div>
      </Sheet>
      <ActionSheet open={act} onClose={() => setAct(false)} title="Delete this workout?" message="This cannot be undone." actions={[{ label: "Delete Workout", destructive: true, onPress: () => toast("Deleted") }]} />
    </Screen>
  );
}
