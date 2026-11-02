import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { isoDate, todayString, type BodyPhoto, type HealthProfile, type PhotoAnalysis } from "@aravos/shared";
import type { AppContext } from "../app.ts";
import type { BodyComparisonRequest } from "../ai/provider.ts";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { parseJson } from "../lib/json.ts";
import { deleteUpload, readUploadBase64, saveUpload } from "../lib/uploads.ts";
import { logActivity } from "./activity.ts";
import { assertAiEnabled, weightOn, withAi } from "./nutrition.ts";
import { getHealthProfile } from "./settings.ts";

export const Pose = z.enum(["front", "side", "back"]);
export type Pose = z.infer<typeof Pose>;
export const BodyPhotoFields = z.object({ pose: Pose.optional(), date: isoDate.optional(), note: z.string().trim().max(1000).optional(), weightKg: z.coerce.number().positive().max(500).optional() });
export type BodyPhotoFields = z.infer<typeof BodyPhotoFields>;
export const AnalyzeBody = z.object({ compareToId: z.string().min(1).optional() });

type PhotoRow = typeof schema.bodyPhotos.$inferSelect;
type AnalysisRow = typeof schema.photoAnalyses.$inferSelect;

export function serializeAnalysis(row: AnalysisRow): PhotoAnalysis {
  return { ...row, observations: parseJson<string[]>(row.observations, []) };
}

function latestAnalyses(db: Db, photoIds: string[]): Map<string, PhotoAnalysis> {
  const map = new Map<string, PhotoAnalysis>();
  if (!photoIds.length) return map;
  const rows = db.select().from(schema.photoAnalyses).where(inArray(schema.photoAnalyses.photoId, photoIds)).orderBy(desc(schema.photoAnalyses.createdAt)).all();
  for (const r of rows) if (!map.has(r.photoId)) map.set(r.photoId, serializeAnalysis(r));
  return map;
}

export function serializePhoto(row: PhotoRow, analysis: PhotoAnalysis | null): BodyPhoto {
  return { ...row, pose: row.pose as Pose, analysis };
}

function photoRow(db: Db, id: string): PhotoRow {
  const row = db.select().from(schema.bodyPhotos).where(and(eq(schema.bodyPhotos.id, id), isNull(schema.bodyPhotos.deletedAt))).get();
  if (!row) throw notFound("Body photo");
  return row;
}

export function getBodyPhoto(db: Db, id: string): BodyPhoto {
  const row = photoRow(db, id);
  return serializePhoto(row, latestAnalyses(db, [id]).get(id) ?? null);
}

/** Newest first, each with its latest analysis. */
export function listBodyPhotos(db: Db, pose?: Pose): BodyPhoto[] {
  const where = pose ? and(isNull(schema.bodyPhotos.deletedAt), eq(schema.bodyPhotos.pose, pose)) : isNull(schema.bodyPhotos.deletedAt);
  const rows = db.select().from(schema.bodyPhotos).where(where).orderBy(desc(schema.bodyPhotos.date), desc(schema.bodyPhotos.takenAt)).all();
  const analyses = latestAnalyses(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => serializePhoto(r, analyses.get(r.id) ?? null));
}

export async function addBodyPhoto(ctx: AppContext, image: Blob, fields: BodyPhotoFields, actor = "user"): Promise<BodyPhoto> {
  const saved = await saveUpload(ctx.env, "body", image);
  const date = fields.date ?? todayString();
  const weightKg = fields.weightKg ?? weightOn(ctx.db, date)?.weightKg ?? null;
  const pose = fields.pose ?? "front";
  ctx.db.insert(schema.bodyPhotos).values({ id: saved.id, date, takenAt: nowIso(), path: saved.path, pose, weightKg, note: fields.note ?? null }).run();
  logActivity(ctx.db, { actor, action: "created", entity: "body_photo", entityId: saved.id, summary: `Added ${pose} progress photo for ${date}` });
  return getBodyPhoto(ctx.db, saved.id);
}

export function deleteBodyPhoto(ctx: AppContext, id: string, actor = "user"): void {
  const row = photoRow(ctx.db, id);
  ctx.db.update(schema.bodyPhotos).set({ deletedAt: nowIso() }).where(eq(schema.bodyPhotos.id, id)).run();
  deleteUpload(ctx.env, row.path);
  logActivity(ctx.db, { actor, action: "deleted", entity: "body_photo", entityId: id, summary: `Deleted ${row.pose} progress photo from ${row.date}` });
}

