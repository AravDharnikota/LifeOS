import { useState, type CSSProperties } from "react";
import { useAuth } from "@/state/auth";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/Field";
import { Icon } from "@/ui/Icon";
import { isNative } from "@/lib/platform";
import { Scene } from "./Shell";

/** First-run screen: where is the server and what is the token. */
export function Connect() {
  const { connect, error, serverUrl, status } = useAuth();
  const [url, setUrl] = useState(serverUrl || "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const ok = await connect(url.trim(), token.trim());
    setBusy(false);
    if (!ok) setMsg(useAuth.getState().error ?? "Unable to connect. Check the address and token.");
  };
  return (
    <div className="relative min-h-dvh text-primary flex items-center justify-center px-[var(--gutter)] pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
      <Scene />
      <form className="relative z-[1] w-full max-w-[380px] flex flex-col" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="rise flex flex-col items-start px-1">
          <span className="w-11 h-11 rounded-[14px] bg-primary text-canvas inline-flex items-center justify-center shadow-thumb" aria-hidden="true">
            <Icon name="sparkle" size={20} strokeWidth={1.9} />
          </span>
          <h1 className="mt-6 text-[44px] leading-[48px] font-light tracking-[-0.035em]">AravOS</h1>
          <p className="text-[15px] text-secondary mt-2">{status === "offline" ? "The server is not reachable." : "Connect to the server."}</p>
        </div>
        <div className="rise glass-strong rounded-xl p-4 mt-7 flex flex-col gap-4" style={{ "--i": 1 } as CSSProperties}>
          {isNative && <TextField label="Server address" placeholder="https://aravos.example.com" inputMode="url" autoCapitalize="none" autoCorrect="off" value={url} onChange={(e) => setUrl(e.target.value)} />}
          <TextField label="Access token" placeholder="ARAVOS_TOKEN" autoCapitalize="none" autoCorrect="off" type="password" value={token} onChange={(e) => setToken(e.target.value)} error={msg ?? error ?? undefined} />
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={isNative && !url}>Connect</Button>
        </div>
        <p className="rise text-[12px] text-tertiary mt-4 px-1" style={{ "--i": 2 } as CSSProperties}>The token is the ARAVOS_TOKEN value set on the server.</p>
      </form>
    </div>
  );
}
