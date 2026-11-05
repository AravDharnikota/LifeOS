import { Screen } from "@/ui/Screen";
import { Section, Row, Footnote } from "@/ui/List";
import { IconGroup, RowIcon } from "./parts";
import { Button, IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Skeleton, InlineError } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { useSettings } from "@/data/queries";
import { copyText } from "./api";

function CodeBlock({ code, label }: { code: string; label: string }) {
  const copy = async () => toast((await copyText(code)) ? "Copied" : "Unable to copy");
  return (
    <div className="mx-[var(--gutter)] glass rounded-lg p-1.5">
      <pre className="well rounded-md font-mono text-[12.5px] text-primary px-3.5 py-3 m-0 whitespace-pre-wrap [overflow-wrap:anywhere] leading-[19px]">
        <span className="text-quaternary select-none" aria-hidden="true">$ </span>
        {code}
      </pre>
      <div className="flex items-center justify-between gap-3 pl-2.5 pr-0.5 pt-1.5">
        <span className="text-[12px] text-tertiary">{label}</span>
        <Button variant="secondary" size="sm" className="!h-8 !px-3.5 !text-[13px]" leading={<Icon name="copy" size={14} />} onClick={() => void copy()}>
          Copy
        </Button>
      </div>
    </div>
  );
}

/** /settings/mcp: how to point an MCP client at this server. */
export function McpGuide() {
  const { data, isLoading, error, refetch } = useSettings();
  const url = data?.integrations.mcp.url ?? "";
  const auth = data?.integrations.mcp.authRequired ?? true;
  const header = auth ? ` --header "Authorization: Bearer <token>"` : "";
  const claude = `claude mcp add --transport http aravos ${url}${header}`;
  const remote = `npx mcp-remote ${url}${auth ? ` --header "Authorization:Bearer <token>"` : ""}`;
  const copyUrl = async () => toast((await copyText(url)) ? "Copied" : "Unable to copy");

  return (
    <Screen title="MCP" back="/settings" subtitle="Connection guide">
      <div className="lg:max-w-[640px]">
        {isLoading ? (
          <Skeleton rows={2} />
        ) : error || !data ? (
          <InlineError onRetry={() => void refetch()}>Unable to load the server address</InlineError>
        ) : (
          <>
            <Section title="Server">
              <IconGroup>
                <Row
                  leading={<RowIcon name="link" />}
                  title="URL"
                  subtitle={<span className="font-mono text-[12px] break-all">{url}</span>}
                  trailing={
                    <IconButton label="Copy URL" onClick={() => void copyUrl()} className="-mr-2 !text-secondary">
                      <Icon name="copy" size={18} />
                    </IconButton>
                  }
                />
              </IconGroup>
              <Footnote>{auth ? "Requests carry the bearer token set as ARAVOS_TOKEN in the .env file beside the server. Replace <token> below with that value." : "No ARAVOS_TOKEN is set, so no header is needed. Set one before exposing the server beyond this network."}</Footnote>
            </Section>
            <Section title="Claude Code">
              <CodeBlock code={claude} label="Run once in a terminal" />
              <Footnote>Adds the server to Claude Code under the name aravos.</Footnote>
            </Section>
            <Section title="Other clients">
              <CodeBlock code={remote} label="Command for stdio-only clients" />
              <Footnote>Use this as the command in clients that only speak stdio, such as Claude Desktop or Cursor. Clients with native HTTP support can use the URL and header directly.</Footnote>
            </Section>
          </>
        )}
      </div>
    </Screen>
  );
}
