import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router";
import { addDays, format, isSameDay, parseISO, startOfWeek } from "date-fns";
import type { WorkoutListItem, WorkoutStats, WorkoutTemplate } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Button, IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Row, Section, SectionHeader } from "@/ui/List";
import { Sheet, ActionSheet } from "@/ui/Sheet";
import { Menu, type MenuItem } from "@/ui/Menu";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { TextField, Chip } from "@/ui/Field";
import { BigNumber, CapsuleBars, CardHeader, DotBars, GlassCard, StatusPill, TickBars, Trend } from "@/ui/viz";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { fmtRelativeDate } from "@/lib/format";
import { impact } from "@/lib/haptics";
import { useIsDesktop, useLongPress } from "@/lib/hooks";
import { useAppSettings } from "@/data/queries";
import { useActiveWorkout, useDeleteTemplate, useDuplicateTemplate, usePatchTemplate, useTemplates, useWorkoutStats, useWorkouts } from "./api";
import { fmtPrValue, fmtSetValues, fmtVolume, plural, prLabel, supersetColor, WORKOUTS, type Units } from "./lib";
import { SettingsSheet } from "./SettingsSheet";
import { useStartFlow, WorkoutRow } from "./common";

const EXAMPLE_FOLDER = "Example Templates";

/** "1,240 lb" -> ["1,240", "lb"]; "1:30" -> ["1:30", undefined]. For BigNumber value + small unit. */
function splitUnit(text: string): [string, string | undefined] {
  const m = /^([\d.,:]+)\s+(.+)$/.exec(text);
  return m ? [m[1]!, m[2]] : [text, undefined];
}

/** Past volumes of each template, oldest first (from the recent workout list). */
function useTemplateVolumes(list: WorkoutListItem[] | undefined): Map<string, number[]> {
  return useMemo(() => {
    const map = new Map<string, number[]>();
    const sorted = [...(list ?? [])].sort((a, b) => Date.parse(a.finishedAt ?? a.startedAt) - Date.parse(b.finishedAt ?? b.startedAt));
    for (const w of sorted) {
      if (!w.templateId) continue;
      map.set(w.templateId, [...(map.get(w.templateId) ?? []), w.totalVolume ?? 0]);
    }
    return map;
  }, [list]);
}

