// Usage: node scripts/shot.mjs <url-path> <name> [iphone|desktop|both] [--dark] [--full]
// Writes PNGs to the scratchpad shots folder (or SHOTS_DIR).
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
import path from "node:path";

const [, , urlPath = "/", name = "shot", which = "both", ...flags] = process.argv;
const dark = flags.includes("--dark");
const full = flags.includes("--full");
const scroll = Number((flags.find((f) => f.startsWith("--scroll=")) ?? "--scroll=0").split("=")[1]);
const waitFor = (flags.find((f) => f.startsWith("--wait=")) ?? "").split("=")[1];
const base = process.env.SHOT_BASE ?? "http://localhost:8791";
const outDir = process.env.SHOTS_DIR ?? "/tmp/claude-0/-home-user-LifeOS/eee1fa17-d032-5cc4-bbdb-fc531ee86f0f/scratchpad/shots";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const targets = which === "both" ? ["iphone", "desktop"] : [which];
for (const t of targets) {
  const ctx = await browser.newContext(
    t === "iphone"
      ? { ...devices["iPhone 14 Pro"], viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" }
      : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: dark ? "dark" : "light" },
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base + urlPath, { waitUntil: "networkidle" });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(600);
  if (scroll) {
    await page.evaluate((y) => { const el = document.querySelector("main .scroller") ?? document.scrollingElement; if (el) el.scrollTo({ top: y }); }, scroll);
    await page.waitForTimeout(400);
  }
  const file = path.join(outDir, `${name}-${t}${dark ? "-dark" : ""}${scroll ? "-s" + scroll : ""}.png`);
  await page.screenshot({ path: file, fullPage: full });
  console.log(file, errors.length ? "ERRORS: " + errors.join(" | ") : "");
  await ctx.close();
}
await browser.close();
