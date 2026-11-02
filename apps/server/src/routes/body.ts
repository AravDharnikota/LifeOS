import type { Context } from "hono";
import { z } from "zod";
import type { App } from "../app.ts";
import { badRequest } from "../lib/errors.ts";
import { parseQuery } from "../lib/http.ts";
import { AnalyzeBody, BodyPhotoFields, Pose, addBodyPhoto, analyzeBodyPhoto, bodyProgress, deleteBodyPhoto, getBodyPhoto, listBodyPhotos } from "../services/body.ts";
import { readMultipart } from "./nutrition.ts";

const PhotosQuery = z.object({ pose: Pose.optional() });

/** JSON body that may be absent entirely. */
async function parseOptionalBody<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw = (await c.req.text()).trim();
  let json: unknown = {};
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      throw badRequest("Invalid JSON body");
    }
  }
  const r = schema.safeParse(json);
  if (!r.success) throw badRequest("Validation failed", r.error.issues);
  return r.data;
}

export function bodyRoutes(app: App): void {
  app.post("/api/body/photos", async (c) => {
    const { fields, files } = await readMultipart(c);
    if (!files.image) throw badRequest("Attach the photo as the `image` field.");
    const parsed = BodyPhotoFields.safeParse(fields);
    if (!parsed.success) throw badRequest("Validation failed", parsed.error.issues);
    return c.json(await addBodyPhoto(c.get("ctx"), files.image, parsed.data, c.get("actor")), 201);
  });
  app.get("/api/body/photos", (c) => c.json(listBodyPhotos(c.get("ctx").db, parseQuery(c, PhotosQuery).pose)));
  app.get("/api/body/progress", (c) => c.json(bodyProgress(c.get("ctx").db)));
  app.get("/api/body/photos/:id", (c) => c.json(getBodyPhoto(c.get("ctx").db, c.req.param("id"))));
  app.delete("/api/body/photos/:id", (c) => {
    deleteBodyPhoto(c.get("ctx"), c.req.param("id"), c.get("actor"));
    return c.json({ ok: true });
  });
  app.post("/api/body/photos/:id/analyze", async (c) => {
    const body = await parseOptionalBody(c, AnalyzeBody);
    return c.json(await analyzeBodyPhoto(c.get("ctx"), c.req.param("id"), body.compareToId, c.get("actor")), 201);
  });
}
