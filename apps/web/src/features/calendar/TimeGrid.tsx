import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { format } from "date-fns";
import type { CalEvent, Calendar, Task } from "@aravos/shared";
import { parseDateString, todayString } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { impact, selection } from "@/lib/haptics";
import { fmtTime, fmtMinutes } from "@/lib/format";
import { Checkbox } from "@/ui/Checkbox";
import { Icon } from "@/ui/Icon";
import { SnapPager } from "./SnapPager";
import { GUTTER_WIDTH, HOUR_HEIGHT, MINUTES_PER_DAY, SNAP_MINUTES, clampMinutes, eventColor, isoAt, itemsForDay, minutesAt, minutesOfDate, packColumns, px, snap, swallowNextClick, type DayItem } from "./model";
import { useTaskDrag } from "./taskDrag";

export interface GridHandlers {
  onOpen: (ev: CalEvent) => void;
  onMove: (ev: CalEvent, start: string, end: string) => void;
  onResize: (ev: CalEvent, end: string) => void;
  onCreate: (start: string, end: string, title: string) => void;
  onContext: (ev: CalEvent, point: { x: number; y: number }) => void;
  onToggleTask: (ev: CalEvent, done: boolean) => void;
  onDropTask?: (task: Task, start: string, end: string) => void;
}

export interface TimeGridProps extends GridHandlers {
  days: string[];
  events: CalEvent[];
  calendars: Map<string, Calendar>;
  now: Date;
  /** Mobile: `days` holds [previous, current, next] and the columns page horizontally. */
  pager?: { onPage: (delta: -1 | 1) => void };
  /** Desktop week: sticky weekday header and all-day row inside the scroller. */
  header?: ReactNode;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
}

type Drag =
  | { kind: "move"; ev: CalEvent; dayIdx: number; startMin: number; endMin: number; originMin: number; pointerId: number; lifted: boolean; active: boolean; x: number; y: number; preview: { dayIdx: number; startMin: number; endMin: number } }
  | { kind: "resize"; ev: CalEvent; dayIdx: number; startMin: number; endMin: number; originMin: number; pointerId: number; lifted: boolean; active: boolean; x: number; y: number; preview: { dayIdx: number; startMin: number; endMin: number } };

interface Draft {
  dayIdx: number;
  startMin: number;
  endMin: number;
}

const TOUCH_HOLD_MS = 400;
const MOVE_SLOP = 4;
const EDGE = 40;

function timeRange(date: string, a: number, b: number): string {
  return `${fmtTime(isoAt(date, a))} to ${fmtTime(isoAt(date, b))}`;
}

/**
 * The timeline engine shared by the mobile day pager and the desktop week grid: 60px hours,
 * 44px gutter, 15-minute snapping, column packing for overlaps, tap/drag to create, drag to
 * move, drag the bottom edge to resize, long press for a context menu.
 */
