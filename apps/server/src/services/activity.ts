import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { newId } from "../lib/ids.ts";

export function logActivity(db: Db, entry: { actor: string; action: string; entity: string; entityId?: string | null; summary: string; data?: unknown }): void {
  db.insert(schema.activityLog)
    .values({ id: newId(), actor: entry.actor, action: entry.action, entity: entry.entity, entityId: entry.entityId ?? null, summary: entry.summary, data: entry.data === undefined ? null : JSON.stringify(entry.data) })
    .run();
}
