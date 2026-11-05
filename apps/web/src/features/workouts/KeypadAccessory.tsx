import { useKeyboardHeight } from "@/lib/keyboard";
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

/** Frosted glass bar above the system keyboard (touch only) with pill buttons: Previous, -step, +step, Next. Buttons keep the keyboard open. */
export function KeypadAccessory({ onPrevious, onStep, stepLabel }: AccessoryHandlers) {
  const focused = useSetFocus((s) => s.focused);
  // Sits on top of the keyboard and rides up with it (the keyboard height comes from src/lib/keyboard.ts).
  const kb = useKeyboardHeight();
  if (hasFinePointer || !focused) return null;
  const top = window.innerHeight - kb - 44;
  const keep = (e: React.PointerEvent) => e.preventDefault();
  return createPortal(
    <div className="wk-accessory" style={{ top }} data-testid="keypad-accessory">
      <button type="button" onPointerDown={keep} onClick={() => onPrevious(focused.setId)}>Previous</button>
      <button type="button" onPointerDown={keep} onClick={() => onStep(focused.setId, focused.field, -1)}>{`-${stepLabel(focused.field)}`}</button>
      <button type="button" onPointerDown={keep} onClick={() => onStep(focused.setId, focused.field, 1)}>{`+${stepLabel(focused.field)}`}</button>
      <button type="button" className="wk-acc-next" onPointerDown={keep} onClick={() => { if (!focusNextInput(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur(); }}>Next</button>
    </div>,
    document.body,
  );
}
