import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from './store.js';
import { McpManager } from './mcpManager.js';

describe('MCP config changes', () => {
  let root: string;
  let store: LocalStore;
  let manager: McpManager;
  let jsonPath: string;
  let tomlPath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-mcp-test-'));
    store = new LocalStore(path.join(root, 'library'));
    jsonPath = path.join(root, 'copilot.json');
    tomlPath = path.join(root, 'codex.toml');
    store.updateAgent('github_copilot', { customMcpGlobalPath: jsonPath });
    store.updateAgent('claude_code', { customMcpGlobalPath: path.join(root, 'claude.json') });
    store.updateAgent('codex', { customMcpGlobalPath: tomlPath });
    manager = new McpManager(store);
    manager.upsertMcpServer({
      id: 'demo', name: 'Demo', description: '', transport: 'stdio', command: 'node',
      args: ['script.js'], env: { API_KEY: 'local' },
    });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('preserves invalid JSON config instead of replacing it', () => {
    fs.writeFileSync(jsonPath, '{ invalid');
    expect(() => manager.batchDeployMcpServers(['demo'], ['github_copilot'], true)).toThrow(/拒絕覆蓋/);
    expect(fs.readFileSync(jsonPath, 'utf-8')).toBe('{ invalid');
  });

  it('keeps unrelated JSON settings when adding one server', () => {
    fs.writeFileSync(jsonPath, JSON.stringify({ unrelated: 42, mcpServers: { existing: { command: 'x' } } }));
    manager.batchDeployMcpServers(['demo'], ['github_copilot'], true);
    const saved = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(saved.unrelated).toBe(42);
    expect(saved.mcpServers.existing.command).toBe('x');
    expect(saved.mcpServers.demo.command).toBe('node');
  });

  it('replaces the matching TOML server and its env table only', () => {
    fs.writeFileSync(tomlPath, '[features]\nfoo = true\n\n[mcp_servers.demo]\ncommand = "old"\n\n[mcp_servers.demo.env]\nOLD = "1"\n\n[mcp_servers.other]\ncommand = "keep"\n');
    manager.batchDeployMcpServers(['demo'], ['codex'], true);
    const saved = fs.readFileSync(tomlPath, 'utf-8');
    expect(saved.match(/\[mcp_servers\.demo\]/g)).toHaveLength(1);
    expect(saved).toContain('[features]\nfoo = true');
    expect(saved).toContain('[mcp_servers.other]\ncommand = "keep"');
    expect(saved).toContain('"API_KEY" = "local"');
    expect(saved).not.toContain('OLD = "1"');
  });
});
