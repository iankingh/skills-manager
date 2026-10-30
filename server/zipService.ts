import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { ZipArchive } from 'archiver';
import type { Response } from 'express';
import { BackupSnapshot, SkillRecord } from './types.js';
import { LocalStore, parseSkillMarkdownMeta } from './store.js';
import { SkillManager } from './skillManager.js';
import { expandHomePath } from './agentRegistry.js';

export class ZipAndFolderService {
  constructor(
    private store: LocalStore,
    private skillManager: SkillManager
  ) {}

  /**
   * Safely extracts an uploaded .zip or .skill archive into a temporary staging folder,
   * discovers all skill directories inside it, and imports them into ~/.skills-manager/skills/.
   */
  public importFromZipBuffer(
    zipBuffer: Buffer,
    originalFilename: string,
    overwrite = true
  ): { importedSkills: SkillRecord[]; count: number } {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-mgr-zip-'));
    try {
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();

      for (const entry of entries) {
        const entryName = entry.entryName.replace(/\\/g, '/');
        if (
          entryName.includes('..') ||
          entryName.startsWith('/') ||
          entryName.startsWith('__MACOSX') ||
          entryName.endsWith('.DS_Store')
        ) {
          continue;
        }
        const targetPath = path.resolve(tmpBase, entryName);
        if (!targetPath.startsWith(path.resolve(tmpBase))) {
          throw new Error(`偵測到不安全的壓縮檔路徑 (Path Traversal)：${entryName}`);
        }

        if (entry.isDirectory) {
          fs.mkdirSync(targetPath, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, entry.getData());
        }
      }

      const fallbackSlug = path
        .basename(originalFilename, path.extname(originalFilename))
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || `skill-${Date.now()}`;

      const discoveredDirs = this.discoverSkillDirectories(tmpBase, fallbackSlug);
      const importedIds: string[] = [];

      for (const { slug, dirPath } of discoveredDirs) {
        const destPath = path.join(this.store.getSkillsDir(), slug);
        if (fs.existsSync(destPath)) {
          if (!overwrite) continue;
          fs.rmSync(destPath, { recursive: true, force: true });
        }
        fs.cpSync(dirPath, destPath, { recursive: true });

        const meta = parseSkillMarkdownMeta(destPath);
        const now = new Date().toISOString();
        const db = this.store.getDb();
        db.skills[slug] = {
          id: slug,
          name: meta.name || slug,
          description: meta.description,
          sourceType: 'zip',
          sourceLabel: originalFilename,
          tags: db.skills[slug]?.tags || ['zip-import'],
          createdAt: db.skills[slug]?.createdAt || now,
          updatedAt: now,
        };
        importedIds.push(slug);
      }

      this.store.save();
      this.store.addActivityLog(
        'import-zip',
        `已從壓縮檔「${originalFilename}」匯入 ${importedIds.length} 個技能：${importedIds.join(', ')}`
      );

      const allSkills = this.skillManager.listCentralSkills();
      return {
        importedSkills: allSkills.filter((s) => importedIds.includes(s.id)),
        count: importedIds.length,
      };
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  }

  /**
   * Imports one or more skills from a local directory path on the machine.
   */
  public importFromLocalDirectory(
    localDirPath: string,
    overwrite = true
  ): { importedSkills: SkillRecord[]; count: number } {
    const resolved = expandHomePath(localDirPath.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`找不到指定的本機資料夾路徑：${resolved}`);
    }

    const fallbackSlug = path
      .basename(resolved)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `folder-${Date.now()}`;

    const discovered = this.discoverSkillDirectories(resolved, fallbackSlug);
    const importedIds: string[] = [];

    for (const { slug, dirPath } of discovered) {
      const destPath = path.join(this.store.getSkillsDir(), slug);
      if (path.resolve(dirPath) === path.resolve(destPath)) {
        importedIds.push(slug);
        continue;
      }
      if (fs.existsSync(destPath)) {
        if (!overwrite) continue;
        fs.rmSync(destPath, { recursive: true, force: true });
      }
      fs.cpSync(dirPath, destPath, { recursive: true });

      const meta = parseSkillMarkdownMeta(destPath);
      const now = new Date().toISOString();
      const db = this.store.getDb();
      db.skills[slug] = {
        id: slug,
        name: meta.name || slug,
        description: meta.description,
        sourceType: 'local-folder',
        sourceLabel: resolved,
        tags: db.skills[slug]?.tags || ['folder-import'],
        createdAt: db.skills[slug]?.createdAt || now,
        updatedAt: now,
      };
      importedIds.push(slug);
    }

    this.store.save();
    this.store.addActivityLog(
      'import-folder',
      `已從本機資料夾「${resolved}」匯入 ${importedIds.length} 個技能：${importedIds.join(', ')}`
    );

    const allSkills = this.skillManager.listCentralSkills();
    return {
      importedSkills: allSkills.filter((s) => importedIds.includes(s.id)),
      count: importedIds.length,
    };
  }

