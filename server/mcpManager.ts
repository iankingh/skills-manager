import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
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

const WINDOWS_CMD_WRAPPERS = new Set([
  'npx',
  'npm',
  'pnpm',
  'pnpx',
  'yarn',
  'corepack',
]);

/**
 * Normalizes a stdio command on Windows so AI tools that spawn processes without a shell
 * (e.g. Claude Code, Codex, Copilot) do not fail with `spawn npx ENOENT`.
 */
export function resolvePlatformMcpCommand(command: string): string {
  const trimmed = (command || '').trim();
  if (process.platform !== 'win32') return trimmed;
  const lower = trimmed.toLowerCase();
  if (WINDOWS_CMD_WRAPPERS.has(lower)) {
    return `${trimmed}.cmd`;
  }
  return trimmed;
}

function unescapeTomlString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
  }
}

function parseTomlStringArray(inner: string): string[] {
  const results: string[] = [];
  const regex = /"((?:[^"\\]|\\.)*)"|'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(inner)) !== null) {
    if (m[1] !== undefined) {
      results.push(unescapeTomlString(m[1]));
    } else if (m[2] !== undefined) {
      results.push(m[2]);
    }
  }
  return results;
}

export interface McpConnectionTestResult {
  ok: boolean;
  serverId: string;
  transport: 'stdio' | 'sse' | 'http';
  latencyMs: number;
  serverInfo?: { name?: string; version?: string };
  toolsCount?: number;
  message: string;
}

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
    const normalized = tomlContent.replace(/\r\n/g, '\n');
    const sectionRegex = /^\[mcp_servers\.([a-zA-Z0-9_-]+)\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/gm;
    let match: RegExpExecArray | null;
    while ((match = sectionRegex.exec(normalized)) !== null) {
      const serverId = match[1];
      const body = match[2];
      const cmdMatch = body.match(/command\s*=\s*"((?:[^"\\]|\\.)*)"/);
      const urlMatch = body.match(/url\s*=\s*"((?:[^"\\]|\\.)*)"/);
      const argsMatch = body.match(/args\s*=\s*\[([\s\S]*?)\]/);
      const args = argsMatch ? parseTomlStringArray(argsMatch[1]) : [];

      result[serverId] = {
        transport: urlMatch ? 'http' : 'stdio',
        command: cmdMatch ? unescapeTomlString(cmdMatch[1]) : '',
        args,
        env: {},
        url: urlMatch ? unescapeTomlString(urlMatch[1]) : undefined,
      };
    }

    const envSectionRegex = /^\[mcp_servers\.([a-zA-Z0-9_-]+)\.env\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/gm;
    let envMatch: RegExpExecArray | null;
    while ((envMatch = envSectionRegex.exec(normalized)) !== null) {
      const serverId = envMatch[1];
      const envBody = envMatch[2];
      if (!result[serverId]) continue;
      const envMap: Record<string, string> = {};
      for (const line of envBody.split('\n')) {
        const kv = line.match(/^\s*(?:"((?:[^"\\]|\\.)*)"|([A-Za-z0-9_.-]+))\s*=\s*"((?:[^"\\]|\\.)*)"/);
        if (kv) {
          const key = kv[1] !== undefined ? unescapeTomlString(kv[1]) : kv[2];
          envMap[key] = unescapeTomlString(kv[3]);
        }
      }
      result[serverId].env = envMap;
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

    const effectiveCommand = serverPayload
      ? resolvePlatformMcpCommand(serverPayload.command)
      : '';

    if (agent.mcpFormat === 'toml-codex' || configPath.endsWith('.toml')) {
      let toml = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '';
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
          lines.push(`command = ${JSON.stringify(effectiveCommand)}`);
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
            command: effectiveCommand,
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

  /**
   * Tests an MCP server connection by performing a real JSON-RPC 2.0 `initialize` handshake
   * over stdio (or HTTP endpoint reachability check for http/sse servers).
   */
  public async testMcpServerConnection(serverId: string): Promise<McpConnectionTestResult> {
    const srv = this.store.getDb().mcpServers[serverId];
    if (!srv) {
      throw new Error(`找不到 MCP 伺服器設定：${serverId}`);
    }

    const startTime = Date.now();

    if (srv.transport !== 'stdio' && srv.url) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(srv.url, {
          method: 'GET',
          signal: controller.signal,
          headers: { Accept: 'application/json, text/event-stream' },
        }).finally(() => clearTimeout(timer));
        const latencyMs = Date.now() - startTime;
        return {
          ok: res.status < 500,
          serverId: srv.id,
          transport: srv.transport,
          latencyMs,
          message: `HTTP 端點連線成功 (HTTP ${res.status}，耗時 ${latencyMs}ms)`,
        };
      } catch (err: any) {
        return {
          ok: false,
          serverId: srv.id,
          transport: srv.transport,
          latencyMs: Date.now() - startTime,
          message: `無法連線至端點 ${srv.url}：${err?.message || err}`,
        };
      }
    }

    // stdio transport test: spawn process and send JSON-RPC initialize
    const cmd = resolvePlatformMcpCommand(srv.command);
    const args = srv.args || [];
    const mergedEnv = {
      ...process.env,
      ...(srv.env || {}),
    };

    return new Promise<McpConnectionTestResult>((resolve) => {
      let settled = false;
      let stdoutBuf = '';
      let stderrBuf = '';

      const finish = (result: McpConnectionTestResult, child?: ReturnType<typeof spawn>) => {
        if (settled) return;
        settled = true;
        if (child && !child.killed) {
          try {
            child.kill();
          } catch {
            // Ignore cleanup failures after the connection test has settled.
          }
        }
        resolve(result);
      };

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(cmd, args, {
          env: mergedEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32' && cmd.toLowerCase().endsWith('.cmd'),
          windowsHide: true,
        });
      } catch (spawnErr: any) {
        finish({
          ok: false,
          serverId: srv.id,
          transport: 'stdio',
          latencyMs: Date.now() - startTime,
          message: `無法啟動指令「${cmd}」：${spawnErr?.message || spawnErr}`,
        });
        return;
      }

      const timeout = setTimeout(() => {
        const latencyMs = Date.now() - startTime;
        // If process is still alive after 4.5s without crashing, report status
        if (stderrBuf.toLowerCase().includes('error') || stderrBuf.toLowerCase().includes('fatal')) {
          finish(
            {
              ok: false,
              serverId: srv.id,
              transport: 'stdio',
              latencyMs,
              message: `啟動逾時或錯誤：${stderrBuf.trim().slice(0, 240)}`,
            },
            child
          );
        } else {
          finish(
            {
              ok: true,
              serverId: srv.id,
              transport: 'stdio',
              latencyMs,
              message: `程序「${cmd}」已成功啟動並持續運行 (${latencyMs}ms，首次下載套件可能需較長時間)`,
            },
            child
          );
        }
      }, 4500);

      child.on('error', (err: any) => {
        clearTimeout(timeout);
        finish(
          {
            ok: false,
            serverId: srv.id,
            transport: 'stdio',
            latencyMs: Date.now() - startTime,
            message: `執行檔「${cmd}」啟動失敗 (${err?.code || err?.message || err})`,
          },
          child
        );
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf-8');
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf-8');
        for (const line of stdoutBuf.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('{')) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.id === 1 && parsed.result) {
              clearTimeout(timeout);
              const latencyMs = Date.now() - startTime;
              const serverInfo = parsed.result.serverInfo || {};
              finish(
                {
                  ok: true,
                  serverId: srv.id,
                  transport: 'stdio',
                  latencyMs,
                  serverInfo,
                  message: `MCP 握手成功！伺服器：${serverInfo.name || srv.id} ${
                    serverInfo.version ? `v${serverInfo.version}` : ''
                  } (${latencyMs}ms)`,
                },
                child
              );
              return;
            }
          } catch {
            // Wait for complete JSON line
          }
        }
      });

      child.on('exit', (code) => {
        clearTimeout(timeout);
        const latencyMs = Date.now() - startTime;
        if (code !== 0 && code !== null) {
          finish({
            ok: false,
            serverId: srv.id,
            transport: 'stdio',
            latencyMs,
            message: `程序異常退出 (Exit Code ${code})${
              stderrBuf.trim() ? `：${stderrBuf.trim().slice(0, 220)}` : ''
            }`,
          });
        }
      });

      // Send MCP JSON-RPC 2.0 initialize request
      const initReq = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'skills-manager-healthcheck', version: '2.0.0' },
        },
      });
      try {
        child.stdin?.write(initReq + '\n');
      } catch {
        // Process errors and the timeout report failed initialization.
      }
    });
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
