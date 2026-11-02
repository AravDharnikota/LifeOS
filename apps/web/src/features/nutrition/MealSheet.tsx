import { Fragment, useEffect, useState } from "react";
import type { MealItem, MealType } from "@aravos/shared";
import { Sheet, ActionSheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";
import { Group, Row, SectionHeader, Footnote } from "@/ui/List";
import { Chip } from "@/ui/Field";
import { Stepper } from "@/ui/Stepper";
import { Spinner } from "@/ui/Spinner";
import { Skeleton, InlineError } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { imageUrl } from "@/lib/api";
import { fmtInt, fmtTime, plural } from "@/lib/format";
import { selection, notify } from "@/lib/haptics";
import { useDebounced } from "@/lib/hooks";
import { useAppSettings } from "@/data/queries";
import { useDeleteMeal, useDeleteMealItem, useMeal, useUpdateMeal, useUpdateMealItem } from "./api";
import { MEAL_TYPES, fmtKcal, fmtMacros, mealTypeLabel, scaleMealItem, scoreLine } from "./model";

/** Meal detail: photo, editable items, score with its reason, notes, meal slot, delete. */
export function MealSheet({ mealId, open, onClose }: { mealId: string | null; open: boolean; onClose: () => void }) {
  const meal = useMeal(open ? mealId : null);
  const updateMeal = useUpdateMeal();
  const deleteMeal = useDeleteMeal();
  const [confirm, setConfirm] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const hour12 = useAppSettings().hour12;
  const m = meal.data;
  const totals = m?.totals;
  const score = totals ? scoreLine(totals, m?.healthScore ?? null) : null;

  const setType = (t: MealType) => {
    if (!m || m.mealType === t) return;
    void selection();
    updateMeal.mutate({ id: m.id, mealType: t });
  };
  const remove = async () => {
    if (!m) return;
    try {
      await deleteMeal.mutateAsync(m.id);
      toast("Meal deleted");
      onClose();
    } catch {
      void notify("error");
      toast("Unable to delete the meal");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={m ? (m.name ?? mealTypeLabel(m.mealType)) : "Meal"} detent="large" leading={null} trailing={<button type="button" className="text-headline text-accent-text px-2 h-11" onClick={onClose}>Done</button>}>
      {meal.isPending ? (
        <div className="pt-4"><Skeleton rows={4} className="mx-0" /></div>
      ) : meal.isError || !m ? (
        <InlineError onRetry={() => void meal.refetch()}>Unable to load the meal.</InlineError>
      ) : (
        <div className="flex flex-col gap-6 pt-2 pb-2 -mx-[var(--gutter)]">
          {m.photoPath && <img src={imageUrl(m.photoPath)} alt="" className="mx-[var(--gutter)] rounded-md max-h-[260px] object-cover bg-surface-2" />}
          <div className="px-[var(--gutter)]">
            <div className="flex items-baseline gap-1.5">
              <span className="num text-display-44 text-primary">{fmtInt(totals?.calories ?? 0)}</span>
              <span className="text-subhead text-secondary">kcal</span>
            </div>
            <p className="text-footnote text-secondary tabular mt-1">
              {fmtMacros(totals ?? {})} · {plural(m.items?.length ?? 0, "item")} · {fmtTime(m.loggedAt, hour12)}
            </p>
          </div>
          <div className="px-[var(--gutter)] flex gap-2">
            {MEAL_TYPES.map((t) => (
              <Chip key={t.value} selected={m.mealType === t.value} onClick={() => setType(t.value)}>
                {t.label}
              </Chip>
            ))}
          </div>
          <div>
            <SectionHeader title="Items" />
            <Group>
              {(m.items ?? []).map((it) => (
                <ItemRow key={it.id} item={it} expanded={openItem === it.id} onToggle={() => setOpenItem((k) => (k === it.id ? null : it.id))} />
              ))}
              {(m.items?.length ?? 0) === 0 && <Row title={<span className="text-secondary">No items</span>} />}
            </Group>
          </div>
          {score && (
            <div>
              <Group>
                <Row title="Health score" subtitle={score.reason} trailing={score.score != null ? <span className="num text-title-3 text-primary">{score.score}</span> : undefined} />
              </Group>
              {m.aiNotes && <Footnote>{m.aiNotes}</Footnote>}
            </div>
          )}
          <div className="px-[var(--gutter)] pt-2">
            <Button variant="destructive" full onClick={() => setConfirm(true)}>
              Delete Meal
            </Button>
          </div>
        </div>
      )}
      <ActionSheet open={confirm} onClose={() => setConfirm(false)} title="Delete this meal?" message="Its items are removed from the day." actions={[{ label: "Delete Meal", destructive: true, onPress: () => void remove() }]} />
    </Sheet>
  );
}

function ItemRow({ item, expanded, onToggle }: { item: MealItem; expanded: boolean; onToggle: () => void }) {
  const update = useUpdateMealItem();
  const del = useDeleteMealItem();
  const [grams, setGrams] = useState(item.grams ?? 0);
  const debounced = useDebounced(grams, 450);
  useEffect(() => setGrams(item.grams ?? 0), [item.grams]);
  useEffect(() => {
    if (!expanded || debounced === (item.grams ?? 0) || debounced <= 0) return;
    const patch = item.foodId ? { grams: debounced } : scaleMealItem(item, debounced);
    update.mutate({ id: item.id, ...patch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const pending = update.isPending || del.isPending;
  const previewKcal = grams !== (item.grams ?? 0) && item.grams ? Math.round((item.calories * grams) / item.grams) : item.calories;
  return (
    <Fragment>
      <Row
        title={item.name}
        subtitle={`${item.grams != null ? `${fmtInt(item.grams)} g` : `${item.quantity} ${item.unit}`} · ${fmtMacros(item)}`}
        trailing={pending ? <Spinner size={14} className="text-tertiary" /> : <span>{fmtKcal(previewKcal)}</span>}
        onPress={onToggle}
        aria-expanded={expanded}
        className={cn(expanded && "bg-selected")}
      />
      {expanded && (
        <div className="px-[var(--gutter)] py-3 bg-surface flex flex-col gap-3">
          {item.grams != null && item.grams > 0 ? (
            <Stepper value={grams} onChange={setGrams} step={5} min={5} max={5000} unit="g" label={`${item.name} grams`} />
          ) : (
            <p className="text-footnote text-secondary">No weight recorded for this item.</p>
          )}
          <Button variant="destructive" size="sm" className="self-start -ml-2" loading={del.isPending} onClick={() => del.mutate(item.id)}>
            Remove
          </Button>
        </div>
      )}
    </Fragment>
  );
}

