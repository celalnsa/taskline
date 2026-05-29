import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, Task, TaskImage } from "../lib/api";
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

function renderEditor(onClose = vi.fn(), editorTask: Task = task) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <TaskEditor
        project={project}
        task={editorTask}
        allTasks={[editorTask]}
        onClose={onClose}
      />
    </QueryClientProvider>
  );

  return onClose;
}

describe("TaskEditor markdown description editing", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

describe("TaskEditor image attachments", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows existing image attachments", () => {
    const existing: TaskImage = {
      id: "image-1",
      task_id: task.id,
      filename: "before.png",
      mime_type: "image/png",
      size_bytes: 1536,
      uploaded_at: 1780051741142,
    };

    renderEditor(vi.fn(), { ...task, images: [existing] });

    expect(screen.getByText("before.png")).toBeTruthy();
    expect(screen.getByText("before.png").className).toContain("min-w-0");
    expect(screen.getByText("image/png")).toBeTruthy();
    expect(screen.getByText("1.5 KB")).toBeTruthy();
  });

  it("uploads a selected image and appends it to the attachment list", async () => {
    const user = userEvent.setup();
    const uploaded: TaskImage = {
      id: "image-2",
      task_id: task.id,
      filename: "after.png",
      mime_type: "image/png",
      size_bytes: 8,
      uploaded_at: 1780051741143,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(uploaded), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();

    const input = screen.getByLabelText(/image attachment/i);
    const file = new File(["newimage"], "after.png", { type: "image/png" });
    await user.upload(input, file);

    expect(await screen.findByText("after.png")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tasks/task-1/images",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) })
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.body as FormData).get("file")).toBe(file);
  });

  it("rejects non-image files before uploading", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();

    const input = screen.getByLabelText(/image attachment/i);
    const file = new File(["not an image"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("Selected file is not an image.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
