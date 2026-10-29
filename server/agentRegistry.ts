import os from 'node:os';
import path from 'node:path';
import { AgentConfig } from './types.js';

/**
 * 內建三大 AI 工具的「AI Skills」、「AI Agents (Subagents)」與「MCP」完整路徑對照：
 *
 * 1. AI Skills:
 *    - GitHub Copilot : 專案 .github/skills/、.agents/skills/、.claude/skills/ | 個人 ~/.copilot/skills/、~/.agents/skills/
 *    - Claude Code    : 專案 .claude/skills/                                 | 個人 ~/.claude/skills/
 *    - OpenAI Codex   : 專案 .agents/skills/                                 | 個人 ~/.agents/skills/
 *
 * 2. AI Agents (Subagents / Custom Agents):
 *    - GitHub Copilot : 專案 .github/agents/                                 | 個人 ~/.copilot/agents/
 *    - Claude Code    : 專案 .claude/agents/                                 | 個人 ~/.claude/agents/
 *    - OpenAI Codex   : 專案 .codex/agents/                                  | 個人 ~/.codex/agents/
 *
 * 3. MCP (Model Context Protocol):
 *    - GitHub Copilot : 專案 .vscode/mcp.json、.github/mcp-config.json        | 個人 ~/.copilot/mcp-config.json
 *    - Claude Code    : 專案 .mcp.json                                       | 個人 ~/.claude.json
 *    - OpenAI Codex   : 專案 .codex/config.toml                              | 個人 ~/.codex/config.toml
 */
export const BUILTIN_AGENTS: AgentConfig[] = [
  {
    key: 'github_copilot',
    name: 'GitHub Copilot',
    category: 'mainstream',
    // AI Skills
    defaultGlobalPath: '~/.copilot/skills',
    globalPaths: ['~/.copilot/skills/', '~/.agents/skills/'],
    projectPaths: ['.github/skills/', '.agents/skills/', '.claude/skills/'],
    fallbackPaths: ['~/.agents/skills'],
    // AI Agents (Subagents)
    defaultAgentGlobalPath: '~/.copilot/agents',
    agentGlobalPaths: ['~/.copilot/agents/'],
    agentProjectPaths: ['.github/agents/'],
    // MCP
    defaultMcpGlobalPath: '~/.copilot/mcp-config.json',
    mcpGlobalPaths: ['~/.copilot/mcp-config.json'],
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
    defaultGlobalPath: '~/.claude/skills',
    globalPaths: ['~/.claude/skills/'],
    projectPaths: ['.claude/skills/'],
    // AI Agents (Subagents)
    defaultAgentGlobalPath: '~/.claude/agents',
    agentGlobalPaths: ['~/.claude/agents/'],
    agentProjectPaths: ['.claude/agents/'],
    // MCP
    defaultMcpGlobalPath: '~/.claude.json',
    mcpGlobalPaths: ['~/.claude.json'],
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
    defaultGlobalPath: '~/.agents/skills',
    globalPaths: ['~/.agents/skills/'],
    projectPaths: ['.agents/skills/'],
    // AI Agents (Subagents)
    defaultAgentGlobalPath: '~/.codex/agents',
    agentGlobalPaths: ['~/.codex/agents/'],
    agentProjectPaths: ['.codex/agents/'],
    // MCP
    defaultMcpGlobalPath: '~/.codex/config.toml',
    mcpGlobalPaths: ['~/.codex/config.toml'],
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
