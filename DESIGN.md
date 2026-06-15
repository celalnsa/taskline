---
name: taskline
visual_style: wabi-sabi
format: design.md
version: 1
---

# taskline Design System

## Overview

taskline is a compact, operational task board for agents and humans. The web UI follows a Wabi-Sabi direction: quiet paper surfaces, ink-like text, modest edges, muted natural accents, and enough empty space to make dense task data legible without turning the app into a landing page.

The system must preserve fast scanning and repeated action. Kanban columns, graph nodes, editors, labels, and toolbar controls stay compact; the visual refresh improves texture, contrast hierarchy, focus states, and touch targets without hiding work behind decorative chrome.

## Colors

Core CSS tokens live in `web/src/index.css` and are the source of truth for the web UI:

| Token | Value | Use |
| --- | --- | --- |
| `--tl-bg` | `#edf0e8` | App background, stone-sage canvas wash |
| `--tl-bg-quiet` | `#dfe7dc` | Subtle bands and hover rests |
| `--tl-surface` | `#fffaf0` | Sidebar, headers, panels |
| `--tl-surface-muted` | `#e7eadf` | Kanban columns and inset rows |
| `--tl-surface-raised` | `#fffdf6` | Task cards, menus, dialogs |
| `--tl-ink` | `#25221d` | Primary text |
| `--tl-ink-muted` | `#6f675c` | Secondary text |
| `--tl-ink-faint` | `#9a8f80` | Timestamps, disabled hints |
| `--tl-outline` | `#c9cbbd` | Default borders |
| `--tl-outline-strong` | `#9fa890` | Active/hover borders |
| `--tl-primary` | `#6d4f2e` | Primary buttons, selected controls |
| `--tl-primary-hover` | `#553d22` | Primary hover |
| `--tl-moss` | `#526647` | Success/done and natural accent |
| `--tl-indigo` | `#4a5878` | Planning/spec accent |
| `--tl-ochre` | `#a06d25` | Review/waiting accent |
| `--tl-rust` | `#a34f37` | Danger/bug accent |
| `--tl-water` | `#4d7280` | Feature/flow accent |
| `--tl-focus` | `#91704a` | Keyboard focus ring |

Avoid a one-note beige UI by pairing the warm paper base with visible ink, moss, indigo, ochre, rust, and water accents.

## Typography

Use the existing system sans stack for speed and native rendering. Keep board text compact:

| Element | Size | Notes |
| --- | --- | --- |
| Project title | `18px` | Bold, single-line truncate |
| Column title | `12px` | Uppercase, loose but non-negative tracking |
| Task title | `13px` | Medium, two-line clamp |
| Chips/metadata | `10px` | Tabular where numeric |
| Forms | `12px-14px` | Dense but readable |

Letter spacing should be `0` unless a component already relies on Tailwind's uppercase label convention for compact state headers.

## Layout

The app remains an efficient work surface:

- Sidebar width stays `16rem` so project switching is predictable.
- Toolbar controls live in the project title bar.
- Kanban columns keep `min-w-48 max-w-72` and tight gaps.
- Task cards use two-row chip clipping with visible overflow counts.
- Dialogs remain centered and bounded by viewport height.
- Graph nodes remain compact and readable at a glance.

## Elevation & Depth

Use small paper-like shadows instead of glossy panels:

- `--tl-shadow-paper` for task cards and buttons.
- `--tl-shadow-lift` for overlays, menus, and dialogs.
- Borders stay visible; shadows should support hierarchy, not replace outlines.

## Shapes

Use restrained geometry:

- Task cards and controls: `6px` radius.
- Dialogs and major panels: `8px` radius.
- Pills/chips: `4px-9999px` depending on density and text length.
- Avoid decorative blobs, oversized cards, and large hero treatments.

## Components

### App Shell

Use a warm paper canvas with an ink header and selected view control. The sidebar, title bar, and board canvas should feel like one workspace rather than separate floating cards.

### Kanban Columns

Columns are muted paper wells with compact headers, counts, and sort buttons. Drop focus uses moss-colored rings. Card movement must remain fast and unclipped.

### Task Cards

Task cards use raised paper, a left type accent, compact labels, and muted timestamps. Priority and dependency chips must use the same chip geometry as labels while keeping their color meaning.

### Graph

Graph nodes use the same paper vocabulary as cards. Dependency edges use ink for active paths, faint outline for unrelated paths, and rust for destructive selection.

### Dialogs And Menus

Dialogs use raised paper on a translucent ink overlay. Inputs use paper backgrounds and strong focus rings. Menus should be compact, scan-friendly, and close to the triggering interaction.

## Do's and Don'ts

Do:

- Keep data dense and quickly scannable.
- Prefer paper, ink, moss, indigo, ochre, rust, and water accents.
- Use visible focus states on every interactive control.
- Keep controls in the title bar when they are workspace-level actions.
- Use texture sparingly through CSS gradients, not image assets.

Don't:

- Turn taskline into a marketing page or hero layout.
- Inflate card padding, column width, or toolbar height without a workflow reason.
- Use decorative orbs, glossy gradients, or oversized rounded cards.
- Hide overflow labels without the `+N` indicator.
- Encode one-off colors in components when a `--tl-*` token exists.
