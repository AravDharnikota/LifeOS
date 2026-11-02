import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Food, MealType, Nutrients } from "@aravos/shared";
import { scaleNutrients, todayString } from "@aravos/shared";
import { Sheet } from "@/ui/Sheet";
import { Segmented } from "@/ui/Segmented";
import { Button, IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group, Row, SectionHeader, Footnote } from "@/ui/List";
import { TextField, TextArea } from "@/ui/Field";
import { TapChip } from "./TapChip";
import { Stepper } from "@/ui/Stepper";
import { Spinner } from "@/ui/Spinner";
import { Empty, Skeleton } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { ApiError, imageUrl } from "@/lib/api";
import { dataUrlToBlob, pickImage } from "@/lib/images";
import { impact, notify } from "@/lib/haptics";
import { fmtInt, plural } from "@/lib/format";
import { useDebounced, useIsDesktop } from "@/lib/hooks";
import { isNative } from "@/lib/platform";
import { analyzeFood, correctAnalysis, createFood, lookupBarcode, useCreateMeal, useFoodSearch, useMealFromAnalysis, useNutritionDay } from "./api";
import { MEAL_TYPES, aiErrorText, analysisFromDraft, celebrateOnce, defaultServing, draftFromAnalysis, draftItemFromFood, draftTotals, fmtKcal, fmtMacros, mealTypeForNow, rescaleItem, scoreLine, type Draft, type DraftItem } from "./model";

export type LogMode = "photo" | "describe" | "search" | "barcode";
type Stage = { kind: "input" } | { kind: "portion"; food: Food } | { kind: "create" } | { kind: "results" };

const MODES: { value: LogMode; label: string }[] = [
  { value: "photo", label: "Photo" },
  { value: "describe", label: "Describe" },
  { value: "search", label: "Search" },
  { value: "barcode", label: "Barcode" },
];

export interface LogFoodSheetProps {
  open: boolean;
  onClose: () => void;
  date?: string;
  mealType?: MealType;
  initialMode?: LogMode;
}