export default function HubScreen() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const templates = useTemplates();
  const active = useActiveWorkout();
  const recent = useWorkouts(50);
  const { start, pending } = useStartFlow();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [settings, setSettings] = useState(false);
  const [preview, setPreview] = useState<WorkoutTemplate | null>(null);
  const volumes = useTemplateVolumes(recent.data);

  const folders = useMemo(() => {
    const map = new Map<string, WorkoutTemplate[]>();
    for (const t of templates.data ?? []) {
      const key = t.folder ?? "";
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    const mine = map.get("") ?? [];
    map.delete("");
    const examples = map.get(EXAMPLE_FOLDER) ?? [];
    map.delete(EXAMPLE_FOLDER);
    const others = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return { mine, others, examples };
  }, [templates.data]);

  const hubMenu: MenuItem[] = [
    { label: "History", icon: "clock", onPress: () => navigate(`${WORKOUTS}/history`) },
    { label: "Exercises", icon: "dumbbell", onPress: () => navigate(`${WORKOUTS}/exercises`) },
    { label: "Settings", icon: "gear", onPress: () => setSettings(true) },
  ];
  // The one hero action floats in the thumb zone. While a workout runs, the resume bar takes that spot instead.
  const showStart = !active.data;

  return (
    <Screen
      title="Workouts"
      back="/health"
      contentClassName={cn(showStart && "wk-with-float")}
      actions={
        <IconButton label="More" className="glass !min-w-0 !min-h-0 w-10 h-10" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left + r.width / 2, y: r.bottom }); }}>
          <Icon name="more" size={20} />
        </IconButton>
      }
    >
      <div className={cn(isDesktop && "max-w-[960px]")}>
        <WeekCard list={recent.data} />

        <Section
          title="My Templates"
          className="!mt-7"
          action={
            <button type="button" className="text-[13px] text-accent-text pb-0.5 inline-flex items-center gap-1" onClick={() => navigate(`${WORKOUTS}/templates/new`)}>
              <Icon name="plus" size={14} strokeWidth={1.8} />
              New Template
            </button>
          }
        >
          {templates.isPending ? (
            <Skeleton rows={2} />
          ) : templates.isError ? (
            <InlineError onRetry={() => void templates.refetch()}>Unable to load templates.</InlineError>
          ) : folders.mine.length === 0 ? (
            <GlassCard className="mx-[var(--gutter)] rise">
              <div className="text-[15px] text-primary">No templates yet</div>
              <div className="text-[13px] text-tertiary mt-1">Create one, or start from an example below.</div>
            </GlassCard>
          ) : (
            <TemplateGrid templates={folders.mine} volumes={volumes} onOpen={setPreview} onStart={start} />
          )}
        </Section>

        {folders.others.map(([name, list]) => (
          <FolderSection key={name} name={name} templates={list} volumes={volumes} onOpen={setPreview} onStart={start} />
        ))}
        {folders.examples.length > 0 && <FolderSection name={EXAMPLE_FOLDER} templates={folders.examples} volumes={volumes} collapsed onOpen={setPreview} onStart={start} />}

        <StatsSection />
        <RecentHistory />
      </div>

      {showStart && (
        <div className="wk-float wk-float-in px-[var(--gutter)]">
          <Button variant="primary" size="lg" full loading={pending} onClick={() => start(null)} data-testid="start-empty" leading={<Icon name="plus" size={18} strokeWidth={1.8} />} className="!bg-highlight !text-on-highlight shadow-float lg:max-w-[420px] lg:mx-auto lg:flex">
            Start Empty Workout
          </Button>
        </div>
      )}

      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu} items={hubMenu} />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
      <TemplatePreviewSheet template={preview} onClose={() => setPreview(null)} onStart={start} pending={pending} />
    </Screen>
  );
}

/** "This week": workouts and volume as thin big numbers with trends, and a capsule bar per day. */
function WeekCard({ list }: { list: WorkoutListItem[] | undefined }) {
  const app = useAppSettings();
  const units = app.units;
  const q = useWorkoutStats();
  const week = useMemo(() => {
    const ws = startOfWeek(new Date(), { weekStartsOn: app.weekStartsOn === 0 ? 0 : 1 });
    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    const vol = days.map(() => 0);
    const count = days.map(() => 0);
    for (const w of list ?? []) {
      const d = parseISO(w.finishedAt ?? w.startedAt);
      const i = days.findIndex((x) => isSameDay(x, d));
      if (i < 0) continue;
      vol[i] = (vol[i] ?? 0) + (w.totalVolume ?? 0);
      count[i] = (count[i] ?? 0) + 1;
    }
    const max = Math.max(1, ...vol);
    // A day with a workout but no volume (cardio, bodyweight) still shows a short capsule.
    const values = vol.map((v, i) => (count[i]! > 0 ? Math.max(v, max * 0.22) : 0));
    const today = days.findIndex((x) => isSameDay(x, new Date()));
    return { values, max, labels: days.map((d) => format(d, "EEEEE")), today };
  }, [list, app.weekStartsOn]);

  if (q.isPending) return <Skeleton rows={3} />;
  if (q.isError) return <InlineError onRetry={() => void q.refetch()}>Unable to load stats.</InlineError>;
  const s: WorkoutStats = q.data;
  const delta = s.thisWeek - s.lastWeek;
  const weeks = s.volumeByWeek;
  const thisVol = weeks[weeks.length - 1]?.volume ?? 0;
  const lastVol = weeks[weeks.length - 2]?.volume ?? 0;
  const volPct = lastVol > 0 ? Math.round(((thisVol - lastVol) / lastVol) * 100) : null;
  const [volNum, volUnit] = splitUnit(fmtVolume(thisVol, units));
  return (
    <GlassCard className="mx-[var(--gutter)] rise" tone="strong">
      <CardHeader
        icon="dumbbell"
        title="This week"
        sub={s.weeklyTarget ? `${s.thisWeek} of ${s.weeklyTarget} planned` : s.streakWeeks > 1 ? `${s.streakWeeks} weeks in a row` : "Workouts and volume"}
        trailing={s.thisWeek || s.lastWeek ? <><Trend value={`${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta)}`} up={delta >= 0} /><span>vs last week</span></> : undefined}
      />
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <BigNumber value={s.thisWeek} unit={s.thisWeek === 1 ? "workout" : "workouts"} />
          <div className="text-[12px] text-tertiary mt-1">Completed</div>
        </div>
        <div>
          <BigNumber value={volNum} unit={volUnit} />
          <div className="text-[12px] text-tertiary mt-1 flex items-center gap-1.5">
            Volume
            {volPct != null && thisVol > 0 && <Trend value={`${Math.abs(volPct)}%`} up={volPct >= 0} />}
          </div>
        </div>
      </div>
      <CapsuleBars values={week.values} max={week.max} height={92} color="var(--accent)" className="mt-5" />
      <div className="flex justify-between gap-2 mt-2" aria-hidden="true">
        {week.labels.map((l, i) => (
          <span key={i} className={cn("flex-1 text-center text-[11px] tabular", i === week.today ? "text-primary font-medium" : "text-tertiary")}>{l}</span>
        ))}
      </div>
    </GlassCard>
  );
}

