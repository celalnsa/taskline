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

function renderMenu({ onEdit }: { onEdit?: (task: Task) => void } = {}) {
  const onClone = vi.fn();
  const onCopyTaskID = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();

  render(
    <TaskContextMenu
      task={task}
      position={{ x: 24, y: 32 }}
      onClone={onClone}
      onCopyTaskID={onCopyTaskID}
      onDelete={onDelete}
      onEdit={onEdit}
      onClose={onClose}
    />
  );

  return { onClone, onCopyTaskID, onDelete, onClose };
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

  it("renders an optional edit action before clone, copy ID, and delete", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { onClose } = renderMenu({ onEdit });

    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Edit",
      "Clone",
      "Copy task ID",
      "Delete",
    ]);

    await user.click(screen.getByRole("menuitem", { name: /^edit$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(task);
  });

  it("uses separate actions for cloning and copying the task ID", async () => {
    const user = userEvent.setup();
    const { onClone, onCopyTaskID } = renderMenu();

    await user.click(screen.getByRole("menuitem", { name: /^clone$/i }));

    expect(onClone).toHaveBeenCalledWith(task);
    expect(onCopyTaskID).not.toHaveBeenCalled();

    cleanup();
    const next = renderMenu();
    await user.click(screen.getByRole("menuitem", { name: /^copy task id$/i }));

    expect(next.onCopyTaskID).toHaveBeenCalledWith(task);
    expect(next.onClone).not.toHaveBeenCalled();
  });
});
