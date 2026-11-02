import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { BodyPhoto, PhotoAnalysis } from "@aravos/shared";
import { makeTestApp, type TestApp } from "./helpers.ts";
import type { BodyComparisonRequest } from "../src/ai/provider.ts";
import type { BodyProgress } from "../src/services/body.ts";

const t = makeTestApp();
afterAll(() => t.cleanup());

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function upload(app: TestApp, fields: Record<string, string>, bytes: Buffer = PNG): Promise<{ status: number; data: BodyPhoto & { error?: string } }> {
  const fd = new FormData();
  fd.append("image", new Blob([new Uint8Array(bytes)]), "photo.bin");
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await app.fetch("/api/body/photos", { method: "POST", body: fd });
  return { status: res.status, data: (await res.json()) as BodyPhoto & { error?: string } };
}

describe("body photos", () => {
  let first: BodyPhoto;
  let second: BodyPhoto;
  it("uploads a photo and defaults the weight from that day's log", async () => {
    await t.api("POST", "/api/weight", { date: "2026-10-01", weightKg: 82 });
    const r = await upload(t, { pose: "front", date: "2026-10-01", note: "baseline" });
    expect(r.status).toBe(201);
    first = r.data;
    expect(first.pose).toBe("front");
    expect(first.date).toBe("2026-10-01");
    expect(first.weightKg).toBe(82);
    expect(first.note).toBe("baseline");
    expect(first.path).toMatch(/^\/uploads\/body\/[0-9a-f-]+\.png$/);
    expect(first.analysis).toBeNull();
    expect(fs.existsSync(path.join(t.ctx.env.uploadsDir, "body", path.basename(first.path)))).toBe(true);
    const list = await t.api<BodyPhoto[]>("GET", "/api/body/photos?pose=front");
    expect(list.data.map((p) => p.id)).toEqual([first.id]);
    const defaults = await upload(t, {});
    expect(defaults.data.pose).toBe("front");
    expect(defaults.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await t.api("DELETE", `/api/body/photos/${defaults.data.id}`);
  });
  it("validates uploads", async () => {
    const noImage = await t.fetch("/api/body/photos", { method: "POST", body: new FormData() });
    expect(noImage.status).toBe(400);
    const badPose = await upload(t, { pose: "upside-down" });
    expect(badPose.status).toBe(400);
    const notImage = await upload(t, { pose: "front" }, Buffer.from("plain text"));
    expect(notImage.status).toBe(415);
    const badWeight = await upload(t, { weightKg: "-5" });
    expect(badWeight.status).toBe(400);
  });
  it("analyzes against the previous photo of the same pose using the profile goal", async () => {
    await t.api("PATCH", "/api/settings/health-profile", { goal: "lose", paceKgPerWeek: 0.5, targetWeightKg: 75 });
    second = (await upload(t, { pose: "front", date: "2026-11-01", weightKg: "80" })).data;
    expect(second.weightKg).toBe(80);
    let seen: BodyComparisonRequest | null = null;
    const original = t.ai.bodyHandler;
    t.ai.bodyHandler = async (req) => {
      seen = req;
      return original(req);
    };
    const r = await t.api<PhotoAnalysis>("POST", `/api/body/photos/${second.id}/analyze`);
    t.ai.bodyHandler = original;
    expect(r.status).toBe(201);
    expect(r.data.photoId).toBe(second.id);
    expect(r.data.comparedToPhotoId).toBe(first.id);
    expect(r.data.progressScore).toBe(1);
    expect(r.data.observations).toHaveLength(3);
    expect(r.data.summary).toContain("shoulder");
    expect(seen!.current.date).toBe("2026-11-01");
    expect(seen!.current.weightKg).toBe(80);
    expect(seen!.current.mediaType).toBe("image/png");
    expect(seen!.previous?.date).toBe("2026-10-01");
    expect(seen!.previous?.weightKg).toBe(82);
    expect(seen!.goal).toBe("lose weight at about 0.5 kg per week, target 75 kg");
    const detail = await t.api<BodyPhoto>("GET", `/api/body/photos/${second.id}`);
    expect(detail.data.analysis?.id).toBe(r.data.id);
    const list = await t.api<BodyPhoto[]>("GET", "/api/body/photos");
    expect(list.data[0]?.id).toBe(second.id);
    expect(list.data[0]?.analysis?.id).toBe(r.data.id);
    expect(list.data[1]?.analysis).toBeNull();
  });
  it("describes a photo without a previous one and honours compareToId", async () => {
    const baseline = await t.api<PhotoAnalysis>("POST", `/api/body/photos/${first.id}/analyze`, {});
    expect(baseline.data.comparedToPhotoId).toBeNull();
    expect(baseline.data.progressScore).toBeNull();
    const side = (await upload(t, { pose: "side", date: "2026-11-02" })).data;
    const explicit = await t.api<PhotoAnalysis>("POST", `/api/body/photos/${side.id}/analyze`, { compareToId: first.id });
    expect(explicit.data.comparedToPhotoId).toBe(first.id);
    expect(explicit.data.progressScore).toBe(1);
    const self = await t.api("POST", `/api/body/photos/${side.id}/analyze`, { compareToId: side.id }, { allowError: true });
    expect(self.status).toBe(400);
    const unknown = await t.api("POST", `/api/body/photos/${side.id}/analyze`, { compareToId: "nope" }, { allowError: true });
    expect(unknown.status).toBe(404);
    const missing = await t.api("POST", "/api/body/photos/nope/analyze", {}, { allowError: true });
    expect(missing.status).toBe(404);
  });
  it("builds a progress timeline grouped by pose with before and after pairs", async () => {
    const r = await t.api<BodyProgress>("GET", "/api/body/progress");
    expect(r.data.timeline.front.map((e) => e.photoId)).toEqual([first.id, second.id]);
    expect(r.data.timeline.front[1]).toMatchObject({ date: "2026-11-01", pose: "front", path: second.path, weightKg: 80 });
    expect(r.data.timeline.front[1]?.analysis?.comparedToPhotoId).toBe(first.id);
    expect(r.data.timeline.side).toHaveLength(1);
    expect(r.data.timeline.back).toEqual([]);
    expect(r.data.pairs.front?.first.photoId).toBe(first.id);
    expect(r.data.pairs.front?.last.photoId).toBe(second.id);
    expect(r.data.pairs.side).toBeNull();
    expect(r.data.pairs.back).toBeNull();
  });
  it("soft deletes a photo and removes its file", async () => {
    const abs = path.join(t.ctx.env.uploadsDir, "body", path.basename(first.path));
    expect(fs.existsSync(abs)).toBe(true);
    await t.api("DELETE", `/api/body/photos/${first.id}`);
    expect(fs.existsSync(abs)).toBe(false);
    const gone = await t.api("GET", `/api/body/photos/${first.id}`, undefined, { allowError: true });
    expect(gone.status).toBe(404);
    const list = await t.api<BodyPhoto[]>("GET", "/api/body/photos?pose=front");
    expect(list.data.map((p) => p.id)).toEqual([second.id]);
    const progress = await t.api<BodyProgress>("GET", "/api/body/progress");
    expect(progress.data.timeline.front).toHaveLength(1);
    expect(progress.data.pairs.front).toBeNull();
    const again = await t.api("DELETE", `/api/body/photos/${first.id}`, undefined, { allowError: true });
    expect(again.status).toBe(404);
  });
  it("returns 503 when AI is disabled", async () => {
    const off = makeTestApp();
    off.ai.enabled = false;
    const photo = (await upload(off, { pose: "front" })).data;
    const r = await off.api<{ error: string }>("POST", `/api/body/photos/${photo.id}/analyze`, {}, { allowError: true });
    expect(r.status).toBe(503);
    expect(r.data.error).toContain("ANTHROPIC_API_KEY");
    off.cleanup();
  });
});
