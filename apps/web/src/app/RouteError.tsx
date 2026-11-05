import { useRouteError } from "react-router";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Scene } from "./Shell";

/** A route crashed: the lit scene, one calm glass card, one way out. */
export function RouteError() {
  const err = useRouteError() as { message?: string; statusText?: string } | undefined;
  const detail = err?.message ?? err?.statusText ?? "";
  return (
    <div className="relative h-dvh flex items-center justify-center px-[var(--gutter)] text-primary">
      <Scene />
      <div className="rise relative z-[1] glass-strong rounded-xl w-full max-w-[360px] p-5 flex flex-col items-center text-center">
        <span className="w-10 h-10 rounded-[12px] well inline-flex items-center justify-center text-secondary" aria-hidden="true">
          <Icon name="info" size={18} strokeWidth={1.8} />
        </span>
        <h1 className="mt-4 text-[20px] leading-6 font-normal">Something went wrong</h1>
        {detail && <p className="mt-2 text-[13px] leading-[18px] text-tertiary max-w-[36ch] break-words">{detail}</p>}
        <Button variant="primary" className="mt-5" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}
