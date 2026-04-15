export type EditorId = "vscode" | "cursor" | "antigravity";

export type RepoSource = "manual" | "scan";

export type RepoStatus = "ready" | "invalid" | "error";

export interface SettingsData {
  manualRepoPaths: string[];
  scanRootPaths: string[];
  defaultEditor: EditorId;
}

export interface EditorAvailability {
  id: EditorId;
  label: string;
  command: string;
  available: boolean;
}

export interface ManagedRepo {
  id: string;
  name: string;
  path: string;
  source: RepoSource;
  sourcePath: string | null;
  currentBranch: string | null;
  branches: string[];
  dirty: boolean;
  status: RepoStatus;
  errorMessage?: string;
}

export interface AppState {
  settings: SettingsData;
  editors: Record<EditorId, EditorAvailability>;
  repos: ManagedRepo[];
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  message: string;
  data?: T;
}

export interface DebugInfo {
  platform: string;
  electron: string;
  chrome: string;
  node: string;
  userDataPath: string;
  isDevServer: boolean;
}

export interface DesktopApi {
  getAppState: () => Promise<AppState>;
  getDebugInfo: () => Promise<DebugInfo>;
  openDevTools: () => Promise<ActionResult>;
  pickDirectory: () => Promise<string | null>;
  addManualRepo: (selectedPath?: string) => Promise<ActionResult<AppState>>;
  addScanRoot: (selectedPath?: string) => Promise<ActionResult<AppState>>;
  removeManualRepo: (repoPath: string) => Promise<ActionResult<AppState>>;
  removeScanRoot: (rootPath: string) => Promise<ActionResult<AppState>>;
  refreshAllRepos: () => Promise<ActionResult<AppState>>;
  refreshRepo: (repoPath: string) => Promise<ActionResult<ManagedRepo>>;
  createBranch: (
    repoPath: string,
    branchName: string
  ) => Promise<ActionResult<ManagedRepo>>;
  checkoutBranch: (
    repoPath: string,
    branchName: string
  ) => Promise<ActionResult<ManagedRepo>>;
  openInEditor: (
    repoPath: string,
    editor: EditorId
  ) => Promise<ActionResult>;
  setDefaultEditor: (editor: EditorId) => Promise<ActionResult<AppState>>;
}
