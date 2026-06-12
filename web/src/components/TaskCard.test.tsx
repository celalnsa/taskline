import { DndContext } from "@dnd-kit/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../lib/api";
import { TaskCard } from "./TaskCard";

const task: Task = {
  id: "task-1",
  project_id: "project-1",
  title: "Clickable task card",
  description: "",
  type: "feature",
  state: "start",
  priority: 2,
  created_at: 1780051741142,
  updated_at: 1780051741142,
  depends_on: [],
  labels: [],
  links: [],
  images: [],
};

function renderCard(
  onClick = vi.fn(),
  onDelete = vi.fn(),
  cardTask: Task = task,
  isBlocked = false,
  onContextMenu = vi.fn()
) {
  render(
    <DndContext>
      <TaskCard
        task={cardTask}
        isBlocked={isBlocked}
        onClick={onClick}
        onContextMenu={onContextMenu}
      />
    </DndContext>
  );

  return { onClick, onDelete, onContextMenu };
}

describe("TaskCard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens the task editor when clicking the card content", async () => {
    const user = userEvent.setup();
    const { onClick } = renderCard();

    await user.click(screen.getByText("Clickable task card"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not open the editor when the pointer movement becomes a drag", () => {
    const { onClick } = renderCard();
    const card = screen.getByRole("button", { name: /open task clickable task card/i });

    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(card, { clientX: 8, clientY: 0 });

    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not open the editor from a pointerup without a card pointerdown", () => {
    const { onClick } = renderCard();
    const card = screen.getByRole("button", { name: /open task clickable task card/i });

    fireEvent.pointerUp(card, { clientX: 0, clientY: 0 });

    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not render the old edit-only affordance", () => {
    renderCard();

    expect(screen.queryByText(/^edit$/i)).toBeNull();
  });

  it("opens the task context menu on right-click without opening the editor", () => {
    const { onClick, onContextMenu } = renderCard();
    const card = screen.getByRole("button", { name: /open task clickable task card/i });

    fireEvent.contextMenu(card, { clientX: 24, clientY: 36 });

    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders compact label chips with overflow count", () => {
    renderCard(vi.fn(), vi.fn(), {
      ...task,
      labels: ["backend", "ui", "review", "later"],
    });

    expect(screen.getByText("backend")).toBeTruthy();
    expect(screen.getByText("ui")).toBeTruthy();
    expect(screen.getByText("review")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();

    const labelRow = screen.getByText("backend").parentElement;
    const backendChip = screen.getByText("backend").closest("span");

    expect(labelRow?.className).toContain("flex-wrap");
    expect(labelRow?.className).toContain("max-h-[42px]");
    expect(labelRow?.className).toContain("overflow-hidden");
    expect(backendChip?.className).toContain("text-[10px]");
    expect(backendChip?.className).toContain("max-w-full");
    expect(backendChip?.className).not.toContain("max-w-[5rem]");
  });

  it("renders common labels with distinct theme metadata", () => {
    renderCard(vi.fn(), vi.fn(), {
      ...task,
      labels: ["bug", "documentation", "review"],
    });

    const bug = screen.getByText("bug").closest("span");
    const documentation = screen.getByText("documentation").closest("span");
    const review = screen.getByText("review").closest("span");

    expect(bug?.getAttribute("data-label-theme")).toBe("red");
    expect(documentation?.getAttribute("data-label-theme")).toBe("violet");
    expect(review?.getAttribute("data-label-theme")).toBe("amber");
  });

  it("keeps the type accent without rendering redundant type text", () => {
    renderCard(vi.fn(), vi.fn(), {
      ...task,
      type: "docs",
      title: "Update docs",
    });

    const card = screen.getByRole("button", { name: /open task update docs/i });

    expect(screen.queryByText(/^docs$/i)).toBeNull();
    expect(card.className).toContain("border-l-violet-500");
  });

  it("renders priority and dependency metadata as leading label chips", () => {
    renderCard(
      vi.fn(),
      vi.fn(),
      {
        ...task,
        title: "Blocked task with dependencies",
        priority: 48,
        depends_on: ["dep-1"],
        labels: ["backend", "ui", "review", "later"],
        links: [
          {
            id: "link-1",
            task_id: "task-1",
            url: "https://example.com",
            label: "Example",
            created_at: 1780051741142,
          },
          {
            id: "link-2",
            task_id: "task-1",
            url: "https://example.org",
            label: "Example 2",
            created_at: 1780051741142,
          },
        ],
      },
      true
    );

    const priorityBadge = screen.getByText("p 48");
    const dependencyBadge = screen.getByText("deps 1");
    const labelRow = priorityBadge.parentElement;
    const title = screen.getByText("Blocked task with dependencies");
    const titleContainer = title.parentElement?.parentElement;

    expect(priorityBadge).toBeTruthy();
    expect(dependencyBadge).toBeTruthy();
    expect(labelRow?.className).toContain("flex-wrap");
    expect(labelRow?.className).toContain("max-h");
    expect(labelRow?.textContent?.startsWith("p 48deps 1backend")).toBe(true);
    expect(titleContainer?.className).toContain("pr-6");
    expect(titleContainer?.className).not.toContain("pt-2.5");
    expect(title.parentElement?.textContent).toBe("Blocked task with dependencies");
    expect(screen.queryByText("p=48")).toBeNull();
    expect(screen.getByText("deps 1")).toBeTruthy();
    expect(screen.queryByText("blocked")).toBeNull();
    expect(screen.queryByText("deps: 1")).toBeNull();
    expect(screen.queryByText("links 2")).toBeNull();
    expect(screen.queryByText("review")).toBeNull();
    expect(screen.queryByText("later")).toBeNull();
    expect(screen.getByText("+2")).toBeTruthy();
  });

  it("counts priority and dependency chips when deciding hidden labels", () => {
    renderCard(
      vi.fn(),
      vi.fn(),
      {
        ...task,
        title: "Card with more labels than two rows",
        priority: 47,
        depends_on: ["dep-1"],
        labels: ["hooks", "memory", "overflow"],
      },
      false
    );

    const priorityBadge = screen.getByText("p 47");
    const dependencyBadge = screen.getByText("deps 1");
    const labelRow = priorityBadge.parentElement;

    expect(priorityBadge.className).toContain("rounded border px-1 py-0.5 text-[10px] leading-3");
    expect(priorityBadge.className).not.toContain("rounded-full");
    expect(dependencyBadge.className).toContain("rounded border px-1 py-0.5 text-[10px] leading-3");
    expect(dependencyBadge.className).not.toContain("rounded-full");
    expect(screen.getByText("hooks")).toBeTruthy();
    expect(screen.getByText("memory")).toBeTruthy();
    expect(screen.queryByText("overflow")).toBeNull();
    expect(screen.getByText("+1")).toBeTruthy();
    expect(labelRow?.className).toContain("max-h-[42px]");
  });

  it("clamps long titles to two lines", () => {
    const longTitle =
      "This task title is deliberately long enough to wrap beyond two lines in a narrow card";
    renderCard(vi.fn(), vi.fn(), {
      ...task,
      title: longTitle,
    });

    const title = screen.getByText(longTitle);

    expect(title.className).toContain("line-clamp-2");
  });

  it("does not render the old hover delete icon", () => {
    renderCard();

    expect(screen.queryByRole("button", { name: /delete task clickable task card/i })).toBeNull();
  });
});
