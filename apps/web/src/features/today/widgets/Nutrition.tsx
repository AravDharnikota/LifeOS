import { useNavigate } from "react-router";
import { useIsDesktop } from "@/lib/hooks";
import { useDaySummary } from "@/data/queries";
import { fmtInt } from "@/lib/format";
import { Bar, Ring } from "@/ui/Ring";
import type { WidgetOf, WidgetProps } from "../types";
import { Pressable, WidgetEmpty, WidgetError, WidgetLabel, WidgetSkeleton } from "./shared";

const MACROS = [
  { key: "proteinG", label: "Protein", color: "var(--protein)" },
  { key: "carbsG", label: "Carbs", color: "var(--carbs)" },
  { key: "fatG", label: "Fat", color: "var(--fat)" },
] as const;

/** One hero ring for calories left, three bars for the macros. */
export function NutritionWidget({ widget }: WidgetProps<WidgetOf<"nutrition_rings">>) {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const summary = useDaySummary();
  const n = summary.data?.nutrition;
  const eaten = n?.totals.calories ?? 0;
  const target = n?.targets.calories ?? 0;
  const left = target - eaten;
  const over = left < 0;

  return (
    <Pressable label="Open nutrition" onPress={() => navigate("/health")}>
      <WidgetLabel trailing={isDesktop && n && target > 0 ? `${fmtInt(eaten)} of ${fmtInt(target)} kcal` : undefined}>{widget.title ?? "Calories"}</WidgetLabel>
      {summary.isPending ? (
        <WidgetSkeleton hero lines={3} />
      ) : summary.isError || !n ? (
        <WidgetError onRetry={() => void summary.refetch()} />
      ) : target === 0 ? (
        <WidgetEmpty action="Set Targets" onAction={() => navigate("/health")}>No calorie target yet.</WidgetEmpty>
      ) : (
        <div className="flex-1 flex flex-col justify-center lg:flex-row lg:items-center gap-5 lg:gap-6">
          <div className="flex items-center justify-center py-1">
            <Ring progress={target > 0 ? eaten / target : 0} size={108} stroke={10} color="var(--energy)" label={`Calories, ${fmtInt(eaten)} of ${fmtInt(target)}`}>
              <span className="num text-title-1 text-primary">{fmtInt(Math.abs(left))}</span>
              <span className="text-caption-1 text-secondary mt-0.5">{over ? "over" : "left"}</span>
              {!isDesktop && <span className="sr-only">{`${fmtInt(eaten)} of ${fmtInt(target)} kcal`}</span>}
            </Ring>
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-2.5">
            {MACROS.map((m) => {
              const v = n.totals[m.key];
              const t = n.targets[m.key];
              return (
                <div key={m.key} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-caption-1 text-secondary">{m.label}</span>
                    <span className="text-caption-1 tabular text-primary">
                      {fmtInt(v)}
                      <span className="text-tertiary"> / {fmtInt(t)} g</span>
                    </span>
                  </div>
                  <Bar progress={t > 0 ? v / t : 0} color={m.color} height={4} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Pressable>
  );
}
