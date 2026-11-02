import { useEffect, useState } from "react";
import type { PhotoAnalysis } from "@aravos/shared";
import { Sheet, ActionSheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";
import { Group, SectionHeader, ValueRow } from "@/ui/List";
import { Skeleton, InlineError } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { imageUrl } from "@/lib/api";
import { fmtDate, fmtWeight } from "@/lib/format";
import { notify } from "@/lib/haptics";
import { useAppSettings } from "@/data/queries";
import { aiErrorText } from "@/features/nutrition/model";
import { POSES, useAnalyzeBodyPhoto, useBodyPhoto, useDeleteBodyPhoto } from "./api";
import { AnalysisBody } from "./Observations";

/** One photo: full size, its facts, the latest analysis, analyze against the previous photo, delete. */
export function PhotoSheet({ photoId, open, onClose }: { photoId: string | null; open: boolean; onClose: () => void }) {
  const { units } = useAppSettings();
  const photo = useBodyPhoto(open ? photoId : null);
  const analyze = useAnalyzeBodyPhoto();
  const del = useDeleteBodyPhoto();
  const [confirm, setConfirm] = useState(false);
  const [fresh, setFresh] = useState<PhotoAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setFresh(null);
      setError(null);
    }
  }, [open, photoId]);
  const p = photo.data;
  const analysis = fresh ?? p?.analysis ?? null;

  const run = async () => {
    if (!p) return;
    setError(null);
    try {
      setFresh(await analyze.mutateAsync({ id: p.id }));
    } catch (e) {
      setError(aiErrorText(e, "Photo analysis"));
    }
  };
  const remove = async () => {
    if (!p) return;
    try {
      await del.mutateAsync(p.id);
      toast("Photo deleted");
      onClose();
    } catch {
      void notify("error");
      toast("Unable to delete the photo");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={p ? `${POSES.find((x) => x.value === p.pose)?.label ?? "Photo"} · ${fmtDate(p.date)}` : "Photo"} detent="large" leading={null} trailing={<button type="button" className="text-headline text-accent-text px-2 h-11" onClick={onClose}>Done</button>}>
      {photo.isPending ? (
        <div className="pt-4"><Skeleton rows={3} className="mx-0" /></div>
      ) : photo.isError || !p ? (
        <InlineError onRetry={() => void photo.refetch()}>Unable to load the photo.</InlineError>
      ) : (
        <div className="flex flex-col gap-5 pt-2 -mx-[var(--gutter)]">
          <img src={imageUrl(p.path)} alt={`${p.pose} photo from ${fmtDate(p.date)}`} className="mx-[var(--gutter)] max-h-[52vh] object-contain rounded-md bg-surface-2" />
          <Group>
            <ValueRow title="Date" value={fmtDate(p.date)} />
            <ValueRow title="Weight" value={p.weightKg != null ? fmtWeight(p.weightKg, units) : "Not recorded"} />
            {p.note && <ValueRow title="Note" value={<span className="whitespace-normal text-right">{p.note}</span>} />}
          </Group>
          <div>
            <SectionHeader title="Analysis" />
            <div className="px-[var(--gutter)] flex flex-col gap-3">
              {analysis ? <AnalysisBody analysis={analysis} compact /> : <p className="text-callout text-secondary">Not analyzed yet.</p>}
              {error && <p className="text-footnote text-danger-text">{error}</p>}
              <Button variant="secondary" full loading={analyze.isPending} onClick={() => void run()}>
                {analysis ? "Analyze Again" : "Analyze"}
              </Button>
              <p className="text-footnote text-tertiary">Compares with the previous {p.pose} photo. The photos are sent to the model only for this step.</p>
            </div>
          </div>
          <div className="px-[var(--gutter)]">
            <Button variant="destructive" full onClick={() => setConfirm(true)}>
              Delete Photo
            </Button>
          </div>
        </div>
      )}
      <ActionSheet open={confirm} onClose={() => setConfirm(false)} title="Delete this photo?" message="The file is removed from the server." actions={[{ label: "Delete Photo", destructive: true, onPress: () => void remove() }]} />
    </Sheet>
  );
}
