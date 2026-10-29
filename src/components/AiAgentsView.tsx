import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Plus,
  Upload,
  Download,
  Search,
  Eye,
  Trash2,
  CheckSquare,
  Square,
  FolderOpen,
  Save,
  X,
  Import,
  Loader2,
  Send,
} from 'lucide-react';
import { api } from '../api';
import {
  AgentConfig,
  ExternalSubagentItem,
  SubagentRecord,
} from '../types';
import { useFeedback } from './FeedbackSystem';

interface AiAgentsViewProps {
  subagents: SubagentRecord[];
  agents: AgentConfig[];
  onRefreshOverview: () => Promise<void>;
}

export const AiAgentsView: React.FC<AiAgentsViewProps> = ({
  subagents,
  agents,
  onRefreshOverview,
}) => {
  const { runWithMask, showErrorModal } = useFeedback();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [externalItems, setExternalItems] = useState<ExternalSubagentItem[]>([]);
  const [loadingExternal, setLoadingExternal] = useState(true);

  // Create / Import modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [importTab, setImportTab] = useState<'create' | 'zip' | 'path'>('create');
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newTools, setNewTools] = useState('Read, Grep, Glob, Bash');
  const [newBody, setNewBody] = useState(
    '# AI Agent 角色與任務規範\n\n請定義此專屬 AI Agent (Subagent) 的專業領域、思考框架與輸出格式。'
  );
  const [localPathInput, setLocalPathInput] = useState('');
  const zipInputRef = useRef<HTMLInputElement>(null);

  // Detail & Editor drawer state (supports both central and personal folder agents!)
  const [editingTarget, setEditingTarget] = useState<{
    mode: 'central' | 'external';
    id: string;
    agentKey?: string;
    fileName?: string;
    title: string;
    pathLabel: string;
  } | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [loadingEditor, setLoadingEditor] = useState(false);

  // Target Tool Deployment Picker Modal
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployTargetIds, setDeployTargetIds] = useState<string[]>([]);
  const [checkedAgentKeys, setCheckedAgentKeys] = useState<Set<string>>(new Set());

  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents]);

  const loadExternalSubagents = async () => {
    setLoadingExternal(true);
    try {
      const res = await api.listSubagents();
      setExternalItems(res.externalSubagents);
    } finally {
      setLoadingExternal(false);
    }
  };

  useEffect(() => {
    loadExternalSubagents();
  }, [subagents.length]);

  const filteredSubagents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return subagents;
    return subagents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
    );
  }, [subagents, searchQuery]);

  const openCentralEditor = async (item: SubagentRecord) => {
    setEditingTarget({
      mode: 'central',
      id: item.id,
      title: `${item.name} (${item.fileName})`,
      pathLabel: item.centralPath,
    });
    setEditorContent('');
    setLoadingEditor(true);
    try {
      const res = await api.getSubagentDetail(item.id);
      setEditorContent(res.markdownContent);
    } catch (err: any) {
      showErrorModal('讀取 AI Agent 內容失敗', err.message);
    } finally {
      setLoadingEditor(false);
    }
  };

  const openExternalEditor = async (item: ExternalSubagentItem) => {
    setEditingTarget({
      mode: 'external',
      id: item.id,
      agentKey: item.agentKey,
      fileName: item.fileName,
      title: `${item.name} (${item.agentName} 個人資料夾)`,
      pathLabel: item.fullPath,
    });
    setEditorContent('');
    setLoadingEditor(true);
    try {
      const res = await api.getExternalSubagentContent(item.agentKey, item.fileName);
      setEditorContent(res.markdownContent);
    } catch (err: any) {
      showErrorModal('讀取個人資料夾 AI Agent 失敗', err.message);
    } finally {
      setLoadingEditor(false);
    }
  };

  const handleSaveEditor = async () => {
    if (!editingTarget) return;
    await runWithMask(
      {
        loadingTitle: `正在儲存 AI Agent「${editingTarget.title}」...`,
        loadingSubtitle: editingTarget.pathLabel,
        successTitle: 'AI Agent 內容已儲存',
        successMessage: `已成功儲存「${editingTarget.title}」並同步至已掛載的工具！`,
        errorTitle: '儲存 AI Agent 失敗',
      },
      async () => {
        if (editingTarget.mode === 'central') {
          await api.updateSubagent(editingTarget.id, { markdownContent: editorContent });
        } else if (editingTarget.agentKey && editingTarget.fileName) {
          await api.updateExternalSubagentContent(
            editingTarget.agentKey,
            editingTarget.fileName,
            editorContent
          );
        }
        await onRefreshOverview();
        await loadExternalSubagents();
      }
    );
  };

  const handleToggleDeployOnCard = async (
    subagent: SubagentRecord,
    agentKey: string
  ) => {
    const currentDeployed = Boolean(subagent.deployments[agentKey]?.deployed);
    const agent = agents.find((a) => a.key === agentKey);
    await runWithMask(
      {
        loadingTitle: !currentDeployed
          ? `正在將 AI Agent「${subagent.name}」部署至 ${agent?.name || agentKey}...`
          : `正在從 ${agent?.name || agentKey} 移除 AI Agent「${subagent.name}」...`,
        loadingSubtitle: `目標路徑：${agent?.compactAgentPath || ''}/${subagent.fileName}`,
        successTitle: !currentDeployed ? 'AI Agent 部署成功' : '已移除 AI Agent 部署',
        successMessage: !currentDeployed
          ? `已成功將 AI Agent「${subagent.name}」部署至 ${agent?.name} 的個人 Agents 資料夾 (${agent?.compactAgentPath})！`
          : `已從 ${agent?.name} 移除「${subagent.name}」。`,
        errorTitle: '切換 AI Agent 部署失敗',
      },
      async () => {
        await api.batchDeploySubagents([subagent.id], [agentKey], !currentDeployed);
        await onRefreshOverview();
        await loadExternalSubagents();
      }
    );
  };

  const handleCreateSubagent = async (e: React.FormEvent) => {
    e.preventDefault();
    const idToUse = (newId || newName).trim();
    if (!idToUse) {
      showErrorModal('欄位未填寫', '請輸入 AI Agent 代號與名稱');
      return;
    }
    await runWithMask(
      {
        loadingTitle: `正在建立 AI Agent「${idToUse}」...`,
        successTitle: 'AI Agent 建立成功',
        successMessage: `已建立專屬 AI Agent「${idToUse}」並存入 ~/.skills-manager/agents/！`,
        errorTitle: '建立 AI Agent 失敗',
      },
      async () => {
        await api.createSubagent({
          id: idToUse,
          name: newName.trim() || idToUse,
          description: newDesc.trim(),
          tools: newTools
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          markdownBody: newBody,
        });
        setNewId('');
        setNewName('');
        setNewDesc('');
        setCreateModalOpen(false);
        await onRefreshOverview();
      }
    );
  };

  const handleImportZip = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await runWithMask(
      {
        loadingTitle: '正在從 ZIP 匯入 AI Agents...',
        successTitle: 'AI Agents ZIP 匯入完成',
        successMessage: (res) => `已成功匯入 ${res.importedCount} 個 AI Agent！`,
        errorTitle: '匯入 AI Agents ZIP 失敗',
      },
      async () => {
        const res = await api.importSubagentsZip(files);
        setCreateModalOpen(false);
        await onRefreshOverview();
        return res;
      }
    );
  };

  const handleImportPath = async () => {
    if (!localPathInput.trim()) {
      showErrorModal('路徑不可為空', '請輸入有效的本機檔案或資料夾路徑');
      return;
    }
    await runWithMask(
      {
        loadingTitle: '正在從本機路徑匯入 AI Agents...',
        successTitle: '本機 AI Agents 匯入完成',
        successMessage: (res) => `已成功匯入 ${res.importedCount} 個 AI Agent！`,
        errorTitle: '本機路徑匯入失敗',
      },
      async () => {
        const res = await api.importSubagentsLocalPath(localPathInput.trim());
        setCreateModalOpen(false);
        await onRefreshOverview();
        return res;
      }
    );
  };

  const handleAdoptExternal = async (item: ExternalSubagentItem) => {
    await runWithMask(
      {
        loadingTitle: `正在將「${item.name}」納管匯入中央 AI Agent 庫...`,
        successTitle: '納管匯入完成',
        successMessage: `已成功將 ${item.agentName} 中的「${item.fileName}」納管至 ~/.skills-manager/agents/！`,
        errorTitle: '納管匯入失敗',
      },
      async () => {
        await api.adoptExternalSubagent(item.agentKey, item.fileName);
        await onRefreshOverview();
        await loadExternalSubagents();
      }
    );
  };

  const openBatchDeployModal = (ids: string[]) => {
    if (ids.length === 0) {
      showErrorModal('未選擇 AI Agent', '請先勾選至少一個 AI Agent');
      return;
    }
    setDeployTargetIds(ids);
    setCheckedAgentKeys(new Set(enabledAgents.map((a) => a.key)));
    setDeployModalOpen(true);
  };

  const executeBatchDeployModal = async (deploy: boolean) => {
    const keys = Array.from(checkedAgentKeys);
    if (keys.length === 0) {
      showErrorModal('未勾選目標工具', '請至少勾選一款目標 AI 工具');
      return;
    }
    await runWithMask(
      {
        loadingTitle: deploy
          ? `正在將 ${deployTargetIds.length} 個 AI Agent 部署至指定的 ${keys.length} 款工具...`
          : `正在從指定的 ${keys.length} 款工具移除 ${deployTargetIds.length} 個 AI Agent...`,
        successTitle: deploy ? '批次部署 AI Agent 完成' : '批次移除完成',
        successMessage: (res) =>
          `已成功${deploy ? '部署' : '移除'} ${res.affectedCount} 個 AI Agent！`,
        errorTitle: '批次操作失敗',
      },
      async () => {
        const res = await api.batchDeploySubagents(deployTargetIds, keys, deploy);
        setDeployModalOpen(false);
        await onRefreshOverview();
        await loadExternalSubagents();
        return res;
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Path Mapping Reference Card for AI Agents */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-400">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                AI Agents (Subagents 專屬角色代理) 路徑對照與管理
              </h3>
              <p className="text-xs text-slate-400">
                與 AI Skills 獨立區分：專門管理各工具在 <code className="text-violet-300">agents/</code> 目錄下的角色代理定義檔 (<code className="text-violet-300">.md</code> / <code className="text-violet-300">.toml</code>)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                openBatchDeployModal(
                  selectedIds.size > 0
                    ? Array.from(selectedIds)
                    : filteredSubagents.map((s) => s.id)
                )
              }
              className="flex items-center gap-1.5 rounded-xl border border-teal-500/40 bg-teal-500/15 px-3.5 py-2 text-xs font-semibold text-teal-200 hover:bg-teal-500/25 transition"
            >
              <Send className="h-3.5 w-3.5 text-teal-400" />
              部署 AI Agent 至指定工具...
            </button>
            <button
              type="button"
              onClick={() =>
                runWithMask(
                  {
                    loadingTitle: '正在打包並下載 AI Agents (.zip)...',
                    successTitle: 'AI Agents ZIP 下載完成',
                    successMessage: (res) =>
                      `已下載「${res.filename}」(${(res.sizeBytes / 1024).toFixed(1)} KB)！`,
                  },
                  () =>
                    api.exportSubagentsZip(
                      selectedIds.size > 0 ? Array.from(selectedIds) : []
                    )
                )
              }
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
            >
              <Download className="h-3.5 w-3.5 text-teal-400" />
              下載 AI Agents (.zip)
            </button>
            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              新增 / 匯入 AI Agent
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1 text-xs">
          {agents.map((ag) => (
            <div
              key={ag.key}
              className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 flex items-center justify-between"
            >
              <div className="space-y-0.5 truncate pr-2">
                <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: ag.color }}
                  />
                  <span>{ag.name}</span>
                </div>
                <div className="font-mono text-[11px] text-teal-300 truncate">
                  個人：{ag.compactAgentPath}/
                </div>
                <div className="font-mono text-[10px] text-slate-500 truncate">
                  專案：{(ag.agentProjectPaths || ['.agents/agents/']).join('、')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => api.openInOSFileManager(ag.resolvedAgentPath)}
                className="rounded-lg bg-slate-800 p-2 text-slate-300 hover:text-teal-300 shrink-0"
                title="開啟此工具的個人 Agents 資料夾"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Search & Batch Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋中央庫中的 AI Agent 名稱或描述..."
            className="w-full rounded-xl border border-slate-800 bg-slate-900 pl-10 pr-4 py-2 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              if (selectedIds.size === filteredSubagents.length) {
                setSelectedIds(new Set());
              } else {
                setSelectedIds(new Set(filteredSubagents.map((s) => s.id)));
              }
            }}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-slate-300 hover:bg-slate-800"
          >
            {selectedIds.size === filteredSubagents.length && filteredSubagents.length > 0
              ? '取消全選'
              : `全選 (${filteredSubagents.length})`}
          </button>
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(`確定要刪除所選的 ${selectedIds.size} 個 AI Agent 嗎？`)) return;
                await runWithMask(
                  {
                    loadingTitle: '正在刪除所選 AI Agents...',
                    successTitle: '已刪除 AI Agents',
                    successMessage: `已刪除 ${selectedIds.size} 個 AI Agent。`,
                  },
                  async () => {
                    await api.deleteSubagents(Array.from(selectedIds));
                    setSelectedIds(new Set());
                    await onRefreshOverview();
                  }
                );
              }}
              className="flex items-center gap-1 rounded-lg bg-rose-500/15 border border-rose-500/30 px-3 py-1.5 text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
              刪除已選 ({selectedIds.size})
            </button>
          )}
        </div>
      </div>

      {/* Central Subagents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredSubagents.map((item) => {
          const isSelected = selectedIds.has(item.id);
          return (
            <div
              key={item.id}
              onClick={() => openCentralEditor(item)}
              className={`group cursor-pointer select-none rounded-2xl border p-5 transition flex flex-col justify-between gap-4 ${
                isSelected
                  ? 'border-teal-500/60 bg-teal-500/5'
                  : 'border-slate-800 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        });
                      }}
                      className="text-slate-400 hover:text-teal-400"
                    >
                      {isSelected ? (
                        <CheckSquare className="h-4 w-4 text-teal-400" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                    <h4 className="font-bold text-sm text-slate-100 truncate group-hover:text-teal-300">
                      {item.name}
                    </h4>
                  </div>

                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 shrink-0"
                  >
                    <button
                      type="button"
                      onClick={() => openBatchDeployModal([item.id])}
                      className="flex items-center gap-1 rounded-lg bg-teal-500/15 border border-teal-500/30 px-2 py-1 text-[11px] font-medium text-teal-300 hover:bg-teal-500 hover:text-slate-950 transition"
                    >
                      <Send className="h-3 w-3" />
                      指定工具
                    </button>
                    <button
                      type="button"
                      onClick={() => openCentralEditor(item)}
                      className="flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-teal-500 hover:text-slate-950 transition"
                    >
                      <Eye className="h-3 w-3" />
                      查看內容
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-400 line-clamp-2">{item.description}</p>
                {item.tools && item.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {item.tools.map((t) => (
                      <span
                        key={t}
                        className="rounded bg-violet-500/15 border border-violet-500/30 px-1.5 py-0.2 text-[10px] font-mono text-violet-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div
                onClick={(e) => e.stopPropagation()}
                className="border-t border-slate-800/80 pt-3 space-y-1.5"
              >
                <div className="text-[10px] text-slate-500 flex justify-between">
                  <span>點擊掛載至此工具的個人 agents/ 資料夾：</span>
                  <span className="font-mono">{item.fileName}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {agents.map((ag) => {
                    const dep = item.deployments[ag.key];
                    const deployed = Boolean(dep?.deployed);
                    return (
                      <button
                        type="button"
                        key={ag.key}
                        onClick={() => handleToggleDeployOnCard(item, ag.key)}
                        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                          deployed
                            ? 'border-teal-500/50 bg-teal-500/15 text-teal-200'
                            : 'border-slate-800 bg-slate-950/60 text-slate-500 hover:text-slate-300'
                        }`}
                        title={`${ag.name}: ${ag.compactAgentPath}/${item.fileName}`}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: deployed ? ag.color : '#475569' }}
                        />
                        <span>{ag.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Discovered Subagents inside Personal Folders (~/.copilot/agents, ~/.claude/agents, ~/.codex/agents) */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">
          目前實際存在於各工具個人 <code className="text-teal-300">agents/</code> 資料夾中的 AI Agents ({externalItems.length})
        </h3>
        {loadingExternal ? (
          <div className="p-6 flex items-center justify-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-teal-400" />
            <span>正在掃描 ~/.copilot/agents、~/.claude/agents、~/.codex/agents...</span>
          </div>
        ) : externalItems.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            各工具個人 agents/ 資料夾中目前尚無檔案，點擊上方卡片按鈕即可立即部署。
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {externalItems.map((ext) => (
              <div
                key={`${ext.agentKey}-${ext.fileName}`}
                onClick={() => openExternalEditor(ext)}
                className="cursor-pointer rounded-xl border border-slate-800 bg-slate-950/80 p-4 flex items-center justify-between gap-3 hover:border-teal-500/40 transition"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-slate-100 truncate">
                      {ext.name}
                    </span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                      {ext.fileName}
                    </span>
                    <span className="rounded bg-teal-500/15 px-2 py-0.5 text-[10px] text-teal-300">
                      {ext.agentName}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">{ext.description}</p>
                  <div className="text-[10px] font-mono text-slate-500 truncate">
                    {ext.fullPath}
                  </div>
                </div>

                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1.5 shrink-0"
                >
                  <button
                    type="button"
                    onClick={() => openExternalEditor(ext)}
                    className="flex items-center gap-1 rounded-lg bg-teal-500/15 border border-teal-500/30 px-2.5 py-1 text-xs text-teal-300 hover:bg-teal-500 hover:text-slate-950 transition"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    查看內容
                  </button>
                  {!ext.managedByCentral && (
                    <button
                      type="button"
                      onClick={() => handleAdoptExternal(ext)}
                      className="flex items-center gap-1 rounded-lg bg-amber-500/20 border border-amber-500/40 px-2.5 py-1 text-xs text-amber-300"
                    >
                      <Import className="h-3.5 w-3.5" />
                      納管
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Import Subagent Modal */}
      {createModalOpen && (
        <div
          onClick={() => setCreateModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <h3 className="text-base font-bold text-slate-100">
                新增或離線匯入 AI Agent (Subagent)
              </h3>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex border-b border-slate-800 bg-slate-950/50 px-6 pt-2 gap-3 text-xs">
              <button
                type="button"
                onClick={() => setImportTab('create')}
                className={`border-b-2 py-2.5 px-3 font-medium ${
                  importTab === 'create'
                    ? 'border-teal-400 text-teal-300'
                    : 'border-transparent text-slate-400'
                }`}
              >
                手動建立 AI Agent (.md)
              </button>
              <button
                type="button"
                onClick={() => setImportTab('zip')}
                className={`border-b-2 py-2.5 px-3 font-medium ${
                  importTab === 'zip'
                    ? 'border-teal-400 text-teal-300'
                    : 'border-transparent text-slate-400'
                }`}
              >
                從 ZIP 壓縮檔匯入
              </button>
              <button
                type="button"
                onClick={() => setImportTab('path')}
                className={`border-b-2 py-2.5 px-3 font-medium ${
                  importTab === 'path'
                    ? 'border-teal-400 text-teal-300'
                    : 'border-transparent text-slate-400'
                }`}
              >
                從本機路徑匯入
              </button>
            </div>

            <div className="p-6 space-y-4">
              {importTab === 'create' && (
                <form onSubmit={handleCreateSubagent} className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 mb-1">Agent 檔案代號 (ID) *</label>
                      <input
                        required
                        type="text"
                        value={newId}
                        onChange={(e) => setNewId(e.target.value)}
                        placeholder="例如: db-optimizer"
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">顯示名稱</label>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="例如: Database Optimizer"
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">角色職責描述 (Description) *</label>
                    <input
                      required
                      type="text"
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      placeholder="說明何時應委派任務給此 Subagent..."
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">允許使用的工具 (Tools)</label>
                    <input
                      type="text"
                      value={newTools}
                      onChange={(e) => setNewTools(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">System Prompt 內容 (Markdown)</label>
                    <textarea
                      rows={6}
                      value={newBody}
                      onChange={(e) => setNewBody(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-slate-100"
                    />
                  </div>
                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      className="rounded-xl bg-teal-500 px-5 py-2 font-semibold text-slate-950 hover:bg-teal-400"
                    >
                      建立 AI Agent
                    </button>
                  </div>
                </form>
              )}

              {importTab === 'zip' && (
                <div
                  onClick={() => zipInputRef.current?.click()}
                  className="cursor-pointer rounded-2xl border-2 border-dashed border-slate-700 hover:border-teal-500/60 bg-slate-950/60 p-10 text-center space-y-2"
                >
                  <Upload className="mx-auto h-10 w-10 text-teal-400" />
                  <div className="text-sm font-medium text-slate-200">
                    點擊選擇包含 <code className="text-teal-300">.md</code> / <code className="text-teal-300">.toml</code> Agent 定義檔的 ZIP 壓縮包
                  </div>
                  <input
                    ref={zipInputRef}
                    type="file"
                    accept=".zip"
                    multiple
                    className="hidden"
                    onChange={(e) => handleImportZip(e.target.files)}
                  />
                </div>
              )}

              {importTab === 'path' && (
                <div className="space-y-3 text-xs">
                  <label className="block text-slate-300">
                    輸入本機 AI Agent 檔案或資料夾路徑 (例如 ~/.claude/agents)：
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={localPathInput}
                      onChange={(e) => setLocalPathInput(e.target.value)}
                      placeholder="~/.claude/agents 或 D:\agents"
                      className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={handleImportPath}
                      className="rounded-xl bg-teal-500 px-4 py-2 font-semibold text-slate-950"
                    >
                      立即匯入
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Target Tool Picker Modal for Subagents */}
      {deployModalOpen && (
        <div
          onClick={() => setDeployModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-100">
                選擇目標工具部署 AI Agent ({deployTargetIds.length} 項)
              </h3>
              <button
                type="button"
                onClick={() => setDeployModalOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-2">
              {agents.map((ag) => {
                const checked = checkedAgentKeys.has(ag.key);
                return (
                  <div
                    key={ag.key}
                    onClick={() =>
                      setCheckedAgentKeys((prev) => {
                        const next = new Set(prev);
                        if (next.has(ag.key)) next.delete(ag.key);
                        else next.add(ag.key);
                        return next;
                      })
                    }
                    className={`cursor-pointer rounded-xl border p-3.5 flex items-center justify-between text-xs ${
                      checked
                        ? 'border-teal-500/60 bg-teal-500/10'
                        : 'border-slate-800 bg-slate-950'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {checked ? (
                        <CheckSquare className="h-4 w-4 text-teal-400" />
                      ) : (
                        <Square className="h-4 w-4 text-slate-500" />
                      )}
                      <div>
                        <div className="font-semibold text-slate-100">{ag.name}</div>
                        <div className="font-mono text-[11px] text-slate-400">
                          目標路徑：{ag.compactAgentPath}/
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => executeBatchDeployModal(false)}
                className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300"
              >
                從勾選工具移除
              </button>
              <button
                type="button"
                onClick={() => executeBatchDeployModal(true)}
                className="rounded-xl bg-teal-500 px-5 py-2 text-xs font-semibold text-slate-950"
              >
                立即部署至勾選工具 ({checkedAgentKeys.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Side Drawer for Viewing / Editing Subagent Content */}
      {editingTarget && (
        <div
          onClick={() => setEditingTarget(null)}
          className="fixed inset-0 z-50 flex items-center justify-end bg-black/65 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="h-full w-full max-w-2xl border-l border-slate-800 bg-slate-900 p-6 flex flex-col justify-between"
          >
            <div className="space-y-4 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-100">
                    {editingTarget.title}
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400 mt-0.5 break-all">
                    {editingTarget.pathLabel}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveEditor}
                    className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-teal-400"
                  >
                    <Save className="h-3.5 w-3.5" />
                    儲存內容
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingTarget(null)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {loadingEditor ? (
                <div className="flex-1 flex items-center justify-center gap-2 text-xs text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin text-teal-400" />
                  <span>正在讀取檔案內容...</span>
                </div>
              ) : (
                <textarea
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  className="flex-1 w-full rounded-2xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100 focus:border-teal-500 focus:outline-none"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
