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
    chipClass: "border-[var(--tl-rust)]/35 bg-[var(--tl-rust-soft)] text-[var(--tl-rust)]",
    optionClass: "border-[var(--tl-rust)]/35 bg-[var(--tl-rust-soft)] text-[var(--tl-rust)] hover:bg-[color-mix(in_srgb,var(--tl-rust-soft)_80%,white)]",
    iconClass: "text-[var(--tl-rust)]",
  },
  violet: {
    name: "violet",
    chipClass: "border-[var(--tl-indigo)]/35 bg-[var(--tl-indigo-soft)] text-[var(--tl-indigo)]",
    optionClass: "border-[var(--tl-indigo)]/35 bg-[var(--tl-indigo-soft)] text-[var(--tl-indigo)] hover:bg-[color-mix(in_srgb,var(--tl-indigo-soft)_80%,white)]",
    iconClass: "text-[var(--tl-indigo)]",
  },
  amber: {
    name: "amber",
    chipClass: "border-[var(--tl-ochre)]/35 bg-[var(--tl-ochre-soft)] text-[var(--tl-ochre)]",
    optionClass: "border-[var(--tl-ochre)]/35 bg-[var(--tl-ochre-soft)] text-[var(--tl-ochre)] hover:bg-[color-mix(in_srgb,var(--tl-ochre-soft)_80%,white)]",
    iconClass: "text-[var(--tl-ochre)]",
  },
  emerald: {
    name: "emerald",
    chipClass: "border-[var(--tl-moss)]/35 bg-[var(--tl-moss-soft)] text-[var(--tl-moss)]",
    optionClass: "border-[var(--tl-moss)]/35 bg-[var(--tl-moss-soft)] text-[var(--tl-moss)] hover:bg-[color-mix(in_srgb,var(--tl-moss-soft)_80%,white)]",
    iconClass: "text-[var(--tl-moss)]",
  },
  sky: {
    name: "sky",
    chipClass: "border-[var(--tl-water)]/35 bg-[var(--tl-water-soft)] text-[var(--tl-water)]",
    optionClass: "border-[var(--tl-water)]/35 bg-[var(--tl-water-soft)] text-[var(--tl-water)] hover:bg-[color-mix(in_srgb,var(--tl-water-soft)_80%,white)]",
    iconClass: "text-[var(--tl-water)]",
  },
  indigo: {
    name: "indigo",
    chipClass: "border-[var(--tl-indigo)]/35 bg-[var(--tl-indigo-soft)] text-[var(--tl-indigo)]",
    optionClass: "border-[var(--tl-indigo)]/35 bg-[var(--tl-indigo-soft)] text-[var(--tl-indigo)] hover:bg-[color-mix(in_srgb,var(--tl-indigo-soft)_80%,white)]",
    iconClass: "text-[var(--tl-indigo)]",
  },
  cyan: {
    name: "cyan",
    chipClass: "border-[var(--tl-water)]/35 bg-[var(--tl-water-soft)] text-[var(--tl-water)]",
    optionClass: "border-[var(--tl-water)]/35 bg-[var(--tl-water-soft)] text-[var(--tl-water)] hover:bg-[color-mix(in_srgb,var(--tl-water-soft)_80%,white)]",
    iconClass: "text-[var(--tl-water)]",
  },
  pink: {
    name: "pink",
    chipClass: "border-[var(--tl-clay)]/35 bg-[#eadfd8] text-[var(--tl-clay)]",
    optionClass: "border-[var(--tl-clay)]/35 bg-[#eadfd8] text-[var(--tl-clay)] hover:bg-[#f0e7e1]",
    iconClass: "text-[var(--tl-clay)]",
  },
  slate: {
    name: "slate",
    chipClass: "border-[var(--tl-outline)] bg-[var(--tl-surface-muted)] text-[var(--tl-ink-muted)]",
    optionClass: "border-[var(--tl-outline)] bg-[var(--tl-surface-muted)] text-[var(--tl-ink-muted)] hover:bg-[var(--tl-bg-quiet)]",
    iconClass: "text-[var(--tl-ink-muted)]",
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
