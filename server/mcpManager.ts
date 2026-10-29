import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { ZipArchive } from 'archiver';
import type { Response } from 'express';
import {
  AgentConfig,
  ExternalMcpItem,
  McpServerRecord,
} from './types.js';
import { expandHomePath } from './agentRegistry.js';
import { LocalStore } from './store.js';

export class McpManager {
  constructor(private store: LocalStore) {}

  public getAgentMcpConfigPath(agent: AgentConfig): string {
    const raw = agent.customMcpGlobalPath?.trim() || agent.defaultMcpGlobalPath;
    return expandHomePath(raw);
  }

  /**
   * Reads the mcpServers map from an AI tool's personal MCP config file
   * (~/.copilot/mcp-config.json, ~/.claude.json, or ~/.codex/config.toml).
   */
  public readMcpServersFromAgentConfig(agent: AgentConfig): Record<
    string,
    {
      transport: 'stdio' | 'sse' | 'http';
      command: string;
      args: string[];
      env: Record<string, string>;
      url?: string;
    }
  > {
    const configPath = this.getAgentMcpConfigPath(agent);
    if (!fs.existsSync(configPath)) return {};

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      if (agent.mcpFormat === 'toml-codex' || configPath.endsWith('.toml')) {
        return this.parseCodexTomlMcpServers(content);
      } else {
        const json = JSON.parse(content);
        const servers = json?.mcpServers || json?.servers || {};
        const result: Record<string, any> = {};
        for (const [key, val] of Object.entries(servers)) {
          if (val && typeof val === 'object') {
            const v = val as any;
            result[key] = {
              transport: v.url ? (v.type === 'sse' ? 'sse' : 'http') : 'stdio',
              command: String(v.command || ''),
              args: Array.isArray(v.args) ? v.args.map(String) : [],
              env: v.env && typeof v.env === 'object' ? v.env : {},
              url: typeof v.url === 'string' ? v.url : undefined,
            };
          }
        }
        return result;
      }
    } catch {
      return {};
    }
  }

  private parseCodexTomlMcpServers(tomlContent: string): Record<
    string,
    {
      transport: 'stdio' | 'sse' | 'http';
      command: string;
      args: string[];
      env: Record<string, string>;
      url?: string;
    }
  > {
    const result: Record<string, any> = {};
    const sectionRegex = /\[mcp_servers\.([a-zA-Z0-9_-]+)\]([\s\S]*?)(?=\n\[|$)/g;
    let match: RegExpExecArray | null;
    while ((match = sectionRegex.exec(tomlContent)) !== null) {
      const serverId = match[1];
      const body = match[2];
      const cmdMatch = body.match(/command\s*=\s*"([^"]*)"/);
      const urlMatch = body.match(/url\s*=\s*"([^"]*)"/);
      const argsMatch = body.match(/args\s*=\s*\[([\s\S]*?)\]/);
      let args: string[] = [];
      if (argsMatch) {
        args = Array.from(argsMatch[1].matchAll(/"([^"]*)"/g)).map((m) => m[1]);
      }
      result[serverId] = {
        transport: urlMatch ? 'http' : 'stdio',
        command: cmdMatch ? cmdMatch[1] : '',
        args,
        env: {},
        url: urlMatch ? urlMatch[1] : undefined,
      };
    }
    return result;
  }

  /**
   * Lists all MCP servers in the central library along with live deployment status
   * in GitHub Copilot, Claude Code, and OpenAI Codex.
   */
  public listCentralMcpServers(): McpServerRecord[] {
    const db = this.store.getDb();
    const agents = this.store.getAllAgents();

    const agentMaps = new Map<string, Record<string, any>>();
    const agentConfigPaths = new Map<string, string>();
    for (const agent of agents) {
      agentMaps.set(agent.key, this.readMcpServersFromAgentConfig(agent));
      agentConfigPaths.set(agent.key, this.getAgentMcpConfigPath(agent));
    }

    const records: McpServerRecord[] = [];
    for (const srv of Object.values(db.mcpServers)) {
      const deployments: McpServerRecord['deployments'] = {};
      for (const agent of agents) {
        const installedMap = agentMaps.get(agent.key) || {};
        deployments[agent.key] = {
          agentKey: agent.key,
          deployed: Boolean(installedMap[srv.id]),
          configPath: agentConfigPaths.get(agent.key)!,
        };
      }
      records.push({
        ...srv,
        deployments,
      });
    }

    records.sort((a, b) => a.name.localeCompare(b.name));
    return records;
  }

  public upsertMcpServer(input: {
    id: string;
    name: string;
    description: string;
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    tags?: string[];
  }): McpServerRecord[] {
    const slug = input.id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) throw new Error('請輸入有效的 MCP Server ID (英數與連字號)');

    const db = this.store.getDb();
    const now = new Date().toISOString();
    const existing = db.mcpServers[slug];

    db.mcpServers[slug] = {
      id: slug,
      name: input.name?.trim() || slug,
      description: input.description?.trim() || '本機 MCP 伺服器設定',
      transport: input.transport || 'stdio',
      command: (input.command || '').trim(),
      args: Array.isArray(input.args) ? input.args : [],
      env: input.env && typeof input.env === 'object' ? input.env : {},
      url: input.url?.trim() || undefined,
      tags: Array.isArray(input.tags) ? input.tags : existing?.tags || ['mcp'],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.store.addActivityLog('mcp-sync', `已儲存 MCP 伺服器設定「${slug}」`);
    return this.listCentralMcpServers();
  }

  public deleteMcpServers(serverIds: string[]): McpServerRecord[] {
    const agents = this.store.getAllAgents();
    for (const agent of agents) {
      for (const id of serverIds) {
        this.writeMcpServerToAgentConfig(agent, id, null);
      }
    }

    const db = this.store.getDb();
    for (const id of serverIds) {
      delete db.mcpServers[id];
    }
    this.store.addActivityLog('delete', `已刪除 ${serverIds.length} 個 MCP 伺服器設定`);
    return this.listCentralMcpServers();
  }

  public batchDeployMcpServers(
    serverIds: string[],
    agentKeys: string[],
    deploy: boolean
  ): { mcpServers: McpServerRecord[]; affectedCount: number } {
    const db = this.store.getDb();
    const targetAgents = this.store
      .getAllAgents()
      .filter((a) => agentKeys.includes(a.key));

    let count = 0;
    for (const id of serverIds) {
      const srv = db.mcpServers[id];
      if (!srv) continue;
      count += 1;
      for (const agent of targetAgents) {
        this.writeMcpServerToAgentConfig(agent, id, deploy ? srv : null);
      }
    }

    this.store.addActivityLog(
      'mcp-sync',
      `${deploy ? '已同步掛載' : '已移除'} ${count} 個 MCP 伺服器至 ${targetAgents
        .map((a) => a.name)
        .join('、')}`
    );

    return {
      mcpServers: this.listCentralMcpServers(),
      affectedCount: count,
    };
  }

  private writeMcpServerToAgentConfig(
    agent: AgentConfig,
    serverId: string,
    serverPayload: {
      transport: 'stdio' | 'sse' | 'http';
      command: string;
      args: string[];
      env: Record<string, string>;
      url?: string;
    } | null
  ): void {
    const configPath = this.getAgentMcpConfigPath(agent);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    if (agent.mcpFormat === 'toml-codex' || configPath.endsWith('.toml')) {
      let toml = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '';
      // Remove this server and its nested tables without touching other settings.
      let inTargetSection = false;
      toml = toml
        .split(/\r?\n/)
        .filter((line) => {
          const header = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/);
          if (header) {
            inTargetSection =
              header[1] === `mcp_servers.${serverId}` ||
              header[1].startsWith(`mcp_servers.${serverId}.`);
          }
          return !inTargetSection;
        })
        .join('\n')
        .trimEnd();

      if (serverPayload) {
        const lines: string[] = ['', `[mcp_servers.${serverId}]`];
        if (serverPayload.transport !== 'stdio' && serverPayload.url) {
          lines.push(`url = ${JSON.stringify(serverPayload.url)}`);
        } else {
          lines.push(`command = ${JSON.stringify(serverPayload.command)}`);
          const formattedArgs = (serverPayload.args || []).map((a) => JSON.stringify(String(a))).join(', ');
          lines.push(`args = [${formattedArgs}]`);
          if (serverPayload.env && Object.keys(serverPayload.env).length > 0) {
            lines.push('', `[mcp_servers.${serverId}.env]`);
            for (const [key, value] of Object.entries(serverPayload.env)) {
              lines.push(`${JSON.stringify(key)} = ${JSON.stringify(value)}`);
            }
          }
        }
        toml = (toml ? toml + '\n' : '') + lines.join('\n') + '\n';
      } else if (toml) {
        toml += '\n';
      }
      fs.writeFileSync(configPath, toml, 'utf-8');
    } else {
      let json: Record<string, any> = {};
      if (fs.existsSync(configPath)) {
        try {
          json = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch {
          throw new Error(`MCP 設定檔不是有效 JSON，拒絕覆蓋：${configPath}`);
        }
      }
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new Error(`MCP 設定檔格式錯誤，拒絕覆蓋：${configPath}`);
      }
      if (!json.mcpServers || typeof json.mcpServers !== 'object') {
        json.mcpServers = {};
      }

      if (serverPayload) {
        if (serverPayload.transport !== 'stdio' && serverPayload.url) {
          json.mcpServers[serverId] = {
            type: serverPayload.transport,
            url: serverPayload.url,
          };
        } else {
          const entry: Record<string, any> = {
            command: serverPayload.command,
            args: serverPayload.args || [],
          };
          if (serverPayload.env && Object.keys(serverPayload.env).length > 0) {
            entry.env = serverPayload.env;
          }
          json.mcpServers[serverId] = entry;
        }
      } else {
        delete json.mcpServers[serverId];
      }

      fs.writeFileSync(configPath, JSON.stringify(json, null, 2) + '\n', 'utf-8');
    }
  }

  public scanExternalMcpServers(agentKey?: string): ExternalMcpItem[] {
    const agents = this.store.getAllAgents();
    const targetAgents = agentKey
      ? agents.filter((a) => a.key === agentKey)
      : agents.filter((a) => a.enabled);

    const db = this.store.getDb();
    const results: ExternalMcpItem[] = [];

    for (const agent of targetAgents) {
      const configPath = this.getAgentMcpConfigPath(agent);
      const map = this.readMcpServersFromAgentConfig(agent);
      for (const [serverId, cfg] of Object.entries(map)) {
        results.push({
          agentKey: agent.key,
          agentName: agent.name,
          serverId,
          transport: cfg.transport,
          command: cfg.command,
          args: cfg.args,
          env: cfg.env,
          url: cfg.url,
          configPath,
          managedByCentral: Boolean(db.mcpServers[serverId]),
        });
      }
    }

    return results;
  }

  public adoptExternalMcpServer(agentKey: string, serverId: string): McpServerRecord[] {
    const agent = this.store.getAllAgents().find((a) => a.key === agentKey);
    if (!agent) throw new Error(`找不到工具：${agentKey}`);

    const map = this.readMcpServersFromAgentConfig(agent);
    const target = map[serverId];
    if (!target) throw new Error(`在 ${agent.name} 設定檔中找不到 MCP「${serverId}」`);

    return this.upsertMcpServer({
      id: serverId,
      name: serverId,
      description: `由 ${agent.name} 個人設定檔納管匯入的 MCP 伺服器`,
      transport: target.transport,
      command: target.command,
      args: target.args,
      env: target.env,
      url: target.url,
      tags: ['adopted', agent.key],
    });
  }

  public getRawConfigFile(agentKey: string): {
    agentKey: string;
    agentName: string;
    configPath: string;
    exists: boolean;
    content: string;
  } {
    const agent = this.store.getAllAgents().find((a) => a.key === agentKey);
    if (!agent) throw new Error(`找不到工具：${agentKey}`);
    const configPath = this.getAgentMcpConfigPath(agent);
    const exists = fs.existsSync(configPath);
    const content = exists
      ? fs.readFileSync(configPath, 'utf-8')
      : agent.mcpFormat === 'toml-codex'
      ? '# OpenAI Codex MCP 設定檔 (~/.codex/config.toml)\n'
      : '{\n  "mcpServers": {}\n}\n';
    return {
      agentKey: agent.key,
      agentName: agent.name,
      configPath,
      exists,
      content,
    };
  }

  public saveRawConfigFile(agentKey: string, content: string): void {
    const agent = this.store.getAllAgents().find((a) => a.key === agentKey);
    if (!agent) throw new Error(`找不到工具：${agentKey}`);
    const configPath = this.getAgentMcpConfigPath(agent);
    if (agent.mcpFormat !== 'toml-codex' && !configPath.endsWith('.toml')) {
      try {
        JSON.parse(content);
      } catch (e: any) {
        throw new Error(`JSON 格式驗證失敗：${e.message}`, { cause: e });
      }
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, content, 'utf-8');
    this.store.addActivityLog('mcp-sync', `已直接更新 ${agent.name} 的 MCP 設定檔 (${configPath})`);
  }

  public importMcpFromBuffer(
    buffer: Buffer,
    filename: string
  ): { count: number; mcpServers: McpServerRecord[] } {
    let importedCount = 0;

    const parseJsonObj = (obj: any) => {
      const map = obj?.mcpServers || obj?.servers || obj;
      if (!map || typeof map !== 'object') return;
      for (const [id, raw] of Object.entries(map)) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as any;
        if (!r.command && !r.url) continue;
        this.upsertMcpServer({
          id,
          name: r.name || id,
          description: r.description || `由 ${filename} 匯入的 MCP 伺服器`,
          transport: r.url ? (r.type === 'sse' ? 'sse' : 'http') : 'stdio',
          command: r.command || '',
          args: Array.isArray(r.args) ? r.args.map(String) : [],
          env: r.env && typeof r.env === 'object' ? r.env : {},
          url: r.url,
          tags: Array.isArray(r.tags) ? r.tags : ['imported'],
        });
        importedCount += 1;
      }
    };

    if (filename.toLowerCase().endsWith('.zip')) {
      const zip = new AdmZip(buffer);
      for (const entry of zip.getEntries()) {
        if (!entry.isDirectory && entry.entryName.endsWith('.json')) {
          try {
            parseJsonObj(JSON.parse(entry.getData().toString('utf-8')));
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } else {
      parseJsonObj(JSON.parse(buffer.toString('utf-8')));
    }

    if (importedCount === 0) {
      throw new Error('檔案中未找到有效的 mcpServers 設定結構');
    }

    return { count: importedCount, mcpServers: this.listCentralMcpServers() };
  }

  public async streamMcpAsZip(
    serverIds: string[],
    zipFilename: string,
    res: Response
  ): Promise<void> {
    const all = this.listCentralMcpServers();
    const targets = serverIds.length > 0 ? all.filter((m) => serverIds.includes(m.id)) : all;
    if (targets.length === 0) {
      throw new Error('沒有可匯出的 MCP 伺服器設定');
    }

    const mcpServersObj: Record<string, any> = {};
    for (const srv of targets) {
      mcpServersObj[srv.id] =
        srv.transport !== 'stdio' && srv.url
          ? { type: srv.transport, url: srv.url, description: srv.description }
          : {
              command: srv.command,
              args: srv.args,
              env: srv.env,
              description: srv.description,
            };
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(zipFilename)}"`
    );

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.pipe(res);
    archive.append(JSON.stringify({ mcpServers: mcpServersObj }, null, 2), {
      name: 'mcp-config.json',
    });
    await archive.finalize();
  }
}
