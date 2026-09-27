---
name: Obsidian Astral
colors:
  surface: '#10141a'
  surface-dim: '#10141a'
  surface-bright: '#353940'
  surface-container-lowest: '#0a0e14'
  surface-container-low: '#181c22'
  surface-container: '#1c2026'
  surface-container-high: '#262a31'
  surface-container-highest: '#31353c'
  on-surface: '#dfe2eb'
  on-surface-variant: '#d2c5af'
  inverse-surface: '#dfe2eb'
  inverse-on-surface: '#2d3137'
  outline: '#9b8f7c'
  outline-variant: '#4e4635'
  surface-tint: '#f1c04c'
  primary: '#ffcf64'
  on-primary: '#3f2e00'
  primary-container: '#e3b341'
  on-primary-container: '#5f4600'
  inverse-primary: '#795900'
  secondary: '#a2c9ff'
  on-secondary: '#00315c'
  secondary-container: '#0071c7'
  on-secondary-container: '#f0f4ff'
  tertiary: '#b5d9ff'
  on-tertiary: '#003353'
  tertiary-container: '#79c0ff'
  on-tertiary-container: '#004e7b'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdf9e'
  primary-fixed-dim: '#f1c04c'
  on-primary-fixed: '#261a00'
  on-primary-fixed-variant: '#5b4300'
  secondary-fixed: '#d3e4ff'
  secondary-fixed-dim: '#a2c9ff'
  on-secondary-fixed: '#001c38'
  on-secondary-fixed-variant: '#004882'
  tertiary-fixed: '#cee5ff'
  tertiary-fixed-dim: '#96ccff'
  on-tertiary-fixed: '#001d32'
  on-tertiary-fixed-variant: '#004a76'
  background: '#10141a'
  on-background: '#dfe2eb'
  surface-variant: '#31353c'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 2.25rem
    fontWeight: '700'
    lineHeight: 2.75rem
    letterSpacing: -0.025em
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 1.75rem
    fontWeight: '700'
    lineHeight: 2.25rem
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 2rem
    letterSpacing: -0.02em
  headline-sm:
    fontFamily: Inter
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.015em
  body-lg:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: 1.5rem
  body-md:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.375rem
  body-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1.125rem
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
    fontWeight: '500'
    lineHeight: 1.25rem
    letterSpacing: -0.01em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0em
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '600'
    lineHeight: 0.875rem
    letterSpacing: 0.06em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-lg: 1.5rem
  margin: 1rem
  margin-md: 1.5rem
  margin-lg: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system crafts an elite, high-focus environment for engineers, researchers, and open-source architects. It positions repository curation not as passive bookmarking, but as an active knowledge engine and digital armory. The visual language blends the structured discipline of modern terminal tooling with the refined luminosity of aerospace telemetry.

The aesthetic fuses deep-slate dark minimalism with atmospheric electric accents. Dense, information-rich viewports are counterbalanced by razor-sharp spatial delineation, subtle directional borders, and selective photonic luminescence around active star metrics and language signatures. The experience delivers immediate tactical speed, fluid keystroke-first navigation, and an immersive, cockpit-grade digital workspace.

## Colors

The palette operates on calibrated luminescence over deep obsidian strata, eliminating eye strain during prolonged analysis while guaranteeing unambiguous contrast ratios.

- **Primary (`#e3b341` / Astral Gold):** Reserved for stellar actions, favorite flags, milestone thresholds, and active bookmark counts. Provides an instant, warm focal point across dark canvases.
- **Secondary (`#58a6ff` / Celestial Indigo):** Powers operational interactions, active links, filter criteria toggles, branch references, and focused state rings.
- **Tertiary (`#79c0ff` / Radiant Cyan):** Applied to telemetry data, real-time sync pulses, commit diff counters, and subtle gradient terminators.
- **Neutral Core:** Built upon deep obsidian `#0d1117` (Canvas Base), shifting to `#161b22` (Card and Structural Surface), and `#21262d` (Raised Controls and Hover Planes). Structural boundaries utilize crisp, low-glare dividers at `#30363d`.
- **Functional Semantics:** Critical errors (deprecations, broken builds) render in `#f85149`; merges and releases utilize `#3fb950`; security and advisory notices employ `#db61a2`.

## Typography

The type system prioritizes high-density scannability and structural legibility. `Inter` governs human-readable metadata, headlines, and organizational structures with optical tracking adjustments. `JetBrains Mono` governs machine data: commit hashes, semantic version tags, language statistics, file paths, and query syntax tokens.

Numerical data within tables and star counts must strictly employ tabular lining figures (`font-variant-numeric: tabular-nums`) to prevent layout shifts during real-time polling. All monospace tokens run at a reduced baseline scale compared to body text to maintain visual parity in optical height.

## Layout & Spacing

Layout geometry follows an adaptable 12-column grid anchored to an 8px structural and 4px micro-increment rhythm.

