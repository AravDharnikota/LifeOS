import { Suspense, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/ui/Icon";
import { useIsDesktop } from "@/lib/hooks";
import { useUi } from "@/state/ui";
import { AgentSheet } from "@/features/agent/AgentSheet";
import { RestTimerHost } from "@/features/workouts/WorkoutsRoutes";
import { QuickAdd } from "@/features/tasks/QuickAdd";
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

/** The lit scene behind all glass: soft out-of-focus light. */
export function Scene() {
  return (
    <div className="scene" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

/** Mobile: floating glass tab bar. Desktop: glass sidebar. Everything floats over the lit scene. */
export function Shell() {
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const openAgent = useUi((s) => s.openAgent);
  const area = location.pathname.split("/")[1] ?? "";

  return (
    <div className={cn("relative h-dvh w-full text-primary flex", isDesktop ? "flex-row" : "flex-col")}>
      <Scene />
      {isDesktop && (
        <aside className="relative z-10 w-[var(--sidebar-w)] shrink-0 h-full p-3">
          <div className="glass rounded-xl h-full flex flex-col py-4">
            <div className="px-4 pb-6 flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-[10px] bg-primary text-canvas inline-flex items-center justify-center"><Icon name="sparkle" size={16} strokeWidth={2} /></span>
              <span className="text-[17px]">AravOS</span>
            </div>
            <nav className="flex flex-col gap-1 px-2.5">
              {tabs.map((t) => {
                const active = isActive(location.pathname, t.to);
                return (
                  <NavLink key={t.to} to={t.to} className={cn("relative flex items-center gap-3 h-10 px-3 rounded-full text-[15px] transition-colors duration-150", active ? "text-primary" : "text-secondary hover:bg-pressed")}>
                    {active && <motion.span layoutId="side-pill" className="absolute inset-0 rounded-full bg-surface-2 shadow-thumb" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                    <Icon name={active ? t.fill : t.icon} size={19} strokeWidth={1.7} className="relative" />
                    <span className="relative">{t.label}</span>
                  </NavLink>
                );
              })}
            </nav>
            <div className="mt-auto px-2.5 flex flex-col gap-1">
              <button type="button" onClick={() => openAgent()} className="flex items-center gap-3 h-10 px-3 rounded-full text-[15px] text-secondary hover:bg-pressed transition-colors duration-100">
                <Icon name="sparkle" size={19} strokeWidth={1.7} />
                Assistant
                <span className="ml-auto text-caption-1 text-quaternary">⌘K</span>
              </button>
              <NavLink to="/settings" className={({ isActive: a }) => cn("flex items-center gap-3 h-10 px-3 rounded-full text-[15px] transition-colors duration-100", a ? "bg-surface-2 shadow-thumb text-primary" : "text-secondary hover:bg-pressed")}>
                <Icon name="gear" size={19} strokeWidth={1.7} />
                Settings
              </NavLink>
            </div>
          </div>
        </aside>
      )}
      <main className="relative z-[1] flex-1 min-w-0 h-full min-h-0">
        <Suspense fallback={<div className="pt-24"><Skeleton rows={4} /></div>}>
          <motion.div key={area} className="h-full min-h-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}>
            <Outlet />
          </motion.div>
        </Suspense>
      </main>
      {!isDesktop && <TabBar path={location.pathname} />}
      <AgentSheet />
      <RestTimerHost />
      <QuickAdd />
    </div>
  );
}

/**
 * Floating glass pill. Inactive tabs are icons only; the active tab grows into a white pill with
 * its icon and label (the pill slides between tabs). Tapping the active tab scrolls to top.
 */
function TabBar({ path }: { path: string }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed z-30 left-1/2 -translate-x-1/2 w-[calc(100%-28px)] max-w-[420px] h-[60px] glass-strong rounded-full flex items-center justify-between px-1.5"
      style={{ bottom: "max(12px, calc(var(--safe-bottom) - 10px))" }}
    >
      {tabs.map((t) => {
        const active = isActive(path, t.to);
        return (
          <NavLink
            key={t.to}
            to={t.to}
            aria-label={t.label}
            onClick={(e) => {
              if (active) {
                e.preventDefault();
                document.querySelector<HTMLElement>("main .scroller")?.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            className={cn("relative h-12 flex items-center justify-center select-none rounded-full transition-[flex-grow] duration-300", active ? "grow-[2.2] text-primary" : "grow text-tertiary active:scale-90")}
            style={{ flexBasis: 0, transitionTimingFunction: "var(--ease-out)" }}
          >
            {active && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-full bg-surface-2 shadow-thumb" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
            <span className="relative flex items-center gap-1.5">
              <Icon name={active ? t.fill : t.icon} size={22} strokeWidth={1.6} />
              {active && (
                <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, delay: 0.05 }} className="text-[14px] font-medium whitespace-nowrap">
                  {t.label}
                </motion.span>
              )}
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="h-full min-h-0">{children}</div>;
}
