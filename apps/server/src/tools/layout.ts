import { z } from "zod";
import { WIDGET_CATALOG, Widget, WidgetSize, WidgetType, type Layout, type LayoutSpec } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { getGoal } from "../services/goals.ts";
import { addWidget, getLayout, listLayoutVersions, moveWidget, removeWidget, revertLayout, saveLayout, updateWidget } from "../services/layout.ts";
import { createTracker } from "../routes/trackers.ts";
import { defineTool, type ToolDef } from "./types.ts";

type WidgetOption = (typeof Widget.options)[number];
const BASE_FIELDS = new Set(["id", "type", "size", "title"]);

interface WidgetTypeInfo {
  type: string;
  label: string;
  description: string;
  required: string[];
  optional: string[];
  schema: Record<string, unknown>;
}

function optionType(opt: WidgetOption): string {
  return String((opt.shape.type as z.ZodLiteral<string>).value);
}

function describeOption(opt: WidgetOption): WidgetTypeInfo {
  const type = optionType(opt);
  const schema = z.toJSONSchema(opt, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const props = Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {});
  const catalog = WIDGET_CATALOG[type] ?? { label: type, description: "" };
  return {
    type,
    label: catalog.label,
    description: catalog.description,
    required: props.filter((p) => required.has(p) && !BASE_FIELDS.has(p)),
    optional: props.filter((p) => !required.has(p) && !BASE_FIELDS.has(p)),
    schema,
  };
}

export const widgetTypeInfos: WidgetTypeInfo[] = Widget.options.map(describeOption);

function configCheatSheet(): string {
  return widgetTypeInfos.map((w) => `${w.type}: ${w.required.length ? "needs " + w.required.join(", ") : "no config"}${w.optional.length ? " (optional " + w.optional.join(", ") + ")" : ""}`).join("; ");
}

const shortId = () => Math.random().toString(36).slice(2, 8);
const widgetIdFor = (type: string) => `${type.replace(/_/g, "-")}-${shortId()}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);

const WidgetInput = z
  .looseObject({
    type: WidgetType.describe("Widget type; call list_widget_types for the config each type takes."),
    id: z.string().min(1).max(60).optional().describe("Leave out to auto-generate."),
    size: WidgetSize.optional().describe("s, m or l. Default m."),
    title: z.string().max(60).optional().describe("Optional heading shown above the widget."),
  })
  .describe(`The widget. Type-specific config fields go at the same level. ${configCheatSheet()}.`);

function issuesText(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join(".") || "widget"}: ${i.message}`).join("; ");
}

export function buildWidget(input: Record<string, unknown>): Widget {
  const type = typeof input.type === "string" ? input.type : "widget";
  const candidate = { ...input, id: typeof input.id === "string" && input.id ? input.id : widgetIdFor(type) };
  const parsed = Widget.safeParse(candidate);
  if (!parsed.success) throw new Error(`Invalid ${type} widget: ${issuesText(parsed.error.issues)}`);
  return parsed.data;
}

function validatePatched(widget: Widget, patch: Record<string, unknown>): void {
  const parsed = Widget.safeParse({ ...widget, ...patch, id: widget.id });
  if (!parsed.success) throw new Error(`Invalid patch for ${widget.type} widget: ${issuesText(parsed.error.issues)}`);
}

export function summarizeLayout(layout: Layout) {
  return {
    id: layout.id,
    version: layout.version,
    updatedAt: layout.updatedAt,
    sections: layout.spec.sections.map((s) => ({ id: s.id, title: s.title ?? null, widgets: s.widgets.map((w) => ({ id: w.id, type: w.type, title: w.title ?? null, size: w.size })) })),
  };
}

function findWidget(spec: LayoutSpec, widgetId: string): Widget {
  for (const s of spec.sections) {
    const w = s.widgets.find((x) => x.id === widgetId);
    if (w) return w;
  }
  throw new Error(`No widget with id "${widgetId}". Call get_layout to see the current widget ids.`);
}

function uniqueSectionId(spec: LayoutSpec, title: string): string {
  const base = slug(title) || "section";
  let id = base;
  while (spec.sections.some((s) => s.id === id)) id = `${base}-${shortId().slice(0, 4)}`;
  return id;
}