- **Desktop (1280px+):** 12-column fluid framework with fixed left utility drawer (64px collapsed, 260px expanded), 24px (`gutter-lg`) gutters, and dynamic horizontal canvas bounding (`margin-lg`).
- **Tablet (768px - 1279px):** 8-column layout with 16px (`gutter`) gutters, collapsing multi-pane visualization graphs into stacked panels with persistent quick-filter headers.
- **Mobile (< 768px):** Single-column stack with 16px lateral padding (`margin`), compact 8px inter-card vertical spacing, and sticky bottom sheets for query refinement and tag clustering.

Internal component composition adheres to tight compact boundaries: 4px for related micro-labels and badges, 8px between discrete metadata groups, and 12px for perimeter padding within cards.

## Elevation & Depth

This design system avoids heavy drop shadows, instead using surface chromatic layering, hairline structural outlines, and subtle glow projections.

- **Base Layer (0dp):** Canvas backdrop (`#0d1117`), flat without elevation.
- **Surface Layer 1 (1dp):** Structural cards, pinned headers, side navigation bars (`#161b22`), enclosed with a 1px continuous border (`#30363d`).
- **Surface Layer 2 (2dp):** Nested code blocks, search inputs, toolbars, and inactive filter pills (`#21262d`), utilizing a 1px border (`#30363d`).
- **Surface Layer 3 (Popovers & Modals - 3dp):** Elevated flyouts and context menus (`#161b22`) bordered with `#484f58`, accompanied by an ambient diffused shadow: `0 16px 32px rgba(1, 4, 9, 0.85)`.
- **Photonic Overlays:** Interactive repository cards on hover generate a directional 1px perimeter highlight via `linear-gradient(135deg, rgba(88, 166, 255, 0.4), rgba(48, 54, 61, 0.4))` and an ambient gold star aura `0 0 16px rgba(227, 179, 65, 0.15)`.

## Shapes

The design uses tight, purposeful radii (`0.25rem` / 4px base) to emphasize efficiency, alignment, and technical utility. 

- **Inputs, Buttons, and Data Cells:** Styled with `0.25rem` corners, creating clean parallel junctions across dense multi-column arrays.
- **Cards and Panels:** Standardized at `rounded-lg` (`0.5rem` / 8px) to soften viewport boundaries without sacrificing grid alignment.
- **Status Indicators & Language Dots:** Full circular geometry (`50%` / 9999px) for clean visual contrast alongside angular UI elements.
- **Filter Tags & Micro Pills:** Standardized at `rounded-lg` (`0.5rem`) to remain compact while preserving click targets.

## Components

### Buttons
- **Primary Action (Star / Sync):** `#21262d` background, 1px border `#30363d`, hover state transforms border to `#e3b341` with text color `#f0f6fc` and a soft `#e3b341` inner aura. Monospaced badge appended for numeric values.
- **Secondary (Inspect / Fork):** Translucent fill (`rgba(240, 246, 252, 0.05)`), 1px border `#30363d`, hover fill `rgba(240, 246, 252, 0.1)`.
- **Electric Accent (Commit / Export):** Solid `#1f6feb` background, text `#ffffff`, border `1px solid rgba(240, 246, 252, 0.1)`, transitioning to `#388bfd` on hover.

### Filter Chips & Language Pills
- **Language Indicator:** Inline flex item featuring an 8px circular dot colored according to ecosystem standards (e.g., `#f1e05a` for JavaScript, `#3178c6` for TypeScript, `#3572A5` for Python), accompanied by `code-sm` text.
- **Topic Chips:** Background `#161b22`, border `1px solid #30363d`, color `#58a6ff`, padding `2px 8px`, border-radius `0.5rem`. Hover state introduces `#1f6feb` background at 15% opacity and crisp `#58a6ff` borders.

### Repository Cards
- **Structure:** Surface background `#161b22`, hairline border `1px solid #30363d`, padding `space-md` to `space-lg`.
- **Header:** Repository owner displayed in `body-sm` (`#8b949e`), slash separator, repository name in `headline-sm` (`#58a6ff`), followed by public/private privacy badge.
- **Body:** Description clamped to two lines (`body-md` in `#c9d1d9`).
- **Footer:** Array of topic chips, language pill, dynamic stargazing counter with active state toggle, and last-updated relative timestamp (`code-sm` in `#8b949e`).

### Input Fields & Search Command Bars
- **Global Omni-Search:** Background `#0d1117`, border `1px solid #30363d`, typography `body-md` in `#c9d1d9`. Contains shortcut hint badge `["⌘", "K"]` in `code-sm` floating right. Focused state produces an immediate `1px solid #58a6ff` ring and subtle `#58a6ff` glow (`0 0 0 3px rgba(88, 166, 255, 0.2)`).

### Selection Controls (Checkboxes & Radios)
- **Checkboxes:** Squared with `2px` radius, sized `16x16px`. Default state is background `#0d1117`, border `1px solid #30363d`. Selected state is background `#1f6feb`, border `#1f6feb`, containing a sharp centered white checkmark icon.

### Data Visualization Panels
- **Graph Nodes & Vault Clusters:** Canvas rendering with `#161b22` base layer, featuring interactive vector vertices linked by `rgba(48, 54, 61, 0.6)` bezier paths. Selected nodes illuminate in `#e3b341` with a localized Gaussian glow filter.
