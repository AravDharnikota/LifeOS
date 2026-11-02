import { z } from "zod";
import { Widget } from "@aravos/shared";
import type { App } from "../app.ts";
import { parseBody } from "../lib/http.ts";
import { addWidget, getLayout, listLayoutVersions, moveWidget, removeWidget, revertLayout, saveLayout, updateWidget } from "../services/layout.ts";

export function layoutRoutes(app: App): void {
  app.get("/api/layout/:id", (c) => c.json(getLayout(c.get("ctx").db, c.req.param("id"))));
  app.put("/api/layout/:id", async (c) => {
    const body = await parseBody(c, z.object({ spec: z.unknown(), reason: z.string().max(200).optional() }));
    return c.json(saveLayout(c.get("ctx").db, c.req.param("id"), body.spec, body.reason ?? "Edited layout", c.get("actor")));
  });
  app.post("/api/layout/:id/revert", (c) => c.json(revertLayout(c.get("ctx").db, c.req.param("id"), c.get("actor"))));
  app.get("/api/layout/:id/versions", (c) => c.json(listLayoutVersions(c.get("ctx").db, c.req.param("id"))));
  app.post("/api/layout/:id/widgets", async (c) => {
    const body = await parseBody(c, z.object({ widget: Widget, sectionId: z.string().optional(), position: z.enum(["top", "bottom"]).optional(), sectionTitle: z.string().optional() }));
    return c.json(addWidget(c.get("ctx").db, c.req.param("id"), body.widget, body, c.get("actor")), 201);
  });
  app.patch("/api/layout/:id/widgets/:wid", async (c) => {
    const body = await parseBody(c, z.record(z.string(), z.unknown()));
    return c.json(updateWidget(c.get("ctx").db, c.req.param("id"), c.req.param("wid"), body, c.get("actor")));
  });
  app.post("/api/layout/:id/widgets/:wid/move", async (c) => {
    const body = await parseBody(c, z.object({ sectionId: z.string().optional(), index: z.number().int().min(0).optional() }));
    return c.json(moveWidget(c.get("ctx").db, c.req.param("id"), c.req.param("wid"), body, c.get("actor")));
  });
  app.delete("/api/layout/:id/widgets/:wid", (c) => c.json(removeWidget(c.get("ctx").db, c.req.param("id"), c.req.param("wid"), c.get("actor"))));
}
