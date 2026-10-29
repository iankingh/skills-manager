import fs from 'node:fs';
import path from 'node:path';
import {
  AgentConfig,
  ExternalAgentSkill,
  Preset,
  SkillDeploymentState,
  SkillRecord,
} from './types.js';
import { expandHomePath } from './agentRegistry.js';
import {
  LocalStore,
  computeSkillDirectoryStats,
  computeOwnedDirectoryDigest,
  invalidateSkillCache,
  parseSkillMarkdownMeta,
} from './store.js';
import { directChildPath } from './pathSafety.js';

export class SkillManager {
  constructor(private store: LocalStore) {}

  public getAgentResolvedPath(agent: AgentConfig): string {
    const raw = agent.customGlobalPath?.trim() || agent.defaultGlobalPath;
    return expandHomePath(raw);
  }

  /**
   * Lists all skills in the central library (~/.skills-manager/skills)
   * and computes live deployment status across all configured AI tools.
   */
  public listCentralSkills(): SkillRecord[] {
    const skillsDir = this.store.getSkillsDir();
    fs.mkdirSync(skillsDir, { recursive: true });

    const db = this.store.getDb();
    const agents = this.store.getAllAgents();
    const agentResolvedPaths = new Map<string, string>();
    for (const agent of agents) {
      agentResolvedPaths.set(agent.key, this.getAgentResolvedPath(agent));
    }

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const records: SkillRecord[] = [];
    let dbChanged = false;

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const fullPath = path.join(skillsDir, entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const dirName = entry.name;
      const meta = parseSkillMarkdownMeta(fullPath);
      const stats = computeSkillDirectoryStats(fullPath);
      const existing = db.skills[dirName];
      const now = new Date().toISOString();

      if (!existing) {
        db.skills[dirName] = {
          id: dirName,
          name: meta.name || dirName,
          description: meta.description,
          sourceType: 'local-folder',
          sourceLabel: '本機儲存庫掃描',
          tags: [],
          createdAt: stat.birthtime.toISOString() || now,
          updatedAt: stat.mtime.toISOString() || now,
        };
        dbChanged = true;
      } else {
        if (meta.name && existing.name !== meta.name) {
          existing.name = meta.name;
          dbChanged = true;
        }
        if (meta.description && existing.description !== meta.description) {
          existing.description = meta.description;
          dbChanged = true;
        }
      }

      const savedMeta = db.skills[dirName];
      const deployments: Record<string, SkillDeploymentState> = {};

      for (const agent of agents) {
        const agentSkillsDir = agentResolvedPaths.get(agent.key)!;
        const targetSkillPath = path.join(agentSkillsDir, dirName);
        deployments[agent.key] = this.inspectDeploymentFast(
          agent.key,
          fullPath,
          stats.contentHash,
          targetSkillPath
        );
      }

      records.push({
        id: dirName,
        name: savedMeta.name,
        description: savedMeta.description,
        dirName,
        centralPath: fullPath,
        sourceType: savedMeta.sourceType,
        sourceLabel: savedMeta.sourceLabel,
        tags: savedMeta.tags || [],
        contentHash: stats.contentHash,
        fileCount: stats.fileCount,
        totalBytes: stats.totalBytes,
        createdAt: savedMeta.createdAt,
        updatedAt: savedMeta.updatedAt,
        deployments,
      });
    }

    if (dbChanged) {
      this.store.save();
    }

    records.sort((a, b) => a.name.localeCompare(b.name));
    return records;
  }

