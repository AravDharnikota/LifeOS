import { desc, eq } from "drizzle-orm";
import { DEFAULT_TODAY_LAYOUT, LayoutSpec, type Layout, type Widget } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { parseJson } from "../lib/json.ts";
import { logActivity } from "./activity.ts";

export function getLayout(db: Db, id = "today"): Layout {
  const row = db.select().from(schema.layouts).where(eq(schema.layouts.id, id)).get();
  if (!row) {
    if (id !== "today") throw notFound("Layout");
    db.insert(schema.layouts).values({ id, spec: JSON.stringify(DEFAULT_TODAY_LAYOUT), version: 1 }).run();
    return getLayout(db, id);
  }
  const parsed = LayoutSpec.safeParse(parseJson(row.spec, null));
  return { id: row.id, spec: parsed.success ? parsed.data : DEFAULT_TODAY_LAYOUT, version: row.version, updatedAt: row.updatedAt };
}

export function saveLayout(db: Db, id: string, spec: unknown, reason: string, actor = "user"): Layout {
  const parsed = LayoutSpec.safeParse(spec);
  if (!parsed.success) throw badRequest("Invalid layout", parsed.error.issues);
  const ids = new Set<string>();
  for (const s of parsed.data.sections) for (const w of s.widgets) {
    if (ids.has(w.id)) throw badRequest(`Duplicate widget id "${w.id}"`);
    ids.add(w.id);
  }
  const current = getLayout(db, id);
  db.insert(schema.layoutVersions).values({ id: newId(), layoutId: id, version: current.version, spec: JSON.stringify(current.spec), reason }).run();
  const version = current.version + 1;
  db.update(schema.layouts).set({ spec: JSON.stringify(parsed.data), version, updatedAt: nowIso() }).where(eq(schema.layouts.id, id)).run();
  logActivity(db, { actor, action: "updated", entity: "layout", entityId: id, summary: reason });
  return getLayout(db, id);
}

export function revertLayout(db: Db, id: string, actor = "user"): Layout {
  const prev = db.select().from(schema.layoutVersions).where(eq(schema.layoutVersions.layoutId, id)).orderBy(desc(schema.layoutVersions.createdAt)).get();
  if (!prev) throw badRequest("Nothing to revert");
  const spec = LayoutSpec.parse(parseJson(prev.spec, DEFAULT_TODAY_LAYOUT));
  db.delete(schema.layoutVersions).where(eq(schema.layoutVersions.id, prev.id)).run();
  db.update(schema.layouts).set({ spec: JSON.stringify(spec), version: prev.version, updatedAt: nowIso() }).where(eq(schema.layouts.id, id)).run();
  logActivity(db, { actor, action: "reverted", entity: "layout", entityId: id, summary: "Reverted dashboard layout" });
  return getLayout(db, id);
}

export function listLayoutVersions(db: Db, id: string) {
  return db.select({ id: schema.layoutVersions.id, version: schema.layoutVersions.version, reason: schema.layoutVersions.reason, createdAt: schema.layoutVersions.createdAt }).from(schema.layoutVersions).where(eq(schema.layoutVersions.layoutId, id)).orderBy(desc(schema.layoutVersions.createdAt)).limit(50).all();
}

// ---- widget-level helpers used by the agent ----
export function addWidget(db: Db, layoutId: string, widget: Widget, opts: { sectionId?: string; position?: "top" | "bottom"; sectionTitle?: string } = {}, actor = "agent"): Layout {
  const layout = getLayout(db, layoutId);
  const spec = structuredClone(layout.spec);
  let section = opts.sectionId ? spec.sections.find((s) => s.id === opts.sectionId) : spec.sections[0];
  if (!section) {
    section = { id: opts.sectionId ?? newId().slice(0, 8), title: opts.sectionTitle, widgets: [] };
    spec.sections.push(section);
  }
  if (spec.sections.some((s) => s.widgets.some((w) => w.id === widget.id))) throw badRequest(`Widget id "${widget.id}" already exists`);
  if (opts.position === "top") section.widgets.unshift(widget);
  else section.widgets.push(widget);
  return saveLayout(db, layoutId, spec, `Added ${widget.type} widget`, actor);
}

export function updateWidget(db: Db, layoutId: string, widgetId: string, patch: Record<string, unknown>, actor = "agent"): Layout {
  const layout = getLayout(db, layoutId);
  const spec = structuredClone(layout.spec);
  for (const s of spec.sections) {
    const i = s.widgets.findIndex((w) => w.id === widgetId);
    if (i >= 0) {
      s.widgets[i] = { ...s.widgets[i], ...patch, id: widgetId } as Widget;
      return saveLayout(db, layoutId, spec, `Updated widget ${widgetId}`, actor);
    }
  }
  throw notFound("Widget");
}

export function removeWidget(db: Db, layoutId: string, widgetId: string, actor = "agent"): Layout {
  const layout = getLayout(db, layoutId);
  const spec = structuredClone(layout.spec);
  let found = false;
  for (const s of spec.sections) {
    const before = s.widgets.length;
    s.widgets = s.widgets.filter((w) => w.id !== widgetId);
    if (s.widgets.length !== before) found = true;
  }
  if (!found) throw notFound("Widget");
  spec.sections = spec.sections.filter((s) => s.widgets.length > 0);
  return saveLayout(db, layoutId, spec, `Removed widget ${widgetId}`, actor);
}

export function moveWidget(db: Db, layoutId: string, widgetId: string, to: { sectionId?: string; index?: number }, actor = "agent"): Layout {
  const layout = getLayout(db, layoutId);
  const spec = structuredClone(layout.spec);
  let widget: Widget | undefined;
  for (const s of spec.sections) {
    const i = s.widgets.findIndex((w) => w.id === widgetId);
    if (i >= 0) widget = s.widgets.splice(i, 1)[0];
  }
  if (!widget) throw notFound("Widget");
  const target = (to.sectionId && spec.sections.find((s) => s.id === to.sectionId)) || spec.sections[0]!;
  const idx = Math.max(0, Math.min(to.index ?? target.widgets.length, target.widgets.length));
  target.widgets.splice(idx, 0, widget);
  spec.sections = spec.sections.filter((s) => s.widgets.length > 0);
  return saveLayout(db, layoutId, spec, `Moved widget ${widgetId}`, actor);
}
