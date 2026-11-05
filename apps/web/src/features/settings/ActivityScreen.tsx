import type { Activity } from "@aravos/shared";
import { dateOfIso } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Section, Row } from "@/ui/List";
import type { IconName } from "@/ui/Icon";
import { IconGroup, RowIcon } from "./parts";
import { Empty, Skeleton, InlineError } from "@/ui/Empty";
import { useAppSettings } from "@/data/queries";
import { fmtRelativeDate, fmtTime } from "@/lib/format";
import { useActivity } from "./api";

const ACTOR: Record<string, string> = { user: "App", agent: "Assistant", mcp: "MCP", scheduler: "Scheduler", google: "Google", system: "System" };
const actorLabel = (a: string) => ACTOR[a] ?? a;
const ACTOR_ICON: Record<string, IconName> = { user: "home", agent: "sparkle", mcp: "link", scheduler: "clock", google: "google", system: "gear" };

function groupByDay(rows: Activity[]): { day: string; rows: Activity[] }[] {
  const out: { day: string; rows: Activity[] }[] = [];
  for (const r of rows) {
    const day = dateOfIso(r.at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else out.push({ day, rows: [r] });
  }
  return out;
}

/** /settings/activity: everything the app, the assistant and MCP clients changed, newest first. */
export function ActivityScreen() {
  const { data, isLoading, error, refetch } = useActivity();
  const { hour12 } = useAppSettings();
  const groups = groupByDay(data ?? []);
  return (
    <Screen title="Activity" back="/settings">
      <div className="lg:max-w-[640px]">
        {isLoading ? (
          <Skeleton rows={5} />
        ) : error ? (
          <InlineError onRetry={() => void refetch()}>Unable to load activity</InlineError>
        ) : groups.length === 0 ? (
          <Empty>No activity yet.</Empty>
        ) : (
          groups.map((g) => (
            <Section key={g.day} title={fmtRelativeDate(g.day)}>
              <IconGroup>
                {g.rows.map((r) => (
                  <Row key={r.id} leading={<RowIcon name={ACTOR_ICON[r.actor] ?? "info"} />} title={r.summary} subtitle={`${actorLabel(r.actor)}, ${r.action}${r.entity.toLowerCase() === r.actor.toLowerCase() ? "" : ` ${r.entity.replace(/_/g, " ")}`}`} trailing={<span className="text-[13px] text-tertiary">{fmtTime(r.at, hour12)}</span>} />
                ))}
              </IconGroup>
            </Section>
          ))
        )}
      </div>
    </Screen>
  );
}
