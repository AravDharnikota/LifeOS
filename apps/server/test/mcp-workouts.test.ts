import { describe, it, expect, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import { makeTestApp, type TestApp } from "./helpers.ts";
import { schema } from "../src/db/client.ts";

const t = makeTestApp();
afterAll(() => t.cleanup());

async function connect(app: TestApp): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), { fetch: (url, init) => app.fetch(String(url), init), requestInit: { headers: { "X-Actor": "muse" } } });
  const client = new Client({ name: "vitest", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Json> {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const body = JSON.parse(r.content[0]!.text) as Json;
  if (r.isError) throw new Error(`${name} failed: ${JSON.stringify(body)}`);
  return body;
}
async function callError(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  expect(r.isError).toBe(true);
  return r.content[0]!.text;
}

async function exerciseId(client: Client, q: string, name: string): Promise<string> {
  const r = await call(client, "search_exercises", { q });
  const hit = (r.exercises as { id: string; name: string }[]).find((e) => e.name === name);
  if (!hit) throw new Error(`${name} not found for "${q}"`);
  return hit.id;
}

describe("mcp workout tools", () => {
  it("lists the workout tools with annotations", async () => {
    const client = await connect(t);
    const { tools } = await client.listTools();
    const names = tools.map((x) => x.name);
    for (const n of ["search_exercises", "create_exercise", "list_templates", "get_template", "create_template", "update_template", "duplicate_template", "delete_template", "get_active_workout", "get_workout", "start_workout", "add_workout_exercise", "log_workout_set", "add_workout_set", "finish_workout", "discard_workout", "log_workout", "update_workout", "delete_workout"]) expect(names).toContain(n);
    expect(tools.find((x) => x.name === "search_exercises")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((x) => x.name === "delete_template")?.annotations?.destructiveHint).toBe(true);
    await client.close();
  });

  it("searches by alias and creates, edits, duplicates and deletes templates in pounds", async () => {
    const client = await connect(t);
    const bench = await exerciseId(client, "bench", "Bench Press (Barbell)");
    const curl = await exerciseId(client, "curl", "Bicep Curl (Dumbbell)");

    const created = await call(client, "create_template", {
      name: "Push A",
      folder: "PPL",
      exercises: [
        { exerciseId: bench, restSeconds: 180, sets: [{ weight: 185, reps: 5 }, { weight: 185, reps: 5 }, { weight: 185, reps: 5 }] },
        { exerciseId: curl, sets: [{ weight: 30, reps: 10 }] },
      ],
    });
    expect(created.units.weight).toBe("lb");
    expect(created.exercises).toHaveLength(2);
    expect(created.exercises[0].sets).toHaveLength(3);
    expect(created.exercises[0].sets[0].weight).toBe(185);
    // stored in kg
    const tex = t.ctx.db.select().from(schema.templateExercises).where(eq(schema.templateExercises.templateId, created.id)).all();
    const stored = t.ctx.db.select().from(schema.templateSets).where(eq(schema.templateSets.templateExerciseId, tex.find((e) => e.exerciseId === bench)!.id)).all();
    expect(stored[0]!.targetWeight).toBeCloseTo(83.91, 1);

    const metric = await call(client, "get_template", { templateId: created.id, units: "metric" });
    expect(metric.units.weight).toBe("kg");
    expect(metric.exercises[0].sets[0].weight).toBeCloseTo(83.9, 1);

    const listed = await call(client, "list_templates");
    expect(listed.templates.find((x: Json) => x.id === created.id).exercises[0]).toMatchObject({ name: "Bench Press (Barbell)", sets: 3 });

    const renamed = await call(client, "update_template", { templateId: created.id, name: "Push Day" });
    expect(renamed.name).toBe("Push Day");
    expect(renamed.folder).toBe("PPL");
    expect(renamed.exercises).toHaveLength(2);

    const replaced = await call(client, "update_template", { templateId: created.id, exercises: [{ exerciseId: bench, sets: [{ weight: 195, reps: 3 }] }] });
    expect(replaced.name).toBe("Push Day");
    expect(replaced.folder).toBe("PPL");
    expect(replaced.exercises).toHaveLength(1);
    expect(replaced.exercises[0].sets[0]).toMatchObject({ weight: 195, reps: 3 });

    const bad = await callError(client, "create_template", { name: "Bad", exercises: [{ exerciseId: "nope" }] });
    expect(bad).toContain("Unknown exercise");
    expect(bad).toContain("nope");

    const copy = await call(client, "duplicate_template", { templateId: created.id });
    expect(copy.name).toBe("Push Day (copy)");
    const del = await call(client, "delete_template", { templateId: copy.id });
    expect(del.deleted).toBe(true);
    const after = await call(client, "list_templates");
    expect(after.templates.some((x: Json) => x.id === copy.id)).toBe(false);

    const log = t.ctx.db.select().from(schema.activityLog).all().filter((r) => r.entity === "workout_template");
    expect(log.some((r) => r.actor === "mcp:muse" && r.summary.includes("Push A"))).toBe(true);
    await client.close();
  });

  it("runs a live workout from a template and finishes it with PRs", async () => {
    const client = await connect(t);
    expect((await call(client, "get_active_workout")).active).toBe(false);
    expect(await callError(client, "finish_workout", {})).toContain("No workout is in progress");

    const { templates } = await call(client, "list_templates");
    const push = templates.find((x: Json) => x.name === "Push Day");
    const started = await call(client, "start_workout", { templateId: push.id });
    expect(started.status).toBe("active");
    expect(started.name).toBe("Push Day");
    expect(started.exercises[0].sets[0]).toMatchObject({ weight: 195, reps: 3, completed: false });

    const logged = await call(client, "log_workout_set", { setId: started.exercises[0].sets[0].setId, reps: 4 });
    expect(logged).toMatchObject({ weight: 195, reps: 4, completed: true });
    const extra = await call(client, "add_workout_set", { workoutExerciseId: started.exercises[0].workoutExerciseId, reps: 2 });
    expect(extra).toMatchObject({ weight: 195, reps: 2, completed: true });

    const plank = await exerciseId(client, "plank", "Plank");
    const added = await call(client, "add_workout_exercise", { exerciseId: plank, sets: [{ seconds: 60 }, { seconds: 45 }] });
    expect(added.exercise.name).toBe("Plank");
    expect(added.exercise.sets.map((s: Json) => [s.seconds, s.completed])).toEqual([
      [60, false],
      [45, false],
    ]);

    const active = await call(client, "get_active_workout");
    expect(active.workout.exercises).toHaveLength(2);

    const done = await call(client, "finish_workout", {});
    expect(done.workout.status).toBe("completed");
    expect(done.workout.exercises).toHaveLength(1); // the uncompleted plank sets were dropped
    expect(done.workout.totalSets).toBe(2);
    expect(done.prs.length).toBeGreaterThan(0);
    expect(done.prs.find((p: Json) => p.type === "weight")?.value).toBe(195);
    expect((await call(client, "get_active_workout")).active).toBe(false);
    await client.close();
  });

  it("logs a past workout in one call, edits it, and deletes it", async () => {
    const client = await connect(t);
    const squat = await exerciseId(client, "squat", "Squat (Barbell)");
    const pullup = await exerciseId(client, "pull up", "Pull Up");
    const w = await call(client, "log_workout", {
      name: "Legs",
      startedAt: "2026-11-01T18:00:00Z",
      durationMinutes: 45,
      notes: "Felt strong",
      exercises: [
        { exerciseId: squat, sets: [{ weight: 225, reps: 5 }, { weight: 225, reps: 5 }] },
        { exerciseId: pullup, sets: [{ reps: 10 }] },
      ],
    });
    expect(w).toMatchObject({ name: "Legs", status: "completed", startedAt: "2026-11-01T18:00:00.000Z", finishedAt: "2026-11-01T18:45:00.000Z", durationMinutes: 45, notes: "Felt strong", totalSets: 3 });
    expect(w.exercises[0].sets.every((s: Json) => s.completed && s.weight === 225)).toBe(true);
    expect((await call(client, "get_active_workout")).active).toBe(false);

    const moved = await call(client, "update_workout", { workoutId: w.id, startedAt: "2026-10-31T09:00:00Z", durationMinutes: 30 });
    expect(moved).toMatchObject({ startedAt: "2026-10-31T09:00:00.000Z", finishedAt: "2026-10-31T09:30:00.000Z", durationMinutes: 30 });

    expect(await callError(client, "log_workout", { startedAt: "2999-01-01T10:00", exercises: [{ exerciseId: squat, sets: [{ weight: 100, reps: 1 }] }] })).toContain("future");
    expect(await callError(client, "log_workout", { startedAt: "2026-11-01", exercises: [{ exerciseId: squat, sets: [{ weight: 100, reps: 1 }] }] })).toContain("date and time");

    // a failing exercise rolls the whole log back
    const before = t.ctx.db.select().from(schema.workouts).all().length;
    expect(await callError(client, "log_workout", { exercises: [{ exerciseId: squat, sets: [{ weight: 100, reps: 1 }] }, { exerciseId: "missing", sets: [{ reps: 1 }] }] })).toContain("not found");
    expect(t.ctx.db.select().from(schema.workouts).all().length).toBe(before);
    expect((await call(client, "get_active_workout")).active).toBe(false);

    const del = await call(client, "delete_workout", { workoutId: w.id });
    expect(del.deleted).toBe(true);
    await client.close();
  });

  it("refuses to log a past workout while one is live, and discards", async () => {
    const client = await connect(t);
    const live = await call(client, "start_workout", { name: "Quick" });
    const squat = await exerciseId(client, "squat", "Squat (Barbell)");
    expect(await callError(client, "log_workout", { exercises: [{ exerciseId: squat, sets: [{ weight: 100, reps: 1 }] }] })).toContain("is in progress");
    expect(await callError(client, "start_workout", {})).toContain("already in progress");
    const gone = await call(client, "discard_workout", {});
    expect(gone).toMatchObject({ discarded: true, id: live.id });
    await client.close();
  });
});
