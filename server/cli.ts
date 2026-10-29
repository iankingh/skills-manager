#!/usr/bin/env node
/**
 * Offline CLI for Skills Manager (shares the exact same Node.js local core as the Web UI & System Tray).
 * Usage:
 *   npm run cli -- skills list
 *   npm run cli -- skills import-zip ./my-skill.zip
 *   npm run cli -- skills import-dir ./my-skill-folder
 *   npm run cli -- skills deploy <skill-id> --agent claude_code
 *   npm run cli -- skills undeploy <skill-id> --agent claude_code
 *   npm run cli -- skills adopt <agent-key> <dir-name>
 *   npm run cli -- agents list
 */
import fs from 'node:fs';
import path from 'node:path';
import { LocalStore } from './store.js';
import { SkillManager } from './skillManager.js';
import { ZipAndFolderService } from './zipService.js';
import { compactHomePath } from './agentRegistry.js';

const store = new LocalStore();
const skillManager = new SkillManager(store);
const zipService = new ZipAndFolderService(store, skillManager);

const args = process.argv.slice(2);
const group = args[0];
const sub = args[1];

function printHelp() {
  console.log(`
Skills Manager CLI (100% 離線本機版)
中央儲存庫: ${store.getSkillsDir()}

指令列表:
  skills list                                列出中央儲存庫所有技能與各工具部署狀態
  skills import-zip <path-to.zip>            從本機 ZIP / .skill 壓縮檔匯入技能
  skills import-dir <path-to-folder>         從本機資料夾匯入技能
  skills deploy <skill-id> <agent-key>       將技能部署至指定 AI 工具的個人資料夾
  skills undeploy <skill-id> <agent-key>     從指定 AI 工具移除技能部署
  skills adopt <agent-key> <dir-name>        將 AI 工具個人資料夾中的現有技能納管匯入中央庫
  agents list                                列出所有支援的 AI 工具與個人資料夾對應路徑
  snapshots create [note]                    建立本機離線 ZIP 備份快照
`);
}

if (!group || group === '--help' || group === '-h') {
  printHelp();
  process.exit(0);
}

if (group === 'skills') {
  if (sub === 'list' || !sub) {
    const skills = skillManager.listCentralSkills();
    console.table(
      skills.map((s) => ({
        ID: s.id,
        名稱: s.name,
        來源: s.sourceType,
        檔案數: s.fileCount,
        已部署工具: Object.values(s.deployments)
          .filter((d) => d.deployed)
          .map((d) => d.agentKey)
          .join(', ') || '(無)',
      }))
    );
  } else if (sub === 'import-zip') {
    const target = args[2];
    if (!target || !fs.existsSync(target)) {
      console.error('請提供有效的 ZIP 檔案路徑');
      process.exit(1);
    }
    const buf = fs.readFileSync(target);
    const res = zipService.importFromZipBuffer(buf, path.basename(target), true);
    console.log(`成功匯入 ${res.count} 個技能:`, res.importedSkills.map((s) => s.id).join(', '));
  } else if (sub === 'import-dir') {
    const target = args[2];
    if (!target) {
      console.error('請提供有效的本機資料夾路徑');
      process.exit(1);
    }
    const res = zipService.importFromLocalDirectory(target, true);
    console.log(`成功匯入 ${res.count} 個技能:`, res.importedSkills.map((s) => s.id).join(', '));
  } else if (sub === 'deploy') {
    const skillId = args[2];
    const agentKey = args[3];
    const res = skillManager.deploySkillToAgent(skillId, agentKey);
    console.log(`已部署 ${res.id} 至 ${agentKey}`);
  } else if (sub === 'undeploy') {
    const skillId = args[2];
    const agentKey = args[3];
    const res = skillManager.undeploySkillFromAgent(skillId, agentKey);
    console.log(`已從 ${agentKey} 移除 ${res.id}`);
  } else if (sub === 'adopt') {
    const agentKey = args[2];
    const dirName = args[3];
    const res = skillManager.adoptExternalSkill(agentKey, dirName);
    console.log(`已納管匯入並同步技能: ${res.id}`);
  } else {
    printHelp();
  }
} else if (group === 'agents') {
  const agents = store.getAllAgents();
  console.table(
    agents.map((a) => ({
      Key: a.key,
      名稱: a.name,
      啟用: a.enabled ? '✓' : '-',
      個人資料夾路徑: compactHomePath(skillManager.getAgentResolvedPath(a)),
    }))
  );
} else if (group === 'snapshots') {
  const snap = zipService.createLocalSnapshot(args[2] || 'CLI 建立本機快照');
  console.log(`已建立本機快照: ${snap.filePath}`);
} else {
  printHelp();
}
