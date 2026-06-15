import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("places the back button before the title in the header", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <MarkdownDescriptionDialog
        value={"# title"}
        onChange={vi.fn()}
        onClose={onClose}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /markdown description editor/i });
    const header = dialog.querySelector("header");
    const backButton = screen.getByRole("button", { name: /back to task editor/i });
    const title = screen.getByRole("heading", { name: /markdown description editor/i });

    expect(header?.firstElementChild).toBe(backButton);
    expect(Boolean(backButton.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    await user.click(backButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
