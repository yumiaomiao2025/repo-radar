import { useEffect, useState } from "react";
import {
  ChevronDown,
  Code2,
  Copy,
  Edit3,
  GitBranchPlus,
  Plus,
  RefreshCw,
  Settings2,
  Tags,
  Terminal,
  Trash2,
  X,
  ArrowRightLeft
} from "lucide-react";
import type {
  AppState,
  DebugInfo,
  EditorId,
  ManagedRepo,
  ScanPreview
} from "../shared/types";

type Toast = {
  tone: "success" | "error" | "info";
  text: string;
};

type DebugEntry = {
  id: string;
  level: "info" | "error";
  source: "ui" | "ipc" | "runtime";
  text: string;
  timestamp: string;
};

type ScanConfirmState = ScanPreview & {
  selectedPaths: string[];
};

type EditingBranch = {
  repoPath: string;
  branchName: string;
};

type RepoDisplayKey =
  | "status"
  | "source"
  | "meta"
  | "repoTags"
  | "branchNames"
  | "branchAliases"
  | "branchTags";

const repoDisplayOptions: Array<{ key: RepoDisplayKey; label: string }> = [
  { key: "status", label: "状态徽标" },
  { key: "source", label: "来源" },
  { key: "meta", label: "统计信息" },
  { key: "repoTags", label: "仓库标签" },
  { key: "branchNames", label: "分支名称" },
  { key: "branchAliases", label: "分支别名" },
  { key: "branchTags", label: "分支标签" }
];

function formatSource(repo: ManagedRepo): string {
  return repo.source === "manual"
    ? "手动添加"
    : repo.sourcePath
      ? `来自扫描目录：${repo.sourcePath}`
      : "扫描发现";
}

function formatSourceTag(repo: ManagedRepo): string {
  return repo.source === "manual" ? "手动添加" : "扫描添加";
}

const EMPTY_STATE: AppState = {
  settings: {
    manualRepoPaths: [],
    scanRootPaths: [],
    scanRootSelections: {},
    repoTags: {},
    branchAliases: {},
    branchTags: {}
  },
  editors: {
    vscode: {
      id: "vscode",
      label: "VS Code",
      command: "code",
      available: false
    },
    cursor: {
      id: "cursor",
      label: "Cursor",
      command: "cursor",
      available: false
    },
    antigravity: {
      id: "antigravity",
      label: "Antigravity",
      command: "antigravity",
      available: false
    }
  },
  repos: []
};

