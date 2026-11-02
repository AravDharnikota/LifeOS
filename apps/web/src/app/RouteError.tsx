import { useRouteError } from "react-router";
import { Button } from "@/ui/Button";

export function RouteError() {
  const err = useRouteError() as { message?: string; statusText?: string } | undefined;
  return (
    <div className="h-dvh flex flex-col items-center justify-center gap-3 px-6 text-center bg-canvas">
      <p className="text-callout text-secondary max-w-[36ch]">Something went wrong. {err?.message ?? err?.statusText ?? ""}</p>
      <Button variant="plain" onClick={() => window.location.reload()}>Reload</Button>
    </div>
  );
}
