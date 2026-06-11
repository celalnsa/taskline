# Card Structure Optimization Dev Notes

Task: `c5d6d2b4-3887-47ec-a7b8-265132c2b84a`

## Implementation

- Updated `web/src/components/TaskCard.tsx`.
- Moved priority and dependency metadata into leading chips in the label row.
- Changed priority text from `p=n` to `p n`.
- Removed `links n` rendering from task cards.
- Let the title occupy the full card content width by moving badges out of the
  title row.
- Kept the title's `line-clamp-2` behavior.
- Made label chips smaller and changed the label area to wrap up to two rows,
  with overflow hidden and a compact `+n` chip.
- Removed the fixed narrow label width so ordinary labels use their natural
  width and only truncate when wider than the card content.

## Tests Added Or Updated

- Updated the metadata test to expect leading label chips and `p 48`.
- Added coverage that `links 2` is absent even when links exist on the task.
- Extended the label overflow test to assert two-row wrapping classes and no
  fixed narrow label width.

## TDD Evidence

- Red run: `mise exec -- pnpm --dir web test src/components/TaskCard.test.tsx`
  failed because the old card still used floating metadata, the label row was
  capped to one nowrap row, ordinary labels used fixed narrow truncation, and the
  old card still rendered `links 2`.
- Green run: `mise exec -- pnpm --dir web test src/components/TaskCard.test.tsx`
  passed with `10` tests.

## Divergence

No API, model, persistence, or CLI changes were needed. The implementation stayed
inside the web task card component.