export function TimeGrid({ days, events, calendars, now, pager, header, scrollRef, className, ...h }: TimeGridProps) {
  const innerScroll = useRef<HTMLDivElement>(null);
  const scroller = scrollRef ?? innerScroll;
  const colsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const holdTimer = useRef<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [creating, setCreating] = useState<(Draft & { anchor: number; pointerId: number }) | null>(null);
  const creatingRef = useRef<(Draft & { anchor: number; pointerId: number; active: boolean }) | null>(null);
  const suppressClick = useRef(false);
  const edgeDir = useRef(0);
  const raf = useRef<number | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const today = todayString();
  const nowMin = minutesOfDate(now);
  const taskDrag = useTaskDrag();

  const snapStep = (e: { shiftKey?: boolean }) => (e.shiftKey ? 5 : SNAP_MINUTES);

  const setDragBoth = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // Auto-scroll so now sits 30% from the top on first open.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current) return;
    const el = scroller.current;
    if (!el) return;
    scrolled.current = true;
    const target = Math.max(0, px(nowMin) - el.clientHeight * 0.3);
    el.scrollTop = target;
  }, [scroller, nowMin]);

  /** Minutes from midnight at a viewport y, measured against the columns container. */
  const minutesAtY = useCallback((clientY: number): number => {
    const el = colsRef.current;
    if (!el) return 0;
    return minutesAt(clientY - el.getBoundingClientRect().top);
  }, []);
  const dayIdxAtX = useCallback(
    (clientX: number): number => {
      const el = colsRef.current;
      if (!el || pager) return pager ? 1 : 0;
      const r = el.getBoundingClientRect();
      const w = r.width / days.length;
      return Math.min(days.length - 1, Math.max(0, Math.floor((clientX - r.left) / w)));
    },
    [days.length, pager],
  );

  const stopEdgeScroll = () => {
    edgeDir.current = 0;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
  };
  const tickEdge = useCallback(() => {
    const el = scroller.current;
    if (el && edgeDir.current !== 0) {
      el.scrollTop += edgeDir.current * 6;
      const p = lastPoint.current;
      if (p) applyMove(p.x, p.y, false);
    }
    raf.current = requestAnimationFrame(tickEdge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Scroll the grid while a lifted block is pushed past an edge, only once the pointer is heading that way. */
  const updateEdge = (clientY: number) => {
    const el = scroller.current;
    const d = dragRef.current;
    if (!el || !d || !d.active || d.kind !== "move") {
      edgeDir.current = 0;
      return;
    }
    const r = el.getBoundingClientRect();
    const dir = clientY < r.top + EDGE && clientY < d.y ? -1 : clientY > r.bottom - EDGE && clientY > d.y ? 1 : 0;
    edgeDir.current = dir;
    if (dir !== 0 && raf.current === null) raf.current = requestAnimationFrame(tickEdge);
  };

  const preventTouch = useCallback((e: TouchEvent) => {
    if (dragRef.current?.lifted || creatingRef.current?.active) e.preventDefault();
  }, []);
  useEffect(() => {
    document.addEventListener("touchmove", preventTouch, { passive: false });
    return () => document.removeEventListener("touchmove", preventTouch);
  }, [preventTouch]);

  function applyMove(clientX: number, clientY: number, shift: boolean) {
    const d = dragRef.current;
    if (!d || !d.lifted) return;
    const step = shift ? 5 : SNAP_MINUTES;
    const cur = minutesAtY(clientY);
    const delta = snap(cur - d.originMin, step);
    let preview = d.preview;
    if (d.kind === "move") {
      const dur = d.endMin - d.startMin;
      const startMin = clampMinutes(Math.min(MINUTES_PER_DAY - dur, Math.max(0, d.startMin + delta)));
      const dayIdx = pager ? d.dayIdx : dayIdxAtX(clientX);
      preview = { dayIdx, startMin, endMin: startMin + dur };
    } else {
      const endMin = clampMinutes(Math.max(d.startMin + SNAP_MINUTES, d.endMin + delta));
      preview = { dayIdx: d.dayIdx, startMin: d.startMin, endMin };
    }
    const moved = Math.hypot(clientX - d.x, clientY - d.y) > 3;
    if (preview.startMin !== d.preview.startMin || preview.endMin !== d.preview.endMin || preview.dayIdx !== d.preview.dayIdx) void selection();
    setDragBoth({ ...d, active: d.active || moved, preview });
  }

  const clearHold = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  // ----- block pointer handlers -----
  const onBlockPointerDown = (ev: CalEvent, it: DayItem, dayIdx: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-grid-stop]")) return;
    const el = e.currentTarget;
    const base: Drag = { kind: "move", ev, dayIdx, startMin: it.startMin, endMin: it.endMin, originMin: minutesAtY(e.clientY), pointerId: e.pointerId, lifted: false, active: false, x: e.clientX, y: e.clientY, preview: { dayIdx, startMin: it.startMin, endMin: it.endMin } };
    lastPoint.current = { x: e.clientX, y: e.clientY };
    if (e.pointerType === "mouse") {
      el.setPointerCapture(e.pointerId);
      setDragBoth({ ...base, lifted: true });
      return;
    }
    setDragBoth(base);
    clearHold();
    holdTimer.current = window.setTimeout(() => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* pointer gone */
      }
      void impact("medium");
      setDragBoth({ ...d, lifted: true });
    }, TOUCH_HOLD_MS);
  };

  const onBlockPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    lastPoint.current = { x: e.clientX, y: e.clientY };
    if (!d.lifted) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) {
        clearHold();
        setDragBoth(null);
      }
      return;
    }
    applyMove(e.clientX, e.clientY, e.shiftKey);
    updateEdge(e.clientY);
  };

  const onBlockPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    clearHold();
    stopEdgeScroll();
    if (!d || d.pointerId !== e.pointerId) return;
    setDragBoth(null);
    if (e.pointerType !== "mouse" && d.lifted && !d.active) {
      swallowNextClick();
      h.onContext(d.ev, { x: e.clientX, y: e.clientY });
      return;
    }
    if (!d.lifted || !d.active) {
      h.onOpen(d.ev);
      return;
    }
    const date = days[d.preview.dayIdx] ?? days[d.dayIdx]!;
    const changed = d.preview.startMin !== d.startMin || d.preview.endMin !== d.endMin || d.preview.dayIdx !== d.dayIdx;
    if (!changed) return;
    void impact("light");
    if (d.kind === "move") h.onMove(d.ev, isoAt(date, d.preview.startMin), isoAt(date, d.preview.endMin));
    else h.onResize(d.ev, isoAt(days[d.dayIdx]!, d.preview.endMin));
  };

  const onBlockPointerCancel = () => {
    clearHold();
    stopEdgeScroll();
    setDragBoth(null);
  };

  const onHandlePointerDown = (ev: CalEvent, it: DayItem, dayIdx: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
    lastPoint.current = { x: e.clientX, y: e.clientY };
    setDragBoth({ kind: "resize", ev, dayIdx, startMin: it.startMin, endMin: it.endMin, originMin: minutesAtY(e.clientY), pointerId: e.pointerId, lifted: true, active: false, x: e.clientX, y: e.clientY, preview: { dayIdx, startMin: it.startMin, endMin: it.endMin } });
  };

  // ----- empty space: tap to create, drag to create (mouse) -----
  const onColumnPointerDown = (dayIdx: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-event-block],[data-draft]")) return;
    const anchor = snap(minutesAtY(e.clientY), SNAP_MINUTES, "floor");
    creatingRef.current = { dayIdx, anchor, startMin: anchor, endMin: anchor + SNAP_MINUTES, pointerId: e.pointerId, active: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onColumnPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const c = creatingRef.current;
    if (!c || c.pointerId !== e.pointerId) return;
    const cur = minutesAtY(e.clientY);
    const step = snapStep(e);
    if (!c.active && Math.abs(px(cur - c.anchor)) < MOVE_SLOP) return;
    const a = Math.min(c.anchor, cur);
    const b = Math.max(c.anchor, cur);
    const startMin = clampMinutes(snap(a, step, "floor"));
    const endMin = clampMinutes(Math.max(startMin + step, snap(b, step, "ceil")));
    if (startMin !== c.startMin || endMin !== c.endMin) void selection();
    creatingRef.current = { ...c, active: true, startMin, endMin };
    setCreating({ dayIdx: c.dayIdx, startMin, endMin, anchor: c.anchor, pointerId: c.pointerId });
  };
  const onColumnPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const c = creatingRef.current;
    if (!c || c.pointerId !== e.pointerId) return;
    creatingRef.current = null;
    setCreating(null);
    if (c.active) {
      suppressClick.current = true;
      setDraft({ dayIdx: c.dayIdx, startMin: c.startMin, endMin: c.endMin });
    }
  };
  const onColumnClick = (dayIdx: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest("[data-event-block],[data-draft]")) return;
    const startMin = clampMinutes(snap(minutesAtY(e.clientY), SNAP_MINUTES, "floor"));
    const endMin = Math.min(MINUTES_PER_DAY, startMin + 60);
    setDraft({ dayIdx, startMin, endMin: endMin > startMin ? endMin : MINUTES_PER_DAY });
  };

  // ----- rail task drop (desktop): the rail reports pointer positions through the store -----
  useEffect(() => {
    if (!h.onDropTask) return;
    return taskDrag.register({
      locate: (x, y) => {
        const el = colsRef.current;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
        const dayIdx = dayIdxAtX(x);
        const startMin = clampMinutes(snap(minutesAt(y - r.top), SNAP_MINUTES, "floor"));
        return { date: days[dayIdx]!, dayIdx, startMin };
      },
      drop: (task, date, startMin, duration) => {
        const endMin = Math.min(MINUTES_PER_DAY, startMin + duration);
        h.onDropTask?.(task, isoAt(date, startMin), isoAt(date, endMin));
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join("|"), Boolean(h.onDropTask)]);
  const hover = taskDrag.hover;

  const perDay = useMemo(() => days.map((d) => packColumns(itemsForDay(events, d))), [days, events]);
  const [colWidth, setColWidth] = useState(400);
  useEffect(() => {
    const el = colsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setColWidth(el.clientWidth / (pager ? 1 : days.length)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [days.length, pager]);
  const dense = colWidth < 110;

  const renderColumn = (date: string, dayIdx: number) => {
    const placed = perDay[dayIdx] ?? [];
    const isToday = date === today;
    const ghost = drag && drag.active && drag.kind === "move" && drag.preview.dayIdx === dayIdx ? drag : null;
    const hoverHere = hover && hover.dayIdx === dayIdx && hover.task ? hover : null;
    return (
      <div
        key={date}
        data-day-column
        data-date={date}
        className={cn("relative select-none", !pager && isToday && "bg-accent-soft/30", !pager && dayIdx > 0 && "border-l border-separator")}
        style={{ height: px(MINUTES_PER_DAY) }}
        onPointerDown={onColumnPointerDown(dayIdx)}
        onPointerMove={onColumnPointerMove}
        onPointerUp={onColumnPointerUp}
        onPointerCancel={onColumnPointerUp}
        onClick={onColumnClick(dayIdx)}
      >
        {Array.from({ length: 24 }, (_, hr) => (
          <div key={hr} data-hour={hr} className={cn("absolute left-0 right-0 h-px hairline-t", hr === 0 && "border-transparent")} style={{ top: px(hr * 60) }} />
        ))}
        {placed.map(({ item, col, cols, span }) => {
          const ev = item.ev;
          const isDragging = drag?.ev.id === ev.id;
          const resizing = isDragging && drag?.kind === "resize" ? drag.preview : null;
          const startMin = item.startMin;
          const endMin = resizing ? resizing.endMin : item.endMin;
          return (
            <EventBlock
              key={ev.id}
              item={item}
              startMin={startMin}
              endMin={endMin}
              col={col}
              cols={cols}
              span={span}
              color={eventColor(ev, calendars)}
              dense={dense}
              dim={Boolean(isDragging && drag?.kind === "move" && drag.active)}
              lifted={Boolean(isDragging && drag?.lifted && !drag.active)}
              resizing={Boolean(resizing)}
              date={date}
              onPointerDown={onBlockPointerDown(ev, item, dayIdx)}
              onPointerMove={onBlockPointerMove}
              onPointerUp={onBlockPointerUp}
              onPointerCancel={onBlockPointerCancel}
              onHandlePointerDown={onHandlePointerDown(ev, item, dayIdx)}
              onContextMenu={(e) => {
                // Always prevented: Chromium cancels the pointer on a touch hold otherwise.
                e.preventDefault();
                if (dragRef.current && dragRef.current.pointerId !== -1 && e.nativeEvent.button !== 2) return; // touch hold: handled on pointerup
                clearHold();
                setDragBoth(null);
                h.onContext(ev, { x: e.clientX, y: e.clientY });
              }}
              onOpen={() => h.onOpen(ev)}
              onToggleTask={(done) => h.onToggleTask(ev, done)}
            />
          );
        })}
        {ghost && (
          <div className="absolute left-0.5 right-0.5 rounded-[8px] cal-fill cal-block shadow-drag z-20 pointer-events-none pl-2 pr-1.5 py-[3px] overflow-hidden" style={{ top: px(ghost.preview.startMin) + 1, height: Math.max(16, px(ghost.preview.endMin - ghost.preview.startMin) - 2), ["--cal-color" as string]: eventColor(ghost.ev, calendars), transform: "scale(1.02)" }} data-drag-ghost>
            <div className="text-[13px] font-medium leading-4 truncate">{ghost.ev.title}</div>
            <div className="text-[11px] leading-4 tabular opacity-70">{timeRange(date, ghost.preview.startMin, ghost.preview.endMin)}</div>
          </div>
        )}
        {creating && creating.dayIdx === dayIdx && (
          <div className="absolute left-0.5 right-0.5 rounded-[8px] bg-accent-soft border border-accent/60 z-10 pointer-events-none px-2 py-[3px]" style={{ top: px(creating.startMin) + 1, height: Math.max(16, px(creating.endMin - creating.startMin) - 2) }}>
            <div className="text-[11px] leading-4 tabular text-accent-text">{timeRange(date, creating.startMin, creating.endMin)}</div>
          </div>
        )}
        {draft && draft.dayIdx === dayIdx && (
          <DraftBlock
            key={`${date}-${draft.startMin}`}
            startMin={draft.startMin}
            endMin={draft.endMin}
            date={date}
            onSave={(title) => {
              setDraft(null);
              h.onCreate(isoAt(date, draft.startMin), isoAt(date, draft.endMin), title);
            }}
            onCancel={() => setDraft(null)}
          />
        )}
        {hoverHere && hoverHere.task && (
          <div className="absolute left-0.5 right-0.5 rounded-[8px] cal-fill cal-block-box z-10 pointer-events-none px-2 py-[3px] overflow-hidden" style={{ top: px(hoverHere.startMin) + 1, height: Math.max(16, px(hoverHere.duration) - 2), ["--cal-color" as string]: "var(--cal-graphite)" }}>
            <div className="text-[13px] font-medium leading-4 truncate">{hoverHere.task.title}</div>
            <div className="text-[11px] leading-4 tabular opacity-70">{timeRange(date, hoverHere.startMin, hoverHere.startMin + hoverHere.duration)}</div>
          </div>
        )}
        {isToday && (
          <div className="absolute left-0 right-0 z-30 pointer-events-none" style={{ top: px(nowMin) - 0.5 }} data-now-line>
            <div className="h-px bg-accent" />
            <div className="absolute -top-[2.5px] -left-[3px] w-1.5 h-1.5 rounded-full bg-accent" />
          </div>
        )}
      </div>
    );
  };

  const gutter = (
    <div className="absolute left-0 top-0 bottom-0 pointer-events-none" style={{ width: GUTTER_WIDTH }} aria-hidden="true">
      {Array.from({ length: 23 }, (_, i) => i + 1).map((hr) => {
        const hideForNow = days.includes(today) && Math.abs(hr * 60 - nowMin) < 18;
        return (
          <div key={hr} data-gutter-hour={hr} className={cn("absolute right-2 text-[11px] tabular text-tertiary leading-4 -translate-y-1/2 transition-opacity duration-150", hideForNow && "opacity-0")} style={{ top: px(hr * 60) }}>
            {fmtTime(isoAt(days[0]!, hr * 60))}
          </div>
        );
      })}
      {days.includes(today) && (
        <div className="cal-now-chip absolute right-1 h-[18px] px-[5px] rounded-full text-[10.5px] font-medium tabular leading-[18px] -translate-y-1/2" style={{ top: px(nowMin) }}>
          {format(now, "HH:mm")}
        </div>
      )}
    </div>
  );

  // Sticky header height feeds scroll-padding so scrollIntoView never parks a block beneath it.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [header]);

  return (
    <div ref={scroller} className={cn("scroller flex-1 min-h-0 relative", className)} data-time-grid style={{ scrollPaddingTop: headerH ? headerH + 4 : undefined }}>
      {header != null && <div ref={headerRef} className="sticky top-0 z-30">{header}</div>}
      <div className="relative" style={{ height: px(MINUTES_PER_DAY) + 24, paddingTop: 8 }}>
        <div className="absolute inset-x-0 top-2 bottom-4">
          {gutter}
          <div ref={colsRef} className="absolute top-0 bottom-0 right-0 h-full" style={{ left: GUTTER_WIDTH }}>
            {pager ? (
              <SnapPager className="h-full" disabled={Boolean(drag?.lifted)} onPage={pager.onPage} render={(offset) => renderColumn(days[offset + 1]!, offset + 1)} />
            ) : (
              <div className="grid h-full" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
                {days.map((d, i) => renderColumn(d, i))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface BlockProps {
  item: DayItem;
  startMin: number;
  endMin: number;
  col: number;
  cols: number;
  span: number;
  color: string;
  dense: boolean;
  dim: boolean;
  lifted: boolean;
  resizing: boolean;
  date: string;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onHandlePointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggleTask: (done: boolean) => void;
  onOpen: () => void;
}

function EventBlock({ item, startMin, endMin, col, cols, span, color, dense, dim, lifted, resizing, date, onToggleTask, onHandlePointerDown, onOpen, ...rest }: BlockProps) {
  const ev = item.ev;
  const dur = endMin - startMin;
  const height = Math.max(16, px(dur) - 2);
  const timebox = ev.kind === "timebox";
  const done = timebox && ev.taskStatus === "done";
  const widthPct = (100 / cols) * span;
  const leftPct = (100 / cols) * col;
  const style: CSSProperties = {
    top: px(startMin) + (item.continuesBefore ? 0 : 1),
    height,
    left: `calc(${leftPct}% + ${col === 0 ? 2 : 1}px)`,
    width: `calc(${widthPct}% - ${col + span === cols ? 3 : 2}px)`,
    ["--cal-color" as string]: color,
  };
  const showTime = dur >= 45 && !dense;
  const compact = dur < 30;
  const showCheckbox = timebox && !compact && !(dense && cols > 1);
  return (
    <div
      data-event-block
      data-event-id={ev.id}
      data-kind={ev.kind}
      role="button"
      tabIndex={0}
      aria-label={`${ev.title}, ${timeRange(date, startMin, endMin)}`}
      className={cn("absolute rounded-[8px] cal-fill z-10 cursor-pointer select-none", timebox ? "cal-block-box" : "cal-block", lifted && "shadow-drag scale-[1.02] z-20", dim && "opacity-40", done && "opacity-45", resizing && "z-20", !lifted && "transition-[opacity,transform] duration-150")}
      style={{ ...style, WebkitTouchCallout: "none" } as CSSProperties}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
        }
      }}
      {...rest}
    >
      <div className={cn("flex items-start gap-1 h-full overflow-hidden", compact ? "pl-2 pr-1.5 py-0" : "pl-2 pr-1.5 py-[3px]", showCheckbox && "pl-[30px]", dense && "pl-1.5 pr-1", dense && showCheckbox && "pl-[26px]")}>
        {showCheckbox && (
          <span data-grid-stop className="absolute left-0 top-0 bottom-0 w-8 overflow-hidden flex items-start justify-center pt-[5px]" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={done} onChange={onToggleTask} size={16} label={`Complete ${ev.title}`} tint={color} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className={cn("text-[13px] font-medium truncate", compact ? "leading-[14px]" : "leading-4", done && "line-through decoration-1")}>{ev.title}</div>
          {showTime && (
            <div className="text-[11px] leading-4 tabular opacity-70 truncate">
              {timeRange(date, startMin, endMin)}
              {ev.location ? ` · ${ev.location}` : ""}
            </div>
          )}
        </div>
        {timebox && !compact && !dense && ev.locked && <Icon name="lock" size={12} className="shrink-0 opacity-70 mt-0.5" />}
        {timebox && !compact && !dense && <span className="shrink-0 text-[11px] leading-4 tabular opacity-70">{fmtMinutes(dur)}</span>}
      </div>
      {!item.continuesAfter && (
        <div data-grid-stop data-resize-handle className="absolute left-0 right-0 -bottom-1 h-3 cursor-ns-resize touch-none flex items-end justify-center" onPointerDown={onHandlePointerDown} onClick={(e) => e.stopPropagation()}>
          <span className={cn("w-6 h-[3px] rounded-full mb-[3px] transition-opacity duration-150", resizing ? "opacity-70" : "opacity-0")} style={{ background: color }} />
        </div>
      )}
    </div>
  );
}

function DraftBlock({ startMin, endMin, date, onSave, onCancel }: { startMin: number; endMin: number; date: string; onSave: (title: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const done = useRef(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const t = title.trim();
    if (t) onSave(t);
    else onCancel();
  };
  return (
    <div data-draft className="absolute left-0.5 right-0.5 rounded-[8px] bg-accent-soft z-20 px-2 py-[3px] overflow-hidden" style={{ top: px(startMin) + 1, height: Math.max(26, px(endMin - startMin) - 2), boxShadow: "inset 0 0 0 1px var(--accent)" }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New event"
        aria-label="Event title"
        enterKeyHint="done"
        className="w-full bg-transparent outline-none font-medium text-primary placeholder:text-tertiary"
        style={{ fontSize: 16, lineHeight: "18px" }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
        onBlur={commit}
      />
      <div className="text-[11px] leading-4 tabular text-accent-text mt-0.5">{timeRange(date, startMin, endMin)}</div>
    </div>
  );
}

/**
 * Weekday header for the week grid: small weekday above the numeral. Today is an ink pill,
 * the selected day a white well pill, matching the week strip.
 */
export function DayHeader({ days, selected, onSelect }: { days: string[]; selected?: string; onSelect?: (d: string) => void }) {
  const today = todayString();
  return (
    <div className="grid py-1.5" style={{ gridTemplateColumns: `${GUTTER_WIDTH}px repeat(${days.length}, minmax(0, 1fr))` }}>
      <div />
      {days.map((d) => {
        const isToday = d === today;
        const isSel = selected === d && !isToday;
        const dt = parseDateString(d);
        return (
          <button key={d} type="button" onClick={() => onSelect?.(d)} className={cn("flex justify-center min-h-[52px]", onSelect && "active:opacity-70")} aria-label={format(dt, "EEEE d MMMM")} aria-current={isToday ? "date" : undefined}>
            <span className={cn("flex flex-col items-center justify-center gap-0.5 w-full max-w-[46px] h-[52px] rounded-full transition-colors duration-150", isToday && "bg-primary text-canvas", isSel && "well shadow-thumb")}>
              <span className={cn("text-[11px] leading-[13px]", isToday ? "opacity-70" : "text-tertiary")}>{format(dt, "EEE")}</span>
              <span className={cn("text-[16px] leading-5 tabular", !isToday && "text-primary")}>{dt.getDate()}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
