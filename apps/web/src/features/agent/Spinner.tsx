import { useEffect, useState } from "react";
import { SPINNER_FRAMES } from "./terminal";

/** Braille spinner frame, 80ms per step. Each spinner ticks on its own; there are rarely more than two running. */
export function useSpinnerFrame(active = true): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setI((v) => (v + 1) % SPINNER_FRAMES.length), 80);
    return () => window.clearInterval(id);
  }, [active]);
  return SPINNER_FRAMES[i] ?? SPINNER_FRAMES[0];
}

/** `⠋ label` on the terminal grid: spinner in the 2ch gutter, dim label beside it. */
export function WorkingLine({ children }: { children: string }) {
  const frame = useSpinnerFrame();
  return (
    <div className="grid grid-cols-[2ch_1fr] text-term-fg-dim" role="status">
      <span aria-hidden="true" className="text-term-prompt select-none">{frame}</span>
      <span>{children}</span>
    </div>
  );
}

/** `✗ message  retry` on the terminal grid. */
export function ErrorLine({ children, onRetry, retryLabel = "retry" }: { children: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="grid grid-cols-[2ch_1fr] text-term-err" role="alert">
      <span aria-hidden="true" className="select-none">✗</span>
      <div className="break-words">
        {children}
        {onRetry && (
          <>
            {"  "}
            <button type="button" onClick={onRetry} className="text-term-fg-dim underline underline-offset-2 hover:text-term-fg">
              {retryLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