  private inspectDeploymentFast(
    agentKey: string,
    centralSkillPath: string,
    centralHash: string,
    targetSkillPath: string
  ): SkillDeploymentState {
    try {
      const lstat = fs.lstatSync(targetSkillPath);
      if (lstat.isSymbolicLink()) {
        const managed = fs.realpathSync(targetSkillPath) === fs.realpathSync(centralSkillPath);
        return {
          agentKey,
          deployed: managed,
          mode: managed ? (process.platform === 'win32' ? 'junction' : 'symlink') : 'external',
          targetPath: targetSkillPath,
          inSync: managed,
        };
      }
      if (lstat.isDirectory()) {
        const markerPath = path.join(targetSkillPath, '.skills-manager-owned.json');
        if (fs.existsSync(markerPath)) {
          try {
            const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
            if (marker.digestVersion === 2 && marker.skillId === path.basename(centralSkillPath)) {
              return {
                agentKey,
                deployed: true,
                mode: 'copy',
                targetPath: targetSkillPath,
                inSync:
                  computeOwnedDirectoryDigest(targetSkillPath) === marker.digest &&
                  computeSkillDirectoryStats(targetSkillPath).contentHash === centralHash,
              };
            }
          } catch {
            // A broken marker is not proof of ownership.
          }
        }
        return {
          agentKey,
          deployed: false,
          mode: 'external',
          targetPath: targetSkillPath,
          inSync: false,
        };
      }
    } catch {
      // Does not exist
    }

    return {
      agentKey,
      deployed: false,
      targetPath: targetSkillPath,
      inSync: false,
    };
  }

  /**
   * Low-level single deployment operation without triggering full library rescan.
   */
  private performSingleDeployOnDisk(
    skillId: string,
    centralSkillPath: string,
    agentKey: string,
    agentDir: string,
    syncMode: 'symlink' | 'copy'
  ): 'symlink' | 'junction' | 'copy' {
    fs.mkdirSync(agentDir, { recursive: true });
    const targetPath = path.join(agentDir, skillId);

    // If symlink Mode and target is already a valid symlink pointing to centralSkillPath, skip redundant unlink/relink!
    if (syncMode === 'symlink') {
      try {
        const lstat = fs.lstatSync(targetPath);
        if (lstat.isSymbolicLink()) {
          const realTarget = fs.realpathSync(targetPath);
          const realCentral = fs.realpathSync(centralSkillPath);
          if (path.resolve(realTarget) === path.resolve(realCentral)) {
            return process.platform === 'win32' ? 'junction' : 'symlink';
          }
        }
      } catch {
        // Proceed to create link
      }
    }

    this.removeTargetIfExists(targetPath, centralSkillPath);

    let usedMode: 'symlink' | 'junction' | 'copy';
    if (syncMode === 'symlink') {
      try {
        const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
        fs.symlinkSync(centralSkillPath, targetPath, symlinkType);
        usedMode = process.platform === 'win32' ? 'junction' : 'symlink';
      } catch {
        fs.cpSync(centralSkillPath, targetPath, { recursive: true });
        usedMode = 'copy';
      }
    } else {
      fs.cpSync(centralSkillPath, targetPath, { recursive: true });
      usedMode = 'copy';
    }

    if (usedMode === 'copy') {
      try {
        fs.writeFileSync(
          path.join(targetPath, '.skills-manager-owned.json'),
          JSON.stringify({
            digestVersion: 2,
            skillId,
            agentKey,
            digest: computeOwnedDirectoryDigest(targetPath),
            syncedAt: new Date().toISOString(),
          }),
          'utf-8'
        );
      } catch {
        // Ignore if read-only
      }
    }

    return usedMode;
  }

  /**
   * Deploys a single central skill to a specific AI tool's personal skills directory.
   */
  public deploySkillToAgent(skillId: string, agentKey: string): SkillRecord {
    const skillsDir = this.store.getSkillsDir();
    const centralSkillPath = directChildPath(skillsDir, skillId);
    if (!fs.existsSync(centralSkillPath) || !fs.lstatSync(centralSkillPath).isDirectory()) {
      throw new Error(`找不到技能資料夾：${skillId}`);
    }

    const agent = this.store.getAllAgents().find((a) => a.key === agentKey);
    if (!agent) {
      throw new Error(`找不到指定的 AI 工具設定：${agentKey}`);
    }

    const agentDir = this.getAgentResolvedPath(agent);
    const syncMode = this.store.getSettings().syncMode;
    const usedMode = this.performSingleDeployOnDisk(
      skillId,
      centralSkillPath,
      agentKey,
      agentDir,
      syncMode
    );

    this.store.addActivityLog(
      'deploy',
      `已將技能「${skillId}」部署至 ${agent.name} (${usedMode})`,
      path.join(agentDir, skillId)
    );

    const updated = this.listCentralSkills().find((s) => s.id === skillId);
    if (!updated) throw new Error(`部署後讀取技能失敗：${skillId}`);
    return updated;
  }

