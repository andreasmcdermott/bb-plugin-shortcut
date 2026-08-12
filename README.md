# Shortcut for bb

An independent community plugin that brings assigned Shortcut stories into
[bb](https://github.com/get-bb/bb).

## Features

- Compact Kanban board grouped by workflow and workflow state.
- Workflow tabs, search, completed-story filtering, and story details.
- Manual story ordering with drag-and-drop and edge auto-scrolling.
- Card actions for viewing details, copying an ID, opening Shortcut, and
  starting work in bb.
- **Start work in bb** moves the story to `In Development` in its current
  workflow before creating an agent thread.
- Shortcut story URLs in chat open inside the plugin; explicit **Open in
  Shortcut** actions continue to open the Shortcut website.
- `bb shortcut status|list|show` commands, native agent tools, and `#`/`@`
  story mentions.

## Requirements

- bb 0.35 or newer.
- A Shortcut API token.
- Node.js and npm when installing directly from Git.

## Install

Install the latest version from the public Git repository:

```sh
bb plugin install git:https://github.com/andreasmcdermott/bb-plugin-shortcut.git@main
```

Open **Settings → Plugins → Shortcut**, add a Shortcut API token, and choose a
default bb project. Create a token in Shortcut under **Settings → API Tokens**.

The token is stored through bb's secret-settings facility and is never sent to
the plugin frontend.

## Permissions and behavior

The plugin uses Shortcut REST API v3 to:

- Read the authenticated member, workflows, and assigned stories.
- Update a story's manual position when you reorder a card.
- Move a story to the matching `In Development` state when you choose
  **Start work in bb**.

The plugin only performs Shortcut mutations in response to those explicit UI
actions. A workflow without an `In Development` state produces an error instead
of choosing a state from another workflow.

## Updating

Check for and install newer commits from the tracked `main` branch:

```sh
bb plugin outdated
bb plugin update shortcut
```

## Local development

```sh
npm install
npm run check
bb plugin install .
```

After changing source files, rebuild and reload the installed path plugin:

```sh
npm run build
bb plugin reload shortcut
```

`components/ui/` contains vendored, version-matched bb components. The full
plugin API declarations are in `types/` and mapped through `tsconfig.json`.

## Distribution

`npm run build` creates verified plugin artifacts in `dist/`. These artifacts
are committed so managed installs can validate the plugin identity and SDK
compatibility before activation.

Before publishing a release, run:

```sh
npm ci
npm run check
npm pack --dry-run
```

## License

[MIT](LICENSE)

Shortcut and its logo are trademarks of their respective owner. This project
is not affiliated with or endorsed by Shortcut.
