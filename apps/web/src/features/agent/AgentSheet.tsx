import { Sheet } from "@/ui/Sheet";
import { useUi } from "@/state/ui";

/** Placeholder; replaced by the agent UI step. */
export function AgentSheet() {
  const open = useUi((s) => s.agentOpen);
  const close = useUi((s) => s.closeAgent);
  return (
    <Sheet open={open} onClose={close} title="Assistant" detent="large" desktop="panel">
      <p className="text-callout text-secondary pt-4">Assistant coming soon.</p>
    </Sheet>
  );
}