  /**
   * Undeploys (removes) a single skill from a specific AI tool's personal folder.
   */
  public undeploySkillFromAgent(skillId: string, agentKey: string): SkillRecord {
    const agent = this.store.getAllAgents().find((a) => a.key === agentKey);
    if (!agent) {
      throw new Error(`找不到指定的 AI 工具設定：${agentKey}`);
    }

    const agentDir = this.getAgentResolvedPath(agent);
    const targetPath = directChildPath(agentDir, skillId);
    this.removeTargetIfExists(targetPath, directChildPath(this.store.getSkillsDir(), skillId));

    this.store.addActivityLog(
      'undeploy',
      `已從 ${agent.name} 移除技能「${skillId}」部署`,
      targetPath
    );

    const updated = this.listCentralSkills().find((s) => s.id === skillId);
    if (!updated) throw new Error(`找不到技能：${skillId}`);
    return updated;
  }

  /**
   * High-Speed Batch Deploy / Undeploy across any number of skills (e.g. 132+ skills)
   * and any selected target AI tools!
   * Does NOT call listCentralSkills() or store.save() inside the loop — completes in <50ms.
   */
  public batchDeploySkills(
    skillIds: string[],
    agentKeys: string[],
    deploy: boolean,
    autoEnableSelectedAgents = false
  ): { skills: SkillRecord[]; affectedSkills: number; affectedAgents: number } {
    const skillsDir = this.store.getSkillsDir();
    const syncMode = this.store.getSettings().syncMode;

    const allAgents = this.store.getAllAgents();
    const targetAgents = allAgents.filter((a) => agentKeys.includes(a.key));
    if (targetAgents.length === 0) {
      throw new Error('請選擇至少一款目標 AI 工具');
    }

    // Check every target before changing any deployed skill or agent setting.
    const agentDirs = new Map<string, string>();
    for (const agent of targetAgents) {
      const dir = this.getAgentResolvedPath(agent);
      agentDirs.set(agent.key, dir);
    }

    const validSkills: { skillId: string; centralSkillPath: string }[] = [];
    for (const skillId of new Set(skillIds)) {
      const centralSkillPath = directChildPath(skillsDir, skillId);
      if (!fs.existsSync(centralSkillPath) || !fs.lstatSync(centralSkillPath).isDirectory()) continue;
      validSkills.push({ skillId, centralSkillPath });

      for (const agent of targetAgents) {
        this.assertTargetRemovable(directChildPath(agentDirs.get(agent.key)!, skillId), centralSkillPath);
      }
    }

    if (autoEnableSelectedAgents && deploy) {
      const db = this.store.getDb();
      for (const aKey of agentKeys) {
        if (db.agents[aKey]) {
          db.agents[aKey].enabled = true;
        } else {
          db.agents[aKey] = { enabled: true };
        }
      }
    }

    for (const { skillId, centralSkillPath } of validSkills) {

      for (const agent of targetAgents) {
        const agentDir = agentDirs.get(agent.key)!;
        if (deploy) {
          this.performSingleDeployOnDisk(
            skillId,
            centralSkillPath,
            agent.key,
            agentDir,
            syncMode
          );
        } else {
          this.removeTargetIfExists(directChildPath(agentDir, skillId), centralSkillPath);
        }
      }
    }

    const agentNames = targetAgents.map((a) => a.name).join('、');
    this.store.addActivityLog(
      deploy ? 'deploy' : 'undeploy',
      `${deploy ? '已批次部署' : '已批次移除'} ${validSkills.length} 個技能 ${
        deploy ? '至' : '自'
      } ${targetAgents.length} 款工具 (${agentNames})`,
      undefined,
      true
    );
    this.store.save();

    return {
      skills: this.listCentralSkills(),
      affectedSkills: validSkills.length,
      affectedAgents: targetAgents.length,
    };
  }

