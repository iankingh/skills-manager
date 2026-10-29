import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import YAML from 'yaml';
import {
  AgentConfig,
  AppSettings,
  DatabaseSchema,
  ActivityLogEntry,
  Preset,
} from './types.js';
import { BUILTIN_AGENTS, expandHomePath } from './agentRegistry.js';

const DEFAULT_BASE_DIR = path.join(os.homedir(), '.skills-manager');
const BOOTSTRAP_CONFIG_PATH = path.join(DEFAULT_BASE_DIR, 'repo-config.json');

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.DS_Store',
]);

const IGNORED_EXTENSIONS = new Set(['.pyc', '.pyo']);

export function getConfiguredBaseDir(): string {
  try {
    if (fs.existsSync(BOOTSTRAP_CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(BOOTSTRAP_CONFIG_PATH, 'utf-8'));
      if (raw && typeof raw.centralRepoPath === 'string' && raw.centralRepoPath.trim()) {
        return expandHomePath(raw.centralRepoPath.trim());
      }
    }
  } catch {
    // Fallback to default
  }
  return DEFAULT_BASE_DIR;
}

export function saveConfiguredBaseDir(newBaseDir: string): void {
  fs.mkdirSync(DEFAULT_BASE_DIR, { recursive: true });
  fs.writeFileSync(
    BOOTSTRAP_CONFIG_PATH,
    JSON.stringify({ centralRepoPath: newBaseDir }, null, 2),
    'utf-8'
  );
}

export class LocalStore {
  private dbPath: string;
  private data: DatabaseSchema;

