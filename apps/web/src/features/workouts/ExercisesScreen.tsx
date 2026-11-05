import { useState } from "react";
import { useNavigate } from "react-router";
import { Screen } from "@/ui/Screen";
import { IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group, Row } from "@/ui/List";
import { Chip } from "@/ui/Field";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { fmtRelativeDate } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { useAppSettings } from "@/data/queries";
import { useExercises } from "./api";
import { BODY_PARTS, CATEGORIES, bodyPartLabel, categoryLabel, NewExerciseSheet } from "./ExercisePicker";
import { fmtPrValue, WORKOUTS } from "./lib";
import { ExerciseIcon, NumUnit, SearchField } from "./common";

export default function ExercisesScreen() {
  const navigate = useNavigate();
  const units = useAppSettings().units;
  const [q, setQ] = useState("");
  const [bodyPart, setBodyPart] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q, 200);
  const list = useExercises({ q: dq || undefined, bodyPart, category });
  return (
    <Screen
      title="Exercises"
      back={WORKOUTS}
      actions={
        <IconButton label="New exercise" className="glass !min-w-0 !min-h-0 w-10 h-10" onClick={() => setCreating(true)}>
          <Icon name="plus" size={20} strokeWidth={1.8} />
        </IconButton>
      }
      header={
        <div className="lg:max-w-[640px]">
          <SearchField placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar mt-2.5 -mx-[var(--gutter)] px-[var(--gutter)]">
            <Chip selected={!bodyPart} onClick={() => setBodyPart(undefined)}>Any body part</Chip>
            {BODY_PARTS.map((b) => (
              <Chip key={b.value} selected={bodyPart === b.value} onClick={() => setBodyPart(bodyPart === b.value ? undefined : b.value)}>{b.label}</Chip>
            ))}
          </div>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar mt-2.5 -mx-[var(--gutter)] px-[var(--gutter)]">
            <Chip selected={!category} onClick={() => setCategory(undefined)}>Any category</Chip>
            {CATEGORIES.map((c) => (
              <Chip key={c.value} selected={category === c.value} onClick={() => setCategory(category === c.value ? undefined : c.value)}>{c.label}</Chip>
            ))}
          </div>
        </div>
      }
    >
      <div className="lg:max-w-[640px]">
        {list.isPending ? (
          <Skeleton rows={8} />
        ) : list.isError ? (
          <InlineError onRetry={() => void list.refetch()}>Unable to load exercises.</InlineError>
        ) : list.data.length === 0 ? (
          <Empty>No exercises match.</Empty>
        ) : (
          <Group data-testid="exercises-list" className="[&_.row-sep::before]:!left-[64px]">
            {list.data.map((e) => (
              <Row
                key={e.id}
                leading={<ExerciseIcon category={e.category} />}
                title={e.name}
                subtitle={`${bodyPartLabel(e.bodyPart)} · ${categoryLabel(e.category)}${e.isCustom ? " · Custom" : ""}`}
                trailing={
                  e.recordOneRm ? (
                    <span className="flex flex-col items-end leading-tight">
                      <NumUnit text={fmtPrValue("one_rm", e.recordOneRm, units)} size={16} />
                      <span className="text-[11px] text-tertiary">1RM</span>
                    </span>
                  ) : e.lastPerformedAt ? (
                    <span className="text-[12px] text-tertiary">{fmtRelativeDate(e.lastPerformedAt)}</span>
                  ) : undefined
                }
                chevron
                onPress={() => navigate(`${WORKOUTS}/exercises/${e.id}`)}
              />
            ))}
          </Group>
        )}
      </div>
      <NewExerciseSheet open={creating} onClose={() => setCreating(false)} onCreated={(e) => { setCreating(false); navigate(`${WORKOUTS}/exercises/${e.id}`); }} />
    </Screen>
  );
}