/** Food logger: Photo, Describe, Search and Barcode feed one results view, which logs the meal. */
export function LogFoodSheet({ open, onClose, date, mealType, initialMode = "photo" }: LogFoodSheetProps) {
  const day = date ?? todayString();
  const [mode, setMode] = useState<LogMode>(initialMode);
  const [stage, setStage] = useState<Stage>({ kind: "input" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"analyze" | "fix" | "log" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = useNutritionDay(day);
  const createMeal = useCreateMeal();
  const fromAnalysis = useMealFromAnalysis();

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setStage({ kind: "input" });
    setDraft(null);
    setPreview(null);
    setBusy(null);
    setError(null);
  }, [open, initialMode]);

  const defaultType = mealType ?? mealTypeForNow();
  const dirty = Boolean(draft && draft.items.length) || Boolean(preview);

  const runAnalysis = async (input: { image?: Blob | null; text?: string | null }) => {
    setBusy("analyze");
    setError(null);
    try {
      const res = await analyzeFood({ ...input, mealType: defaultType, date: day });
      setDraft(draftFromAnalysis(res.analysis, res.imagePath, defaultType));
      setStage({ kind: "results" });
    } catch (e) {
      setError(aiErrorText(e, input.image ? "Photo analysis" : "Meal analysis"));
    } finally {
      setBusy(null);
    }
  };

  const fix = async (note: string) => {
    if (!draft) return;
    setBusy("fix");
    setError(null);
    try {
      const res = await correctAnalysis({ analysis: analysisFromDraft(draft), note, imagePath: draft.imagePath ?? undefined });
      setDraft((d) => ({ ...draftFromAnalysis(res.analysis, d?.imagePath ?? null, d?.mealType), name: res.analysis.mealName }));
    } catch (e) {
      setError(aiErrorText(e, "Fixing results"));
    } finally {
      setBusy(null);
    }
  };

  const addItem = (item: DraftItem, source: "search" | "barcode") => {
    setDraft((d) => (d ? { ...d, items: [...d.items, item] } : { name: "", mealType: defaultType, items: [item], healthScore: null, notes: "", imagePath: null, source }));
    setStage({ kind: "results" });
  };

  const log = async () => {
    if (!draft || !draft.items.length) return;
    setBusy("log");
    setError(null);
    const totals = draftTotals(draft);
    try {
      if (draft.source === "photo" || draft.source === "text") {
        const analysis = analysisFromDraft(draft);
        await fromAnalysis.mutateAsync({ analysis, date: day, mealType: draft.mealType, imagePath: draft.imagePath, name: analysis.mealName });
      } else {
        await createMeal.mutateAsync({
          date: day,
          mealType: draft.mealType,
          name: draft.name.trim() || null,
          source: draft.source,
          items: draft.items.map((it) => ({ foodId: it.foodId, name: it.name, quantity: it.quantity, unit: it.unit, grams: it.grams, ...it.nutrients, confidence: it.confidence })),
        });
      }
      const before = summary.data?.totals;
      const targets = summary.data?.targets;
      let celebrated = false;
      if (before && targets && day === todayString()) {
        if (before.calories < targets.calories && before.calories + totals.calories >= targets.calories && celebrateOnce("calories")) celebrated = true;
        if (before.proteinG < targets.proteinG && before.proteinG + totals.proteinG >= targets.proteinG && celebrateOnce("protein")) celebrated = true;
      }
      void (celebrated ? notify("success") : impact("light"));
      toast(`Logged ${fmtKcal(totals.calories)}`);
      onClose();
    } catch (e) {
      void notify("error");
      setError(e instanceof Error ? e.message : "Unable to log the meal. Retry.");
    } finally {
      setBusy(null);
    }
  };

  const title = stage.kind === "portion" ? "Portion" : stage.kind === "create" ? "New Food" : stage.kind === "results" ? "Meal" : "Log Food";
  const back = stage.kind === "input" ? undefined : (
    <IconButton label="Back" tinted onClick={() => setStage(stage.kind === "results" || stage.kind === "create" ? { kind: "input" } : { kind: "input" })}>
      <Icon name="chevron-left" size={24} />
    </IconButton>
  );

  return (
    <Sheet open={open} onClose={onClose} title={title} detent="large" dirty={dirty} leading={back}>
      {stage.kind === "input" && (
        <div className="flex flex-col gap-4 pt-2">
          <Segmented options={MODES} value={mode} onChange={(m) => { setMode(m); setError(null); }} />
          {mode === "photo" && <PhotoPane preview={preview} busy={busy === "analyze"} error={error} onPicked={(dataUrl, note) => { setPreview(dataUrl); void runAnalysis({ image: dataUrlToBlob(dataUrl), text: note }); }} onRetry={(note) => preview && void runAnalysis({ image: dataUrlToBlob(preview), text: note })} onClear={() => { setPreview(null); setError(null); }} onSwitch={() => setMode("search")} />}
          {mode === "describe" && <DescribePane busy={busy === "analyze"} error={error} onAnalyze={(text) => void runAnalysis({ text })} onSwitch={() => setMode("search")} />}
          {mode === "search" && <SearchPane draft={draft} onPick={(food) => setStage({ kind: "portion", food })} onCreate={() => setStage({ kind: "create" })} onReview={() => setStage({ kind: "results" })} />}
          {mode === "barcode" && <BarcodePane onFound={(food) => setStage({ kind: "portion", food })} />}
        </div>
      )}
      {stage.kind === "portion" && <PortionPane food={stage.food} onAdd={(item) => addItem(item, mode === "barcode" ? "barcode" : "search")} />}
      {stage.kind === "create" && <CreateFoodPane onCreated={(food) => setStage({ kind: "portion", food })} />}
      {stage.kind === "results" && draft && (
        <ResultsPane draft={draft} setDraft={setDraft} preview={preview} busy={busy} error={error} onFix={(note) => void fix(note)} onLog={() => void log()} onAddItem={() => { setMode("search"); setStage({ kind: "input" }); }} />
      )}
    </Sheet>
  );
}