  constructor(baseDir = getConfiguredBaseDir()) {
    fs.mkdirSync(baseDir, { recursive: true });
    fs.mkdirSync(path.join(baseDir, 'skills'), { recursive: true });
    fs.mkdirSync(path.join(baseDir, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(baseDir, 'backups'), { recursive: true });
    this.dbPath = path.join(baseDir, 'db.json');
    this.data = this.loadOrCreateDefault(baseDir);
    this.ensureSeedSkill();
    this.ensureSeedSubagents();
    this.ensureSeedMcpServers();
  }

  private loadOrCreateDefault(baseDir: string): DatabaseSchema {
    const defaultAgents: DatabaseSchema['agents'] = {};
    for (const agent of BUILTIN_AGENTS) {
      defaultAgents[agent.key] = {
        enabled: agent.enabled,
      };
    }

    const defaultSettings: AppSettings = {
      centralRepoPath: baseDir,
      syncMode: 'symlink',
      language: 'zh-TW',
      theme: 'dark',
      textSize: 'md',
      trayEnabled: true,
      minimizeToTrayOnClose: true,
      openBrowserOnStart: false,
      port: 3847,
      agentOrder: BUILTIN_AGENTS.map((a) => a.key),
    };

    const defaultPresets: Preset[] = [
      {
        id: 'preset-default',
        name: '日常全棧開發 (Default)',
        description: '預設啟用的核心 AI 輔助開發技能組合',
        icon: 'Layers',
        skillIds: ['code-review-pro', 'offline-architecture-guide'],
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const fallback: DatabaseSchema = {
      version: 3,
      settings: defaultSettings,
      agents: defaultAgents,
      skills: {},
      subagents: {},
      mcpServers: {},
      presets: defaultPresets,
      activityLogs: [],
    };

    if (!fs.existsSync(this.dbPath)) {
      this.saveRaw(fallback);
      return fallback;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.dbPath, 'utf-8')) as Partial<DatabaseSchema>;
      const builtinKeys = new Set(BUILTIN_AGENTS.map((a) => a.key));
      const cleanedAgents: DatabaseSchema['agents'] = { ...defaultAgents };

      if (parsed.agents) {
        for (const [k, v] of Object.entries(parsed.agents)) {
          if (builtinKeys.has(k) || v?.isCustom) {
            if (k === 'codex' && v?.customGlobalPath && v.customGlobalPath.includes('.codex/skills')) {
              delete v.customGlobalPath;
            }
            cleanedAgents[k] = v;
          }
        }
      }

      const validOrder = (parsed.settings?.agentOrder || []).filter(
        (k) => builtinKeys.has(k) || cleanedAgents[k]?.isCustom
      );
      for (const bKey of builtinKeys) {
        if (!validOrder.includes(bKey)) validOrder.push(bKey);
      }

      const merged: DatabaseSchema = {
        version: 3,
        settings: {
          ...defaultSettings,
          ...(parsed.settings || {}),
          centralRepoPath: baseDir,
          agentOrder: validOrder,
        },
        agents: cleanedAgents,
        skills: parsed.skills || {},
        subagents: parsed.subagents || {},
        mcpServers: parsed.mcpServers || {},
        presets: Array.isArray(parsed.presets) && parsed.presets.length > 0 ? parsed.presets : defaultPresets,
        activityLogs: Array.isArray(parsed.activityLogs) ? parsed.activityLogs : [],
      };
      this.saveRaw(merged);
      return merged;
    } catch (error) {
      throw new Error(`無法讀取中央資料庫，請先檢查或還原檔案：${this.dbPath}`, { cause: error });
    }
  }

  private ensureSeedSkill(): void {
    const skillsDir = this.getSkillsDir();
    const entries = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir) : [];
    if (entries.length > 0) return;

    const sample1Dir = path.join(skillsDir, 'code-review-pro');
    fs.mkdirSync(sample1Dir, { recursive: true });
    fs.writeFileSync(
      path.join(sample1Dir, 'SKILL.md'),
      `---
name: code-review-pro
description: 離線專業程式碼審查與重構建議規範，檢查型別安全、邊界條件、效能瓶頸與安全性漏洞。
---
# Code Review Pro (本機離線規範)

當執行程式碼審查 (Code Review) 時，請依序檢查以下核心面向：

1. **邊界條件與錯誤處理**：確認空值 (null/undefined)、空陣列、非預期輸入皆有防禦性處理。
2. **安全性檢查**：禁止路徑穿越 (Path Traversal)、SQL/指令注入與硬編碼密鑰。
3. **可讀性與模組化**：函式職責單一，命名清晰，並維持一致的型別定義。
`,
      'utf-8'
    );

    const sample2Dir = path.join(skillsDir, 'offline-architecture-guide');
    fs.mkdirSync(sample2Dir, { recursive: true });
    fs.writeFileSync(
      path.join(sample2Dir, 'SKILL.md'),
      `---
name: offline-architecture-guide
description: 100% 離線優先 (Offline-First) 系統架構設計指南，確保零外網依賴、本機資料持久化與隱私安全。
---
# Offline-First Architecture Guide

本技能提供離線優先應用程式的設計準則：

- **零外部網路請求**：所有靜態資源、圖示、字型與樣式均打包於本機。
- **本機資料主權**：設定檔與技能庫儲存於使用者個人目錄 (\`~/.skills-manager\`)，支援隨時匯出與匯入標準 ZIP 壓縮檔。
- **跨工具無縫同步**：透過 Symlink / Junction 或實體複製將技能部署至 GitHub Copilot、Claude Code、OpenAI Codex 等工具的個人資料夾。
`,
      'utf-8'
    );

    const now = new Date().toISOString();
    this.data.skills['code-review-pro'] = {
      id: 'code-review-pro',
      name: 'code-review-pro',
      description: '離線專業程式碼審查與重構建議規範，檢查型別安全、邊界條件、效能瓶頸與安全性漏洞。',
      sourceType: 'manual',
      sourceLabel: '內建範例技能',
      tags: ['review', 'quality', 'security'],
      createdAt: now,
      updatedAt: now,
    };
    this.data.skills['offline-architecture-guide'] = {
      id: 'offline-architecture-guide',
      name: 'offline-architecture-guide',
      description: '100% 離線優先 (Offline-First) 系統架構設計指南，確保零外網依賴、本機資料持久化與隱私安全。',
      sourceType: 'manual',
      sourceLabel: '內建範例技能',
      tags: ['architecture', 'offline'],
      createdAt: now,
      updatedAt: now,
    };
    this.save();
  }

  private ensureSeedSubagents(): void {
    const agentsDir = this.getSubagentsDir();
    const entries = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir) : [];
    if (entries.length > 0) return;

