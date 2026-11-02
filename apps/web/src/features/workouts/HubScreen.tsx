import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { WorkoutListItem, WorkoutTemplate } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Button, IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group, Row, Section, SectionHeader } from "@/ui/List";
import { Sheet, ActionSheet } from "@/ui/Sheet";
import { Menu, type MenuItem } from "@/ui/Menu";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { TextField, Chip } from "@/ui/Field";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { fmtDate, fmtRelativeDate } from "@/lib/format";
import { impact } from "@/lib/haptics";
import { useIsDesktop, useLongPress } from "@/lib/hooks";
import { useAppSettings } from "@/data/queries";
import { useActiveWorkout, useDeleteTemplate, useDuplicateTemplate, usePatchTemplate, useTemplates, useWorkoutStats, useWorkouts } from "./api";
import { exerciseSummary, fmtPrValue, fmtSetValues, fmtVolume, plural, prLabel, supersetColor, WORKOUTS } from "./lib";
import { BarChart } from "./charts";
import { SettingsSheet } from "./SettingsSheet";
import { useStartFlow, WorkoutRow } from "./common";

const EXAMPLE_FOLDER = "Example Templates";

export default function HubScreen() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const templates = useTemplates();
  const active = useActiveWorkout();
  const { start, pending } = useStartFlow();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [settings, setSettings] = useState(false);
  const [preview, setPreview] = useState<WorkoutTemplate | null>(null);

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

  return (
    <Screen
      title="Workouts"
      back="/health"
      actions={
        <IconButton label="More" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left + r.width / 2, y: r.bottom }); }}>
          <Icon name="more" />
        </IconButton>
      }
    >
      <div className={cn(isDesktop && "max-w-[960px]")}>
        <div className="px-[var(--gutter)] pt-1 pb-2 lg:max-w-[420px]">
          {active.data ? (
            <Button variant="secondary" size="lg" full onClick={() => navigate(`${WORKOUTS}/active`)}>Resume Workout</Button>
          ) : (
            <Button variant="primary" size="lg" full loading={pending} onClick={() => start(null)} data-testid="start-empty">Start Empty Workout</Button>
          )}
        </div>

        <Section
          title="My Templates"
          action={
            <button type="button" className="text-footnote text-accent-text font-medium pb-0.5" onClick={() => navigate(`${WORKOUTS}/templates/new`)}>
              New Template
            </button>
          }
        >
          {templates.isPending ? (
            <Skeleton rows={2} />
          ) : templates.isError ? (
            <InlineError onRetry={() => void templates.refetch()}>Unable to load templates.</InlineError>
          ) : folders.mine.length === 0 ? (
            <Group>
              <Row title={<span className="text-secondary">No templates yet.</span>} />
              <Row title={<span className="text-accent-text">New Template</span>} onPress={() => navigate(`${WORKOUTS}/templates/new`)} />
            </Group>
          ) : (
            <TemplateGrid templates={folders.mine} onOpen={setPreview} onStart={start} />
          )}
        </Section>

        {folders.others.map(([name, list]) => (
          <FolderSection key={name} name={name} templates={list} onOpen={setPreview} onStart={start} />
        ))}
        {folders.examples.length > 0 && <FolderSection name={EXAMPLE_FOLDER} templates={folders.examples} collapsed onOpen={setPreview} onStart={start} />}

        <RecentHistory />
        <StatsSection />
      </div>

      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu} items={hubMenu} />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
      <TemplatePreviewSheet template={preview} onClose={() => setPreview(null)} onStart={start} pending={pending} />
    </Screen>
  );
}

function FolderSection({ name, templates, collapsed = false, onOpen, onStart }: { name: string; templates: WorkoutTemplate[]; collapsed?: boolean; onOpen: (t: WorkoutTemplate) => void; onStart: (id: string) => void }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <section className="mt-6">
      <SectionHeader
        title={
          <button type="button" className="flex items-center gap-1 -ml-1 pl-1 pr-2 h-7 -my-1 rounded-sm active:bg-pressed text-footnote text-secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <Icon name={open ? "chevron-down" : "chevron-right"} size={16} className="text-tertiary" />
            {name} ({templates.length})
          </button>
        }
      />
      {open && <TemplateGrid templates={templates} onOpen={onOpen} onStart={onStart} />}
    </section>
  );
}

function TemplateGrid({ templates, onOpen, onStart }: { templates: WorkoutTemplate[]; onOpen: (t: WorkoutTemplate) => void; onStart: (id: string) => void }) {
  return (
    <div className="px-[var(--gutter)] grid grid-cols-2 lg:grid-cols-3 gap-3" data-testid="template-grid">
      {templates.map((t) => (
        <TemplateCard key={t.id} template={t} onOpen={() => onOpen(t)} onStart={() => onStart(t.id)} />
      ))}
    </div>
  );
}

