import { useState } from "react";
import { useNavigate } from "react-router";
import type { AppSettings } from "@aravos/shared";
import type { SettingsResponse } from "@/data/queries";
import { Section, Group, Row, ValueRow, Footnote } from "@/ui/List";
import { FieldRow, Switch } from "@/ui/Field";
import { IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Spinner } from "@/ui/Spinner";
import { ActionSheet } from "@/ui/Sheet";
import { toast } from "@/ui/Toast";
import { notify } from "@/lib/haptics";
import { fmtInt, fmtRelativeDate, fmtTime } from "@/lib/format";
import { copyText, fetchGoogleAuthUrl, useGoogleDisconnect, useGoogleStatus, useGoogleSync, useUpdateApp } from "./api";

export function IntegrationsSection({ integrations, app, googleError }: { integrations: SettingsResponse["integrations"]; app: AppSettings; googleError: string | null }) {
  const navigate = useNavigate();
  const { anthropic, google, mcp } = integrations;
  const status = useGoogleStatus(google.configured && google.connected);
  const sync = useGoogleSync();
  const disconnect = useGoogleDisconnect();
  const updateApp = useUpdateApp();
  const [connecting, setConnecting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const connect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const { url } = await fetchGoogleAuthUrl();
      window.location.href = url;
    } catch (e) {
      setConnecting(false);
      setConnectError(e instanceof Error ? e.message : "Unable to start Google sign-in");
    }
  };
  const runSync = async () => {
    try {
      const s = await sync.mutateAsync();
      toast(`${fmtInt(s.eventsPulled + s.eventsPushed)} events and ${fmtInt(s.tasksPulled + s.tasksPushed)} tasks synced.${s.errors.length ? ` ${fmtInt(s.errors.length)} errors.` : ""}`);
    } catch (e) {
      void notify("error");
      toast(e instanceof Error ? e.message : "Sync failed.");
    }
  };
  const copyUrl = async () => {
    toast((await copyText(mcp.url)) ? "Copied" : "Unable to copy");
  };
  const lastSync = status.data?.lastSyncedAt;
  const googleInline = googleError ?? connectError ?? status.data?.lastError ?? null;

  return (
    <>
      <Section title="Anthropic" footer="Keys live in the .env file beside the server.">
        <Group>
          <Row title="Assistant" subtitle={anthropic.configured ? `Configured, model ${anthropic.model}` : "Not configured. Add ANTHROPIC_API_KEY on the server."} data-testid="anthropic-status" />
        </Group>
      </Section>

      <Section title="Google" footer={google.connected ? "Calendars and tasks sync both ways. Timeboxes can be mirrored to the primary calendar." : undefined}>
        <Group>
          {!google.configured ? (
            <Row title="Google" subtitle="Not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server." data-testid="google-status" />
          ) : !google.connected ? (
            <>
              <Row title="Google" subtitle="Not connected" data-testid="google-status" />
              <Row title={<span className="text-accent-text">Connect Google</span>} onPress={() => void connect()} trailing={connecting ? <Spinner size={16} className="text-secondary" /> : undefined} disabled={connecting} data-testid="google-connect" />
            </>
          ) : (
            <>
              <Row title="Account" subtitle={google.email ?? undefined} data-testid="google-status" />
              <ValueRow title="Last sync" value={status.isLoading ? "" : lastSync ? `${fmtRelativeDate(lastSync)} ${fmtTime(lastSync, app.hour12)}` : "Never"} />
              <FieldRow label="Mirror timeboxes">
                <Switch checked={app.mirrorTimeboxes} onChange={(v) => updateApp.mutate({ mirrorTimeboxes: v })} label="Mirror timeboxes" />
              </FieldRow>
              <Row title={<span className="text-accent-text">Sync Now</span>} onPress={() => void runSync()} trailing={sync.isPending ? <Spinner size={16} className="text-secondary" /> : undefined} disabled={sync.isPending} data-testid="google-sync" />
              <Row title={<span className="text-danger-text">Disconnect</span>} onPress={() => setConfirm(true)} />
            </>
          )}
        </Group>
        {googleInline && <Footnote className="text-danger-text">{googleInline}</Footnote>}
      </Section>

      <Section title="MCP" footer={mcp.authRequired ? "Clients send the bearer token set as ARAVOS_TOKEN on the server." : "No token is set on this server, so clients connect without a header."}>
        <Group>
          <Row
            title="Server URL"
            subtitle={<span className="font-mono text-footnote break-all">{mcp.url}</span>}
            trailing={
              <IconButton label="Copy URL" onClick={() => void copyUrl()} className="-mr-2" data-testid="mcp-copy">
                <Icon name="copy" size={20} />
              </IconButton>
            }
            data-testid="mcp-url"
          />
          <Row title="Connection Guide" chevron onPress={() => navigate("/settings/mcp")} data-testid="mcp-guide" />
        </Group>
      </Section>

      <ActionSheet open={confirm} onClose={() => setConfirm(false)} title="Disconnect Google?" message="Synced events and tasks stay on this device." actions={[{ label: "Disconnect", destructive: true, onPress: () => disconnect.mutate() }]} />
    </>
  );
}
