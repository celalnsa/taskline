import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTask,
  createTaskDoc,
  deleteTaskDoc,
  deleteTaskImage,
  getTaskDoc,
  searchTasks,
  STATE_LABELS,
  STATES,
  taskDocContentURL,
  taskImageURL,
  updateTask,
  updateTaskDoc,
  uploadTaskImage,
  type TaskDoc,
  type TaskImage,
} from "./api";

describe("task states", () => {
  it("includes the local test stage between dev and review", () => {
    expect(STATES).toEqual([
      "pending",
      "start",
      "spec",
      "dev",
      "test",
      "review",
      "done",
    ]);
    expect(STATE_LABELS.test).toBe("Test");
  });
});

describe("task labels helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends labels when creating and updating tasks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "task-1", labels: ["backend", "ui"] }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "task-1", labels: ["review"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await createTask("taskline", {
      title: "Labeled task",
      type: "feature",
      priority: 0,
      labels: ["backend", "ui"],
    });
    await updateTask("task-1", { labels: ["review"] });

    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        title: "Labeled task",
        type: "feature",
        priority: 0,
        labels: ["backend", "ui"],
      })
    );
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({ labels: ["review"] })
    );
  });
});

describe("searchTasks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches a project with encoded query and limit", async () => {
    const found = {
      id: "fc7a0732-0000-4000-8000-000000000000",
      project_id: "project-1",
      title: "Found task",
      description: "",
      type: "feature",
      state: "start",
      priority: 0,
      labels: [],
      created_at: 1780051741142,
      updated_at: 1780051741142,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tasks: [found] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchTasks("taskline", "fc7a0732 hooks", 7);

    expect(result).toEqual([found]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/projects/taskline/tasks/search?q=fc7a0732+hooks&limit=7",
      expect.objectContaining({ method: "GET" })
    );
  });
});

describe("uploadTaskImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the file as multipart form data", async () => {
    const uploaded: TaskImage = {
      id: "image-1",
      task_id: "task/one",
      filename: "diagram.png",
      mime_type: "image/png",
      size_bytes: 7,
      uploaded_at: 1780051741142,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(uploaded), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["pngbits"], "diagram.png", { type: "image/png" });
    const result = await uploadTaskImage("task/one", file);

    expect(result).toEqual(uploaded);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tasks/task%2Fone/images",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) })
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toBeUndefined();
    expect((init.body as FormData).get("file")).toBe(file);
  });
});

describe("task image content helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds an encoded URL for image previews", () => {
    expect(taskImageURL("image/one")).toBe("/api/v1/images/image%2Fone");
  });

  it("deletes an image by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteTaskImage("image/one");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/images/image%2Fone",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

describe("task docs helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a markdown doc with JSON content", async () => {
    const created: TaskDoc = {
      id: "doc-1",
      task_id: "task/one",
      title: "Spec",
      url: "/api/v1/docs/doc-1/content",
      content: "# Spec",
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

    const result = await createTaskDoc("task/one", { title: "Spec", content: "# Spec" });

    expect(result).toEqual(created);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tasks/task%2Fone/docs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Spec", content: "# Spec" }),
      })
    );
  });

  it("gets, updates, deletes, and builds raw content URLs for docs", async () => {
    const doc: TaskDoc = {
      id: "doc/one",
      task_id: "task-1",
      title: "Test report",
      url: "/api/v1/docs/doc%2Fone/content",
      content: "# Tests",
      created_at: 1780051741142,
      updated_at: 1780051741143,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(doc), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...doc, title: "Updated" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(taskDocContentURL("doc/one")).toBe("/api/v1/docs/doc%2Fone/content");
    expect(await getTaskDoc("doc/one")).toEqual(doc);
    await updateTaskDoc("doc/one", { title: "Updated", content: "# Tests" });
    await deleteTaskDoc("doc/one");

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/v1/docs/doc%2Fone", "GET"],
      ["/api/v1/docs/doc%2Fone", "PATCH"],
      ["/api/v1/docs/doc%2Fone", "DELETE"],
    ]);
  });
});
