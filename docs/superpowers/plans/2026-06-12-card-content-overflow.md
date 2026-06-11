# Card Content Overflow

Task: `5b399beb-cc86-4ea8-9a98-9877eab68386`

## Goal

Make Kanban task cards denser and prevent header metadata from overflowing the
card edge.

## Product Requirements

- Replace the separate `blocked` label and `deps: n` text with a single compact
  `deps n` badge when a task has dependencies.
- Clamp long card titles to two lines and hide overflow with an ellipsis.
- Move `p=n` and `deps n` metadata into compact right-side badges near the top of
  the card.
- Remove visible type text such as `feature`, `bug`, and `docs` from the card
  body because the left border color already communicates task type.
- Slightly reduce card padding, font sizes, and chip spacing so more tasks fit
  on screen.

## Technical Design

- Keep the change in `web/src/components/TaskCard.tsx`.
- Do not change the task API, server model, or CLI contract.
- Preserve the existing left-border type accent classes.
- Use normal text badges for priority and dependency count so tests can assert
  them without layout-specific selectors.
- Use CSS line clamp styles on the title instead of truncating the title string,
  preserving full text for accessibility and task opening labels.

## Test Plan

- Add a component test proving docs/feature type text is no longer rendered while
  the type accent remains.
- Add a component test proving dependency metadata is rendered as `deps n` and
  `blocked` / `deps: n` are not rendered.
- Add a component test proving long titles receive a two-line clamp style.
- Run the focused `TaskCard` test first and confirm the new assertions fail
  before implementation.
- After implementation, run focused frontend tests, frontend lint/test/build,
  Go tests for server and CLI, `scripts/test-skill.sh`, and a browser smoke
  against the rebuilt embedded web bundle.
