import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadTaskImage, type TaskImage } from "./api";

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
