import type { ReactNode } from "react";
import { Chip } from "@/ui/Field";
import { selection } from "@/lib/haptics";

/** A chip with a 44px-tall hit region (the visual stays 28px) and a selection haptic. */
export function TapChip({ selected, onSelect, children, className }: { selected?: boolean; onSelect: () => void; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center py-2 -my-2 cursor-pointer select-none ${className ?? ""}`}
      onClick={(e) => {
        e.stopPropagation();
        void selection();
        onSelect();
      }}
    >
      <Chip selected={selected}>{children}</Chip>
    </span>
  );
}
