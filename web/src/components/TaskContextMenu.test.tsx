import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../lib/api";
import { TaskContextMenu } from "./TaskContextMenu";

const task: Task = {
  id: "task-1",
  project_id: "project-1",
  title: "Context task",
  description: "",
  type: "feature",
  state: "start",
  priority: 1,
  created_at: 1780051741142,
  updated_at: 1780051741142,
  depends_on: [],
  labels: [],
  links: [],
  images: [],
};

function renderMenu() {
  const onCopy = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();

  render(
    <TaskContextMenu
      task={task}
      position={{ x: 24, y: 32 }}
      onCopy={onCopy}
      onDelete={onDelete}
      onClose={onClose}
    />
  );

  return { onCopy, onDelete, onClose };
}

describe("TaskContextMenu", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("closes on captured scroll events", () => {
    const { onClose } = renderMenu();

    fireEvent.scroll(window);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("confirms before deleting a task", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const { onClose, onDelete } = renderMenu();

    await user.click(screen.getByRole("menuitem", { name: /^delete$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      'Delete task "Context task"? This cascades to dependencies and images.'
    );
    expect(onDelete).toHaveBeenCalledWith(task);
  });
});
