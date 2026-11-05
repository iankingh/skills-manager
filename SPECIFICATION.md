# Skills Manager 系統規格說明書 (System Specification)

- **版本**：`2.0.0-offline`
- **定位**：跨平台（Windows / macOS / Linux）100% 本機離線 AI Skills、AI Agents (Subagents) 與 MCP (Model Context Protocol) 集中管理系統。
- **技術棧**：
  - **前端 (Web UI)**：React 19、TypeScript 5.8、Tailwind CSS v4、Vite 7、內建零依賴 SVG 圖示系統 (`src/lucide-react.tsx`)
  - **後端 (Local Service & CLI)**：Node.js、Express 5、Multer、AdmZip、Archiver、YAML
  - **系統常駐列 (System Tray)**：`systray2`（支援 Windows `.ico` 與 macOS/Linux `.png` 雙格式自動切換與執行檔防禦性啟動）
  - **測試框架**：Vitest 3

## 1. 系統架構設計 (Architecture Overview)

### 1.1 架構分層

系統分為四個核心層次：

1. **展示與互動層 (Presentation Layer)**
   - **Web 控制台 (`src/`)**：提供六大功能視圖（AI Skills 技能庫、AI Agents 代理庫、MCP 伺服器管理、各 AI 工具個人資料夾、本機 ZIP 備份與紀錄、工具路徑與系統設定）。頂部工具列具備情境感知（Context-Aware Header），僅在對應分頁顯示專屬操作按鈕。
   - **系統常駐列 (`server/trayService.ts`)**：常駐於 Windows 右下角系統匣或 macOS 頂部 Menu Bar，提供快速開啟網頁控制台、一鍵切換場景組合（Presets）、重新掃描個人資料夾、建立快照與結束服務功能。
   - **離線 CLI (`server/cli.ts`)**：提供無頭（Headless）命令列管理能力，涵蓋 `skills`、`subagents`、`mcp`、`agents`、`seeds` 與 `snapshots` 六大指令群組。
