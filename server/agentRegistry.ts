import os from 'node:os';
import path from 'node:path';
import { AgentConfig } from './types.js';
import './envConfig.js';

/**
 * 內建三大 AI 工具的「AI Skills」、「AI Agents (Subagents)」與「MCP」完整路徑對照
 * 優先讀取專案 `.env` 中的環境變數路徑，未設定時使用標準預設路徑：
 *
 * 1. AI Skills:
 *    - GitHub Copilot : COPILOT_SKILLS_PATH (預設 ~/.copilot/skills)
 *    - Claude Code    : CLAUDE_SKILLS_PATH  (預設 ~/.claude/skills)
 *    - OpenAI Codex   : CODEX_SKILLS_PATH   (預設 ~/.agents/skills)
 *
 * 2. AI Agents (Subagents / Custom Agents):
 *    - GitHub Copilot : COPILOT_AGENTS_PATH (預設 ~/.copilot/agents)
 *    - Claude Code    : CLAUDE_AGENTS_PATH  (預設 ~/.claude/agents)
 *    - OpenAI Codex   : CODEX_AGENTS_PATH   (預設 ~/.codex/agents)
 *
 * 3. MCP (Model Context Protocol):
 *    - GitHub Copilot : COPILOT_MCP_CONFIG_PATH (預設 ~/.copilot/mcp-config.json)
 *    - Claude Code    : CLAUDE_MCP_CONFIG_PATH  (預設 ~/.claude.json)
 *    - OpenAI Codex   : CODEX_MCP_CONFIG_PATH   (預設 ~/.codex/config.toml)
 */
const copilotSkillsPath = process.env.COPILOT_SKILLS_PATH?.trim() || '~/.copilot/skills';
const copilotAgentsPath = process.env.COPILOT_AGENTS_PATH?.trim() || '~/.copilot/agents';
const copilotMcpPath = process.env.COPILOT_MCP_CONFIG_PATH?.trim() || '~/.copilot/mcp-config.json';

const claudeSkillsPath = process.env.CLAUDE_SKILLS_PATH?.trim() || '~/.claude/skills';
const claudeAgentsPath = process.env.CLAUDE_AGENTS_PATH?.trim() || '~/.claude/agents';
const claudeMcpPath = process.env.CLAUDE_MCP_CONFIG_PATH?.trim() || '~/.claude.json';

const codexSkillsPath = process.env.CODEX_SKILLS_PATH?.trim() || '~/.agents/skills';
const codexAgentsPath = process.env.CODEX_AGENTS_PATH?.trim() || '~/.codex/agents';
const codexMcpPath = process.env.CODEX_MCP_CONFIG_PATH?.trim() || '~/.codex/config.toml';

export const BUILTIN_AGENTS: AgentConfig[] = [
  {
    key: 'github_copilot',
    name: 'GitHub Copilot',
    category: 'mainstream',
    // AI Skills
    defaultGlobalPath: copilotSkillsPath,
    globalPaths: [copilotSkillsPath, '~/.agents/skills/'],
    projectPaths: ['.github/skills/', '.agents/skills/', '.claude/skills/'],
    fallbackPaths: ['~/.agents/skills'],
    // AI Agents (Subagents)
    defaultAgentGlobalPath: copilotAgentsPath,
    agentGlobalPaths: [copilotAgentsPath],
    agentProjectPaths: ['.github/agents/'],
    // MCP
    defaultMcpGlobalPath: copilotMcpPath,
    mcpGlobalPaths: [copilotMcpPath],
    mcpProjectPaths: ['.vscode/mcp.json', '.github/mcp-config.json'],
    mcpFormat: 'json-mcpServers',
    enabled: true,
    icon: 'Bot',
    color: '#8B5CF6',
  },
  {
    key: 'claude_code',
    name: 'Claude Code',
    category: 'mainstream',
    // AI Skills
    defaultGlobalPath: claudeSkillsPath,
    globalPaths: [claudeSkillsPath],
    projectPaths: ['.claude/skills/'],
    // AI Agents (Subagents)
    defaultAgentGlobalPath: claudeAgentsPath,
    agentGlobalPaths: [claudeAgentsPath],
    agentProjectPaths: ['.claude/agents/'],
    // MCP
    defaultMcpGlobalPath: claudeMcpPath,
    mcpGlobalPaths: [claudeMcpPath],
    mcpProjectPaths: ['.mcp.json'],
    mcpFormat: 'json-mcpServers',
    enabled: true,
    icon: 'Sparkles',
    color: '#D97757',
  },
  {
    key: 'codex',
    name: 'OpenAI Codex',
    category: 'mainstream',
    // AI Skills
    defaultGlobalPath: codexSkillsPath,
    globalPaths: [codexSkillsPath],
    projectPaths: ['.agents/skills/'],
    // AI Agents (Subagents)
    defaultAgentGlobalPath: codexAgentsPath,
    agentGlobalPaths: [codexAgentsPath],
    agentProjectPaths: ['.codex/agents/'],
    // MCP
    defaultMcpGlobalPath: codexMcpPath,
    mcpGlobalPaths: [codexMcpPath],
    mcpProjectPaths: ['.codex/config.toml'],
    mcpFormat: 'toml-codex',
    enabled: true,
    icon: 'Terminal',
    color: '#10B981',
  },
];

export function expandHomePath(inputPath: string): string {
  if (!inputPath) return inputPath;
  const home = os.homedir();
  const normalized = inputPath.replace(/\\/g, '/');
  if (normalized === '~') return home;
  if (normalized.startsWith('~/')) {
    return path.resolve(home, normalized.slice(2));
  }
  return path.resolve(inputPath);
}

export function compactHomePath(absPath: string): string {
  if (!absPath) return absPath;
  const home = os.homedir().replace(/\\/g, '/');
  const norm = absPath.replace(/\\/g, '/');
  if (norm === home) return '~';
  if (norm.startsWith(home + '/')) {
    return '~/' + norm.slice(home.length + 1);
  }
  return norm;
}
