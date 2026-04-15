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
