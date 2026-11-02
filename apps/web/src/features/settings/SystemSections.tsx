import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { SettingsResponse } from "@/data/queries";
import { Section, Group, Row, ValueRow } from "@/ui/List";
import { Spinner } from "@/ui/Spinner";
import { ActionSheet } from "@/ui/Sheet";
import { toast } from "@/ui/Toast";
import { getConfig } from "@/lib/api";
import { isNative } from "@/lib/platform";
import { useAuth } from "@/state/auth";
import { fmtInt } from "@/lib/format";
import { exportData } from "./export";

export function DeviceSection() {
  const health = useAuth((s) => s.health);
  const disconnect = useAuth((s) => s.disconnect);
  const [server, setServer] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    void getConfig().then((c) => setServer(c.serverUrl || window.location.origin));
  }, []);
  return (
    <Section title="Device" footer={isNative ? "The app talks to this server." : "This browser talks to the server it was loaded from."}>
      <Group>
        <ValueRow title="Server" value={<span className="font-mono text-footnote break-all text-right">{server}</span>} />
        {health?.authRequired && <Row title={<span className="text-danger-text">Sign Out</span>} onPress={() => setConfirm(true)} data-testid="sign-out" />}
      </Group>
      <ActionSheet open={confirm} onClose={() => setConfirm(false)} title="Sign out of this server?" message="The token is forgotten on this device." actions={[{ label: "Sign Out", destructive: true, onPress: () => void disconnect() }]} />
    </Section>
  );
}

export function DataSection() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await exportData();
      if (!r.ok) toast(r.reason);
      else toast(r.failed.length ? `Exported. ${fmtInt(r.failed.length)} of 8 sources skipped.` : "Exported.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Data" footer="Export is a JSON file with settings, goals, trackers, tasks, events, workouts and recent activity.">
      <Group>
        <Row title={<span className="text-accent-text">Export Data</span>} onPress={() => void run()} disabled={busy} trailing={busy ? <Spinner size={16} className="text-secondary" /> : undefined} data-testid="export-data" />
        <Row title="Activity" chevron onPress={() => navigate("/settings/activity")} data-testid="activity-link" />
      </Group>
    </Section>
  );
}

export function AboutSection({ server }: { server: SettingsResponse["server"] }) {
  return (
    <Section title="About">
      <Group>
        <ValueRow title="Version" value={server.version} />
        <ValueRow title="Server URL" value={<span className="font-mono text-footnote break-all text-right">{server.publicUrl}</span>} />
        <ValueRow title="Timezone" value={server.timezone} />
      </Group>
    </Section>
  );
}
