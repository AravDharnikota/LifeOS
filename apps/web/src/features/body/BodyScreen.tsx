import { useState } from "react";
import type { PhotoAnalysis } from "@aravos/shared";
import { daysBetween } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { CardHeader } from "@/ui/viz";
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
import { riseStyle } from "@/features/health/parts";

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
      <Footnote className="px-0 text-center text-tertiary flex items-center justify-center gap-1.5"><Icon name="lock" size={12} strokeWidth={1.8} />Photos stay on this server.</Footnote>
    </div>
  );

  let body;
  if (photos.isPending) body = <div className="pt-2"><Skeleton rows={3} /></div>;
  else if (photos.isError) body = <InlineError onRetry={() => void photos.refetch()}>Unable to load photos.</InlineError>;
  else if (list.length === 0)
    body = (
      <>
        <div className="mx-[var(--gutter)] glass rounded-lg flex flex-col items-center pt-6 rise" style={riseStyle(0)}>
          <span className="w-12 h-12 rounded-[14px] well inline-flex items-center justify-center text-secondary">
            <Icon name="camera" size={22} strokeWidth={1.6} />
          </span>
          <Empty className="pt-3 pb-5" action={<Button variant="plain" onClick={() => void addPhoto()}>Add Photo</Button>}>{photos.data?.length ? `No ${pose} photos yet.` : "No photos yet. Same light, same spot, every few weeks."}</Empty>
        </div>
        {pickError && <p className="text-footnote text-danger-text text-center px-[var(--gutter)]">{pickError}</p>}
        <Footnote className="text-center text-tertiary mt-6 flex items-center justify-center gap-1.5"><Icon name="lock" size={12} strokeWidth={1.8} />Photos stay on this server.</Footnote>
      </>
    );
  else
    body = (
      <>
        {pair && (
          <section className={cn("mx-[var(--gutter)] glass-strong rounded-lg p-3 rise", isDesktop && "max-w-[560px]")} style={riseStyle(0)}>
            <CardHeader
              icon="swap"
              title="Before and latest"
              sub={
                <span className="tabular">
                  {daysBetween(pair.first.date, pair.last.date)} days
                  {pair.first.weightKg != null && pair.last.weightKg != null ? ` · ${weightDelta(pair.first.weightKg, pair.last.weightKg, units)}` : ""}
                </span>
              }
              trailing={
                <Button variant="secondary" size="sm" loading={analyze.isPending} onClick={() => void compare()} leading={<Icon name="sparkle" size={15} strokeWidth={1.8} />}>
                  Compare
                </Button>
              }
              className="px-1 pt-1"
            />
            <div className="grid grid-cols-2 gap-2 mt-3">
              <PairPhoto entry={pair.first} caption="Before" units={units} onPress={() => setDetail(pair.first.photoId)} />
              <PairPhoto entry={pair.last} caption="Latest" units={units} onPress={() => setDetail(pair.last.photoId)} />
            </div>
            {compareError && <p className="text-[13px] text-danger-text px-1 pt-2">{compareError}</p>}
          </section>
        )}
        <div className={cn(pair ? "mt-7" : "pt-1")}>
          <SectionHeader title={`${list.length} ${list.length === 1 ? "photo" : "photos"}`} />
          <div className={cn("px-[var(--gutter)] grid gap-2", isDesktop ? "grid-cols-4" : "grid-cols-3")} data-testid="photo-grid">
            {list.map((p, i) => (
              <button key={p.id} type="button" className="glass rounded-[16px] p-1 text-left pressable-spring rise" style={riseStyle(Math.min(i, 8) + 1)} onClick={() => setDetail(p.id)} aria-label={`${p.pose} photo, ${fmtDate(p.date)}`}>
                <img src={imageUrl(p.path)} alt="" className="w-full aspect-[3/4] object-cover rounded-[12px] bg-surface-2" loading="lazy" />
                <span className="block text-[11px] text-tertiary tabular px-1 pt-1 pb-0.5 truncate">{fmtDate(p.date)}</span>
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
    <button type="button" className="relative block text-left well rounded-[16px] p-1 pressable-spring" onClick={onPress} aria-label={`${caption}, ${fmtDate(entry.date)}`}>
      <img src={imageUrl(entry.path)} alt="" className="w-full aspect-[3/4] object-cover rounded-[12px] bg-surface-2" />
      <span className="absolute left-2.5 top-2.5 glass-strong rounded-full h-6 px-2.5 inline-flex items-center text-[11px] text-primary">{caption}</span>
      <span className="block px-1.5 pt-1.5 pb-1 text-[12px] text-secondary tabular truncate">
        {fmtDate(entry.date)}
        {entry.weightKg != null ? ` · ${fmtWeight(entry.weightKg, units)}` : ""}
      </span>
    </button>
  );
}
