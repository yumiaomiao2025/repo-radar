import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { EditorId, SettingsData } from "../shared/types.js";

const DEFAULT_SETTINGS: SettingsData = {
  manualRepoPaths: [],
  scanRootPaths: [],
  defaultEditor: "vscode"
};

function normalizePath(inputPath: string): string {
  return path.resolve(inputPath.trim());
}

function uniquePaths(values: string[]): string[] {
  return [...new Set(values.map(normalizePath))].sort((left, right) =>
    left.localeCompare(right)
  );
}

export class ConfigStore {
  private readonly filePath: string;

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "settings.json");
  }

  async load(): Promise<SettingsData> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SettingsData>;

      return this.sanitize(parsed);
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async save(settings: SettingsData): Promise<SettingsData> {
    const sanitized = this.sanitize(settings);

    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(sanitized, null, 2), "utf8");

    return sanitized;
  }

  sanitize(settings: Partial<SettingsData>): SettingsData {
    const editor = settings.defaultEditor;
    const defaultEditor: EditorId =
      editor === "cursor" || editor === "antigravity" || editor === "vscode"
        ? editor
        : DEFAULT_SETTINGS.defaultEditor;

    return {
      manualRepoPaths: uniquePaths(settings.manualRepoPaths ?? []),
      scanRootPaths: uniquePaths(settings.scanRootPaths ?? []),
      defaultEditor
    };
  }
}
