# Card Structure Optimization

Task: `c5d6d2b4-3887-47ec-a7b8-265132c2b84a`

## Goal

Make Kanban cards look cleaner and easier to scan after the previous compact
metadata pass.

## Visual Findings

The task screenshots show that the current right-side badges still participate in
the title row layout. This squeezes titles into a narrow column, makes the card
feel awkward, and surfaces low-value `links n` metadata where users only need the
task content.

## Product Requirements

- Render `p n` and `deps n` as leading chips in the card's label area instead of
  floating corner badges.
- Remove `=` from the priority badge text.
- Let the title fill the card content width, except normal card padding.
- Do not render `links n`, image count, or document count on the card.
- Keep labels smaller and denser.
- Labels should use at most two rows; when there are more labels than the fixed
  visible count, continue to show a compact `+n` overflow chip.
- Do not force ordinary labels into narrow fixed widths. Only truncate a label
  when the label is wider than the card content itself.

## Technical Design

- Keep the implementation in `web/src/components/TaskCard.tsx`.
- Put priority and dependency chips before task labels in the same wrapping label
  area.
- Remove link-count rendering from cards entirely.
- Keep title clamping with Tailwind's `line-clamp-2`.
- Render at most three task labels plus the `+n` overflow chip in a wrapping
  label area capped to two rows.

## Test Plan

- Update component tests so priority text is `p 3`, not `p=3`.
- Add a test proving priority and dependency metadata render before task labels.
- Add a test proving link-count metadata is absent even when links exist.
- Add a test proving labels render in a two-row-capped wrapping area without
  fixed narrow per-label truncation.
- Run the focused test first and confirm it fails before implementation.
- After implementation, run focused frontend tests, frontend lint/test/build,
  server and CLI Go tests, `scripts/test-skill.sh`, and a real browser smoke
  against the rebuilt embedded web bundle.
