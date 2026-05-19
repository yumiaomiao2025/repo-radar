import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppState,
  DebugInfo,
  EditorId,
  ManagedRepo,
  ScanPreview,
  SettingsData,
  ThemeId,
  UpdateInfo
} from "../shared/types.js";
import { ConfigStore } from "./configStore.js";
import { getEditorAvailability, openInEditor } from "./editorService.js";
import {
  checkoutBranch,
  createBranch,
  deleteBranch as deleteLocalBranch,
  getRepoSnapshot,
  resolveRepoRoot,
  scanForRepos
} from "./gitService.js";
import { openInTerminal, type TerminalId } from "./terminalService.js";

// 移除潜在的 SSL key 日志环境变量，避免敏感数据被无意写入磁盘。
delete process.env.SSLKEYLOGFILE;
delete process.env.NSS_SSLKEYLOGFILE;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configStore = new ConfigStore();
const editorLabelMap: Record<EditorId, string> = {
  vscode: "VS Code",
  cursor: "Cursor",
  antigravity: "Antigravity"
};

let mainWindow: BrowserWindow | null = null;
let settingsCache: SettingsData | null = null;

// 通过环境变量判断是否在启动时自动打开开发者工具。
function shouldOpenDevTools(): boolean {
  const flag = process.env.OPEN_DEVTOOLS;
  return flag === "1" || flag === "true";
}

// 收集运行环境信息（应用版本、平台、Electron/Chrome/Node 版本等），供渲染层诊断面板展示。
function buildDebugInfo(): DebugInfo {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    userDataPath: app.getPath("userData"),
    isDevServer: Boolean(process.env.VITE_DEV_SERVER_URL)
  };
}

// 切换给定窗口的开发者工具显示状态，默认以分离窗口模式打开。
function toggleDevTools(window: BrowserWindow) {
  if (window.webContents.isDevToolsOpened()) {
    window.webContents.closeDevTools();
    return;
  }

  window.webContents.openDevTools({ mode: "detach" });
}

