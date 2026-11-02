# LifeOS Design Brief: native-grade, not AI-grade

Scope: a personal life dashboard (tasks, calendar, health/nutrition, habits) shipped as a web app and as an iOS app via a WKWebView/Capacitor wrapper. Target quality bar: Things 3, Apple Health, Strong, Notion Calendar, Amie, Linear, Fantastical, Flighty. Every rule below is a decision, not a suggestion. If a rule is not followed, write down why in the PR.

Thesis in one line: the "AI look" is a cluster of unmade decisions (default font, default gradient, default card grid, default copy). The native look is a cluster of made ones: one typeface, one accent, warm neutrals, hairlines instead of shadows, numbers as the hero, motion under 300ms, and copy that says less.

---

## 1. Never do (the AI / vibe-coded tells)

Each item is a documented tell (sources in section 8). Three or more together reads as generated.

Color and surfaces
1. No purple, indigo, or violet accent. No purple-to-blue or pink-to-purple gradients anywhere. (Tailwind's `indigo-500` default is the root cause.)
2. No gradient text (`background-clip: text`) on headings or metrics.
3. No glassmorphism: no `backdrop-filter: blur()` cards, no frosted navbars, no glass panels. (One exception: the scroll-edge effect behind a top bar, section 4.2.)
4. No neon glow, no colored `box-shadow`, no "aurora" or blob backgrounds, no radial halo behind content, no decorative grid-line backgrounds.
5. No cold pure-gray neutrals (`#f3f4f6`, `#6b7280`, `#111827`) on a product that is supposed to feel warm. No pure `#000` canvas either.
6. No large soft drop shadows (`0 10px 30px rgba(0,0,0,.1)`) on cards. No shadow plus hairline border on the same element.
7. No colored left or top border stripe on cards or callouts (the single most-cited tell).
8. No rainbow of unrelated colors. One accent plus the semantic set in section 3.5 is the whole budget.

Typography
9. No Inter as the UI face. No Geist, Space Grotesk, or Instrument Serif either; they are now equally recognizable defaults.
10. No italic serif "accent word" in an otherwise sans headline.
11. No all-caps section labels with wide tracking ("OVERVIEW", "TODAY'S STATS").
12. No tiny eyebrow label repeating the heading beneath it ("TASKS" above "Tasks").
13. No flat hierarchy where title, status, value, and action all sit at similar size and weight.
14. No crushed tracking (`letter-spacing: -0.05em`) on body or small text.
15. No proportional digits in any column, timer, or counter (jittering numbers).

Layout and components
16. No uniform `border-radius: 16px` (or `rounded-2xl`) on everything. No radius over 12px except full circles.
17. No uniform `padding: 24px` on every container. Related things sit closer than unrelated things.
18. No cards inside cards. No "card soup" dashboards where every block is a rounded container.
19. No bento grid of stat tiles. No three identical icon-above-heading feature cards.
20. No sparklines in list rows or stat tiles as decoration.
21. No pulsing status dots, blinking cursors, or auto-scrolling marquees.
22. No emoji as icons, bullets, or in headings. No "stock" thin-line icon next to every label that merely repeats the label.
23. No identical icon buttons in a row with no grouping or hierarchy.
24. No `hover:scale-105` on cards, no bounce or elastic easing on routine actions, no 500ms entrances on things opened many times a day.
25. No missing states. Empty, loading, error, long-text, and large-Dynamic-Type states are part of the component, not follow-ups.
26. No ungated `:hover` styles on touch devices (sticky hover is a web tell on iOS).
27. No `100vh` app shells, no `user-scalable=no`, no inputs under 16px (page zooms on focus).

Copy
28. No "Welcome back, Name" or any greeting. The screen title is the noun ("Today", "Health").
29. No exclamation marks. No "oops", "uh-oh", "yay".
30. No em-dashes in UI text. Use a full stop.
31. No hype words: seamless, effortless, supercharge, unlock, empower, next-generation, all-in-one.
32. No "we" ("We couldn't load..."). No possessives ("Your tasks"). No "Click here".
33. No unproven stat banners or vanity numbers.

---

## 2. Do instead

Color and surfaces
1. One typeface family, one accent color, warm neutrals. About 95% of the UI is neutral; color appears only where it means something (Things 3 reserves yellow for Today, red for deadlines, blue for tags).
2. Depth comes from a one-step change in background lightness, not from shadows (Amie: shadows at 4% and 12% opacity, depth mostly from background difference; Linear: surfaces step up in lightness).
3. Separate things with 1px hairlines at low alpha, aligned to the text's leading edge, not to the row edge.
4. Reserve the accent color for interactive elements and the single primary action per screen (HIG: tint one prominent control, not several).
5. Calendar event colors are soft fills with darker same-hue text, never solid blocks, and never the same hue as the accent (Notion Calendar, Amie).
6. In dark mode use base and elevated surfaces (sheets and popovers one step lighter), and lighten text rather than inverting (HIG Dark Mode).

Typography
7. Use the system font on Apple devices (SF Pro via `system-ui`); it is the strongest native signal available. Use one deliberately chosen Google Font as the non-Apple fallback (section 3.1).
8. Make numbers the hero: large rounded numerals (`ui-rounded` resolves to SF Pro Rounded on Apple), `font-variant-numeric: tabular-nums` everywhere digits align or change.
9. Build hierarchy from the iOS Dynamic Type scale (34/28/22/20/17/16/15/13/12/11) with weight steps (Regular, Medium, Semibold, Bold). Avoid Light and Thin weights entirely (HIG).
10. Scale contrast is large between levels that matter (Notion Calendar runs 64px display against 12px labels) and small between levels that don't.
11. Sentence case for everything except button labels and segment labels, which use Title Case (HIG buttons / segmented controls).
12. Monospaced or tabular digits for times, gates, weights, reps, macros (Flighty, Notion Calendar's time gutter).

Layout and components
13. Default to plain sections with a section header and an inset-grouped list. Use a card only for a self-contained, tappable unit (a meal, a workout). Never nest.
14. One dominant element per screen, at least 1.5x the size or weight of its neighbors.
15. Density matches frequency of use: logging screens are dense and fast; summary screens are calm (Flighty: "one line per flight, essential information only").
16. Progressive disclosure: show the number first, the chart on tap, the raw log on a second tap (Health's Favorites -> detail page).
17. Every tappable thing has a 44x44pt hit region and a visible press state within 100ms (HIG).
18. Radii are small and purposeful: 4 chips, 6 fields, 10 buttons and inset groups, 12 sheets, full for circles.
19. Icons are filled SF-Symbol-style glyphs in tab bars, outline glyphs elsewhere, and only where they carry meaning (navigation, status, repeated actions).
20. Inline expansion over navigation for quick edits (Things 3 expands a task in place).
21. Swipe actions on rows follow iOS conventions: leading swipe = positive (complete), trailing = destructive (delete) plus one neutral action; full swipe commits.
22. Bottom sheets use real detents (medium ~50%, large), a grabber, swipe-to-dismiss, and the iOS sheet curve `cubic-bezier(0.32, 0.72, 0, 1)` at 500ms.
23. Motion is short (100 to 300ms), ease-out by default, on `transform` and `opacity` only, interruptible, and skipped for keyboard-driven repeat actions.
24. Springs use SwiftUI's vocabulary: duration 0.5, bounce 0 to 0.15. Anything above 0.3 bounce is reserved for one celebratory moment.
25. Haptics map to Apple's documented meanings (section 3.8) and are rare enough to be missed when off.
26. Every list and dashboard ships with an empty state that is one sentence plus one action (HIG Writing).

Copy
27. Titles are nouns, buttons are verbs ("Add Meal", "Save", "Done"), labels are the shortest unambiguous word.
28. Errors name the fix, next to the field: "Choose a password with at least 8 characters", not "Invalid password".
29. Numbers carry the message; words add context only when the number cannot ("1,840 kcal", then "260 left").
30. Tone is supportive, specific, and dry (Gentler Streak: "supportive without being cheesy, motivating without fake hype").

---

## 3. Design system

### 3.1 Typeface

Decision: system-first, one family.

```css
:root {
  --font-ui: -apple-system, BlinkMacSystemFont, system-ui, "Host Grotesk", "Segoe UI", Roboto, sans-serif;
  --font-num: ui-rounded, -apple-system, system-ui, "Host Grotesk", sans-serif;   /* hero numbers */
  --font-mono: ui-monospace, "SF Mono", "Geist Mono", Menlo, monospace;            /* timers, codes */
}
```

- On iPhone/iPad/Mac the UI renders in SF Pro, hero numbers in SF Pro Rounded (`ui-rounded` is a CSS generic family that WebKit maps to SF Rounded). This is what Apple Health, Fitness, and Flighty use for gates and countdowns.
- On non-Apple platforms load Host Grotesk from Google Fonts (self-host the WOFF2). It is a near-metric swap for Inter without being Inter, and is not yet on the tell lists. Alternates if you want more character: Schibsted Grotesk (crisper) or Bricolage Grotesque (display only, never body). Do not use Inter, Geist, Space Grotesk, or Instrument Sans/Serif.
- Optional editorial voice for long-form only (journal entries, reflections): Newsreader or Fraunces (both Google Fonts). Never for UI chrome, never as an italic accent word.
- Letter-spacing: when the resolved font is SF (Apple devices) set `letter-spacing: 0`; WebKit already applies SF's size-specific tracking. Apply the tracking column below only when the fallback web font renders (detect with `document.fonts.check` or a `.font-fallback` class). Verify side by side against a native label.

### 3.2 Type scale (px = pt on iOS; line-height in px)

Based on the iOS Dynamic Type "Large" default table and SF Pro tracking table (HIG Typography).

| Token | Size / line | Weight | Tracking (fallback font only) | Use |
|---|---|---|---|---|
| `display-64` | 64 / 68 | 700, `--font-num`, tabular | -0.02em | Single hero metric (today's calories left) |
| `display-44` | 44 / 48 | 700, `--font-num`, tabular | -0.015em | Ring center values, timers |
| `large-title` | 34 / 41 | 700 | +0.40px | Screen title at rest |
| `title-1` | 28 / 34 | 700 | +0.38px | Detail page title, big numbers in rows |
| `title-2` | 22 / 28 | 700 | -0.26px | Section headers on summary screens |
| `title-3` | 20 / 25 | 600 | -0.45px | Group headers, sheet titles |
| `headline` | 17 / 22 | 600 | -0.43px | Row titles, collapsed nav title |
| `body` | 17 / 22 | 400 | -0.43px | Default text, inputs |
| `callout` | 16 / 21 | 400 | -0.31px | Secondary body, input hints |
| `subhead` | 15 / 20 | 400 | -0.23px | Row subtitles, trailing values |
| `footnote` | 13 / 18 | 400 | -0.08px | Section footers, chart axis labels |
| `caption-1` | 12 / 16 | 400 or 500 | 0 | Tags, timestamps, time gutter |
| `caption-2` | 11 / 13 | 400 or 500 | +0.06px | Tab bar labels (500), tiny units |

Rules
- Minimum size 11px, and only for tab labels and units. Nothing interactive uses it.
- Body text contrast 4.5:1 minimum; small custom-colored text 7:1 (HIG Dark Mode).
- Never Light/Thin/Ultralight weights. Rounded face is for numerals only, not for words.
- Units sit beside numbers at two steps smaller and in secondary color: `1,840` (title-1) `kcal` (subhead).
- Set `font-variant-numeric: tabular-nums` on any element whose digits change or align. Use `slashed-zero` nowhere.
- Support Dynamic Type: size tokens are `rem`, root `font-size` follows the wrapper's content size category (Capacitor `TextZoom` plugin or a native-injected CSS variable). Test at the largest accessibility size; rows grow, nothing truncates.

### 3.3 Spacing

4px base. Tokens: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

- Screen gutter: 16px (20px at widths >= 430px). Matches iOS layout margins so content aligns with native bars.
- List row: 44px minimum height, 11px vertical padding for single-line, 12px/16px for two-line, 16px horizontal inset, 12px gap between leading glyph and text.
- Between rows in a group: 0 (hairline separator). Between groups: 24px. Between sections with headers: 32px. Section header to its first row: 8px.
- Sheet content inset: 16px, bottom padding `max(16px, env(safe-area-inset-bottom))`.
- Control internal padding: buttons 12px x 20px, chips 4px x 10px, segmented control track inset 2px.
- Break uniformity on purpose: the hero metric gets 24px above and 8px below; related meta sits 4px under its title.

### 3.4 Radius

| Token | Value | Use |
|---|---|---|
| `r-xs` | 4px | Tags, calendar events, chart bars (top corners only) |
| `r-sm` | 6px | Text fields, steppers, menu items, segmented thumb (7px) |
| `r-md` | 10px | Buttons, inset-grouped lists, keyboard keys |
| `r-lg` | 12px | Sheets (top corners), the rare card, popovers |
| `r-full` | 9999px | Checkbox circle, avatar, pill toggles, progress ring |

Nothing above 12px. Nested elements use a radius 2 to 4px smaller than their container so corners stay concentric. Where Safari 26+ / Chrome 139+ support it, add `corner-shape: superellipse(1.5)` on `r-md` and `r-lg` for Apple-style continuous corners; it degrades to a normal radius elsewhere.

### 3.5 Color tokens

Neutrals are Radix "Sand" (warm gray), which guarantees APCA contrast for steps 11 and 12 on step 2. Semantic colors are Apple system colors (HIG Color spec, June 2025 values), with contrast-safe text variants from Apple's increased-contrast column.

Neutrals, light

| Token | Hex | Role (Radix step) |
|---|---|---|
| `--bg-canvas` | `#F9F9F8` | App background behind groups (sand 2) |
| `--bg-surface` | `#FFFFFF` | Inset groups, sheets, popovers |
| `--bg-surface-2` | `#F1F0EF` | Fields, segmented track, secondary buttons (sand 3) |
| `--bg-pressed` | `#E9E8E6` | Row and button press state (sand 4) |
| `--bg-selected` | `#E2E1DE` | Selected row (sand 5) |
| `--separator` | `rgba(33, 32, 28, 0.10)` | Hairlines (alpha so it works on any surface) |
| `--border-interactive` | `#CFCECA` | Field borders, unchecked checkbox stroke (sand 7) |
| `--border-focus` | `#BCBBB5` | Hovered/stronger border (sand 8) |
| `--text-primary` | `#21201C` | Titles, body (sand 12) |
| `--text-secondary` | `#63635E` | Subtitles, trailing values (sand 11) |
| `--text-tertiary` | `#8D8D86` | Placeholders, disabled, time gutter (sand 9) |
| `--text-quaternary` | `#BCBBB5` | Separator glyphs, unfilled ring track text |

Neutrals, dark

| Token | Hex | Role |
|---|---|---|
| `--bg-canvas` | `#111110` | Base (sandDark 1) |
| `--bg-surface` | `#191918` | Inset groups (sandDark 2) |
| `--bg-elevated` | `#222221` | Sheets, popovers, menus: one step lighter (sandDark 3) |
| `--bg-surface-2` | `#2A2A28` | Fields, segmented track (sandDark 4) |
| `--bg-pressed` | `#31312E` | Press state (sandDark 5) |
| `--bg-selected` | `#3B3A37` | Selected row (sandDark 6) |
| `--separator` | `rgba(238, 238, 236, 0.12)` | Hairlines |
| `--border-interactive` | `#494844` | (sandDark 7) |
| `--border-focus` | `#62605B` | (sandDark 8) |
| `--text-primary` | `#EEEEEC` | (sandDark 12) |
| `--text-secondary` | `#B5B3AD` | (sandDark 11) |
| `--text-tertiary` | `#7C7B74` | (sandDark 10) |
| `--text-quaternary` | `#6F6D66` | (sandDark 9) |

Accent (one). Apple system blue, the native tint; it must not appear in data or calendar colors.

| Token | Light | Dark |
|---|---|---|
| `--accent` | `#0088FF` | `#0091FF` |
| `--accent-text` (on canvas, 4.5:1) | `#1E6EF4` | `#5CB8FF` |
| `--accent-soft` (selected segment bg, today chip) | `#E5F2FF` | `#0E2238` |
| `--on-accent` | `#FFFFFF` | `#FFFFFF` |

Semantic health colors. Three tokens each: `solid` (rings, bars), `text` (labels on canvas), `soft` (tinted background at roughly 10% over surface; tune by eye).

| Metric | Solid light / dark | Text light / dark | Soft light / dark |
|---|---|---|---|
| Energy (calories) | `#FF8D28` / `#FF9230` | `#C55300` / `#FFA056` | `#FFF1E6` / `#2A1C10` |
| Protein | `#34C759` / `#30D158` | `#008932` / `#4AD968` | `#E6F7EA` / `#0F2416` |
| Carbs | `#FFCC00` / `#FFD600` | `#A16A00` / `#FEDF43` | `#FFF6D6` / `#27220F` |
| Fat | `#FF2D55` / `#FF375F` | `#E7124D` / `#FF8AC4` | `#FFE8EE` / `#2B141B` |
| Water | `#00C0E8` / `#3CD3FE` | `#007EAE` / `#6DD9FF` | `#E2F5FB` / `#0E2230` |
| Activity / steps (optional) | `#00C8B3` / `#00DAC3` | `#008575` / `#54DFCB` | `#E0F7F4` / `#0E2622` |
| Sleep (optional) | `#6155F5` / `#6D7CFF` | `#564ADE` / `#A7AAFF` | `#ECEBFE` / `#1A1A33` |

Status (system meanings only; never decorative)

| Token | Light | Dark |
|---|---|---|
| `--danger` (delete, overdue, error) | `#FF383C` | `#FF4245` |
| `--danger-text` | `#E9152D` | `#FF6165` |
| `--success` (completed) | `#34C759` | `#30D158` |
| `--warning` (approaching limit) | `#FF8D28` | `#FF9230` |

Calendar event palette (8, from Notion Calendar's set). Render every event as `background: color-mix(in oklab, var(--cal-x) 16%, var(--bg-surface))`, `color: var(--cal-x)` in light, `color: color-mix(in oklab, var(--cal-x) 70%, white)` in dark. Solid color only for the 3px bar on overlapping events and the current-time line.

| Token | Hex |
|---|---|
| `--cal-blue` | `#2383E2` |
| `--cal-green` | `#0F7B6C` |
| `--cal-yellow` | `#CB912F` |
| `--cal-orange` | `#D9730D` |
| `--cal-red` | `#D44C47` |
| `--cal-pink` | `#C14C8A` |
| `--cal-purple` | `#9065B0` |
| `--cal-gray` (default/untagged) | `#787774` |

Rules
- `--accent` is reserved for interactive state. Health and calendar colors never drive buttons or links.
- Never rely on color alone: pair every metric color with its label or glyph; stacked bars get 1px separators (HIG Charts).
- Provide light and dark for every token even if the app launches in one mode. Use `color-scheme: light dark` on `:root`.
- Set `<meta name="theme-color">` twice (one per `prefers-color-scheme`) to `--bg-canvas`.

### 3.6 Borders and shadows

- Hairline: `box-shadow: 0 0 0 1px var(--separator)` (zero offset, zero blur) or `border-top: 1px solid var(--separator)`. On 2x/3x screens render true hairlines: `@media (min-resolution: 2dppx) { border-width: 0.5px }` and raise the alpha by ~0.03 to compensate for the thinner line.
- Row separators inset to the text's leading edge (16px, or 16 + glyph + 12 when a leading glyph exists), full-bleed only between groups.
- Field borders: 1px `--border-interactive` at rest, 1.5px `--accent` on focus (plus `outline: 2px solid var(--accent-soft)` for keyboard focus).
- Shadows are allowed on exactly three things: popovers and menus `0 4px 12px rgba(0,0,0,0.12)`; a row while being dragged `0 4px 12px rgba(0,0,0,0.15)` with `scale(1.02)`; the segmented-control thumb `0 1px 2px rgba(0,0,0,0.08)`. Sheets get a dimmed backdrop `rgba(0,0,0,0.3)` instead of a shadow.
- No `backdrop-filter` except the top-bar scroll-edge effect (section 4.2), which is native chrome, not a card.

### 3.7 Motion

Durations

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 100ms | `:active` scale/background |
| `--dur-micro` | 150ms | Hover (pointer only), toggles, row removal collapse |
| `--dur-enter` | 200ms | Menus, popovers, inline expand |
| `--dur-exit` | 160ms | Anything leaving (exits are faster than entrances) |
| `--dur-page` | 300ms | Push/pop navigation |
| `--dur-sheet` | 500ms | Bottom sheet open/close (matches iOS) |
| `--dur-ring` | 600ms | Progress ring fill on first appearance only |

Easings

```css
:root {
  --ease-out:    cubic-bezier(0.23, 1, 0.32, 1);     /* default for enter and exit */
  --ease-inout:  cubic-bezier(0.65, 0, 0.35, 1);     /* layout moves, thumb slides */
  --ease-sheet:  cubic-bezier(0.32, 0.72, 0, 1);     /* iOS sheet / drawer curve (Vaul, Ionic) */
}
```

Springs (SwiftUI vocabulary, converted for the web; mass = 1)

| Preset | SwiftUI | stiffness | damping | Framer Motion | Use |
|---|---|---|---|---|---|
| smooth | duration 0.5, bounce 0 | 158 | 25.1 | `{type:'spring', duration:0.5, bounce:0}` | Sheets snapping to detent, segmented thumb |
| snappy | duration 0.5, bounce 0.15 | 158 | 21.4 | `{type:'spring', duration:0.5, bounce:0.15}` | Checkbox check, chip selection, reorder drop |
| iOS default | response 0.5, dampingFraction 0.825 | 158 | 20.7 | `{type:'spring', stiffness:158, damping:20.7}` | Drag release, rubber-band return |
| pop | duration 0.3, bounce 0.25 | 439 | 31.4 | `{type:'spring', duration:0.3, bounce:0.25}` | Checkmark glyph scale 1.2 -> 1.0 |

CSS-only springs via `linear()` (Chrome 113+, Firefox 112+, Safari 17.2+; falls back to the `--ease-out` curve):

```css
:root {
  --spring-snappy: linear(0, 0.038 4%, 0.129 8%, 0.244 12%, 0.367 17%, 0.485 21%, 0.592 25%, 0.685 29%, 0.763 33%, 0.826 38%, 0.876 42%, 0.915 46%, 0.944 50%, 0.966 54%, 0.981 58%, 0.992 62%, 0.998 67%, 1.003 71%, 1.005 75%, 1.006 79%, 1.006 83%, 1.006 88%, 1.005 92%, 1.005 96%, 1);
  --spring-smooth: linear(0, 0.037 4%, 0.123 8%, 0.229 12%, 0.339 17%, 0.444 21%, 0.539 25%, 0.622 29%, 0.693 33%, 0.753 38%, 0.802 42%, 0.843 46%, 0.876 50%, 0.902 54%, 0.923 58%, 0.940 62%, 0.953 67%, 0.963 71%, 0.972 75%, 0.978 79%, 0.983 83%, 0.987 88%, 0.990 92%, 0.992 96%, 1);
  --spring-pop:    linear(0, 0.039 4%, 0.133 8%, 0.256 12%, 0.388 17%, 0.516 21%, 0.633 25%, 0.734 29%, 0.817 33%, 0.884 38%, 0.934 42%, 0.971 46%, 0.997 50%, 1.014 54%, 1.023 58%, 1.028 62%, 1.028 67%, 1.027 71%, 1.024 75%, 1.020 79%, 1.017 83%, 1.013 88%, 1.010 92%, 1.007 96%, 1);
}
/* use with transition-duration 570ms for snappy/smooth, 340ms for pop */
```

Rules
- Animate only `transform` and `opacity`. Height changes use `grid-template-rows: 0fr -> 1fr` or FLIP, never `height`/`padding` transitions.
- Entrances: opacity 0 -> 1 with `translateY(4px)` or `scale(0.96)`; never slide from far away, never `scale(0.75)` on small elements.
- Exits are 20% faster than entrances and never bounce.
- Nothing animates on keyboard-driven repeat actions (typing a number, pressing Enter to add another set).
- Every transition is interruptible (CSS transitions or Framer; no fixed keyframes on interactive elements).
- `@media (prefers-reduced-motion: reduce)`: remove transforms, keep opacity, cap duration at 150ms, disable the ring fill animation.
- Number changes in a row use a 150ms crossfade, not a count-up. The single hero metric may count up once on first load (600ms, ease-out).

### 3.8 Haptic mapping

Apple's documented meanings (HIG Playing haptics): notification = outcome of a task; impact = a physical collision or snap; selection = a value is changing. Use them only this way.

| Action | Haptic | Note |
|---|---|---|
| Check a task / log a set as done | Impact light | Fires at the moment the fill completes (Things 3 plays a light tap) |
| Uncheck | None | |
| Close the last ring / hit daily target / finish workout | Notification success | Once per day per metric; the only "celebration" haptic |
| Stepper tick (+/- on reps, ml, g) | Selection | Each increment, including while held |
| Segmented control change | Selection | |
| Picker wheel / scrubbing a chart across data points | Selection | Per data point, throttled to 1 per 30ms |
| Swipe action crosses full-swipe threshold | Impact medium | Once, when the row commits; none on reveal |
| Sheet snaps to a detent | Impact light | None while dragging |
| Drag-reorder pick up | Impact medium | |
| Drag-reorder drop | Impact light | |
| Long press opens context menu | Impact medium | Together with the menu's 200ms entrance |
| Pull-to-refresh triggers | Impact light | Only if the app has remote sync; local-first screens have no pull-to-refresh |
| Rest timer ends | Notification success + sound | Sound respects silent switch |
| Save failed / invalid input on submit | Notification error | Never on keystroke validation |
| Approaching a limit (e.g. 95% of calorie target when logging) | Notification warning | At most once per session |
| Tab switch, button press, opening a screen, toggles | None | Toggles: let the native `<input type="checkbox" switch>` play the system haptic |

Implementation
- In the wrapper: `@capacitor/haptics` (`impact({style})`, `notification({type})`, `selectionStart/Changed/End`) maps 1:1 to `UIImpactFeedbackGenerator`, `UINotificationFeedbackGenerator`, `UISelectionFeedbackGenerator`.
- In Safari / PWA: `navigator.vibrate` is unsupported on iOS. Fallback is a hidden `<input type="checkbox" switch>` with a `<label>`; a programmatic `label.click()` plays one system tap (Safari 17.4+). Use it for "impact light" only and skip the rest.
- Haptics are a user setting in the app (HIG: make haptics optional).

### 3.9 iOS shell baseline (web)

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F9F9F8">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#111110">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
```

```css
html { -webkit-tap-highlight-color: transparent; -webkit-text-size-adjust: 100%; }
html, body { overscroll-behavior: none; background: var(--bg-canvas); }
.app-shell { min-height: 100dvh; padding-top: env(safe-area-inset-top, 0px); }
.scroller { overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.tab-bar, .sheet { padding-bottom: env(safe-area-inset-bottom, 0px); }
button, [role="button"], a { touch-action: manipulation; }
button, [role="button"], .chip, .tab, .grabber { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
input, textarea, select { font-size: 16px; }            /* prevents focus zoom on iOS */
.carousel { touch-action: pan-y; }  .sheet-handle { touch-action: pan-x; }  .slider { touch-action: none; }
@media (hover: hover) and (pointer: fine) { .row:hover { background: var(--bg-pressed); } }
.row:active, button:active { background: var(--bg-pressed); transition: background 100ms var(--ease-out); }
button:active { transform: scale(0.97); }
```

- Use `100dvh` for shells and bottom-pinned UI, `100svh` for first screens, never `100vh`.
- `overscroll-behavior: none` on the root kills page rubber-banding and pull-to-refresh; `contain` on inner scrollers keeps native bounce inside lists (the native feel) without chaining to the page.
- Inputs: `inputmode="decimal"` for grams/ml/kg, `inputmode="numeric"` for reps, `enterkeyhint="done"` or `"next"`, `autocapitalize="none"` on codes.
- Press feedback on `pointerdown`, never only on `click`.
- Back navigation: support the iOS edge-swipe. In WKWebView enable `allowsBackForwardNavigationGestures` or implement a left-edge pan that pops the route with the page transition at 300ms.
- Long press: `-webkit-touch-callout: none` on rows, then a 400ms pointer hold opens the context menu.
- Test only on hardware (Safari > Develop > device). Emulators miss sticky hover, tap delay, keyboard, safe areas.

---

## 4. Components

### 4.1 Tab bar
- 4 or 5 tabs maximum, single-word labels (Today, Health, Calendar, Tasks, Settings). Tab bar is navigation only; actions go in a toolbar (HIG).
- Height 49px plus `env(safe-area-inset-bottom)`. Icon 25x25 filled glyph above an 11px/500 label (caption-2). Active: `--accent` icon and label. Inactive: `--text-tertiary`.
- Background `--bg-surface` (dark: `--bg-elevated`) with a top hairline. Do not fake iOS 26 Liquid Glass; a flat bar with a hairline reads as deliberate, glass reads as a tell. If the wrapper is native, use a real `UITabBar` and hide the web one.
- Never hide or disable tabs. Tapping the active tab scrolls its view to top (and pops to root if nested).
- Badges only for something critical (an overdue count, not "3 new insights").
- Press state: icon scale 0.92 for 100ms, no color flash.

### 4.2 Large title header
- At rest: `large-title` 34/41/700, left aligned on the 16px gutter, 8px below the status bar area, in a 52px-tall row under a 44px bar. Title is a noun under 15 characters: "Today", "Health", "Calendar". Never the app name, never a greeting, never the user's name.
- On scroll: when the large title's bottom crosses the bar, crossfade to a centered `headline` 17/600 title in the 44px bar over 150ms and show the bar's bottom hairline. Implement with a 1px sentinel and `IntersectionObserver`, or `animation-timeline: scroll()` where supported. Scrolling back to top restores the large title (HIG Toolbars).
- The bar background is `--bg-canvas` with a scroll-edge effect: `backdrop-filter: blur(20px) saturate(1.8)` plus 80% opaque `--bg-canvas`, visible only once content has scrolled under it. This is the single permitted blur.
- Leading: standard back chevron glyph only (no "Back" text). Trailing: at most two glyph buttons, or one text button; the primary action ("Done", "Add") is the only tinted one.
- Date subtitle for Today: `subhead` 15 in `--text-secondary` directly under the title ("Monday 2 November"), not above it.

### 4.3 List rows
- Inset-grouped style: group container `--bg-surface`, radius 10, 16px from the gutter; rows separated by hairlines inset to the text edge; section header `footnote` 13 in `--text-secondary`, sentence case, 8px above the group, 16px left; optional footer `footnote` below.
- Row anatomy: optional 28px leading glyph in a 28x28 tinted rounded-square (radius 7) only in Settings-style lists; title `body` 17 `--text-primary`; subtitle `subhead` 15 `--text-secondary`, max 2 lines; trailing value `subhead` 15 `--text-secondary` tabular; chevron `--text-quaternary` only when the row navigates. An info "i" button only reveals information, never navigates (HIG).
- Min height 44px; press state background `--bg-pressed` on `pointerdown`, cleared 100ms after release; navigation rows stay highlighted until the push completes.
- Swipe actions: trailing reveals Delete (`--danger` bg, white glyph + "Delete") and one neutral action (gray bg); leading reveals Complete (`--success`) or Flag. Reveal threshold 30% of row width; full swipe past 60% commits with an Impact medium and the action button stretches to full width over 150ms. Use the React Aria iOS list example as the reference implementation; buttons are 72px wide, labels `footnote` 13/600.
- Reorder via long-press (400ms) then drag; lifted row gets `scale(1.02)` and the drag shadow; other rows move with the iOS default spring.
- Empty group: one `callout` line in `--text-secondary` plus one `--accent-text` link row ("No meals logged. Add Meal").

### 4.4 Bottom sheet
- Use Vaul (or match its behavior): `--ease-sheet` at 500ms, drag updates `translateY` directly, momentum flick closes, dragging past the top is damped, drag starts only when inner content is scrolled to top, and dragging is blocked for 100ms after reaching top to avoid accidental close.
- Detents: `medium` (50% of viewport) and `large` (full minus `env(safe-area-inset-top) + 8px`). Quick-entry sheets (log water, add task) open at medium; editors open at large. Only one sheet at a time.
- Chrome: top radius 12, background `--bg-surface` (dark: `--bg-elevated`), grabber 36x5 radius 3 in `--border-interactive` centered 8px from the top, 16px content inset. Backdrop `rgba(0,0,0,0.3)` fading in over 200ms. Optional iOS "card stack" effect: scale the page behind to 0.93 with radius 12; off by default, on for large-detent editors.
- Header: Cancel (text button, leading) and Done (prominent, trailing), `headline` 17 title centered. Never Done alone; never Back + Cancel + Done together (HIG Sheets).
- Swipe to dismiss everywhere; if the sheet has unsaved edits, show an action sheet ("Discard Changes" / "Keep Editing") instead of closing.
- Keyboard: listen to `visualViewport` resize and shrink the sheet; the primary button stays above the keyboard.
- Haptic: Impact light on snap to a detent.

### 4.5 Numeric input and steppers
- The number is the hero: value in `display-44` rounded tabular, unit `subhead` beside it in `--text-secondary`. Target or remaining shown underneath in `footnote` ("of 2,100 kcal" / "260 left").
- Stepper: two 44x44 glyph buttons (minus, plus) flanking the value, `--bg-surface-2` fill, radius 10, glyph `--text-primary`. Tap = one increment; hold = repeat starting at 400ms then every 100ms, accelerating 10x after 2s. Selection haptic per tick. Pair with a tappable value that opens direct entry (HIG Steppers: pair with a field when large changes are likely).
- Direct entry: inline `<input inputmode="decimal">` at 16px minimum visual size (render at 28px) with the number pre-selected so typing replaces it. For gym logging, a custom in-sheet keypad (Strong-style, bottom-docked, keys 44px tall, radius 10) is faster than the system keyboard; keep "Next" to jump to the next set and never animate the keypad in.
- Increments per metric: water 50 ml (chips for 250 / 500 / 750), weight 2.5 kg / 5 lb, reps 1, calories 10, grams 5. Chips are `caption-1` 12/500 in `--bg-surface-2`, radius 4.
- Defaults from history: prefill with last-used value (Strong shows previous set as ghost placeholder; MacroFactor saves last serving and quantity so repeat logs take fewer taps). Ghost values use `--text-tertiary` and become real on tap.
- Validation: clamp silently to min/max; show "Choose a value under 10,000" inline only on submit.
- Target: a complete log in 4 actions (MacroFactor's Quick Add benchmark). Count the taps in review.

### 4.6 Progress rings
- Geometry: 100px diameter, 10px stroke, round line caps; 56px with 6px stroke in rows; 160px with 14px stroke as the Today hero. Track = metric color at 12% alpha, fill = metric `solid`. Never a gradient, never a glow.
- Overfill: continue past 100% as a second lap in the metric's `text` shade over the first; label switches to "+120 kcal".
- Center: value `display-44` (or `title-1` in small rings) rounded tabular, label `footnote` sentence case under it ("Protein"), both in `--text-primary` / `--text-secondary`.
- Animation: fill from 0 over 600ms `--ease-out` on first appearance only; later changes animate from the previous value over 300ms. Reduced motion: no fill animation.
- Do not replicate Apple's Activity rings (three concentric, black background, their colors). One ring per metric, or a single hero ring, on `--bg-surface` (HIG forbids re-using the Activity ring design).
- Accessibility: `role="img"` with `aria-label="Protein, 120 of 160 grams"`.

### 4.7 Calendar time grid
- Hour row 60px (Amie), 15-minute snap for create and drag. Time gutter 44px wide, labels `caption-1` 12/500 tabular in `--text-tertiary` right-aligned, hour lines `--separator`, half-hour lines at half alpha or none.
- Day header sticky: weekday `caption-1` uppercase is a tell; use `footnote` "Mon" in `--text-secondary` with the date numeral `title-3` 20/600 below, today's numeral in a 28px `--accent` circle with white text (Fantastical/Apple Calendar).
- Events: fill per section 3.5, radius 4, 2px vertical gap between adjacent events, 1px inner left inset, title `footnote` 13/600, time `caption-1` 12 only when the event is 45 minutes or taller. Overlapping events split width and gain a 3px solid left bar. All-day events in a 24px row above the grid.
- Current time: 2px `--danger` line with an 8px dot in the gutter; the grid auto-scrolls so now sits at 30% from the top on open.
- Interactions: tap empty slot creates a 1-hour draft in place (inline title field, no sheet); drag the body to move, drag the bottom edge to resize, both snapping to 15 minutes with a Selection haptic per snap; long-press opens a context menu (Edit, Duplicate, Delete). Week navigation by horizontal page swipe (`scroll-snap-type: x mandatory`).
- Density control: hide weekends toggle, and a "compact" option that drops the hour row to 44px.
- Tasks with due times appear as 24px chips in the grid in `--cal-gray` fill, checkbox inside.

### 4.8 Task checkbox
- Idle: 22px circle, 1.5px `--border-interactive` stroke, transparent fill, 44x44 hit area, 12px gap to the title. In Today the stroke may be the list's tint (Things uses the list color).
- Check sequence (total ~500ms, Things 3): 0ms Impact light and stroke fills clockwise over 200ms ease-in-out in `--success` (or `--accent`); 200ms a 12px bold white checkmark scales in with the `pop` spring from 0.6 to 1.2 then settles to 1.0 by 350ms; 500ms the row fades to 50% and, in lists that hide completed items, collapses over 150ms. No confetti, no sound by default (optional soft click in settings).
- Uncheck: reverse in 150ms, no haptic, no confirmation.
- Completed rows in the Logbook: filled circle in `--text-quaternary`, title in `--text-secondary` with no strikethrough.
- Keyboard: Space toggles, Enter edits title. Screen reader: `role="checkbox"` with `aria-checked`.

### 4.9 Buttons
- Three styles, nothing else. Primary: filled `--accent`, `--on-accent` label, radius 10, 50px tall full-width in sheets and 44px inline, one per screen. Secondary: `--bg-surface-2` fill, `--text-primary` label. Plain: no fill, `--accent-text` label (this is the default for toolbar and inline actions, like iOS). Destructive: plain style in `--danger-text`, or filled `--danger` only inside confirmation action sheets.
- Label: `headline` 17/600, Title Case, starts with a verb ("Add Meal", "Start Workout", "Save"). Max 3 words. No icons inside text buttons except a leading glyph for Add (+).
- Glyph buttons: 44x44 hit, 22px glyph, `--text-primary` (tinted only when it is the screen's primary action). No circular borders around toolbar glyphs (HIG Toolbars).
- States: press `scale(0.97)` plus 8% darker fill over 100ms on `pointerdown`; disabled at 40% opacity, never hidden; loading replaces the label with a 16px spinner and keeps width.
- Hit regions never below 44x44 even when the visual is smaller (expand with padding or a pseudo-element).

### 4.10 Segmented control
- Use for 2 to 5 closely related views of the same data (D / W / M / Y on a chart; List / Board). Never for top-level navigation and never mixed with a tab bar for the same purpose.
- Track `--bg-surface-2`, radius 9, 2px inset, 32px tall; thumb `--bg-surface` (dark: `--bg-selected`) radius 7 with the thumb shadow from 3.6. Labels `footnote` 13/500 in `--text-secondary`, selected `--text-primary` 13/600. Equal widths; text only or glyphs only, not both; nouns in Title Case.
- Thumb slides with the smooth spring (0.5s, bounce 0) and a Selection haptic. Dragging the thumb across segments is supported (pointer capture).
- Place above the content it controls with 12px gap, inset to the gutter, not full-bleed.

### 4.11 Cards vs plain sections
- Default: plain section = section header + inset-grouped list on `--bg-canvas`. This is 90% of screens.
- Use a card only when all three are true: the content is a single unit, the whole card is tappable, and it needs to sit beside another unit (e.g. two half-width summary tiles on Today for Calories and Water). Max two tiles in a row; never a grid of four or more; never a tile for every metric.
- Card spec: `--bg-surface`, radius 12, 16px padding, hairline edge in dark mode only (light mode gets contrast from the canvas), no shadow, no colored stripe, no icon tile above the heading. Title `subhead` 15/500 in `--text-secondary`, value `title-1` 28/700 tabular, optional trend in `footnote`.
- Cards never contain cards, lists, or charts larger than 48px tall. Anything bigger becomes a section.
- A card with a single number is also an entry point: tapping opens the metric detail page (Health's Favorites).

### 4.12 Charts (minimal)
- One series per chart, in the metric's `solid` color; comparison series in `--text-quaternary`. No gradients under lines, no shadows, no 3D, no legends when the title says what it is.
- Bars: 4px top radius, 40% gap, dynamic Y range so the tallest bar fills the plot (HIG Charts); lower bound 0 for sums (steps, calories), not for rates (heart rate, weight). Lines: 2px, no dots except the selected point.
- Axes: Y labels on the trailing side so the plot aligns to the leading gutter; 2 or 3 horizontal grid lines in `--separator`; X labels `footnote` 13 in `--text-tertiary` at familiar steps (every 5, every 7 days). No axis titles; the unit goes in the chart title or summary.
- Summary row above the plot carries the message: value `title-1` tabular, label `subhead` ("Avg 1,920 kcal", "7 days"). Scrubbing (whole plot is the hit target) swaps this summary, with a Selection haptic per point and a 1px vertical rule; never a floating tooltip card.
- Period switch via segmented control (D W M 6M Y). Animate only on data change, 300ms, and announce the change to assistive tech.
- Target lines: 1px dashed in the metric's `text` color with a `caption-1` label at the trailing end.
- No sparklines in rows. A row shows a number and a delta ("+3%" in `--success`/`--danger-text` with an arrow glyph), not a tiny chart.

### 4.13 Empty, loading, error states
- Empty: `callout` 16 one sentence in `--text-secondary`, centered, 40px from the top of the content area, plus one plain-style action ("Add Task"). No illustration unless commissioned; no mascot; no emoji.
- Loading: skeleton rows (hairline-separated 44px rows with `--bg-surface-2` bars) appear only after 300ms; never a full-screen spinner. Buttons show their inline spinner.
- Error: inline, in place, next to the thing that failed: "Unable to sync. Retry". Never a toast for errors the user can act on in place; never blame ("you entered...").
- Offline: a 28px `--bg-surface-2` strip under the bar reading "Offline. Changes save on this device." in `footnote`.

---

## 5. Microcopy rules

1. Titles are nouns: "Today", "Health", "Workouts". Never "My Health", "Your Day", "Welcome back".
2. Buttons are verbs in Title Case, 1 to 3 words: "Add Meal", "Save", "Start". Segments and labels are nouns in Title Case. Everything else is sentence case.
3. No exclamation marks anywhere, including success states. "Workout saved." not "Workout saved!"
4. No em-dashes or semicolons. Split into two sentences.
5. No emoji in UI text, notifications, or empty states.
6. No "we", "our", "us". "Unable to load meals" not "We couldn't load your meals".
7. No possessives. "Favorites" not "Your Favorites". "Tasks" not "My Tasks".
8. Numbers lead. "1,840 kcal" then "260 left". "12 tasks" not "You have 12 tasks today".
9. Units are lowercase and spaced from the number except percent: "68 kg", "2,100 kcal", "72%", "7h 40m".
10. Dates read like a person says them: "Mon 2 Nov", "Today 14:30", "Tomorrow", "In 3 days". Never "11/02/2026".
11. Empty states: one sentence that says what will appear here plus one action. "No workouts yet. Start Workout." Never explain the feature.
12. Errors name the fix and sit next to the field: "Choose a weight under 500 kg". Never "Invalid input", never "oops".
13. Confirmations only for destructive or irreversible actions, phrased as the action: "Delete Workout" / "Cancel". Never "Are you sure?" as the title; the title is what will happen: "Delete this workout?".
14. Settings labels describe the on state only: "Rest timer starts after each set." Not "Turn on to enable the rest timer, turn off to disable."
15. Encouragement is specific and dry: "3 workouts this week, one more than last week." Never "Amazing job, keep crushing it!"
16. No hype or filler words: seamless, effortless, smart, powerful, supercharge, unlock, insights, journey, wellness.
17. Placeholders show the format, not instructions: "72.5" with unit outside the field; search placeholder "Search foods".
18. Notifications: one line, number first, no greeting: "1,250 kcal logged. 850 left."
19. Consistent verbs across the app: Add (create), Log (record a measurement), Start/Finish (sessions), Delete (remove permanently), Remove (unlink). Keep a word list in `docs/copy/word-list.md`.
20. Keep every string under 40 characters on iPhone; if it wraps to three lines, cut it.

---

## 6. Patterns to steal from the reference apps

- Things 3: 95% neutral UI; color only for Today (yellow), deadlines (red), evening (indigo), tags (blue). 22pt hollow circle checkbox, ~500ms completion choreography with a light haptic, rows slide away after completion. Inline expansion instead of navigation. Custom animation toolkit for everything, nothing decorative.
- Apple Health: two tabs (Summary, Browse). Summary = Favorites (number per metric, tap for detail) then Highlights (two-period comparisons). Numbers at a glance beat stacked charts. Segmented D/W/M/6M/Y above charts, dynamic Y range, trailing-side axis.
- Strong: set rows as a table (previous, kg, reps, check), checkmark completes the set and auto-starts the rest timer, timer docked at the bottom with pause/reset, bottom numeric keypad, ghost values from the last session.
- Notion Calendar: 1px grid at 9% black, 11px monospaced time gutter at 35% black, radius 4/6, soft event fills with darker text, 15-minute snapping, warm off-white surface, hierarchy from type scale only, keyboard-first (n, t, g, /).
- Amie: #FAFAFA warm canvas, shadows at 4% and 12%, body 16/1.75, display tracking -0.5px, 4px grid, 60px hour rows, 15 hues x 9 steps for events, CTA color deliberately outside the event palette, entry animations 0.3s with 0.05s stagger, every panel collapses to zero width.
- Linear: LCH-generated themes from base + accent + contrast, less blue tint in neutrals, darker text in light mode, 13px body for dense work surfaces, translucent 8 to 12% borders, 100/150/250ms motion, 1px hover lift, optimistic UI, single-key shortcuts.
- Fantastical: DayTicker with a magnified center day, tap the title to jump to today, red/white/black palette, panels sized to fit full event names.
- Flighty: airport-board density (one line per item, essential fields only), 15 context states that each show a different field set, monospaced flight numbers and rounded gates, status carried by color plus text, numeric content transitions on a 0.3s spring, "boringly obvious" as the goal.
- Rise: full-screen color washes that shift with time of day, gestures instead of dials. Steal the idea of the Today header tint shifting subtly by time (morning warm, evening cool), nothing else.
- Opal: SF Pro Text with bold headlines, Focus Score as a single hero number instead of raw screen time. Do not steal its gradients.
- Gentler Streak: UIKit conventions plus one illustrated area (Yorhart) at the top of a tab, monthly summary compares you to your own history, sick/injured/break status instead of guilt, "simple views by default, deeper data on demand", copy supportive and dry, 10 languages tested with 15 to 20 local beta users.

---

## 7. Pre-ship audit (run on every screen)

1. Count the colors on screen. More than neutrals + accent + the metric colors present in the data = fail.
2. Count the radii. More than two distinct values on one screen = fail.
3. Find the shadow. If it is not a popover, a dragged row, or a segmented thumb = fail.
4. Find the font. Inter/Geist/Space Grotesk = fail. Letter-spacing on SF = fail.
5. Find the hero. If no element is 1.5x its neighbors, the screen has no hierarchy.
6. Tap everything with a thumb at 1x speed. Any target under 44px or any press without feedback within 100ms = fail.
7. Read every string aloud. Exclamation mark, em-dash, "we", "your", greeting, hype word = fail.
8. Switch to dark mode, Increase Contrast, and the largest Dynamic Type size. Truncation or sub-4.5:1 text = fail.
9. Turn on Reduce Motion. Anything still translating or bouncing = fail.
10. Open the screen with no data, with 500 rows, offline, and mid-sync. Each state must be designed.
11. Time the common action (log water, check a task, add a set). More than 4 taps from Today = fail.
12. Cover the screen and ask: could this be any other productivity app? If yes, the screen has no decisions in it.

---

## 8. Sources

AI / vibe-coded tells
- Spot the Slop: a UI designer's guide to fixing AI defaults (Mania Design): https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/
- AI Design Slop: 16 patterns that mark a site as vibe-coded (Developers Digest): https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it
- The visible tells of AI design (Impeccable catalog): https://www.impeccable.style/slop
- Anti-AI-UI banned-pattern list (GitHub): https://github.com/Vanszs/Anti-AI-UI
- AI slop fonts and gradients (925 Studios): https://www.925studios.co/blog/ai-slop-design-tells
- Does your AI-built app look vibe-coded? Nine signals (The Crit): https://thecrit.co/resources/does-your-ai-built-app-look-vibe-coded
- Can you spot AI-generated UIs? (Qatalyst): https://qatalyst.substack.com/p/can-you-spot-ai-generated-uis-and
- 7 tells that a UI is AI-generated (Fountain Institute): https://pages.thefountaininstitute.com/posts/7-tells-that-a-ui-is-ai-generated
- Vibe-coded UI patterns (Vibemole): https://vibemole.com/examples/vibe-coded-ui-patterns
- Vibe-coded website examples and tells (Ohh Wells): https://www.ohhwells.com/blog/vibe-coded-website
- Why my AI-generated UI looked generic (Alex Lavaee): https://alexlavaee.me/blog/lessons-learned-designing-with-ai/
- Why your AI keeps building the same purple gradient website (Tailwind indigo default): https://scour.ing/@emschwartz/p/https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website
- 10 typefaces to use instead of Inter (Visio Design): https://visiodesign.fi/en/blog/typografia-vaihtoehdot-inter-fontille

Apple Human Interface Guidelines and docs
- Typography (Dynamic Type sizes, tracking tables, weight guidance): https://developer.apple.com/design/human-interface-guidelines/typography
- Writing: https://developer.apple.com/design/human-interface-guidelines/writing
- Playing haptics: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Toolbars (navigation bars, large titles): https://developer.apple.com/design/human-interface-guidelines/toolbars
- Sheets (detents, grabber, Cancel/Done): https://developer.apple.com/design/human-interface-guidelines/sheets
- Layout (44pt targets, safe areas): https://developer.apple.com/design/human-interface-guidelines/layout
- Lists and tables: https://developer.apple.com/design/human-interface-guidelines/lists-and-tables
- Segmented controls: https://developer.apple.com/design/human-interface-guidelines/segmented-controls
- Steppers: https://developer.apple.com/design/human-interface-guidelines/steppers
- Buttons: https://developer.apple.com/design/human-interface-guidelines/buttons
- Charts: https://developer.apple.com/design/human-interface-guidelines/charts
- Activity rings (do not replicate; ring colors): https://developer.apple.com/design/human-interface-guidelines/activity-rings
- Color (system color values, grouped backgrounds, label hierarchy): https://developer.apple.com/design/human-interface-guidelines/color
- Dark Mode (base/elevated, 4.5:1 and 7:1): https://developer.apple.com/design/human-interface-guidelines/dark-mode
- Gestures (standard gesture table): https://developer.apple.com/design/human-interface-guidelines/gestures
- Scroll views (scroll edge effect): https://developer.apple.com/design/human-interface-guidelines/scroll-views
- SwiftUI `spring(response:dampingFraction:)` defaults 0.5 / 0.825: https://developer.apple.com/documentation/swiftui/animation/spring(response:dampingfraction:blendduration:)
- SwiftUI `snappy` (duration 0.5, bounce 0.15): https://developer.apple.com/documentation/swiftui/animation/snappy(duration:extrabounce:)
- SwiftUI `bouncy` (duration 0.5, bounce 0.3): https://developer.apple.com/documentation/swiftui/animation/bouncy(duration:extrabounce:)
- WWDC23 Animate with springs (notes): https://wwdcnotes.com/notes/wwdc23/10158
- WWDC22 Writing for interfaces: https://developer.apple.com/videos/play/wwdc2022-10037

Motion, web-native feel, haptics on the web
- Emil Kowalski, Great animations: https://emilkowal.ski/ui/great-animations
- Emil Kowalski, Building a drawer component (iOS curve, 500ms, drag rules): https://emilkowal.ski/ui/building-a-drawer-component
- Emil Kowalski, mobile-native rules (viewport, safe areas, dvh, touch-action, hover gating): https://www.ui-skills.com/skills/emilkowalski/mobile-native
- Emil Kowalski on ease-out: https://x.com/emilkowalski_/status/1970144111261868487
- CSS `linear()` easing for springs (Chrome Developers): https://developer.chrome.com/docs/css-ui/css-linear-easing-function
- Native overscroll bounce in WebView apps (`contain` vs `none`): https://blog.despia.com/native-overscroll-bounce-in-webview-apps-ios-and-android
- Capacitor Haptics API: https://capacitorjs.com/docs/apis/haptics
- iOS Safari haptics via `<input type="checkbox" switch>`: https://azukiazusa.dev/en/blog/ios-safari-web-haptics and https://www.npmjs.com/package/ios-haptics
- Hairline border via zero-blur box-shadow: https://uxplanet.org/the-css-hairline-border-trick-4c1d7c19dd05
- 1px hairlines on HiDPI screens: https://annualbeta.com/blog/1px-hairline-css-borders-on-hidpi-screens/
- React Aria iOS list with swipe actions: https://react-spectrum.adobe.com/react-aria/examples/ios-list.html
- react-swipe-to-delete-ios (75% full-swipe threshold reference): https://github.com/arnaudambro/react-swipe-to-delete-ios

Color system
- Radix Colors scale semantics (12 steps): https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- Radix Sand light values: https://raw.githubusercontent.com/radix-ui/colors/main/src/light.ts
- Radix Sand dark values: https://raw.githubusercontent.com/radix-ui/colors/main/src/dark.ts
- Linear, How we redesigned the Linear UI (LCH, contrast, Inter Display): https://linear.app/now/how-we-redesigned-the-linear-ui

Reference app analyses
- Things 3 design guide (values are the author's reconstruction): https://blakecrosley.com/guides/design/things
- Things 3 design critique (haptics, uncheck confirmation): https://ixd.prattsi.org/2020/02/design-critique-things-3-ios-app/
- Things features (custom animation toolkit): https://culturedcode.com/things/features/
- Flighty design guide: https://blakecrosley.com/guides/design/flighty
- Flighty, designer's project page (Verena Ortlieb): https://www.verenaortlieb.com/projects/flighty/
- Behind the Design: Flighty (Apple): https://developer.apple.com/news/?id=970ncww4
- Amie design guide: https://blakecrosley.com/guides/design/amie
- Notion Calendar design guide: https://blakecrosley.com/guides/design/notion-calendar
- Linear design guide (values illustrative): https://blakecrosley.com/guides/design/linear
- Apple Health in iOS 13 (MacStories): https://www.macstories.net/?p=60534
- Strong workout tracker teardown: https://screensdesign.com/apps/strong-workout-tracker-gym-log/
- MacroFactor, fastest food logger benchmark (action counts): https://macrofactor.com/fastest-food-logger/
- Fantastical for iPhone review (DayTicker): https://www.macstories.net/reviews/fantastical-for-iphone-review/
- Fantastical DayTicker magnification (Shawn Blanc): https://shawnblanc.net/?p=10988
- Behind the Design: Gentler Streak (Apple): https://developer.apple.com/news/?id=3m0ht22s
- How Gentler Streak brings kindness to fitness (Sketch): https://www.sketch.com/blog/gentler-streak/
- Opal brand kit (SF Pro Text, bold headlines): https://brandkit.opal.so
- Rise alarm clock (color washes, gestures): https://www.protein.xyz/rise/
