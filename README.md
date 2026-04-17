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
2. Run `pnpm install`.
3. Run `pnpm run dev`.

## Production

- Run `pnpm run start:prod` to build and launch the app without the Vite dev server.
- Run `pnpm run dist:win` to build a Windows installer.
- Packaged output is written to the `release/` directory.
- Share the generated installer in `release/`, such as `Repo Radar-Installer-0.1.0.exe`, with other Windows users.
- `release/win-unpacked/` is the portable unpacked build and is only needed if you want a no-installer version.

## GitHub Releases

This repository includes a GitHub Actions workflow at `.github/workflows/release.yml`.

To publish a new Windows installer on GitHub Releases:

1. Update the version in `package.json`.
2. Commit your changes.
3. Create a version tag such as `v0.1.1`.
4. Push the branch and the tag to GitHub.

Example:

```bash
git add .
git commit -m "release: v0.1.1"
git tag v0.1.1
git push
git push origin v0.1.1
```

When the tag is pushed, GitHub Actions will:

- install dependencies with pnpm
- build the Windows NSIS installer
- create or update the GitHub Release for that tag
- upload the generated `.exe` and `.blockmap` files from `release/`

For most users, the only file they need is the installer `.exe` from the Release page.

## Notes

- Settings are stored in Electron's `userData` directory as a JSON file.
- Scan roots use a conservative recursive search depth of 3 directories.
- The installer build uses `electron-builder` with an NSIS target on Windows.
- The repository includes generated `build/icon.png` and `build/icon.ico` assets for Windows packaging.
