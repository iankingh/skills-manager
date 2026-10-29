import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStore } from './store.js';
import { SkillManager } from './skillManager.js';
import { SubagentManager } from './subagentManager.js';
import { McpManager } from './mcpManager.js';
import { ZipAndFolderService } from './zipService.js';

async function captureZip(exportZip: (response: Response) => Promise<void>) {
  const response = Object.assign(new PassThrough(), { setHeader: vi.fn() });
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  const completion = finished(response);
  await exportZip(response as unknown as Response);
  await completion;
  return { zip: new AdmZip(Buffer.concat(chunks)), setHeader: response.setHeader };
}

describe('ZIP export compatibility', () => {
  let root: string;
  let store: LocalStore;
  let skills: SkillManager;
  let subagents: SubagentManager;
  let service: ZipAndFolderService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-zip-test-'));
    store = new LocalStore(path.join(root, 'library'));
    for (const agent of store.getAllAgents()) {
      store.updateAgent(agent.key, {
        customGlobalPath: path.join(root, agent.key, 'skills'),
        customAgentGlobalPath: path.join(root, agent.key, 'agents'),
        customMcpGlobalPath: path.join(root, agent.key, 'mcp.json'),
      });
    }
    skills = new SkillManager(store);
    subagents = new SubagentManager(store);
    service = new ZipAndFolderService(store, skills);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('exports selected skills with their nested files and exact contents', async () => {
    const skill = skills.createManualSkill({ dirName: 'zip-sample', name: 'ZIP Sample', description: '', tags: [] });
    const skillDir = skill.centralPath;
    fs.mkdirSync(path.join(skillDir, 'scripts'));
    fs.writeFileSync(path.join(skillDir, 'scripts', 'check.ts'), 'console.log("技能審查");\n');
    const binary = Buffer.from([0, 1, 127, 128, 255]);
    fs.writeFileSync(path.join(skillDir, 'data.bin'), binary);
    const filename = '技能匯出.zip';

    const { zip, setHeader } = await captureZip((response) =>
      service.streamSkillsAsZip(['zip-sample', 'code-review-pro'], filename, response)
    );

    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip');
    expect(setHeader).toHaveBeenCalledWith('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    expect(zip.readAsText('zip-sample/SKILL.md')).toBe(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8'));
    expect(zip.readAsText('zip-sample/scripts/check.ts')).toBe('console.log("技能審查");\n');
    expect(zip.readFile('zip-sample/data.bin')).toEqual(binary);
    expect(zip.getEntry('code-review-pro/SKILL.md')).not.toBeNull();
    expect(zip.getEntries().some((entry) => entry.entryName.startsWith('offline-architecture-guide/'))).toBe(false);
  });

  it('round-trips an exported skill through ZIP import without losing content', async () => {
    const skill = skills.createManualSkill({ dirName: 'roundtrip', name: 'Round Trip', description: '', tags: [] });
    fs.mkdirSync(path.join(skill.centralPath, 'references'));
    fs.writeFileSync(path.join(skill.centralPath, 'references', '說明.md'), '# 範例\n');
    const { zip } = await captureZip((response) => service.streamSkillsAsZip(['roundtrip'], 'roundtrip.zip', response));
    fs.rmSync(skill.centralPath, { recursive: true });

    const result = service.importFromZipBuffer(zip.toBuffer(), 'roundtrip.zip');

    expect(result.count).toBe(1);
    expect(result.importedSkills[0].id).toBe('roundtrip');
    expect(fs.readFileSync(path.join(skill.centralPath, 'references', '說明.md'), 'utf-8')).toBe('# 範例\n');
  });

  it('exports only selected agents under their original filenames', async () => {
    const agent = subagents.listCentralSubagents().find((item) => item.id === 'security-auditor')!;
    const filename = '代理匯出.zip';
    const { zip, setHeader } = await captureZip((response) =>
      subagents.streamSubagentsAsZip([agent.id], filename, response)
    );

    expect(zip.getEntries().map((entry) => entry.entryName)).toEqual([agent.fileName]);
    expect(zip.readAsText(agent.fileName)).toBe(fs.readFileSync(agent.centralPath, 'utf-8'));
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip');
    expect(setHeader).toHaveBeenCalledWith('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  });

  it('exports selected MCP settings with command arguments and environment values intact', async () => {
    const manager = new McpManager(store);
    manager.upsertMcpServer({
      id: 'zip-mcp', name: 'ZIP MCP', description: '匯出測試', transport: 'stdio',
      command: 'node', args: ['server.js', '--name=範例'], env: { LOCAL_VALUE: '測試值' },
    });
    const { zip } = await captureZip((response) => manager.streamMcpAsZip(['zip-mcp'], 'mcp.zip', response));

    expect(zip.getEntries().map((entry) => entry.entryName)).toEqual(['mcp-config.json']);
    expect(JSON.parse(zip.readAsText('mcp-config.json'))).toEqual({
      mcpServers: {
        'zip-mcp': {
          command: 'node', args: ['server.js', '--name=範例'],
          env: { LOCAL_VALUE: '測試值' }, description: '匯出測試',
        },
      },
    });
  });
});
