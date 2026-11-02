// Starts the API server with a fresh temp database and serves the built web app, for Playwright.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.E2E_PORT ?? "8790";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aravos-e2e-"));
const env = { ...process.env, PORT: port, ARAVOS_DATA_DIR: dataDir, ARAVOS_TOKEN: "", NODE_ENV: "test", ARAVOS_TIMEZONE: process.env.E2E_TZ ?? "America/Los_Angeles", ARAVOS_E2E: "1", ANTHROPIC_API_KEY: "" };
const child = spawn("node", ["--import", "tsx", "src/index.ts"], { cwd: path.join(root, "apps/server"), env, stdio: "inherit" });
const stop = () => {
  child.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
