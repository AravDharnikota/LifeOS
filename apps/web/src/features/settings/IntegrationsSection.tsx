import { useState } from "react";
import { useNavigate } from "react-router";
import type { AppSettings } from "@aravos/shared";
import type { SettingsResponse } from "@/data/queries";
import { Section, Row, ValueRow, Footnote } from "@/ui/List";
import { StatusPill } from "@/ui/viz";
import { IconGroup, IconLabel, RowIcon } from "./parts";
import { FieldRow, Switch } from "@/ui/Field";
import { IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Spinner } from "@/ui/Spinner";
import { ActionSheet } from "@/ui/Sheet";
import { toast } from "@/ui/Toast";
import { notify } from "@/lib/haptics";
import { fmtInt, fmtRelativeDate, fmtTime } from "@/lib/format";
import { copyText, fetchGoogleAuthUrl, useGoogleDisconnect, useGoogleStatus, useGoogleSync, useUpdateApp } from "./api";

/** "Live" with a green dot when the integration works, a quiet "Off" when it does not. */
export function LivePill({ live }: { live: boolean }) {
  return live ? <StatusPill tone="success" dot>Live</StatusPill> : <StatusPill>Off</StatusPill>;
}

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
        <IconGroup>
          <Row leading={<RowIcon name="sparkle" />} trailing={<LivePill live={anthropic.configured} />} title="Assistant" subtitle={anthropic.configured ? `Configured, model ${anthropic.model}` : "Not configured. Add ANTHROPIC_API_KEY on the server."} data-testid="anthropic-status" />
        </IconGroup>
      </Section>

      <Section title="Google" footer={google.connected ? "Calendars and tasks sync both ways. Timeboxes can be mirrored to the primary calendar." : undefined}>
        <IconGroup>
          {!google.configured ? (
            <Row leading={<RowIcon name="google" />} title="Google" subtitle="Not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server." data-testid="google-status" />
          ) : !google.connected ? (
            <>
              <Row leading={<RowIcon name="google" />} trailing={<LivePill live={false} />} title="Google" subtitle="Not connected" data-testid="google-status" />
              <Row leading={<RowIcon name="link" tone="accent" />} title={<span className="text-accent-text">Connect Google</span>} onPress={() => void connect()} trailing={connecting ? <Spinner size={16} className="text-secondary" /> : undefined} disabled={connecting} data-testid="google-connect" />
            </>
          ) : (
            <>
              <Row leading={<RowIcon name="google" />} trailing={<LivePill live />} title="Account" subtitle={google.email ?? undefined} data-testid="google-status" />
              <ValueRow leading={<RowIcon name="clock" />} title="Last sync" value={status.isLoading ? "" : lastSync ? `${fmtRelativeDate(lastSync)} ${fmtTime(lastSync, app.hour12)}` : "Never"} />
              <FieldRow label={<IconLabel icon="calendar">Mirror timeboxes</IconLabel>}>
                <Switch checked={app.mirrorTimeboxes} onChange={(v) => updateApp.mutate({ mirrorTimeboxes: v })} label="Mirror timeboxes" />
              </FieldRow>
              <Row leading={<RowIcon name="refresh" tone="accent" />} title={<span className="text-accent-text">Sync Now</span>} onPress={() => void runSync()} trailing={sync.isPending ? <Spinner size={16} className="text-secondary" /> : undefined} disabled={sync.isPending} data-testid="google-sync" />
              <Row leading={<RowIcon name="x" tone="danger" />} title={<span className="text-danger-text">Disconnect</span>} onPress={() => setConfirm(true)} />
            </>
          )}
        </IconGroup>
        {googleInline && <Footnote className="text-danger-text">{googleInline}</Footnote>}
      </Section>

      <Section title="MCP" footer={mcp.authRequired ? "Clients send the bearer token set as ARAVOS_TOKEN on the server." : "No token is set on this server, so clients connect without a header."}>
        <IconGroup>
          <Row
            leading={<RowIcon name="link" />}
            title="Server URL"
            subtitle={<span className="font-mono text-[12px] break-all">{mcp.url}</span>}
            trailing={
              <IconButton label="Copy URL" onClick={() => void copyUrl()} className="-mr-2 !text-secondary" data-testid="mcp-copy">
                <Icon name="copy" size={18} />
              </IconButton>
            }
            data-testid="mcp-url"
          />
          <Row leading={<RowIcon name="book" />} title="Connection Guide" chevron onPress={() => navigate("/settings/mcp")} data-testid="mcp-guide" />
        </IconGroup>
      </Section>

      <ActionSheet open={confirm} onClose={() => setConfirm(false)} title="Disconnect Google?" message="Synced events and tasks stay on this device." actions={[{ label: "Disconnect", destructive: true, onPress: () => disconnect.mutate() }]} />
    </>
  );
}
