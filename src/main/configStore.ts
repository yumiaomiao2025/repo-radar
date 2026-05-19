import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { SettingsData, ThemeId } from "../shared/types.js";

const VALID_THEMES: ThemeId[] = ["midnight", "aurora", "ember", "daybreak"];

const DEFAULT_BRANCH_NODE_OPTIONS = ["已开发", "已联调", "已review"];

const DEFAULT_SETTINGS: SettingsData = {
  manualRepoPaths: [],
  scanRootPaths: [],
  scanRootSelections: {},
  repoTags: {},
  branchAliases: {},
  branchTags: {},
  branchNodes: {},
  branchNodeOptions: [...DEFAULT_BRANCH_NODE_OPTIONS],
  repoBranchNodeOptions: {},
  repoCardMaxHeight: null,
  theme: "midnight"
};

// 去除首尾空白并解析为绝对路径，统一不同写法的路径形式。
function normalizePath(inputPath: string): string {
  return path.resolve(inputPath.trim());
}

// 对路径数组去重并按字典序排序，保持配置文件中的顺序稳定。
function uniquePaths(values: string[]): string[] {
  return [...new Set(values.map(normalizePath))].sort((left, right) =>
    left.localeCompare(right)
  );
}

// 对标签数组去除空白、过滤空值、去重并排序。
function uniqueTags(values: string[]): string[] {
  return [...new Set(values.map((tag) => tag.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

// 规范化卡片最大高度：空值/非法值返回 null，并强制不小于 260。
function normalizeRepoCardMaxHeight(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(260, Math.round(value));
}

// 把按仓库路径分组的记录的 key 统一规范化，并对每个 value 应用 mapper。
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

  // 将设置文件落在 Electron 的 userData 目录，避免污染用户工作目录。
  constructor() {
    this.filePath = path.join(app.getPath("userData"), "settings.json");
  }

  // 从磁盘读取设置；文件不存在或损坏时回退到默认值，保证应用始终可启动。
  async load(): Promise<SettingsData> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SettingsData>;

      return this.sanitize(parsed);
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  // 先净化再持久化设置，避免外部传入的脏数据写入磁盘。
  async save(settings: SettingsData): Promise<SettingsData> {
    const sanitized = this.sanitize(settings);

    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(sanitized, null, 2), "utf8");

    return sanitized;
  }

  // 对外部传入的部分设置执行结构和值校验，输出符合契约的完整 SettingsData。
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
    const branchNodes = normalizeRepoRecord(settings.branchNodes, (branches) =>
      Object.fromEntries(
        Object.entries(branches)
          .map(([branchName, node]) => [branchName.trim(), (node ?? "").trim()])
          .filter(([branchName, node]) => branchName && node)
      )
    );
    const rawNodeOptions = settings.branchNodeOptions;
    const branchNodeOptions = Array.isArray(rawNodeOptions)
      ? [...new Set(rawNodeOptions.map((value) => value.trim()).filter(Boolean))]
      : [...DEFAULT_BRANCH_NODE_OPTIONS];
    // 仓库自定义进度选项：仅保留非空数组，空数组等于回退到全局选项。
    const repoBranchNodeOptions = Object.fromEntries(
      Object.entries(settings.repoBranchNodeOptions ?? {})
        .map(([repoPath, options]) => {
          if (!Array.isArray(options)) {
            return null;
          }
          const cleaned = [...new Set(options.map((value) => value.trim()).filter(Boolean))];
          if (cleaned.length === 0) {
            return null;
          }
          return [normalizePath(repoPath), cleaned] as const;
        })
        .filter((entry): entry is readonly [string, string[]] => entry !== null)
    );

    return {
      manualRepoPaths: uniquePaths(settings.manualRepoPaths ?? []),
      scanRootPaths,
      scanRootSelections,
      repoTags,
      branchAliases,
      branchTags,
      branchNodes,
      branchNodeOptions,
      repoBranchNodeOptions,
      repoCardMaxHeight: normalizeRepoCardMaxHeight(settings.repoCardMaxHeight),
      theme: VALID_THEMES.includes(settings.theme as ThemeId)
        ? (settings.theme as ThemeId)
        : "midnight"
    };
  }
}