    const now = new Date().toISOString();
    const agent1Md = `---
name: security-auditor
description: 專責資安稽核與弱點掃描的 AI Subagent，自動檢視認證流程、輸入驗證、相依套件與檔案存取權限。
tools: ["Read", "Grep", "Glob", "Bash"]
---
# Security Auditor Agent (資安稽核專家代理)

你是一位專注於應用程式安全的資深資安架構師 Agent。當被委派任務時：
1. 優先檢視所有外部輸入端點、檔案上傳與路徑拼接邏輯。
2. 檢查是否存在 Path Traversal、Command Injection、XSS 或未授權存取風險。
3. 輸出結構化的「風險等級 / 問題位置 / 修復建議程式碼」報告。
`;
    fs.writeFileSync(path.join(agentsDir, 'security-auditor.md'), agent1Md, 'utf-8');

    const agent2Md = `---
name: system-architect
description: 專責系統架構規劃、模組拆分與效能調校的 AI Subagent，負責在動工前產出清晰的技術設計藍圖。
tools: ["Read", "Grep", "Glob"]
---
# System Architect Agent (系統架構師代理)

你是一位負責大型系統重構與架構設計的專家 Agent：
1. 分析現有專案的資料流、模組耦合度與時間複雜度瓶頸。
2. 提出最小變動且高擴充性的介面設計與型別定義。
`;
    fs.writeFileSync(path.join(agentsDir, 'system-architect.md'), agent2Md, 'utf-8');