2. **本機安全閘道與路由層 (`server/index.ts`, `server/localRequest.ts`)**
   - 嚴格綁定 IPv4 Loopback (`127.0.0.1:3847`)。
   - 透過 `isTrustedLocalRequest` 驗證 HTTP `Host`、`Origin` 與 `Sec-Fetch-Site`，防止外部網站透過瀏覽器發動跨站請求偽造（CSRF）或 DNS Rebinding 攻擊。
   - 強制附加 `Content-Security-Policy`、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff` 等安全回應標頭。
3. **領域業務邏輯層 (Domain Managers)**
   - **`SkillManager` (`server/skillManager.ts`)**：管理中央技能庫 (`~/.skills-manager/skills/`)，負責解析 `SKILL.md` Frontmatter、計算目錄 SHA-256 簽章、執行 Symlink / Windows Junction / Copy 部署與外部技能納管（Adopt）。
   - **`SubagentManager` (`server/subagentManager.ts`)**：管理中央代理庫 (`~/.skills-manager/agents/`)，支援 `.md` / `.toml` 角色定義檔剖析、ZIP 與本機路徑去重匯入（自動過濾 `README.md`、`CLAUDE.md` 與 macOS `._*` 檔案）及跨工具同步。
   - **`McpManager` (`server/mcpManager.ts`)**：管理中央 MCP 伺服器設定，支援 JSON (`mcpServers`) 與 OpenAI Codex TOML (`[mcp_servers.<id>]`) 雙向無損讀寫、Windows `.cmd` 指令自動轉換，以及真實的子行程 JSON-RPC 2.0 `initialize` 握手連線測試。
   - **`ZipAndFolderService` (`server/zipService.ts`)**：處理 ZIP 壓縮包匯入／匯出、防範 Zip Slip 路徑穿越與 250MB Zip Bomb 上限，並負責包含 `skills/`、`agents/`、`mcpServers` 與 `presets` 的全量快照備份與還原。
4. **組態與持久化儲存層 (`server/envConfig.ts`, `server/store.ts`)**
   - **`envConfig.ts`**：啟動時自動檢查專案根目錄 `.env`（若不存在則由 `.env.example` 自動複製），載入連接埠、中央庫路徑、各工具預設路徑與 GitLab MCP 環境變數。
   - **`LocalStore` (`server/store.ts`)**：以原子寫入（Atomic Write 先寫入 `db.json.tmp` 再 `rename`）維護 `~/.skills-manager/db.json`（權限鎖定為 `0o600`），並支援從專案根目錄 `./skills`、`./agents`、`./mcp` 增量同步預設範例。

## 2. 目錄與資料儲存規格 (Storage & File Layout)

### 2.1 專案內建範例與環境變數目錄

| 路徑 | 類型 | 用途說明 |
| :--- | :--- | :--- |
| `.env` / `.env.example` | 設定檔 | 定義 `PORT`、中央庫路徑、三大 AI 工具之 Skills/Agents/MCP 路徑，以及 `GITLAB_API_URL`、`GITLAB_PERSONAL_ACCESS_TOKEN` 等變數。`.env` 已列入 `.gitignore` 避免密鑰外洩。 |
| `./skills/<skill-id>/SKILL.md` | 資料夾 | 專案內建預設技能範例（如 `code-review-pro`、`offline-architecture-guide`）。 |
| `./agents/<agent-id>.md` | 檔案 | 專案內建預設 AI Subagent 範例（如 `security-auditor.md`、`system-architect.md`）。 |
| `./mcp/<server-id>.json` | 檔案 | 專案內建預設 MCP 伺服器設定檔（如 `gitlab.json`、`filesystem-local.json`、`sqlite-local.json`）。支援 `${ENV_VAR}` 與 `~` 路徑自動展開。 |

### 2.2 使用者本機中央儲存庫 (`~/.skills-manager/`)

```text
~/.skills-manager/
├── repo-config.json          # 紀錄自訂中央儲存庫位置之引導檔
├── db.json                   # 核心資料庫 (0o600 權限：包含 settings, agents, skills, subagents, mcpServers, presets, activityLogs)
├── skills/                   # 中央 AI Skills 實體資料夾 (每個子資料夾為一個 Skill)
├── agents/                   # 中央 AI Agents (Subagents) 實體檔案 (*.md / *.toml)
└── backups/                  # 全量離線備份快照 (*.zip，內含 skills/、agents/ 與 snapshot-meta.json)
```

### 2.3 目標 AI 工具路徑規格

| 工具代號 (`key`) | 顯示名稱 | Skills 預設全域路徑 | Agents 預設全域路徑 | MCP 預設設定檔與格式 |
| :--- | :--- | :--- | :--- | :--- |
| `github_copilot` | GitHub Copilot | `~/.copilot/skills` | `~/.copilot/agents` | `~/.copilot/mcp-config.json` (`json-mcpServers`) |
| `claude_code` | Claude Code | `~/.claude/skills` | `~/.claude/agents` | `~/.claude.json` (`json-mcpServers`) |
| `codex` | OpenAI Codex | `~/.agents/skills` | `~/.codex/agents` | `~/.codex/config.toml` (`toml-codex`) |
| `custom_*` | 自訂工具 | 使用者自訂 | 使用者自訂 | 使用者自訂 (`.json` 或 `.toml`) |

## 3. 核心資料結構規格 (Data Models)

### 3.1 `SkillRecord` (AI Skill 紀錄)
- `id`: `string` — 技能唯一識別代號（對應資料夾名稱）
- `name`: `string` — 由 `SKILL.md` YAML Frontmatter 解析之名稱
- `description`: `string` — 技能用途描述
- `dirName`: `string` — 資料夾名稱
- `centralPath`: `string` — 中央庫絕對路徑
- `sourceType`: `'zip' | 'local-folder' | 'adopted' | 'manual'`
- `tags`: `string[]` — 分類標籤
- `fileCount`: `number` / `totalBytes`: `number` / `contentHash`: `string`
- `deployments`: `Record<agentKey, { deployed: boolean; mode: 'symlink' | 'junction' | 'copy' | 'external' | 'none'; targetPath: string }>`

### 3.2 `SubagentRecord` (AI Agent 角色代理紀錄)
- `id`: `string` — 代理唯一識別代號（去除 `.md` / `.agent.md` / `.toml` 後之檔名）
- `name`: `string` — 顯示名稱
- `description`: `string` — 職責描述
- `tools`: `string[]` — 允許調用之工具清單（如 `["Read", "Grep", "Glob", "Bash"]`）
- `fileName`: `string` — 儲存於中央庫之檔案名稱（統一正規化為 `<id>.md`）
- `centralPath`: `string` — 中央庫檔案絕對路徑
- `deployments`: `Record<agentKey, { deployed: boolean; targetPath: string }>`

### 3.3 `McpServerRecord` (MCP 伺服器紀錄)
- `id`: `string` — MCP Server 鍵值（如 `gitlab`、`filesystem-local`）
- `name`: `string` — 顯示名稱
- `description`: `string` — 伺服器用途說明
- `transport`: `'stdio' | 'http' | 'sse'` — 傳輸協定
- `command`: `string` — `stdio` 執行指令（Windows 部署時自動將 `npx`/`npm`/`pnpm`/`yarn` 正規化為 `.cmd`）
- `args`: `string[]` — 啟動參數陣列（支援帶空白之雙引號路徑解析）
- `env`: `Record<string, string>` — 環境變數鍵值對（前端卡片自動遮罩含 `TOKEN`/`KEY`/`SECRET`/`PASSWORD`/`PAT` 之敏感值）
- `url`: `string | undefined` — `http` / `sse` 端點網址（強制驗證僅允許 `http:` 或 `https:`）
- `deployments`: `Record<agentKey, { deployed: boolean; configPath: string }>`

## 4. RESTful API 介面規格 (HTTP API Specification)

所有端點皆受 `isTrustedLocalRequest` 保護，僅接受來自 `127.0.0.1` / `localhost` 的本機請求，回應格式統一包含 `{ ok: boolean, ... }`。

### 4.1 系統總覽與專案範例同步
| 方法 | 路徑 | 說明 |
| :--- | :--- | :--- |
| `GET` | `/api/overview` | 取得系統總覽（含 `settings`、`agents`、`skills`、`subagents`、`mcpServers`、`presets`、`snapshots`、`activityLogs` 與 `trayStatus`）。 |
| `POST` | `/api/seeds/sync` | 從專案 `./skills`、`./agents`、`./mcp` 資料夾增量同步範例至中央庫，回傳 `{ addedSkills, addedSubagents, addedMcp }`。 |
| `PUT` | `/api/settings` | 更新中央儲存庫路徑（支援自動遷移）、同步模式 (`symlink`/`copy`) 與系統匣開關。 |

### 4.2 AI Skills 管理端點
| 方法 | 路徑 | 說明 |
| :--- | :--- | :--- |
| `GET` | `/api/skills/:id` | 讀取指定技能之 `SKILL.md` 內容與檔案列表。 |
| `POST` | `/api/skills/create` | 手動建立新技能與 `SKILL.md`。 |
| `PUT` | `/api/skills/:id` | 更新技能之 `SKILL.md` 內容與標籤，並自動同步至已部署之 Copy 副本。 |
| `POST` | `/api/skills/delete` | 批次刪除中央技能並安全移除各工具之受管掛載。 |
| `POST` | `/api/skills/:id/deploy` | 切換單一技能於指定 AI 工具之部署狀態。 |
| `POST` | `/api/skills/batch-deploy` | 批次將多個技能部署或移除於多個 AI 工具。 |
| `POST` | `/api/skills/import-zip` | 上傳 `.zip` / `.skill` 壓縮檔匯入技能（含 Zip Slip 與 250MB 上限檢查）。 |
| `POST` | `/api/skills/import-folder-upload` | 透過瀏覽器資料夾選擇器上傳整個技能資料夾。 |
| `POST` | `/api/skills/import-local-path` | 指定本機路徑匯入技能資料夾。 |
| `GET` | `/api/skills/:id/download-zip` | 將單一技能打包為 `.zip` 下載。 |
| `POST` | `/api/skills/export-zip` | 批次將多個或全部技能打包為 `.zip` 下載。 |

### 4.3 AI Agents (Subagents) 管理端點
| 方法 | 路徑 | 說明 |
| :--- | :--- | :--- |
| `GET` | `/api/subagents` | 列出中央庫所有 Subagents 與各工具個人資料夾中的外部 Subagents。 |
| `GET` | `/api/subagents/:id` | 讀取指定中央 Subagent 之 Markdown 內容。 |
| `POST` | `/api/subagents/create` | 手動建立新 Subagent (`.md`)。 |
| `PUT` | `/api/subagents/:id` | 更新中央 Subagent 內容並自動同步至已部署之工具資料夾。 |
| `POST` | `/api/subagents/delete` | 批次刪除 Subagents 並清理各工具受管副本。 |
| `POST` | `/api/subagents/batch-deploy` | 批次部署或移除 Subagents 至多個 AI 工具。 |
| `POST` | `/api/subagents/import-zip` | 從 ZIP 壓縮包匯入 Subagents（自動過濾說明檔、隱藏檔並依 ID 去重）。 |
| `POST` | `/api/subagents/import-local-path` | 從本機單一 `.md`/`.toml` 檔案或資料夾路徑匯入 Subagents。 |
| `POST` | `/api/subagents/adopt` | 將外部工具個人資料夾中之 Subagent 納管匯入中央庫。 |
| `POST` | `/api/subagents/export-zip` | 將所選 Subagents 打包為 `.zip` 下載。 |

### 4.4 MCP 伺服器管理與測試端點
| 方法 | 路徑 | 說明 |
| :--- | :--- | :--- |
| `GET` | `/api/mcp` | 列出中央 MCP 伺服器與各工具設定檔中實際存在的 MCP 項目。 |
| `POST` | `/api/mcp/upsert` | 新增或更新中央 MCP 伺服器設定。 |
| `POST` | `/api/mcp/delete` | 從中央庫與所有工具設定檔移除指定 MCP 伺服器。 |
| `POST` | `/api/mcp/batch-deploy` | 批次將 MCP 寫入或移除於各工具之 JSON / TOML 設定檔。 |
| `POST` | `/api/mcp/:id/test` | **連線測試**：對 `stdio` 啟動子行程發送 JSON-RPC 2.0 `initialize` 握手測試；對 `http`/`sse` 測試端點連線與延遲。 |
| `POST` | `/api/mcp/adopt` | 將工具個人設定檔中的既有 MCP 納管匯入中央庫（支援完整解析 Codex TOML 的 `env` 與 Windows 反斜線路徑）。 |
| `GET` / `PUT` | `/api/mcp/raw-config/:agentKey` | 直接檢視或編輯指定工具之原始 MCP 設定檔（儲存前自動驗證 JSON 格式）。 |
| `POST` | `/api/mcp/import` | 匯入 `.json` 或 `.zip` 格式之 `mcpServers` 設定檔。 |
| `POST` | `/api/mcp/export-zip` | 將 MCP 設定匯出為包含 `mcp-config.json` 之 `.zip`。 |

### 4.5 場景組合 (Presets)、全量快照 (Snapshots) 與檔案系統端點
| 方法 | 路徑 | 說明 |
| :--- | :--- | :--- |
| `POST` / `PUT` / `DELETE` | `/api/presets`、`/api/presets/:id` | 建立、更新或刪除技能場景預設組合。 |
| `POST` | `/api/presets/:id/apply` | 一鍵套用或停用指定場景組合。 |
| `POST` | `/api/snapshots` | 建立包含 `skills/`、`agents/`、`mcpServers` 與 `presets` 的全量離線備份快照。 |
| `POST` | `/api/snapshots/:filename/restore` | 還原指定快照（還原前自動建立安全備份，並精準分離還原 `skills/`、`agents/` 與 `db` 設定）。 |
| `GET` / `DELETE` | `/api/snapshots/:filename/download`、`/api/snapshots/:filename` | 下載或刪除指定備份快照。 |
| `GET` | `/api/fs/browse` | 本機目錄瀏覽器（支援回傳 Windows 各磁碟機代號 `C:\`、`D:\` 等清單）。 |
| `POST` | `/api/fs/open-in-os` | 於作業系統檔案總管 / Finder 安全開啟指定資料夾（強制檢查 `isDirectory()`，絕不直接執行檔案）。 |

## 5. 資安與跨平台設計規範 (Security & Cross-Platform Standards)

1. **檔案所有權保護機制 (`.skills-manager-owned.json`)**
   - 當以 Copy 模式部署 Skill 或部署 Subagent 檔案時，系統會計算內容之 SHA-256 雜湊並寫入所有權標記檔。
   - 若目標路徑已存在同名但無標記檔之個人檔案，或檔案內容已被使用者於外部手動修改導致雜湊不符，系統將拋出明確錯誤並拒絕覆蓋或刪除，確保零資料遺失。
2. **敏感資料與權限鎖定**
   - `db.json`、`.env` 與寫出之 MCP 設定檔均設定為 `0o600` 權限。
   - 前端介面針對名稱含 `TOKEN`、`KEY`、`SECRET`、`PASSWORD`、`PAT` 之環境變數自動執行遮罩渲染。
3. **跨平台相容性保障**
   - **Windows (`win32`)**：Skills 預設使用不需系統管理員權限的 Directory Junction；System Tray 自動使用 32-bit BMP `.ico` 圖示、自動移除 `Zone.Identifier` ADS 串流並啟用 `copyDir: true`；MCP 自動將 `npx`/`npm`/`pnpm`/`yarn` 正規化為 `.cmd` 並以安全跳脫參數執行。
   - **macOS (`darwin`) / Linux**：Skills 使用標準 POSIX Symlink；System Tray 自動將 `tray_*` 二進位檔設為 `0o755` 可執行權限並使用 `.png` 圖示；無桌面環境（Headless Linux 無 `DISPLAY`）自動平順退回純本機 HTTP 服務模式。
