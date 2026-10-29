export type SyncMode = 'symlink' | 'copy';

export interface AgentConfig {
  key: string;
  name: string;
  category: 'mainstream' | 'extended' | 'custom';
  // 1. AI Skills
  defaultGlobalPath: string;
  globalPaths?: string[];
  projectPaths?: string[];
  customGlobalPath?: string;
  fallbackPaths?: string[];
  resolvedPath: string;
  compactPath: string;
  folderExists: boolean;
  // 2. AI Agents (Subagents)
  defaultAgentGlobalPath: string;
  agentGlobalPaths?: string[];
  agentProjectPaths?: string[];
  customAgentGlobalPath?: string;
  resolvedAgentPath: string;
  compactAgentPath: string;
  agentFolderExists: boolean;
  // 3. MCP
  defaultMcpGlobalPath: string;
  mcpGlobalPaths?: string[];
  mcpProjectPaths?: string[];
  customMcpGlobalPath?: string;
  mcpFormat: 'json-mcpServers' | 'toml-codex';
  resolvedMcpPath: string;
  compactMcpPath: string;
  mcpFileExists: boolean;

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

export interface SubagentRecord {
  id: string;
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  fileName: string;
  centralPath: string;
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

export interface McpServerRecord {
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
  action: string;
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

export interface OverviewResponse {
  ok: boolean;
  offlineMode: boolean;
  version: string;
  platform: string;
  homedir: string;
  centralRepoPath: string;
  compactCentralRepoPath: string;
  trayStatus: {
    active: boolean;
    enabledInSettings: boolean;
  };
  settings: AppSettings;
  agents: AgentConfig[];
  skills: SkillRecord[];
  subagents: SubagentRecord[];
  mcpServers: McpServerRecord[];
  presets: Preset[];
  snapshots: BackupSnapshot[];
  activityLogs: ActivityLogEntry[];
}

export interface DirectoryBrowseEntry {
  name: string;
  fullPath: string;
  compactPath: string;
  hasSkillMd: boolean;
}

export interface DirectoryBrowseResponse {
  ok: boolean;
  currentDir: string;
  compactCurrentDir: string;
  parentDir: string | null;
  directories: DirectoryBrowseEntry[];
}
