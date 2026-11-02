import type { PhotoAnalysis } from "@aravos/shared";
import { fmtRelativeDate } from "@/lib/format";
import { scoreWord } from "./api";

/** Score as a word, the summary, then observations as a plain hairline list. */
export function AnalysisBody({ analysis, compact }: { analysis: PhotoAnalysis; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className={compact ? "text-headline text-primary" : "text-title-2 text-primary"}>{scoreWord(analysis.progressScore)}</p>
        <p className="text-footnote text-secondary mt-0.5">{fmtRelativeDate(analysis.createdAt)}{analysis.comparedToPhotoId ? " · compared with the earlier photo" : " · no earlier photo"}</p>
      </div>
      <p className="text-callout text-primary">{analysis.summary}</p>
      {analysis.observations.length > 0 && (
        <ul className="bg-surface rounded-md overflow-hidden">
          {analysis.observations.map((o, i) => (
            <li key={i} className={`px-[var(--gutter)] py-3 text-subhead text-primary ${i ? "hairline-t" : ""}`}>
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
