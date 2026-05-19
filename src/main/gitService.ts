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

// 在指定工作目录下执行 git 命令，返回 stdout/stderr；失败时抛出带错误码的 GitServiceError。
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

// 校验目标路径存在且是目录，否则抛出对应错误。
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

// 通过 `git --version` 探测当前环境是否安装了可用的 git 命令。
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

// 校验候选路径位于 Git 工作树内部，非仓库目录会被统一映射为 NOT_A_GIT_REPO 错误。
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

// 判断目录下是否存在 .git 入口，用于快速识别仓库根目录而无需调用 git。
async function pathContainsGit(repoPath: string): Promise<boolean> {
  try {
    await access(path.join(repoPath, ".git"));
    return true;
  } catch {
    return false;
  }
}

// 为仓库生成稳定的唯一 ID，区分手动添加和扫描发现两种来源。
function normalizeRepoId(repoPath: string, source: RepoSource): string {
  return `${source}:${repoPath.toLowerCase()}`;
}

// 把任意路径解析为对应仓库的顶层目录路径，沿途完成存在性、git 可用性、仓库有效性的校验。
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

// 在指定根目录下按有限深度递归扫描，返回所有 Git 仓库的绝对路径，跳过 node_modules 等无关目录。
export async function scanForRepos(rootPath: string): Promise<string[]> {
  const resolvedRoot = path.resolve(rootPath);
  const foundRepos = new Set<string>();

  // 单层递归：遇到仓库直接收集，未到深度上限则继续遍历子目录。
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

// 读取仓库当前的分支列表、当前分支、是否有未提交改动等信息；失败时返回 status="error" 的快照而非抛错。
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

// 基于当前 HEAD 创建一个新的本地分支，不切换到该分支。
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

// 安全地切换分支：当工作区存在未提交改动时直接拒绝，避免覆盖用户修改。
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

// 安全删除本地分支：当前分支会被拒绝，未合并分支由底层 git -d 自动拒绝。
export async function deleteBranch(
  repoPath: string,
  branchName: string
): Promise<void> {
  const cleaned = branchName.trim();

  if (!cleaned) {
    throw new GitServiceError("INVALID_BRANCH_NAME", "请输入分支名称。");
  }

  const current = await execGit(["-C", repoPath, "branch", "--show-current"], repoPath);

  if (current.stdout.trim() === cleaned) {
    throw new GitServiceError("CURRENT_BRANCH", "不能删除当前所在分支。");
  }

  await execGit(["-C", repoPath, "branch", "-d", cleaned], repoPath);
}