  /**
   * Imports files uploaded from browser `<input type="file" webkitdirectory>` folder picker.
   */
  public importFromUploadedFolderFiles(
    files: { relativePath: string; buffer: Buffer }[],
    folderName?: string
  ): { importedSkills: SkillRecord[]; count: number } {
    if (!files || files.length === 0) {
      throw new Error('未收到任何資料夾檔案');
    }
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-mgr-folder-'));
    try {
      for (const file of files) {
        const cleanRel = file.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        if (cleanRel.includes('..') || cleanRel.endsWith('.DS_Store')) continue;
        const targetPath = path.resolve(tmpBase, cleanRel);
        if (!targetPath.startsWith(path.resolve(tmpBase))) continue;
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, file.buffer);
      }

      const fallbackSlug = (folderName || 'uploaded-skill')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const discovered = this.discoverSkillDirectories(tmpBase, fallbackSlug);
      const importedIds: string[] = [];

      for (const { slug, dirPath } of discovered) {
        const destPath = path.join(this.store.getSkillsDir(), slug);
        if (fs.existsSync(destPath)) {
          fs.rmSync(destPath, { recursive: true, force: true });
        }
        fs.cpSync(dirPath, destPath, { recursive: true });

        const meta = parseSkillMarkdownMeta(destPath);
        const now = new Date().toISOString();
        const db = this.store.getDb();
        db.skills[slug] = {
          id: slug,
          name: meta.name || slug,
          description: meta.description,
          sourceType: 'local-folder',
          sourceLabel: folderName || '瀏覽器資料夾匯入',
          tags: db.skills[slug]?.tags || ['folder-import'],
          createdAt: db.skills[slug]?.createdAt || now,
          updatedAt: now,
        };
        importedIds.push(slug);
      }

      this.store.save();
      this.store.addActivityLog(
        'import-folder',
        `已透過資料夾選擇器匯入 ${importedIds.length} 個技能：${importedIds.join(', ')}`
      );

      const allSkills = this.skillManager.listCentralSkills();
      return {
        importedSkills: allSkills.filter((s) => importedIds.includes(s.id)),
        count: importedIds.length,
      };
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  }

  /**
   * Recursively finds directories containing SKILL.md (up to 3 levels deep).
   * If no SKILL.md is found, treats the root directory (or single top-level child directory) as the skill.
   */
  private discoverSkillDirectories(
    rootDir: string,
    fallbackSlug: string
  ): { slug: string; dirPath: string }[] {
    const found: { slug: string; dirPath: string }[] = [];

    const hasSkillMd = (dir: string) =>
      fs.existsSync(path.join(dir, 'SKILL.md')) ||
      fs.existsSync(path.join(dir, 'skill.md'));

    function scan(current: string, depth: number) {
      if (depth > 3) return;
      if (hasSkillMd(current)) {
        const base = path.basename(current);
        const slug =
          current === rootDir
            ? fallbackSlug
            : base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallbackSlug;
        found.push({ slug, dirPath: current });
        return;
      }

      const children = fs
        .readdirSync(current, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== '__MACOSX');
      for (const child of children) {
        scan(path.join(current, child.name), depth + 1);
      }
    }

    scan(rootDir, 0);

    if (found.length > 0) {
      return found;
    }

    // Fallback: if rootDir has a single child directory, use that child directory
    const topEntries = fs
      .readdirSync(rootDir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && e.name !== '__MACOSX');
    if (topEntries.length === 1 && topEntries[0].isDirectory()) {
      const childDir = path.join(rootDir, topEntries[0].name);
      const slug =
        topEntries[0].name
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '') || fallbackSlug;
      return [{ slug, dirPath: childDir }];
    }