    this.data.subagents['security-auditor'] = {
      id: 'security-auditor',
      name: 'security-auditor',
      description: '專責資安稽核與弱點掃描的 AI Subagent，自動檢視認證流程、輸入驗證、相依套件與檔案存取權限。',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      fileName: 'security-auditor.md',
      sourceType: 'manual',
      sourceLabel: '內建範例 AI Agent',
      tags: ['security', 'audit', 'subagent'],
      createdAt: now,
      updatedAt: now,
    };
    this.data.subagents['system-architect'] = {
      id: 'system-architect',
      name: 'system-architect',
      description: '專責系統架構規劃、模組拆分與效能調校的 AI Subagent，負責在動工前產出清晰的技術設計藍圖。',
      tools: ['Read', 'Grep', 'Glob'],
      fileName: 'system-architect.md',
      sourceType: 'manual',
      sourceLabel: '內建範例 AI Agent',
      tags: ['architecture', 'planning', 'subagent'],
      createdAt: now,
      updatedAt: now,
    };
    this.save();
  }

  private ensureSeedMcpServers(): void {
    if (Object.keys(this.data.mcpServers).length > 0) return;
    const now = new Date().toISOString();
    this.data.mcpServers['filesystem-local'] = {
      id: 'filesystem-local',
      name: '本機檔案系統 MCP (Filesystem)',
      description: '提供本機指定工作目錄的安全檔案讀寫與搜尋能力 (Stdio 本機程序)',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', os.homedir()],
      env: {},
      tags: ['filesystem', 'local', 'stdio'],
      createdAt: now,
      updatedAt: now,
    };
    this.data.mcpServers['sqlite-local'] = {
      id: 'sqlite-local',
      name: '本機 SQLite 資料庫 MCP',
      description: '提供本機 SQLite 資料庫結構查詢與離線資料分析能力',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', path.join(os.homedir(), 'local.db')],
      env: {},
      tags: ['database', 'sqlite', 'stdio'],
      createdAt: now,
      updatedAt: now,
    };
    this.save();
  }

  private saveRaw(schema: DatabaseSchema): void {
    const tmpPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(schema, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.dbPath);
  }

  public save(): void {
    this.saveRaw(this.data);
  }

  public getBaseDir(): string {
    return this.data.settings.centralRepoPath;
  }

  public getSkillsDir(): string {
    return path.join(this.getBaseDir(), 'skills');
  }

  public getSubagentsDir(): string {
    return path.join(this.getBaseDir(), 'agents');
  }

  public getBackupsDir(): string {
    return path.join(this.getBaseDir(), 'backups');
  }

  public getDb(): DatabaseSchema {
    return this.data;
  }

  public getSettings(): AppSettings {
    return this.data.settings;
  }

  public updateSettings(partial: Partial<AppSettings>): AppSettings {
    if (partial.centralRepoPath && partial.centralRepoPath.trim()) {
      const resolved = expandHomePath(partial.centralRepoPath.trim());
      if (resolved !== this.data.settings.centralRepoPath) {
        this.migrateCentralRepo(resolved);
      }
      partial.centralRepoPath = resolved;
    }
    this.data.settings = { ...this.data.settings, ...partial };
    this.save();
    return this.data.settings;
  }

  private migrateCentralRepo(newBaseDir: string): void {
    const oldBaseDir = this.data.settings.centralRepoPath;
    if (path.resolve(oldBaseDir) === path.resolve(newBaseDir)) return;
    if (path.resolve(newBaseDir).startsWith(path.resolve(oldBaseDir) + path.sep)) {
      throw new Error('新的儲存庫路徑不可位於目前的儲存庫資料夾內部');
    }
    for (const sub of ['skills', 'agents', 'backups']) {
      fs.mkdirSync(path.join(newBaseDir, sub), { recursive: true });
      const oldSub = path.join(oldBaseDir, sub);
      const newSub = path.join(newBaseDir, sub);
      if (fs.existsSync(oldSub)) {
        for (const entry of fs.readdirSync(oldSub)) {
          const src = path.join(oldSub, entry);
          const dest = path.join(newSub, entry);
          if (!fs.existsSync(dest)) {
            fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
          }
        }
      }
    }

    saveConfiguredBaseDir(newBaseDir);
    this.dbPath = path.join(newBaseDir, 'db.json');
    this.data.settings.centralRepoPath = newBaseDir;
    this.save();
  }

  public getAllAgents(): AgentConfig[] {
    const result: AgentConfig[] = [];
    const seen = new Set<string>();

    for (const builtin of BUILTIN_AGENTS) {
      const override = this.data.agents[builtin.key];
      result.push({
        ...builtin,
        enabled: override ? override.enabled : builtin.enabled,
        customGlobalPath: override?.customGlobalPath,
        customAgentGlobalPath: override?.customAgentGlobalPath,
        customMcpGlobalPath: override?.customMcpGlobalPath,
      });
      seen.add(builtin.key);
    }

    for (const [key, cfg] of Object.entries(this.data.agents)) {
      if (!seen.has(key) && cfg.isCustom && cfg.defaultGlobalPath) {
        result.push({
          key,
          name: cfg.name || key,
          category: 'custom',
          defaultGlobalPath: cfg.defaultGlobalPath,
          globalPaths: cfg.globalPaths || [cfg.customGlobalPath || cfg.defaultGlobalPath],
          projectPaths: cfg.projectPaths || ['.agents/skills/'],
          customGlobalPath: cfg.customGlobalPath,
          defaultAgentGlobalPath: cfg.defaultAgentGlobalPath || cfg.defaultGlobalPath.replace(/skills\/?$/, 'agents'),
          agentGlobalPaths: cfg.agentGlobalPaths || [cfg.defaultAgentGlobalPath || '~/.agents/agents/'],
          agentProjectPaths: cfg.agentProjectPaths || ['.agents/agents/'],
          customAgentGlobalPath: cfg.customAgentGlobalPath,
          defaultMcpGlobalPath: cfg.defaultMcpGlobalPath || '~/.mcp.json',
          mcpGlobalPaths: cfg.mcpGlobalPaths || [cfg.defaultMcpGlobalPath || '~/.mcp.json'],
          mcpProjectPaths: cfg.mcpProjectPaths || ['.mcp.json'],
          customMcpGlobalPath: cfg.customMcpGlobalPath,
          mcpFormat: cfg.mcpFormat || 'json-mcpServers',
          enabled: cfg.enabled,
          icon: cfg.icon || 'FolderCog',
          color: cfg.color || '#14B8A6',
          isCustom: true,
        });
      }
    }

    const orderMap = new Map<string, number>();
    this.data.settings.agentOrder.forEach((k, idx) => orderMap.set(k, idx));
    result.sort((a, b) => {
      const ia = orderMap.has(a.key) ? orderMap.get(a.key)! : 999;
      const ib = orderMap.has(b.key) ? orderMap.get(b.key)! : 999;
      return ia - ib;
    });

    return result;
  }

  public updateAgent(
    key: string,
    updates: {
      enabled?: boolean;
      customGlobalPath?: string;
      customAgentGlobalPath?: string;
      customMcpGlobalPath?: string;
      name?: string;
    }
  ): AgentConfig[] {
    const existing = this.data.agents[key] || { enabled: false };
    this.data.agents[key] = {
      ...existing,
      ...updates,
    };
    this.save();
    return this.getAllAgents();
  }

  public addCustomAgent(input: {
    name: string;
    globalPath: string;
    projectPath?: string;
    agentGlobalPath?: string;
    mcpGlobalPath?: string;
    color?: string;
  }): AgentConfig[] {
    if (!input.name?.trim() || !input.globalPath?.trim()) {
      throw new Error('請填寫工具名稱與個人／全域層級路徑');
    }
    const baseSlug = input.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || `agent_${Date.now()}`;
    let key = BUILTIN_AGENTS.some((b) => b.key === baseSlug) ? `custom_${baseSlug}` : baseSlug;
    if (this.data.agents[key]) {
      key = `${key}_${Date.now().toString(36).slice(-4)}`;
    }

    const globalPaths = input.globalPath
      .split(/[、,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const primaryGlobal = globalPaths[0] || input.globalPath.trim();

    const projectPaths = input.projectPath
      ? input.projectPath
          .split(/[、,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : ['.agents/skills/'];

    const defaultAgentPath =
      input.agentGlobalPath?.trim() ||
      primaryGlobal.replace(/skills\/?$/, 'agents');
    const defaultMcpPath =
      input.mcpGlobalPath?.trim() ||
      primaryGlobal.replace(/skills\/?$/, 'mcp-config.json');

    this.data.agents[key] = {
      enabled: true,
      isCustom: true,
      name: input.name.trim(),
      defaultGlobalPath: primaryGlobal,
      globalPaths,
      projectPaths,
      defaultAgentGlobalPath: defaultAgentPath,
      agentGlobalPaths: [defaultAgentPath],
      agentProjectPaths: ['.agents/agents/'],
      defaultMcpGlobalPath: defaultMcpPath,
      mcpGlobalPaths: [defaultMcpPath],
      mcpProjectPaths: ['.mcp.json'],
      mcpFormat: defaultMcpPath.endsWith('.toml') ? 'toml-codex' : 'json-mcpServers',
      color: input.color || '#14B8A6',
      icon: 'FolderCog',
    };
    if (!this.data.settings.agentOrder.includes(key)) {
      this.data.settings.agentOrder.push(key);
    }
    this.addActivityLog('settings', `已新增自訂 AI 工具「${input.name.trim()}」`, undefined, true);
    this.save();
    return this.getAllAgents();
  }

  public removeCustomAgent(key: string): AgentConfig[] {
    if (this.data.agents[key]?.isCustom) {
      delete this.data.agents[key];
      this.data.settings.agentOrder = this.data.settings.agentOrder.filter((k) => k !== key);
      this.save();
    }
    return this.getAllAgents();
  }

  public addActivityLog(
    action: ActivityLogEntry['action'],
    summary: string,
    details?: string,
    skipSave = false
  ): void {
    const entry: ActivityLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      action,
      summary,
      details,
    };
    this.data.activityLogs.unshift(entry);
    if (this.data.activityLogs.length > 250) {
      this.data.activityLogs = this.data.activityLogs.slice(0, 250);
    }
    if (!skipSave) {
      this.save();
    }
  }
}

// ==================== High-Performance In-Memory Cache ====================
interface CachedSkillMetaAndStats {
  signature: string;
  meta: { name: string; description: string; body: string };
  stats: { contentHash: string; fileCount: number; totalBytes: number };
}

const skillDirCache = new Map<string, CachedSkillMetaAndStats>();

export function invalidateSkillCache(dirPath?: string): void {
  if (!dirPath) {
    skillDirCache.clear();
  } else {
    skillDirCache.delete(path.resolve(dirPath));
  }
}

function getQuickDirectorySignature(dirPath: string): string {
  try {
    const dirStat = fs.statSync(dirPath);
    let mdMtime = 0;
    let mdSize = 0;
    const mdPath = path.join(dirPath, 'SKILL.md');
    if (fs.existsSync(mdPath)) {
      const ms = fs.statSync(mdPath);
      mdMtime = ms.mtimeMs;
      mdSize = ms.size;
    }
    return `${dirStat.mtimeMs}:${mdMtime}:${mdSize}`;
  } catch {
    return '';
  }
}

export function parseSkillMarkdownMeta(skillDirPath: string): {
  name: string;
  description: string;
  body: string;
} {
  const abs = path.resolve(skillDirPath);
  const sig = getQuickDirectorySignature(abs);
  const cached = skillDirCache.get(abs);
  if (cached && sig && cached.signature === sig) {
    return cached.meta;
  }

  const defaultName = path.basename(skillDirPath);
  const candidates = ['SKILL.md', 'skill.md', 'README.md', 'readme.md'];

  for (const filename of candidates) {
    const filePath = path.join(skillDirPath, filename);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      if (fmMatch) {
        try {
          const parsed = YAML.parse(fmMatch[1]) as Record<string, unknown>;
          return {
            name: typeof parsed?.name === 'string' && parsed.name.trim() ? parsed.name.trim() : defaultName,
            description:
              typeof parsed?.description === 'string' && parsed.description.trim()
                ? parsed.description.trim()
                : extractFirstParagraph(fmMatch[2]),
            body: fmMatch[2],
          };
        } catch {
          // Fallback
        }
      }
      return {
        name: defaultName,
        description: extractFirstParagraph(content),
        body: content,
      };
    }
  }

  return {
    name: defaultName,
    description: '本機技能套件 (尚無 SKILL.md 描述)',
    body: '',
  };
}

function extractFirstParagraph(markdown: string): string {
  const lines = markdown
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('---'));
  if (lines.length === 0) return '本機 AI 模組';
  const first = lines[0].replace(/^[>*-]+\s*/, '');
  return first.length > 160 ? first.slice(0, 157) + '...' : first;
}

