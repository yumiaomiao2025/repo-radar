# Repo Radar

Repo Radar is a Windows-first desktop app for keeping a curated set of Git repositories in one place.

## Features

- add Git repository roots directly
- add parent folders and scan them for repositories
- list local branches and the current branch
- create local branches
- switch branches only when the working tree is clean
- open repositories in VS Code, Cursor, or Antigravity

## Tech Stack

- Electron
- React
- TypeScript
- Vite

## Development

1. Install dependencies with a working package manager.
2. Run `npm install`.
3. Run `npm run dev`.

To build the production app, run `npm run build`.

## Notes

- Settings are stored in Electron's `userData` directory as a JSON file.
- Scan roots use a conservative recursive search depth of 3 directories.
- The current environment where this project was generated does not have a working `npm`, `pnpm`, or `corepack`, so dependencies were not installed and runtime verification could not be completed here.
