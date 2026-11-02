/** Human labels for tool activity lines. One short sentence, verb first, no jargon. */
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const pick = (input: unknown, ...keys: string[]): string | null => {
  if (!input || typeof input !== "object") return null;
  for (const k of keys) {
    const v = str((input as Record<string, unknown>)[k]);
    if (v) return v;
  }
  return null;
};

export function toolLabel(name: string, input: unknown, pending: boolean): string {
  const n = name.toLowerCase();
  const title = pick(input, "title", "name", "text", "description");
  const quoted = title ? ` ${title.length > 40 ? title.slice(0, 39) + "…" : title}` : "";
  const v = (doing: string, done: string) => (pending ? doing : done);
  if (/^(add|create)_tracker_widget/.test(n)) return v("Adding a counter", `Added a counter${quoted}`);
  if (/^(add|create)_goal_widget/.test(n)) return v("Adding a goal widget", "Added a goal widget");
  if (/revert_layout/.test(n)) return v("Reverting the dashboard", "Reverted the dashboard");
  if (/layout_history|get_layout|list_widget_types/.test(n)) return v("Reading the dashboard", "Read the dashboard");
  if (/widget|section|layout/.test(n)) return v("Changing the dashboard", "Changed the dashboard");
  if (/plan_schedule|schedule/.test(n)) return v("Planning the day", "Planned the day");
  if (/log_water/.test(n)) {
    const ml = input && typeof input === "object" ? (input as { ml?: number }).ml : undefined;
    return v("Logging water", ml ? `Logged ${ml} ml water` : "Logged water");
  }
  if (/log_weight/.test(n)) return v("Logging weight", "Logged weight");
  if (/log_meal|meal/.test(n)) return v("Logging a meal", "Logged a meal");
  if (/complete_task/.test(n)) return v("Completing a task", `Completed task${quoted}`);
  if (/delete_task/.test(n)) return v("Deleting a task", "Deleted a task");
  if (/update_task/.test(n)) return v("Updating a task", `Updated task${quoted}`);
  if (/(create|add)_task/.test(n)) return v("Adding a task", `Added task${quoted}`);
  if (/delete_event/.test(n)) return v("Deleting an event", "Deleted an event");
  if (/update_event|move_event/.test(n)) return v("Updating an event", `Updated event${quoted}`);
  if (/(create|add)_event/.test(n)) return v("Adding an event", `Added event${quoted}`);
  if (/(create|add)_goal/.test(n)) return v("Adding a goal", `Added goal${quoted}`);
  if (/log_goal|goal_entry|check_in/.test(n)) return v("Logging progress", "Logged progress");
  if (/(create|add)_tracker/.test(n)) return v("Adding a tracker", `Added tracker${quoted}`);
  if (/log_tracker/.test(n)) return v("Logging a count", "Logged a count");
  if (/remember/.test(n)) return v("Saving a note to memory", "Saved to memory");
  if (/forget/.test(n)) return v("Forgetting a memory", "Forgot a memory");
  if (/start_workout/.test(n)) return v("Starting a workout", "Started a workout");
  if (/^(get|list|search|find|recall|summar)/.test(n)) {
    const noun = n.replace(/^(get|list|search|find|recall|summarize|summary)_?/, "").replace(/_/g, " ") || "data";
    return v(`Checking ${noun}`, `Checked ${noun}`);
  }
  const plain = n.replace(/_/g, " ");
  return v(`${plain.charAt(0).toUpperCase()}${plain.slice(1)}`, `${plain.charAt(0).toUpperCase()}${plain.slice(1)}`);
}
