import { useEffect, useState } from "react";
import type { AppState, DebugInfo, EditorId, ManagedRepo } from "../shared/types";

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

function formatSource(repo: ManagedRepo): string {
  return repo.source === "manual"
    ? "手动添加"
    : repo.sourcePath
      ? `来自扫描目录：${repo.sourcePath}`
      : "扫描发现";
}

const EMPTY_STATE: AppState = {
  settings: {
    manualRepoPaths: [],
    scanRootPaths: [],
    defaultEditor: "vscode"
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

function App() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [busyRepoPath, setBusyRepoPath] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [branchDrafts, setBranchDrafts] = useState<Record<string, string>>({});
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);

  const availableEditors = Object.values(state.editors);

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

      await syncAction(() => window.desktopApi.addScanRoot(selectedPath), {
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
        setState((current) => ({
          ...current,
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

  async function openEditor(repoPath: string, editor: EditorId) {
    await syncAction(() => window.desktopApi.openInEditor(repoPath, editor), {
      repoPath
    });
  }

  async function setDefaultEditor(editor: EditorId) {
    await syncAction(() => window.desktopApi.setDefaultEditor(editor), {
      onSuccess: (data) => {
        if (data) {
          setState(data as AppState);
        }
      }
    });
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
            <h2>启动偏好与已追踪目录</h2>
          </div>

          <label className="editor-select">
            <span>默认编辑器</span>
            <select
              value={state.settings.defaultEditor}
              onChange={(event) =>
                void setDefaultEditor(event.target.value as EditorId)
              }
            >
              {availableEditors.map((editor) => (
                <option key={editor.id} value={editor.id}>
                  {editor.label}
                  {editor.available ? "" : "（未检测到）"}
                </option>
              ))}
            </select>
          </label>
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
            <h2>当前展示 {state.repos.length} 个仓库</h2>
          </div>

          {loading ? <span className="loading-chip">加载中...</span> : null}
        </div>

        {state.repos.length === 0 && !loading ? (
          <div className="empty-state">
            <h3>还没有仓库</h3>
            <p>
              你可以直接添加一个 Git 仓库，也可以添加一个上级目录，让应用自动扫描其中的仓库。
            </p>
          </div>
        ) : (
          <div className="repo-grid">
            {state.repos.map((repo) => {
              const isBusy = busyRepoPath === repo.path;

              return (
                <article className="repo-card" key={repo.id}>
                  <div className="repo-card-header">
                    <div>
                      <div className="repo-title-row">
                        <h3>{repo.name}</h3>
                        <span className={`status-pill status-${repo.status}`}>
                          {formatStatus(repo.status)}
                        </span>
                        {repo.dirty ? (
                          <span className="status-pill status-dirty">有改动</span>
                        ) : (
                          <span className="status-pill status-clean">干净</span>
                        )}
                      </div>
                      <p className="repo-path">{repo.path}</p>
                      <p className="repo-source">{formatSource(repo)}</p>
                    </div>

                    <button
                      className="ghost-button"
                      onClick={() => void refreshRepo(repo.path)}
                      disabled={isBusy}
                    >
                      刷新
                    </button>
                  </div>

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

                  {repo.errorMessage ? (
                    <p className="repo-error">{repo.errorMessage}</p>
                  ) : null}

                  <div className="editor-row">
                    {availableEditors.map((editor) => (
                      <button
                        key={editor.id}
                        className="editor-button"
                        onClick={() => void openEditor(repo.path, editor.id)}
                        disabled={!editor.available || isBusy}
                      >
                        用 {editor.label} 打开
                      </button>
                    ))}
                  </div>

                  <div className="branch-create-row">
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
                    />
                    <button
                      className="primary-button"
                      onClick={() => void createRepoBranch(repo.path)}
                      disabled={isBusy || repo.status !== "ready"}
                    >
                      创建分支
                    </button>
                  </div>

                  <div className="branch-list">
                    {repo.branches.length === 0 ? (
                      <p className="empty-text">没有找到本地分支。</p>
                    ) : (
                      repo.branches.map((branch) => {
                        const isCurrent = branch === repo.currentBranch;

                        return (
                          <button
                            key={branch}
                            className={isCurrent ? "branch-pill current" : "branch-pill"}
                            disabled={
                              isCurrent || isBusy || repo.status !== "ready"
                            }
                            onClick={() => void checkoutRepoBranch(repo.path, branch)}
                            title={
                              isCurrent
                                ? "当前所在分支"
                                : repo.dirty
                                  ? "当前仓库有未提交改动，暂时不能切换分支。"
                                  : `切换到 ${branch}`
                            }
                          >
                            {branch}
                          </button>
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
    </div>
  );
}

export default App;