function FolderSection({ name, templates, volumes, collapsed = false, onOpen, onStart }: { name: string; templates: WorkoutTemplate[]; volumes: Map<string, number[]>; collapsed?: boolean; onOpen: (t: WorkoutTemplate) => void; onStart: (id: string) => void }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <section className="mt-6">
      <SectionHeader
        title={
          <button type="button" className="flex items-center gap-1 -ml-1 pl-1 pr-2 h-7 -my-1 rounded-full active:bg-pressed text-[15px] text-primary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <Icon name={open ? "chevron-down" : "chevron-right"} size={16} className="text-tertiary" />
            {name} <span className="text-tertiary tabular">({templates.length})</span>
          </button>
        }
      />
      {open && <TemplateGrid templates={templates} volumes={volumes} onOpen={onOpen} onStart={onStart} />}
    </section>
  );
}

function TemplateGrid({ templates, volumes, onOpen, onStart }: { templates: WorkoutTemplate[]; volumes: Map<string, number[]>; onOpen: (t: WorkoutTemplate) => void; onStart: (id: string) => void }) {
  return (
    <div className="px-[var(--gutter)] grid grid-cols-2 lg:grid-cols-3 gap-3" data-testid="template-grid">
      {templates.map((t, i) => (
        <TemplateCard key={t.id} template={t} index={i} history={volumes.get(t.id) ?? []} onOpen={() => onOpen(t)} onStart={() => onStart(t.id)} />
      ))}
    </div>
  );
}

