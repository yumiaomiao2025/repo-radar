import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi, EditorId, ThemeId } from "../shared/types.js";

// 通过 contextBridge 暴露给渲染层的 IPC 桥接对象，所有方法都是对 ipcRenderer.invoke 的薄包装。
const api: DesktopApi = {
  getAppState: () => ipcRenderer.invoke("app:get-state"),
  getDebugInfo: () => ipcRenderer.invoke("app:get-debug-info"),
  openDevTools: () => ipcRenderer.invoke("app:open-devtools"),
  pickDirectory: () => ipcRenderer.invoke("dialog:pick-directory"),
  addManualRepo: (selectedPath?: string) =>
    ipcRenderer.invoke("repo:add-manual", selectedPath),
  previewScanRoot: (selectedPath: string) =>
    ipcRenderer.invoke("repo:preview-scan-root", selectedPath),
  addScanRoot: (selectedPath?: string, selectedRepoPaths?: string[]) =>
    ipcRenderer.invoke("repo:add-scan-root", selectedPath, selectedRepoPaths),
  removeManualRepo: (repoPath: string) =>
    ipcRenderer.invoke("repo:remove-manual", repoPath),
  removeScanRoot: (rootPath: string) =>
    ipcRenderer.invoke("repo:remove-scan-root", rootPath),
  refreshAllRepos: () => ipcRenderer.invoke("repo:refresh-all"),
  refreshRepo: (repoPath: string) =>
    ipcRenderer.invoke("repo:refresh-one", repoPath),
  createBranch: (repoPath: string, branchName: string) =>
    ipcRenderer.invoke("repo:create-branch", repoPath, branchName),
  checkoutBranch: (repoPath: string, branchName: string) =>
    ipcRenderer.invoke("repo:checkout-branch", repoPath, branchName),
  deleteBranch: (repoPath: string, branchName: string) =>
    ipcRenderer.invoke("repo:delete-branch", repoPath, branchName),
  openInEditor: (repoPath: string, editor: EditorId) =>
    ipcRenderer.invoke("app:open-editor", repoPath, editor),
  openInTerminal: (
    repoPath: string,
    terminal: "windowsTerminal" | "powershell"
  ) => ipcRenderer.invoke("app:open-terminal", repoPath, terminal),
  copyRepoPath: (repoPath: string) =>
    ipcRenderer.invoke("app:copy-repo-path", repoPath),
  setRepoTags: (repoPath: string, tags: string[]) =>
    ipcRenderer.invoke("settings:set-repo-tags", repoPath, tags),
  setBranchAlias: (repoPath: string, branchName: string, alias: string) =>
    ipcRenderer.invoke("settings:set-branch-alias", repoPath, branchName, alias),
  setBranchTags: (repoPath: string, branchName: string, tags: string[]) =>
    ipcRenderer.invoke("settings:set-branch-tags", repoPath, branchName, tags),
  setRepoCardMaxHeight: (maxHeight: number | null) =>
    ipcRenderer.invoke("settings:set-repo-card-max-height", maxHeight),
  setBranchNode: (repoPath: string, branchName: string, node: string) =>
    ipcRenderer.invoke("settings:set-branch-node", repoPath, branchName, node),
  setBranchNodeOptions: (options: string[]) =>
    ipcRenderer.invoke("settings:set-branch-node-options", options),
  setRepoBranchNodeOptions: (repoPath: string, options: string[] | null) =>
    ipcRenderer.invoke("settings:set-repo-branch-node-options", repoPath, options),
  openConfigDirectory: () => ipcRenderer.invoke("app:open-config-dir"),
  exportSettings: () => ipcRenderer.invoke("settings:export"),
  importSettings: () => ipcRenderer.invoke("settings:import"),
  setTheme: (theme: ThemeId) => ipcRenderer.invoke("settings:set-theme", theme),
  checkForUpdates: () => ipcRenderer.invoke("app:check-updates"),
  openExternalUrl: (url: string) => ipcRenderer.invoke("app:open-external", url)
};

contextBridge.exposeInMainWorld("desktopApi", api);