const layoutId = z.string().min(1).optional().describe('Dashboard id. Default "today".');
const changed = (layout: Layout, what: string) => ({ ok: true, changed: what, revertHint: "The previous layout is kept; revert_layout undoes this.", layout: summarizeLayout(layout) });
const addTrackerWidget = (db: Db, layoutId: string, trackerId: string, name: string, opts: { sectionId?: string; sectionTitle?: string }, actor: string) =>
  addWidget(db, layoutId, { id: widgetIdFor("tracker"), type: "tracker", trackerId, size: "s", title: name }, opts, actor);

const get_layout = defineTool({
  name: "get_layout",
  description: "Read the dashboard layout: its sections and widgets with ids and types, plus the full spec.",
  input: z.object({ layoutId }),
  readOnly: true,
  handler: (input, tc) => {
    const layout = getLayout(tc.ctx.db, input.layoutId ?? "today");
    return { ...summarizeLayout(layout), spec: layout.spec };
  },
});

const list_widget_types = defineTool({
  name: "list_widget_types",
  description: "List every widget type the dashboard supports, with a description and the JSON schema of its config.",
  input: z.object({}),
  readOnly: true,
  handler: () => ({ types: widgetTypeInfos }),
});

const add_widget = defineTool({
  name: "add_widget",
  description: "Add a widget to the dashboard. The id is generated when omitted. Put it in an existing section by sectionId, or create a new section by giving a sectionId that does not exist yet plus sectionTitle.",
  input: z.object({
    layoutId,
    widget: WidgetInput,
    sectionId: z.string().min(1).optional().describe("Section to add into. Default: the first section."),
    sectionTitle: z.string().max(60).optional().describe("Title for a new section when sectionId does not exist yet."),
    position: z.enum(["top", "bottom"]).optional().describe("Where in the section. Default bottom."),
  }),
  handler: (input, tc) => {
    const widget = buildWidget(input.widget);
    const layout = addWidget(tc.ctx.db, input.layoutId ?? "today", widget, { sectionId: input.sectionId, sectionTitle: input.sectionTitle, position: input.position }, tc.actor);
    return { ...changed(layout, `Added ${widget.type} widget ${widget.id}`), widget };
  },
});

const update_widget = defineTool({
  name: "update_widget",
  description: "Change fields of an existing widget (title, size, or its config such as limit, hours, date). The patch is merged into the widget; its id and type stay.",
  input: z.object({ layoutId, widgetId: z.string().min(1), patch: z.record(z.string(), z.unknown()).describe("Fields to change, e.g. {\"size\":\"l\"} or {\"limit\":12}.") }),
  handler: (input, tc) => {
    const id = input.layoutId ?? "today";
    const current = findWidget(getLayout(tc.ctx.db, id).spec, input.widgetId);
    const patch = { ...input.patch };
    delete patch.id;
    delete patch.type;
    validatePatched(current, patch);
    const layout = updateWidget(tc.ctx.db, id, input.widgetId, patch, tc.actor);
    return { ...changed(layout, `Updated widget ${input.widgetId}`), widget: findWidget(layout.spec, input.widgetId) };
  },
});

const remove_widget = defineTool({
  name: "remove_widget",
  description: "Remove a widget from the dashboard. Empty sections are dropped. The change can be undone with revert_layout.",
  input: z.object({ layoutId, widgetId: z.string().min(1) }),
  destructive: true,
  handler: (input, tc) => {
    const id = input.layoutId ?? "today";
    const removed = findWidget(getLayout(tc.ctx.db, id).spec, input.widgetId);
    return { ...changed(removeWidget(tc.ctx.db, id, input.widgetId, tc.actor), `Removed ${removed.type} widget ${input.widgetId}`), removed };
  },
});

const move_widget = defineTool({
  name: "move_widget",
  description: "Move a widget to another section and/or position. index 0 is the top of the section; omit it to append.",
  input: z.object({ layoutId, widgetId: z.string().min(1), sectionId: z.string().min(1).optional(), index: z.number().int().min(0).optional() }),
  handler: (input, tc) => {
    const id = input.layoutId ?? "today";
    findWidget(getLayout(tc.ctx.db, id).spec, input.widgetId);
    return changed(moveWidget(tc.ctx.db, id, input.widgetId, { sectionId: input.sectionId, index: input.index }, tc.actor), `Moved widget ${input.widgetId}`);
  },
});

