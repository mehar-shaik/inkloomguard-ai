---
name: Synthetic Clay Dark
colors:
  surface: '#140f2a'
  surface-dim: '#140f2a'
  surface-bright: '#3a3552'
  surface-container-lowest: '#0f0a25'
  surface-container-low: '#1c1833'
  surface-container: '#201c37'
  surface-container-high: '#2b2642'
  surface-container-highest: '#36314e'
  on-surface: '#e6deff'
  on-surface-variant: '#cbc3d7'
  inverse-surface: '#e6deff'
  inverse-on-surface: '#312d49'
  outline: '#958ea0'
  outline-variant: '#494454'
  surface-tint: '#d0bcff'
  primary: '#d0bcff'
  on-primary: '#3c0091'
  primary-container: '#a078ff'
  on-primary-container: '#340080'
  inverse-primary: '#6d3bd7'
  secondary: '#7bd0ff'
  on-secondary: '#00354a'
  secondary-container: '#00a6e0'
  on-secondary-container: '#00374d'
  tertiary: '#45dfa4'
  on-tertiary: '#003825'
  tertiary-container: '#00a574'
  on-tertiary-container: '#003120'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e9ddff'
  primary-fixed-dim: '#d0bcff'
  on-primary-fixed: '#23005c'
  on-primary-fixed-variant: '#5516be'
  secondary-fixed: '#c4e7ff'
  secondary-fixed-dim: '#7bd0ff'
  on-secondary-fixed: '#001e2c'
  on-secondary-fixed-variant: '#004c69'
  tertiary-fixed: '#68fcbf'
  tertiary-fixed-dim: '#45dfa4'
  on-tertiary-fixed: '#002114'
  on-tertiary-fixed-variant: '#005137'
  background: '#140f2a'
  on-background: '#e6deff'
  surface-variant: '#36314e'
typography:
  display-lg:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.03em
  display-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: 0em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: 0em
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0.01em
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.02em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.01em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2.5rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system establishes an atmospheric, tactile dark-mode experience tailored for high-stakes AI governance, automated content audit, and brand compliance verification. The visual language balances synthetic precision with soft volumetric tactility—termed "Claymorphic Dark."

The aesthetic departs from conventional flat SaaS interfaces by introducing inflated, pillowed surfaces and multi-stop inner reflections. It evokes the feeling of sculpted physical hardware suspended within deep midnight space. The design combines:
- **Claymorphic Volumetrics:** Dual-directional inner highlights (simulating an illuminated top-edge chamfer) paired with ambient drop glows.
- **Deep Midnight Voids:** Multi-tiered obsidian-navy substrates that absorb light while making vibrant status indicators pop.
- **High-Acuity Precision:** Razor-sharp typography and micro-indicators set against soft physical forms, ensuring regulatory auditing remains legible and authoritative.

## Colors

The color architecture is built upon high-contrast luminous accents set against layered midnight foundations.

### Foundations & Surfaces
- **Canvas Base:** `#0a0618` (Primary background void)
- **Substrate Level 1:** `#0e0924` (Outer canvas partitions and navigation docks)
- **Substrate Level 2 (Clay Default):** `#18113c` (Primary card bodies, containers, resting surface)
- **Substrate Level 3 (Clay Raised):** `#1f164d` (Active states, popovers, nested actionable modules)
- **Surface Stroke:** `rgba(147, 112, 219, 0.25)` (Volumetric rim light)

### Accents & Functional Indicators
- **Primary (Electric Violet / Ultraviolet):** `#8b5cf6` default, `#7c3aed` hover/fill. Represents core AI processing, system actions, and primary triggers.
- **Secondary (Neon Cyan):** `#38bdf8`. Denotes automated monitoring, live verification telemetry, and audit passes.
- **Tertiary (Emerald Pulse):** `#34d399`. Marks positive compliance confirmation, verified safety benchmarks, and protected assets.
- **Warning / Alert (Amber):** `#fbbf24`. Highlights compliance friction and risk scores.
- **Critical Violation (Electric Rose):** `#f43f5e`. Highlights policy breaches and non-compliant artifacts.

### Typography & Content
- **Text Primary:** `#f8fafc` (Pristine optical white for maximum legibility against dark voids)
- **Text Secondary / Muted:** `#cbd5e1` (Light lavender-slate for metadata, labels, and secondary context)
- **Text Subdued:** `#94a3b8` (Structural annotations, timestamps, and border anchors)

## Typography

The typographic hierarchy balances structural geometric personality in headlines with ergonomic, hyper-legible body execution and specialized technical data formatting.

- **Headlines (Space Grotesk):** Provides an architectural, futuristic authority. Its geometric apertures bring character to metric panels and audit headers without sacrificing corporate legitimacy.
- **Body & Controls (Plus Jakarta Sans):** Selected for its clear counters and friendly, legible geometry in dark environments. It maintains low visual fatigue over extended review sessions.
- **Technical & Audit Data (JetBrains Mono):** Reserved for compliance rule IDs, policy hashes, tokens, timestamp tracking, and code-level verification logs.

## Layout & Spacing

The layout model implements a fluid 12-column grid designed to accommodate dense audit matrices, real-time scanning streams, and granular policy trees.

