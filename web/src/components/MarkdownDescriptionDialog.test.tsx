import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownDescriptionDialog } from "./MarkdownDescriptionDialog";

describe("MarkdownDescriptionDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses a single editor surface without the duplicate fixed preview pane", () => {
    render(
      <MarkdownDescriptionDialog
        value={"1. first item\n2. second item\n\n- loose item"}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: /markdown description editor/i })).toBeTruthy();
    expect(screen.queryByText(/^Preview$/)).toBeNull();
    expect(document.querySelector(".taskline-markdown-dialog")).toBeTruthy();
  });
});