const add_section = defineTool({
  name: "add_section",
  description: "Add a titled section to the dashboard, optionally with widgets in it.",
  input: z.object({ layoutId, title: z.string().trim().min(1).max(60), widgets: z.array(WidgetInput).max(12).optional() }),
  handler: (input, tc) => {
    const id = input.layoutId ?? "today";
    const layout = getLayout(tc.ctx.db, id);
    const spec = structuredClone(layout.spec);
    const widgets = (input.widgets ?? []).map(buildWidget);
    const section = { id: uniqueSectionId(spec, input.title), title: input.title, widgets };
    spec.sections.push(section);
    const saved = saveLayout(tc.ctx.db, id, spec, `Added section "${input.title}"`, tc.actor);
    return { ...changed(saved, `Added section ${section.id}`), section };
  },
});

const revert_layout = defineTool({
  name: "revert_layout",
  description: "Undo the most recent dashboard layout change by restoring the previous version.",
  input: z.object({ layoutId }),
  handler: (input, tc) => changed(revertLayout(tc.ctx.db, input.layoutId ?? "today", tc.actor), "Reverted to the previous layout"),
});

const layout_history = defineTool({
  name: "layout_history",
  description: "List saved previous versions of the dashboard layout (newest first) with the reason each change was made.",
  input: z.object({ layoutId }),
  readOnly: true,
  handler: (input, tc) => {
    const id = input.layoutId ?? "today";
    return { current: getLayout(tc.ctx.db, id).version, versions: listLayoutVersions(tc.ctx.db, id) };
  },
});

const create_tracker_widget = defineTool({
  name: "create_tracker_widget",
  description: "Create a tracker (a counter the user taps, e.g. cups of coffee, pages read) and add it to the dashboard in one step. Use this when the user wants a goal or habit with a button to tick it.",
  input: z.object({
    layoutId,
    name: z.string().trim().min(1).max(100),
    unit: z.string().max(30).optional().describe("e.g. cups, pages, minutes"),
    step: z.number().positive().optional().describe("Amount added per tap. Default 1."),
    target: z.number().optional().describe("Target per period, if any."),
    reset: z.enum(["daily", "weekly", "never"]).optional().describe("When the count resets. Default daily."),
    sectionId: z.string().min(1).optional(),
    sectionTitle: z.string().max(60).optional(),
  }),
  handler: (input, tc) => {
    const tracker = createTracker(tc.ctx.db, { name: input.name, unit: input.unit ?? null, step: input.step, target: input.target ?? null, reset: input.reset }, tc.actor);
    const layout = addTrackerWidget(tc.ctx.db, input.layoutId ?? "today", tracker.id, tracker.name, { sectionId: input.sectionId, sectionTitle: input.sectionTitle }, tc.actor);
    const widget = layout.spec.sections.flatMap((s) => s.widgets).find((w) => w.type === "tracker" && w.trackerId === tracker.id);
    return { ...changed(layout, `Created tracker "${tracker.name}" and added its widget`), tracker, widget };
  },
});

const create_goal_widget = defineTool({
  name: "create_goal_widget",
  description: "Add a widget for an existing goal to the dashboard. Create the goal first if it does not exist yet.",
  input: z.object({ layoutId, goalId: z.string().min(1), size: WidgetSize.optional(), sectionId: z.string().min(1).optional(), sectionTitle: z.string().max(60).optional() }),
  handler: (input, tc) => {
    const goal = getGoal(tc.ctx.db, input.goalId);
    const widget: Widget = { id: widgetIdFor("goal"), type: "goal", goalId: goal.id, size: input.size ?? "m", title: goal.title };
    const layout = addWidget(tc.ctx.db, input.layoutId ?? "today", widget, { sectionId: input.sectionId, sectionTitle: input.sectionTitle }, tc.actor);
    return { ...changed(layout, `Added goal widget for "${goal.title}"`), widget };
  },
});

export const layoutTools: ToolDef[] = [get_layout, list_widget_types, add_widget, update_widget, remove_widget, move_widget, add_section, revert_layout, layout_history, create_tracker_widget, create_goal_widget] as ToolDef[];
