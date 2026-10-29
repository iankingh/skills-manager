import {
  AgentConfig,
  AppSettings,
  BackupSnapshot,
  DirectoryBrowseResponse,
  ExternalAgentSkill,
  OverviewResponse,
  Preset,
  SkillRecord,
  SubagentRecord,
  ExternalSubagentItem,
  McpServerRecord,
  ExternalMcpItem,
} from './types';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options?.headers || {}),
      },
    });
  } catch (networkErr: any) {
    if (networkErr?.name === 'AbortError') throw networkErr;
    throw new Error(
      `無法連線至本機 Node.js 服務 (127.0.0.1:3847)。請確認後端服務是否正在執行中。(${networkErr?.message || 'Network Error'})`
    );
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error(`本機服務回應格式異常 (HTTP ${res.status})`);
  }

  if (!res.ok || data.ok === false) {
    throw new Error(data.message || `本機服務執行失敗 (HTTP ${res.status})`);
  }
  return data as T;
}

async function downloadZipFromEndpoint(
  url: string,
  fallbackFilename: string,
  options?: RequestInit
): Promise<{ filename: string; sizeBytes: number }> {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (networkErr: any) {
    throw new Error(
      `下載 ZIP 失敗：無法連線至本機 Node.js 服務 (${networkErr?.message || 'Network Error'})`
    );
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ message: `下載失敗 (HTTP ${res.status})` }));
    throw new Error(errData.message || `匯出 ZIP 壓縮檔失敗 (HTTP ${res.status})`);
  }

  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objUrl;
  link.download = fallbackFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objUrl);

  return { filename: fallbackFilename, sizeBytes: blob.size };
}

