import { useEffect } from "react";
import MDEditor from "@uiw/react-md-editor/nohighlight";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";
import "./MarkdownDescriptionDialog.css";
import { ArrowLeft } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}

export function MarkdownDescriptionDialog({ value, onChange, onClose }: Props) {
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(37,34,29,0.44)] p-5">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="markdown-description-title"
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
            <h3 id="markdown-description-title" className="text-sm font-semibold text-[var(--tl-ink)]">
              Markdown description editor
            </h3>
          </div>
        </header>

        <div className="taskline-markdown-dialog min-h-0 flex-1">
          <MDEditor
            value={value}
            onChange={(next) => onChange(next ?? "")}
            height="100%"
            visibleDragbar={false}
            textareaProps={{
              "aria-label": "Markdown description",
              autoFocus: true,
            }}
          />
        </div>
      </div>
    </div>
  );
}
