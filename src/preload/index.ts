import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi, EditorId } from "../shared/types.js";

const api: DesktopApi = {
  getAppState: () => ipcRenderer.invoke("app:get-state"),
  getDebugInfo: () => ipcRenderer.invoke("app:get-debug-info"),
  openDevTools: () => ipcRenderer.invoke("app:open-devtools"),
  pickDirectory: () => ipcRenderer.invoke("dialog:pick-directory"),
  addManualRepo: (selectedPath?: string) =>
    ipcRenderer.invoke("repo:add-manual", selectedPath),
  addScanRoot: (selectedPath?: string) =>
    ipcRenderer.invoke("repo:add-scan-root", selectedPath),
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
  openInEditor: (repoPath: string, editor: EditorId) =>
    ipcRenderer.invoke("app:open-editor", repoPath, editor),
  setDefaultEditor: (editor: EditorId) =>
    ipcRenderer.invoke("settings:set-default-editor", editor)
};

contextBridge.exposeInMainWorld("desktopApi", api);
