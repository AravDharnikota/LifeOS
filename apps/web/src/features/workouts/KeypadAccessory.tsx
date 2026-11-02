import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { hasFinePointer } from "@/lib/platform";
import { focusNextInput } from "./SetRow";
import { useSetFocus } from "./store";
import type { ColumnKind } from "./lib";

export interface AccessoryHandlers {
  onPrevious: (setId: string) => void;
  onStep: (setId: string, field: ColumnKind, dir: 1 | -1) => void;
  stepLabel: (field: ColumnKind) => string;
}

/** Fixed row above the system keyboard (touch only): Previous, -step, +step, Next. Buttons keep the keyboard open. */
export function KeypadAccessory({ onPrevious, onStep, stepLabel }: AccessoryHandlers) {
  const focused = useSetFocus((s) => s.focused);
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    if (!focused) return;
    const vv = window.visualViewport;
    const update = () => setTop(vv ? vv.offsetTop + vv.height - 44 : window.innerHeight - 44);
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [focused]);
  if (hasFinePointer || !focused || top == null) return null;
  const keep = (e: React.PointerEvent) => e.preventDefault();
  return createPortal(
    <div className="wk-accessory" style={{ top }} data-testid="keypad-accessory">
      <button type="button" onPointerDown={keep} onClick={() => onPrevious(focused.setId)}>Previous</button>
      <button type="button" onPointerDown={keep} onClick={() => onStep(focused.setId, focused.field, -1)}>{`-${stepLabel(focused.field)}`}</button>
      <button type="button" onPointerDown={keep} onClick={() => onStep(focused.setId, focused.field, 1)}>{`+${stepLabel(focused.field)}`}</button>
      <button type="button" onPointerDown={keep} onClick={() => { if (!focusNextInput(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur(); }}>Next</button>
    </div>,
    document.body,
  );
}