    return [{ slug: fallbackSlug, dirPath: rootDir }];
  }

  /**
   * Streams one or more skills as a downloadable .zip archive to the HTTP response.
   */
  public async streamSkillsAsZip(
    skillIds: string[],
    zipFilename: string,
    res: Response
  ): Promise<void> {
    const skillsDir = this.store.getSkillsDir();
    const validIds = skillIds.filter((id) =>
      fs.existsSync(path.join(skillsDir, id))
    );

    if (validIds.length === 0) {
      throw new Error('沒有可匯出的技能資料夾');
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(zipFilename)}"`
    );

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.pipe(res);

    for (const id of validIds) {
      const folderPath = path.join(skillsDir, id);
      archive.directory(folderPath, id);
    }

    this.store.addActivityLog(
      'export-zip',
      `已匯出並下載 ZIP 壓縮檔「${zipFilename}」(${validIds.length} 個技能)`
    );

    await archive.finalize();
  }

  /**
   * Creates an offline local snapshot (.zip) inside ~/.skills-manager/backups/
   */
  public createLocalSnapshot(note = '手動建立本機快照'): BackupSnapshot {
    const backupsDir = this.store.getBackupsDir();
    fs.mkdirSync(backupsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `skills-backup-${timestamp}.zip`;
    const filePath = path.join(backupsDir, filename);

    const zip = new AdmZip();
    const skillsDir = this.store.getSkillsDir();
    const skills = this.skillManager.listCentralSkills();

    if (fs.existsSync(skillsDir)) {
      zip.addLocalFolder(skillsDir, 'skills');
    }
    const agentsDir = this.store.getSubagentsDir();
    if (fs.existsSync(agentsDir)) {
      zip.addLocalFolder(agentsDir, 'agents');
    }
    zip.addFile(
      'snapshot-meta.json',
      Buffer.from(
        JSON.stringify(
          {
            note,
            createdAt: new Date().toISOString(),
            skillCount: skills.length,
            db: this.store.getDb(),
          },
          null,
          2
        ),
        'utf-8'
      )
    );

    zip.writeZip(filePath);
    const stat = fs.statSync(filePath);

    this.store.addActivityLog(
      'snapshot',
      `已建立本機離線 ZIP 快照「${filename}」(${skills.length} 個技能)`
    );

    return {
      id: filename,
      filename,
      note,
      skillCount: skills.length,
      sizeBytes: stat.size,
      createdAt: stat.birthtime.toISOString(),
      filePath,
    };
  }

  public listLocalSnapshots(): BackupSnapshot[] {
    const backupsDir = this.store.getBackupsDir();
    if (!fs.existsSync(backupsDir)) return [];

    const files = fs
      .readdirSync(backupsDir)
      .filter((f) => f.endsWith('.zip'))
      .sort()
      .reverse();

    const snapshots: BackupSnapshot[] = [];
    for (const filename of files) {
      const filePath = path.join(backupsDir, filename);
      try {
        const stat = fs.statSync(filePath);
        let note = '本機離線備份快照';
        let skillCount = 0;
        let createdAt = stat.mtime.toISOString();

        try {
          const zip = new AdmZip(filePath);
          const metaEntry = zip.getEntry('snapshot-meta.json');
          if (metaEntry) {
            const parsed = JSON.parse(metaEntry.getData().toString('utf-8'));
            note = parsed.note || note;
            skillCount = parsed.skillCount ?? 0;
            createdAt = parsed.createdAt || createdAt;
          }
        } catch {
          // Ignore meta read error
        }

        snapshots.push({
          id: filename,
          filename,
          note,
          skillCount,
          sizeBytes: stat.size,
          createdAt,
          filePath,
        });
      } catch {
        continue;
      }
    }

    return snapshots;
  }

  public restoreLocalSnapshot(filename: string): { restoredCount: number } {
    const filePath = path.join(this.store.getBackupsDir(), path.basename(filename));
    if (!fs.existsSync(filePath)) {
      throw new Error(`找不到指定的備份快照檔案：${filename}`);
    }

    // Create a safety snapshot first (matching upstream v1.42.1 safety behavior)
    this.createLocalSnapshot(`還原 ${filename} 前的自動安全備份`);

    const buf = fs.readFileSync(filePath);
    const zip = new AdmZip(buf);
    const metaEntry = zip.getEntry('snapshot-meta.json');
    let restoredAgentsCount = 0;
    let restoredMcpCount = 0;

    // 1. Restore agents/ (Subagents) files if present in snapshot
    const agentsDir = this.store.getSubagentsDir();
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const entry of zip.getEntries()) {
      const entryName = entry.entryName.replace(/\\/g, '/');
      if (!entry.isDirectory && entryName.startsWith('agents/') && entryName.endsWith('.md')) {
        const baseName = path.basename(entryName);
        if (!baseName.includes('..')) {
          fs.writeFileSync(path.join(agentsDir, baseName), entry.getData());
          restoredAgentsCount += 1;
        }
      }
    }

    // 2. Restore db metadata (subagents, mcpServers, presets) from snapshot-meta.json
    if (metaEntry) {
      try {
        const parsed = JSON.parse(metaEntry.getData().toString('utf-8'));
        const snapDb = parsed?.db;
        const currentDb = this.store.getDb();
        if (snapDb?.subagents && typeof snapDb.subagents === 'object') {
          currentDb.subagents = { ...currentDb.subagents, ...snapDb.subagents };
        }
        if (snapDb?.mcpServers && typeof snapDb.mcpServers === 'object') {
          restoredMcpCount = Object.keys(snapDb.mcpServers).length;
          currentDb.mcpServers = { ...currentDb.mcpServers, ...snapDb.mcpServers };
        }
        if (Array.isArray(snapDb?.presets) && snapDb.presets.length > 0) {
          currentDb.presets = snapDb.presets;
        }
        this.store.save();
      } catch {
        // Ignore meta parse error
      }
    }

    // 3. Restore skills/
    const res = this.importFromZipBuffer(buf, filename, true);
    this.store.addActivityLog(
      'snapshot',
      `已從快照「${filename}」完整還原 (${res.count} 個技能、${restoredAgentsCount} 個 Agent、${restoredMcpCount} 個 MCP)`
    );
    return { restoredCount: res.count };
  }

  public deleteLocalSnapshot(filename: string): void {
    const filePath = path.join(this.store.getBackupsDir(), path.basename(filename));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