  private assertTargetRemovable(targetPath: string, centralSkillPath: string): fs.Stats | null {
    const relative = path.relative(targetPath, centralSkillPath);
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error(`目標路徑與中央技能庫重疊，拒絕移除：${targetPath}`);
    }
    let lstat: fs.Stats;
    try {
      lstat = fs.lstatSync(targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (lstat.isSymbolicLink()) {
      if (fs.realpathSync(targetPath) !== fs.realpathSync(centralSkillPath)) {
        throw new Error(`目標連結不屬於本程式，拒絕移除：${targetPath}`);
      }
    } else if (lstat.isDirectory()) {
      const markerPath = path.join(targetPath, '.skills-manager-owned.json');
      let marker: { digestVersion?: number; skillId?: string; digest?: string };
      try {
        marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      } catch {
        throw new Error(`目標資料夾不屬於本程式，拒絕覆蓋或移除：${targetPath}`);
      }
      if (
        marker.digestVersion !== 2 ||
        marker.skillId !== path.basename(centralSkillPath) ||
        marker.digest !== computeOwnedDirectoryDigest(targetPath)
      ) {
        throw new Error(`目標資料夾已有本機修改，拒絕覆蓋或移除：${targetPath}`);
      }
    } else {
      throw new Error(`目標檔案不屬於本程式，拒絕移除：${targetPath}`);
    }
    return lstat;
  }

  private removeTargetIfExists(targetPath: string, centralSkillPath: string): void {
    const target = this.assertTargetRemovable(targetPath, centralSkillPath);
    if (target?.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
    } else if (target?.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true });
    }
  }

  /**
   * Scans the personal skills directory of a specific AI tool (or all tools)
   * to discover both managed and unmanaged/external skills residing in ~/.<agent>/skills.
   */
  public scanAgentWorkspace(agentKey?: string): ExternalAgentSkill[] {
    const agents = this.store.getAllAgents();
    const targetAgents = agentKey
      ? agents.filter((a) => a.key === agentKey)
      : agents.filter((a) => a.enabled);

    const centralSkills = this.listCentralSkills();
    const centralByDir = new Map<string, SkillRecord>(
      centralSkills.map((s) => [s.dirName, s])
    );

    const results: ExternalAgentSkill[] = [];

    for (const agent of targetAgents) {
      const dirPath = this.getAgentResolvedPath(agent);
      if (!fs.existsSync(dirPath)) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dirPath, entry.name);
        let lstat: fs.Stats;
        try {
          lstat = fs.lstatSync(fullPath);
        } catch {
          continue;
        }

        const isSymlink = lstat.isSymbolicLink();
        let realStat: fs.Stats;
        let symlinkTarget: string | undefined;
        try {
          realStat = fs.statSync(fullPath);
          if (isSymlink) {
            symlinkTarget = fs.realpathSync(fullPath);
          }
        } catch {
          continue;
        }

        if (!realStat.isDirectory()) continue;

        const meta = parseSkillMarkdownMeta(fullPath);
        const stats = computeSkillDirectoryStats(fullPath);
        const matchingCentral = centralByDir.get(entry.name);

        let managedByCentral = false;
        let inSyncWithCentral = false;

        if (matchingCentral) {
          if (isSymlink && symlinkTarget) {
            try {
              const centralReal = fs.realpathSync(matchingCentral.centralPath);
              if (path.resolve(symlinkTarget) === path.resolve(centralReal)) {
                managedByCentral = true;
                inSyncWithCentral = true;
              }
            } catch {
              // Ignore
            }
          } else {
            const deployment = this.inspectDeploymentFast(
              agent.key,
              matchingCentral.centralPath,
              matchingCentral.contentHash,
              fullPath
            );
            managedByCentral = deployment.deployed;
            inSyncWithCentral = deployment.inSync;
          }
        }

        results.push({
          agentKey: agent.key,
          agentName: agent.name,
          dirName: entry.name,
          name: meta.name || entry.name,
          description: meta.description,
          fullPath,
          isSymlink,
          symlinkTarget,
          managedByCentral,
          centralSkillId: matchingCentral?.id,
          inSyncWithCentral,
          fileCount: stats.fileCount,
          updatedAt: realStat.mtime.toISOString(),
        });
      }
    }

    return results;
  }

  /**
   * Adopts (納管匯入) an unmanaged skill currently living in an AI tool's personal folder
   * into the central library (~/.skills-manager/skills/<dirName>) and links it back!
   */
  public adoptExternalSkill(agentKey: string, dirName: string): SkillRecord {
    const agent = this.store.getAllAgents().find((a) => a.key === agentKey);
    if (!agent) throw new Error(`找不到 AI 工具：${agentKey}`);

    const agentDir = this.getAgentResolvedPath(agent);
    const sourcePath = directChildPath(agentDir, dirName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`在 ${agent.name} 資料夾中找不到技能：${dirName}`);
    }

    const skillsDir = this.store.getSkillsDir();
    const centralTarget = directChildPath(skillsDir, dirName);

    const realSource = fs.realpathSync(sourcePath);
    if (fs.existsSync(centralTarget)) {
      throw new Error(`中央技能庫已有同名技能，請先處理名稱衝突：${dirName}`);
    }
    fs.cpSync(realSource, centralTarget, { recursive: true });
    invalidateSkillCache(centralTarget);

    const meta = parseSkillMarkdownMeta(centralTarget);
    const now = new Date().toISOString();
    const db = this.store.getDb();
    db.skills[dirName] = {
      id: dirName,
      name: meta.name || dirName,
      description: meta.description,
      sourceType: 'adopted',
      sourceLabel: `由 ${agent.name} 個人資料夾納管匯入`,
      tags: [agent.key],
      createdAt: now,
      updatedAt: now,
    };
    this.store.save();

    this.store.addActivityLog(
      'adopt',
      `已從 ${agent.name} 納管匯入技能「${dirName}」至中央儲存庫`,
      sourcePath
    );

    const adopted = this.listCentralSkills().find((skill) => skill.id === dirName);
    if (!adopted) throw new Error(`納管後讀取技能失敗：${dirName}`);
    return adopted;
  }

  /**
   * Creates a new skill directly in the central library from markdown/name/description.
   */
  public createManualSkill(input: {
    dirName: string;
    name: string;
    description: string;
    tags: string[];
    markdownBody?: string;
  }): SkillRecord {
    const slug = input.dirName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) throw new Error('請輸入有效的技能資料夾名稱 (英數與連字號)');

    const centralPath = path.join(this.store.getSkillsDir(), slug);
    if (fs.existsSync(centralPath)) {
      throw new Error(`技能「${slug}」已存在於中央儲存庫`);
    }

    fs.mkdirSync(centralPath, { recursive: true });
    const skillMd = `---
name: ${input.name.trim() || slug}
description: ${input.description.trim() || '自訂本機 AI Agent 技能'}
---
${input.markdownBody?.trim() || `# ${input.name.trim() || slug}

