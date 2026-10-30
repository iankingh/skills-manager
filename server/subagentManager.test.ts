import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from './store.js';
import { SubagentManager } from './subagentManager.js';

describe('Subagent deployment ownership', () => {
  let root: string;
  let store: LocalStore;
  let manager: SubagentManager;
  let target: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-subagent-test-'));
    store = new LocalStore(path.join(root, 'library'));
    manager = new SubagentManager(store);
    for (const agent of store.getAllAgents()) {
      store.updateAgent(agent.key, { customAgentGlobalPath: path.join(root, agent.key) });
    }
    target = path.join(root, 'codex', 'security-auditor.md');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('refuses to overwrite a personal subagent with the same filename', () => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'personal agent');
    expect(() => manager.batchDeploySubagents(['security-auditor'], ['codex'], true)).toThrow(/拒絕覆蓋/);
    expect(fs.readFileSync(target, 'utf-8')).toBe('personal agent');
  });

  it('removes only unchanged managed copies', () => {
    manager.batchDeploySubagents(['security-auditor'], ['codex'], true);
    expect(fs.existsSync(`${target}.skills-manager-owned.json`)).toBe(true);
    fs.writeFileSync(target, 'edited agent');
    expect(() => manager.batchDeploySubagents(['security-auditor'], ['codex'], false)).toThrow(/本機修改/);
    expect(fs.readFileSync(target, 'utf-8')).toBe('edited agent');
  });
});
