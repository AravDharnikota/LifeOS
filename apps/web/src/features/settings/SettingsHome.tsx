import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Screen } from "@/ui/Screen";
import { Skeleton, InlineError } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/hooks";
import { keys, useSettings } from "@/data/queries";
import { ProfileSection } from "./ProfileSection";
import { HealthSection } from "./HealthSection";
import { SchedulerSection } from "./SchedulerSection";
import { IntegrationsSection } from "./IntegrationsSection";
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
            <nav className="sticky top-2 w-[184px] shrink-0 flex flex-col gap-0.5 pt-1" aria-label="Settings sections">
              {NAV.map((n) => (
                <button key={n.id} type="button" onClick={() => jump(n.id)} className={cn("h-9 px-2.5 rounded-sm text-left text-subhead transition-colors duration-100", active === n.id ? "bg-surface-2 text-primary font-medium" : "text-secondary hover:bg-surface-2/60")}>
                  {n.label}
                </button>
              ))}
            </nav>
          )}
          <div className={cn("flex-1 min-w-0", isDesktop && "max-w-[640px]")}>
            <div id="profile" className="scroll-mt-2">
              <ProfileSection app={data.app} />
            </div>
            <div id="health" className="scroll-mt-2 mt-8">
              <HealthSection profile={data.healthProfile} units={data.app.units} />
            </div>
            <div id="scheduler" className="scroll-mt-2 mt-8">
              <SchedulerSection prefs={data.scheduler} hour12={data.app.hour12} />
            </div>
            <div id="integrations" className="scroll-mt-2 mt-8">
              <IntegrationsSection integrations={data.integrations} app={data.app} googleError={googleError} />
            </div>
            <div id="device" className="scroll-mt-2 mt-8">
              <DeviceSection />
            </div>
            <div id="data" className="scroll-mt-2 mt-8">
              <DataSection />
            </div>
            <div id="about" className="scroll-mt-2 mt-8">
              <AboutSection server={data.server} />
            </div>
          </div>
        </div>
      )}
    </Screen>
  );
}
