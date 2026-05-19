import { execFile, spawn } from "node:child_process";
import type { EditorAvailability, EditorId } from "../shared/types.js";

const EDITOR_COMMANDS: Record<EditorId, { label: string; command: string }> = {
  vscode: {
    label: "VS Code",
    command: "code"
  },
  cursor: {
    label: "Cursor",
    command: "cursor"
  },
  antigravity: {
    label: "Antigravity",
    command: "antigravity"
  }
};

// 通过 Windows 自带的 where.exe 判断某个命令是否存在于 PATH 中。
function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "where.exe",
      [command],
      {
        windowsHide: true
      },
      (error) => {
        resolve(!error);
      }
    );
  });
}

// 并发探测所有支持的编辑器是否可用，返回编辑器 ID 到可用性信息的映射。
export async function getEditorAvailability(): Promise<
  Record<EditorId, EditorAvailability>
> {
  const availability = await Promise.all(
    Object.entries(EDITOR_COMMANDS).map(async ([id, value]) => {
      const available = await commandExists(value.command);

      return [
        id,
        {
          id: id as EditorId,
          label: value.label,
          command: value.command,
          available
        }
      ] as const;
    })
  );

  return Object.fromEntries(availability) as Record<
    EditorId,
    EditorAvailability
  >;
}

// 使用指定的编辑器以分离进程方式打开仓库目录，不阻塞主进程。
export async function openInEditor(
  editor: EditorId,
  repoPath: string
): Promise<void> {
  const command = EDITOR_COMMANDS[editor]?.command;

  if (!command) {
    throw new Error(`Unsupported editor: ${editor}`);
  }

  const child = spawn(command, [repoPath], {
    detached: true,
    shell: true,
    stdio: "ignore",
    windowsHide: true
  });

  child.unref();
}
