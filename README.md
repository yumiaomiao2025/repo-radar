# Repo Radar

Repo Radar 是一个面向 Windows 的桌面工具，用来集中管理本地 Git 仓库。它适合把常用仓库、扫描出来的仓库、分支信息和本地备注放在同一个界面里查看和操作。

## 功能

- 手动添加 Git 仓库。
- 添加扫描目录，并在扫描后二次确认要纳入管理的仓库。
- 查看仓库当前分支、本地分支数量、工作区状态和来源。
- 搜索仓库、路径、分支、分支别名和标签。
- 创建本地分支。
- 在工作区干净时切换分支。
- 安全删除本地分支，未合并分支会由 Git 拒绝。
- 为仓库设置多个标签。
- 为分支设置本地别名和多个标签，不会写入 Git。
- 复制仓库路径或分支名。
- 用 VS Code、Cursor、Antigravity、Windows Terminal 或 PowerShell 打开仓库。
- 按需隐藏仓库卡片里的状态、来源、统计信息、标签、分支名称、分支别名和分支标签。

## 技术栈

- Electron
- React
- TypeScript
- Vite
- pnpm
- lucide-react

## 本地开发

1. 安装依赖：

```bash
pnpm i
```

2. 启动开发环境：

```bash
pnpm run dev
```

3. 类型检查：

```bash
pnpm run typecheck
```

## 生产构建

- 运行 `pnpm run start:prod`：构建并以生产模式启动应用。
- 运行 `pnpm run dist:win`：构建 Windows 安装包。
- 打包产物会输出到 `release/` 目录。
- 普通用户通常只需要安装包，例如 `Repo Radar-Installer-0.1.0.exe`。
- `release/win-unpacked/` 是未压缩的便携版本，只在需要免安装版本时使用。

如果构建时报 `EPERM`，通常是旧的 `dist/` 文件被正在运行的应用或系统权限占用。先关闭正在运行的 Repo Radar，再重新执行构建命令。

## GitHub Releases

仓库里已经包含 GitHub Actions 工作流：`.github/workflows/release.yml`。

发布新的 Windows 安装包时：

1. 修改 `package.json` 里的版本号。
2. 提交代码。
3. 创建版本标签，例如 `v0.1.1`。
4. 推送分支和标签到 GitHub。

示例：

```bash
git add .
git commit -m "release: v0.1.1"
git tag v0.1.1
git push
git push origin v0.1.1
```

标签推送后，GitHub Actions 会自动：

- 使用 pnpm 安装依赖。
- 构建 Windows NSIS 安装包。
- 创建或更新对应标签的 GitHub Release。
- 上传 `release/` 目录里的 `.exe` 和 `.blockmap` 文件。

对大多数用户来说，只需要从 Release 页面下载 `.exe` 安装包。

## 数据和约定

- 应用配置存放在 Electron 的 `userData` 目录里，格式为 JSON。
- 仓库标签、分支别名和分支标签都是本地应用数据，不会污染 Git 仓库。
- 扫描目录使用保守的递归深度，默认最多向下搜索 3 层目录。
- Windows 安装包使用 `electron-builder` 和 NSIS target。
- `build/icon.png` 和 `build/icon.ico` 用于 Windows 打包图标。
