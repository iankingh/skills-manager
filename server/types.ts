export type SyncMode = 'symlink' | 'copy';

export interface AgentConfig {
  key: string;
  name: string;
  category: 'mainstream' | 'extended' | 'custom';
  // 1. AI Skills paths
  defaultGlobalPath: string;
  globalPaths?: string[];
  projectPaths?: string[];
  customGlobalPath?: string;
  fallbackPaths?: string[];
  // 2. AI Agents (Subagents) paths
  defaultAgentGlobalPath: string;
  agentGlobalPaths?: string[];
  agentProjectPaths?: string[];
  customAgentGlobalPath?: string;
  // 3. MCP Config file paths
  defaultMcpGlobalPath: string;
  mcpGlobalPaths?: string[];
  mcpProjectPaths?: string[];
  customMcpGlobalPath?: string;
  mcpFormat: 'json-mcpServers' | 'toml-codex';

  enabled: boolean;
  icon: string;
  color: string;
  isCustom?: boolean;
}

export interface SkillDeploymentState {
  agentKey: string;
  deployed: boolean;
  mode?: 'symlink' | 'junction' | 'copy' | 'external';
  targetPath: string;
  inSync: boolean;
}

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  dirName: string;
  centralPath: string;
  sourceType: 'zip' | 'local-folder' | 'adopted' | 'manual';
  sourceLabel: string;
  tags: string[];
  contentHash: string;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
  deployments: Record<string, SkillDeploymentState>;
}

export interface ExternalAgentSkill {
  agentKey: string;
  agentName: string;
  dirName: string;
  name: string;
  description: string;
  fullPath: string;
  isSymlink: boolean;
  symlinkTarget?: string;
  managedByCentral: boolean;
  centralSkillId?: string;
  inSyncWithCentral: boolean;
  fileCount: number;
  updatedAt: string;
}

// ==================== AI Agents (Subagents) ====================
export interface SubagentRecord {
  id: string;
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  fileName: string;        // e.g. security-auditor.md
  centralPath: string;     // ~/.skills-manager/agents/security-auditor.md
  sourceType: 'zip' | 'local-folder' | 'adopted' | 'manual';
  sourceLabel: string;
  tags: string[];
  contentHash: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  deployments: Record<string, {
    agentKey: string;
    deployed: boolean;
    targetPath: string;
  }>;
}

export interface ExternalSubagentItem {
  agentKey: string;
  agentName: string;
  fileName: string;
  id: string;
  name: string;
  description: string;
  fullPath: string;
  managedByCentral: boolean;
  centralSubagentId?: string;
  sizeBytes: number;
  updatedAt: string;
}

// ==================== MCP (Model Context Protocol) ====================
export interface McpServerRecord {
  id: string;              // server key in mcpServers, e.g. "filesystem-local"
  name: string;
  description: string;
  transport: 'stdio' | 'sse' | 'http';
  command: string;         // e.g. "npx" or "node" or "uvx"
  args: string[];          // e.g. ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
  env: Record<string, string>;
  url?: string;            // for sse / http local server
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deployments: Record<string, {
    agentKey: string;
    deployed: boolean;
    configPath: string;
  }>;
}

export interface ExternalMcpItem {
  agentKey: string;
  agentName: string;
  serverId: string;
  transport: 'stdio' | 'sse' | 'http';
  command: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  configPath: string;
  managedByCentral: boolean;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  icon: string;
  skillIds: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BackupSnapshot {
  id: string;
  filename: string;
  note: string;
  skillCount: number;
  sizeBytes: number;
  createdAt: string;
  filePath: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  action:
    | 'import-zip'
    | 'import-folder'
    | 'export-zip'
    | 'deploy'
    | 'undeploy'
    | 'adopt'
    | 'delete'
    | 'preset-apply'
    | 'snapshot'
    | 'settings'
    | 'agent-deploy'
    | 'mcp-sync';
  summary: string;
  details?: string;
}

export interface AppSettings {
  centralRepoPath: string;
  syncMode: SyncMode;
  language: 'zh-TW' | 'zh-CN' | 'en';
  theme: 'dark' | 'light';
  textSize: 'sm' | 'md' | 'lg';
  trayEnabled: boolean;
  minimizeToTrayOnClose: boolean;
  openBrowserOnStart: boolean;
  port: number;
  agentOrder: string[];
}

export interface DatabaseSchema {
  version: number;
  settings: AppSettings;
  agents: Record<string, {
    enabled: boolean;
    customGlobalPath?: string;
    customAgentGlobalPath?: string;
    customMcpGlobalPath?: string;
    name?: string;
    isCustom?: boolean;
    defaultGlobalPath?: string;
    defaultAgentGlobalPath?: string;
    defaultMcpGlobalPath?: string;
    mcpFormat?: 'json-mcpServers' | 'toml-codex';
    globalPaths?: string[];
    projectPaths?: string[];
    agentGlobalPaths?: string[];
    agentProjectPaths?: string[];
    mcpGlobalPaths?: string[];
    mcpProjectPaths?: string[];
    icon?: string;
    color?: string;
  }>;
  skills: Record<string, {
    id: string;
    name: string;
    description: string;
    sourceType: 'zip' | 'local-folder' | 'adopted' | 'manual';
    sourceLabel: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  subagents: Record<string, {
    id: string;
    name: string;
    description: string;
    model?: string;
    tools?: string[];
    fileName: string;
    sourceType: 'zip' | 'local-folder' | 'adopted' | 'manual';
    sourceLabel: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  mcpServers: Record<string, {
    id: string;
    name: string;
    description: string;
    transport: 'stdio' | 'sse' | 'http';
    command: string;
    args: string[];
    env: Record<string, string>;
    url?: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  presets: Preset[];
  activityLogs: ActivityLogEntry[];
}
