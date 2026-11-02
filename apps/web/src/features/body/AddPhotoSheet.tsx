import { useEffect, useState } from "react";
import { todayString } from "@aravos/shared";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";
import { FieldRow } from "@/ui/Field";
import { TapChip } from "@/features/nutrition/TapChip";
import { Group } from "@/ui/List";
import { toast } from "@/ui/Toast";
import { dataUrlToBlob, type PickedImage } from "@/lib/images";
import { fmt1, fromDisplayWeight, toDisplayWeight } from "@/lib/format";
import { impact, notify } from "@/lib/haptics";
import { useAppSettings } from "@/data/queries";
import { useWeight } from "@/features/nutrition/api";
import { POSES, useAddBodyPhoto, type Pose } from "./api";
import { DateRow } from "@/features/health/DateRow";

/** After the camera: choose the pose, confirm the date and weight, add a note, save. */
export function AddPhotoSheet({ image, pose: initialPose, open, onClose }: { image: PickedImage | null; pose: Pose; open: boolean; onClose: () => void }) {
  const { units } = useAppSettings();
  const unit = units === "imperial" ? "lb" : "kg";
  const latest = useWeight(1).data?.latest ?? null;
  const add = useAddBodyPhoto();
  const [pose, setPose] = useState<Pose>(initialPose);
  const [date, setDate] = useState(todayString());
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPose(initialPose);
    setDate(todayString());
    setNote("");
    setError(null);
    setWeight(latest ? fmt1(toDisplayWeight(latest.weightKg, units)) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPose]);

  const save = async () => {
    if (!image) return;
    const w = weight.trim() === "" ? null : Number(weight.replace(",", "."));
    if (w != null && (Number.isNaN(w) || w <= 0)) {
      setError("Choose a weight above 0, or leave it empty.");
      return;
    }
    setError(null);
    try {
      await add.mutateAsync({ image: dataUrlToBlob(image.dataUrl), pose, date, note, weightKg: w == null ? null : fromDisplayWeight(w, units) });
      void impact("light");
      toast("Photo added");
      onClose();
    } catch (e) {
      void notify("error");
      setError(e instanceof Error ? e.message : "Unable to save the photo. Retry.");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="New Photo" detent="large" dirty={Boolean(image)}>
      <div className="flex flex-col gap-5 pt-3 -mx-[var(--gutter)]">
        <div className="px-[var(--gutter)] flex items-center gap-4">
          {image && <img src={image.dataUrl} alt="" className="w-[88px] h-[118px] rounded-sm object-cover bg-surface-2 shrink-0" />}
          <div className="flex gap-2 flex-wrap">
            {POSES.map((p) => (
              <TapChip key={p.value} selected={pose === p.value} onSelect={() => setPose(p.value)}>
                {p.label}
              </TapChip>
            ))}
          </div>
        </div>
        <Group>
          <DateRow value={date} max={todayString()} onChange={setDate} />
          <FieldRow label="Weight">
            <input inputMode="decimal" aria-label={`Weight in ${unit}`} placeholder="Optional" value={weight} onChange={(e) => setWeight(e.target.value)} className="w-24 text-right text-body outline-none bg-transparent tabular" />
            <span className="text-subhead text-secondary ml-1">{unit}</span>
          </FieldRow>
          <FieldRow label="Note">
            <input aria-label="Note" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} className="flex-1 text-right text-body outline-none bg-transparent" enterKeyHint="done" />
          </FieldRow>
        </Group>
        <div className="px-[var(--gutter)] flex flex-col gap-3">
          {error && <p className="text-footnote text-danger-text">{error}</p>}
          <Button variant="primary" size="lg" full loading={add.isPending} disabled={!image} onClick={() => void save()}>
            Save Photo
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
