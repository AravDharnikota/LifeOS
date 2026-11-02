import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.ts";

export type Db = BetterSQLite3Database<typeof schema>;

function findMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../drizzle"), // src/db -> apps/server/drizzle
    path.resolve(here, "../../../../drizzle"), // dist/apps/server/src/db -> ???
    path.resolve(here, "../../../../../apps/server/drizzle"), // dist/apps/server/src/db -> apps/server/drizzle
    path.resolve(process.cwd(), "drizzle"),
    path.resolve(process.cwd(), "apps/server/drizzle"),
  ];
  for (const c of candidates) if (fs.existsSync(path.join(c, "meta/_journal.json"))) return c;
  throw new Error("Could not locate drizzle migrations folder. Looked in: " + candidates.join(", "));
}

export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema, casing: "snake_case" });
  migrate(db, { migrationsFolder: findMigrationsDir() });
  return db;
}

export { schema };