/** The most recent earlier photo with the same pose. */
export function previousPhoto(db: Db, current: PhotoRow): PhotoRow | null {
  return (
    db
      .select()
      .from(schema.bodyPhotos)
      .where(
        and(
          isNull(schema.bodyPhotos.deletedAt),
          eq(schema.bodyPhotos.pose, current.pose),
          or(lt(schema.bodyPhotos.date, current.date), and(eq(schema.bodyPhotos.date, current.date), lt(schema.bodyPhotos.takenAt, current.takenAt))),
        ),
      )
      .orderBy(desc(schema.bodyPhotos.date), desc(schema.bodyPhotos.takenAt))
      .limit(1)
      .get() ?? null
  );
}

export function goalText(profile: HealthProfile): string | null {
  const verb = profile.goal === "lose" ? "lose weight" : profile.goal === "gain" ? "gain weight and muscle" : "maintain weight";
  const pace = profile.goal !== "maintain" && profile.paceKgPerWeek > 0 ? ` at about ${profile.paceKgPerWeek} kg per week` : "";
  const target = profile.targetWeightKg ? `, target ${profile.targetWeightKg} kg` : "";
  return `${verb}${pace}${target}`;
}

export async function analyzeBodyPhoto(ctx: AppContext, id: string, compareToId: string | undefined, actor = "user"): Promise<PhotoAnalysis> {
  assertAiEnabled(ctx);
  const current = photoRow(ctx.db, id);
  if (compareToId === id) throw badRequest("Compare with a different photo.");
  const previous = compareToId ? photoRow(ctx.db, compareToId) : previousPhoto(ctx.db, current);
  const req: BodyComparisonRequest = {
    current: { ...readUploadBase64(ctx.env, current.path), date: current.date, weightKg: current.weightKg },
    previous: previous ? { ...readUploadBase64(ctx.env, previous.path), date: previous.date, weightKg: previous.weightKg } : null,
    goal: goalText(getHealthProfile(ctx.db)),
  };
  const result = await withAi(() => ctx.ai.compareBodyPhotos(req));
  const analysisId = newId();
  const progressScore = previous && result.progressScore != null && Number.isFinite(result.progressScore) ? Math.max(-2, Math.min(2, Math.round(result.progressScore))) : null;
  ctx.db
    .insert(schema.photoAnalyses)
    .values({ id: analysisId, photoId: id, comparedToPhotoId: previous?.id ?? null, summary: result.summary.trim(), observations: JSON.stringify(result.observations.map((o) => o.trim()).filter(Boolean)), progressScore })
    .run();
  logActivity(ctx.db, { actor, action: "analyzed", entity: "body_photo", entityId: id, summary: previous ? `Compared ${current.pose} photo ${current.date} with ${previous.date}` : `Described ${current.pose} photo ${current.date}` });
  return serializeAnalysis(ctx.db.select().from(schema.photoAnalyses).where(eq(schema.photoAnalyses.id, analysisId)).get()!);
}

export interface TimelineEntry {
  photoId: string;
  date: string;
  pose: Pose;
  path: string;
  weightKg: number | null;
  analysis: PhotoAnalysis | null;
}
export interface BodyProgress {
  timeline: Record<Pose, TimelineEntry[]>;
  pairs: Record<Pose, { first: TimelineEntry; last: TimelineEntry } | null>;
}

/** Oldest to newest per pose, plus the first and last photo of each pose for a before/after view. */
export function bodyProgress(db: Db): BodyProgress {
  const rows = db.select().from(schema.bodyPhotos).where(isNull(schema.bodyPhotos.deletedAt)).orderBy(asc(schema.bodyPhotos.date), asc(schema.bodyPhotos.takenAt)).all();
  const analyses = latestAnalyses(
    db,
    rows.map((r) => r.id),
  );
  const timeline: BodyProgress["timeline"] = { front: [], side: [], back: [] };
  for (const r of rows) {
    const pose = Pose.safeParse(r.pose).success ? (r.pose as Pose) : "front";
    timeline[pose].push({ photoId: r.id, date: r.date, pose, path: r.path, weightKg: r.weightKg, analysis: analyses.get(r.id) ?? null });
  }
  const pairs: BodyProgress["pairs"] = { front: null, side: null, back: null };
  for (const pose of Pose.options) {
    const list = timeline[pose];
    const first = list[0];
    const last = list[list.length - 1];
    pairs[pose] = first && last && list.length >= 2 ? { first, last } : null;
  }
  return { timeline, pairs };
}
