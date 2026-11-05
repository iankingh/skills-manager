# Skills Manager (AI Skills · Subagents · MCP 本機離線管理中心)

**將散落在 GitHub Copilot、Claude Code、OpenAI Codex 與自訂 AI 工具中的 Skills、AI Agents (Subagents) 與 MCP (Model Context Protocol) 伺服器設定，集中於本機安全統一管理。**

`React 19` · `Node.js / Express 5` · `System Tray (Windows / macOS / Linux)` · `100% 離線優先` · `零雲端依賴`

## 專案特色與核心架構

1. **三大模組統一納管**
   - **AI Skills (`SKILL.md`)**：支援 ZIP / `.skill` 壓縮檔匯入、本機資料夾匯入、手動建立與線上編輯、場景預設組合（Presets），並支援以 **Symlink / Windows Directory Junction** 或 **實體複製 (Copy)** 掛載至各 AI 工具。
   - **AI Agents (`agents/*.md`)**：集中管理各 AI 工具的專屬角色代理（Subagents），支援單一檔案或批次匯入、跨工具同步部署、自動去重與非代理說明檔過濾（自動排除 `README.md`、`CLAUDE.md`、macOS `._*` 等雜訊檔案）。
   - **MCP 伺服器 (`mcp/*.json`)**：支援 `stdio`、`http`、`sse` 三種傳輸協定，內建 **GitLab MCP**、**Filesystem MCP**、**SQLite MCP** 範例，提供 **JSON-RPC 2.0 `initialize` 一鍵連線測試**、**Windows `npx.cmd` 自動轉換**、**API Token 視覺遮罩保護**，並可一鍵同步寫入 `~/.copilot/mcp-config.json`、`~/.claude.json` 與 `~/.codex/config.toml`。
2. **獨立範例資料夾與 `.env` 環境變數自動引導**
   - 專案根目錄內建 `./skills`、`./agents`、`./mcp` 三個獨立範例資料夾，不再將預設範例寫死於程式碼中。
   - 啟動時若本機尚無 `.env`，`server/envConfig.ts` 會自動由 `.env.example` 複製產生，並載入所有工具路徑與 GitLab MCP 環境變數（`.gitignore` 已預設排除 `.env` 防止金鑰外洩）。
