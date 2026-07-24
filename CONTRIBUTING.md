# Contributing

Thanks for helping improve taskline. Read [`AGENTS.md`](AGENTS.md) before
changing code; it is the source of truth for architecture boundaries,
repository conventions, and verification requirements.

## Set up

Prerequisites:

- Go 1.25 or newer
- pnpm
- Node.js 24, installed directly or through [mise](https://mise.jdx.dev/)

Clone the public repository and prepare local configuration:

```bash
git clone https://github.com/celalnsa/taskline.git
cd taskline
cp .env.example .env
```

With Go, Node.js, and pnpm already active, build directly:

```bash
./scripts/build.sh
```

Alternatively, mise users can inspect `mise.toml`, trust it, and activate the
declared Node.js version explicitly:

```bash
mise trust
mise install
mise exec -- ./scripts/build.sh
```

The example configuration keeps runtime data under ignored `.cache/data/`
paths. Process environment variables override `.env`.

## Develop and test

Follow the commands and component-specific test matrix in
[`AGENTS.md`](AGENTS.md#build-run-test). Run every check relevant to the files
you touched. Runtime-affecting server, CLI, web, embedded-asset, or migration
changes also require the rebuilt-binary verification described in
[`.agents/skills/taskline-localtest/SKILL.md`](.agents/skills/taskline-localtest/SKILL.md).

Keep the documented module direction and update [`DOMAIN.md`](DOMAIN.md) when a
change alters vocabulary or domain invariants.

## Branches and pull requests

1. Start from an up-to-date `main` and create a short
   `feature/<kebab-case-name>` branch.
2. Keep commits focused and use a concise conventional commit message.
3. Open a focused pull request with a summary and exact test plan.
4. Address every review comment, resolve review threads, and wait for all
   configured CI checks before merging.

Do not mix unrelated cleanup into a contribution. Documentation-only changes
still need relevant checks and review, but do not require a runtime deployment.
