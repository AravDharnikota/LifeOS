import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/ui/Screen";
import { Skeleton, InlineError } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/hooks";
import { keys, useSettings, type SettingsResponse } from "@/data/queries";
import { GlassCard } from "@/ui/viz";
import { ProfileSection } from "./ProfileSection";
import { HealthSection } from "./HealthSection";
import { SchedulerSection } from "./SchedulerSection";
import { IntegrationsSection, LivePill } from "./IntegrationsSection";
import { AboutSection, DataSection, DeviceSection } from "./SystemSections";

const NAV = [
  { id: "profile", label: "Profile" },
  { id: "health", label: "Health" },
  { id: "scheduler", label: "Scheduler" },
  { id: "integrations", label: "Integrations" },
  { id: "device", label: "Device" },
  { id: "data", label: "Data" },
  { id: "about", label: "About" },
] as const;

/** Mobile: one long inset-grouped screen. Desktop: a section list on the left, the same content on the right. */
export function SettingsHome() {
  const { data, isLoading, error, refetch } = useSettings();
  const isDesktop = useIsDesktop();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [googleError, setGoogleError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<string>("profile");

  // The Google OAuth callback lands here with ?google=connected|error.
  useEffect(() => {
    const g = params.get("google");
    if (!g) return;
    if (g === "connected") {
      toast("Google connected.");
      void qc.invalidateQueries({ queryKey: keys.settings });
      void qc.invalidateQueries({ queryKey: ["google"] });
    } else if (g === "error") setGoogleError(params.get("message") || "Google sign-in failed.");
    setParams({}, { replace: true });
  }, [params, setParams, qc]);

  // Highlight the section under the top of the scroller.
  useEffect(() => {
    if (!isDesktop || !data) return;
    const root = scrollRef.current;
    if (!root) return;
    const els = NAV.map((n) => document.getElementById(n.id)).filter((e): e is HTMLElement => Boolean(e));
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { root, rootMargin: "-10% 0px -70% 0px", threshold: 0 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [isDesktop, data]);

  const jump = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Screen title="Settings" scrollRef={scrollRef}>
      {isLoading ? (
        <Skeleton rows={5} />
      ) : error || !data ? (
        <InlineError onRetry={() => void refetch()}>Unable to load settings</InlineError>
      ) : (
        <div className={cn(isDesktop && "flex items-start gap-4 pl-[var(--gutter)]")}>
          {isDesktop && (
            <nav className="sticky top-2 w-[200px] shrink-0 glass rounded-lg p-1.5 flex flex-col gap-0.5" aria-label="Settings sections">
              {NAV.map((n) => (
                <button key={n.id} type="button" onClick={() => jump(n.id)} className={cn("h-9 px-3 rounded-full text-left text-[14px] transition-colors duration-150", active === n.id ? "bg-surface-2 shadow-thumb text-primary" : "text-secondary hover:bg-pressed")}>
                  {n.label}
                </button>
              ))}
            </nav>
          )}
          <div className={cn("flex-1 min-w-0", isDesktop && "max-w-[640px]")}>
            <div id="profile" className="scroll-mt-2">
              <ProfileCard data={data} />
              <div className="mt-7 rise" style={{ "--i": 1 } as CSSProperties}>
                <ProfileSection app={data.app} />
              </div>
            </div>
            {SECTIONS.map(({ id, render }, i) => (
              <div key={id} id={id} className="scroll-mt-2 mt-8 rise" style={{ "--i": i + 2 } as CSSProperties}>
                {render(data, googleError)}
              </div>
            ))}
          </div>
        </div>
      )}
    </Screen>
  );
}

const SECTIONS: { id: string; render: (d: SettingsResponse, googleError: string | null) => ReactNode }[] = [
  { id: "health", render: (d) => <HealthSection profile={d.healthProfile} units={d.app.units} /> },
  { id: "scheduler", render: (d) => <SchedulerSection prefs={d.scheduler} hour12={d.app.hour12} /> },
  { id: "integrations", render: (d, ge) => <IntegrationsSection integrations={d.integrations} app={d.app} googleError={ge} /> },
  { id: "device", render: () => <DeviceSection /> },
  { id: "data", render: () => <DataSection /> },
  { id: "about", render: (d) => <AboutSection server={d.server} /> },
];

/** Who and what: an ink monogram, the name, the build, and whether each connection is live. */
function ProfileCard({ data }: { data: SettingsResponse }) {
  const name = data.app.name.trim() || "AravOS";
  const { anthropic, google } = data.integrations;
  const status: { label: string; live: boolean }[] = [
    { label: "Assistant", live: anthropic.configured },
    { label: "Google", live: google.configured && google.connected },
    { label: "MCP", live: Boolean(data.integrations.mcp.url) },
  ];
  return (
    <GlassCard tone="strong" className="mx-[var(--gutter)] rise">
      <div className="flex items-center gap-3.5">
        <span className="w-14 h-14 rounded-full bg-primary text-canvas inline-flex items-center justify-center shrink-0 shadow-thumb" aria-hidden="true">
          <span className="num text-[26px] leading-none">{name.charAt(0).toUpperCase()}</span>
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[20px] leading-6 text-primary truncate">{name}</div>
          <div className="text-[13px] leading-4 text-tertiary truncate mt-1">
            AravOS <span className="tabular">{data.server.version}</span> · {data.server.timezone}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4">
        {status.map((s) => (
          <div key={s.label} className="well rounded-md px-3 py-2.5 flex flex-col items-start gap-1.5 min-w-0">
            <span className="text-[12px] leading-4 text-tertiary truncate max-w-full">{s.label}</span>
            <LivePill live={s.live} />
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
