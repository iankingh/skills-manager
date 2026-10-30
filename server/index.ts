import express, { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { LocalStore } from './store.js';
import { SkillManager } from './skillManager.js';
import { SubagentManager } from './subagentManager.js';
import { McpManager } from './mcpManager.js';
import { ZipAndFolderService } from './zipService.js';
import {
  SystemTrayService,
  openFolderInOSFileManager,
  openUrlInLocalBrowser,
} from './trayService.js';
import { expandHomePath, compactHomePath } from './agentRegistry.js';
import { isTrustedLocalRequest } from './localRequest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new LocalStore();
const skillManager = new SkillManager(store);
const subagentManager = new SubagentManager(store);
const mcpManager = new McpManager(store);
const zipService = new ZipAndFolderService(store, skillManager);

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,
    files: 2000,
  },
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!isTrustedLocalRequest(req.headers)) {
    res.status(403).json({ ok: false, message: '僅允許從本機頁面存取服務' });
    return;
  }
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*;"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Offline-Mode', 'strict-local-only');
  next();
});

app.use(express.json({ limit: '50mb' }));

const activePort = Number(process.env.PORT) || store.getSettings().port || 3847;
const getServerUrl = () => `http://127.0.0.1:${activePort}`;
const trayService = new SystemTrayService(store, skillManager, zipService, getServerUrl);

function mapAgentsWithResolvedPaths() {
  return store.getAllAgents().map((a) => {
    const resolvedPath = skillManager.getAgentResolvedPath(a);
    const resolvedAgentPath = subagentManager.getAgentSubagentsResolvedPath(a);
    const resolvedMcpPath = mcpManager.getAgentMcpConfigPath(a);
    return {
      ...a,
      resolvedPath,
      compactPath: compactHomePath(resolvedPath),
      folderExists: fs.existsSync(resolvedPath),
      resolvedAgentPath,
      compactAgentPath: compactHomePath(resolvedAgentPath),
      agentFolderExists: fs.existsSync(resolvedAgentPath),
      resolvedMcpPath,
      compactMcpPath: compactHomePath(resolvedMcpPath),
      mcpFileExists: fs.existsSync(resolvedMcpPath),
    };
  });
}

// ==================== Overview ====================
app.get('/api/overview', (_req: Request, res: Response) => {
  const skills = skillManager.listCentralSkills();
  const subagents = subagentManager.listCentralSubagents();
  const mcpServers = mcpManager.listCentralMcpServers();
  const agents = mapAgentsWithResolvedPaths();
  const db = store.getDb();

  res.json({
    ok: true,
    offlineMode: true,
    version: '2.0.0-offline',
    platform: process.platform,
    homedir: os.homedir(),
    centralRepoPath: store.getBaseDir(),
    compactCentralRepoPath: compactHomePath(store.getBaseDir()),
    trayStatus: trayService.getStatus(),
    settings: db.settings,
    agents,
    skills,
    subagents,
    mcpServers,
    presets: db.presets,
    snapshots: zipService.listLocalSnapshots(),
    activityLogs: db.activityLogs.slice(0, 100),
  });
});

// ==================== 1. AI Skills API ====================
app.get('/api/skills/:id', (req: Request, res: Response) => {
  try {
    const detail = skillManager.getSkillDetails(String(req.params.id));
    res.json({ ok: true, ...detail });
  } catch (err: any) {
    res.status(404).json({ ok: false, message: err.message });
  }
});

