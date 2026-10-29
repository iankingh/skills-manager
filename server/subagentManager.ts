import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import AdmZip from 'adm-zip';
import archiver from 'archiver';
import type { Response } from 'express';
import {
  AgentConfig,
  ExternalSubagentItem,
  SubagentRecord,
} from './types.js';
import { expandHomePath } from './agentRegistry.js';
import { LocalStore } from './store.js';
import { directChildPath } from './pathSafety.js';

function parseSubagentFileMeta(filePath: string): {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  rawContent: string;
} {
  const baseId = path.basename(filePath).replace(/\.(agent\.md|md|toml)$/i, '');
  const rawContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';

  const fmMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    try {
      const parsed = YAML.parse(fmMatch[1]) as Record<string, any>;
      return {
        name: typeof parsed?.name === 'string' && parsed.name.trim() ? parsed.name.trim() : baseId,
        description:
          typeof parsed?.description === 'string' && parsed.description.trim()
            ? parsed.description.trim()
            : '本機 AI Agent 專屬角色定義',
        model: typeof parsed?.model === 'string' ? parsed.model : undefined,
        tools: Array.isArray(parsed?.tools) ? parsed.tools.map(String) : undefined,
        rawContent,
      };
    } catch {
      // Fallback
    }
  }

  const lines = rawContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('---'));

  return {
    name: baseId,
    description: lines[0] ? lines[0].slice(0, 140) : '本機 AI Agent 專屬角色定義',
    rawContent,
  };
}

export class SubagentManager {
  constructor(private store: LocalStore) {}

  private markerPath(targetPath: string): string {
    return `${targetPath}.skills-manager-owned.json`;
  }

  private isManagedTarget(targetPath: string, fileName: string): boolean {
    try {
      if (!fs.lstatSync(targetPath).isFile()) return false;
      const marker = JSON.parse(fs.readFileSync(this.markerPath(targetPath), 'utf-8'));
      const digest = crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');
      return marker.fileName === fileName && marker.digest === digest;
    } catch {
      return false;
    }
  }

  private assertReplaceableTarget(targetPath: string, fileName: string): void {
    let targetExists = false;
    try {
      fs.lstatSync(targetPath);
      targetExists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (targetExists || fs.existsSync(this.markerPath(targetPath))) {
      if (!this.isManagedTarget(targetPath, fileName)) {
        throw new Error(`AI Agent 檔案不屬於本程式或已有本機修改，拒絕覆蓋：${targetPath}`);
      }
    }
  }

  private writeManagedTarget(sourcePath: string, targetPath: string): void {
    if (path.resolve(sourcePath) === path.resolve(targetPath)) {
      throw new Error(`目標路徑與中央 Agent 庫重疊：${targetPath}`);
    }
    const fileName = path.basename(sourcePath);
    this.assertReplaceableTarget(targetPath, fileName);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');
    fs.writeFileSync(this.markerPath(targetPath), JSON.stringify({ fileName, digest }), 'utf-8');
  }

  private removeManagedTarget(targetPath: string, fileName: string): void {
    this.assertReplaceableTarget(targetPath, fileName);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      fs.unlinkSync(this.markerPath(targetPath));
    }
  }

  public getAgentSubagentsResolvedPath(agent: AgentConfig): string {
    const raw = agent.customAgentGlobalPath?.trim() || agent.defaultAgentGlobalPath;
    return expandHomePath(raw);
  }

  public listCentralSubagents(): SubagentRecord[] {
    const dir = this.store.getSubagentsDir();
    fs.mkdirSync(dir, { recursive: true });

    const db = this.store.getDb();
    const agents = this.store.getAllAgents();
    const files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isFile() &&
          !e.name.startsWith('.') &&
          (e.name.endsWith('.md') || e.name.endsWith('.toml'))
      );

    const records: SubagentRecord[] = [];
    let dbChanged = false;

