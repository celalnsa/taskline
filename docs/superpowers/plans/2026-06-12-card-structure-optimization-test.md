# Card Structure Optimization Test Report

Task: `c5d6d2b4-3887-47ec-a7b8-265132c2b84a`

## Summary

All checks passed. The only warning observed was Vite's existing large chunk
warning during production builds. The final UI follows the PR comment direction:
`p n` and `deps n` are leading chips in the label area, the label area can wrap
to two rows, and ordinary labels are not forced into narrow fixed widths.

## Automated Checks

- Focused red test:
  `mise exec -- pnpm --dir web test src/components/TaskCard.test.tsx` failed
  before implementation because:
  - the old card still used the prior metadata layout;
  - the old label row was capped to one nowrap row;
  - ordinary labels used fixed narrow truncation;
  - card metadata still rendered `links 2`.
- Focused green test:
  `mise exec -- pnpm --dir web test src/components/TaskCard.test.tsx` passed
  with `10` tests.
- Frontend lint:
  `mise exec -- pnpm --dir web lint` passed.
- Frontend test:
  `mise exec -- pnpm --dir web test` passed with `7` files and `65` tests.
- Frontend build:
  `mise exec -- pnpm --dir web build` passed.
- Server tests:
  `mise exec -- go test ./...` in `server/` passed, including
  `taskline_server/tests` in `55.412s`.
- CLI tests:
  `mise exec -- go test ./...` in `cli/` passed.
- Skill smoke:
  `mise exec -- ./scripts/test-skill.sh` passed.

## Running Binary Smoke

- Rebuilt and restarted the embedded server with
  `mise exec -- ./scripts/start-local.sh`.
- Confirmed `http://127.0.0.1:8787/healthz` returned `{"ok":true}`.
- Confirmed `:8787` listened on `*`.
- Created browser smoke project `card-structure-smoke-1781199114629` on the
  running server.
- Opened `http://127.0.0.1:8787/?project=card-structure-smoke-1781199114629` in
  headless Chrome via CDP and captured a screenshot.
- DOM and layout checks passed:
  - card rendered `p 48` and `deps 1` as the first two label-area chips;
  - card did not render `p=48`, `links 2`, or `deps: 1`;
  - label row used `flex-wrap`, `max-h-[34px]`, and `overflow-hidden`;
  - label row text started with `p 48`, `deps 1`, and the visible task labels;
  - regular label chips used `max-w-full`, not a narrow fixed max width;
  - label row height was `34px`, matching the two-row cap;
  - title stayed outside the metadata row and still used card content width;
  - title still computed `-webkit-line-clamp: 2`.

## PR Comment Revalidation

After the PR comment, the floating corner badge design was replaced with leading
label chips for priority and dependency metadata. The label area now wraps up to
two rows, and normal labels keep natural width unless they exceed the card width.

- Focused test:
  `mise exec -- pnpm --dir web test src/components/TaskCard.test.tsx` passed
  with `10` tests.
- Frontend lint:
  `mise exec -- pnpm --dir web lint` passed.
- Frontend test:
  `mise exec -- pnpm --dir web test` passed with `7` files and `65` tests.
- Frontend build:
  `mise exec -- pnpm --dir web build` passed.
- Rebuilt and restarted the embedded server with
  `mise exec -- ./scripts/start-local.sh`.
- Confirmed `http://127.0.0.1:8787/healthz` returned `{"ok":true}`.
- Headless Chrome smoke confirmed:
  - label row class was
    `mt-1.5 flex max-h-[34px] min-w-0 flex-wrap items-start gap-1 overflow-hidden`;
  - label row text was `p 48deps 1providercodexwebsocket+1`;
  - `links 2`, `p=48`, and `deps: 1` remained absent;
  - a regular label chip had `max-w-full` and did not have `max-w-[5rem]`;
  - label row height was `34px`;
  - title still computed `-webkit-line-clamp: 2`.

## Result

The implementation is ready for review.
