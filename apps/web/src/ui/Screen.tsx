import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./Button";
import { Icon } from "./Icon";
import { useNavigate } from "react-router";

export interface ScreenProps {
  /** Noun, under 15 characters. */
  title: string;
  subtitle?: ReactNode;
  /** Trailing glyph/text buttons (max two). */
  actions?: ReactNode;
  /** Show a back chevron (nested screens). */
  back?: boolean | string;
  children: ReactNode;
  /** Content rendered under the title row while expanded (e.g. a segmented control or week strip). */
  header?: ReactNode;
  className?: string;
  contentClassName?: string;
  /** Disable the large title; keep only the compact bar. */
  compact?: boolean;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Screen with a large title that collapses into the 44px bar on scroll (crossfade 150ms, hairline appears).
 * The bar background is the canvas with a scroll-edge blur, the single permitted blur.
 */
export function Screen({ title, subtitle, actions, back, children, header, className, contentClassName, compact, scrollRef }: ScreenProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(Boolean(compact));
  const navigate = useNavigate();
  const innerRef = useRef<HTMLDivElement>(null);
  const ref = scrollRef ?? innerRef;

  useEffect(() => {
    if (compact) return;
    const el = sentinel.current;
    const root = ref.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(([e]) => setCollapsed(!(e?.isIntersecting ?? true)), { root, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [compact, ref]);

  const scrollTop = () => ref.current?.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <div className={cn("flex flex-col h-full min-h-0", className)}>
      <div className={cn("shrink-0 relative z-20 pt-[var(--safe-top)] transition-[box-shadow] duration-150", collapsed ? "hairline-b" : "")} style={collapsed ? { background: "color-mix(in oklab, var(--bg-canvas) 82%, transparent)", backdropFilter: "blur(20px) saturate(1.8)", WebkitBackdropFilter: "blur(20px) saturate(1.8)" } : undefined}>
        <div className="h-[var(--topbar-h)] grid grid-cols-[1fr_auto_1fr] items-center px-1">
          <div className="justify-self-start flex items-center">
            {back && (
              <IconButton label="Back" onClick={() => (typeof back === "string" ? navigate(back) : navigate(-1))}>
                <Icon name="chevron-left" size={24} />
              </IconButton>
            )}
          </div>
          <button type="button" onClick={scrollTop} className={cn("text-headline text-primary truncate max-w-[60vw] transition-opacity duration-150", collapsed ? "opacity-100" : "opacity-0 pointer-events-none")} tabIndex={-1}>
            {title}
          </button>
          <div className="justify-self-end flex items-center gap-1 pr-1">{actions}</div>
        </div>
      </div>
      <div ref={ref} className={cn("scroller flex-1 min-h-0 pb-[calc(var(--tabbar-h)+var(--safe-bottom)+24px)] lg:pb-10", contentClassName)}>
        {!compact && (
          <div className="px-[var(--gutter)] pt-1 pb-2">
            <h1 className="text-large-title text-primary leading-[41px]">{title}</h1>
            {subtitle != null && <div className="text-subhead text-secondary mt-0.5">{subtitle}</div>}
            <div ref={sentinel} className="h-px" />
          </div>
        )}
        {header != null && <div className="px-[var(--gutter)] pb-3">{header}</div>}
        {children}
      </div>
    </div>
  );
}