// ---------- Photo ----------
function PhotoPane({ preview, busy, error, onPicked, onRetry, onClear, onSwitch }: { preview: string | null; busy: boolean; error: string | null; onPicked: (dataUrl: string, note: string) => void; onRetry: (note: string) => void; onClear: () => void; onSwitch: () => void }) {
  const [note, setNote] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const pick = async (source: "camera" | "library") => {
    setPickError(null);
    try {
      const img = await pickImage(source);
      if (img) onPicked(img.dataUrl, note);
    } catch {
      setPickError("Unable to read that image. Choose a JPEG or PNG.");
    }
  };
  return (
    <div className="flex flex-col gap-4">
      {preview ? (
        <div className="flex flex-col gap-3">
          <img src={preview} alt="Meal photo" className="w-full max-h-[280px] object-cover rounded-md bg-surface-2" />
          {busy ? (
            <Analyzing />
          ) : error ? (
            <AiError text={error} onRetry={() => onRetry(note)} onSwitch={onSwitch} />
          ) : null}
          {!busy && (
            <Button variant="plain" onClick={onClear}>
              Retake
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 pt-2">
            <Button variant="primary" size="lg" full leading={<Icon name="camera" size={20} />} onClick={() => void pick("camera")} data-testid="take-photo">
              Take Photo
            </Button>
            <Button variant="plain" size="lg" full onClick={() => void pick("library")}>
              Choose from Library
            </Button>
          </div>
          {pickError && <p className="text-footnote text-danger-text text-center">{pickError}</p>}
          <p className="text-footnote text-tertiary text-center">Fit the whole plate in the frame.</p>
          <TextField label="Note" placeholder="Home-made, big bowl" value={note} onChange={(e) => setNote(e.target.value)} enterKeyHint="done" className="pt-2" />
        </>
      )}
    </div>
  );
}

function Analyzing() {
  return (
    <div className="flex items-center justify-center gap-2 py-5 text-secondary" role="status">
      <Spinner size={18} />
      <span className="text-callout">Analyzing</span>
    </div>
  );
}

function AiError({ text, onRetry, onSwitch }: { text: string; onRetry?: () => void; onSwitch?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-3 text-center">
      <p className="text-callout text-secondary max-w-[34ch]">{text}</p>
      <div className="flex gap-3">
        {onRetry && <Button variant="plain" onClick={onRetry}>Retry</Button>}
        {onSwitch && <Button variant="plain" onClick={onSwitch}>Use Search</Button>}
      </div>
    </div>
  );
}

// ---------- Describe ----------
function DescribePane({ busy, error, onAnalyze, onSwitch }: { busy: boolean; error: string | null; onAnalyze: (text: string) => void; onSwitch: () => void }) {
  const [text, setText] = useState("");
  const ready = text.trim().length > 1;
  return (
    <div className="flex flex-col gap-4">
      <TextArea label="Meal" placeholder="2 eggs, toast with butter, black coffee" value={text} onChange={(e) => setText(e.target.value)} rows={4} disabled={busy} />
      {busy ? <Analyzing /> : error ? <AiError text={error} onSwitch={onSwitch} /> : null}
      {!busy && (
        <Button variant="primary" size="lg" full disabled={!ready} onClick={() => onAnalyze(text)}>
          Analyze
        </Button>
      )}
    </div>
  );
}

// ---------- Search ----------
function servingText(food: Food): { label: string; grams: number; kcal: number } {
  const s = defaultServing(food);
  return { ...s, kcal: scaleNutrients(food.per100, s.grams).calories };
}

function SearchPane({ draft, onPick, onCreate, onReview }: { draft: Draft | null; onPick: (food: Food) => void; onCreate: () => void; onReview: () => void }) {
  const isDesktop = useIsDesktop();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  const res = useFoodSearch(dq);
  const items = draft?.items.length ?? 0;
  const foods = res.data ?? [];
  return (
    <div className="flex flex-col gap-3 -mx-[var(--gutter)]">
      <div className="px-[var(--gutter)]">
        <TextField placeholder="Search foods" aria-label="Search foods" value={q} onChange={(e) => setQ(e.target.value)} leading={<Icon name="search" size={18} className="text-tertiary" />} enterKeyHint="search" autoCapitalize="none" autoCorrect="off" autoFocus={isDesktop} data-testid="food-search" />
      </div>
      {draft && items > 0 && (
        <Group>
          <Row title={`${plural(items, "item")} in this meal`} subtitle={fmtKcal(draftTotals(draft).calories)} chevron onPress={onReview} trailing={<span className="text-accent-text font-medium">Review</span>} />
        </Group>
      )}
      <div>
        <SectionHeader title={dq ? (res.isFetching && !res.data ? "Searching" : `${foods.length === 30 ? "30+" : foods.length} results`) : "Popular"} />
        {res.isPending ? (
          <Skeleton rows={5} />
        ) : res.isError ? (
          <Empty action={<Button variant="plain" onClick={() => void res.refetch()}>Retry</Button>}>Unable to search foods.</Empty>
        ) : foods.length === 0 ? (
          <Empty action={<Button variant="plain" onClick={onCreate}>Create Food</Button>}>No foods match.</Empty>
        ) : (
          <Group>
            {foods.map((f) => {
              const s = servingText(f);
              return <Row key={f.id} title={f.name} subtitle={f.brand ? `${f.brand} · ${s.label}` : s.label} trailing={fmtKcal(s.kcal)} onPress={() => onPick(f)} data-testid="food-result" />;
            })}
            <Row title={<span className="text-accent-text">Create Food</span>} onPress={onCreate} />
          </Group>
        )}
      </div>
    </div>
  );
}

// ---------- Barcode ----------
type DetectorCtor = new (opts?: { formats?: string[] }) => { detect: (src: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
const detectorCtor = (): DetectorCtor | null => (typeof window !== "undefined" && "BarcodeDetector" in window ? ((window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector) : null);
const canScan = () => Boolean(detectorCtor()) && typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

function BarcodePane({ onFound }: { onFound: (food: Food) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const valid = /^\d{8,14}$/.test(code.trim());

  const stopScan = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };
  useEffect(() => stopScan, []);

  const lookup = async (value: string) => {
    const c = value.trim();
    if (!/^\d{8,14}$/.test(c)) {
      setError("Enter the 8 to 14 digits under the barcode.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onFound(await lookupBarcode(c));
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setError(status === 404 ? "No product for this barcode. Try Search." : status === 429 ? "Too many lookups. Wait a minute and retry." : status === 0 ? "Unable to reach the server. Retry." : "Barcode lookup is unavailable. Retry.");
    } finally {
      setBusy(false);
    }
  };

  const startScan = async () => {
    const Ctor = detectorCtor();
    if (!Ctor) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setScanning(true);
      await new Promise((r) => requestAnimationFrame(r));
      const video = videoRef.current;
      if (!video) return stopScan();
      video.srcObject = stream;
      await video.play();
      const detector = new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
      const tick = async () => {
        if (!streamRef.current) return;
        try {
          const found = await detector.detect(video);
          const hit = found.find((f) => /^\d{8,14}$/.test(f.rawValue));
          if (hit) {
            stopScan();
            setCode(hit.rawValue);
            void lookup(hit.rawValue);
            return;
          }
        } catch {
          /* keep polling */
        }
        window.setTimeout(() => void tick(), 300);
      };
      void tick();
    } catch {
      stopScan();
      setError("Camera access was not granted. Type the code instead.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <TextField label="Barcode" placeholder="0123456789012" inputMode="numeric" autoCapitalize="none" autoCorrect="off" value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setError(null); }} enterKeyHint="search" onKeyDown={(e) => { if (e.key === "Enter") void lookup(code); }} error={error} hint={isNative ? "Type the digits under the barcode." : undefined} />
      {scanning && (
        <div className="relative rounded-md overflow-hidden bg-black">
          <video ref={videoRef} className="w-full max-h-[260px] object-cover" muted playsInline />
          <button type="button" className="absolute top-2 right-2 h-9 px-3 rounded-sm bg-surface text-subhead text-primary" onClick={stopScan}>
            Stop
          </button>
        </div>
      )}
      <Button variant="primary" size="lg" full loading={busy} disabled={!valid} onClick={() => void lookup(code)}>
        Look Up
      </Button>
      {canScan() && !scanning && (
        <Button variant="secondary" size="lg" full leading={<Icon name="camera" size={20} />} onClick={() => void startScan()}>
          Scan with Camera
        </Button>
      )}
    </div>
  );
}

// ---------- Portion ----------
function PortionPane({ food, onAdd }: { food: Food; onAdd: (item: DraftItem) => void }) {
  const servings = useMemo(() => (food.servings.length ? food.servings : [{ label: "100 g", grams: 100 }]), [food]);
  const [serving, setServing] = useState<{ label: string; grams: number } | null>(servings[0] ?? null);
  const [quantity, setQuantity] = useState(1);
  const [grams, setGrams] = useState(servings[0]?.grams ?? 100);
  const n = scaleNutrients(food.per100, grams);

  const chooseServing = (s: { label: string; grams: number } | null) => {
    setServing(s);
    setQuantity(1);
    setGrams(s ? s.grams : 100);
  };
  const setQty = (q: number) => {
    setQuantity(q);
    if (serving) setGrams(Math.round(q * serving.grams * 10) / 10);
  };
  const setG = (g: number) => {
    setServing(null);
    setQuantity(1);
    setGrams(g);
  };

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div>
        <h3 className="text-title-3 text-primary">{food.name}</h3>
        {food.brand && <p className="text-subhead text-secondary mt-0.5">{food.brand}</p>}
      </div>
      <div className="flex gap-2 flex-wrap">
        {servings.map((s) => (
          <TapChip key={s.label} selected={serving?.label === s.label} onSelect={() => chooseServing(s)}>
            {s.label}
          </TapChip>
        ))}
        <TapChip selected={serving === null} onSelect={() => chooseServing(null)}>
          Grams
        </TapChip>
      </div>
      <div className="py-1">
        <Stepper value={grams} onChange={setG} step={5} min={5} max={5000} unit="g" size="lg" label="Grams" />
        <p className="text-footnote text-secondary text-center mt-2 tabular">{serving ? `${serving.label} is ${serving.grams} g` : "Per 100 g"}</p>
      </div>
      {serving && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-body text-primary">Quantity</span>
          <Stepper value={quantity} onChange={setQty} step={0.5} min={0.5} max={50} size="md" className="w-[180px]" label="Quantity" format={(v) => `×${Number(v.toFixed(1))}`} />
        </div>
      )}
      <NutrientSummary n={n} />
      <Button variant="primary" size="lg" full onClick={() => onAdd(draftItemFromFood(food, grams, serving ? quantity : grams, serving ? serving.label : "g", serving ? (quantity === 1 ? serving.label : `${Number(quantity.toFixed(1))} × ${serving.label}`) : `${fmtInt(grams)} g`))} data-testid="add-to-meal">
        Add to Meal
      </Button>
    </div>
  );
}

function NutrientSummary({ n }: { n: Nutrients }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex items-baseline gap-1.5">
        <span className="num text-title-1 text-primary">{fmtInt(n.calories)}</span>
        <span className="text-subhead text-secondary">kcal</span>
      </div>
      <span className="text-footnote text-secondary tabular">{fmtMacros(n)}</span>
    </div>
  );
}

// ---------- Create food ----------
function CreateFoodPane({ onCreated }: { onCreated: (food: Food) => void }) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [per, setPer] = useState({ calories: "", proteinG: "", carbsG: "", fatG: "" });
  const [servingLabel, setServingLabel] = useState("");
  const [servingGrams, setServingGrams] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(",", ".")));
  const ready = name.trim().length > 0 && per.calories.trim() !== "" && !Number.isNaN(num(per.calories));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const sg = num(servingGrams);
      const food = await createFood({
        name: name.trim(),
        brand: brand.trim() || null,
        per100: { calories: num(per.calories), proteinG: num(per.proteinG), carbsG: num(per.carbsG), fatG: num(per.fatG) },
        servings: servingLabel.trim() && sg > 0 ? [{ label: servingLabel.trim(), grams: sg }] : [],
      });
      onCreated(food);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save the food. Retry.");
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof typeof per, label: string, unit: string) => (
    <TextField label={label} inputMode="decimal" placeholder="0" value={per[key]} onChange={(e) => setPer((p) => ({ ...p, [key]: e.target.value }))} trailing={<span className="text-subhead text-secondary">{unit}</span>} />
  );
  return (
    <div className="flex flex-col gap-4 pt-2">
      <TextField label="Name" placeholder="Overnight oats" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <TextField label="Brand" placeholder="Optional" value={brand} onChange={(e) => setBrand(e.target.value)} />
      <h3 className="text-footnote text-secondary pt-1 -mb-1">Per 100 g</h3>
      <div className="grid grid-cols-2 gap-3">
        {field("calories", "Calories", "kcal")}
        {field("proteinG", "Protein", "g")}
        {field("carbsG", "Carbs", "g")}
        {field("fatG", "Fat", "g")}
      </div>
      <h3 className="text-footnote text-secondary pt-1 -mb-1">Serving</h3>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Label" placeholder="1 cup" value={servingLabel} onChange={(e) => setServingLabel(e.target.value)} />
        <TextField label="Weight" placeholder="240" inputMode="decimal" value={servingGrams} onChange={(e) => setServingGrams(e.target.value)} trailing={<span className="text-subhead text-secondary">g</span>} />
      </div>
      {error && <p className="text-footnote text-danger-text">{error}</p>}
      <Button variant="primary" size="lg" full loading={busy} disabled={!ready} onClick={() => void save()}>
        Save Food
      </Button>
    </div>
  );
}