3. **跨平台相容性（Windows / macOS / Linux 開箱即用）**
   - **前端零預打包阻塞**：內建完整 SVG 圖示模組 (`src/lucide-react.tsx`) 並於 `vite.config.ts` 與 `tsconfig.app.json` 設定別名對應，徹底解決 Windows + Vite 7 下 `Failed to resolve entry for package "lucide-react"` 錯誤。
   - **原生系統匣 (System Tray)**：自動依作業系統切換圖示格式（Windows 使用 32-bit `.ico`、macOS/Linux 使用 `.png`），在 Windows 自動清除 `Zone.Identifier` 封鎖標記並啟用 `copyDir: true` 解決跨磁碟區（如 `D:\` 與 `C:\`）執行問題，在 macOS/Linux 自動設定 `0o755` 執行權限。
4. **多層次資安防護**
   - **本機邊界保護**：嚴格綁定 `127.0.0.1`，並由 `isTrustedLocalRequest` 攔截跨站請求（CSRF）與 DNS Rebinding 攻擊。
   - **檔案所有權簽章**：部署至外部工具的技能與代理均附帶 `.skills-manager-owned.json` SHA-256 數位簽章，若偵測到使用者個人非納管檔案或本機修改，一律拒絕覆蓋或誤刪。
   - **防範 Zip Slip / Zip Bomb 與指令注入**：嚴格以 `path.relative` 驗證壓縮檔路徑、限制 250MB 解壓縮上限，並鎖定設定檔權限為 `0o600`。

## 專案目錄結構

```text
skills-manager/
├── .env.example              # 環境變數與跨平台路徑範本 (首次啟動自動複製為 .env)
├── skills/                   # [預設範例] AI Skills 獨立範例資料夾
│   ├── code-review-pro/SKILL.md
│   └── offline-architecture-guide/SKILL.md
├── agents/                   # [預設範例] AI Agents (Subagents) 獨立範例資料夾
│   ├── security-auditor.md
│   └── system-architect.md
├── mcp/                      # [預設範例] MCP 伺服器獨立範例資料夾
│   ├── gitlab.json           # GitLab MCP 官方伺服器設定範本
│   ├── filesystem-local.json # 本機檔案系統 MCP 設定範本
│   ├── sqlite-local.json     # 本機 SQLite MCP 設定範本
│   └── mcp-config.example.json
├── server/                   # Node.js (Express 5) 本機服務與 CLI 核心
│   ├── index.ts              # HTTP API 路由與安全中介層
│   ├── envConfig.ts          # .env 自動引導與環境變數路徑解析
│   ├── agentRegistry.ts      # 三大內建 AI 工具路徑對照表
│   ├── store.ts              # 中央資料庫 (~/.skills-manager/db.json) 與範例增量同步
│   ├── skillManager.ts       # AI Skills 管理與 Symlink/Junction/Copy 部署核心
│   ├── subagentManager.ts    # AI Agents 管理、去重匯入與部署核心
│   ├── mcpManager.ts         # MCP JSON/TOML 讀寫、Windows .cmd 轉換與連線測試
│   ├── zipService.ts         # ZIP 匯入匯出、Zip Slip 防護與全量備份快照還原
│   ├── trayService.ts        # 跨平台 System Tray 常駐列服務 (ICO/PNG 自動切換)
│   ├── localRequest.ts       # Loopback Host / Origin / Sec-Fetch-Site 安全驗證
│   ├── pathSafety.ts         # 路徑穿越 (Path Traversal) 防護工具
│   └── cli.ts                # 離線命令列工具 (支援 skills / subagents / mcp / snapshots)
├── src/                      # React 19 + Tailwind CSS v4 前端控制台
│   ├── App.tsx               # 主框架、分頁導覽與 AI Skills 技能庫介面
│   ├── api.ts                # 前端 API 封裝
│   ├── lucide-react.tsx      # 零外部依賴內建 SVG 圖示庫 (解決 Windows Vite 預打包問題)
│   └── components/           # 各功能模組介面 (AiAgentsView, McpView, SettingsView 等)
├── SPECIFICATION.md          # 完整系統架構與 API 規格說明書
└── README.md                 # 專案說明文件
```

## 快速開始

### 1. 環境需求

- **作業系統**：Windows 10/11、macOS 12+ 或 Linux
- **Node.js**：建議 `v20.19+`、`v22.13+` 或 `v24+`

### 2. 安裝與開發模式啟動

```bash
git clone https://github.com/iankingh/skills-manager.git
cd skills-manager
npm install
npm run dev
```

啟動後會同時運行：
- **前端管理介面**：[http://127.0.0.1:5173](http://127.0.0.1:5173)
- **後端本機服務**：`http://127.0.0.1:3847`（並自動啟動右下角 / 右上角 System Tray 系統常駐列）

### 3. 正式建置與常駐啟動

```bash
npm run build
npm start
```