function formatStatus(status: ManagedRepo["status"]): string {
  if (status === "ready") {
    return "正常";
  }

  if (status === "invalid") {
    return "无效";
  }

  return "异常";
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

function branchMetaKey(repoPath: string, branchName: string): string {
  return `${repoPath}::${branchName}`;
}

function App() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [busyRepoPath, setBusyRepoPath] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [branchDrafts, setBranchDrafts] = useState<Record<string, string>>({});
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [scanConfirm, setScanConfirm] = useState<ScanConfirmState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [branchAliasDrafts, setBranchAliasDrafts] = useState<Record<string, string>>({});
  const [branchTagListDrafts, setBranchTagListDrafts] = useState<Record<string, string[]>>({});
  const [branchTagNewDrafts, setBranchTagNewDrafts] = useState<Record<string, string>>({});
  const [editingBranch, setEditingBranch] = useState<EditingBranch | null>(null);
  const [editingRepoTagsPath, setEditingRepoTagsPath] = useState<string | null>(null);
  const [repoTagListDrafts, setRepoTagListDrafts] = useState<Record<string, string[]>>({});
  const [repoTagNewDrafts, setRepoTagNewDrafts] = useState<Record<string, string>>({});
  const [openWithRepoPath, setOpenWithRepoPath] = useState<string | null>(null);
  const [creatingBranchRepoPath, setCreatingBranchRepoPath] = useState<string | null>(null);
  const [repoDisplay, setRepoDisplay] = useState<Record<RepoDisplayKey, boolean>>({
    status: true,
    source: true,
    meta: true,
    repoTags: true,
    branchNames: true,
    branchAliases: true,
    branchTags: true
  });

  const availableEditors = Object.values(state.editors);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleRepos = normalizedSearch
    ? state.repos.filter((repo) => {
        const repoTags = state.settings.repoTags[repo.path] ?? [];
        const branchAliases = state.settings.branchAliases[repo.path] ?? {};
        const branchTags = state.settings.branchTags[repo.path] ?? {};
        const haystack = [
          repo.name,
          repo.path,
          repo.currentBranch ?? "",
          ...repo.branches,
          ...repoTags,
          ...Object.values(branchAliases),
          ...Object.values(branchTags).flat()
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(normalizedSearch);
      })
    : state.repos;

  function pushDebugEntry(
    level: DebugEntry["level"],
    text: string,
    source: DebugEntry["source"]
  ) {
    const entry: DebugEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      level,
      source,
      text,
      timestamp: new Date().toLocaleTimeString()
    };

    setDebugEntries((current) => [entry, ...current].slice(0, 14));
  }

  function showToast(nextToast: Toast, source: DebugEntry["source"] = "ui") {
    setToast(nextToast);
    pushDebugEntry(nextToast.tone === "error" ? "error" : "info", nextToast.text, source);
  }

  function reportError(error: unknown, fallback: string, source: DebugEntry["source"]) {
    showToast(
      {
        tone: "error",
        text: formatError(error, fallback)
      },
      source
    );
  }

  async function loadState() {
    setLoading(true);

    try {
      const nextState = await window.desktopApi.getAppState();
      setState(nextState);
    } catch (error) {
      reportError(error, "加载应用状态失败。", "ipc");
    } finally {
      setLoading(false);
    }
  }

  async function loadDebugInfo() {
    try {
      const nextDebugInfo = await window.desktopApi.getDebugInfo();
      setDebugInfo(nextDebugInfo);
    } catch (error) {
      reportError(error, "读取调试信息失败。", "ipc");
    }
  }

  useEffect(() => {
    void loadState();
    void loadDebugInfo();
  }, []);

  useEffect(() => {
    const nextBranchAliasDrafts: Record<string, string> = {};
    const nextBranchTagListDrafts: Record<string, string[]> = {};

    for (const repo of state.repos) {
      for (const branch of repo.branches) {
        const key = branchMetaKey(repo.path, branch);
        nextBranchAliasDrafts[key] =
          state.settings.branchAliases[repo.path]?.[branch] ?? "";
        nextBranchTagListDrafts[key] = [
          ...(state.settings.branchTags[repo.path]?.[branch] ?? [])
        ];
      }
    }

    setRepoTagListDrafts(
      Object.fromEntries(
        state.repos.map((repo) => [repo.path, [...(state.settings.repoTags[repo.path] ?? [])]])
      )
    );
    setBranchAliasDrafts(nextBranchAliasDrafts);
    setBranchTagListDrafts(nextBranchTagListDrafts);
  }, [state]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      reportError(event.error ?? event.message, "发生未捕获的运行时错误。", "runtime");
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportError(event.reason, "发生未处理的异步错误。", "runtime");
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  async function syncAction<T>(
    action: () => Promise<{ ok: boolean; message: string; data?: T }>,
    options?: {
      repoPath?: string;
      onSuccess?: (data?: T) => void;
    }
  ) {
    if (options?.repoPath) {
      setBusyRepoPath(options.repoPath);
    }

    try {
      const result = await action();

      showToast(
        {
          tone: result.ok ? "success" : "error",
          text: result.message
        },
        "ipc"
      );

      if (result.ok) {
        options?.onSuccess?.(result.data);
      }
    } catch (error) {
      reportError(error, "操作执行失败。", "ipc");
    } finally {
      setBusyRepoPath(null);
    }
  }

  async function addManualRepo() {
    try {
      const selectedPath = await window.desktopApi.pickDirectory();

      if (!selectedPath) {
        pushDebugEntry("info", "已取消添加仓库。", "ui");
        return;
      }

      await syncAction(() => window.desktopApi.addManualRepo(selectedPath), {
        onSuccess: (data) => {
          if (data) {
            setState(data as AppState);
          }
        }
      });
    } catch (error) {
      reportError(error, "打开目录选择器失败。", "ipc");
    }
  }

  async function addScanRoot() {
    try {
      const selectedPath = await window.desktopApi.pickDirectory();

      if (!selectedPath) {
        pushDebugEntry("info", "已取消添加扫描目录。", "ui");
        return;
      }

      await syncAction(() => window.desktopApi.previewScanRoot(selectedPath), {
        onSuccess: (data) => {
          if (!data) {
            return;
          }

          if (data.repos.length === 0) {
            showToast(
              {
                tone: "info",
                text: "这个目录下没有扫描到 Git 仓库。"
              },
              "ipc"
            );
            return;
          }

          setScanConfirm({
            ...data,
            selectedPaths: data.repos.map((repo) => repo.path)
          });
        }
      });
    } catch (error) {
      reportError(error, "打开目录选择器失败。", "ipc");
    }
  }

  async function confirmScanRoot() {
    if (!scanConfirm) {
      return;
    }

    await syncAction(
      () =>
        window.desktopApi.addScanRoot(
          scanConfirm.rootPath,
          scanConfirm.selectedPaths
        ),
      {
        onSuccess: (data) => {
          if (data) {
            setState(data as AppState);
            setScanConfirm(null);
          }
        }
      }
    );
  }

  function toggleScanRepo(repoPath: string) {
    setScanConfirm((current) => {
      if (!current) {
        return current;
      }

      const selected = current.selectedPaths.includes(repoPath);

      return {
        ...current,
        selectedPaths: selected
          ? current.selectedPaths.filter((value) => value !== repoPath)
          : [...current.selectedPaths, repoPath]
      };
    });
  }

  function setAllScanRepos(selected: boolean) {
    setScanConfirm((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        selectedPaths: selected ? current.repos.map((repo) => repo.path) : []
      };
    });
  }

  async function refreshAllRepos() {
    await syncAction(() => window.desktopApi.refreshAllRepos(), {
      onSuccess: (data) => {
        if (data) {
          setState(data as AppState);
        }
      }
    });
  }

  async function removeManualRepo(repoPath: string) {
    await syncAction(() => window.desktopApi.removeManualRepo(repoPath), {
      repoPath,
      onSuccess: (data) => {
        if (data) {
          setState(data as AppState);
        }
      }
    });
  }

  async function removeScanRoot(rootPath: string) {
    await syncAction(() => window.desktopApi.removeScanRoot(rootPath), {
      onSuccess: (data) => {
        if (data) {
          setState(data as AppState);
        }
      }
    });
  }

  async function refreshRepo(repoPath: string) {
    await syncAction(() => window.desktopApi.refreshRepo(repoPath), {
      repoPath,
      onSuccess: (data) => {
        if (!data) {
          return;
        }

        setState((current) => ({
          ...current,
          repos: current.repos.map((repo) => (repo.path === repoPath ? data : repo))
        }));
      }
    });
  }

  async function createRepoBranch(repoPath: string) {
    const branchName = branchDrafts[repoPath]?.trim();

    if (!branchName) {
      showToast(
        {
          tone: "error",
          text: "请先输入分支名称。"
        },
        "ui"
      );
      return;
    }

    await syncAction(() => window.desktopApi.createBranch(repoPath, branchName), {
      repoPath,
      onSuccess: (data) => {
        if (!data) {
          return;
        }

        setBranchDrafts((current) => ({
          ...current,
          [repoPath]: ""
        }));
        setCreatingBranchRepoPath(null);
        setState((current) => ({
          ...current,
          settings: {
            ...current.settings,
            branchAliases: {
              ...current.settings.branchAliases,
              [repoPath]: Object.fromEntries(
                Object.entries(current.settings.branchAliases[repoPath] ?? {}).filter(
                  ([branch]) => branch !== branchName
                )
              )
            },
            branchTags: {
              ...current.settings.branchTags,
              [repoPath]: Object.fromEntries(
                Object.entries(current.settings.branchTags[repoPath] ?? {}).filter(
                  ([branch]) => branch !== branchName
                )
              )
            }
          },
          repos: current.repos.map((repo) => (repo.path === repoPath ? data : repo))
        }));
      }
    });
  }

  async function checkoutRepoBranch(repoPath: string, branchName: string) {
    await syncAction(() => window.desktopApi.checkoutBranch(repoPath, branchName), {
      repoPath,
      onSuccess: (data) => {
        if (!data) {
          return;
        }

        setState((current) => ({
          ...current,
          repos: current.repos.map((repo) => (repo.path === repoPath ? data : repo))
        }));
      }
    });
  }

  async function deleteRepoBranch(repoPath: string, branchName: string) {
    const confirmed = window.confirm(
      `确认删除本地分支 "${branchName}" 吗？\n\n只会执行安全删除，未合并分支会被 Git 拒绝。`
    );

    if (!confirmed) {
      return;
    }

    await syncAction(() => window.desktopApi.deleteBranch(repoPath, branchName), {
      repoPath,
      onSuccess: (data) => {
        if (!data) {
          return;
        }

        setState((current) => ({
          ...current,
          repos: current.repos.map((repo) => (repo.path === repoPath ? data : repo))
        }));
      }
    });
  }

  async function openEditor(repoPath: string, editor: EditorId) {
    await syncAction(() => window.desktopApi.openInEditor(repoPath, editor), {
      repoPath
    });
  }

  async function openTerminal(
    repoPath: string,
    terminal: "windowsTerminal" | "powershell"
  ) {
    await syncAction(() => window.desktopApi.openInTerminal(repoPath, terminal), {
      repoPath
    });
  }

  async function copyRepoPath(repoPath: string) {
    await syncAction(() => window.desktopApi.copyRepoPath(repoPath), {
      repoPath
    });
  }

  async function copyText(text: string, repoPath?: string) {
    await syncAction(() => window.desktopApi.copyRepoPath(text), {
      repoPath
    });
  }

  function openRepoTagEditor(repoPath: string) {
    setEditingRepoTagsPath(repoPath);
    setOpenWithRepoPath(null);
    setCreatingBranchRepoPath(null);
    setRepoTagListDrafts((current) => ({
      ...current,
      [repoPath]: [...(state.settings.repoTags[repoPath] ?? [])]
    }));
  }

  function openBranchCreator(repoPath: string) {
    setCreatingBranchRepoPath(repoPath);
    setEditingRepoTagsPath(null);
    setOpenWithRepoPath(null);
  }

  function addRepoTagDraft(repoPath: string) {
    const nextTag = repoTagNewDrafts[repoPath]?.trim();

    if (!nextTag) {
      return;
    }

    setRepoTagListDrafts((current) => ({
      ...current,
      [repoPath]: [...new Set([...(current[repoPath] ?? []), nextTag])]
    }));
    setRepoTagNewDrafts((current) => ({
      ...current,
      [repoPath]: ""
    }));
  }

  function updateRepoTagDraft(repoPath: string, index: number, value: string) {
    setRepoTagListDrafts((current) => {
      const tags = [...(current[repoPath] ?? [])];
      tags[index] = value;

      return {
        ...current,
        [repoPath]: tags
      };
    });
  }

  function removeRepoTagDraft(repoPath: string, index: number) {
    setRepoTagListDrafts((current) => ({
      ...current,
      [repoPath]: (current[repoPath] ?? []).filter((_, tagIndex) => tagIndex !== index)
    }));
  }

  function addBranchTagDraft(key: string) {
    const nextTag = branchTagNewDrafts[key]?.trim();

    if (!nextTag) {
      return;
    }

    setBranchTagListDrafts((current) => ({
      ...current,
      [key]: [...new Set([...(current[key] ?? []), nextTag])]
    }));
    setBranchTagNewDrafts((current) => ({
      ...current,
      [key]: ""
    }));
  }

  function updateBranchTagDraft(key: string, index: number, value: string) {
    setBranchTagListDrafts((current) => {
      const tags = [...(current[key] ?? [])];
      tags[index] = value;

      return {
        ...current,
        [key]: tags
      };
    });
  }

  function removeBranchTagDraft(key: string, index: number) {
    setBranchTagListDrafts((current) => ({
      ...current,
      [key]: (current[key] ?? []).filter((_, tagIndex) => tagIndex !== index)
    }));
  }

  async function saveRepoTagList(repoPath: string) {
    const tags = repoTagListDrafts[repoPath] ?? [];

    await syncAction(() => window.desktopApi.setRepoTags(repoPath, tags), {
      repoPath,
      onSuccess: (data) => {
        if (data) {
          setState(data as AppState);
          setEditingRepoTagsPath(null);
        }
      }
    });
  }

  async function saveBranchMeta(repoPath: string, branchName: string) {
    const key = branchMetaKey(repoPath, branchName);

    if (repoPath) {
      setBusyRepoPath(repoPath);
    }

    try {
      const aliasResult = await window.desktopApi.setBranchAlias(
        repoPath,
        branchName,
        branchAliasDrafts[key] ?? ""
      );

      if (!aliasResult.ok) {
        showToast(
          {
            tone: "error",
            text: aliasResult.message
          },
          "ipc"
        );
        return;
      }

      const tagResult = await window.desktopApi.setBranchTags(
        repoPath,
        branchName,
        branchTagListDrafts[key] ?? []
      );

      showToast(
        {
          tone: tagResult.ok ? "success" : "error",
          text: tagResult.ok ? "分支信息已更新。" : tagResult.message
        },
        "ipc"
      );

      if (tagResult.ok && tagResult.data) {
        setState(tagResult.data as AppState);
        setEditingBranch(null);
      }
    } catch (error) {
      reportError(error, "保存分支信息失败。", "ipc");
    } finally {
      setBusyRepoPath(null);
    }
  }

  async function openDevTools() {
    await syncAction(() => window.desktopApi.openDevTools());
  }

  return (
    <div className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">桌面 Git 管理中心</p>
          <h1>仓库雷达</h1>
          <p className="hero-copy">
            把常用 Git 仓库集中在一个桌面工具里，快速扫描项目目录、安全切换分支，
            并一键用 VS Code、Cursor 或 Antigravity 打开。
          </p>
        </div>

        <div className="hero-actions">
          <button className="primary-button" onClick={() => void addManualRepo()}>
            添加仓库
          </button>
          <button className="secondary-button" onClick={() => void addScanRoot()}>
            添加扫描目录
          </button>
          <button
            className="secondary-button"
            onClick={() => void refreshAllRepos()}
          >
            刷新全部
          </button>
          <button
            className="ghost-button"
            onClick={() => setDiagnosticsOpen((current) => !current)}
          >
            {diagnosticsOpen ? "收起诊断" : "打开诊断"}
          </button>
        </div>
      </header>

      {diagnosticsOpen ? (
        <section className="panel diagnostics-panel">
          <div className="panel-heading diagnostics-heading">
            <div>
              <p className="panel-label">诊断与调试</p>
              <h2>把静默失败变成可见信息</h2>
              <p className="diagnostics-copy">
                现在支持直接从应用里打开开发者工具，也会把最近的错误显示在这里。
                你也可以按 F12 或 Ctrl+Shift+I 打开 DevTools。
              </p>
            </div>

            <div className="hero-actions diagnostics-actions">
              <button className="secondary-button" onClick={() => void openDevTools()}>
                打开开发者工具
              </button>
              <button className="ghost-button" onClick={() => setDebugEntries([])}>
                清空日志
              </button>
            </div>
          </div>

          <div className="diagnostics-grid">
            <div className="subpanel">
              <div className="subpanel-header">
                <h3>运行环境</h3>
              </div>
              {debugInfo ? (
                <dl className="debug-info-list">
                  <div>
                    <dt>平台</dt>
                    <dd>{debugInfo.platform}</dd>
                  </div>
                  <div>
                    <dt>Electron</dt>
                    <dd>{debugInfo.electron}</dd>
                  </div>
                  <div>
                    <dt>Chrome</dt>
                    <dd>{debugInfo.chrome}</dd>
                  </div>
                  <div>
                    <dt>Node</dt>
                    <dd>{debugInfo.node}</dd>
                  </div>
                  <div>
                    <dt>模式</dt>
                    <dd>{debugInfo.isDevServer ? "开发模式" : "生产预览"}</dd>
                  </div>
                  <div>
                    <dt>配置目录</dt>
                    <dd>
                      <code>{debugInfo.userDataPath}</code>
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="empty-text">还没有拿到环境信息。</p>
              )}
            </div>

            <div className="subpanel">
              <div className="subpanel-header">
                <h3>最近日志</h3>
                <span>{debugEntries.length}</span>
              </div>

              {debugEntries.length === 0 ? (
                <p className="empty-text">目前还没有记录到新的错误或调试消息。</p>
              ) : (
                <ul className="debug-log-list">
                  {debugEntries.map((entry) => (
                    <li key={entry.id} className={`debug-log-item debug-${entry.level}`}>
                      <div className="debug-log-meta">
                        <strong>{entry.level === "error" ? "错误" : "信息"}</strong>
                        <span>
                          {entry.source} · {entry.timestamp}
                        </span>
                      </div>
                      <p>{entry.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-label">工作区设置</p>
            <h2>已追踪目录</h2>
          </div>
        </div>

        <div className="config-grid">
          <div className="subpanel">
            <div className="subpanel-header">
              <h3>手动添加的仓库</h3>
              <span>{state.settings.manualRepoPaths.length}</span>
            </div>
            {state.settings.manualRepoPaths.length === 0 ? (
              <p className="empty-text">还没有手动添加任何仓库。</p>
            ) : (
              <ul className="path-list">
                {state.settings.manualRepoPaths.map((repoPath) => (
                  <li key={repoPath}>
                    <code>{repoPath}</code>
                    <button
                      className="ghost-button"
                      onClick={() => void removeManualRepo(repoPath)}
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="subpanel">
            <div className="subpanel-header">
              <h3>扫描目录</h3>
              <span>{state.settings.scanRootPaths.length}</span>
            </div>
            {state.settings.scanRootPaths.length === 0 ? (
              <p className="empty-text">还没有配置任何扫描目录。</p>
            ) : (
              <ul className="path-list">
                {state.settings.scanRootPaths.map((rootPath) => (
                  <li key={rootPath}>
                    <code>{rootPath}</code>
                    <button
                      className="ghost-button"
                      onClick={() => void removeScanRoot(rootPath)}
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="repo-section">
        <div className="section-header">
          <div>
            <p className="panel-label">已追踪仓库</p>
            <h2>当前展示 {visibleRepos.length} / {state.repos.length} 个仓库</h2>
          </div>

          <div className="repo-tools">
            <div className="repo-display-wrap">
              <button
                className="icon-button repo-display-button"
                title="配置仓库展示内容"
                aria-label="配置仓库展示内容"
              >
                <Settings2 size={15} />
              </button>
              <div className="repo-display-popover">
                <strong>展示内容</strong>
                {repoDisplayOptions.map((option) => (
                  <label className="display-toggle-row" key={option.key}>
                    <input
                      type="checkbox"
                      checked={repoDisplay[option.key]}
                      onChange={(event) =>
                        setRepoDisplay((current) => ({
                          ...current,
                          [option.key]: event.target.checked
                        }))
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <input
              type="search"
              placeholder="搜索仓库、路径、分支、别名或标签"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {loading ? <span className="loading-chip">加载中...</span> : null}
          </div>
        </div>
        {state.repos.length === 0 && !loading ? (
          <div className="empty-state">
            <h3>还没有仓库</h3>
            <p>
              你可以直接添加一个 Git 仓库，也可以添加一个上级目录，让应用自动扫描其中的仓库。
            </p>
          </div>
        ) : visibleRepos.length === 0 && !loading ? (
          <div className="empty-state">
            <h3>没有匹配结果</h3>
            <p>换个仓库名、分支名、标签或别名试试。</p>
          </div>
        ) : (
          <div className="repo-grid">
            {visibleRepos.map((repo) => {
              const isBusy = busyRepoPath === repo.path;

              return (
                <article className="repo-card" key={repo.id}>
                  <div className="repo-card-header">
                    <div className="repo-card-main">
                      <div className="repo-title-row">
                        <h3>{repo.name}</h3>
                      </div>
                      <div className="repo-path-row">
                        <p className="repo-path">{repo.path}</p>
                        <button
                          className="inline-icon-button"
                          onClick={() => void copyRepoPath(repo.path)}
                          disabled={isBusy}
                          title="复制仓库路径"
                          aria-label={`复制 ${repo.name} 的仓库路径`}
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                      {repoDisplay.status ||
                      repoDisplay.source ||
                      (repoDisplay.repoTags &&
                        (state.settings.repoTags[repo.path] ?? []).length > 0) ? (
                        <div className="repo-tag-row">
                          {repoDisplay.status ? (
                            <>
                              <span className={`status-pill status-${repo.status}`}>
                                {formatStatus(repo.status)}
                              </span>
                              {repo.dirty ? (
                                <span className="status-pill status-dirty">有改动</span>
                              ) : (
                                <span className="status-pill status-clean">干净</span>
                              )}
                            </>
                          ) : null}
                          {repoDisplay.source ? (
                            <span className="tag-chip source-chip" title={formatSource(repo)}>
                              {formatSourceTag(repo)}
                            </span>
                          ) : null}
                          {repoDisplay.repoTags
                            ? (state.settings.repoTags[repo.path] ?? []).map((tag) => (
                                <span className="tag-chip" key={tag}>
                                  {tag}
                                </span>
                              ))
                            : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="repo-hover-actions">
                      <button
                        className="icon-button"
                        onClick={() => void refreshRepo(repo.path)}
                        disabled={isBusy}
                        title="刷新仓库"
                        aria-label={`刷新 ${repo.name}`}
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => openRepoTagEditor(repo.path)}
                        disabled={isBusy}
                        title="管理仓库标签"
                        aria-label={`管理 ${repo.name} 的标签`}
                      >
                        <Tags size={14} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => openBranchCreator(repo.path)}
                        disabled={isBusy || repo.status !== "ready"}
                        title="创建分支"
                        aria-label={`为 ${repo.name} 创建分支`}
                      >
                        <GitBranchPlus size={14} />
                      </button>
                      <div className="open-with-wrap">
                        <button
                          className="open-with-button"
                          onClick={() => {
                            setEditingRepoTagsPath(null);
                            setCreatingBranchRepoPath(null);
                            setOpenWithRepoPath((current) =>
                              current === repo.path ? null : repo.path
                            );
                          }}
                          disabled={isBusy}
                        >
                          <Code2 size={14} />
                          <span>Open with</span>
                          <ChevronDown size={13} />
                        </button>

                        {openWithRepoPath === repo.path ? (
                          <div className="open-with-menu">
                            {availableEditors.map((editor) => (
                              <button
                                key={editor.id}
                                onClick={() => {
                                  setOpenWithRepoPath(null);
                                  void openEditor(repo.path, editor.id);
                                }}
                                disabled={!editor.available || isBusy}
                              >
                                <Code2 size={14} />
                                <span>{editor.label}</span>
                                {!editor.available ? <em>未检测到</em> : null}
                              </button>
                            ))}
                            <button
                              onClick={() => {
                                setOpenWithRepoPath(null);
                                void openTerminal(repo.path, "windowsTerminal");
                              }}
                              disabled={isBusy}
                            >
                              <Terminal size={14} />
                              <span>Windows Terminal</span>
                            </button>
                            <button
                              onClick={() => {
                                setOpenWithRepoPath(null);
                                void openTerminal(repo.path, "powershell");
                              }}
                              disabled={isBusy}
                            >
                              <Terminal size={14} />
                              <span>PowerShell</span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {repoDisplay.meta ? (
                    <div className="meta-row">
                      <div>
                        <span className="meta-label">当前分支</span>
                        <strong>{repo.currentBranch ?? "游离 HEAD / 未知"}</strong>
                      </div>
                      <div>
                        <span className="meta-label">本地分支数</span>
                        <strong>{repo.branches.length}</strong>
                      </div>
                    </div>
                  ) : null}

                  {repo.errorMessage ? (
                    <p className="repo-error">{repo.errorMessage}</p>
                  ) : null}

                  {editingRepoTagsPath === repo.path ? (
                    <div className="repo-tag-popover">
                      <div className="repo-tag-popover-header">
                        <strong>管理仓库标签</strong>
                        <button
                          className="icon-button"
                          onClick={() => setEditingRepoTagsPath(null)}
                          title="关闭"
                          aria-label="关闭仓库标签管理"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <div className="repo-tag-editor-list">
                        {(repoTagListDrafts[repo.path] ?? []).length === 0 ? (
                          <p className="empty-text">还没有标签。</p>
                        ) : (
                          (repoTagListDrafts[repo.path] ?? []).map((tag, index) => (
                            <div className="repo-tag-editor-row" key={`${tag}-${index}`}>
                              <input
                                type="text"
                                value={tag}
                                onChange={(event) =>
                                  updateRepoTagDraft(repo.path, index, event.target.value)
                                }
                              />
                              <button
                                className="icon-button danger"
                                onClick={() => removeRepoTagDraft(repo.path, index)}
                                title="删除标签"
                                aria-label={`删除标签 ${tag}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="repo-tag-add-row">
                        <input
                          type="text"
                          placeholder="新增标签"
                          value={repoTagNewDrafts[repo.path] ?? ""}
                          onChange={(event) =>
                            setRepoTagNewDrafts((current) => ({
                              ...current,
                              [repo.path]: event.target.value
                            }))
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              addRepoTagDraft(repo.path);
                            }
                          }}
                        />
                        <button
                          className="icon-button"
                          onClick={() => addRepoTagDraft(repo.path)}
                          title="新增标签"
                          aria-label="新增仓库标签"
                        >
                          <Plus size={14} />
                        </button>
                      </div>

                      <div className="repo-tag-popover-footer">
                        <button
                          className="secondary-button"
                          onClick={() => setEditingRepoTagsPath(null)}
                        >
                          取消
                        </button>
                        <button
                          className="primary-button"
                          onClick={() => void saveRepoTagList(repo.path)}
                          disabled={isBusy}
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {creatingBranchRepoPath === repo.path ? (
                    <div className="branch-create-popover">
                      <div className="branch-popover-header">
                        <strong>创建分支</strong>
                        <button
                          className="icon-button"
                          onClick={() => setCreatingBranchRepoPath(null)}
                          title="关闭"
                          aria-label="关闭创建分支"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <input
                        type="text"
                        placeholder="例如：feature/my-next-branch"
                        value={branchDrafts[repo.path] ?? ""}
                        onChange={(event) =>
                          setBranchDrafts((current) => ({
                            ...current,
                            [repo.path]: event.target.value
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void createRepoBranch(repo.path);
                          }
                        }}
                      />
                      <div className="branch-popover-footer">
                        <button
                          className="secondary-button"
                          onClick={() => setCreatingBranchRepoPath(null)}
                        >
                          取消
                        </button>
                        <button
                          className="primary-button"
                          onClick={() => void createRepoBranch(repo.path)}
                          disabled={isBusy || repo.status !== "ready"}
                        >
                          创建
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="branch-list">
                    {repo.branches.length === 0 ? (
                      <p className="empty-text">没有找到本地分支。</p>
                    ) : (
                      repo.branches.map((branch) => {
                        const isCurrent = branch === repo.currentBranch;
                        const key = branchMetaKey(repo.path, branch);
                        const alias = state.settings.branchAliases[repo.path]?.[branch];
                        const tags = state.settings.branchTags[repo.path]?.[branch] ?? [];

                        return (
                          <div
                            key={branch}
                            className={isCurrent ? "branch-item current" : "branch-item"}
                          >
                            <div className="branch-content-row">
                              <div className="branch-text-block">
                                <div className="branch-main-row">
                                  {repoDisplay.branchNames ? (
                                    <span className="branch-name" title={branch}>
                                      {branch}
                                    </span>
                                  ) : null}
                                  {isCurrent ? (
                                    <span className="status-pill status-clean">当前</span>
                                  ) : null}
                                </div>

                                {(repoDisplay.branchAliases && alias) ||
                                (repoDisplay.branchTags && tags.length > 0) ? (
                                  <div className="branch-meta-display">
                                    {repoDisplay.branchAliases && alias ? (
                                      <span className="branch-alias">{alias}</span>
                                    ) : null}
                                    {repoDisplay.branchTags
                                      ? tags.map((tag) => (
                                          <span className="tag-chip" key={tag}>
                                            {tag}
                                          </span>
                                        ))
                                      : null}
                                  </div>
                                ) : null}
                              </div>

                              <div className="branch-hover-actions">
                                <button
                                  className="branch-icon-button"
                                  disabled={isCurrent || isBusy || repo.status !== "ready"}
                                  onClick={() => void checkoutRepoBranch(repo.path, branch)}
                                  title={
                                    isCurrent
                                      ? "当前所在分支"
                                      : repo.dirty
                                        ? "当前仓库有未提交改动，暂时不能切换分支。"
                                        : `切换到 ${branch}`
                                  }
                                  aria-label={`切换到 ${branch}`}
                                >
                                  <ArrowRightLeft size={14} />
                                </button>
                                <button
                                  className="branch-icon-button"
                                  onClick={() => void copyText(branch, repo.path)}
                                  title="复制分支名"
                                  aria-label={`复制分支名 ${branch}`}
                                >
                                  <Copy size={14} />
                                </button>
                                <button
                                  className="branch-icon-button"
                                  onClick={() => {
                                    setCreatingBranchRepoPath(null);
                                    setEditingRepoTagsPath(null);
                                    setOpenWithRepoPath(null);
                                    setEditingBranch({
                                      repoPath: repo.path,
                                      branchName: branch
                                    });
                                  }}
                                  title="编辑别名和标签"
                                  aria-label={`编辑 ${branch} 的别名和标签`}
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button
                                  className="branch-icon-button danger"
                                  disabled={isCurrent || isBusy || repo.status !== "ready"}
                                  onClick={() => void deleteRepoBranch(repo.path, branch)}
                                  title={isCurrent ? "不能删除当前分支" : `删除 ${branch}`}
                                  aria-label={`删除 ${branch}`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>

                            {editingBranch?.repoPath === repo.path &&
                            editingBranch.branchName === branch ? (
                              <div className="branch-popover">
                                <div className="branch-popover-header">
                                  <strong>编辑分支信息</strong>
                                  <button
                                    className="ghost-button"
                                    onClick={() => setEditingBranch(null)}
                                  >
                                    关闭
                                  </button>
                                </div>
                                <label>
                                  <span>别名</span>
                                  <input
                                    type="text"
                                    placeholder="例如：库存看板需求"
                                    value={branchAliasDrafts[key] ?? ""}
                                    onChange={(event) =>
                                      setBranchAliasDrafts((current) => ({
                                        ...current,
                                        [key]: event.target.value
                                      }))
                                    }
                                  />
                                </label>
                                <label>
                                  <span>标签</span>
                                  <div className="branch-tag-editor-list">
                                    {(branchTagListDrafts[key] ?? []).length === 0 ? (
                                      <p className="empty-text">还没有标签。</p>
                                    ) : (
                                      (branchTagListDrafts[key] ?? []).map((tag, index) => (
                                        <div
                                          className="repo-tag-editor-row"
                                          key={`${tag}-${index}`}
                                        >
                                          <input
                                            type="text"
                                            value={tag}
                                            onChange={(event) =>
                                              updateBranchTagDraft(
                                                key,
                                                index,
                                                event.target.value
                                              )
                                            }
                                          />
                                          <button
                                            className="icon-button danger"
                                            onClick={() => removeBranchTagDraft(key, index)}
                                            title="删除标签"
                                            aria-label={`删除标签 ${tag}`}
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                  <div className="repo-tag-add-row">
                                    <input
                                      type="text"
                                      placeholder="新增标签"
                                      value={branchTagNewDrafts[key] ?? ""}
                                      onChange={(event) =>
                                        setBranchTagNewDrafts((current) => ({
                                          ...current,
                                          [key]: event.target.value
                                        }))
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          addBranchTagDraft(key);
                                        }
                                      }}
                                    />
                                    <button
                                      className="icon-button"
                                      onClick={() => addBranchTagDraft(key)}
                                      title="新增标签"
                                      aria-label="新增分支标签"
                                    >
                                      <Plus size={14} />
                                    </button>
                                  </div>
                                </label>
                                <div className="branch-popover-footer">
                                  <button
                                    className="secondary-button"
                                    onClick={() => setEditingBranch(null)}
                                  >
                                    取消
                                  </button>
                                  <button
                                    className="primary-button"
                                    disabled={isBusy}
                                    onClick={() => void saveBranchMeta(repo.path, branch)}
                                  >
                                    保存
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {toast ? (
        <div className={`toast toast-${toast.tone}`}>{toast.text}</div>
      ) : null}

      {scanConfirm ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="scan-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scan-modal-title"
          >
            <div className="scan-modal-header">
              <div>
                <p className="panel-label">扫描确认</p>
                <h2 id="scan-modal-title">选择要添加的仓库</h2>
                <p className="scan-root-path">{scanConfirm.rootPath}</p>
              </div>
              <button className="ghost-button" onClick={() => setScanConfirm(null)}>
                取消
              </button>
            </div>

            <div className="scan-modal-toolbar">
              <span>
                已选择 {scanConfirm.selectedPaths.length} / {scanConfirm.repos.length}
              </span>
              <div>
                <button className="ghost-button" onClick={() => setAllScanRepos(true)}>
                  全选
                </button>
                <button className="ghost-button" onClick={() => setAllScanRepos(false)}>
                  全不选
                </button>
              </div>
            </div>

            <ul className="scan-repo-list">
              {scanConfirm.repos.map((repo) => {
                const checked = scanConfirm.selectedPaths.includes(repo.path);

                return (
                  <li key={repo.path}>
                    <label className="scan-repo-option">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleScanRepo(repo.path)}
                      />
                      <span>
                        <strong>{repo.name}</strong>
                        <code>{repo.path}</code>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="scan-modal-footer">
              <button className="secondary-button" onClick={() => setScanConfirm(null)}>
                暂不添加
              </button>
              <button
                className="primary-button"
                onClick={() => void confirmScanRoot()}
                disabled={scanConfirm.selectedPaths.length === 0}
              >
                添加选中仓库
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
