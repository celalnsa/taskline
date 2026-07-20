import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskEvent } from "../lib/api";
import { TaskHistoryDialog } from "./TaskHistoryDialog";

const task: Task = {
  id: "task-1",
  project_id: "project-1",
  title: "Tracked task",
  description: "",
  type: "feature",
  state: "dev",
  priority: 0,
  labels: [],
  created_at: 1_000,
  updated_at: 2_000,
};

const events: TaskEvent[] = [
  {
    id: "event-2",
    task_id: task.id,
    actor: "agent-a",
    action: "updated",
    summary: "Updated title and description",
    details: {
      changes: {
        title: { before: "Before title", after: "After title" },
        description: {
          before: "Before description",
          after: "After description",
        },
      },
    },
    created_at: 2_000,
  },
  {
    id: "event-1",
    task_id: task.id,
    actor: "web",
    action: "created",
    summary: "Created task",
    details: {},
    created_at: 1_000,
  },
];

describe("TaskHistoryDialog", () => {
  afterEach(cleanup);

  it("shows actors, summaries, exact times, and full field changes", () => {
    render(
      <TaskHistoryDialog
        task={task}
        events={events}
        isLoading={false}
        error={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "History for Tracked task" })).toBeTruthy();
    expect(screen.getByText("agent-a")).toBeTruthy();
    expect(screen.getByText("Updated title and description")).toBeTruthy();
    expect(screen.getByText("Before title")).toBeTruthy();
    expect(screen.getByText("After title")).toBeTruthy();
    expect(screen.getByText("Before description")).toBeTruthy();
    expect(screen.getByText("After description")).toBeTruthy();
    expect(screen.getByText("web")).toBeTruthy();
  });

  it("closes with Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskHistoryDialog
        task={task}
        events={[]}
        isLoading={false}
        error={null}
        onClose={onClose}
      />
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
