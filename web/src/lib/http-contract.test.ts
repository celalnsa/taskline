import { describe, expect, it } from "vitest";
import docFixture from "../../../testdata/http_contract/doc.json";
import imageFixture from "../../../testdata/http_contract/image.json";
import linkFixture from "../../../testdata/http_contract/link.json";
import nextTaskResponseFixture from "../../../testdata/http_contract/next_task_response.json";
import projectFixture from "../../../testdata/http_contract/project.json";
import taskFixture from "../../../testdata/http_contract/task_full.json";
import tasksResponseFixture from "../../../testdata/http_contract/tasks_response.json";
import {
  STATES,
  type Project,
  type Task,
  type TaskDoc,
  type TaskImage,
  type TaskLink,
} from "./api";

describe("canonical HTTP contract fixtures", () => {
  it("match the exported web API shapes", () => {
    const project: Project = projectFixture;
    const task = asTask(taskFixture);
    const tasksResponse = { tasks: tasksResponseFixture.tasks.map(asTask) };
    const nextTaskResponse = { task: asTask(nextTaskResponseFixture.task) };
    const doc: TaskDoc = docFixture;
    const image: TaskImage = imageFixture;
    const link: TaskLink = linkFixture;

    expect(keys(project)).toEqual([
      "created_at",
      "description",
      "id",
      "name",
      "updated_at",
    ]);
    expect(keys(task)).toEqual([
      "claimed_at",
      "created_at",
      "depends_on",
      "description",
      "docs",
      "id",
      "images",
      "labels",
      "lease_expires_at",
      "links",
      "owner",
      "priority",
      "project_id",
      "state",
      "title",
      "type",
      "updated_at",
    ]);
    expect(tasksResponse.tasks).toEqual([task]);
    expect(nextTaskResponse.task).toEqual(task);
    expect(keys(doc)).toEqual([
      "content",
      "created_at",
      "id",
      "task_id",
      "title",
      "updated_at",
      "url",
    ]);
    expect(keys(image)).toEqual([
      "filename",
      "id",
      "mime_type",
      "size_bytes",
      "task_id",
      "uploaded_at",
      "url",
    ]);
    expect(keys(link)).toEqual(["created_at", "id", "label", "task_id", "url"]);
  });

  it("uses known state and type literals", () => {
    const task = asTask(taskFixture);

    expect(STATES).toContain(task.state);
    expect(["feature", "bug", "docs"]).toContain(task.type);
  });
});

function asTask(value: typeof taskFixture): Task {
  expect(STATES).toContain(value.state);
  expect(["feature", "bug", "docs"]).toContain(value.type);
  return value as Task;
}

function keys(value: object): string[] {
  return Object.keys(value).sort();
}