### Grid & Density Dynamics
- **Desktop (1200px+):** 12 columns, 24px (`1.5rem`) gutters, 40px (`2.5rem`) outer canvas margins. Maximizes side-by-side verification (e.g., source asset against flagged compliance report).
- **Tablet (768px - 1199px):** 8 columns, 16px (`1rem`) gutters, 24px outer margins. Sidebar docks collapse to icon rails; cards reflow to dual-column stacks.
- **Mobile (<768px):** 4 columns, 16px gutters, 16px outer margins. Clay surfaces convert from horizontal rows to vertically stacked cards.

Vertical rhythmic intervals rely on multiples of `0.5rem` (8px). Larger gaps (`space-xl` / 40px) establish distinct audit sections, while tight internal component padding (`space-xs` and `space-sm`) preserves density within data widgets.

## Elevation & Depth

Visual hierarchy does not rely on typical pure drop shadows; instead, it utilizes dual-directional claymorphic volumetrics:

1. **Card Depth (Extruded Clay):**
   - Outset shadow: `0 12px 32px -4px rgba(0, 0, 0, 0.65), 0 4px 12px -2px rgba(10, 6, 24, 0.8)`
   - Inset rim highlight (top-left): `inset 1px 1px 2px 0px rgba(255, 255, 255, 0.18)`
   - Inset ambient glow (bottom-right): `inset -3px -3px 8px 0px rgba(139, 92, 246, 0.12)`
   - Boundary outline: `1px solid rgba(147, 112, 219, 0.25)`

2. **Sunken Depth (Inset Trays, Input Fields, Progress Slots):**
   - Deep inner shadow: `inset 2px 3px 6px rgba(0, 0, 0, 0.7), inset -1px -1px 2px rgba(147, 112, 219, 0.1)`
   - Outer glow: None. The surface appears sculpted down into `#0a0618`.

3. **Floating Overlays & Popovers:**
   - Multi-layer shadow: `0 24px 48px -8px rgba(0, 0, 0, 0.85), 0 0 24px 2px rgba(139, 92, 246, 0.25)`
   - Inset bevel: `inset 1px 1px 1px 0px rgba(255, 255, 255, 0.3)`

## Shapes

The design uses inflated, softened geometry consistent with smooth clay objects:

- **Standard Containers & Cards (`rounded-lg`):** 16px (1rem) curvature. Softens the perimeter while maintaining crisp boundaries needed for scanning tabular data.
- **Pills & Interactive Controls (`rounded-full`):** Buttons, status badges, and rule tags employ full pill styling to stand out as touchable tactile modules against broader surfaces.
- **Nested Inner Well Shapes (`rounded`):** 8px (0.5rem) radius for secondary inner sections, code blocks, and data readouts nested within cards.

## Components

### Buttons
- **Primary (Clay Violet):** Background `#7c3aed` with top-to-bottom subtle gradient to `#6d28d9`. Outset shadow `0 6px 16px rgba(124, 58, 237, 0.45)`, inset top highlight `inset 0 1px 1px rgba(255, 255, 255, 0.35)`, inset bottom shadow `inset 0 -2px 4px rgba(0, 0, 0, 0.3)`. Text is `#f8fafc` (`label-lg`). Hover shifts translateY(-1px) with boosted outer purple luminescence.
- **Secondary (Clay Midnight):** Background `#1f164d`, border `1px solid rgba(147, 112, 219, 0.35)`, inset top highlight `inset 0 1px 1px rgba(255, 255, 255, 0.15)`. Text is `#cbd5e1`.
- **Tertiary / Ghost:** Borderless, transparent background. Active states evoke a smooth `#18113c` clay extrusion.

### Cards & Compliance Containers
- Background `#18113c` capped with the dual-inset clay rim.
- Hover states on interactive cards interpolate the border to `rgba(139, 92, 246, 0.5)` with an expanded neon ambient bloom.
- Card headers feature Space Grotesk `headline-sm` with optional status chips docked in the top right.

### Input Fields & Search Bars
- Sunken well treatment: Background `#0e0924`, inner shadow `inset 1px 2px 4px rgba(0, 0, 0, 0.6)`.
- Border: `1px solid rgba(147, 112, 219, 0.2)`. Focus transition activates a Neon Cyan (`#38bdf8`) or Violet (`#8b5cf6`) outer rim glow (`0 0 0 3px rgba(56, 189, 248, 0.2)`).
- Input text: `#f8fafc`; placeholder: `#94a3b8`.

### Status Chips & Badges
- Fully rounded pills (`height: 24px` to `28px`).
- **Compliant (Safe):** Background `rgba(52, 211, 153, 0.12)`, border `1px solid rgba(52, 211, 153, 0.35)`, text `#34d399`, accompanied by a solid glowing 6px green indicator pip.
- **AI Scanning / Analyzing:** Background `rgba(56, 189, 248, 0.12)`, border `1px solid rgba(56, 189, 248, 0.35)`, text `#38bdf8`.
- **Violation Flag:** Background `rgba(244, 63, 94, 0.12)`, border `1px solid rgba(244, 63, 94, 0.35)`, text `#f43f5e`.

### Checkboxes & Radios
- Square rounded (6px radius) or circular bases sunken into `#0e0924`.
- Checked state transitions to a raised clay pebble in `#8b5cf6` with a white checkmark icon and concentrated purple glow.

### Lists & Policy Audits
- Modular rows separated by `space-sm` gaps rather than horizontal divider lines.
- Each row functions as an independent shallow clay tile (`#130d2e`) with hover elevation to `#18113c`.