export const api = {
  getOverview: (signal?: AbortSignal) =>
    requestJson<OverviewResponse>('/api/overview', { signal }),

  getSkillDetail: (id: string, signal?: AbortSignal) =>
    requestJson<{
      ok: boolean;
      skill: SkillRecord;
      markdownContent: string;
      files: { relativePath: string; sizeBytes: number }[];
    }>(`/api/skills/${encodeURIComponent(id)}`, { signal }),

  createManualSkill: (payload: {
    dirName: string;
    name: string;
    description: string;
    tags: string[];
    markdownBody?: string;
  }) =>
    requestJson<{ ok: boolean; skill: SkillRecord }>('/api/skills/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSkill: (
    id: string,
    payload: { tags?: string[]; skillMarkdownContent?: string }
  ) =>
    requestJson<{ ok: boolean; skill: SkillRecord }>(
      `/api/skills/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  deleteSkills: (skillIds: string[]) =>
    requestJson<{ ok: boolean; skills: SkillRecord[] }>('/api/skills/delete', {
      method: 'POST',
      body: JSON.stringify({ skillIds }),
    }),

  deploySkill: (skillId: string, agentKey: string, deploy: boolean) =>
    requestJson<{ ok: boolean; skill: SkillRecord }>(
      `/api/skills/${encodeURIComponent(skillId)}/deploy`,
      {
        method: 'POST',
        body: JSON.stringify({ agentKey, deploy }),
      }
    ),

  batchDeploy: (
    skillIds: string[],
    agentKeys: string[],
    deploy: boolean,
    autoEnableAgents = true
  ) =>
    requestJson<{
      ok: boolean;
      skills: SkillRecord[];
      agents?: AgentConfig[];
      affectedSkills: number;
      affectedAgents: number;
    }>('/api/skills/batch-deploy', {
      method: 'POST',
      body: JSON.stringify({ skillIds, agentKeys, deploy, autoEnableAgents }),
    }),

  importZipFiles: (files: FileList | File[]) => {
    const form = new FormData();
    Array.from(files).forEach((file) => form.append('files', file));
    return requestJson<{ ok: boolean; importedCount: number; skills: SkillRecord[] }>(
      '/api/skills/import-zip',
      {
        method: 'POST',
        body: form,
      }
    );
  },

  importFolderUpload: (files: FileList | File[], folderName?: string) => {
    const form = new FormData();
    const relPaths: string[] = [];
    Array.from(files).forEach((file) => {
      form.append('files', file);
      const rel = (file as any).webkitRelativePath || file.name;
      relPaths.push(rel);
    });
    form.append('relativePaths', JSON.stringify(relPaths));
    if (folderName) form.append('folderName', folderName);

    return requestJson<{ ok: boolean; importedCount: number; skills: SkillRecord[] }>(
      '/api/skills/import-folder-upload',
      {
        method: 'POST',
        body: form,
      }
    );
  },

  importLocalPath: (folderPath: string) =>
    requestJson<{ ok: boolean; importedCount: number; skills: SkillRecord[] }>(
      '/api/skills/import-local-path',
      {
        method: 'POST',
        body: JSON.stringify({ folderPath }),
      }
    ),

  downloadSingleSkillZip: (skillId: string) =>
    downloadZipFromEndpoint(
      `/api/skills/${encodeURIComponent(skillId)}/download-zip`,
      `${skillId}.zip`
    ),

  exportSkillsZipBundle: (skillIds: string[], filename?: string) => {
    const targetName =
      filename || `skills-export-${new Date().toISOString().slice(0, 10)}.zip`;
    return downloadZipFromEndpoint('/api/skills/export-zip', targetName, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillIds, filename: targetName }),
    });
  },

  downloadSnapshotZip: (filename: string) =>
    downloadZipFromEndpoint(
      `/api/snapshots/${encodeURIComponent(filename)}/download`,
      filename
    ),

  scanAgentWorkspace: (agentKey?: string, signal?: AbortSignal) =>
    requestJson<{ ok: boolean; items: ExternalAgentSkill[] }>(
      `/api/agents/workspace${agentKey ? `?agentKey=${encodeURIComponent(agentKey)}` : ''}`,
      { signal }
    ),

  adoptExternalSkill: (agentKey: string, dirName: string) =>
    requestJson<{
      ok: boolean;
      skill: SkillRecord;
      skills: SkillRecord[];
      workspaceItems: ExternalAgentSkill[];
    }>('/api/agents/adopt', {
      method: 'POST',
      body: JSON.stringify({ agentKey, dirName }),
    }),

  updateAgent: (
    key: string,
    payload: { enabled?: boolean; customGlobalPath?: string; name?: string }
  ) =>
    requestJson<{ ok: boolean; agents: AgentConfig[] }>(
      `/api/agents/${encodeURIComponent(key)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  addCustomAgent: (payload: {
    name: string;
    globalPath: string;
    projectPath?: string;
    color?: string;
  }) =>
    requestJson<{ ok: boolean; agents: AgentConfig[] }>('/api/agents/custom', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getExternalAgentSkillDetail: (
    agentKey: string,
    dirName: string,
    signal?: AbortSignal
  ) =>
    requestJson<{
      ok: boolean;
      item: ExternalAgentSkill;
      markdownContent: string;
      files: { relativePath: string; sizeBytes: number }[];
    }>(
      `/api/agents/workspace/${encodeURIComponent(agentKey)}/${encodeURIComponent(dirName)}`,
      { signal }
    ),

  updateExternalAgentSkillContent: (
    agentKey: string,
    dirName: string,
    markdownContent: string
  ) =>
    requestJson<{
      ok: boolean;
      item: ExternalAgentSkill;
      markdownContent: string;
    }>(
      `/api/agents/workspace/${encodeURIComponent(agentKey)}/${encodeURIComponent(dirName)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ markdownContent }),
      }
    ),

  removeCustomAgent: (key: string) =>
    requestJson<{ ok: boolean; agents: AgentConfig[] }>(
      `/api/agents/custom/${encodeURIComponent(key)}`,
      {
        method: 'DELETE',
      }
    ),

  createPreset: (payload: { name: string; description: string; skillIds: string[] }) =>
    requestJson<{ ok: boolean; presets: Preset[] }>('/api/presets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updatePreset: (
    id: string,
    payload: { name?: string; description?: string; skillIds?: string[] }
  ) =>
    requestJson<{ ok: boolean; presets: Preset[] }>(`/api/presets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deletePreset: (id: string) =>
    requestJson<{ ok: boolean; presets: Preset[] }>(`/api/presets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  applyPreset: (id: string, deploy: boolean) =>
    requestJson<{ ok: boolean; presets: Preset[]; skills: SkillRecord[] }>(
      `/api/presets/${encodeURIComponent(id)}/apply`,
      {
        method: 'POST',
        body: JSON.stringify({ deploy }),
      }
    ),

  createSnapshot: (note: string) =>
    requestJson<{ ok: boolean; snapshot: BackupSnapshot; snapshots: BackupSnapshot[] }>(
      '/api/snapshots',
      {
        method: 'POST',
        body: JSON.stringify({ note }),
      }
    ),

  restoreSnapshot: (filename: string) =>
    requestJson<{
      ok: boolean;
      restoredCount: number;
      skills: SkillRecord[];
      snapshots: BackupSnapshot[];
    }>(`/api/snapshots/${encodeURIComponent(filename)}/restore`, {
      method: 'POST',
    }),

  deleteSnapshot: (filename: string) =>
    requestJson<{ ok: boolean; snapshots: BackupSnapshot[] }>(
      `/api/snapshots/${encodeURIComponent(filename)}`,
      {
        method: 'DELETE',
      }
    ),

  updateSettings: (payload: Partial<AppSettings>) =>
    requestJson<{
      ok: boolean;
      settings: AppSettings;
      trayStatus: { active: boolean; enabledInSettings: boolean };
    }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  browseDirectory: (dir?: string) =>
    requestJson<DirectoryBrowseResponse>(
      `/api/fs/browse${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`
    ),

  openInOSFileManager: (targetPath?: string) =>
    requestJson<{ ok: boolean; opened: string }>('/api/fs/open-in-os', {
      method: 'POST',
      body: JSON.stringify({ path: targetPath }),
    }),

  // ==================== AI Agents (Subagents) ====================
  listSubagents: () =>
    requestJson<{
      ok: boolean;
      subagents: SubagentRecord[];
      externalSubagents: ExternalSubagentItem[];
    }>('/api/subagents'),

  getSubagentDetail: (id: string, signal?: AbortSignal) =>
    requestJson<{
      ok: boolean;
      subagent: SubagentRecord;
      markdownContent: string;
    }>(`/api/subagents/${encodeURIComponent(id)}`, { signal }),

  createSubagent: (payload: {
    id: string;
    name: string;
    description: string;
    tools?: string[];
    tags?: string[];
    markdownBody?: string;
  }) =>
    requestJson<{
      ok: boolean;
      subagent: SubagentRecord;
      subagents: SubagentRecord[];
    }>('/api/subagents/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSubagent: (
    id: string,
    payload: { markdownContent?: string; tags?: string[] }
  ) =>
    requestJson<{
      ok: boolean;
      subagent: SubagentRecord;
      subagents: SubagentRecord[];
    }>(`/api/subagents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteSubagents: (ids: string[]) =>
    requestJson<{ ok: boolean; subagents: SubagentRecord[] }>(
      '/api/subagents/delete',
      {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }
    ),

  batchDeploySubagents: (
    subagentIds: string[],
    agentKeys: string[],
    deploy: boolean
  ) =>
    requestJson<{
      ok: boolean;
      subagents: SubagentRecord[];
      affectedCount: number;
    }>('/api/subagents/batch-deploy', {
      method: 'POST',
      body: JSON.stringify({ subagentIds, agentKeys, deploy }),
    }),

  getExternalSubagentContent: (
    agentKey: string,
    fileName: string,
    signal?: AbortSignal
  ) =>
    requestJson<{
      ok: boolean;
      item: ExternalSubagentItem;
      markdownContent: string;
    }>(
      `/api/subagents/workspace/${encodeURIComponent(agentKey)}/${encodeURIComponent(fileName)}`,
      { signal }
    ),

  updateExternalSubagentContent: (
    agentKey: string,
    fileName: string,
    markdownContent: string
  ) =>
    requestJson<{
      ok: boolean;
      item: ExternalSubagentItem;
      markdownContent: string;
      subagents: SubagentRecord[];
    }>(
      `/api/subagents/workspace/${encodeURIComponent(agentKey)}/${encodeURIComponent(fileName)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ markdownContent }),
      }
    ),

  adoptExternalSubagent: (agentKey: string, fileName: string) =>
    requestJson<{
      ok: boolean;
      subagents: SubagentRecord[];
      externalSubagents: ExternalSubagentItem[];
    }>('/api/subagents/adopt', {
      method: 'POST',
      body: JSON.stringify({ agentKey, fileName }),
    }),

  importSubagentsZip: (files: FileList | File[]) => {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    return requestJson<{
      ok: boolean;
      importedCount: number;
      subagents: SubagentRecord[];
    }>('/api/subagents/import-zip', {
      method: 'POST',
      body: form,
    });
  },

  importSubagentsLocalPath: (localPath: string) =>
    requestJson<{
      ok: boolean;
      importedCount: number;
      subagents: SubagentRecord[];
    }>('/api/subagents/import-local-path', {
      method: 'POST',
      body: JSON.stringify({ localPath }),
    }),

  exportSubagentsZip: (ids: string[], filename?: string) => {
    const targetName =
      filename || `ai-agents-export-${new Date().toISOString().slice(0, 10)}.zip`;
    return downloadZipFromEndpoint('/api/subagents/export-zip', targetName, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, filename: targetName }),
    });
  },

  // ==================== MCP (Model Context Protocol) ====================
  listMcp: (agentKey?: string) =>
    requestJson<{
      ok: boolean;
      mcpServers: McpServerRecord[];
      externalMcp: ExternalMcpItem[];
    }>(`/api/mcp${agentKey ? `?agentKey=${encodeURIComponent(agentKey)}` : ''}`),

  upsertMcpServer: (payload: {
    id: string;
    name: string;
    description: string;
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    tags?: string[];
  }) =>
    requestJson<{ ok: boolean; mcpServers: McpServerRecord[] }>(
      '/api/mcp/upsert',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  deleteMcpServers: (ids: string[]) =>
    requestJson<{ ok: boolean; mcpServers: McpServerRecord[] }>(
      '/api/mcp/delete',
      {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }
    ),

  batchDeployMcp: (
    serverIds: string[],
    agentKeys: string[],
    deploy: boolean
  ) =>
    requestJson<{
      ok: boolean;
      mcpServers: McpServerRecord[];
      externalMcp: ExternalMcpItem[];
      affectedCount: number;
    }>('/api/mcp/batch-deploy', {
      method: 'POST',
      body: JSON.stringify({ serverIds, agentKeys, deploy }),
    }),

  adoptExternalMcp: (agentKey: string, serverId: string) =>
    requestJson<{
      ok: boolean;
      mcpServers: McpServerRecord[];
      externalMcp: ExternalMcpItem[];
    }>('/api/mcp/adopt', {
      method: 'POST',
      body: JSON.stringify({ agentKey, serverId }),
    }),

  getRawMcpConfig: (agentKey: string) =>
    requestJson<{
      ok: boolean;
      agentKey: string;
      agentName: string;
      configPath: string;
      exists: boolean;
      content: string;
    }>(`/api/mcp/raw-config/${encodeURIComponent(agentKey)}`),

  saveRawMcpConfig: (agentKey: string, content: string) =>
    requestJson<{
      ok: boolean;
      mcpServers: McpServerRecord[];
      externalMcp: ExternalMcpItem[];
    }>(`/api/mcp/raw-config/${encodeURIComponent(agentKey)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  importMcpFiles: (files: FileList | File[]) => {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    return requestJson<{
      ok: boolean;
      importedCount: number;
      mcpServers: McpServerRecord[];
    }>('/api/mcp/import', {
      method: 'POST',
      body: form,
    });
  },

  exportMcpZip: (ids: string[], filename?: string) => {
    const targetName =
      filename || `mcp-servers-export-${new Date().toISOString().slice(0, 10)}.zip`;
    return downloadZipFromEndpoint('/api/mcp/export-zip', targetName, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, filename: targetName }),
    });
  },
};