/** Glass card: name, exercise count, a tiny dot chart of past volume, last done. Long press or the glyph opens the menu. */
function TemplateCard({ template, index, history, onOpen, onStart }: { template: WorkoutTemplate; index: number; history: number[]; onOpen: () => void; onStart: () => void }) {
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [folderSheet, setFolderSheet] = useState(false);
  const del = useDeleteTemplate();
  const dup = useDuplicateTemplate();
  const lastPoint = useRef({ x: 0, y: 0 });
  const lp = useLongPress(() => { void impact("medium"); setMenu(lastPoint.current); });
  const count = (template.exercises ?? []).length;
  const past = history.slice(-9);
  const dots = [...Array.from({ length: 9 - past.length }, () => 0), ...past];
  const items: MenuItem[] = [
    { label: "Start Workout", icon: "dumbbell", onPress: onStart },
    { label: "Edit", icon: "pencil", onPress: () => navigate(`${WORKOUTS}/templates/${template.id}/edit`) },
    { label: "Duplicate", icon: "copy", onPress: () => dup.mutate(template.id, { onSuccess: () => toast("Template duplicated.") }) },
    { label: "Move to Folder", icon: "inbox", onPress: () => setFolderSheet(true) },
    { label: "Delete", icon: "trash", destructive: true, onPress: () => setConfirm(true) },
  ];
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        data-testid="template-card"
        style={{ "--i": Math.min(index, 8) } as CSSProperties}
        className="glass rise pressable-spring relative rounded-lg p-3.5 pr-9 min-h-[148px] flex flex-col cursor-pointer select-none"
        onClick={() => { if (!lp.fired.current) onOpen(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
        {...lp}
        onPointerDown={(e) => { lastPoint.current = { x: e.clientX, y: e.clientY }; lp.onPointerDown(e); }}
      >
        <div className="text-[15px] leading-5 text-primary truncate-2">{template.name}</div>
        <div className="text-[12px] text-tertiary mt-1 tabular">{plural(count, "exercise")}</div>
        <div className="mt-auto pt-3 -mr-5">
          <DotBars values={dots} rows={5} color="var(--accent)" current={past.length ? dots.length - 1 : -1} />
          <div className="text-[11px] text-tertiary mt-2 truncate">{template.lastPerformedAt ? fmtRelativeDate(template.lastPerformedAt) : "Not done yet"}</div>
        </div>
        <button type="button" aria-label="Template menu" className="absolute top-0.5 right-0.5 hit-44 inline-flex items-center justify-center text-tertiary rounded-full active:bg-pressed" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left + r.width / 2, y: r.bottom }); }} onPointerDown={(e) => e.stopPropagation()}>
          <Icon name="more" size={18} />
        </button>
      </div>
      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu} items={items} />
      <ActionSheet open={confirm} onClose={() => setConfirm(false)} title={`Delete "${template.name}"?`} message="The template is removed. Past workouts are kept." actions={[{ label: "Delete Template", destructive: true, onPress: () => del.mutate(template.id, { onSuccess: () => toast("Template deleted.") }) }]} />
      <FolderSheet template={template} open={folderSheet} onClose={() => setFolderSheet(false)} />
    </>
  );
}

