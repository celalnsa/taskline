# Card Content Overflow Dev Notes

Task: `5b399beb-cc86-4ea8-9a98-9877eab68386`

## Implementation

- Updated `web/src/components/TaskCard.tsx`.
- Removed visible task type text from card content while preserving the existing
  type-specific left border colors.
- Replaced separate `blocked` and `deps: n` metadata with a compact `deps n`
  badge.
- Moved priority, dependency count, and link count into right-side badges near
  the top of the card.
- Added two-line CSS clamping to card titles without mutating the title string.
- Reduced card padding, delete icon size, label chip spacing, and timestamp top
  margin for a denser Kanban layout.

## Tests Added

- `keeps the type accent without rendering redundant type text`
- `renders priority and dependency metadata as compact badges`
- `clamps long titles to two lines`

## TDD Evidence

- Red run: `mise exec -- pnpm --dir web test -- --run src/components/TaskCard.test.tsx`
  failed on the three new assertions:
  - visible `docs` type text was still rendered.
  - `deps 1` was missing because the old UI rendered `blocked` and `deps: 1`.
  - the long title had no `-webkit-line-clamp: 2` style.
- Green run: `mise exec -- pnpm --dir web test src/components/TaskCard.test.tsx`
  passed with `10` tests.

## Divergence

No API, server, CLI, or persisted data changes were needed. The work stayed in
the web component layer as planned.
