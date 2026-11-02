import { useState } from "react";
import { useNavigate } from "react-router";
import type { Goal } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Section, Group } from "@/ui/List";
import { IconButton, Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Menu, type MenuItem } from "@/ui/Menu";
import { ActionSheet } from "@/ui/Sheet";
import { Empty, Skeleton, InlineError } from "@/ui/Empty";
import { useGoals } from "@/data/queries";
import { useIsDesktop } from "@/lib/hooks";
import { fmtInt } from "@/lib/format";
import { GoalRow } from "./GoalRow";
import { GoalSheet } from "./GoalSheet";
import { TrackersSection } from "./Trackers";
import { useAddMilestone, useCreateGoal, useDeleteGoal, useLogGoal, useUpdateGoal } from "./api";
import { areaLabel, groupByArea } from "./model";

type Filter = "active" | "done" | "all";

/** Shared by the list and the detail: Pause, Mark Done, Delete. */
export function goalMenuItems(goal: Goal, act: { update: (patch: { status: Goal["status"] }) => void; del: () => void }): MenuItem[] {
  const items: MenuItem[] = [];
  if (goal.status !== "done") items.push(goal.status === "paused" ? { label: "Resume", icon: "flag", onPress: () => act.update({ status: "active" }) } : { label: "Pause", icon: "clock", onPress: () => act.update({ status: "paused" }) });
  items.push(goal.status === "done" ? { label: "Reopen", icon: "undo", onPress: () => act.update({ status: "active" }) } : { label: "Mark Done", icon: "check", onPress: () => act.update({ status: "done" }) });
  items.push({ label: "Delete", icon: "trash", destructive: true, onPress: act.del });
  return items;
}

export function GoalsList({ createOpen = false }: { createOpen?: boolean }) {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [filter, setFilter] = useState<Filter>("active");
  const active = useGoals("active");
  const list = useGoals(filter);
  const log = useLogGoal();
  const update = useUpdateGoal();
  const del = useDeleteGoal();
  const create = useCreateGoal();
  const addMilestone = useAddMilestone();
  const [menu, setMenu] = useState<{ goal: Goal; anchor: { x: number; y: number } } | null>(null);
  const [confirm, setConfirm] = useState<Goal | null>(null);

  const goals = list.data ?? [];
  const groups = groupByArea(goals);
  const activeCount = active.data?.length ?? 0;
  const closeCreate = () => navigate("/goals", { replace: true });

  const onCreate = async (input: Parameters<typeof create.mutateAsync>[0], milestones: string[]) => {
    const goal = await create.mutateAsync(input);
    for (const title of milestones) await addMilestone.mutateAsync({ goalId: goal.id, title });
    navigate(`/goals/${goal.id}`, { replace: true });
  };

  const emptyText = filter === "done" ? "No goals done yet." : filter === "all" ? "No goals yet." : "No goals yet.";

  return (
    <Screen
      title="Goals"
      subtitle={active.isLoading ? " " : `${fmtInt(activeCount)} active`}
      actions={
        <IconButton label="Add Goal" tinted onClick={() => navigate("/goals/new")} data-testid="add-goal">
          <Icon name="plus" size={24} />
        </IconButton>
      }
      header={<Segmented options={[{ value: "active", label: "Active" }, { value: "done", label: "Done" }, { value: "all", label: "All" }]} value={filter} onChange={setFilter} className="lg:max-w-[360px]" />}
    >
      <div className="lg:max-w-[960px]">
        {list.isLoading ? (
          <Skeleton rows={4} />
        ) : list.error ? (
          <InlineError onRetry={() => void list.refetch()}>Unable to load goals</InlineError>
        ) : goals.length === 0 ? (
          <Empty
            action={
              filter === "done" ? undefined : (
                <Button variant="plain" onClick={() => navigate("/goals/new")}>
                  Add Goal
                </Button>
              )
            }
          >
            {emptyText}
          </Empty>
        ) : (
          groups.map((g) => (
            <Section key={g.area} title={areaLabel(g.area)}>
              {isDesktop ? (
                <div className="px-[var(--gutter)] grid grid-cols-2 gap-3">
                  {g.items.map((goal) => (
                    <GoalRow key={goal.id} goal={goal} card onOpen={() => navigate(`/goals/${goal.id}`)} onToggle={() => log.mutate({ id: goal.id })} onMenu={(anchor) => setMenu({ goal, anchor })} />
                  ))}
                </div>
              ) : (
                <Group>
                  {g.items.map((goal) => (
                    <GoalRow key={goal.id} goal={goal} onOpen={() => navigate(`/goals/${goal.id}`)} onToggle={() => log.mutate({ id: goal.id })} onMenu={(anchor) => setMenu({ goal, anchor })} />
                  ))}
                </Group>
              )}
            </Section>
          ))
        )}
        <TrackersSection />
      </div>

      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu?.anchor ?? null} items={menu ? goalMenuItems(menu.goal, { update: (patch) => update.mutate({ id: menu.goal.id, ...patch }), del: () => setConfirm(menu.goal) }) : []} />
      <ActionSheet open={Boolean(confirm)} onClose={() => setConfirm(null)} title="Delete this goal?" message={confirm?.title} actions={[{ label: "Delete Goal", destructive: true, onPress: () => confirm && del.mutate(confirm.id) }]} />
      <GoalSheet open={createOpen} onClose={closeCreate} onSubmit={onCreate} pending={create.isPending || addMilestone.isPending} />
    </Screen>
  );
}
