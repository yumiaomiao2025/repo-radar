import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppState,
  DebugInfo,
  EditorId,
  ManagedRepo,
  SettingsData
} from "../shared/types.js";
import { ConfigStore } from "./configStore.js";
import { getEditorAvailability, openInEditor } from "./editorService.js";
import {
  checkoutBranch,
  createBranch,
  getRepoSnapshot,
  resolveRepoRoot,
  scanForRepos
} from "./gitService.js";

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

    for (const repoPath of repos) {
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

async function addScanRoot(selectedPath?: string) {
  const rootPath = selectedPath ?? (await pickDirectoryPath());

  if (!rootPath) {
    return createResult(false, "你还没有选择文件夹。");
  }

  const resolved = path.resolve(rootPath);
  const settings = await getSettings();

  if (settings.scanRootPaths.includes(resolved)) {
    return createResult(true, "这个扫描目录已经添加过了。", await buildAppState());
  }

  await saveSettings({
    ...settings,
    scanRootPaths: [...settings.scanRootPaths, resolved]
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
  await saveSettings({
    ...settings,
    scanRootPaths: settings.scanRootPaths.filter((value) => value !== rootPath)
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
  ipcMain.handle("repo:add-scan-root", async (_event, selectedPath?: string) =>
    addScanRoot(selectedPath)
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
  ipcMain.handle("settings:set-default-editor", async (_event, editor: EditorId) => {
    const settings = await getSettings();
    await saveSettings({
      ...settings,
      defaultEditor: editor
    });

    return createResult(true, `默认编辑器已切换为 ${editor}。`, await buildAppState());
  });
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