// 判断仓库路径是否位于指定扫描根目录的内部（含相等情况）。
function isRepoWithinRoot(repoPath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, repoPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

// 读取设置（带内存缓存），首次访问时从磁盘加载并缓存到 settingsCache。
async function getSettings(): Promise<SettingsData> {
  if (!settingsCache) {
    settingsCache = await configStore.load();
  }

  return settingsCache;
}

// 写入设置到磁盘并同步刷新缓存，保证后续读到的是最新值。
async function saveSettings(nextSettings: SettingsData): Promise<SettingsData> {
  settingsCache = await configStore.save(nextSettings);
  return settingsCache;
}

// 构造统一的 IPC 响应体，方便渲染层根据 ok 字段做成功/失败分支处理。
function createResult<T>(ok: boolean, message: string, data?: T) {
  return { ok, message, data };
}

// 从未知类型的异常中提取可读信息，没有可用信息时回退到调用方提供的提示文案。
function formatError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

// 对标签数组去重、过滤空值并按字典序排序，保持配置内顺序稳定。
function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

// 汇总当前完整的应用状态：设置、编辑器可用性、所有手动/扫描发现的仓库快照。
async function buildAppState(): Promise<AppState> {
  const settings = await getSettings();
  const editors = await getEditorAvailability();
  const repoMap = new Map<string, ManagedRepo>();

  for (const manualRepoPath of settings.manualRepoPaths) {
    const repo = await getRepoSnapshot(manualRepoPath, "manual", null);
    repoMap.set(repo.path.toLowerCase(), repo);
  }

  for (const rootPath of settings.scanRootPaths) {
    const repos = await scanForRepos(rootPath);
    const selectedRepoPaths = settings.scanRootSelections[rootPath];
    const selectedRepoSet = selectedRepoPaths
      ? new Set(selectedRepoPaths.map((repoPath) => path.resolve(repoPath).toLowerCase()))
      : null;

    for (const repoPath of repos) {
      if (selectedRepoSet && !selectedRepoSet.has(path.resolve(repoPath).toLowerCase())) {
        continue;
      }

      const repo = await getRepoSnapshot(repoPath, "scan", rootPath);

      if (!repoMap.has(repo.path.toLowerCase())) {
        repoMap.set(repo.path.toLowerCase(), repo);
      }
    }
  }

  return {
    settings,
    editors,
    repos: [...repoMap.values()].sort((left, right) =>
      left.name.localeCompare(right.name) || left.path.localeCompare(right.path)
    )
  };
}

// 弹出系统目录选择器并返回选中的绝对路径；用户取消则返回 null。
async function pickDirectoryPath(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

// 添加单个手动仓库：校验是否为合法 Git 仓库，去重后写入设置。
async function addManualRepo(selectedPath?: string) {
  const repoPath = selectedPath ?? (await pickDirectoryPath());

  if (!repoPath) {
    return createResult(false, "你还没有选择文件夹。");
  }

  try {
    const repoRoot = await resolveRepoRoot(repoPath);
    const settings = await getSettings();

    if (settings.manualRepoPaths.includes(repoRoot)) {
      return createResult(true, "这个仓库已经添加过了。", await buildAppState());
    }

    await saveSettings({
      ...settings,
      manualRepoPaths: [...settings.manualRepoPaths, repoRoot]
    });

    return createResult(true, `已添加仓库：${repoRoot}`, await buildAppState());
  } catch (error) {
    return createResult(false, formatError(error, "添加仓库失败。"));
  }
}

// 预览扫描目录下的仓库列表，但不写入设置；供前端弹出确认对话框使用。
async function previewScanRoot(selectedPath: string) {
  const resolved = path.resolve(selectedPath);
  const repoPaths = await scanForRepos(resolved);
  const repos = await Promise.all(
    repoPaths.map((repoPath) => getRepoSnapshot(repoPath, "scan", resolved))
  );
  const preview: ScanPreview = {
    rootPath: resolved,
    repos
  };

  return createResult(true, `扫描到 ${repos.length} 个仓库。`, preview);
}

// 添加或更新扫描目录：可附带要纳入管理的仓库子集，已存在的根目录走更新分支。
async function addScanRoot(selectedPath?: string, selectedRepoPaths?: string[]) {
  const rootPath = selectedPath ?? (await pickDirectoryPath());

  if (!rootPath) {
    return createResult(false, "你还没有选择文件夹。");
  }

  const resolved = path.resolve(rootPath);
  const settings = await getSettings();
  const selectedRepos = (selectedRepoPaths ?? []).map((repoPath) =>
    path.resolve(repoPath)
  );

  if (selectedRepoPaths && selectedRepos.length === 0) {
    return createResult(false, "请至少选择一个要添加的仓库。");
  }

  if (settings.scanRootPaths.includes(resolved)) {
    await saveSettings({
      ...settings,
      scanRootSelections: selectedRepoPaths
        ? {
            ...settings.scanRootSelections,
            [resolved]: selectedRepos
          }
        : settings.scanRootSelections
    });

    return createResult(true, "这个扫描目录已更新。", await buildAppState());
  }

  await saveSettings({
    ...settings,
    scanRootPaths: [...settings.scanRootPaths, resolved],
    scanRootSelections: selectedRepoPaths
      ? {
          ...settings.scanRootSelections,
          [resolved]: selectedRepos
        }
      : settings.scanRootSelections
  });

  return createResult(true, `已添加扫描目录：${resolved}`, await buildAppState());
}

// 从手动仓库列表中移除指定路径，不影响其它扫描来源的仓库。
async function removeManualRepo(repoPath: string) {
  const settings = await getSettings();
  await saveSettings({
    ...settings,
    manualRepoPaths: settings.manualRepoPaths.filter((value) => value !== repoPath)
  });

  return createResult(true, `已移除仓库：${repoPath}`, await buildAppState());
}

// 删除扫描目录及其关联的选择记录。
async function removeScanRoot(rootPath: string) {
  const settings = await getSettings();
  const { [rootPath]: _removed, ...scanRootSelections } = settings.scanRootSelections;

  await saveSettings({
    ...settings,
    scanRootPaths: settings.scanRootPaths.filter((value) => value !== rootPath),
    scanRootSelections
  });

  return createResult(true, `已移除扫描目录：${rootPath}`, await buildAppState());
}

// 推断给定仓库路径属于手动添加还是扫描发现，并返回其归属的扫描根目录（若有）。
function resolveRepoSource(
  settings: SettingsData,
  repoPath: string
): {
  source: "manual" | "scan";
  sourcePath: string | null;
} {
  if (settings.manualRepoPaths.includes(repoPath)) {
    return { source: "manual", sourcePath: null };
  }

  const sourcePath =
    settings.scanRootPaths.find((scanRoot) => isRepoWithinRoot(repoPath, scanRoot)) ?? null;

  return { source: "scan", sourcePath };
}

// 重新读取仓库快照并以带提示的 ActionResult 返回，供用户点击“刷新”时使用。
async function refreshRepo(repoPath: string) {
  const repo = await refreshRepoAfterChange(repoPath);
  return createResult(true, `已刷新 ${repo.name}`, repo);
}

// 仓库内部状态变化（如创建/切换/删除分支）后重新获取一次快照，不附带用户提示。
async function refreshRepoAfterChange(repoPath: string) {
  const settings = await getSettings();
  const { source, sourcePath } = resolveRepoSource(settings, repoPath);
  return getRepoSnapshot(repoPath, source, sourcePath);
}

// 覆盖某个仓库的标签集合。
async function setRepoTags(repoPath: string, tags: string[]) {
  const settings = await getSettings();
  await saveSettings({
    ...settings,
    repoTags: {
      ...settings.repoTags,
      [path.resolve(repoPath)]: uniqueTags(tags)
    }
  });

  return createResult(true, "仓库标签已更新。", await buildAppState());
}

// 设置或清除某个分支的别名；传入空字符串时自动移除该条记录。
async function setBranchAlias(repoPath: string, branchName: string, alias: string) {
  const settings = await getSettings();
  const resolved = path.resolve(repoPath);
  const branchAliases = {
    ...(settings.branchAliases[resolved] ?? {}),
    [branchName]: alias.trim()
  };

  if (!branchAliases[branchName]) {
    delete branchAliases[branchName];
  }

  await saveSettings({
    ...settings,
    branchAliases: {
      ...settings.branchAliases,
      [resolved]: branchAliases
    }
  });

  return createResult(true, "分支别名已更新。", await buildAppState());
}

// 设置或清除某个分支的标签列表；空数组会自动移除该条记录。
async function setBranchTags(repoPath: string, branchName: string, tags: string[]) {
  const settings = await getSettings();
  const resolved = path.resolve(repoPath);
  const branchTags = {
    ...(settings.branchTags[resolved] ?? {}),
    [branchName]: uniqueTags(tags)
  };

  if (branchTags[branchName].length === 0) {
    delete branchTags[branchName];
  }

  await saveSettings({
    ...settings,
    branchTags: {
      ...settings.branchTags,
      [resolved]: branchTags
    }
  });

  return createResult(true, "分支标签已更新。", await buildAppState());
}

// 更新全局的仓库卡片最大高度（null 表示不限）。
async function setRepoCardMaxHeight(maxHeight: number | null) {
  const settings = await getSettings();

  await saveSettings({
    ...settings,
    repoCardMaxHeight: maxHeight
  });

  return createResult(true, "卡片高度设置已更新。", await buildAppState());
}

// 删除某条分支时同步清理它绑定的别名、标签、进度等元数据，防止配置残留。
async function removeBranchMeta(repoPath: string, branchName: string) {
  const settings = await getSettings();
  const resolved = path.resolve(repoPath);
  const branchAliases = { ...(settings.branchAliases[resolved] ?? {}) };
  const branchTags = { ...(settings.branchTags[resolved] ?? {}) };
  const branchNodes = { ...(settings.branchNodes[resolved] ?? {}) };

  delete branchAliases[branchName];
  delete branchTags[branchName];
  delete branchNodes[branchName];

  await saveSettings({
    ...settings,
    branchAliases: {
      ...settings.branchAliases,
      [resolved]: branchAliases
    },
    branchTags: {
      ...settings.branchTags,
      [resolved]: branchTags
    },
    branchNodes: {
      ...settings.branchNodes,
      [resolved]: branchNodes
    }
  });
}

// 仓库雷达发布所在的 GitHub 仓库（owner/repo）。上传到 GitHub 后请改成你自己的。
const GITHUB_REPO = "https://github.com/yumiaomiao2025/repo-radar";

// 把形如 "1.2.3" / "v1.2.3" / "1.2.3-beta" 的版本号比较为整数排序：left>right 返回正数。
function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(/[.-]/)
      .map((segment) => {
        const numeric = Number(segment);
        return Number.isFinite(numeric) ? numeric : 0;
      });

  const leftParts = parse(left);
  const rightParts = parse(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

// 通过 GitHub Releases API 查询最新版本，并与当前 app.getVersion() 比较得出是否有更新。
async function checkForUpdates() {
  const current = app.getVersion();
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const fallbackUrl = `https://github.com/${GITHUB_REPO}/releases`;

  try {
    const response = await fetch(apiUrl, {
      headers: { Accept: "application/vnd.github+json" }
    });

    if (response.status === 404) {
      return createResult(false, "尚未发布过 release，请先在 GitHub 创建一个 release。");
    }

    if (!response.ok) {
      return createResult(false, `检查更新失败：HTTP ${response.status}`);
    }

    const data = (await response.json()) as { tag_name?: string; html_url?: string };
    const latest = (data.tag_name ?? "").replace(/^v/, "");
    const url = data.html_url ?? fallbackUrl;
    const hasUpdate = latest.length > 0 && compareVersions(latest, current) > 0;

    const payload: UpdateInfo = { current, latest, hasUpdate, url };
    return createResult(true, hasUpdate ? "发现新版本。" : "已是最新版本。", payload);
  } catch (error) {
    return createResult(false, formatError(error, "无法连接到 GitHub。"));
  }
}

// 使用系统默认浏览器打开外部链接，仅允许 http(s) 协议以避免被滥用。
async function openExternalUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) {
    return createResult(false, "只允许打开 http(s) 链接。");
  }

  try {
    await shell.openExternal(url);
    return createResult(true, "已在浏览器中打开链接。");
  } catch (error) {
    return createResult(false, formatError(error, "打开链接失败。"));
  }
}

// 切换应用主题并持久化。
async function setTheme(theme: ThemeId) {
  const settings = await getSettings();

  await saveSettings({
    ...settings,
    theme
  });

  return createResult(true, "主题已更新。", await buildAppState());
}

// 在系统文件管理器中打开当前的配置目录，方便用户直接查看/备份 settings.json。
async function openConfigDirectory() {
  const dirPath = app.getPath("userData");

  try {
    const errorMessage = await shell.openPath(dirPath);

    if (errorMessage) {
      return createResult(false, errorMessage);
    }

    return createResult(true, `已打开配置目录：${dirPath}`);
  } catch (error) {
    return createResult(false, formatError(error, "打开配置目录失败。"));
  }
}

// 弹出保存对话框，将当前设置导出为可读 JSON 文件。
async function exportSettings() {
  if (!mainWindow) {
    return createResult(false, "主窗口还没有准备好。");
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出设置",
    defaultPath: `repo-radar-settings-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON 文件", extensions: ["json"] }]
  });

  if (result.canceled || !result.filePath) {
    return createResult(false, "已取消导出。");
  }

  try {
    const settings = await getSettings();
    await writeFile(result.filePath, JSON.stringify(settings, null, 2), "utf8");
    return createResult(true, `已导出设置：${result.filePath}`, result.filePath);
  } catch (error) {
    return createResult(false, formatError(error, "导出设置失败。"));
  }
}

// 从用户选择的 JSON 文件中导入设置，经过 sanitize 校验后覆盖当前配置。
async function importSettings() {
  if (!mainWindow) {
    return createResult(false, "主窗口还没有准备好。");
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "导入设置",
    properties: ["openFile"],
    filters: [{ name: "JSON 文件", extensions: ["json"] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return createResult(false, "已取消导入。");
  }

  try {
    const raw = await readFile(result.filePaths[0], "utf8");
    const parsed = JSON.parse(raw) as Partial<SettingsData>;
    const sanitized = configStore.sanitize(parsed);
    await saveSettings(sanitized);
    return createResult(true, "已导入设置。", await buildAppState());
  } catch (error) {
    return createResult(false, formatError(error, "导入设置失败：文件格式无效。"));
  }
}

// 设置或清除某个分支的进度节点；空字符串视为清除。
async function setBranchNode(repoPath: string, branchName: string, node: string) {
  const settings = await getSettings();
  const resolved = path.resolve(repoPath);
  const trimmed = node.trim();
  const branchNodes = { ...(settings.branchNodes[resolved] ?? {}) };

  if (trimmed) {
    branchNodes[branchName] = trimmed;
  } else {
    delete branchNodes[branchName];
  }

  await saveSettings({
    ...settings,
    branchNodes: {
      ...settings.branchNodes,
      [resolved]: branchNodes
    }
  });

  return createResult(true, "分支进度已更新。", await buildAppState());
}

// 为指定仓库覆盖一份独立的进度选项；传入 null 或空数组表示删除覆盖、回退到全局默认。
async function setRepoBranchNodeOptions(repoPath: string, options: string[] | null) {
  const settings = await getSettings();
  const resolved = path.resolve(repoPath);
  const next = { ...settings.repoBranchNodeOptions };

  if (options && options.length > 0) {
    next[resolved] = [...new Set(options.map((value) => value.trim()).filter(Boolean))];
    if (next[resolved].length === 0) {
      delete next[resolved];
    }
  } else {
    delete next[resolved];
  }

  await saveSettings({
    ...settings,
    repoBranchNodeOptions: next
  });

  return createResult(true, "仓库进度选项已更新。", await buildAppState());
}

// 覆盖全局可选的分支进度选项列表（如：已开发/已联调/已 review）。
async function setBranchNodeOptions(options: string[]) {
  const settings = await getSettings();
  const normalized = [
    ...new Set(options.map((value) => value.trim()).filter(Boolean))
  ];

  await saveSettings({
    ...settings,
    branchNodeOptions: normalized
  });

  return createResult(true, "进度选项已更新。", await buildAppState());
}

// 创建主窗口并装配渲染层入口、preload 桥接、菜单隐藏、快捷键和日志桥接。
async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#0d111a",
    title: "仓库雷达",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  // 在 Electron 默认菜单被隐藏后，仍通过键盘事件支持 F12 / Ctrl+Shift+I 切换 DevTools。
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const shouldToggle =
      input.type === "keyDown" &&
      (input.key === "F12" ||
        ((input.control || input.meta) &&
          input.shift &&
          input.key.toLowerCase() === "i"));

    if (!shouldToggle) {
      return;
    }

    event.preventDefault();
    toggleDevTools(mainWindow!);
  });

  // 把渲染层的 console 输出转发到主进程日志，便于在终端中观察运行状态。
  mainWindow.webContents.on("console-message", (details) => {
    const source = details.sourceId
      ? `${details.sourceId}:${details.lineNumber}`
      : "renderer";
    const prefix = `[renderer:${source}]`;

    if (details.level === "warning" || details.level === "error") {
      console.error(`${prefix} ${details.message}`);
      return;
    }

    console.log(`${prefix} ${details.message}`);
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[main] Renderer load failed (${errorCode}) ${errorDescription} at ${validatedURL}`
      );
    }
  );

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);

    if (shouldOpenDevTools()) {
      toggleDevTools(mainWindow);
    }
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
  }
}

