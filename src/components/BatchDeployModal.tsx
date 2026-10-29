import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Layers,
  CheckSquare,
  Square,
  Search,
  Link2,
  Trash2,
  FolderOpen,
} from 'lucide-react';
import { api } from '../api';
import { AgentConfig, SkillRecord } from '../types';
import { useFeedback } from './FeedbackSystem';

interface BatchDeployModalProps {
  open: boolean;
  title?: string;
  targetSkillIds: string[];
  skills: SkillRecord[];
  agents: AgentConfig[];
  onClose: () => void;
  onCompleted: (updatedSkills: SkillRecord[], updatedAgents?: AgentConfig[]) => Promise<void> | void;
}

export const BatchDeployModal: React.FC<BatchDeployModalProps> = ({
  open,
  title,
  targetSkillIds,
  skills,
  agents,
  onClose,
  onCompleted,
}) => {
  const { runWithMask, showErrorModal } = useFeedback();
  const [filterMode, setFilterMode] = useState<'enabled' | 'all'>('enabled');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgentKeys, setSelectedAgentKeys] = useState<Set<string>>(new Set());

  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents]);

  // Pre-select enabled agents when modal opens
  useEffect(() => {
    if (open) {
      setSelectedAgentKeys(new Set(enabledAgents.map((a) => a.key)));
      setSearchQuery('');
      setFilterMode(enabledAgents.length > 0 ? 'enabled' : 'all');
    }
  }, [open, enabledAgents.length]);

  const visibleAgents = useMemo(() => {
    const base = filterMode === 'enabled' ? enabledAgents : agents;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.key.toLowerCase().includes(q) ||
        a.compactPath.toLowerCase().includes(q)
    );
  }, [agents, enabledAgents, filterMode, searchQuery]);

  if (!open) return null;

  const targetSkills = skills.filter((s) => targetSkillIds.includes(s.id));

  const toggleAgent = (key: string) => {
    setSelectedAgentKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedAgentKeys((prev) => {
      const next = new Set(prev);
      visibleAgents.forEach((a) => next.add(a.key));
      return next;
    });
  };

  const handleClearVisible = () => {
    setSelectedAgentKeys((prev) => {
      const next = new Set(prev);
      visibleAgents.forEach((a) => next.delete(a.key));
      return next;
    });
  };

  const handleExecute = async (deploy: boolean) => {
    const agentKeys = Array.from(selectedAgentKeys);
    if (agentKeys.length === 0) {
      showErrorModal('未選擇目標 AI 工具', '請至少勾選一款要部署或移除的 AI 工具。');
      return;
    }
    if (targetSkillIds.length === 0) {
      showErrorModal('未選擇技能', '沒有可部署的技能項目。');
      return;
    }

    const chosenNames = agents
      .filter((a) => selectedAgentKeys.has(a.key))
      .map((a) => a.name)
      .join('、');

    await runWithMask(
      {
        loadingTitle: deploy
          ? `正在將 ${targetSkillIds.length} 個技能高速部署至指定的 ${agentKeys.length} 款 AI 工具...`
          : `正在從指定的 ${agentKeys.length} 款 AI 工具移除 ${targetSkillIds.length} 個技能...`,
        loadingSubtitle: `目標工具：${chosenNames}`,
        successTitle: deploy ? '指定工具批次部署完成' : '指定工具批次移除完成',
        successMessage: (res) =>
          deploy
            ? `已成功將 ${res.affectedSkills} 個技能同步掛載至您指定的 ${res.affectedAgents} 款 AI 工具個人資料夾 (${chosenNames})！`
            : `已成功從您指定的 ${res.affectedAgents} 款 AI 工具個人資料夾移除 ${res.affectedSkills} 個技能。`,
        errorTitle: deploy ? '批次部署至指定工具失敗' : '批次移除失敗',
      },
      async () => {
        const res = await api.batchDeploy(targetSkillIds, agentKeys, deploy, true);
        await onCompleted(res.skills, res.agents);
        onClose();
        return res;
      }
    );
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-400">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                {title || `選擇要部署的目標 AI 工具 (${targetSkillIds.length} 個技能)`}
              </h2>
              <p className="text-xs text-slate-400">
                自由勾選要將這 {targetSkillIds.length} 個技能部署（或移除）到哪些 AI 工具的個人資料夾底下
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar: Tabs + Search + Select All / Clear */}
        <div className="border-b border-slate-800 bg-slate-950/60 px-6 py-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-xl border border-slate-800 bg-slate-900 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setFilterMode('enabled')}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  filterMode === 'enabled'
                    ? 'bg-teal-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                已啟用的 AI 工具 ({enabledAgents.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  filterMode === 'all'
                    ? 'bg-teal-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                全部支援的 AI 工具 ({agents.length})
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={handleSelectAllVisible}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700"
              >
                全選目前顯示 ({visibleAgents.length})
              </button>
              <button
                type="button"
                onClick={handleClearVisible}
                className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-slate-400 hover:text-slate-200"
              >
                清空勾選
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋 AI 工具名稱或個人資料夾路徑 (GitHub Copilot、Claude Code、OpenAI Codex)..."
              className="w-full rounded-xl border border-slate-800 bg-slate-900 pl-9 pr-3 py-1.5 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Agent List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {visibleAgents.map((agent) => {
              const checked = selectedAgentKeys.has(agent.key);
              const deployedCountForThisAgent = targetSkills.filter(
                (s) => s.deployments[agent.key]?.deployed
              ).length;

              return (
                <div
                  key={agent.key}
                  onClick={() => toggleAgent(agent.key)}
                  className={`cursor-pointer select-none rounded-xl border p-3.5 flex items-center justify-between gap-3 transition ${
                    checked
                      ? 'border-teal-500/60 bg-teal-500/10'
                      : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {checked ? (
                      <CheckSquare className="h-4 w-4 text-teal-400 shrink-0" />
                    ) : (
                      <Square className="h-4 w-4 text-slate-500 shrink-0" />
                    )}
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: agent.color }}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs text-slate-100 truncate">
                          {agent.name}
                        </span>
                        {!agent.enabled && (
                          <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[10px] text-amber-300">
                            部署時自動啟用
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 truncate">
                        {agent.compactPath}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-mono ${
                        deployedCountForThisAgent === targetSkillIds.length &&
                        targetSkillIds.length > 0
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : deployedCountForThisAgent > 0
                          ? 'bg-teal-500/20 text-teal-300'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                      title="目前所選技能已部署在此工具的數量"
                    >
                      已掛載 {deployedCountForThisAgent}/{targetSkillIds.length}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        api.openInOSFileManager(agent.resolvedPath);
                      }}
                      className="rounded-lg bg-slate-800 p-1 text-slate-400 hover:text-teal-300"
                      title="開啟此工具的個人資料夾"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-slate-800 bg-slate-950/80 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            已勾選 <strong className="text-teal-300">{selectedAgentKeys.size}</strong> 款目標 AI 工具 ·
            準備操作 <strong className="text-teal-300">{targetSkillIds.length}</strong> 個技能
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => handleExecute(false)}
              className="flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition"
            >
              <Trash2 className="h-3.5 w-3.5" />
              從勾選的工具移除 ({selectedAgentKeys.size})
            </button>
            <button
              type="button"
              onClick={() => handleExecute(true)}
              className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400 shadow-lg shadow-teal-500/20 transition"
            >
              <Link2 className="h-3.5 w-3.5" />
              立即部署至勾選的 AI 工具 ({selectedAgentKeys.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
