import { useQuery } from "@tanstack/react-query";
import type { BodyPhoto, PhotoAnalysis } from "@aravos/shared";
import { api, qs } from "@/lib/api";
import { useApiMutation } from "@/data/queries";

export type Pose = BodyPhoto["pose"];
export const POSES: { value: Pose; label: string }[] = [
  { value: "front", label: "Front" },
  { value: "side", label: "Side" },
  { value: "back", label: "Back" },
];

export interface TimelineEntry {
  photoId: string;
  date: string;
  pose: Pose;
  path: string;
  weightKg: number | null;
  analysis: PhotoAnalysis | null;
}
export interface BodyProgress {
  timeline: Record<Pose, TimelineEntry[]>;
  pairs: Record<Pose, { first: TimelineEntry; last: TimelineEntry } | null>;
}

export const bk = {
  photos: (pose?: Pose) => ["body", "photos", pose ?? "all"] as const,
  photo: (id: string) => ["body", "photo", id] as const,
  progress: ["body", "progress"] as const,
};
const KINDS = ["body", "summary", "layout"];

export const useBodyPhotos = (pose?: Pose) => useQuery({ queryKey: bk.photos(pose), queryFn: () => api.get<BodyPhoto[]>(`/api/body/photos${qs({ pose })}`), staleTime: 30_000 });
export const useBodyPhoto = (id: string | null) => useQuery({ queryKey: bk.photo(id ?? ""), queryFn: () => api.get<BodyPhoto>(`/api/body/photos/${id}`), enabled: Boolean(id) });
export const useBodyProgress = () => useQuery({ queryKey: bk.progress, queryFn: () => api.get<BodyProgress>("/api/body/progress"), staleTime: 30_000 });

export const useAddBodyPhoto = () =>
  useApiMutation((input: { image: Blob; pose: Pose; date?: string; note?: string; weightKg?: number | null }) => {
    const form = new FormData();
    form.append("image", input.image, "photo.jpg");
    form.append("pose", input.pose);
    if (input.date) form.append("date", input.date);
    if (input.note?.trim()) form.append("note", input.note.trim());
    if (input.weightKg != null && input.weightKg > 0) form.append("weightKg", String(Math.round(input.weightKg * 100) / 100));
    return api.post<BodyPhoto>("/api/body/photos", form);
  }, KINDS);
export const useDeleteBodyPhoto = () => useApiMutation((id: string) => api.delete<{ ok: boolean }>(`/api/body/photos/${id}`), KINDS);
export const useAnalyzeBodyPhoto = () => useApiMutation(({ id, compareToId }: { id: string; compareToId?: string }) => api.post<PhotoAnalysis>(`/api/body/photos/${id}/analyze`, compareToId ? { compareToId } : {}), KINDS);

/** The progress score as a word, never a number. */
export function scoreWord(score: number | null | undefined): string {
  if (score == null) return "No comparison";
  if (score >= 2) return "Clearly progressed";
  if (score === 1) return "Progressed";
  if (score === 0) return "No visible change";
  return "Regressed";
}
