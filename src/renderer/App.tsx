import { type CSSProperties, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Code2,
  Copy,
  Edit3,
  FolderOpen,
  GitBranchPlus,
  ListChecks,
  Palette,
  Plus,
  RefreshCw,
  Settings2,
  Tags,
  Terminal,
  Trash2,
  X,
  ArrowRightLeft
} from "lucide-react";

const THEMES: Array<{ id: ThemeId; label: string; description: string }> = [
  { id: "midnight", label: "午夜星空", description: "默认紫蓝暗色" },
  { id: "aurora", label: "极光", description: "翠绿暗色" },
  { id: "ember", label: "炉火", description: "暖橘暗色" },
  { id: "daybreak", label: "晨曦", description: "明亮浅色" }
];
import type {
  AppState,
  DebugInfo,
  EditorId,
  ManagedRepo,
  ScanPreview,
  ThemeId,
  UpdateInfo
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

type RepoCardStyle = CSSProperties & {
  "--repo-card-max-height"?: string;
};

type RepoDisplayKey =
  | "status"
  | "source"
  | "meta"
  | "repoTags"
  | "branchNames"
  | "branchAliases"
  | "branchTags"
  | "branchNodes";

const repoDisplayOptions: Array<{ key: RepoDisplayKey; label: string }> = [
  { key: "status", label: "状态徽标" },
  { key: "source", label: "来源" },
  { key: "meta", label: "统计信息" },
  { key: "repoTags", label: "仓库标签" },
  { key: "branchNames", label: "分支名称" },
  { key: "branchAliases", label: "分支别名" },
  { key: "branchTags", label: "分支标签" },
  { key: "branchNodes", label: "分支进度" }
];

const MIN_REPO_CARD_MAX_HEIGHT = 260;

// 把仓库的来源信息格式化为可读文本，用于详细 tooltip。
function formatSource(repo: ManagedRepo): string {
  return repo.source === "manual"
    ? "手动添加"
    : repo.sourcePath
      ? `来自扫描目录：${repo.sourcePath}`
      : "扫描发现";
}

// 返回仓库来源的简短标签文案，用于卡片上的徽标显示。
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
    branchTags: {},
    branchNodes: {},
    branchNodeOptions: ["已开发", "已联调", "已review"],
    repoBranchNodeOptions: {},
    repoCardMaxHeight: null,
    theme: "midnight"
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

// 把仓库的内部状态枚举转换为中文标签。
function formatStatus(status: ManagedRepo["status"]): string {
  if (status === "ready") {
    return "正常";
  }

  if (status === "invalid") {
    return "无效";
  }

  return "异常";
}

// 从未知类型的异常中提取可读信息，没有可用信息时回退到 fallback 文案。
function formatError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

// 生成用于在表单草稿映射中查找分支别名/标签等草稿数据的复合 key。
function branchMetaKey(repoPath: string, branchName: string): string {
  return `${repoPath}::${branchName}`;
}

// 把卡片最大高度输入框中的草稿字符串解析为合法的像素值；非法/空值返回 null。
function parseRepoCardMaxHeightDraft(draft: string): number | null {
  const trimmed = draft.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.max(MIN_REPO_CARD_MAX_HEIGHT, Math.round(parsed));
}

// 进度选项编辑器的作用域：global 表示编辑全局默认，repo 表示为某仓库单独配置。
type NodeOptionsScope = { kind: "global" } | { kind: "repo"; repoPath: string };

// 应用根组件：持有全局状态、副作用以及所有 UI 区域的渲染逻辑。
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
  const [repoCardHeightDraft, setRepoCardHeightDraft] = useState("");
  const [repoDisplay, setRepoDisplay] = useState<Record<RepoDisplayKey, boolean>>({
    status: true,
    source: true,
    meta: true,
    repoTags: true,
    branchNames: true,
    branchAliases: true,
    branchTags: true,
    branchNodes: true
  });
  const [nodeOptionsScope, setNodeOptionsScope] = useState<NodeOptionsScope | null>(null);
  const [nodeOptionsDraft, setNodeOptionsDraft] = useState<string[]>([]);
  const [nodeOptionsNewDraft, setNodeOptionsNewDraft] = useState("");
  const [nodeOptionsUseGlobal, setNodeOptionsUseGlobal] = useState(false);
  const [branchNodeInitKey, setBranchNodeInitKey] = useState<string | null>(null);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

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
  const repoCardMaxHeight = state.settings.repoCardMaxHeight;
  const repoCardStyle: RepoCardStyle | undefined = repoCardMaxHeight
    ? { "--repo-card-max-height": `${repoCardMaxHeight}px` }
    : undefined;

  // 把一条调试信息追加到诊断面板的日志列表，最多保留 14 条以避免无限增长。
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

  // 显示一条 toast 提示，同时把内容写入诊断日志方便事后追溯。
  function showToast(nextToast: Toast, source: DebugEntry["source"] = "ui") {
    setToast(nextToast);
    pushDebugEntry(nextToast.tone === "error" ? "error" : "info", nextToast.text, source);
  }

  // 把异常统一格式化后以 error 级 toast 呈现，避免渲染层各处重复编写错误处理。
  function reportError(error: unknown, fallback: string, source: DebugEntry["source"]) {
    showToast(
      {
        tone: "error",
        text: formatError(error, fallback)
      },
      source
    );
  }

  // 从主进程拉取完整的应用状态并写入本地 state；任何失败都通过 toast 提示。
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

  // 拉取主进程的运行环境信息，用于诊断面板展示版本号与配置目录路径。
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
    setRepoCardHeightDraft(
      state.settings.repoCardMaxHeight ? String(state.settings.repoCardMaxHeight) : ""
    );
  }, [state.settings.repoCardMaxHeight]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.settings.theme ?? "midnight");
  }, [state.settings.theme]);

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
    // 监听全局同步错误并写入诊断日志，避免静默失败。
    const handleWindowError = (event: ErrorEvent) => {
      reportError(event.error ?? event.message, "发生未捕获的运行时错误。", "runtime");
    };

    // 监听未处理的 Promise 拒绝并写入诊断日志。
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

  // 通用的 IPC 动作包装：负责设置 busy 状态、统一 toast 反馈以及成功回调。
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

  // 提交“卡片最大高度”草稿值到主进程，并把草稿同步为规范化后的结果。
  async function applyRepoCardMaxHeight() {
    const nextMaxHeight = parseRepoCardMaxHeightDraft(repoCardHeightDraft);

    setRepoCardHeightDraft(nextMaxHeight ? String(nextMaxHeight) : "");

    await syncAction(() => window.desktopApi.setRepoCardMaxHeight(nextMaxHeight), {
      onSuccess: (data) => {
        if (data) {
          setState(data as AppState);
        }
      }
    });
  }

  // 清除卡片最大高度设置，恢复为不限高度。
  async function clearRepoCardMaxHeight() {
    setRepoCardHeightDraft("");

    await syncAction(() => window.desktopApi.setRepoCardMaxHeight(null), {
      onSuccess: (data) => {
        if (data) {
          setState(data as AppState);
        }
      }
    });
  }

  // 弹出目录选择器并添加一个手动跟踪的仓库。
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

  // 弹出目录选择器，预览扫描结果后再让用户确认要导入哪些仓库。
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

  // 把扫描预览弹窗中勾选的仓库正式写入设置。
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

  // 切换扫描预览弹窗里某个仓库的勾选状态。
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

  // 在扫描预览弹窗中一次性全选或全不选。
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

  // 通知主进程重新扫描并刷新全部仓库状态。
  async function refreshAllRepos() {
    await syncAction(() => window.desktopApi.refreshAllRepos(), {
      onSuccess: (data) => {
        if (data) {
          setState(data as AppState);
        }
      }
    });
  }

  // 把一个手动添加的仓库从设置中移除。
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

  // 移除一个扫描根目录及其包含的仓库选择记录。
  async function removeScanRoot(rootPath: string) {
    await syncAction(() => window.desktopApi.removeScanRoot(rootPath), {
      onSuccess: (data) => {
        if (data) {
          setState(data as AppState);
        }
      }
    });
  }

  // 刷新单个仓库的状态并就地替换列表中的对应条目。
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

  // 基于当前 HEAD 创建分支：成功后清空草稿并删除新分支可能残留的旧元数据。
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

  // 安全地切换分支：主进程会校验工作区是否干净。
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

  // 在系统确认对话框通过后，请求主进程安全删除一个本地分支。
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

  // 用指定编辑器打开仓库目录。
  async function openEditor(repoPath: string, editor: EditorId) {
    await syncAction(() => window.desktopApi.openInEditor(repoPath, editor), {
      repoPath
    });
  }

  // 用 Windows Terminal 或 PowerShell 打开仓库目录。
  async function openTerminal(
    repoPath: string,
    terminal: "windowsTerminal" | "powershell"
  ) {
    await syncAction(() => window.desktopApi.openInTerminal(repoPath, terminal), {
      repoPath
    });
  }

  // 把仓库的绝对路径复制到系统剪贴板。
  async function copyRepoPath(repoPath: string) {
    await syncAction(() => window.desktopApi.copyRepoPath(repoPath), {
      repoPath
    });
  }

  // 复用 copyRepoPath 的剪贴板能力，把任意文本（如分支名）写入剪贴板。
  async function copyText(text: string, repoPath?: string) {
    await syncAction(() => window.desktopApi.copyRepoPath(text), {
      repoPath
    });
  }

  // 打开仓库标签编辑弹窗，并把当前的标签集合载入草稿。
  function openRepoTagEditor(repoPath: string) {
    setEditingRepoTagsPath(repoPath);
    setOpenWithRepoPath(null);
    setCreatingBranchRepoPath(null);
    setRepoTagListDrafts((current) => ({
      ...current,
      [repoPath]: [...(state.settings.repoTags[repoPath] ?? [])]
    }));
  }

  // 打开“创建分支”弹窗，确保只在卡片上同时弹出一个浮层。
  function openBranchCreator(repoPath: string) {
    setCreatingBranchRepoPath(repoPath);
    setEditingRepoTagsPath(null);
    setOpenWithRepoPath(null);
  }

  // 把输入框里的新标签追加到草稿列表，并清空输入框。
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

  // 直接编辑草稿中某一条仓库标签的值。
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

  // 从草稿列表中删除某条仓库标签。
  function removeRepoTagDraft(repoPath: string, index: number) {
    setRepoTagListDrafts((current) => ({
      ...current,
      [repoPath]: (current[repoPath] ?? []).filter((_, tagIndex) => tagIndex !== index)
    }));
  }

  // 把输入框里的新分支标签追加到对应分支的草稿列表中。
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

  // 直接编辑某条分支标签草稿的值。
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

  // 从某条分支的标签草稿中删除指定位置的标签。
  function removeBranchTagDraft(key: string, index: number) {
    setBranchTagListDrafts((current) => ({
      ...current,
      [key]: (current[key] ?? []).filter((_, tagIndex) => tagIndex !== index)
    }));
  }

  // 把仓库标签草稿提交到主进程并关闭编辑器。
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

  // 顺序保存分支别名与标签，任一失败都通过 toast 通知并中止后续步骤。
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

  // 将某条分支的进度节点设置为指定选项；空字符串视为清除。
  async function applyBranchNode(repoPath: string, branchName: string, node: string) {
    await syncAction(() => window.desktopApi.setBranchNode(repoPath, branchName, node), {
      repoPath,
      onSuccess: (data) => {
        if (data) {
          setState(data as AppState);
        }
      }
    });
  }

  // 返回某仓库实际生效的进度选项：优先用仓库自定义，否则回退到全局默认。
  function getEffectiveNodeOptions(repoPath: string): string[] {
    return (
      state.settings.repoBranchNodeOptions?.[repoPath] ??
      state.settings.branchNodeOptions ??
      []
    );
  }

  // 进入“管理进度选项”编辑模式，并按 scope（全局 / 仓库级）载入对应草稿。
  function openNodeOptionsEditor(scope: NodeOptionsScope) {
    if (scope.kind === "global") {
      setNodeOptionsDraft([...(state.settings.branchNodeOptions ?? [])]);
      setNodeOptionsUseGlobal(false);
    } else {
      const override = state.settings.repoBranchNodeOptions?.[scope.repoPath];
      setNodeOptionsDraft([...(override ?? state.settings.branchNodeOptions ?? [])]);
      setNodeOptionsUseGlobal(!override);
    }
    setNodeOptionsNewDraft("");
    setNodeOptionsScope(scope);
  }

  // 把新输入的进度选项追加到草稿列表（自动去重）。
  function addNodeOptionDraft() {
    const next = nodeOptionsNewDraft.trim();
    if (!next) {
      return;
    }
    setNodeOptionsDraft((current) => [...new Set([...current, next])]);
    setNodeOptionsNewDraft("");
  }

  // 直接编辑某个进度选项草稿的文本。
  function updateNodeOptionDraft(index: number, value: string) {
    setNodeOptionsDraft((current) => current.map((item, i) => (i === index ? value : item)));
  }

  // 从草稿中删除指定位置的进度选项。
  function removeNodeOptionDraft(index: number) {
    setNodeOptionsDraft((current) => current.filter((_, i) => i !== index));
  }

  // 把进度选项草稿提交到主进程：根据当前 scope 写到全局或仓库覆盖项。
  async function saveNodeOptions() {
    const scope = nodeOptionsScope;
    if (!scope) {
      return;
    }

    const onSuccess = (data: AppState | undefined) => {
      if (data) {
        setState(data);
        setNodeOptionsScope(null);
      }
    };

    if (scope.kind === "global") {
      await syncAction(() => window.desktopApi.setBranchNodeOptions(nodeOptionsDraft), {
        onSuccess: (data) => onSuccess(data as AppState | undefined)
      });
    } else {
      const payload = nodeOptionsUseGlobal ? null : nodeOptionsDraft;
      await syncAction(
        () => window.desktopApi.setRepoBranchNodeOptions(scope.repoPath, payload),
        { onSuccess: (data) => onSuccess(data as AppState | undefined) }
      );
    }
  }

  // 单步推进/回退一个分支的进度：点击当前节点视作回退一步（首位则清除）。
  async function stepBranchNode(
    repoPath: string,
    branchName: string,
    targetIndex: number,
    currentIndex: number,
    options: string[]
  ) {
    let next: string;
    if (targetIndex === currentIndex) {
      next = targetIndex <= 0 ? "" : options[targetIndex - 1];
    } else {
      next = options[targetIndex] ?? "";
    }
    await applyBranchNode(repoPath, branchName, next);
  }

  // 切换并持久化主题；data-theme 的实际生效由独立的 useEffect 完成。
  async function applyTheme(theme: ThemeId) {
    setThemeMenuOpen(false);
    await syncAction(() => window.desktopApi.setTheme(theme), {
      onSuccess: (data) => {
        if (data) {
          setState(data as AppState);
        }
      }
    });
  }

  // 在系统文件管理器中打开配置目录。
  async function openConfigDir() {
    await syncAction(() => window.desktopApi.openConfigDirectory());
  }

  // 触发主进程的设置导出流程，让用户选择目标文件路径。
  async function exportAppSettings() {
    await syncAction(() => window.desktopApi.exportSettings());
  }

  // 在二次确认后触发主进程的设置导入流程并刷新本地状态。
  async function importAppSettings() {
    const confirmed = window.confirm(
      "导入将覆盖当前的所有设置（仓库列表、扫描目录、标签、别名、进度等），确认继续吗？"
    );

    if (!confirmed) {
      return;
    }

    await syncAction(() => window.desktopApi.importSettings(), {
      onSuccess: (data) => {
        if (data) {
          setState(data as AppState);
        }
      }
    });
  }

  // 触发一次更新检查：通过主进程访问 GitHub Releases API，将结果存到 updateInfo 状态中。
  async function checkForUpdates() {
    setCheckingUpdate(true);
    try {
      const result = await window.desktopApi.checkForUpdates();
      if (result.ok && result.data) {
        setUpdateInfo(result.data);
        showToast({ tone: "info", text: result.message }, "ipc");
      } else {
        setUpdateInfo(null);
        showToast({ tone: "error", text: result.message }, "ipc");
      }
    } catch (error) {
      reportError(error, "检查更新失败。", "ipc");
    } finally {
      setCheckingUpdate(false);
    }
  }

  // 在系统浏览器中打开外部 URL（仅 http/https）。
  async function openExternal(url: string) {
    await syncAction(() => window.desktopApi.openExternalUrl(url));
  }

  // 通过主进程切换主窗口的开发者工具。
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
          <div className="theme-picker">
            <button
              className="secondary-button theme-picker-button"
              onClick={() => setThemeMenuOpen((current) => !current)}
              title="切换主题"
              aria-label="切换主题"
            >
              <Palette size={14} />
              <span>主题</span>
              <ChevronDown size={12} />
            </button>
            {themeMenuOpen ? (
              <div className="theme-picker-menu">
                {THEMES.map((option) => {
                  const active = (state.settings.theme ?? "midnight") === option.id;
                  return (
                    <button
                      key={option.id}
                      className={active ? "active" : ""}
                      onClick={() => void applyTheme(option.id)}
                    >
                      <span className={`theme-swatch theme-swatch-${option.id}`} />
                      <span className="theme-label">
                        <strong>{option.label}</strong>
                        <em>{option.description}</em>
                      </span>
                      {active ? <Check size={14} /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
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
              <button
                className="secondary-button"
                onClick={() => void checkForUpdates()}
                disabled={checkingUpdate}
              >
                {checkingUpdate ? "检查中…" : "检查更新"}
              </button>
              <button className="secondary-button" onClick={() => void openConfigDir()}>
                打开配置目录
              </button>
              <button className="secondary-button" onClick={() => void exportAppSettings()}>
                导出设置
              </button>
              <button className="secondary-button" onClick={() => void importAppSettings()}>
                导入设置
              </button>
              <button className="secondary-button" onClick={() => void openDevTools()}>
                打开开发者工具
              </button>
              <button className="ghost-button" onClick={() => setDebugEntries([])}>
                清空日志
              </button>
            </div>
          </div>

          {updateInfo ? (
            <div className={`update-banner${updateInfo.hasUpdate ? " has-update" : ""}`}>
              <div className="update-banner-text">
                <strong>
                  {updateInfo.hasUpdate
                    ? `发现新版本 v${updateInfo.latest}`
                    : `已是最新版本 v${updateInfo.current}`}
                </strong>
                <span>
                  当前版本 v{updateInfo.current}
                  {updateInfo.hasUpdate ? ` · 最新版本 v${updateInfo.latest}` : ""}
                </span>
              </div>
              <div className="update-banner-actions">
                {updateInfo.hasUpdate ? (
                  <button
                    className="primary-button"
                    onClick={() => void openExternal(updateInfo.url)}
                  >
                    前往下载
                  </button>
                ) : null}
                <button
                  className="ghost-button"
                  onClick={() => void openExternal(updateInfo.url)}
                >
                  查看 Release
                </button>
              </div>
            </div>
          ) : null}

          <div className="diagnostics-grid">
            <div className="subpanel">
              <div className="subpanel-header">
                <h3>运行环境</h3>
              </div>
              {debugInfo ? (
                <dl className="debug-info-list">
                  <div>
                    <dt>应用版本</dt>
                    <dd>v{debugInfo.appVersion}</dd>
                  </div>
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
                    <dd className="config-path-cell">
                      <code>{debugInfo.userDataPath}</code>
                      <button
                        className="branch-icon-button"
                        onClick={() => void openConfigDir()}
                        title="在文件管理器中打开"
                        aria-label="打开配置目录"
                      >
                        <FolderOpen size={12} />
                      </button>
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
                <div className="display-divider" />
                <div className="node-options-setting">
                  <label>全局进度选项</label>
                  <div className="node-options-row">
                    <div className="node-options-summary">
                      {(state.settings.branchNodeOptions ?? []).length === 0
                        ? "未配置"
                        : (state.settings.branchNodeOptions ?? [])
                            .map((option, index) => `${index + 1}. ${option}`)
                            .join("   ")}
                    </div>
                    <button
                      className="branch-icon-button"
                      onClick={() => openNodeOptionsEditor({ kind: "global" })}
                      title="管理全局进度选项"
                      aria-label="管理全局进度选项"
                    >
                      <Edit3 size={14} />
                    </button>
                  </div>
                  <p className="node-options-hint">每个分支默认不显示进度，需要时单独设置；仓库也可单独配置选项。</p>
                </div>
                <div className="display-divider" />
                <div className="display-height-setting">
                  <label htmlFor="repo-card-max-height">卡片最大高度</label>
                  <div className="display-height-input-row">
                    <input
                      id="repo-card-max-height"
                      type="number"
                      min={MIN_REPO_CARD_MAX_HEIGHT}
                      step={20}
                      placeholder="不限"
                      value={repoCardHeightDraft}
                      onChange={(event) => setRepoCardHeightDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void applyRepoCardMaxHeight();
                        }
                      }}
                    />
                    <span>px</span>
                    <button
                      className="branch-icon-button"
                      onClick={() => void applyRepoCardMaxHeight()}
                      title="应用高度"
                      aria-label="应用卡片最大高度"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      className="branch-icon-button"
                      onClick={() => void clearRepoCardMaxHeight()}
                      title="不限高度"
                      aria-label="清除卡片最大高度"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
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
                <article
                  className={repoCardMaxHeight ? "repo-card repo-card-limited" : "repo-card"}
                  key={repo.id}
                  style={repoCardStyle}
                >
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
                        onClick={() =>
                          openNodeOptionsEditor({ kind: "repo", repoPath: repo.path })
                        }
                        disabled={isBusy}
                        title="管理本仓库的进度选项"
                        aria-label={`管理 ${repo.name} 的进度选项`}
                      >
                        <ListChecks size={14} />
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
                        const node = state.settings.branchNodes[repo.path]?.[branch] ?? "";
                        const nodeOptions = getEffectiveNodeOptions(repo.path);
                        const nodeOptionIndex = node ? nodeOptions.indexOf(node) : -1;
                        // 只有分支已经设置过节点（且未关闭显示）时才渲染步进条。
                        const showProgress =
                          repoDisplay.branchNodes && nodeOptionIndex >= 0 && nodeOptions.length > 0;
                        const canStartProgress =
                          repoDisplay.branchNodes &&
                          nodeOptionIndex < 0 &&
                          nodeOptions.length > 0;
                        const initMenuOpen = branchNodeInitKey === key;

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

                                {showProgress ? (
                                  <div className="branch-stepper">
                                    <div className="branch-stepper-track">
                                      {nodeOptions.map((option, index) => {
                                        const done = index <= nodeOptionIndex;
                                        return (
                                          <span
                                            key={option}
                                            className="branch-stepper-cell"
                                          >
                                            <button
                                              type="button"
                                              className={`branch-stepper-dot${done ? " done" : ""}`}
                                              onClick={() =>
                                                void stepBranchNode(
                                                  repo.path,
                                                  branch,
                                                  index,
                                                  nodeOptionIndex,
                                                  nodeOptions
                                                )
                                              }
                                              title={
                                                index === nodeOptionIndex
                                                  ? `当前：${option}（点击回退）`
                                                  : index < nodeOptionIndex
                                                    ? `回退到 ${option}`
                                                    : `前进到 ${option}`
                                              }
                                              aria-label={`设置 ${branch} 进度为 ${option}`}
                                            />
                                            {index < nodeOptions.length - 1 ? (
                                              <span
                                                className={`branch-stepper-line${index < nodeOptionIndex ? " done" : ""}`}
                                              />
                                            ) : null}
                                          </span>
                                        );
                                      })}
                                    </div>
                                    <span className="branch-stepper-label">{node}</span>
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
                                {canStartProgress ? (
                                  <div className="branch-node-wrap">
                                    <button
                                      className="branch-icon-button"
                                      onClick={() =>
                                        setBranchNodeInitKey((current) =>
                                          current === key ? null : key
                                        )
                                      }
                                      title="为此分支设置进度"
                                      aria-label={`为 ${branch} 设置进度`}
                                    >
                                      <ListChecks size={14} />
                                    </button>
                                    {initMenuOpen ? (
                                      <div className="branch-node-menu">
                                        <span className="branch-node-menu-footer">
                                          选择起始进度
                                        </span>
                                        {nodeOptions.map((option, index) => (
                                          <button
                                            key={option}
                                            type="button"
                                            onClick={() => {
                                              setBranchNodeInitKey(null);
                                              void applyBranchNode(
                                                repo.path,
                                                branch,
                                                option
                                              );
                                            }}
                                          >
                                            <span className="branch-node-menu-index">
                                              {index + 1}
                                            </span>
                                            <span>{option}</span>
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
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

      {nodeOptionsScope ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setNodeOptionsScope(null)}
        >
          <section
            className="node-options-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="node-options-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="node-options-modal-header">
              <div>
                <p className="panel-label">进度选项</p>
                <h2 id="node-options-modal-title">
                  {nodeOptionsScope.kind === "global"
                    ? "管理全局进度选项"
                    : `管理 ${nodeOptionsScope.repoPath.split(/[/\\]/).pop() ?? ""} 的进度选项`}
                </h2>
                {nodeOptionsScope.kind === "repo" ? (
                  <p className="node-options-hint">为当前仓库自定义一套进度，不影响其它仓库。</p>
                ) : (
                  <p className="node-options-hint">未单独配置的仓库会使用这里的全局选项。</p>
                )}
              </div>
              <button
                className="ghost-button"
                onClick={() => setNodeOptionsScope(null)}
              >
                关闭
              </button>
            </div>

            {nodeOptionsScope.kind === "repo" ? (
              <label className="node-options-toggle">
                <input
                  type="checkbox"
                  checked={nodeOptionsUseGlobal}
                  onChange={(event) => setNodeOptionsUseGlobal(event.target.checked)}
                />
                <span>使用全局默认</span>
              </label>
            ) : null}

            {nodeOptionsUseGlobal && nodeOptionsScope.kind === "repo" ? (
              <p className="empty-text">已切换为全局默认，保存后将清除本仓库的自定义。</p>
            ) : (
              <>
                <div className="node-options-list">
                  {nodeOptionsDraft.length === 0 ? (
                    <p className="empty-text">还没有进度选项，添加一个开始吧。</p>
                  ) : (
                    nodeOptionsDraft.map((option, index) => (
                      <div className="node-options-row" key={`${option}-${index}`}>
                        <span className="node-options-index">{index + 1}</span>
                        <input
                          type="text"
                          value={option}
                          onChange={(event) =>
                            updateNodeOptionDraft(index, event.target.value)
                          }
                        />
                        <button
                          className="branch-icon-button danger"
                          onClick={() => removeNodeOptionDraft(index)}
                          title="删除"
                          aria-label={`删除 ${option}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="node-options-row">
                  <span className="node-options-index">
                    {nodeOptionsDraft.length + 1}
                  </span>
                  <input
                    type="text"
                    placeholder="新增进度名称（顺序按列表从上到下）"
                    value={nodeOptionsNewDraft}
                    onChange={(event) => setNodeOptionsNewDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        addNodeOptionDraft();
                      }
                    }}
                  />
                  <button
                    className="branch-icon-button"
                    onClick={() => addNodeOptionDraft()}
                    title="新增"
                    aria-label="新增进度"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </>
            )}

            <div className="node-options-modal-footer">
              <button
                className="secondary-button"
                onClick={() => setNodeOptionsScope(null)}
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => void saveNodeOptions()}
              >
                保存
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
