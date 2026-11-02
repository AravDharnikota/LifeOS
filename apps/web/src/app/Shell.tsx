import { Suspense, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/ui/Icon";
import { useIsDesktop } from "@/lib/hooks";
import { useUi } from "@/state/ui";
import { AgentSheet } from "@/features/agent/AgentSheet";
import { Skeleton } from "@/ui/Empty";

const tabs: { to: string; label: string; icon: IconName; fill: IconName }[] = [
  { to: "/", label: "Today", icon: "sun", fill: "sun-fill" },
  { to: "/calendar", label: "Calendar", icon: "calendar", fill: "calendar-fill" },
  { to: "/tasks", label: "Tasks", icon: "checklist", fill: "checklist-fill" },
  { to: "/health", label: "Health", icon: "heart", fill: "heart-fill" },
  { to: "/goals", label: "Goals", icon: "flag", fill: "flag-fill" },
];

function isActive(path: string, to: string): boolean {
  return to === "/" ? path === "/" : path === to || path.startsWith(to + "/");
}

/** Mobile: bottom tab bar (49px + safe area). Desktop: left sidebar. */
export function Shell() {
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const openAgent = useUi((s) => s.openAgent);

  return (
    <div className={cn("h-dvh w-full bg-canvas text-primary flex", isDesktop ? "flex-row" : "flex-col")}>
      {isDesktop && (
        <aside className="w-[var(--sidebar-w)] shrink-0 h-full flex flex-col border-r border-separator bg-canvas pt-4 pb-4">
          <div className="px-5 pb-4 text-headline">AravOS</div>
          <nav className="flex flex-col gap-0.5 px-3">
            {tabs.map((t) => {
              const active = isActive(location.pathname, t.to);
              return (
                <NavLink key={t.to} to={t.to} className={cn("flex items-center gap-3 h-9 px-2.5 rounded-sm text-subhead transition-colors duration-100", active ? "bg-surface-2 text-primary font-medium" : "text-secondary hover:bg-surface-2/60")}>
                  <Icon name={active ? t.fill : t.icon} size={20} className={active ? "text-accent-text" : "text-tertiary"} />
                  {t.label}
                </NavLink>
              );
            })}
          </nav>
          <div className="mt-auto px-3 flex flex-col gap-0.5">
            <button type="button" onClick={() => openAgent()} className="flex items-center gap-3 h-9 px-2.5 rounded-sm text-subhead text-secondary hover:bg-surface-2/60 transition-colors duration-100">
              <Icon name="sparkle" size={20} className="text-tertiary" />
              Assistant
              <span className="ml-auto text-caption-1 text-quaternary">⌘K</span>
            </button>
            <NavLink to="/settings" className={({ isActive: a }) => cn("flex items-center gap-3 h-9 px-2.5 rounded-sm text-subhead transition-colors duration-100", a ? "bg-surface-2 text-primary font-medium" : "text-secondary hover:bg-surface-2/60")}>
              <Icon name="gear" size={20} className="text-tertiary" />
              Settings
            </NavLink>
          </div>
        </aside>
      )}
      <main className="flex-1 min-w-0 h-full min-h-0 relative">
        <Suspense fallback={<div className="pt-20"><Skeleton rows={4} /></div>}>
          <Outlet />
        </Suspense>
      </main>
      {!isDesktop && <TabBar path={location.pathname} />}
      <AgentSheet />
    </div>
  );
}

function TabBar({ path }: { path: string }) {
  return (
    <nav className="shrink-0 bg-surface hairline-t flex items-stretch z-30" style={{ height: "calc(var(--tabbar-h) + var(--safe-bottom))", paddingBottom: "var(--safe-bottom)" }} aria-label="Primary">
      {tabs.map((t) => {
        const active = isActive(path, t.to);
        return (
          <NavLink
            key={t.to}
            to={t.to}
            onClick={(e) => {
              if (active) {
                e.preventDefault();
                document.querySelector<HTMLElement>("main .scroller")?.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            className={cn("flex-1 flex flex-col items-center justify-center gap-[3px] pt-1 select-none active:[&>svg]:scale-[0.92] [&>svg]:transition-transform [&>svg]:duration-100", active ? "text-accent-text" : "text-tertiary")}
          >
            <Icon name={active ? t.fill : t.icon} size={25} strokeWidth={1.6} />
            <span className="text-caption-2 font-medium">{t.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="h-full min-h-0">{children}</div>;
}