app.post('/api/skills/create', (req: Request, res: Response) => {
  try {
    const skill = skillManager.createManualSkill(req.body);
    res.json({ ok: true, skill });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.put('/api/skills/:id', (req: Request, res: Response) => {
  try {
    const skill = skillManager.updateSkillContentAndMeta(String(req.params.id), req.body);
    res.json({ ok: true, skill });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/skills/delete', (req: Request, res: Response) => {
  try {
    const ids: string[] = Array.isArray(req.body.skillIds) ? req.body.skillIds : [];
    skillManager.deleteSkills(ids);
    res.json({ ok: true, skills: skillManager.listCentralSkills() });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/skills/:id/deploy', (req: Request, res: Response) => {
  try {
    const { agentKey, deploy } = req.body;
    const skillId = String(req.params.id);
    const skill = deploy
      ? skillManager.deploySkillToAgent(skillId, agentKey)
      : skillManager.undeploySkillFromAgent(skillId, agentKey);
    res.json({ ok: true, skill });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/skills/batch-deploy', (req: Request, res: Response) => {
  try {
    const { skillIds, agentKeys, deploy, autoEnableAgents } = req.body;
    const result = skillManager.batchDeploySkills(
      skillIds || [],
      agentKeys || [],
      Boolean(deploy),
      Boolean(autoEnableAgents)
    );
    res.json({
      ok: true,
      ...result,
      agents: mapAgentsWithResolvedPaths(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/skills/import-zip', upload.array('files', 20), (req: Request, res: Response) => {
  try {
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    if (uploadedFiles.length === 0) {
      res.status(400).json({ ok: false, message: '請選擇至少一個 .zip 或 .skill 壓縮檔' });
      return;
    }
    let totalImported = 0;
    for (const file of uploadedFiles) {
      const result = zipService.importFromZipBuffer(file.buffer, file.originalname, true);
      totalImported += result.count;
    }
    res.json({
      ok: true,
      importedCount: totalImported,
      skills: skillManager.listCentralSkills(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/skills/import-folder-upload', upload.array('files', 2000), (req: Request, res: Response) => {
  try {
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    const relativePaths: string[] = req.body.relativePaths
      ? JSON.parse(req.body.relativePaths)
      : uploadedFiles.map((f) => f.originalname);
    const folderName = req.body.folderName || 'uploaded-folder';
    const mapped = uploadedFiles.map((file, idx) => ({
      relativePath: relativePaths[idx] || file.originalname,
      buffer: file.buffer,
    }));
    const result = zipService.importFromUploadedFolderFiles(mapped, folderName);
    res.json({
      ok: true,
      importedCount: result.count,
      skills: skillManager.listCentralSkills(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/skills/import-local-path', (req: Request, res: Response) => {
  try {
    const { folderPath } = req.body;
    const result = zipService.importFromLocalDirectory(folderPath, true);
    res.json({
      ok: true,
      importedCount: result.count,
      skills: skillManager.listCentralSkills(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.get('/api/skills/:id/download-zip', async (req: Request, res: Response) => {
  try {
    const skillId = String(req.params.id);
    await zipService.streamSkillsAsZip([skillId], `${skillId}.zip`, res);
  } catch (err: any) {
    res.status(404).json({ ok: false, message: err.message });
  }
});

app.post('/api/skills/export-zip', async (req: Request, res: Response) => {
  try {
    const skillIds: string[] =
      Array.isArray(req.body.skillIds) && req.body.skillIds.length > 0
        ? req.body.skillIds
        : skillManager.listCentralSkills().map((s) => s.id);
    const filename = req.body.filename || `skills-export-${new Date().toISOString().slice(0, 10)}.zip`;
    await zipService.streamSkillsAsZip(skillIds, filename, res);
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// ==================== 2. AI Agents (Subagents) API ====================
app.get('/api/subagents', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    subagents: subagentManager.listCentralSubagents(),
    externalSubagents: subagentManager.scanExternalSubagents(),
  });
});

app.get('/api/subagents/workspace', (req: Request, res: Response) => {
  const agentKey = typeof req.query.agentKey === 'string' ? req.query.agentKey : undefined;
  res.json({
    ok: true,
    items: subagentManager.scanExternalSubagents(agentKey),
  });
});

app.get('/api/subagents/workspace/:agentKey/:fileName', (req: Request, res: Response) => {
  try {
    const resData = subagentManager.getExternalSubagentContent(
      String(req.params.agentKey),
      String(req.params.fileName)
    );
    res.json({ ok: true, ...resData });
  } catch (err: any) {
    res.status(404).json({ ok: false, message: err.message });
  }
});

app.put('/api/subagents/workspace/:agentKey/:fileName', (req: Request, res: Response) => {
  try {
    const resData = subagentManager.updateExternalSubagentContent(
      String(req.params.agentKey),
      String(req.params.fileName),
      String(req.body.markdownContent || '')
    );
    res.json({
      ok: true,
      ...resData,
      subagents: subagentManager.listCentralSubagents(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/subagents/adopt', (req: Request, res: Response) => {
  try {
    const { agentKey, fileName } = req.body;
    const subagents = subagentManager.adoptExternalSubagent(agentKey, fileName);
    res.json({
      ok: true,
      subagents,
      externalSubagents: subagentManager.scanExternalSubagents(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.get('/api/subagents/:id', (req: Request, res: Response) => {
  try {
    const detail = subagentManager.getSubagentDetails(String(req.params.id));
    res.json({ ok: true, ...detail });
  } catch (err: any) {
    res.status(404).json({ ok: false, message: err.message });
  }
});

app.post('/api/subagents/create', (req: Request, res: Response) => {
  try {
    const subagent = subagentManager.createSubagent(req.body);
    res.json({
      ok: true,
      subagent,
      subagents: subagentManager.listCentralSubagents(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.put('/api/subagents/:id', (req: Request, res: Response) => {
  try {
    const subagent = subagentManager.updateSubagent(String(req.params.id), req.body);
    res.json({
      ok: true,
      subagent,
      subagents: subagentManager.listCentralSubagents(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/subagents/delete', (req: Request, res: Response) => {
  try {
    const ids: string[] = Array.isArray(req.body.ids) ? req.body.ids : [];
    const subagents = subagentManager.deleteSubagents(ids);
    res.json({ ok: true, subagents });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/subagents/batch-deploy', (req: Request, res: Response) => {
  try {
    const { subagentIds, agentKeys, deploy } = req.body;
    const result = subagentManager.batchDeploySubagents(
      subagentIds || [],
      agentKeys || [],
      Boolean(deploy)
    );
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/subagents/import-zip', upload.array('files', 20), (req: Request, res: Response) => {
  try {
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    let total = 0;
    for (const file of uploadedFiles) {
      const r = subagentManager.importSubagentsFromZipBuffer(file.buffer, file.originalname);
      total += r.count;
    }
    res.json({
      ok: true,
      importedCount: total,
      subagents: subagentManager.listCentralSubagents(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/subagents/import-local-path', (req: Request, res: Response) => {
  try {
    const result = subagentManager.importSubagentsFromLocalPath(String(req.body.localPath || ''));
    res.json({
      ok: true,
      importedCount: result.count,
      subagents: result.subagents,
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/subagents/export-zip', async (req: Request, res: Response) => {
  try {
    const ids: string[] = Array.isArray(req.body.ids) ? req.body.ids : [];
    const filename = req.body.filename || `ai-agents-export-${new Date().toISOString().slice(0, 10)}.zip`;
    await subagentManager.streamSubagentsAsZip(ids, filename, res);
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// ==================== 3. MCP (Model Context Protocol) API ====================
app.get('/api/mcp', (req: Request, res: Response) => {
  const agentKey = typeof req.query.agentKey === 'string' ? req.query.agentKey : undefined;
  res.json({
    ok: true,
    mcpServers: mcpManager.listCentralMcpServers(),
    externalMcp: mcpManager.scanExternalMcpServers(agentKey),
  });
});

app.post('/api/mcp/upsert', (req: Request, res: Response) => {
  try {
    const mcpServers = mcpManager.upsertMcpServer(req.body);
    res.json({ ok: true, mcpServers });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/mcp/delete', (req: Request, res: Response) => {
  try {
    const ids: string[] = Array.isArray(req.body.ids) ? req.body.ids : [];
    const mcpServers = mcpManager.deleteMcpServers(ids);
    res.json({ ok: true, mcpServers });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/mcp/batch-deploy', (req: Request, res: Response) => {
  try {
    const { serverIds, agentKeys, deploy } = req.body;
    const result = mcpManager.batchDeployMcpServers(
      serverIds || [],
      agentKeys || [],
      Boolean(deploy)
    );
    res.json({
      ok: true,
      ...result,
      externalMcp: mcpManager.scanExternalMcpServers(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/mcp/adopt', (req: Request, res: Response) => {
  try {
    const { agentKey, serverId } = req.body;
    const mcpServers = mcpManager.adoptExternalMcpServer(agentKey, serverId);
    res.json({
      ok: true,
      mcpServers,
      externalMcp: mcpManager.scanExternalMcpServers(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.get('/api/mcp/raw-config/:agentKey', (req: Request, res: Response) => {
  try {
    const data = mcpManager.getRawConfigFile(String(req.params.agentKey));
    res.json({ ok: true, ...data });
  } catch (err: any) {
    res.status(404).json({ ok: false, message: err.message });
  }
});

app.put('/api/mcp/raw-config/:agentKey', (req: Request, res: Response) => {
  try {
    mcpManager.saveRawConfigFile(String(req.params.agentKey), String(req.body.content || ''));
    res.json({
      ok: true,
      mcpServers: mcpManager.listCentralMcpServers(),
      externalMcp: mcpManager.scanExternalMcpServers(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/mcp/import', upload.array('files', 10), (req: Request, res: Response) => {
  try {
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    let total = 0;
    for (const file of uploadedFiles) {
      const r = mcpManager.importMcpFromBuffer(file.buffer, file.originalname);
      total += r.count;
    }
    res.json({
      ok: true,
      importedCount: total,
      mcpServers: mcpManager.listCentralMcpServers(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/mcp/:id/test', async (req: Request, res: Response) => {
  try {
    const result = await mcpManager.testMcpServerConnection(String(req.params.id));
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/seeds/sync', (req: Request, res: Response) => {
  try {
    const overwrite = Boolean(req.body?.overwrite);
    const synced = store.syncProjectSeeds(overwrite);
    res.json({
      ok: true,
      ...synced,
      skills: skillManager.listCentralSkills(),
      subagents: subagentManager.listCentralSubagents(),
      mcpServers: mcpManager.listCentralMcpServers(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/mcp/export-zip', async (req: Request, res: Response) => {
  try {
    const ids: string[] = Array.isArray(req.body.ids) ? req.body.ids : [];
    const filename = req.body.filename || `mcp-servers-export-${new Date().toISOString().slice(0, 10)}.zip`;
    await mcpManager.streamMcpAsZip(ids, filename, res);
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// ==================== Workspace & Agents Settings ====================
app.get('/api/agents/workspace', (req: Request, res: Response) => {
  try {
    const agentKey = typeof req.query.agentKey === 'string' ? req.query.agentKey : undefined;
    const items = skillManager.scanAgentWorkspace(agentKey);
    res.json({ ok: true, items });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.get('/api/agents/workspace/:agentKey/:dirName', (req: Request, res: Response) => {
  try {
    const detail = skillManager.getExternalAgentSkillDetails(
      String(req.params.agentKey),
      String(req.params.dirName)
    );
    res.json({ ok: true, ...detail });
  } catch (err: any) {
    res.status(404).json({ ok: false, message: err.message });
  }
});

app.put('/api/agents/workspace/:agentKey/:dirName', (req: Request, res: Response) => {
  try {
    const result = skillManager.updateExternalAgentSkillContent(
      String(req.params.agentKey),
      String(req.params.dirName),
      String(req.body.markdownContent || '')
    );
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/agents/adopt', (req: Request, res: Response) => {
  try {
    const { agentKey, dirName } = req.body;
    const skill = skillManager.adoptExternalSkill(agentKey, dirName);
    res.json({
      ok: true,
      skill,
      skills: skillManager.listCentralSkills(),
      workspaceItems: skillManager.scanAgentWorkspace(agentKey),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.put('/api/agents/:key', (req: Request, res: Response) => {
  try {
    store.updateAgent(String(req.params.key), req.body);
    res.json({ ok: true, agents: mapAgentsWithResolvedPaths() });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/agents/custom', (req: Request, res: Response) => {
  try {
    store.addCustomAgent(req.body);
    res.json({ ok: true, agents: mapAgentsWithResolvedPaths() });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.delete('/api/agents/custom/:key', (req: Request, res: Response) => {
  try {
    store.removeCustomAgent(String(req.params.key));
    res.json({ ok: true, agents: mapAgentsWithResolvedPaths() });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// ==================== Presets, Snapshots & FS ====================
app.post('/api/presets', (req: Request, res: Response) => {
  try {
    const { name, description, skillIds } = req.body;
    const db = store.getDb();
    const now = new Date().toISOString();
    const preset = {
      id: `preset_${Date.now()}`,
      name: (name || '新場景組合').trim(),
      description: (description || '').trim(),
      icon: 'Layers',
      skillIds: Array.isArray(skillIds) ? skillIds : [],
      active: false,
      createdAt: now,
      updatedAt: now,
    };
    db.presets.push(preset);
    store.save();
    res.json({ ok: true, presets: db.presets });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/presets/:id/apply', (req: Request, res: Response) => {
  try {
    const deploy = req.body.deploy !== false;
    const presets = skillManager.applyPreset(String(req.params.id), deploy);
    res.json({
      ok: true,
      presets,
      skills: skillManager.listCentralSkills(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/snapshots', (req: Request, res: Response) => {
  try {
    const snapshot = zipService.createLocalSnapshot(req.body.note || '手動建立本機備份快照');
    res.json({ ok: true, snapshot, snapshots: zipService.listLocalSnapshots() });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/snapshots/:filename/restore', (req: Request, res: Response) => {
  try {
    const result = zipService.restoreLocalSnapshot(String(req.params.filename));
    res.json({
      ok: true,
      ...result,
      skills: skillManager.listCentralSkills(),
      snapshots: zipService.listLocalSnapshots(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.get('/api/snapshots/:filename/download', (req: Request, res: Response) => {
  const filename = path.basename(String(req.params.filename));
  const filePath = path.join(store.getBackupsDir(), filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ ok: false, message: '找不到備份檔案' });
    return;
  }
  res.download(filePath, filename);
});

app.delete('/api/snapshots/:filename', (req: Request, res: Response) => {
  zipService.deleteLocalSnapshot(String(req.params.filename));
  res.json({ ok: true, snapshots: zipService.listLocalSnapshots() });
});

app.put('/api/settings', async (req: Request, res: Response) => {
  try {
    const settings = store.updateSettings(req.body);
    if (req.body.trayEnabled === true) {
      await trayService.startTray();
    } else if (req.body.trayEnabled === false) {
      trayService.stopTray();
    }
    res.json({ ok: true, settings, trayStatus: trayService.getStatus() });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.get('/api/fs/browse', (req: Request, res: Response) => {
  try {
    const requested =
      typeof req.query.dir === 'string' && req.query.dir.trim()
        ? expandHomePath(req.query.dir.trim())
        : os.homedir();
    const targetDir =
      fs.existsSync(requested) && fs.statSync(requested).isDirectory()
        ? requested
        : os.homedir();

    const parentDir = path.dirname(targetDir);
    const entries = fs
      .readdirSync(targetDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const full = path.join(targetDir, e.name);
        const hasSkillMd =
          fs.existsSync(path.join(full, 'SKILL.md')) ||
          fs.existsSync(path.join(full, 'skill.md'));
        return {
          name: e.name,
          fullPath: full,
          compactPath: compactHomePath(full),
          hasSkillMd,
        };
      })
      .sort((a, b) => {
        if (a.name.startsWith('.') !== b.name.startsWith('.')) {
          return a.name.startsWith('.') ? 1 : -1;
        }
        return a.name.localeCompare(b.name);
      });

    res.json({
      ok: true,
      currentDir: targetDir,
      compactCurrentDir: compactHomePath(targetDir),
      parentDir: parentDir !== targetDir ? parentDir : null,
      directories: entries,
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/fs/open-in-os', (req: Request, res: Response) => {
  try {
    const target = expandHomePath(req.body.path || store.getSkillsDir());
    const dirToOpen =
      fs.existsSync(target) && fs.statSync(target).isFile()
        ? path.dirname(target)
        : target;
    fs.mkdirSync(dirToOpen, { recursive: true });
    openFolderInOSFileManager(dirToOpen);
    res.json({ ok: true, opened: dirToOpen });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

const distDir = path.resolve(__dirname, '../../dist');
const altDistDir = path.resolve(__dirname, '../dist');
const staticRoot = fs.existsSync(distDir) ? distDir : fs.existsSync(altDistDir) ? altDistDir : null;

if (staticRoot) {
  app.use(express.static(staticRoot));
  app.get('/{*splat}', (req: Request, res: Response) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(staticRoot, 'index.html'));
    }
  });
}

const server = app.listen(activePort, '127.0.0.1', async () => {
  console.log('==============================================================');
  console.log('  Skills & Agents & MCP Manager — 本機離線服務 + System Tray');
  console.log(`  本機服務位址 : http://127.0.0.1:${activePort} (嚴格限制本機連線)`);
  console.log(`  中央技能庫   : ${store.getSkillsDir()}`);
  console.log(`  中央 Agent庫 : ${store.getSubagentsDir()}`);
  console.log('==============================================================');

  await trayService.startTray();

  if (store.getSettings().openBrowserOnStart || process.argv.includes('--open')) {
    openUrlInLocalBrowser(getServerUrl());
  }
});

server.on('error', (err) => {
  console.error(`[Server Error] 無法啟動本機服務 (127.0.0.1:${activePort}):`, err);
  process.exitCode = 1;
});

// Prevent any non-fatal System Tray spawn error (e.g. macOS EACCES / headless Linux) from crashing the HTTP server
process.on('uncaughtException', (err: any) => {
  const msg = String(err?.message || err || '');
  const pathStr = String(err?.path || '');
  if (msg.includes('tray_') || msg.includes('node-systray') || pathStr.includes('tray_')) {
    console.log(`[SystemTray] 已攔截系統匣權限例外 (${msg})，Node.js 本機服務 (127.0.0.1:${activePort}) 繼續正常運行`);
    return;
  }
  console.error('[Server Error] Uncaught Exception:', err);
  process.exitCode = 1;
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[Server Warning] Unhandled Rejection:', reason);
});

process.on('SIGINT', () => {
  trayService.stopTray();
  server.close(() => process.exit(0));
});
