import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, Task, TaskImage, TaskLink } from "../lib/api";
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

function renderEditor(
  onClose = vi.fn(),
  editorTask: Task = task,
  allTasks: Task[] = [editorTask]
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <TaskEditor
        project={project}
        task={editorTask}
        allTasks={allTasks}
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

describe("TaskEditor links and dependencies", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const activeDep: Task = {
    ...task,
    id: "task-2",
    title: "Active dependency",
    state: "start",
  };
  const doneDep: Task = {
    ...task,
    id: "task-3",
    title: "Done dependency",
    state: "done",
  };

  it("keeps images, links, and dependencies in the requested order", () => {
    const editorTask: Task = {
      ...task,
      depends_on: [activeDep.id],
      links: [
        {
          id: "link-1",
          task_id: task.id,
          url: "https://example.com/spec",
          label: "Spec",
          created_at: 1780051741142,
        },
      ],
    };

    renderEditor(vi.fn(), editorTask, [editorTask, activeDep]);

    const text = document.body.textContent ?? "";
    expect(text.indexOf("Images")).toBeLessThan(text.indexOf("Links"));
    expect(text.indexOf("Links")).toBeLessThan(text.indexOf("Depends"));
  });

  it("adds a dependency immediately when selecting a non-done candidate", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ task_id: task.id, depends_on: activeDep.id }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(vi.fn(), task, [task, activeDep, doneDep]);

    const select = screen.getByLabelText(/add dependency/i);

    expect(screen.queryByRole("option", { name: /done dependency/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /block on/i })).toBeNull();

    await user.selectOptions(select, activeDep.id);

    expect(await screen.findByText("Active dependency")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tasks/task-1/deps",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ depends_on: activeDep.id }),
      })
    );
  });

  it("removes a dependency immediately from the list", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(
      vi.fn(),
      { ...task, depends_on: [activeDep.id] },
      [{ ...task, depends_on: [activeDep.id] }, activeDep]
    );

    await user.click(screen.getByRole("button", { name: /remove dependency active dependency/i }));

    await waitFor(() => expect(screen.queryByText("Active dependency")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tasks/task-1/deps/task-2",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("allows deleting multiple dependencies while previous deletes are pending", async () => {
    const user = userEvent.setup();
    const secondDep: Task = {
      ...task,
      id: "task-4",
      title: "Second dependency",
      state: "start",
    };
    const resolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(
      vi.fn(),
      { ...task, depends_on: [activeDep.id, secondDep.id] },
      [{ ...task, depends_on: [activeDep.id, secondDep.id] }, activeDep, secondDep]
    );

    await user.click(screen.getByRole("button", { name: /remove dependency active dependency/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /remove dependency second dependency/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    for (const resolve of resolvers) {
      resolve(
        new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    await waitFor(() => expect(screen.queryByText("Active dependency")).toBeNull());
    await waitFor(() => expect(screen.queryByText("Second dependency")).toBeNull());
  });

  it("updates links immediately after adding and removing", async () => {
    const user = userEvent.setup();
    const existing: TaskLink = {
      id: "link-1",
      task_id: task.id,
      url: "https://example.com/old",
      label: "Old link",
      created_at: 1780051741142,
    };
    const created: TaskLink = {
      id: "link-2",
      task_id: task.id,
      url: "https://example.com/new",
      label: "New link",
      created_at: 1780051741143,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(created), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(vi.fn(), { ...task, links: [existing] });

    await user.click(screen.getByRole("button", { name: /remove link old link/i }));

    await waitFor(() => expect(screen.queryByText("Old link")).toBeNull());

    await user.type(screen.getByPlaceholderText("https://…"), created.url);
    await user.type(screen.getByPlaceholderText("label (optional)"), created.label);
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(await screen.findByText("New link")).toBeTruthy();
  });
});
