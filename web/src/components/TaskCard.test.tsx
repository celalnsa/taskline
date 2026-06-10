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

function renderCard(onClick = vi.fn(), onDelete = vi.fn(), cardTask: Task = task) {
  render(
    <DndContext>
      <TaskCard task={cardTask} isBlocked={false} onClick={onClick} onDelete={onDelete} />
    </DndContext>
  );

  return { onClick, onDelete };
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

  it("renders compact label chips with overflow count", () => {
    renderCard(vi.fn(), vi.fn(), {
      ...task,
      labels: ["backend", "ui", "review", "later"],
    });

    expect(screen.getByText("backend")).toBeTruthy();
    expect(screen.getByText("ui")).toBeTruthy();
    expect(screen.getByText("review")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
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

  it("deletes from the card icon without opening the editor", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const { onClick, onDelete } = renderCard();

    const deleteButton = screen.getByRole("button", { name: /delete task clickable task card/i });
    await user.click(deleteButton);

    expect(confirm).toHaveBeenCalledWith(
      'Delete task "Clickable task card"? This cascades to dependencies and images.'
    );
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
