# Skills & Agents & MCP Manager — React 前端 + Node.js 本機服務 + System Tray（本機離線優先版）

本專案是 [`xingkongliang/skills-manager`](https://github.com/xingkongliang/skills-manager) 的非官方修改版，套件名稱為 `skills-manager`。架構為 **React 19 前端 + Node.js (Express 5) 本機服務 + System Tray 系統常駐列**，獨立管理 **AI Skills**、**AI Agents (Subagents)** 與 **MCP (Model Context Protocol)**。管理介面與服務綁定在本機，不呼叫原版的更新服務或 GitHub 備份；使用者自行設定的 MCP 命令或端點仍可能連線到外部服務。

---

## AI Skills / AI Agents / MCP 完整路徑對照表

| AI 工具 | 模組分類 | 專案層級 (Project Level) | 個人／全域層級 (Personal / Global Level) |
| :--- | :--- | :--- | :--- |
| **GitHub Copilot** | **AI Skills** | `.github/skills/`、`.agents/skills/`、`.claude/skills/` | `~/.copilot/skills/`、`~/.agents/skills/` |
| **GitHub Copilot** | **AI Agents** | `.github/agents/` | `~/.copilot/agents/` |
| **GitHub Copilot** | **MCP 設定** | `.vscode/mcp.json`、`.github/mcp-config.json` | `~/.copilot/mcp-config.json` |
| **Claude Code** | **AI Skills** | `.claude/skills/` | `~/.claude/skills/` |
| **Claude Code** | **AI Agents** | `.claude/agents/` | `~/.claude/agents/` |
| **Claude Code** | **MCP 設定** | `.mcp.json` | `~/.claude.json` (`mcpServers`) |
| **OpenAI Codex** | **AI Skills** | `.agents/skills/` | `~/.agents/skills/` |
| **OpenAI Codex** | **AI Agents** | `.codex/agents/` | `~/.codex/agents/` |
| **OpenAI Codex** | **MCP 設定** | `.codex/config.toml` | `~/.codex/config.toml` (`[mcp_servers.*]`) |

---

## 三大獨立管理模組

1. **AI Skills 技能庫 (`~/.skills-manager/skills`)**：
   - 管理包含 `SKILL.md` 的技能資料夾，支援 ZIP 壓縮檔匯入、本機資料夾匯入、下載匯出 ZIP、以及高速批次部署至指定工具。
2. **AI Agents 專屬代理庫 (`~/.skills-manager/agents`)**：
   - 獨立管理各工具 `agents/` 目錄下的專屬角色代理定義檔 (`.md` / `.toml`)，支援建立 Subagent、ZIP 匯入/匯出、指定工具部署、以及檢視/編輯個人資料夾中現有的 AI Agents。
3. **MCP 伺服器管理中心 (`db.json -> mcpServers`)**：
   - 獨立管理 Model Context Protocol 伺服器 (`stdio` / `http` / `sse`)，支援一鍵將 MCP 設定同步寫入 `~/.copilot/mcp-config.json`、`~/.claude.json` 與 `~/.codex/config.toml`，並內建各工具設定檔原始碼檢視與編輯器。

---

## 快速開始 (Getting Started)

建議使用 Node.js 22.13 以上的 22.x 版本或 Node.js 24 以上；亦支援 Node.js 20.19 以上的 20.x 版本。

```bash
git clone https://github.com/iankingh/skills-manager.git
cd skills-manager
npm ci
npm run dev
```

開發模式請在瀏覽器開啟 `http://127.0.0.1:5173`。正式執行可用 `npm run build && npm start`，再開啟 `http://127.0.0.1:3847`；系統匣依設定啟用。首次安裝 npm 相依套件需要取得套件，之後管理功能可在本機使用。

服務與開發伺服器目前都只監聽 IPv4 loopback (`127.0.0.1`)；IPv6 loopback 標頭的驗證相容性不代表已提供 `[::1]` 監聽。

## 開發驗證

```bash
npm test
npm run lint
npm run build
```

GitHub Actions 會在推送至 `main` 或建立目標為 `main` 的 Pull Request 時，使用 Node.js 22 在 Ubuntu、macOS 與 Windows 執行乾淨安裝及以上檢查。ZIP 匯出採用 Archiver 8；Lint 採用 ESLint 10，並保留既有的 React Hooks 規則範圍。

## 授權與來源

此修改版保留原專案的 Git 歷史及 [MIT 授權與原作者著作權聲明](LICENSE)。原作者為 Tianliang Zhang；本版主要改動為以 Node.js 本機服務與系統匣取代 Tauri/Rust、加入 Subagents 與 MCP 管理，並移除原版的發佈與更新流程。本專案不是原作者的官方發行版。
