export type TaskLabelThemeName =
  | "red"
  | "violet"
  | "amber"
  | "emerald"
  | "sky"
  | "indigo"
  | "cyan"
  | "pink"
  | "slate";

export type TaskLabelTheme = {
  name: TaskLabelThemeName;
  chipClass: string;
  optionClass: string;
  iconClass: string;
};

export const COMMON_TASK_LABELS = [
  "bug",
  "documentation",
  "duplicate",
  "enhancement",
  "good first issue",
  "help wanted",
  "invalid",
  "question",
  "wontfix",
  "backend",
  "frontend",
  "ui",
  "review",
  "test",
  "blocked",
] as const;

const THEMES: Record<TaskLabelThemeName, TaskLabelTheme> = {
  red: {
    name: "red",
    chipClass: "border-red-200 bg-red-50 text-red-700",
    optionClass: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
    iconClass: "text-red-500",
  },
  violet: {
    name: "violet",
    chipClass: "border-violet-200 bg-violet-50 text-violet-700",
    optionClass: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100",
    iconClass: "text-violet-500",
  },
  amber: {
    name: "amber",
    chipClass: "border-amber-200 bg-amber-50 text-amber-800",
    optionClass: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
    iconClass: "text-amber-500",
  },
  emerald: {
    name: "emerald",
    chipClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    optionClass: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
    iconClass: "text-emerald-500",
  },
  sky: {
    name: "sky",
    chipClass: "border-sky-200 bg-sky-50 text-sky-700",
    optionClass: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100",
    iconClass: "text-sky-500",
  },
  indigo: {
    name: "indigo",
    chipClass: "border-indigo-200 bg-indigo-50 text-indigo-700",
    optionClass: "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100",
    iconClass: "text-indigo-500",
  },
  cyan: {
    name: "cyan",
    chipClass: "border-cyan-200 bg-cyan-50 text-cyan-700",
    optionClass: "border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100",
    iconClass: "text-cyan-500",
  },
  pink: {
    name: "pink",
    chipClass: "border-pink-200 bg-pink-50 text-pink-700",
    optionClass: "border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-100",
    iconClass: "text-pink-500",
  },
  slate: {
    name: "slate",
    chipClass: "border-slate-200 bg-slate-50 text-slate-700",
    optionClass: "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
    iconClass: "text-slate-500",
  },
};

const NAMED_THEMES: Record<string, TaskLabelThemeName> = {
  bug: "red",
  invalid: "red",
  documentation: "violet",
  docs: "violet",
  duplicate: "slate",
  wontfix: "slate",
  enhancement: "emerald",
  feature: "emerald",
  "good first issue": "emerald",
  "help wanted": "sky",
  question: "sky",
  backend: "indigo",
  frontend: "cyan",
  ui: "cyan",
  review: "amber",
  blocked: "amber",
  test: "pink",
  testing: "pink",
};

const FALLBACK_THEMES: TaskLabelThemeName[] = [
  "sky",
  "emerald",
  "violet",
  "amber",
  "indigo",
  "cyan",
  "pink",
  "slate",
];

function labelKey(label: string) {
  return label.trim().toLowerCase();
}

function hashLabel(label: string) {
  let hash = 0;
  for (const char of labelKey(label)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function getTaskLabelTheme(label: string): TaskLabelTheme {
  const key = labelKey(label);
  if (!key) return THEMES.slate;
  const named = NAMED_THEMES[key];
  if (named) return THEMES[named];
  return THEMES[FALLBACK_THEMES[hashLabel(key) % FALLBACK_THEMES.length]];
}

export function taskLabelChipClass(label: string) {
  return getTaskLabelTheme(label).chipClass;
}