export function computeSkillDirectoryStats(dirPath: string): {
  contentHash: string;
  fileCount: number;
  totalBytes: number;
} {
  const hash = crypto.createHash('sha256');
  let fileCount = 0;
  let totalBytes = 0;

  function walk(currentDir: string, relPrefix: string) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name) || entry.name === '.skills-manager-owned.json') continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (IGNORED_EXTENSIONS.has(ext)) continue;

      const fullPath = path.join(currentDir, entry.name);
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isSymbolicLink()) {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath, relPath);
      } else if (stat.isFile()) {
        fileCount += 1;
        totalBytes += stat.size;
        hash.update(`FILE:${relPath}:${stat.size}\n`);
        hash.update(fs.readFileSync(fullPath));
      }
    }
  }

  walk(dirPath, '');
  const stats = {
    contentHash: hash.digest('hex').slice(0, 16),
    fileCount,
    totalBytes,
  };

  return stats;
}

/** Hash every entry that a recursive removal would delete, except our own marker. */
export function computeOwnedDirectoryDigest(dirPath: string): string {
  const hash = crypto.createHash('sha256');
  function walk(current: string, prefix: string): void {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!prefix && entry.name === '.skills-manager-owned.json') continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(current, entry.name);
      const stat = fs.lstatSync(fullPath);
      if (stat.isDirectory()) {
        hash.update(`DIR:${relative}\n`);
        walk(fullPath, relative);
      } else if (stat.isFile()) {
        hash.update(`FILE:${relative}:${stat.size}\n`);
        hash.update(fs.readFileSync(fullPath));
      } else if (stat.isSymbolicLink()) {
        hash.update(`LINK:${relative}:${fs.readlinkSync(fullPath)}\n`);
      } else {
        throw new Error(`無法驗證目標資料夾中的特殊檔案：${fullPath}`);
      }
    }
  }
  walk(dirPath, '');
  return hash.digest('hex');
}
