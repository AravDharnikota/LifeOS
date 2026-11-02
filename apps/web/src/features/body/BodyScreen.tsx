import { useState } from "react";
import type { PhotoAnalysis } from "@aravos/shared";
import { daysBetween } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Button } from "@/ui/Button";
import { Footnote, SectionHeader } from "@/ui/List";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { cn } from "@/lib/cn";
import { imageUrl } from "@/lib/api";
import { pickImage, type PickedImage } from "@/lib/images";
import { fmt1, fmtDate, fmtWeight, toDisplayWeight } from "@/lib/format";
import { useIsDesktop } from "@/lib/hooks";
import { useAppSettings } from "@/data/queries";
import { aiErrorText, signOf } from "@/features/nutrition/model";
import { POSES, useAnalyzeBodyPhoto, useBodyPhotos, useBodyProgress, type Pose, type TimelineEntry } from "./api";
import { AddPhotoSheet } from "./AddPhotoSheet";
import { AnalysisSheet } from "./AnalysisSheet";
import { PhotoSheet } from "./PhotoSheet";

/** Progress photos by pose: a before and after pair, the grid, and the camera. */
export default function BodyScreen() {
  const isDesktop = useIsDesktop();
  const { units } = useAppSettings();
  const [pose, setPose] = useState<Pose>("front");
  const photos = useBodyPhotos();
  const progress = useBodyProgress();
  const analyze = useAnalyzeBodyPhoto();
  const [detail, setDetail] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [analysis, setAnalysis] = useState<PhotoAnalysis | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const list = (photos.data ?? []).filter((p) => p.pose === pose);
  const pair = progress.data?.pairs[pose] ?? null;

  const addPhoto = async () => {
    setPickError(null);
    try {
      const img = await pickImage("camera");
      if (img) setPicked(img);
    } catch {
      setPickError("Unable to read that image. Choose a JPEG or PNG.");
    }
  };
  const compare = async () => {
    if (!pair) return;
    setCompareError(null);
    try {
      setAnalysis(await analyze.mutateAsync({ id: pair.last.photoId, compareToId: pair.first.photoId }));
    } catch (e) {
      setCompareError(aiErrorText(e, "Photo comparison"));
    }
  };

  const header = <Segmented options={POSES} value={pose} onChange={setPose} className={isDesktop ? "max-w-[320px]" : undefined} />;
  const addButton = (
    <div className="px-[var(--gutter)] mt-8 flex flex-col gap-2">
      <Button variant="primary" size="lg" full onClick={() => void addPhoto()} data-testid="add-photo">
        Add Photo
      </Button>
      {pickError && <p className="text-footnote text-danger-text text-center">{pickError}</p>}
      <Footnote className="px-0 text-center text-tertiary">Photos stay on this server.</Footnote>
    </div>
  );

  let body;
  if (photos.isPending) body = <div className="pt-2"><Skeleton rows={3} /></div>;
  else if (photos.isError) body = <InlineError onRetry={() => void photos.refetch()}>Unable to load photos.</InlineError>;
  else if (list.length === 0)
    body = (
      <>
        <Empty action={<Button variant="plain" onClick={() => void addPhoto()}>Add Photo</Button>}>{photos.data?.length ? `No ${pose} photos yet.` : "No photos yet."}</Empty>
        {pickError && <p className="text-footnote text-danger-text text-center px-[var(--gutter)]">{pickError}</p>}
        <Footnote className="text-center text-tertiary mt-6">Photos stay on this server.</Footnote>
      </>
    );
  else
    body = (
      <>
        {pair && (
          <section className={cn("px-[var(--gutter)] pt-1", isDesktop && "max-w-[560px]")}>
            <div className="grid grid-cols-2 gap-3">
              <PairPhoto entry={pair.first} caption="Before" units={units} onPress={() => setDetail(pair.first.photoId)} />
              <PairPhoto entry={pair.last} caption="Latest" units={units} onPress={() => setDetail(pair.last.photoId)} />
            </div>
            <div className="flex items-center justify-between mt-2 min-h-[44px]">
              <span className="text-footnote text-secondary tabular">
                {daysBetween(pair.first.date, pair.last.date)} days
                {pair.first.weightKg != null && pair.last.weightKg != null ? ` · ${weightDelta(pair.first.weightKg, pair.last.weightKg, units)}` : ""}
              </span>
              <Button variant="plain" loading={analyze.isPending} onClick={() => void compare()} className="-mr-2">
                Compare
              </Button>
            </div>
            {compareError && <p className="text-footnote text-danger-text">{compareError}</p>}
          </section>
        )}
        <div className={cn(pair ? "mt-6" : "pt-1")}>
          <SectionHeader title={`${list.length} ${list.length === 1 ? "photo" : "photos"}`} />
          <div className={cn("px-[var(--gutter)] grid gap-2", isDesktop ? "grid-cols-4" : "grid-cols-3")} data-testid="photo-grid">
            {list.map((p) => (
              <button key={p.id} type="button" className="text-left pressable" onClick={() => setDetail(p.id)} aria-label={`${p.pose} photo, ${fmtDate(p.date)}`}>
                <img src={imageUrl(p.path)} alt="" className="w-full aspect-square object-cover rounded-sm bg-surface-2" loading="lazy" />
                <span className="block text-caption-1 text-tertiary tabular mt-1 truncate">{fmtDate(p.date)}</span>
              </button>
            ))}
          </div>
        </div>
        {addButton}
      </>
    );

  return (
    <Screen title="Progress" back="/health" header={header}>
      {isDesktop ? <div className="max-w-[900px]">{body}</div> : body}
      <PhotoSheet photoId={detail} open={detail != null} onClose={() => setDetail(null)} />
      <AddPhotoSheet image={picked} pose={pose} open={picked != null} onClose={() => setPicked(null)} />
      <AnalysisSheet analysis={analysis} open={analysis != null} onClose={() => setAnalysis(null)} />
    </Screen>
  );
}

function weightDelta(fromKg: number, toKg: number, units: "metric" | "imperial"): string {
  const d = toKg - fromKg;
  const v = toDisplayWeight(Math.abs(d), units);
  return `${signOf(d)}${fmt1(v)} ${units === "imperial" ? "lb" : "kg"}`;
}

function PairPhoto({ entry, caption, units, onPress }: { entry: TimelineEntry; caption: string; units: "metric" | "imperial"; onPress: () => void }) {
  return (
    <button type="button" className="text-left pressable" onClick={onPress} aria-label={`${caption}, ${fmtDate(entry.date)}`}>
      <img src={imageUrl(entry.path)} alt="" className="w-full aspect-[3/4] object-cover rounded-md bg-surface-2" />
      <span className="block text-footnote text-secondary mt-1.5">{caption}</span>
      <span className="block text-footnote text-primary tabular">
        {fmtDate(entry.date)}
        {entry.weightKg != null ? ` · ${fmtWeight(entry.weightKg, units)}` : ""}
      </span>
    </button>
  );
}