在此編寫此 AI Agent 技能的詳細執行指令與規範。`}
`;
    fs.writeFileSync(path.join(centralPath, 'SKILL.md'), skillMd, 'utf-8');
    invalidateSkillCache(centralPath);

    const now = new Date().toISOString();
    const db = this.store.getDb();
    db.skills[slug] = {
      id: slug,
      name: input.name.trim() || slug,
      description: input.description.trim() || '自訂本機 AI Agent 技能',
      sourceType: 'manual',
      sourceLabel: '手動建立',
      tags: input.tags || [],
      createdAt: now,
      updatedAt: now,
    };
    this.store.save();

    this.store.addActivityLog('import-folder', `已建立新技能「${slug}」`, centralPath);
    const created = this.listCentralSkills().find((s) => s.id === slug);
    if (!created) throw new Error('建立技能後讀取失敗');
    return created;
  }

  /**
   * Updates tags or SKILL.md content for an existing skill in the central library.
   */
  public updateSkillContentAndMeta(
    skillId: string,
    updates: {
      tags?: string[];
      skillMarkdownContent?: string;
    }
  ): SkillRecord {
    const centralPath = directChildPath(this.store.getSkillsDir(), skillId);
    if (!fs.existsSync(centralPath)) {
      throw new Error(`找不到技能：${skillId}`);
    }

    if (typeof updates.skillMarkdownContent === 'string') {
      fs.writeFileSync(
        path.join(centralPath, 'SKILL.md'),
        updates.skillMarkdownContent,
        'utf-8'
      );
      invalidateSkillCache(centralPath);
    }

    const meta = parseSkillMarkdownMeta(centralPath);
    const db = this.store.getDb();
    const existing = db.skills[skillId];
    if (existing) {
      existing.name = meta.name || skillId;
      existing.description = meta.description;
      if (updates.tags) {
        existing.tags = Array.from(new Set(updates.tags.map((t) => t.trim()).filter(Boolean)));
      }
      existing.updatedAt = new Date().toISOString();
      this.store.save();
    }

    const currentRecord = this.listCentralSkills().find((s) => s.id === skillId);
    if (currentRecord && typeof updates.skillMarkdownContent === 'string') {
      const copyAgentKeys = Object.entries(currentRecord.deployments)
        .filter(([, dep]) => dep.deployed && dep.mode === 'copy')
        .map(([k]) => k);
      if (copyAgentKeys.length > 0) {
        this.batchDeploySkills([skillId], copyAgentKeys, true);
      }
    }

    return this.listCentralSkills().find((s) => s.id === skillId)!;
  }

  /**
   * Reads the full SKILL.md content and file list of a central skill.
   */
  public getSkillDetails(skillId: string): {
    skill: SkillRecord;
    markdownContent: string;
    files: { relativePath: string; sizeBytes: number }[];
  } {
    const skill = this.listCentralSkills().find((s) => s.id === skillId);
    if (!skill) throw new Error(`找不到技能：${skillId}`);

    const mdPath = path.join(skill.centralPath, 'SKILL.md');
    let markdownContent = '';
    if (fs.existsSync(mdPath)) {
      markdownContent = fs.readFileSync(mdPath, 'utf-8');
    } else if (fs.existsSync(path.join(skill.centralPath, 'README.md'))) {
      markdownContent = fs.readFileSync(path.join(skill.centralPath, 'README.md'), 'utf-8');
    }

    const files: { relativePath: string; sizeBytes: number }[] = [];
    function walk(dir: string, prefix: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '__pycache__') {
          continue;
        }
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const stat = fs.lstatSync(full);
        if (stat.isDirectory()) {
          walk(full, rel);
        } else if (stat.isFile()) {
          files.push({ relativePath: rel, sizeBytes: stat.size });
        }
      }
    }
    walk(skill.centralPath, '');

    return { skill, markdownContent, files };
  }

  /**
   * Deletes one or more skills from the central library and undeploys them from all agents.
   */
  public deleteSkills(skillIds: string[]): void {
    const agents = this.store.getAllAgents();
    const db = this.store.getDb();

    const targets: { skillId: string; centralPath: string }[] = [];
    for (const skillId of new Set(skillIds)) {
      const centralPath = directChildPath(this.store.getSkillsDir(), skillId);
      if (!fs.existsSync(centralPath) || !fs.lstatSync(centralPath).isDirectory()) {
        throw new Error(`找不到中央技能資料夾：${skillId}`);
      }
      targets.push({ skillId, centralPath });
      for (const agent of agents) {
        const targetPath = directChildPath(this.getAgentResolvedPath(agent), skillId);
        this.assertTargetRemovable(targetPath, centralPath);
      }
    }

    for (const { skillId, centralPath } of targets) {
      for (const agent of agents) {
        const targetPath = directChildPath(this.getAgentResolvedPath(agent), skillId);
        this.removeTargetIfExists(targetPath, centralPath);
      }
      fs.rmSync(centralPath, { recursive: true });
      invalidateSkillCache(centralPath);
      delete db.skills[skillId];

      for (const preset of db.presets) {
        preset.skillIds = preset.skillIds.filter((id) => id !== skillId);
      }
    }

    this.store.addActivityLog(
      'delete',
      `已從中央儲存庫與所有工具刪除 ${targets.length} 個技能`,
      skillIds.join(', '),
      true
    );
    this.store.save();
  }

  /**
   * Applies or unapplies a Preset across specified or currently enabled AI tools in a single fast pass.
   */
  public applyPreset(
    presetId: string,
    deploy: boolean,
    targetAgentKeys?: string[]
  ): Preset[] {
    const db = this.store.getDb();
    const preset = db.presets.find((p) => p.id === presetId);
    if (!preset) throw new Error(`找不到預設組合：${presetId}`);

    const agentKeysToUse =
      Array.isArray(targetAgentKeys) && targetAgentKeys.length > 0
        ? targetAgentKeys
        : this.store
            .getAllAgents()
            .filter((a) => a.enabled)
            .map((a) => a.key);

    if (agentKeysToUse.length === 0) {
      throw new Error('目前沒有已啟用的 AI 工具可供部署場景');
    }

    this.batchDeploySkills(preset.skillIds, agentKeysToUse, deploy, true);

    preset.active = deploy;
    preset.updatedAt = new Date().toISOString();
    this.store.addActivityLog(
      'preset-apply',
      `${deploy ? '已啟用並部署' : '已取消部署'}預設場景「${preset.name}」(${preset.skillIds.length} 個技能)`,
      undefined,
      true
    );
    this.store.save();
    return db.presets;
  }

  /**
   * Reads the full SKILL.md content and file list directly from a skill folder
   * inside an AI tool's personal directory (works for both managed and unmanaged external skills!).
   */
  public getExternalAgentSkillDetails(
    agentKey: string,
    dirName: string
  ): {
    item: ExternalAgentSkill;
    markdownContent: string;
    files: { relativePath: string; sizeBytes: number }[];
  } {
    const items = this.scanAgentWorkspace(agentKey);
    const item = items.find((i) => i.dirName === dirName && i.agentKey === agentKey);
    if (!item) {
      throw new Error(`在 ${agentKey} 的個人資料夾中找不到技能「${dirName}」`);
    }

    const candidates = ['SKILL.md', 'skill.md', 'README.md', 'readme.md'];
    let markdownContent = '';
    for (const c of candidates) {
      const p = path.join(item.fullPath, c);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        markdownContent = fs.readFileSync(p, 'utf-8');
        break;
      }
    }

    const files: { relativePath: string; sizeBytes: number }[] = [];
    function walk(dir: string, prefix: string) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (
          entry.name === '.git' ||
          entry.name === 'node_modules' ||
          entry.name === '__pycache__' ||
          entry.name === '.skills-manager-owned.json'
        ) {
          continue;
        }
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        try {
          const stat = fs.lstatSync(full);
          if (stat.isDirectory()) {
            walk(full, rel);
          } else if (stat.isFile()) {
            files.push({ relativePath: rel, sizeBytes: stat.size });
          }
        } catch {
          continue;
        }
      }
    }
    walk(item.fullPath, '');

    return { item, markdownContent, files };
  }

  /**
   * Saves updated SKILL.md content directly to a skill inside an AI tool's personal directory.
   */
  public updateExternalAgentSkillContent(
    agentKey: string,
    dirName: string,
    markdownContent: string
  ): { item: ExternalAgentSkill; markdownContent: string } {
    const agent = this.store.getAllAgents().find((a) => a.key === agentKey);
    if (!agent) throw new Error(`找不到 AI 工具：${agentKey}`);

    const skillPath = path.join(this.getAgentResolvedPath(agent), path.basename(dirName));
    if (!fs.existsSync(skillPath)) {
      throw new Error(`找不到技能資料夾：${skillPath}`);
    }

    fs.writeFileSync(path.join(skillPath, 'SKILL.md'), markdownContent, 'utf-8');
    invalidateSkillCache(skillPath);

    // If it's a symlink to central, also invalidate central cache
    const centralPath = path.join(this.store.getSkillsDir(), path.basename(dirName));
    if (fs.existsSync(centralPath)) {
      invalidateSkillCache(centralPath);
    }

    this.store.addActivityLog(
      'settings',
      `已更新 ${agent.name} 個人資料夾中技能「${dirName}」的 SKILL.md 內容`,
      skillPath
    );

    const refreshed = this.getExternalAgentSkillDetails(agentKey, dirName);
    return { item: refreshed.item, markdownContent: refreshed.markdownContent };
  }
}
