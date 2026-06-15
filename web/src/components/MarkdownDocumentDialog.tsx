import { useEffect } from "react";
import MDEditor from "@uiw/react-md-editor/nohighlight";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";
import "./MarkdownDescriptionDialog.css";
import { ArrowLeft } from "lucide-react";

interface Props {
  title: string;
  content: string;
  isSaving?: boolean;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export function MarkdownDocumentDialog({
  title,
  content,
  isSaving = false,
  onTitleChange,
  onContentChange,
  onClose,
  onSave,
}: Props) {
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(37,34,29,0.44)] p-5">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="markdown-document-title"
        className="relative h-full w-full rounded-md border border-[var(--tl-outline)] bg-[var(--tl-surface-raised)] shadow-[var(--tl-shadow-lift)] flex flex-col overflow-hidden"
        data-color-mode="light"
      >
        <header className="flex items-center gap-3 border-b border-[var(--tl-outline)] px-5 py-3">
          <button
            type="button"
            aria-label="Back to task editor"
            className="h-8 w-8 rounded-md border border-[var(--tl-outline)] bg-[var(--tl-surface)] text-[var(--tl-ink-muted)] hover:bg-[var(--tl-bg-quiet)] hover:text-[var(--tl-ink)] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]"
            onClick={onClose}
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <h3 id="markdown-document-title" className="text-sm font-semibold text-[var(--tl-ink)]">
              Markdown document editor
            </h3>
            <label className="sr-only" htmlFor="task-doc-title">
              Document title
            </label>
            <input
              id="task-doc-title"
              aria-label="Document title"
              className="mt-1 w-full text-sm border border-[var(--tl-outline)] rounded-md px-2 py-1"
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              autoFocus
            />
          </div>
          <button
            type="button"
            className="text-sm px-3 py-1.5 rounded-md bg-[var(--tl-moss)] text-[var(--tl-surface)] hover:bg-[color-mix(in_srgb,var(--tl-moss)_82%,black)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]"
            disabled={isSaving || !title.trim()}
            onClick={onSave}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </header>

        <div className="taskline-markdown-dialog min-h-0 flex-1">
          <MDEditor
            value={content}
            onChange={(next) => onContentChange(next ?? "")}
            height="100%"
            visibleDragbar={false}
            textareaProps={{
              "aria-label": "Markdown document",
            }}
          />
        </div>
      </div>
    </div>
  );
}
