import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

type SeedManifest = {
  schema_version: number;
  project: { id: string; name: string };
  tasks: Record<string, { id: string; state: string }>;
};

const manifest = loadManifest();
const projectURL = `/?project=${encodeURIComponent(manifest.project.name)}`;

test.beforeEach(async ({ page }) => {
  await page.goto(projectURL);
  await expect(page.getByRole("heading", { name: manifest.project.name })).toBeVisible();
});

test("surfaces unfinished dependencies as blocked", async ({ page }) => {
  const card = page.getByLabel("Open task Implement role-based access control");

  await expect(card).toBeVisible();
  await expect(card.getByTitle(/^Blocked: depends on other tasks not yet done$/)).toHaveText(
    "deps 1"
  );
});

test("moves a task from Start to Spec with pointer drag and drop", async ({ page }) => {
  const taskTitle = "Define onboarding success metrics";
  const taskID = manifest.tasks.onboarding_metrics.id;
  const source = page.getByTestId("column-start").getByLabel(`Open task ${taskTitle}`);
  const target = page.getByTestId("column-spec");
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith(`/api/v1/tasks/${taskID}`)
  );

  await pointerDrag(page, source, target);

  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({ id: taskID, state: "spec" });
  await expect(target.getByLabel(`Open task ${taskTitle}`)).toBeVisible();
  await expect(page.getByTestId("column-start").getByLabel(`Open task ${taskTitle}`)).toHaveCount(
    0
  );
});

test("creates a task in Start by default", async ({ page }) => {
  const title = "E2E default auto-start task";
  const response = await createTask(page, title);
  const requestBody = response.request().postDataJSON() as { auto_start?: boolean };

  expect(requestBody.auto_start).toBe(true);
  await expect(response.json()).resolves.toMatchObject({ title, state: "start" });
  await expect(page.getByTestId("column-start").getByLabel(`Open task ${title}`)).toBeVisible();
});

test("creates a task in Pending when auto-start is disabled", async ({ page }) => {
  const title = "E2E pending task";
  const response = await createTask(page, title, "pending");
  const requestBody = response.request().postDataJSON() as { auto_start?: boolean };

  expect(requestBody.auto_start).toBe(false);
  await expect(response.json()).resolves.toMatchObject({ title, state: "pending" });
  await expect(page.getByTestId("column-pending").getByLabel(`Open task ${title}`)).toBeVisible();
});

async function pointerDrag(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox, "source card must have a bounding box").not.toBeNull();
  expect(targetBox, "target column must have a bounding box").not.toBeNull();

  const sourcePoint = {
    x: sourceBox!.x + Math.min(24, sourceBox!.width / 2),
    y: sourceBox!.y + Math.min(24, sourceBox!.height / 2),
  };
  const targetPoint = {
    x: targetBox!.x + Math.min(24, targetBox!.width / 2),
    y: targetBox!.y + Math.min(120, targetBox!.height / 2),
  };

  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down();
  try {
    await page.mouse.move(sourcePoint.x + 8, sourcePoint.y, { steps: 2 });
    await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 5 });
  } finally {
    await page.mouse.up();
  }
}

async function createTask(page: Page, title: string, state?: "pending") {
  await page.locator("main header").getByRole("button", { name: "+ New", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Create task in ${manifest.project.name}` });
  await dialog.getByLabel("Title").fill(title);
  if (state) {
    await dialog.getByLabel("State").selectOption(state);
  }

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/v1/projects/${manifest.project.id}/tasks`)
  );
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  await expect(dialog).toBeHidden();
  return response;
}

function loadManifest(): SeedManifest {
  const manifestPath = process.env.TASKLINE_E2E_MANIFEST;
  if (!manifestPath) throw new Error("TASKLINE_E2E_MANIFEST is required");
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as SeedManifest;
  if (
    parsed.schema_version !== 1 ||
    !parsed.project?.id ||
    !parsed.project?.name ||
    !parsed.tasks?.onboarding_metrics?.id
  ) {
    throw new Error(`invalid Taskline seed manifest: ${manifestPath}`);
  }
  return parsed;
}
