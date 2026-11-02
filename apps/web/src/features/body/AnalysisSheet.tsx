import type { PhotoAnalysis } from "@aravos/shared";
import { Sheet } from "@/ui/Sheet";
import { Footnote } from "@/ui/List";
import { AnalysisBody } from "./Observations";

export function AnalysisSheet({ analysis, open, onClose }: { analysis: PhotoAnalysis | null; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Comparison" detent="large" leading={null} trailing={<button type="button" className="text-headline text-accent-text px-2 h-11" onClick={onClose}>Done</button>}>
      {analysis && (
        <div className="pt-3 flex flex-col gap-4">
          <AnalysisBody analysis={analysis} />
          <Footnote className="px-0">Observations describe what is visible. They are not a measurement.</Footnote>
        </div>
      )}
    </Sheet>
  );
}
