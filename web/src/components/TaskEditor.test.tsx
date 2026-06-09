import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, Task, TaskDoc, TaskImage, TaskLink } from "../lib/api";
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

function renderCreateEditor(onClose = vi.fn(), allTasks: Task[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <TaskEditor
        project={project}
        allTasks={allTasks}
        onClose={onClose}
        mode="create"
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

describe("TaskEditor create attachments", () => {
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

  it("keeps image, link, and dependency controls enabled in create mode", () => {
    renderCreateEditor(vi.fn(), [activeDep]);

    expect((screen.getByLabelText(/image attachment/i) as HTMLInputElement).disabled).toBe(
      false
    );
    expect((screen.getByPlaceholderText("https://…") as HTMLInputElement).disabled).toBe(
      false
    );
    expect(
      (screen.getByPlaceholderText("label (optional)") as HTMLInputElement).disabled
    ).toBe(false);
    expect((screen.getByLabelText(/add dependency/i) as HTMLSelectElement).disabled).toBe(
      false
    );
    expect(screen.getByRole("option", { name: /active dependency/i })).toBeTruthy();
  });

  it("creates the task before replaying staged images, links, and dependencies", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const created: Task = {
      ...task,
      id: "task-created",
      title: "Create with staged metadata",
      description: "Draft body",
      type: "feature",
      state: "start",
      priority: 0,
    };
    const uploaded: TaskImage = {
      id: "image-created",
      task_id: created.id,
      filename: "draft.png",
      mime_type: "image/png",
      size_bytes: 5,
      uploaded_at: 1780051741144,
    };
    const link: TaskLink = {
      id: "link-created",
      task_id: created.id,
      url: "https://example.com/spec",
      label: "Spec link",
      created_at: 1780051741144,
    };
    const fetchMock = vi.fn((url: string | URL | Request, _init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/v1/projects/project-1/tasks") {
        return Promise.resolve(
          new Response(JSON.stringify(created), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (path === "/api/v1/tasks/task-created/images") {
        return Promise.resolve(
          new Response(JSON.stringify(uploaded), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (path === "/api/v1/tasks/task-created/links") {
        return Promise.resolve(
          new Response(JSON.stringify(link), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (path === "/api/v1/tasks/task-created/deps") {
        return Promise.resolve(
          new Response(JSON.stringify({ task_id: created.id, depends_on: activeDep.id }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: `unexpected ${path}` }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderCreateEditor(onClose, [activeDep]);

    await user.type(screen.getByLabelText("Title"), created.title);
    const file = new File(["image"], "draft.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/image attachment/i), file);
    expect(await screen.findByText("draft.png")).toBeTruthy();

    await user.type(screen.getByPlaceholderText("https://…"), link.url);
    await user.type(screen.getByPlaceholderText("label (optional)"), link.label);
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(await screen.findByText("Spec link")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText(/add dependency/i), activeDep.id);
    expect(await screen.findByText("Active dependency")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["/api/v1/projects/project-1/tasks", "POST"],
      ["/api/v1/tasks/task-created/images", "POST"],
      ["/api/v1/tasks/task-created/links", "POST"],
      ["/api/v1/tasks/task-created/deps", "POST"],
    ]);
    expect((fetchMock.mock.calls[1][1]?.body as FormData).get("file")).toBe(file);
    expect(fetchMock.mock.calls[2][1]?.body).toBe(
      JSON.stringify({ url: link.url, label: link.label })
    );
    expect(fetchMock.mock.calls[3][1]?.body).toBe(
      JSON.stringify({ depends_on: activeDep.id })
    );
  });

  it("retries failed staged operations without duplicating successful work", async () => {
    const user = userEvent.setup();
    const created: Task = {
      ...task,
      id: "task-created",
      title: "Retry staged metadata",
      state: "start",
    };
    const link: TaskLink = {
      id: "link-created",
      task_id: created.id,
      url: "https://example.com/retry",
      label: "Retry",
      created_at: 1780051741144,
    };
    let linkAttempts = 0;
    const fetchMock = vi.fn((url: string | URL | Request) => {
      const path = String(url);
      if (path === "/api/v1/projects/project-1/tasks") {
        return Promise.resolve(
          new Response(JSON.stringify(created), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (path === "/api/v1/tasks/task-created/images") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "image-created",
              task_id: created.id,
              filename: "draft.png",
              mime_type: "image/png",
              size_bytes: 5,
              uploaded_at: 1780051741144,
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (path === "/api/v1/tasks/task-created/links") {
        linkAttempts += 1;
        if (linkAttempts === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "link failed" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(link), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (path === "/api/v1/tasks/task-created/deps") {
        return Promise.resolve(
          new Response(JSON.stringify({ task_id: created.id, depends_on: activeDep.id }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: `unexpected ${path}` }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderCreateEditor(vi.fn(), [activeDep]);

    await user.type(screen.getByLabelText("Title"), created.title);
    await user.upload(
      screen.getByLabelText(/image attachment/i),
      new File(["image"], "draft.png", { type: "image/png" })
    );
    await user.type(screen.getByPlaceholderText("https://…"), link.url);
    await user.type(screen.getByPlaceholderText("label (optional)"), link.label);
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    await user.selectOptions(screen.getByLabelText(/add dependency/i), activeDep.id);

    await user.click(screen.getByRole("button", { name: /^create$/i }));
    expect(await screen.findByText("link failed")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/v1/projects/project-1/tasks")
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/v1/tasks/task-created/images")
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/v1/tasks/task-created/links")
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/v1/tasks/task-created/deps")
    ).toHaveLength(1);
  });

  it("deletes staged images and links from the server after a partial create failure", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const created: Task = {
      ...task,
      id: "task-created",
      title: "Delete completed staged metadata",
      state: "start",
    };
    const uploaded: TaskImage = {
      id: "image-created",
      task_id: created.id,
      filename: "draft.png",
      mime_type: "image/png",
      size_bytes: 5,
      uploaded_at: 1780051741144,
    };
    const link: TaskLink = {
      id: "link-created",
      task_id: created.id,
      url: "https://example.com/delete-after-failure",
      label: "Delete me",
      created_at: 1780051741144,
    };
    let dependencyAttempts = 0;
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method;
      if (path === "/api/v1/projects/project-1/tasks") {
        return Promise.resolve(
          new Response(JSON.stringify(created), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (path === "/api/v1/tasks/task-created/images") {
        return Promise.resolve(
          new Response(JSON.stringify(uploaded), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (path === "/api/v1/tasks/task-created/links") {
        return Promise.resolve(
          new Response(JSON.stringify(link), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (path === "/api/v1/tasks/task-created/deps") {
        dependencyAttempts += 1;
        if (dependencyAttempts === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "dependency failed" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ task_id: created.id, depends_on: activeDep.id }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (path === "/api/v1/images/image-created" && method === "DELETE") {
        return Promise.resolve(
          new Response(JSON.stringify({ deleted: true, id: uploaded.id }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (path === "/api/v1/links/link-created" && method === "DELETE") {
        return Promise.resolve(
          new Response(JSON.stringify({ deleted: true, id: link.id }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: `unexpected ${method ?? "GET"} ${path}` }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderCreateEditor(onClose, [activeDep]);

    await user.type(screen.getByLabelText("Title"), created.title);
    await user.upload(
      screen.getByLabelText(/image attachment/i),
      new File(["image"], "draft.png", { type: "image/png" })
    );
    await user.type(screen.getByPlaceholderText("https://…"), link.url);
    await user.type(screen.getByPlaceholderText("label (optional)"), link.label);
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    await user.selectOptions(screen.getByLabelText(/add dependency/i), activeDep.id);

    await user.click(screen.getByRole("button", { name: /^create$/i }));
    expect(await screen.findByText("dependency failed")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /delete image draft.png/i }));
    await user.click(screen.getByRole("button", { name: /remove link delete me/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/images/image-created",
        expect.objectContaining({ method: "DELETE" })
      )
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/links/link-created",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(screen.queryByText("draft.png")).toBeNull();
    expect(screen.queryByText("Delete me")).toBeNull();

    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/v1/tasks/task-created/images")
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/v1/tasks/task-created/links")
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/v1/tasks/task-created/deps")
    ).toHaveLength(2);
  });
});

describe("TaskEditor edit actions", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not render a task delete button in edit mode", () => {
    renderEditor();

    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
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

  it("opens an existing image attachment in a preview dialog", async () => {
    const user = userEvent.setup();
    const existing: TaskImage = {
      id: "image-1",
      task_id: task.id,
      filename: "before.png",
      mime_type: "image/png",
      size_bytes: 1536,
      uploaded_at: 1780051741142,
    };

    renderEditor(vi.fn(), { ...task, images: [existing] });

    await user.click(screen.getByRole("button", { name: /view image before.png/i }));

    expect(await screen.findByRole("dialog", { name: /image preview/i })).toBeTruthy();
    const preview = screen.getByRole("img", { name: /before.png/i }) as HTMLImageElement;
    expect(preview.getAttribute("src")).toBe("/api/v1/images/image-1");
    expect(preview.className).toContain("object-contain");
    expect(preview.className).toContain("cursor-grab");
    expect(preview.className).toContain("max-w-[calc(100vw-2rem)]");
    expect(preview.className).toContain("max-h-[calc(100vh-6rem)]");
    expect(preview.getAttribute("draggable")).toBe("false");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /image preview/i })).toBeNull()
    );
  });

  it("closes the image preview when clicking the backdrop", async () => {
    const user = userEvent.setup();
    const existing: TaskImage = {
      id: "image-1",
      task_id: task.id,
      filename: "before.png",
      mime_type: "image/png",
      size_bytes: 1536,
      uploaded_at: 1780051741142,
    };

    renderEditor(vi.fn(), { ...task, images: [existing] });

    await user.click(screen.getByRole("button", { name: /view image before.png/i }));
    const dialog = await screen.findByRole("dialog", { name: /image preview/i });

    await user.click(dialog);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /image preview/i })).toBeNull()
    );
  });

  it("pans the image preview by dragging without closing the dialog", async () => {
    const user = userEvent.setup();
    const existing: TaskImage = {
      id: "image-1",
      task_id: task.id,
      filename: "wide.png",
      mime_type: "image/png",
      size_bytes: 1536,
      uploaded_at: 1780051741142,
    };

    renderEditor(vi.fn(), { ...task, images: [existing] });

    await user.click(screen.getByRole("button", { name: /view image wide.png/i }));
    const dialog = await screen.findByRole("dialog", { name: /image preview/i });
    const preview = screen.getByRole("img", { name: /wide.png/i }) as HTMLImageElement;

    fireEvent.pointerDown(preview, { pointerId: 1, clientX: 100, clientY: 80 });
    expect(preview.className).toContain("cursor-grabbing");

    fireEvent.pointerMove(preview, { pointerId: 1, clientX: 148, clientY: 117 });

    expect(preview.style.transform).toContain("48px");
    expect(preview.style.transform).toContain("37px");

    fireEvent.pointerUp(preview, { pointerId: 1, clientX: 148, clientY: 117 });

    expect(preview.className).toContain("cursor-grab");
    expect(dialog).toBeTruthy();
    expect(screen.getByRole("dialog", { name: /image preview/i })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    await user.click(screen.getByRole("button", { name: /view image wide.png/i }));

    expect((screen.getByRole("img", { name: /wide.png/i }) as HTMLImageElement).style.transform)
      .toBe("translate3d(0px, 0px, 0)");
  });

  it("deletes an existing image attachment from the list", async () => {
    const user = userEvent.setup();
    const existing: TaskImage = {
      id: "image-1",
      task_id: task.id,
      filename: "before.png",
      mime_type: "image/png",
      size_bytes: 1536,
      uploaded_at: 1780051741142,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ deleted: true, id: existing.id }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(vi.fn(), { ...task, images: [existing] });

    await user.click(screen.getByRole("button", { name: /delete image before.png/i }));

    await waitFor(() => expect(screen.queryByText("before.png")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/images/image-1",
      expect.objectContaining({ method: "DELETE" })
    );
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

  it("uploads pasted image files in edit mode", async () => {
    const uploaded: TaskImage = {
      id: "image-3",
      task_id: task.id,
      filename: "pasted.png",
      mime_type: "image/png",
      size_bytes: 6,
      uploaded_at: 1780051741144,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(uploaded), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();

    const file = new File(["pasted"], "pasted.png", { type: "image/png" });
    const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: {
        files: [file],
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      },
    });
    window.dispatchEvent(event);

    expect(await screen.findByText("pasted.png")).toBeTruthy();
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

describe("TaskEditor docs", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens and updates an existing markdown doc", async () => {
    const user = userEvent.setup();
    const existing: TaskDoc = {
      id: "doc-1",
      task_id: task.id,
      title: "Spec",
      url: "/api/v1/docs/doc-1/content",
      created_at: 1780051741142,
      updated_at: 1780051741142,
    };
    const fetched: TaskDoc = {
      ...existing,
      content: "# Current spec",
    };
    const updated: TaskDoc = {
      ...existing,
      title: "Updated Spec",
      content: "# Updated spec",
      updated_at: 1780051741143,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fetched), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(updated), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(vi.fn(), { ...task, docs: [existing] });

    await user.click(screen.getByRole("button", { name: /open doc spec/i }));

    const dialog = await screen.findByRole("dialog", { name: /markdown document editor/i });
    expect(dialog).toBeTruthy();
    await user.clear(screen.getByLabelText("Document title"));
    await user.type(screen.getByLabelText("Document title"), "Updated Spec");
    const markdownInput = await screen.findByLabelText("Markdown document");
    fireEvent.change(markdownInput, { target: { value: "# Updated spec" } });
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /markdown document editor/i })).toBeNull());
    expect(await screen.findByText("Updated Spec")).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["/api/v1/docs/doc-1", "GET"],
      ["/api/v1/docs/doc-1", "PATCH"],
    ]);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({ title: "Updated Spec", content: "# Updated spec" })
    );
  });

  it("creates a new markdown doc from the docs section", async () => {
    const user = userEvent.setup();
    const created: TaskDoc = {
      id: "doc-2",
      task_id: task.id,
      title: "Dev notes",
      url: "/api/v1/docs/doc-2/content",
      content: "Implementation notes",
      created_at: 1780051741142,
      updated_at: 1780051741142,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(created), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();

    await user.click(screen.getByRole("button", { name: /add doc/i }));
    const dialog = await screen.findByRole("dialog", { name: /markdown document editor/i });
    await user.type(await screen.findByLabelText("Document title"), "Dev notes");
    fireEvent.change(await screen.findByLabelText("Markdown document"), {
      target: { value: "Implementation notes" },
    });
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("Dev notes")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tasks/task-1/docs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Dev notes", content: "Implementation notes" }),
      })
    );
  });

  it("deletes an existing markdown doc", async () => {
    const user = userEvent.setup();
    const existing: TaskDoc = {
      id: "doc-1",
      task_id: task.id,
      title: "Old report",
      url: "/api/v1/docs/doc-1/content",
      created_at: 1780051741142,
      updated_at: 1780051741142,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ deleted: true, id: existing.id }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(vi.fn(), { ...task, docs: [existing] });

    await user.click(screen.getByRole("button", { name: /delete doc old report/i }));

    await waitFor(() => expect(screen.queryByText("Old report")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/docs/doc-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("shows docs as unavailable until a created task has an id", () => {
    renderCreateEditor();

    expect(screen.getByText("Create the task before adding docs.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add doc/i })).toBeNull();
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

  it("keeps images, docs, links, and dependencies in the requested order", () => {
    const editorTask: Task = {
      ...task,
      depends_on: [activeDep.id],
      docs: [
        {
          id: "doc-1",
          task_id: task.id,
          title: "Spec",
          url: "/api/v1/docs/doc-1/content",
          created_at: 1780051741142,
          updated_at: 1780051741142,
        },
      ],
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
    expect(text.indexOf("Images")).toBeLessThan(text.indexOf("Docs"));
    expect(text.indexOf("Docs")).toBeLessThan(text.indexOf("Links"));
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
