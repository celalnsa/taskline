# Dependency Graph Click Events

Task: `78d47b4c-102d-413e-b937-26969742021d`

## Goal

Separate graph node editing from relationship-chain highlighting so users do not
trigger two different actions with one click.

## Product Requirements

- Single-clicking a task node in the dependency graph opens that task's editor.
- Single-clicking a task node must not select or highlight the dependency chain.
- If a dependency chain is already highlighted, single-clicking a task node
  clears that graph selection while opening the editor.
- Double-clicking a task node selects that task and highlights its dependency
  chain.
- Double-clicking a task node must not also open the task editor.
- Pane click continues to clear graph selection.
- Edge click behavior stays unchanged: clicking an edge selects the relationship
  and exposes the delete control.

## Technical Design

- Keep the change in `web/src/components/GraphView.tsx`.
- Add `onNodeDoubleClick` to the React Flow graph and move node-chain selection
  there.
- Keep `onNodeClick` responsible for opening the editor and clearing existing
  graph selection only.
- Use a short pending-open timer for single-click edit so a native double-click
  can cancel the pending editor open before it fires.
- Clear any pending single-click open when the user double-clicks a node, clicks
  an edge, clicks the pane, or the component unmounts.

## Test Plan

- Update the GraphView React Flow test mock to forward `onNodeDoubleClick`.
- Change the chain-highlight test to use double-click.
- Assert double-click highlights the chain without opening the editor.
- Assert single-click opens the editor and leaves the node unselected.
- Run the focused GraphView test first and confirm it fails before
  implementation.
- After implementation, run focused frontend tests, frontend lint/test/build,
  and a browser smoke against the rebuilt embedded web bundle.
