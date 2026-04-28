import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { SettingsData } from "../shared/types.js";

const DEFAULT_SETTINGS: SettingsData = {
  manualRepoPaths: [],
  scanRootPaths: [],
  scanRootSelections: {},
  repoTags: {},
  branchAliases: {},
  branchTags: {}
};

function normalizePath(inputPath: string): string {
  return path.resolve(inputPath.trim());
}

function uniquePaths(values: string[]): string[] {
  return [...new Set(values.map(normalizePath))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function normalizeTag(input: string): string {
  return input.trim();
}

function uniqueTags(values: string[]): string[] {
  return [...new Set(values.map(normalizeTag).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function normalizeRepoRecord<T>(
  value: Record<string, T> | undefined,
  mapper: (item: T) => T
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([repoPath, item]) => [
      normalizePath(repoPath),
      mapper(item)
    ])
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
    const scanRootPaths = uniquePaths(settings.scanRootPaths ?? []);
    const scanRootSelections = Object.fromEntries(
      scanRootPaths
        .filter((rootPath) =>
          Object.prototype.hasOwnProperty.call(settings.scanRootSelections ?? {}, rootPath)
        )
        .map((rootPath) => [
          rootPath,
          uniquePaths(settings.scanRootSelections?.[rootPath] ?? [])
        ])
    );
    const repoTags = normalizeRepoRecord(settings.repoTags, uniqueTags);
    const branchAliases = normalizeRepoRecord(settings.branchAliases, (branches) =>
      Object.fromEntries(
        Object.entries(branches)
          .map(([branchName, alias]) => [branchName.trim(), alias.trim()])
          .filter(([branchName]) => branchName)
      )
    );
    const branchTags = normalizeRepoRecord(settings.branchTags, (branches) =>
      Object.fromEntries(
        Object.entries(branches)
          .map(([branchName, tags]) => [branchName.trim(), uniqueTags(tags)])
          .filter(([branchName]) => branchName)
      )
    );

    return {
      manualRepoPaths: uniquePaths(settings.manualRepoPaths ?? []),
      scanRootPaths,
      scanRootSelections,
      repoTags,
      branchAliases,
      branchTags
    };
  }
}