function FolderSheet({ template, open, onClose }: { template: WorkoutTemplate; open: boolean; onClose: () => void }) {
  const templates = useTemplates();
  const patch = usePatchTemplate();
  const [name, setName] = useState("");
  const existing = Array.from(new Set((templates.data ?? []).map((t) => t.folder).filter((f): f is string => Boolean(f) && f !== EXAMPLE_FOLDER)));
  const move = (folder: string | null) => patch.mutate({ id: template.id, folder }, { onSuccess: () => { onClose(); toast(folder ? `Moved to ${folder}.` : "Moved to My Templates."); } });
  return (
    <Sheet open={open} onClose={onClose} title="Move to Folder" trailing={<button type="button" className="text-headline text-accent-text px-2 h-11 disabled:opacity-40" disabled={!name.trim()} onClick={() => move(name.trim())}>Move</button>}>
      <div className="pt-2 flex flex-col gap-4">
        <TextField label="New folder" placeholder="Folder name" value={name} onChange={(e) => setName(e.target.value)} enterKeyHint="done" onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) move(name.trim()); }} />
        <div className="flex flex-wrap gap-2">
          <Chip selected={template.folder == null} onClick={() => move(null)}>My Templates</Chip>
          {existing.map((f) => (
            <Chip key={f} selected={template.folder === f} onClick={() => move(f)}>{f}</Chip>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

/** Exercise list with set counts and targets, Start Workout primary, menu with Edit / Duplicate / Delete / Move to Folder. */
function TemplatePreviewSheet({ template, onClose, onStart, pending }: { template: WorkoutTemplate | null; onClose: () => void; onStart: (id: string) => void; pending: boolean }) {
  const navigate = useNavigate();
  const units = useAppSettings().units;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [folderSheet, setFolderSheet] = useState(false);
  const del = useDeleteTemplate();
  const dup = useDuplicateTemplate();
  const t = template;
  const items: MenuItem[] = t
    ? [
        { label: "Edit", icon: "pencil", onPress: () => { onClose(); navigate(`${WORKOUTS}/templates/${t.id}/edit`); } },
        { label: "Duplicate", icon: "copy", onPress: () => dup.mutate(t.id, { onSuccess: () => { onClose(); toast("Template duplicated."); } }) },
        { label: "Move to Folder", icon: "inbox", onPress: () => setFolderSheet(true) },
        { label: "Delete", icon: "trash", destructive: true, onPress: () => setConfirm(true) },
      ]
    : [];
  return (
    <>
      <Sheet
        open={Boolean(t)}
        onClose={onClose}
        title={t?.name ?? ""}
        detent="auto"
        trailing={
          <IconButton label="Template menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left + r.width / 2, y: r.bottom }); }}>
            <Icon name="more" />
          </IconButton>
        }
      >
        {t && (
          <div className="flex flex-col gap-4 pt-1">
            {t.notes && <p className="text-[15px] text-secondary">{t.notes}</p>}
            {t.lastPerformedAt && <p className="text-[13px] text-tertiary -mt-2">Last performed {fmtRelativeDate(t.lastPerformedAt)}</p>}
            <div className="well rounded-[16px] overflow-hidden group-rows">
              {(t.exercises ?? []).map((e) => {
                const sets = e.sets ?? [];
                const targets = sets.map((s) => fmtSetValues({ weight: s.targetWeight, reps: s.targetReps, seconds: s.targetSeconds, distance: s.targetDistance }, e.exercise?.category ?? "barbell", units)).filter(Boolean);
                const uniq = Array.from(new Set(targets));
                return (
                  <Row
                    key={e.id}
                    className={cn(e.supersetGroup != null && "wk-superset")}
                    style={e.supersetGroup != null ? ({ "--wk-ss": supersetColor(e.supersetGroup) } as React.CSSProperties) : undefined}
                    title={`${sets.length} × ${e.exercise?.name ?? "Exercise"}`}
                    subtitle={uniq.length ? uniq.join(", ") : e.exercise?.bodyPart?.replace("_", " ")}
                    trailing={e.exercise?.recordOneRm ? <span className="text-[13px] text-tertiary">{`1RM ${fmtPrValue("one_rm", e.exercise.recordOneRm, units)}`}</span> : undefined}
                  />
                );
              })}
              {(t.exercises ?? []).length === 0 && <Row title="No exercises" className="text-secondary" />}
            </div>
            <Button variant="primary" size="lg" full loading={pending} onClick={() => onStart(t.id)} data-testid="preview-start">Start Workout</Button>
          </div>
        )}
      </Sheet>
      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu} items={items} />
      {t && <ActionSheet open={confirm} onClose={() => setConfirm(false)} title={`Delete "${t.name}"?`} message="The template is removed. Past workouts are kept." actions={[{ label: "Delete Template", destructive: true, onPress: () => del.mutate(t.id, { onSuccess: () => { onClose(); toast("Template deleted."); } }) }]} />}
      {t && <FolderSheet template={t} open={folderSheet} onClose={() => setFolderSheet(false)} />}
    </>
  );
}

function RecentHistory() {
  const navigate = useNavigate();
  const q = useWorkouts(5);
  return (
    <Section title="History" action={<button type="button" className="text-[13px] text-accent-text pb-0.5" onClick={() => navigate(`${WORKOUTS}/history`)}>See All</button>}>
      {q.isPending ? (
        <Skeleton rows={3} />
      ) : q.isError ? (
        <InlineError onRetry={() => void q.refetch()}>Unable to load history.</InlineError>
      ) : q.data.length === 0 ? (
        <Empty className="pt-4 pb-2">No workouts yet.</Empty>
      ) : (
        <div className="px-[var(--gutter)] flex flex-col gap-2.5" data-testid="recent-history">
          {q.data.map((w) => (
            <WorkoutRow key={w.id} workout={w} onPress={() => navigate(`${WORKOUTS}/history/${w.id}`)} />
          ))}
        </div>
      )}
    </Section>
  );
}

/** Records as small stat cards, then two overview cards: total workouts (dot columns per week) and 12-week volume (tick bars). */
function StatsSection() {
  const units = useAppSettings().units;
  const q = useWorkoutStats();
  if (q.isPending || q.isError) return null; // WeekCard already shows the loading and error states for stats.
  const s = q.data;
  const weeks = s.volumeByWeek;
  const avg = weeks.length ? weeks.reduce((a, w) => a + w.volume, 0) / weeks.length : 0;
  const [avgNum, avgUnit] = splitUnit(fmtVolume(avg, units));
  return (
    <>
      {s.recentPrs.length > 0 && (
        <Section title="Recent records">
          <div className="px-[var(--gutter)] grid grid-cols-2 lg:grid-cols-4 gap-3">
            {s.recentPrs.slice(0, 4).map((p, i) => (
              <RecordCard key={p.id} pr={p} units={units} index={i} />
            ))}
          </div>
        </Section>
      )}
      <Section title="Overview">
        <div className="px-[var(--gutter)] grid grid-cols-2 gap-3">
          <GlassCard className="rise">
            <div className="text-[13px] text-secondary">Workouts</div>
            <BigNumber value={s.totalWorkouts} size={30} className="mt-1" />
            <div className="text-[12px] text-tertiary mt-0.5 truncate">{s.streakWeeks > 1 ? `${s.streakWeeks} weeks in a row` : "All time"}</div>
            <DotBars values={weeks.map((w) => w.count)} rows={5} color="var(--accent)" className="mt-3" />
          </GlassCard>
          <GlassCard className="rise" style={{ "--i": 1 } as CSSProperties}>
            <div className="text-[13px] text-secondary">Weekly volume</div>
            <BigNumber value={avgNum} unit={avgUnit} size={30} className="mt-1" />
            <div className="text-[12px] text-tertiary mt-0.5">12-week average</div>
            <TickBars values={weeks.map((w) => w.volume)} current={weeks.some((w) => w.volume > 0) ? weeks.length - 1 : -1} color="var(--accent)" height={34} gap={6} className="mt-3" />
          </GlassCard>
        </div>
      </Section>
    </>
  );
}

function RecordCard({ pr: p, units, index }: { pr: WorkoutStats["recentPrs"][number]; units: Units; index: number }) {
  const navigate = useNavigate();
  const [num, unit] = splitUnit(fmtPrValue(p.type, p.value, units));
  return (
    <GlassCard className="rise !p-3.5" style={{ "--i": index } as CSSProperties} onPress={() => navigate(`${WORKOUTS}/exercises/${p.exerciseId}`)} label={`${p.exerciseName ?? "Exercise"}, ${prLabel(p.type)}`}>
      <div className="flex items-center justify-between gap-2">
        <StatusPill tone="success">PR</StatusPill>
        <span className="text-[11px] text-tertiary truncate">{fmtRelativeDate(p.achievedAt, false)}</span>
      </div>
      <BigNumber value={num} unit={unit} size={26} className="mt-2.5" />
      <div className="text-[13px] text-primary truncate mt-1">{p.exerciseName ?? "Exercise"}</div>
      <div className="text-[12px] text-tertiary truncate">{prLabel(p.type)}</div>
    </GlassCard>
  );
}
