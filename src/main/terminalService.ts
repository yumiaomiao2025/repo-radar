import { spawn } from "node:child_process";

export type TerminalId = "windowsTerminal" | "powershell";

export function openInTerminal(repoPath: string, terminal: TerminalId): void {
  const command = terminal === "windowsTerminal" ? "wt" : "powershell.exe";
  const args =
    terminal === "windowsTerminal"
      ? ["-d", repoPath]
      : ["-NoExit", "-Command", "Set-Location -LiteralPath $args[0]", repoPath];

  const child = spawn(command, args, {
    detached: true,
    shell: true,
    stdio: "ignore",
    windowsHide: false
  });

  child.unref();
}
