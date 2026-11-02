import { useQuery } from "@tanstack/react-query";
import type { Food, FoodAnalysis, HealthProfile, Meal, MealType, Nutrients, TrendPoint, WaterLog, WeightLog } from "@aravos/shared";
import { api, qs } from "@/lib/api";
import { useApiMutation } from "@/data/queries";

// ---------- shapes from apps/server/src/services/nutrition.ts ----------
export interface DayMealSummary {
  id: string;
  mealType: MealType;
  name: string | null;
  calories: number;
  items: number;
  photoPath: string | null;
  loggedAt: string;
  healthScore: number | null;
}
type Targets = HealthProfile["targets"];
export interface NutritionDay {
  date: string;
  totals: Nutrients;
  targets: Targets;
  remaining: { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number; sugarG: number; sodiumMg: number; waterMl: number };
  percent: Record<keyof NutritionDay["remaining"], number>;
  meals: DayMealSummary[];
  byMealType: Record<MealType, Nutrients>;
  water: { ml: number; target: number };
  weight: WeightLog | null;
  healthScore: number | null;
}
export interface RangeRow {
  date: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterMl: number;
  meals: number;
}
export interface WaterDay {
  date: string;
  ml: number;
  target: number;
  logs: WaterLog[];
}
export interface WeightSummary {
  logs: WeightLog[];
  trend: TrendPoint[];
  latest: WeightLog | null;
  change7d: number | null;
  change30d: number | null;
}
export interface AnalyzeResult {
  analysisId: string;
  imagePath: string | null;
  analysis: FoodAnalysis;
  localTime: string;
  date: string;
}

/** Keys start with the kinds that `invalidateAll` knows: meals, water, weight. */
export const nk = {
  day: (date: string) => ["meals", "day", date] as const,
  meal: (id: string) => ["meals", "meal", id] as const,
  range: (from: string, to: string) => ["meals", "range", from, to] as const,
  water: (date: string) => ["water", "day", date] as const,
  weight: (limit: number) => ["weight", limit] as const,
  foods: (q: string) => ["foods", q] as const,
};

const MEAL_KINDS = ["meals", "summary", "layout"];
const WATER_KINDS = ["water", "meals", "summary", "layout"];
const WEIGHT_KINDS = ["weight", "meals", "summary", "layout", "body"];

export const useNutritionDay = (date: string) => useQuery({ queryKey: nk.day(date), queryFn: () => api.get<NutritionDay>(`/api/nutrition/day${qs({ date })}`), staleTime: 15_000 });
export const useMeal = (id: string | null) => useQuery({ queryKey: nk.meal(id ?? ""), queryFn: () => api.get<Meal>(`/api/meals/${id}`), enabled: Boolean(id) });
export const useRange = (from: string, to: string) => useQuery({ queryKey: nk.range(from, to), queryFn: () => api.get<RangeRow[]>(`/api/nutrition/range${qs({ from, to })}`), staleTime: 30_000, placeholderData: (prev) => prev });
export const useWater = (date: string) => useQuery({ queryKey: nk.water(date), queryFn: () => api.get<WaterDay>(`/api/water${qs({ date })}`), staleTime: 15_000 });
export const useWeight = (limit = 90) => useQuery({ queryKey: nk.weight(limit), queryFn: () => api.get<WeightSummary>(`/api/weight${qs({ limit })}`), staleTime: 30_000 });
export const useFoodSearch = (q: string, enabled = true) =>
  useQuery({ queryKey: nk.foods(q), queryFn: () => api.get<Food[]>(`/api/foods${qs({ q, limit: 30 })}`), staleTime: 60_000, placeholderData: (prev) => prev, enabled });

export const lookupBarcode = (code: string) => api.get<Food>(`/api/foods/barcode/${encodeURIComponent(code)}`);
export const createFood = (input: { name: string; brand?: string | null; per100: Nutrients; servings?: { label: string; grams: number }[]; barcode?: string | null }) => api.post<Food>("/api/foods", input);

export function analyzeFood(input: { image?: Blob | null; text?: string | null; mealType?: MealType; date?: string }): Promise<AnalyzeResult> {
  const form = new FormData();
  if (input.image) form.append("image", input.image, "meal.jpg");
  if (input.text?.trim()) form.append("text", input.text.trim());
  if (input.mealType) form.append("mealType", input.mealType);
  if (input.date) form.append("date", input.date);
  return api.post<AnalyzeResult>("/api/nutrition/analyze", form);
}
export const correctAnalysis = (input: { analysis: FoodAnalysis; note: string; imagePath?: string }) => api.post<{ analysis: FoodAnalysis }>("/api/nutrition/analyze/correct", input);

export interface MealItemWrite {
  foodId?: string | null;
  name: string;
  quantity?: number;
  unit?: string;
  grams?: number | null;
  calories: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number | null;
  sugarG?: number | null;
  sodiumMg?: number | null;
  saturatedFatG?: number | null;
  cholesterolMg?: number | null;
  potassiumMg?: number | null;
  confidence?: number | null;
}
export interface MealWrite {
  date?: string;
  mealType?: MealType;
  name?: string | null;
  source?: "photo" | "manual" | "search" | "barcode" | "text";
  photoPath?: string | null;
  aiNotes?: string | null;
  healthScore?: number | null;
  items?: MealItemWrite[];
}

export const useCreateMeal = () => useApiMutation((input: MealWrite) => api.post<Meal>("/api/meals", input), MEAL_KINDS);
export const useMealFromAnalysis = () => useApiMutation((input: { analysis: FoodAnalysis; date?: string; mealType?: MealType; imagePath?: string | null; name?: string }) => api.post<Meal>("/api/meals/from-analysis", input), MEAL_KINDS);
export const useUpdateMeal = () => useApiMutation(({ id, ...patch }: MealWrite & { id: string }) => api.patch<Meal>(`/api/meals/${id}`, patch), MEAL_KINDS);
export const useDeleteMeal = () => useApiMutation((id: string) => api.delete<{ ok: boolean }>(`/api/meals/${id}`), MEAL_KINDS);
export const useUpdateMealItem = () => useApiMutation(({ id, ...patch }: Partial<MealItemWrite> & { id: string }) => api.patch<Meal>(`/api/meal-items/${id}`, patch), MEAL_KINDS);
export const useDeleteMealItem = () => useApiMutation((id: string) => api.delete<Meal>(`/api/meal-items/${id}`), MEAL_KINDS);

export const useAddWater = () => useApiMutation((input: { ml: number; date?: string }) => api.post<WaterLog>("/api/water", input), WATER_KINDS);
export const useDeleteWater = () => useApiMutation((id: string) => api.delete<{ ok: boolean }>(`/api/water/${id}`), WATER_KINDS);

export const useLogWeight = () => useApiMutation((input: { date?: string; weightKg: number; bodyFatPct?: number | null; note?: string | null }) => api.post<WeightLog>("/api/weight", input), WEIGHT_KINDS);
export const useDeleteWeight = () => useApiMutation((id: string) => api.delete<{ ok: boolean }>(`/api/weight/${id}`), WEIGHT_KINDS);