    for (const entry of files) {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      const id = entry.name.replace(/\.(agent\.md|md|toml)$/i, '');
      const meta = parseSubagentFileMeta(fullPath);
      const hash = crypto
        .createHash('sha256')
        .update(meta.rawContent.replace(/\r\n/g, '\n'))
        .digest('hex')
        .slice(0, 12);

      const now = new Date().toISOString();
      if (!db.subagents[id]) {
        db.subagents[id] = {
          id,
          name: meta.name,
          description: meta.description,
          model: meta.model,
          tools: meta.tools,
          fileName: entry.name,
          sourceType: 'local-folder',
          sourceLabel: '本機 Agent 儲存庫',
          tags: ['subagent'],
          createdAt: stat.birthtime.toISOString() || now,
          updatedAt: stat.mtime.toISOString() || now,
        };
        dbChanged = true;
      } else {
        db.subagents[id].name = meta.name;
        db.subagents[id].description = meta.description;
        db.subagents[id].fileName = entry.name;
      }

      const saved = db.subagents[id];
      const deployments: SubagentRecord['deployments'] = {};

      for (const agent of agents) {
        const agentDir = this.getAgentSubagentsResolvedPath(agent);
        const targetPath = path.join(agentDir, entry.name);
        deployments[agent.key] = {
          agentKey: agent.key,
          deployed: this.isManagedTarget(targetPath, entry.name),
          targetPath,
        };
      }

      records.push({
        id,
        name: saved.name,
        description: saved.description,
        model: saved.model,
        tools: saved.tools,
        fileName: entry.name,
        centralPath: fullPath,
        sourceType: saved.sourceType,
        sourceLabel: saved.sourceLabel,
        tags: saved.tags || [],
        contentHash: hash,
        sizeBytes: stat.size,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
        deployments,
      });
    }

    if (dbChanged) {
      this.store.save();
    }

    records.sort((a, b) => a.name.localeCompare(b.name));
    return records;
  }

  public getSubagentDetails(id: string): {
    subagent: SubagentRecord;
    markdownContent: string;
  } {
    const subagent = this.listCentralSubagents().find((s) => s.id === id);
    if (!subagent) throw new Error(`找不到 AI Agent：${id}`);
    const markdownContent = fs.readFileSync(subagent.centralPath, 'utf-8');
    return { subagent, markdownContent };
  }

  public createSubagent(input: {
    id: string;
    name: string;
    description: string;
    tools?: string[];
    tags?: string[];
    markdownBody?: string;
  }): SubagentRecord {
    const slug = input.id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) throw new Error('請輸入有效的 AI Agent 代號 (英數與連字號)');

    const fileName = `${slug}.md`;
    const fullPath = path.join(this.store.getSubagentsDir(), fileName);
    if (fs.existsSync(fullPath)) {
      throw new Error(`AI Agent「${slug}」已存在於中央庫`);
    }

    const toolsLine =
      input.tools && input.tools.length > 0
        ? `\ntools: [${input.tools.map((t) => `"${t}"`).join(', ')}]`
        : '';

    const content = `---
name: ${input.name.trim() || slug}
description: ${input.description.trim() || '自訂 AI Agent 角色代理'}${toolsLine}
---
${
  input.markdownBody?.trim() ||
  `# ${input.name.trim() || slug}

