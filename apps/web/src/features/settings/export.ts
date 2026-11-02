import { addDaysString, todayString } from "@aravos/shared";
import { api } from "@/lib/api";
import { isNative } from "@/lib/platform";

/** Pulls the key resources into one JSON file. Saves on the web, shares on native where supported. */
export async function exportData(): Promise<{ ok: true; failed: string[] } | { ok: false; reason: string }> {
  const today = todayString();
  const sources: Record<string, string> = {
    settings: "/api/settings",
    goals: "/api/goals?status=all",
    trackers: "/api/trackers",
    lists: "/api/lists",
    tasks: "/api/tasks?includeDone=true&limit=1000",
    events: `/api/events?from=${addDaysString(today, -365)}&to=${addDaysString(today, 365)}`,
    workouts: "/api/workouts",
    activity: "/api/activity?limit=200",
  };
  const names = Object.keys(sources);
  const results = await Promise.allSettled(names.map((n) => api.get<unknown>(sources[n]!)));
  const data: Record<string, unknown> = { app: "AravOS", exportedAt: new Date().toISOString() };
  const failed: string[] = [];
  results.forEach((r, i) => {
    const name = names[i]!;
    if (r.status === "fulfilled") data[name] = r.value;
    else failed.push(name);
  });
  if (failed.length === names.length) return { ok: false, reason: "Unable to reach the server" };
  const json = JSON.stringify(data, null, 2);
  const filename = `aravos-export-${today}.json`;

  if (isNative) {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      const file = new File([json], filename, { type: "application/json" });
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: filename });
        return { ok: true, failed };
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return { ok: true, failed };
    }
    return { ok: false, reason: "Export is available in the web app." };
  }

  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true, failed };
}