建置完成後，直接開啟 **[http://127.0.0.1:3847](http://127.0.0.1:3847)** 即可由單一 Node.js 服務同時提供網頁介面、API 與系統匣常駐服務。

## AI 工具預設路徑對照表

系統啟動時會自動讀取 `.env` 中的路徑設定（未修改時使用以下標準路徑，`~` 於 Windows 自動展開為 `C:\Users\<使用者帳號>`，於 macOS 展開為 `/Users/<使用者帳號>`）：

| AI 工具 | AI Skills 路徑 | AI Agents (Subagents) 路徑 | MCP 設定檔路徑與格式 |
| :--- | :--- | :--- | :--- |
| **GitHub Copilot** | `~/.copilot/skills/`<br>*(備援 `~/.agents/skills/`)* | `~/.copilot/agents/` | `~/.copilot/mcp-config.json`<br>*(JSON `mcpServers`)* |
| **Claude Code** | `~/.claude/skills/` | `~/.claude/agents/` | `~/.claude.json`<br>*(JSON `mcpServers`)* |
| **OpenAI Codex** | `~/.agents/skills/` | `~/.codex/agents/` | `~/.codex/config.toml`<br>*(TOML `[mcp_servers.<id>]`)* |

> 你可以在網頁介面的 **「工具路徑與系統設定」** 分頁中，針對任何工具個別修改 **Skills 路徑**、**Agents 路徑** 與 **MCP 設定檔路徑**，或新增自訂 AI 工具（如 Cursor、Windsurf、Cline 等）。

## GitLab MCP 與本機 MCP 伺服器使用指南

### 1. 設定 GitLab MCP

1. 前往 GitLab（官方 `gitlab.com` 或公司內部自架 GitLab）➔ **Edit profile** ➔ **Access Tokens**，建立具備 `api` 權限的 Personal Access Token（如 `glpat-xxxx`）。
2. 在專案根目錄的 `.env` 填入（或直接於網頁「MCP 伺服器管理」點擊 `gitlab` 卡片的「查看 / 編輯」修改 `env`）：
   ```env
   GITLAB_API_URL=https://gitlab.com/api/v4
   GITLAB_PERSONAL_ACCESS_TOKEN=glpat-你的Token填這裡
   ```
3. 在網頁「MCP 伺服器管理」頁面點擊 `gitlab` 卡片右上角的 **「測試連線」**，確認顯示綠色握手成功訊息。
4. 點擊卡片下方的 **Claude Code**、**GitHub Copilot** 或 **OpenAI Codex** 按鈕（亮綠燈即完成寫入）。

### 2. 在 AI 工具中呼叫 MCP

- **Claude Code**：於終端機執行 `claude`，輸入 `/mcp` 即可看見已掛載的 `gitlab`、`filesystem-local` 等伺服器，直接以自然語言下達指令即可呼叫。
- **OpenAI Codex**：於終端機執行 `codex`，會自動載入 `~/.codex/config.toml` 中的 `[mcp_servers.*]` 設定。
- **GitHub Copilot**：重新啟動 Copilot CLI / VS Code Agent 模式即可讀取設定檔。

## CLI 命令列工具

不必開啟瀏覽器即可透過 `npm run cli --` 執行所有管理操作：

```bash
# 1. 檢視所有支援的 AI 工具與對應路徑 (Skills / Agents / MCP)
npm run cli -- agents list

# 2. 管理 AI Skills
npm run cli -- skills list
npm run cli -- skills import-zip ./my-skill.zip
npm run cli -- skills import-dir ./skills/code-review-pro
npm run cli -- skills deploy code-review-pro claude_code
npm run cli -- skills undeploy code-review-pro claude_code

# 3. 管理 AI Agents (Subagents)
npm run cli -- subagents list
npm run cli -- subagents deploy security-auditor claude_code

# 4. 管理與測試 MCP 伺服器
npm run cli -- mcp list
npm run cli -- mcp test filesystem-local
npm run cli -- mcp deploy gitlab claude_code

# 5. 從專案 ./skills、./agents、./mcp 資料夾增量同步範例
npm run cli -- seeds sync

# 6. 建立全量本機離線備份快照 (含 Skills、Agents、MCP 與 Presets)
npm run cli -- snapshots create "部署前完整備份"
```

## 開發、測試與規格文件

- **系統規格書**：詳細架構設計、資料模型、REST API 端點規格與資安機制請參閱 [`SPECIFICATION.md`](SPECIFICATION.md)。
- **常用開發指令**：
  - `npm run dev`：同時啟動後端 (`tsx watch`) 與前端 (`vite`)
  - `npm test`：執行 Vitest 單元與整合測試
  - `npm run lint`：執行 ESLint 靜態檢查
  - `npm run build`：編譯前端與後端 TypeScript 產物

## 授權條款

本專案採用 [MIT License](LICENSE) 授權。
