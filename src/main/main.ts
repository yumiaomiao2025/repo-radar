import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppState,
  DebugInfo,
  EditorId,
  ManagedRepo,
  ScanPreview,
  SettingsData
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

function shouldOpenDevTools(): boolean {
  const flag = process.env.OPEN_DEVTOOLS;
  return flag === "1" || flag === "true";
}

function buildDebugInfo(): DebugInfo {
  return {
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    userDataPath: app.getPath("userData"),
    isDevServer: Boolean(process.env.VITE_DEV_SERVER_URL)
  };
}

function toggleDevTools(window: BrowserWindow) {
  if (window.webContents.isDevToolsOpened()) {
    window.webContents.closeDevTools();
    return;
  }

  window.webContents.openDevTools({ mode: "detach" });
}

function isRepoWithinRoot(repoPath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, repoPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function getSettings(): Promise<SettingsData> {
  if (!settingsCache) {
    settingsCache = await configStore.load();
  }

  return settingsCache;
}

async function saveSettings(nextSettings: SettingsData): Promise<SettingsData> {
  settingsCache = await configStore.save(nextSettings);
  return settingsCache;
}

function createResult<T>(ok: boolean, message: string, data?: T) {
  return { ok, message, data };
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

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

async function pickDirectoryPath(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

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

async function removeManualRepo(repoPath: string) {
  const settings = await getSettings();
  await saveSettings({
    ...settings,
    manualRepoPaths: settings.manualRepoPaths.filter((value) => value !== repoPath)
  });

  return createResult(true, `已移除仓库：${repoPath}`, await buildAppState());
}

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

function resolveRepoSource(
  settings: SettingsData,
  repoPath: string
): {
  source: "manual" | "scan";
  sourcePath: string | null;
} {
  if (settings.manualRepoPaths.includes(repoPath)) {
    return {
      source: "manual",
      sourcePath: null
    };
  }

  const sourcePath =
    settings.scanRootPaths.find((scanRoot) => isRepoWithinRoot(repoPath, scanRoot)) ??
    null;

  return {
    source: "scan",
    sourcePath
  };
}

async function refreshRepo(repoPath: string) {
  const settings = await getSettings();
  const { source, sourcePath } = resolveRepoSource(settings, repoPath);
  const repo = await getRepoSnapshot(repoPath, source, sourcePath);

  return createResult(true, `已刷新 ${repo.name}`, repo);
}

async function refreshRepoAfterChange(repoPath: string) {
  const settings = await getSettings();
  const { source, sourcePath } = resolveRepoSource(settings, repoPath);
  return getRepoSnapshot(repoPath, source, sourcePath);
}

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

async function removeBranchMeta(repoPath: string, branchName: string) {
  const settings = await getSettings();
  const resolved = path.resolve(repoPath);
  const branchAliases = { ...(settings.branchAliases[resolved] ?? {}) };
  const branchTags = { ...(settings.branchTags[resolved] ?? {}) };

  delete branchAliases[branchName];
  delete branchTags[branchName];

  await saveSettings({
    ...settings,
    branchAliases: {
      ...settings.branchAliases,
      [resolved]: branchAliases
    },
    branchTags: {
      ...settings.branchTags,
      [resolved]: branchTags
    }
  });
}

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
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
