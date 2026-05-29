import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../lib/api";
import { TaskEditor } from "./TaskEditor";

const project: Project = {
  id: "project-1",
  name: "taskline",
  description: "",
  created_at: 1780051741142,
  updated_at: 1780051741142,
};

const task: Task = {
  id: "task-1",
  project_id: project.id,
  title: "Markdown task",
  description: "Initial **markdown**",
  type: "feature",
  state: "start",
  priority: 1,
  created_at: 1780051741142,
  updated_at: 1780051741142,
  depends_on: [],
  links: [],
  images: [],
};

function renderEditor(onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <TaskEditor project={project} task={task} allTasks={[task]} onClose={onClose} />
    </QueryClientProvider>
  );

  return onClose;
}

describe("TaskEditor markdown description editing", () => {
  afterEach(() => cleanup());

  it("opens a markdown editor from the description field", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: /open markdown editor/i }));

    expect(
      await screen.findByRole("dialog", { name: /markdown description editor/i })
    ).toBeTruthy();
    expect(await screen.findByLabelText("Markdown description")).toBeTruthy();
  });

  it("closes the markdown editor before closing the task editor on Escape", async () => {
    const user = userEvent.setup();
    const onClose = renderEditor();

    await user.click(screen.getByRole("button", { name: /open markdown editor/i }));
    await screen.findByRole("dialog", { name: /markdown description editor/i });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: /markdown description editor/i })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("syncs markdown editor changes back to the task description draft", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: /open markdown editor/i }));
    const markdownInput = await screen.findByLabelText("Markdown description");
    await user.clear(markdownInput);
    await user.type(markdownInput, "# Updated description");
    fireEvent.keyDown(window, { key: "Escape" });

    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
      "# Updated description"
    );
  });

  it("focuses the markdown editor and restores focus when it closes", async () => {
    const user = userEvent.setup();
    renderEditor();
    const openButton = screen.getByRole("button", { name: /open markdown editor/i });

    await user.click(openButton);
    const markdownInput = await screen.findByLabelText("Markdown description");

    await waitFor(() => expect(document.activeElement).toBe(markdownInput));

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(document.activeElement).toBe(openButton));
  });
});
