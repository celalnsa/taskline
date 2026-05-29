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
    <div className="fixed inset-0 z-50 bg-black/40 p-5">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="markdown-description-title"
        className="relative h-full w-full rounded-md bg-white shadow-2xl flex flex-col overflow-hidden"
        data-color-mode="light"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 id="markdown-description-title" className="text-sm font-semibold text-slate-800">
              Markdown description editor
            </h3>
          </div>
          <button
            type="button"
            aria-label="Back to task editor"
            className="h-8 w-8 rounded border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900 flex items-center justify-center"
            onClick={onClose}
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
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
