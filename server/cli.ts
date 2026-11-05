#!/usr/bin/env node
/**
 * Offline CLI for Skills Manager (shares the exact same Node.js local core as the Web UI & System Tray).
 * Usage:
 *   npm run cli -- skills list
 *   npm run cli -- skills import-zip ./my-skill.zip
 *   npm run cli -- skills import-dir ./my-skill-folder
 *   npm run cli -- skills deploy <skill-id> <agent-key>
 *   npm run cli -- skills undeploy <skill-id> <agent-key>
 *   npm run cli -- skills adopt <agent-key> <dir-name>
 *   npm run cli -- subagents list
 *   npm run cli -- subagents deploy <subagent-id> <agent-key>
 *   npm run cli -- mcp list
 *   npm run cli -- mcp test <server-id>
 *   npm run cli -- mcp deploy <server-id> <agent-key>
 *   npm run cli -- agents list
 *   npm run cli -- seeds sync
 *   npm run cli -- snapshots create [note]
 */
import fs from 'node:fs';
import path from 'node:path';
import { LocalStore } from './store.js';
import { SkillManager } from './skillManager.js';
import { SubagentManager } from './subagentManager.js';
import { McpManager } from './mcpManager.js';
import { ZipAndFolderService } from './zipService.js';
import { compactHomePath } from './agentRegistry.js';

const store = new LocalStore();
const skillManager = new SkillManager(store);
const subagentManager = new SubagentManager(store);
const mcpManager = new McpManager(store);
const zipService = new ZipAndFolderService(store, skillManager);

const args = process.argv.slice(2);
const group = args[0];
const sub = args[1];

function printHelp() {
  console.log(`
Skills Manager CLI (100% 離線本機版)
中央儲存庫: ${store.getBaseDir()}

指令列表:
  skills list                                列出中央儲存庫所有 Skills 與各工具部署狀態
  skills import-zip <path-to.zip>            從本機 ZIP / .skill 壓縮檔匯入技能
  skills import-dir <path-to-folder>         從本機資料夾匯入技能
  skills deploy <skill-id> <agent-key>       將技能部署至指定 AI 工具的個人資料夾
  skills undeploy <skill-id> <agent-key>     從指定 AI 工具移除技能部署
  skills adopt <agent-key> <dir-name>        將 AI 工具個人資料夾中的現有技能納管匯入中央庫

  subagents list                             列出中央儲存庫所有 AI Agents (Subagents)
  subagents deploy <id> <agent-key>          將 AI Agent 部署至指定工具個人資料夾
  subagents undeploy <id> <agent-key>        從指定工具移除 AI Agent 部署

  mcp list                                   列出中央儲存庫所有 MCP 伺服器設定
  mcp test <server-id>                       測試指定 MCP 伺服器連線 (JSON-RPC initialize / HTTP)
  mcp deploy <server-id> <agent-key>         將 MCP 伺服器寫入指定工具設定檔
  mcp undeploy <server-id> <agent-key>       從指定工具設定檔移除 MCP 伺服器

  agents list                                列出所有支援的 AI 工具與個人資料夾對應路徑
  seeds sync                                 從專案 ./skills、./agents、./mcp 增量同步範例至中央庫
  snapshots create [note]                    建立本機離線完整 ZIP 備份快照 (含 Skills/Agents/MCP)
`);
}

async function runCli() {
  if (!group || group === '--help' || group === '-h') {
    printHelp();
    return;
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
          已部署工具:
            Object.values(s.deployments)
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
  } else if (group === 'subagents') {
    if (sub === 'list' || !sub) {
      const list = subagentManager.listCentralSubagents();
      console.table(
        list.map((a) => ({
          ID: a.id,
          名稱: a.name,
          檔案: a.fileName,
          已部署工具:
            Object.values(a.deployments)
              .filter((d) => d.deployed)
              .map((d) => d.agentKey)
              .join(', ') || '(無)',
        }))
      );
    } else if (sub === 'deploy' || sub === 'undeploy') {
      const subId = args[2];
      const agentKey = args[3];
      if (!subId || !agentKey) {
        console.error('請提供 <subagent-id> 與 <agent-key>');
        process.exit(1);
      }
      subagentManager.batchDeploySubagents([subId], [agentKey], sub === 'deploy');
      console.log(`已${sub === 'deploy' ? '部署' : '移除'} AI Agent ${subId} (${agentKey})`);
    } else {
      printHelp();
    }
  } else if (group === 'mcp') {
    if (sub === 'list' || !sub) {
      const list = mcpManager.listCentralMcpServers();
      console.table(
        list.map((m) => ({
          ID: m.id,
          名稱: m.name,
          協定: m.transport,
          指令或網址: m.transport === 'stdio' ? `${m.command} ${(m.args || []).join(' ')}` : m.url,
          已掛載工具:
            Object.values(m.deployments)
              .filter((d) => d.deployed)
              .map((d) => d.agentKey)
              .join(', ') || '(無)',
        }))
      );
    } else if (sub === 'test') {
      const serverId = args[2];
      if (!serverId) {
        console.error('請提供要測試的 <server-id>');
        process.exit(1);
      }
      const res = await mcpManager.testMcpServerConnection(serverId);
      console.log(res.ok ? `✅ ${res.message}` : `❌ ${res.message}`);
      if (!res.ok) process.exit(1);
    } else if (sub === 'deploy' || sub === 'undeploy') {
      const serverId = args[2];
      const agentKey = args[3];
      if (!serverId || !agentKey) {
        console.error('請提供 <server-id> 與 <agent-key>');
        process.exit(1);
      }
      mcpManager.batchDeployMcpServers([serverId], [agentKey], sub === 'deploy');
      console.log(`已${sub === 'deploy' ? '掛載' : '移除'} MCP ${serverId} (${agentKey})`);
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
        Skills路徑: compactHomePath(skillManager.getAgentResolvedPath(a)),
        Agents路徑: compactHomePath(subagentManager.getAgentSubagentsResolvedPath(a)),
        MCP設定檔: compactHomePath(mcpManager.getAgentMcpConfigPath(a)),
      }))
    );
  } else if (group === 'seeds') {
    const res = store.syncProjectSeeds(false);
    console.log(
      `已從專案範例資料夾同步：新增 ${res.addedSkills} 個技能、${res.addedSubagents} 個 Agent、${res.addedMcp} 個 MCP`
    );
  } else if (group === 'snapshots') {
    const snap = zipService.createLocalSnapshot(args[2] || 'CLI 建立本機快照');
    console.log(`已建立本機快照: ${snap.filePath}`);
  } else {
    printHelp();
  }
}

runCli().catch((err) => {
  console.error('[CLI Error]', err?.message || err);
  process.exit(1);
});
