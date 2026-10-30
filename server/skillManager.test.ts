import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from './store.js';
import { SkillManager } from './skillManager.js';

describe('SkillManager deployment ownership', () => {
  let root: string;
  let store: LocalStore;
  let manager: SkillManager;
  let agentDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-manager-test-'));
    store = new LocalStore(path.join(root, 'library'));
    manager = new SkillManager(store);
    agentDir = path.join(root, 'agent-skills');
    for (const agent of store.getAllAgents()) {
      store.updateAgent(agent.key, {
        customGlobalPath: agent.key === 'codex' ? agentDir : path.join(root, agent.key),
      });
    }
    manager.createManualSkill({ dirName: 'sample', name: 'Sample', description: '', tags: [] });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses to replace an unrelated skill folder', () => {
    const target = path.join(agentDir, 'sample');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'personal copy');

    expect(() => manager.deploySkillToAgent('sample', 'codex')).toThrow(/不屬於本程式/);
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf-8')).toBe('personal copy');
    expect(() => manager.deleteSkills(['sample'])).toThrow(/不屬於本程式/);
    expect(fs.existsSync(path.join(store.getSkillsDir(), 'sample'))).toBe(true);
  });

  it('removes an unchanged managed copy and preserves a locally edited one', () => {
    store.updateSettings({ syncMode: 'copy' });
    manager.deploySkillToAgent('sample', 'codex');
    const target = path.join(agentDir, 'sample');
    expect(fs.existsSync(path.join(target, '.skills-manager-owned.json'))).toBe(true);
    manager.undeploySkillFromAgent('sample', 'codex');
    expect(fs.existsSync(target)).toBe(false);

    manager.deploySkillToAgent('sample', 'codex');
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'local edit');
    expect(() => manager.undeploySkillFromAgent('sample', 'codex')).toThrow(/本機修改/);
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf-8')).toBe('local edit');
  });

  it('rejects path traversal in operations that write or delete files', () => {
    expect(() => manager.deploySkillToAgent('../outside', 'codex')).toThrow(/無效/);
    expect(() => manager.deleteSkills(['../outside'])).toThrow(/無效/);
    expect(() => manager.undeploySkillFromAgent('../outside', 'codex')).toThrow(/無效/);
  });

  it('checks all batch targets before changing any deployment', () => {
    const secondDir = path.join(root, 'claude_code', 'sample');
    fs.mkdirSync(secondDir, { recursive: true });
    fs.writeFileSync(path.join(secondDir, 'SKILL.md'), 'personal copy');

    expect(() => manager.batchDeploySkills(['sample'], ['codex', 'claude_code'], true, true)).toThrow(/不屬於本程式/);
    expect(fs.existsSync(path.join(agentDir, 'sample'))).toBe(false);
    expect(fs.readFileSync(path.join(secondDir, 'SKILL.md'), 'utf-8')).toBe('personal copy');
  });

  it('checks all delete targets before removing a central skill', () => {
    manager.deploySkillToAgent('sample', 'codex');
    const secondDir = path.join(root, 'claude_code', 'sample');
    fs.mkdirSync(secondDir, { recursive: true });
    fs.writeFileSync(path.join(secondDir, 'SKILL.md'), 'personal copy');

    expect(() => manager.deleteSkills(['sample'])).toThrow(/不屬於本程式/);
    expect(fs.existsSync(path.join(agentDir, 'sample'))).toBe(true);
    expect(fs.existsSync(path.join(store.getSkillsDir(), 'sample'))).toBe(true);
  });

  it('lists an unrelated same-name skill as external', () => {
    const target = path.join(agentDir, 'sample');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'personal copy');

    const item = manager.scanAgentWorkspace('codex').find((skill) => skill.dirName === 'sample');
    expect(item?.managedByCentral).toBe(false);
    expect(item?.inSyncWithCentral).toBe(false);
  });
});