請在此處定義此 AI Agent 的專業角色、權責範圍與工作流程規範。`
}
`;
    fs.writeFileSync(fullPath, content, 'utf-8');

    const now = new Date().toISOString();
    this.store.getDb().subagents[slug] = {
      id: slug,
      name: input.name.trim() || slug,
      description: input.description.trim() || '自訂 AI Agent 角色代理',
      tools: input.tools,
      fileName,
      sourceType: 'manual',
      sourceLabel: '手動建立 AI Agent',
      tags: input.tags || ['subagent'],
      createdAt: now,
      updatedAt: now,
    };
    this.store.addActivityLog('agent-deploy', `已建立新 AI Agent「${slug}」`, fullPath);
    return this.listCentralSubagents().find((a) => a.id === slug)!;
  }

  public updateSubagent(
    id: string,
    updates: { markdownContent?: string; tags?: string[] }
  ): SubagentRecord {
    const current = this.listCentralSubagents().find((s) => s.id === id);
    if (!current) throw new Error(`找不到 AI Agent：${id}`);

    if (typeof updates.markdownContent === 'string') {
      fs.writeFileSync(current.centralPath, updates.markdownContent, 'utf-8');
      // Also update any deployed copies
      for (const dep of Object.values(current.deployments)) {
        if (dep.deployed) {
          this.writeManagedTarget(current.centralPath, dep.targetPath);
        }
      }
    }

    const db = this.store.getDb();
    if (db.subagents[id] && updates.tags) {
      db.subagents[id].tags = updates.tags;
      db.subagents[id].updatedAt = new Date().toISOString();
      this.store.save();
    }

    return this.listCentralSubagents().find((s) => s.id === id)!;
  }

  public deleteSubagents(ids: string[]): SubagentRecord[] {
    const all = this.listCentralSubagents();
    const db = this.store.getDb();

    for (const id of ids) {
      const rec = all.find((r) => r.id === id);
      if (!rec) continue;
      for (const dep of Object.values(rec.deployments)) {
        this.assertReplaceableTarget(dep.targetPath, rec.fileName);
      }
    }

    for (const id of ids) {
      const rec = all.find((r) => r.id === id);
      if (rec) {
        for (const dep of Object.values(rec.deployments)) {
          this.removeManagedTarget(dep.targetPath, rec.fileName);
        }
        if (fs.existsSync(rec.centralPath)) {
          fs.unlinkSync(rec.centralPath);
        }
      }
      delete db.subagents[id];
    }

    this.store.addActivityLog('delete', `已刪除 ${ids.length} 個 AI Agent`);
    return this.listCentralSubagents();
  }

  public batchDeploySubagents(
    subagentIds: string[],
    agentKeys: string[],
    deploy: boolean
  ): { subagents: SubagentRecord[]; affectedCount: number } {
    const allSubagents = this.listCentralSubagents();
    const targetAgents = this.store
      .getAllAgents()
      .filter((a) => agentKeys.includes(a.key));

    for (const subId of subagentIds) {
      const rec = allSubagents.find((s) => s.id === subId);
      if (!rec) continue;
      for (const agent of targetAgents) {
        const targetPath = directChildPath(this.getAgentSubagentsResolvedPath(agent), rec.fileName);
        this.assertReplaceableTarget(targetPath, rec.fileName);
      }
    }

    let count = 0;
    for (const subId of subagentIds) {
      const rec = allSubagents.find((s) => s.id === subId);
      if (!rec) continue;
      count += 1;

      for (const agent of targetAgents) {
        const agentDir = this.getAgentSubagentsResolvedPath(agent);
        const targetPath = directChildPath(agentDir, rec.fileName);
        if (deploy) {
          this.writeManagedTarget(rec.centralPath, targetPath);
        } else {
          this.removeManagedTarget(targetPath, rec.fileName);
        }
      }
    }

    this.store.addActivityLog(
      'agent-deploy',
      `${deploy ? '已部署' : '已移除'} ${count} 個 AI Agent 至 ${targetAgents
        .map((a) => a.name)
        .join('、')}`
    );

    return {
      subagents: this.listCentralSubagents(),
      affectedCount: count,
    };
  }

  public scanExternalSubagents(agentKey?: string): ExternalSubagentItem[] {
    const agents = this.store.getAllAgents();
    const targetAgents = agentKey
      ? agents.filter((a) => a.key === agentKey)
      : agents.filter((a) => a.enabled);

    const central = this.listCentralSubagents();
    const centralByFile = new Map(central.map((c) => [c.fileName, c]));
    const results: ExternalSubagentItem[] = [];

    for (const agent of targetAgents) {
      const dir = this.getAgentSubagentsResolvedPath(agent);
      if (!fs.existsSync(dir)) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (
          !entry.isFile() ||
          entry.name.startsWith('.') ||
          (!entry.name.endsWith('.md') && !entry.name.endsWith('.toml'))
        ) {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        const stat = fs.statSync(fullPath);
        const meta = parseSubagentFileMeta(fullPath);
        const matched = centralByFile.get(entry.name);

        results.push({
          agentKey: agent.key,
          agentName: agent.name,
          fileName: entry.name,
          id: entry.name.replace(/\.(agent\.md|md|toml)$/i, ''),
          name: meta.name,
          description: meta.description,
          fullPath,
          managedByCentral: Boolean(matched) && this.isManagedTarget(fullPath, entry.name),
          centralSubagentId: matched?.id,
          sizeBytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
        });
      }
    }

    return results;
  }

  public getExternalSubagentContent(
    agentKey: string,
    fileName: string
  ): { item: ExternalSubagentItem; markdownContent: string } {
    const items = this.scanExternalSubagents(agentKey);
    const item = items.find((i) => i.fileName === fileName && i.agentKey === agentKey);
    if (!item) throw new Error(`找不到個人資料夾中的 AI Agent：${fileName}`);
    const markdownContent = fs.readFileSync(item.fullPath, 'utf-8');
    return { item, markdownContent };
  }

  public updateExternalSubagentContent(
    agentKey: string,
    fileName: string,
    markdownContent: string
  ): { item: ExternalSubagentItem; markdownContent: string } {
    const agent = this.store.getAllAgents().find((a) => a.key === agentKey);
    if (!agent) throw new Error(`找不到工具：${agentKey}`);
    const fullPath = directChildPath(this.getAgentSubagentsResolvedPath(agent), fileName);
    if (!fs.existsSync(fullPath) || !fs.lstatSync(fullPath).isFile()) {
      throw new Error(`找不到可編輯的 AI Agent 檔案：${fileName}`);
    }
    const wasManaged = this.isManagedTarget(fullPath, fileName);
    fs.writeFileSync(fullPath, markdownContent, 'utf-8');

    // Also sync back to central if managed
    const centralPath = directChildPath(this.store.getSubagentsDir(), fileName);
    if (wasManaged && fs.existsSync(centralPath)) {
      fs.writeFileSync(centralPath, markdownContent, 'utf-8');
      const digest = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
      fs.writeFileSync(this.markerPath(fullPath), JSON.stringify({ fileName, digest }), 'utf-8');
    }

    return this.getExternalSubagentContent(agentKey, fileName);
  }

  public adoptExternalSubagent(agentKey: string, fileName: string): SubagentRecord[] {
    const agent = this.store.getAllAgents().find((a) => a.key === agentKey);
    if (!agent) throw new Error(`找不到工具：${agentKey}`);
    const srcPath = directChildPath(this.getAgentSubagentsResolvedPath(agent), fileName);
    if (!fs.existsSync(srcPath)) throw new Error(`找不到檔案：${srcPath}`);

    const destPath = directChildPath(this.store.getSubagentsDir(), fileName);
    if (fs.existsSync(destPath)) {
      throw new Error(`中央 Agent 庫已有同名檔案：${fileName}`);
    }
    fs.copyFileSync(srcPath, destPath);
    const id = fileName.replace(/\.(agent\.md|md|toml)$/i, '');
    const meta = parseSubagentFileMeta(destPath);
    const now = new Date().toISOString();

    this.store.getDb().subagents[id] = {
      id,
      name: meta.name,
      description: meta.description,
      fileName,
      sourceType: 'adopted',
      sourceLabel: `由 ${agent.name} 納管匯入`,
      tags: ['adopted', agent.key],
      createdAt: now,
      updatedAt: now,
    };
    this.store.addActivityLog('adopt', `已從 ${agent.name} 納管匯入 AI Agent「${id}」`);
    return this.listCentralSubagents();
  }

  public importSubagentsFromZipBuffer(
    zipBuffer: Buffer,
    originalFilename: string
  ): { count: number; subagents: SubagentRecord[] } {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    let count = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const entryName = entry.entryName.replace(/\\/g, '/');
      if (
        entryName.includes('..') ||
        entryName.startsWith('__MACOSX') ||
        (!entryName.endsWith('.md') && !entryName.endsWith('.toml'))
      ) {
        continue;
      }
      const baseName = path.basename(entryName);
      if (baseName.toLowerCase() === 'skill.md' || baseName.toLowerCase() === 'readme.md') {
        continue;
      }
      const destPath = path.join(this.store.getSubagentsDir(), baseName);
      fs.writeFileSync(destPath, entry.getData());
      count += 1;
    }

    if (count === 0) {
      throw new Error('壓縮檔內未找到任何 .md 或 .toml 格式的 AI Agent 檔案');
    }

    this.store.addActivityLog(
      'import-zip',
      `已從壓縮檔「${originalFilename}」匯入 ${count} 個 AI Agent`
    );
    return { count, subagents: this.listCentralSubagents() };
  }

  public importSubagentsFromLocalPath(localPath: string): {
    count: number;
    subagents: SubagentRecord[];
  } {
    const resolved = expandHomePath(localPath.trim());
    if (!fs.existsSync(resolved)) {
      throw new Error(`找不到指定的本機路徑：${resolved}`);
    }

    const stat = fs.statSync(resolved);
    let count = 0;
    if (stat.isFile()) {
      const base = path.basename(resolved);
      fs.copyFileSync(resolved, path.join(this.store.getSubagentsDir(), base));
      count = 1;
    } else if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
        if (
          entry.isFile() &&
          !entry.name.startsWith('.') &&
          (entry.name.endsWith('.md') || entry.name.endsWith('.toml'))
        ) {
          fs.copyFileSync(
            path.join(resolved, entry.name),
            path.join(this.store.getSubagentsDir(), entry.name)
          );
          count += 1;
        }
      }
    }

    if (count === 0) {
      throw new Error('該路徑下未找到任何 .md 或 .toml 格式的 AI Agent 檔案');
    }

    this.store.addActivityLog('import-folder', `已從「${resolved}」匯入 ${count} 個 AI Agent`);
    return { count, subagents: this.listCentralSubagents() };
  }

  public async streamSubagentsAsZip(
    ids: string[],
    zipFilename: string,
    res: Response
  ): Promise<void> {
    const all = this.listCentralSubagents();
    const targets = ids.length > 0 ? all.filter((a) => ids.includes(a.id)) : all;
    if (targets.length === 0) {
      throw new Error('沒有可匯出的 AI Agent');
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(zipFilename)}"`
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    for (const item of targets) {
      archive.file(item.centralPath, { name: item.fileName });
    }
    await archive.finalize();
  }
}
