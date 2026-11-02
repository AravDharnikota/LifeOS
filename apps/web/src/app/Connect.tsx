import { useState } from "react";
import { useAuth } from "@/state/auth";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/Field";
import { isNative } from "@/lib/platform";

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
    <div className="min-h-dvh bg-canvas flex items-center justify-center px-[var(--gutter)] pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
      <form className="w-full max-w-[380px] flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div>
          <h1 className="text-large-title">AravOS</h1>
          <p className="text-subhead text-secondary mt-1">{status === "offline" ? "The server is not reachable." : "Connect to the server."}</p>
        </div>
        {isNative && <TextField label="Server address" placeholder="https://aravos.example.com" inputMode="url" autoCapitalize="none" autoCorrect="off" value={url} onChange={(e) => setUrl(e.target.value)} />}
        <TextField label="Access token" placeholder="ARAVOS_TOKEN" autoCapitalize="none" autoCorrect="off" type="password" value={token} onChange={(e) => setToken(e.target.value)} error={msg ?? error ?? undefined} />
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={isNative && !url}>Connect</Button>
      </form>
    </div>
  );
}