/** One tappable unit: name, exercise summary, last performed. Long press or the glyph opens the menu. */
function TemplateCard({ template, onOpen, onStart }: { template: WorkoutTemplate; onOpen: () => void; onStart: () => void }) {
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [folderSheet, setFolderSheet] = useState(false);
  const del = useDeleteTemplate();
  const dup = useDuplicateTemplate();
  const lastPoint = useRef({ x: 0, y: 0 });
  const lp = useLongPress(() => { void impact("medium"); setMenu(lastPoint.current); });
  const names = (template.exercises ?? []).map((e) => e.exercise?.name ?? "Exercise");
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
        className="wk-card relative rounded-lg p-4 pr-10 min-h-[112px] flex flex-col cursor-pointer row-hover active:bg-pressed transition-colors duration-100 select-none"
        onClick={() => { if (!lp.fired.current) onOpen(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
        {...lp}
        onPointerDown={(e) => { lastPoint.current = { x: e.clientX, y: e.clientY }; lp.onPointerDown(e); }}
      >
        <div className="text-headline text-primary truncate-2">{template.name}</div>
        <div className="text-footnote text-secondary mt-1 truncate-2">{exerciseSummary(names)}</div>
        {template.lastPerformedAt && <div className="text-caption-1 text-tertiary mt-auto pt-2">{fmtRelativeDate(template.lastPerformedAt)}</div>}
        <button type="button" aria-label="Template menu" className="absolute top-1 right-1 hit-44 inline-flex items-center justify-center text-tertiary rounded-md active:bg-pressed" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left + r.width / 2, y: r.bottom }); }} onPointerDown={(e) => e.stopPropagation()}>
          <Icon name="more" size={20} />
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
            {t.notes && <p className="text-subhead text-secondary">{t.notes}</p>}
            {t.lastPerformedAt && <p className="text-footnote text-tertiary -mt-2">Last performed {fmtRelativeDate(t.lastPerformedAt)}</p>}
            <Group inset={false}>
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
                    trailing={e.exercise?.recordOneRm ? <span className="text-footnote">{`1RM ${fmtPrValue("one_rm", e.exercise.recordOneRm, units)}`}</span> : undefined}
                  />
                );
              })}
              {(t.exercises ?? []).length === 0 && <Row title="No exercises" className="text-secondary" />}
            </Group>
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
    <Section title="History" action={<button type="button" className="text-footnote text-accent-text font-medium pb-0.5" onClick={() => navigate(`${WORKOUTS}/history`)}>See All</button>}>
      {q.isPending ? (
        <Skeleton rows={3} />
      ) : q.isError ? (
        <InlineError onRetry={() => void q.refetch()}>Unable to load history.</InlineError>
      ) : q.data.length === 0 ? (
        <Empty className="pt-4 pb-2">No workouts yet.</Empty>
      ) : (
        <Group data-testid="recent-history">
          {q.data.map((w) => (
            <WorkoutRow key={w.id} workout={w} onPress={() => navigate(`${WORKOUTS}/history/${w.id}`)} />
          ))}
        </Group>
      )}
    </Section>
  );
}

function StatsSection() {
  const navigate = useNavigate();
  const units = useAppSettings().units;
  const q = useWorkoutStats();
  const [sel, setSel] = useState<number | null>(null);
  if (q.isPending) return <Section title="Stats"><Skeleton rows={2} /></Section>;
  if (q.isError) return <Section title="Stats"><InlineError onRetry={() => void q.refetch()}>Unable to load stats.</InlineError></Section>;
  const s = q.data;
  const circles = Math.max(s.weeklyTarget, s.thisWeek, 1);
  const weeks = s.volumeByWeek.map((w) => ({ label: fmtDate(w.weekStart).slice(4), value: units === "imperial" ? w.volume / 0.45359237 : w.volume, title: fmtDate(w.weekStart) }));
  const shown = sel != null ? weeks[sel] : weeks[weeks.length - 1];
  const delta = s.thisWeek - s.lastWeek;
  return (
    <>
      <Section title="Stats">
        <Group>
          <Row
            title="This week"
            subtitle={s.weeklyTarget ? `${s.thisWeek} of ${s.weeklyTarget}${delta ? `, ${delta > 0 ? "+" : ""}${delta} vs last week` : ""}` : plural(s.thisWeek, "workout")}
            trailing={
              <span className="flex items-center gap-1.5" aria-hidden="true">
                {Array.from({ length: Math.min(circles, 10) }).map((_, i) => (
                  <span key={i} className={cn("w-2.5 h-2.5 rounded-full", i < s.thisWeek ? "bg-success" : "border border-border")} />
                ))}
              </span>
            }
          />
          <Row title="Total workouts" trailing={<span className="text-primary num text-title-3">{s.totalWorkouts}</span>} subtitle={s.streakWeeks > 1 ? `${s.streakWeeks} weeks in a row` : undefined} />
          <div className="row-sep relative px-[var(--gutter)] pt-3 pb-2">
            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-title-1 num text-primary">{shown ? fmtVolume(units === "imperial" ? shown.value * 0.45359237 : shown.value, units) : "0"}</span>
              </div>
              <span className="text-subhead text-secondary">{sel != null && shown ? `Week of ${shown.title}` : "Volume this week"}</span>
            </div>
            <BarChart points={weeks} height={120} format={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))} selected={sel} onSelect={setSel} xLabels={3} className="mt-2" />
          </div>
        </Group>
      </Section>
      {s.recentPrs.length > 0 && (
        <Section title="Recent records">
          <Group>
            {s.recentPrs.slice(0, 5).map((p) => (
              <Row key={p.id} leading={<Icon name="trophy" size={20} className="text-warning-text" />} title={p.exerciseName ?? "Exercise"} subtitle={`${prLabel(p.type)} · ${fmtRelativeDate(p.achievedAt)}`} trailing={<span className="text-primary">{fmtPrValue(p.type, p.value, units)}</span>} chevron onPress={() => navigate(`${WORKOUTS}/exercises/${p.exerciseId}`)} />
            ))}
          </Group>
        </Section>
      )}
    </>
  );
}
