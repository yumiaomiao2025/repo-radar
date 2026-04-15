import { execFile } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ManagedRepo, RepoSource } from "../shared/types.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo"
]);

const DEFAULT_SCAN_DEPTH = 3;

type ExecResult = {
  stdout: string;
  stderr: string;
};

export class GitServiceError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GitServiceError";
    this.code = code;
  }
}

function execGit(args: string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new GitServiceError(
              "GIT_COMMAND_FAILED",
              stderr.trim() || error.message
            )
          );
          return;
        }

        resolve({ stdout, stderr });
      }
    );
  });
}

async function ensureDirectoryExists(targetPath: string): Promise<void> {
  try {
    const targetStat = await stat(targetPath);

    if (!targetStat.isDirectory()) {
      throw new GitServiceError("INVALID_PATH", "选择的路径不是文件夹。");
    }
  } catch (error) {
    if (error instanceof GitServiceError) {
      throw error;
    }

    throw new GitServiceError("PATH_NOT_FOUND", "选择的文件夹不存在或无法访问。");
  }
}

async function ensureGitAvailable(cwd: string): Promise<void> {
  try {
    await execGit(["--version"], cwd);
  } catch {
    throw new GitServiceError(
      "GIT_NOT_FOUND",
      "未检测到 Git 命令，请先确认 Git 已正确安装并可在命令行中使用。"
    );
  }
}

async function ensureInsideWorkTree(candidate: string): Promise<void> {
  try {
    const { stdout } = await execGit(
      ["-C", candidate, "rev-parse", "--is-inside-work-tree"],
      candidate
    );

    if (stdout.trim() !== "true") {
      throw new GitServiceError(
        "NOT_A_GIT_REPO",
        "选择的文件夹不是 Git 仓库，也不在 Git 仓库内部。"
      );
    }
  } catch (error) {
    if (error instanceof GitServiceError) {
      if (error.code === "GIT_COMMAND_FAILED") {
        throw new GitServiceError(
          "NOT_A_GIT_REPO",
          "选择的文件夹不是 Git 仓库，也不在 Git 仓库内部。"
        );
      }

      throw error;
    }

    throw new GitServiceError(
      "NOT_A_GIT_REPO",
      "选择的文件夹不是 Git 仓库，也不在 Git 仓库内部。"
    );
  }
}

async function pathContainsGit(repoPath: string): Promise<boolean> {
  try {
    await access(path.join(repoPath, ".git"));
    return true;
  } catch {
    return false;
  }
}

function normalizeRepoId(repoPath: string, source: RepoSource): string {
  return `${source}:${repoPath.toLowerCase()}`;
}

export async function resolveRepoRoot(inputPath: string): Promise<string> {
  const candidate = path.resolve(inputPath);
  await ensureDirectoryExists(candidate);
  await ensureGitAvailable(candidate);
  await ensureInsideWorkTree(candidate);
  const { stdout } = await execGit(
    ["-C", candidate, "rev-parse", "--show-toplevel"],
    candidate
  );
  return path.resolve(stdout.trim());
}

export async function scanForRepos(rootPath: string): Promise<string[]> {
  const resolvedRoot = path.resolve(rootPath);
  const foundRepos = new Set<string>();

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (await pathContainsGit(currentPath)) {
      foundRepos.add(currentPath);
      return;
    }

    if (depth >= DEFAULT_SCAN_DEPTH) {
      return;
    }

    let entries;

    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    const directories = entries.filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !IGNORED_DIRECTORIES.has(entry.name)
    );

    for (const entry of directories) {
      await walk(path.join(currentPath, entry.name), depth + 1);
    }
  }

  await walk(resolvedRoot, 0);

  return [...foundRepos].sort((left, right) => left.localeCompare(right));
}

export async function getRepoSnapshot(
  repoPath: string,
  source: RepoSource,
  sourcePath: string | null
): Promise<ManagedRepo> {
  const resolvedPath = path.resolve(repoPath);

  try {
    const topLevel = await resolveRepoRoot(resolvedPath);
    const [branchResult, currentResult, statusResult] = await Promise.all([
      execGit(
        ["-C", topLevel, "for-each-ref", "--format=%(refname:short)", "refs/heads"],
        topLevel
      ),
      execGit(["-C", topLevel, "branch", "--show-current"], topLevel),
      execGit(["-C", topLevel, "status", "--porcelain"], topLevel)
    ]);

    const branches = branchResult.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
    const currentBranch = currentResult.stdout.trim() || null;

    return {
      id: normalizeRepoId(topLevel, source),
      name: path.basename(topLevel),
      path: topLevel,
      source,
      sourcePath,
      currentBranch,
      branches,
      dirty: statusResult.stdout.trim().length > 0,
      status: "ready"
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "读取仓库状态失败。";

    return {
      id: normalizeRepoId(resolvedPath, source),
      name: path.basename(resolvedPath),
      path: resolvedPath,
      source,
      sourcePath,
      currentBranch: null,
      branches: [],
      dirty: false,
      status: "error",
      errorMessage: message
    };
  }
}

export async function createBranch(
  repoPath: string,
  branchName: string
): Promise<void> {
  const cleaned = branchName.trim();

  if (!cleaned) {
    throw new GitServiceError("INVALID_BRANCH_NAME", "请输入分支名称。");
  }

  await execGit(["-C", repoPath, "branch", cleaned], repoPath);
}

export async function checkoutBranch(
  repoPath: string,
  branchName: string
): Promise<void> {
  const cleaned = branchName.trim();

  if (!cleaned) {
    throw new GitServiceError("INVALID_BRANCH_NAME", "请输入分支名称。");
  }

  const status = await execGit(["-C", repoPath, "status", "--porcelain"], repoPath);

  if (status.stdout.trim()) {
    throw new GitServiceError(
      "DIRTY_WORKTREE",
      "当前仓库有未提交改动，请先提交、暂存或清理后再切换分支。"
    );
  }

  await execGit(["-C", repoPath, "switch", cleaned], repoPath);
}