// 注册所有 ipcMain 处理器，把前端的请求路由到对应的业务函数。
function registerIpcHandlers() {
  ipcMain.handle("app:get-state", async () => buildAppState());
  ipcMain.handle("app:get-debug-info", async () => buildDebugInfo());
  ipcMain.handle("app:open-devtools", async () => {
    if (!mainWindow) {
      return createResult(false, "主窗口还没有准备好。");
    }

    toggleDevTools(mainWindow);
    return createResult(true, "已切换开发者工具。");
  });
  ipcMain.handle("dialog:pick-directory", async () => pickDirectoryPath());
  ipcMain.handle("repo:add-manual", async (_event, selectedPath?: string) =>
    addManualRepo(selectedPath)
  );
  ipcMain.handle(
    "repo:add-scan-root",
    async (_event, selectedPath?: string, selectedRepoPaths?: string[]) =>
      addScanRoot(selectedPath, selectedRepoPaths)
  );
  ipcMain.handle("repo:preview-scan-root", async (_event, selectedPath: string) =>
    previewScanRoot(selectedPath)
  );
  ipcMain.handle("repo:remove-manual", async (_event, repoPath: string) =>
    removeManualRepo(repoPath)
  );
  ipcMain.handle("repo:remove-scan-root", async (_event, rootPath: string) =>
    removeScanRoot(rootPath)
  );
  ipcMain.handle("repo:refresh-all", async () =>
    createResult(true, "已刷新全部仓库。", await buildAppState())
  );
  ipcMain.handle("repo:refresh-one", async (_event, repoPath: string) =>
    refreshRepo(repoPath)
  );
  ipcMain.handle(
    "repo:create-branch",
    async (_event, repoPath: string, branchName: string) => {
      try {
        await createBranch(repoPath, branchName);
        const repo = await refreshRepoAfterChange(repoPath);
        return createResult(true, `已创建分支：${branchName}`, repo);
      } catch (error) {
        return createResult(false, formatError(error, "创建分支失败。"));
      }
    }
  );
  ipcMain.handle(
    "repo:checkout-branch",
    async (_event, repoPath: string, branchName: string) => {
      try {
        await checkoutBranch(repoPath, branchName);
        const repo = await refreshRepoAfterChange(repoPath);
        return createResult(true, `已切换到分支：${branchName}`, repo);
      } catch (error) {
        return createResult(false, formatError(error, "切换分支失败。"));
      }
    }
  );
  ipcMain.handle(
    "repo:delete-branch",
    async (_event, repoPath: string, branchName: string) => {
      try {
        await deleteLocalBranch(repoPath, branchName);
        await removeBranchMeta(repoPath, branchName);
        const repo = await refreshRepoAfterChange(repoPath);
        return createResult(true, `已删除本地分支：${branchName}`, repo);
      } catch (error) {
        return createResult(false, formatError(error, "删除分支失败。"));
      }
    }
  );
  ipcMain.handle(
    "app:open-editor",
    async (_event, repoPath: string, editor: EditorId) => {
      try {
        await openInEditor(editor, repoPath);
        return createResult(true, `已使用 ${editorLabelMap[editor]} 打开仓库。`);
      } catch (error) {
        return createResult(false, formatError(error, "打开编辑器失败。"));
      }
    }
  );
  ipcMain.handle(
    "app:open-terminal",
    async (_event, repoPath: string, terminal: TerminalId) => {
      try {
        openInTerminal(repoPath, terminal);
        return createResult(
          true,
          terminal === "windowsTerminal"
            ? "已用 Windows Terminal 打开仓库。"
            : "已用 PowerShell 打开仓库。"
        );
      } catch (error) {
        return createResult(false, formatError(error, "打开终端失败。"));
      }
    }
  );
  ipcMain.handle("app:copy-repo-path", async (_event, repoPath: string) => {
    clipboard.writeText(repoPath);
    return createResult(true, "仓库路径已复制。");
  });
  ipcMain.handle("settings:set-repo-tags", async (_event, repoPath: string, tags: string[]) =>
    setRepoTags(repoPath, tags)
  );
  ipcMain.handle(
    "settings:set-branch-alias",
    async (_event, repoPath: string, branchName: string, alias: string) =>
      setBranchAlias(repoPath, branchName, alias)
  );
  ipcMain.handle(
    "settings:set-branch-tags",
    async (_event, repoPath: string, branchName: string, tags: string[]) =>
      setBranchTags(repoPath, branchName, tags)
  );
  ipcMain.handle(
    "settings:set-repo-card-max-height",
    async (_event, maxHeight: number | null) => setRepoCardMaxHeight(maxHeight)
  );
  ipcMain.handle(
    "settings:set-branch-node",
    async (_event, repoPath: string, branchName: string, node: string) =>
      setBranchNode(repoPath, branchName, node)
  );
  ipcMain.handle(
    "settings:set-branch-node-options",
    async (_event, options: string[]) => setBranchNodeOptions(options)
  );
  ipcMain.handle(
    "settings:set-repo-branch-node-options",
    async (_event, repoPath: string, options: string[] | null) =>
      setRepoBranchNodeOptions(repoPath, options)
  );
  ipcMain.handle("app:open-config-dir", async () => openConfigDirectory());
  ipcMain.handle("settings:export", async () => exportSettings());
  ipcMain.handle("settings:import", async () => importSettings());
  ipcMain.handle("settings:set-theme", async (_event, theme: ThemeId) => setTheme(theme));
  ipcMain.handle("app:check-updates", async () => checkForUpdates());
  ipcMain.handle("app:open-external", async (_event, url: string) => openExternalUrl(url));
}

// 应用启动入口：注册 IPC 处理器并创建主窗口，macOS 下重新激活时按需重建窗口。
app.whenReady().then(async () => {
  registerIpcHandlers();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

// 在非 macOS 平台上，关闭全部窗口即退出应用。
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