// ---------- Results ----------
function ResultsPane({ draft, setDraft, preview, busy, error, onFix, onLog, onAddItem }: { draft: Draft; setDraft: (f: (d: Draft | null) => Draft | null) => void; preview: string | null; busy: "analyze" | "fix" | "log" | null; error: string | null; onFix: (note: string) => void; onLog: () => void; onAddItem: () => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [fixNote, setFixNote] = useState("");
  const totals = draftTotals(draft);
  const score = scoreLine(totals, draft.healthScore);
  const ai = draft.source === "photo" || draft.source === "text";
  const photo = preview ?? (draft.imagePath ? imageUrl(draft.imagePath) : null);
  const update = (key: string, fn: (it: DraftItem) => DraftItem | null) =>
    setDraft((d) => {
      if (!d) return d;
      const items = d.items.flatMap((it) => {
        if (it.key !== key) return [it];
        const next = fn(it);
        return next ? [next] : [];
      });
      return { ...d, items, healthScore: null };
    });

  return (
    <div className="flex flex-col gap-4 pt-2 -mx-[var(--gutter)]">
      <div className="px-[var(--gutter)] flex items-center gap-3">
        {photo && <img src={photo} alt="" className="w-[72px] h-[72px] rounded-sm object-cover bg-surface-2 shrink-0" />}
        <TextField className="flex-1" placeholder="Meal name" aria-label="Meal name" value={draft.name} onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))} />
      </div>
      <div className="px-[var(--gutter)] flex gap-2">
        {MEAL_TYPES.map((m) => (
          <TapChip key={m.value} selected={draft.mealType === m.value} onSelect={() => setDraft((d) => (d ? { ...d, mealType: m.value } : d))}>
            {m.label}
          </TapChip>
        ))}
      </div>
      <div>
        <SectionHeader title="Items" />
        <Group>
          {draft.items.map((it) => {
            const expanded = openKey === it.key;
            return (
              <Fragment key={it.key}>
                <Row
                  title={it.name}
                  subtitle={
                    <>
                      {it.portion === `${fmtInt(it.grams)} g` ? it.portion : `${it.portion} · ${fmtInt(it.grams)} g`}
                      <br />
                      {fmtMacros(it.nutrients)}
                    </>
                  }
                  trailing={
                    <>
                      <span>{fmtKcal(it.nutrients.calories)}</span>
                      <IconButton label={`Remove ${it.name}`} className="-mr-2 text-tertiary" onClick={(e) => { e.stopPropagation(); update(it.key, () => null); }}>
                        <Icon name="x" size={18} />
                      </IconButton>
                    </>
                  }
                  onPress={() => setOpenKey(expanded ? null : it.key)}
                  aria-expanded={expanded}
                  className={cn(expanded && "bg-selected")}
                />
                {expanded && (
                  <div className="px-[var(--gutter)] py-3 bg-surface">
                    <Stepper value={it.grams} onChange={(g) => update(it.key, (x) => rescaleItem(x, g))} step={5} min={5} max={5000} unit="g" label={`${it.name} grams`} />
                  </div>
                )}
              </Fragment>
            );
          })}
          <Row title={<span className="text-accent-text">Add Item</span>} onPress={onAddItem} />
        </Group>
        {draft.items.length === 0 && <Footnote>No items yet. Add Item.</Footnote>}
      </div>
      {ai && (
        <div className="px-[var(--gutter)]">
          <TextField
            label="Fix Results"
            placeholder="That was 2 eggs, not 3"
            value={fixNote}
            onChange={(e) => setFixNote(e.target.value)}
            enterKeyHint="send"
            disabled={busy === "fix"}
            onKeyDown={(e) => { if (e.key === "Enter" && fixNote.trim()) { onFix(fixNote.trim()); setFixNote(""); } }}
            trailing={
              busy === "fix" ? <Spinner size={16} className="text-secondary" /> : (
                <button type="button" className="text-subhead font-semibold text-accent-text disabled:opacity-40 h-11 -mr-1 px-1" disabled={!fixNote.trim()} onClick={() => { onFix(fixNote.trim()); setFixNote(""); }}>
                  Fix
                </button>
              )
            }
          />
        </div>
      )}
      <div className="px-[var(--gutter)] flex flex-col gap-3">
        <NutrientSummary n={totals} />
        <Group inset={false} className="mx-0">
          <Row title="Health score" subtitle={score.reason} trailing={score.score != null ? <span className="num text-title-3 text-primary">{score.score}</span> : undefined} />
        </Group>
        {draft.notes && <p className="text-footnote text-secondary">{draft.notes}</p>}
        {error && <p className="text-footnote text-danger-text">{error}</p>}
        <Button variant="primary" size="lg" full loading={busy === "log"} disabled={draft.items.length === 0 || busy === "fix"} onClick={onLog} data-testid="log-meal">
          Log Meal
        </Button>
      </div>
    </div>
  );
}
