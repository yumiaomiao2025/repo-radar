export type EditorId = "vscode" | "cursor" | "antigravity";

export type RepoSource = "manual" | "scan";

export type RepoStatus = "ready" | "invalid" | "error";

export interface SettingsData {
  manualRepoPaths: string[];
  scanRootPaths: string[];
  scanRootSelections: Record<string, string[]>;
  repoTags: Record<string, string[]>;
  branchAliases: Record<string, Record<string, string>>;
  branchTags: Record<string, Record<string, string[]>>;
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

export interface ScanPreview {
  rootPath: string;
  repos: ManagedRepo[];
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
  previewScanRoot: (selectedPath: string) => Promise<ActionResult<ScanPreview>>;
  addScanRoot: (
    selectedPath?: string,
    selectedRepoPaths?: string[]
  ) => Promise<ActionResult<AppState>>;
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
  deleteBranch: (
    repoPath: string,
    branchName: string
  ) => Promise<ActionResult<ManagedRepo>>;
  openInEditor: (
    repoPath: string,
    editor: EditorId
  ) => Promise<ActionResult>;
  openInTerminal: (
    repoPath: string,
    terminal: "windowsTerminal" | "powershell"
  ) => Promise<ActionResult>;
  copyRepoPath: (repoPath: string) => Promise<ActionResult>;
  setRepoTags: (
    repoPath: string,
    tags: string[]
  ) => Promise<ActionResult<AppState>>;
  setBranchAlias: (
    repoPath: string,
    branchName: string,
    alias: string
  ) => Promise<ActionResult<AppState>>;
  setBranchTags: (
    repoPath: string,
    branchName: string,
    tags: string[]
  ) => Promise<ActionResult<AppState>>;
}
