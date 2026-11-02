import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router";
import { Skeleton } from "@/ui/Empty";

const HealthHub = lazy(() => import("@/features/health/HealthHub"));
const NutritionScreen = lazy(() => import("@/features/nutrition/NutritionScreen"));
const WeightScreen = lazy(() => import("@/features/health/WeightScreen"));
const BodyScreen = lazy(() => import("@/features/body/BodyScreen"));
const WorkoutsRoutes = lazy(() => import("@/features/workouts/WorkoutsRoutes"));

/** Routes under /health: hub, nutrition diary, weight, body progress and workouts. */
export default function HealthScreen() {
  return (
    <Suspense fallback={<div className="pt-20"><Skeleton rows={4} /></div>}>
      <Routes>
        <Route index element={<HealthHub />} />
        <Route path="nutrition" element={<NutritionScreen />} />
        <Route path="nutrition/day/:date" element={<NutritionScreen />} />
        <Route path="nutrition/*" element={<NutritionScreen />} />
        <Route path="weight" element={<WeightScreen />} />
        <Route path="body/*" element={<BodyScreen />} />
        <Route path="workouts/*" element={<WorkoutsRoutes />} />
        <Route path="*" element={<HealthHub />} />
      </Routes>
    </Suspense>
  );
}
