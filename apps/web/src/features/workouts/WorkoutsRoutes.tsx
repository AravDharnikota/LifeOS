import { lazy, Suspense, useEffect, useRef } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router";
import type { Workout } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { notify } from "@/lib/haptics";
import { useNow } from "@/lib/hooks";
import { Skeleton } from "@/ui/Empty";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { useActiveWorkout } from "./api";
import { fmtSeconds, plural, WORKOUTS } from "./lib";
import { useRestRemaining, useRestTimer } from "./store";
import { beep } from "./sound";
import { RestTimerSheet } from "./RestTimerSheet";
import "./workouts.css";

const HubScreen = lazy(() => import("./HubScreen"));
const WorkoutScreen = lazy(() => import("./WorkoutScreen"));
const HistoryScreen = lazy(() => import("./HistoryScreen"));
const WorkoutDetailScreen = lazy(() => import("./WorkoutDetailScreen"));
const ExercisesScreen = lazy(() => import("./ExercisesScreen"));
const ExerciseDetailScreen = lazy(() => import("./ExerciseDetailScreen"));
const TemplateEditorScreen = lazy(() => import("./TemplateEditorScreen"));


/** Routes relative to /health/workouts. The resume bar and the rest timer live here so they survive navigation inside the feature. */
export default function WorkoutsRoutes() {
  const active = useActiveWorkout();
  const location = useLocation();
  const editing = /\/active$|\/edit$/.test(location.pathname);
  const showResume = Boolean(active.data) && !editing;
  return (
    <div className={cn("h-full min-h-0 relative", showResume && "wk-with-resume")}>
      <Suspense fallback={<div className="pt-20"><Skeleton rows={4} /></div>}>
        <Routes>
          <Route index element={<HubScreen />} />
          <Route path="active" element={<WorkoutScreen mode="live" />} />
          <Route path="history" element={<HistoryScreen />} />
          <Route path="history/:id" element={<WorkoutDetailScreen />} />
          <Route path="history/:id/edit" element={<WorkoutScreen mode="edit" />} />
          <Route path="exercises" element={<ExercisesScreen />} />
          <Route path="exercises/:id" element={<ExerciseDetailScreen />} />
          <Route path="templates/new" element={<TemplateEditorScreen />} />
          <Route path="templates/:id/edit" element={<TemplateEditorScreen />} />
          <Route path="*" element={<HubScreen />} />
        </Routes>
      </Suspense>
      {showResume && active.data && <ResumeBar workout={active.data} />}
    </div>
  );
}

function ResumeBar({ workout }: { workout: Workout }) {
  const navigate = useNavigate();
  const now = useNow(1000);
  const elapsed = Math.max(0, Math.floor((now.getTime() - Date.parse(workout.startedAt)) / 1000));
  const done = (workout.exercises ?? []).reduce((n, e) => n + (e.sets ?? []).filter((s) => s.completed).length, 0);
  return (
    <div className="wk-resume-bar px-[var(--gutter)] pb-2" style={{ bottom: "calc(var(--tabbar-h) + var(--safe-bottom))" }} data-testid="resume-bar">
      <button type="button" onClick={() => navigate(`${WORKOUTS}/active`)} className="pressable w-full h-12 rounded-md bg-primary text-canvas flex items-center justify-between pl-4 pr-2 shadow-popover lg:max-w-[640px] lg:mx-auto">
        <span className="flex items-center gap-2 text-subhead font-medium min-w-0">
          <Icon name="dumbbell" size={18} />
          <span className="truncate">{workout.name}</span>
        </span>
        <span className="flex items-center gap-3 text-subhead tabular shrink-0">
          <span className="num">{fmtSeconds(elapsed)}</span>
          <span className="opacity-70">{plural(done, "set")}</span>
          <span className="h-8 px-3 inline-flex items-center rounded-sm bg-canvas text-primary text-footnote font-semibold">Resume</span>
        </span>
      </button>
    </div>
  );
}

/** Fires the end-of-rest effects exactly once per countdown and renders the timer sheet. Mounted once in the app shell. */
export function RestTimerHost() {
  const endsAt = useRestTimer((s) => s.endsAt);
  const muted = useRestTimer((s) => s.muted);
  const remaining = useRestRemaining();
  const fired = useRef<number | null>(null);
  useEffect(() => {
    // A countdown that ended while the app was closed is cleared silently.
    const { endsAt: e } = useRestTimer.getState();
    if (e && e < Date.now() - 5000) useRestTimer.setState({ endsAt: null, total: 0, hint: null, sheetOpen: false });
  }, []);
  useEffect(() => {
    if (!endsAt || remaining > 0 || fired.current === endsAt) return;
    fired.current = endsAt;
    void notify("success");
    if (!muted) beep();
    toast("Rest over");
    useRestTimer.setState({ endsAt: null, total: 0, hint: null, sheetOpen: false });
  }, [endsAt, remaining, muted]);
  return <RestTimerSheet />;
}
