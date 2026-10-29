import React, { useEffect, useMemo, useState } from 'react';
import {
  FolderOpen,
  RefreshCw,
  Download,
  Import,
  CheckCircle2,
  AlertCircle,
  Link2,
  Plus,
  Loader2,
  Eye,
  Search,
  CheckSquare,
  Square,
  Trash2,
} from 'lucide-react';
import { api } from '../api';
import { AgentConfig, ExternalAgentSkill, SkillRecord } from '../types';
import { useFeedback } from './FeedbackSystem';
import { ExternalSkillDetailModal } from './ExternalSkillDetailModal';

interface AgentWorkspaceViewProps {
  selectedAgentKey: string;
  agents: AgentConfig[];
  centralSkills: SkillRecord[];
  initialWorkspaceItems: ExternalAgentSkill[] | null;
  onSelectAgent: (key: string) => void;
  onOpenSkillDetail: (skillId: string) => void;
  onOpenAddAgent: () => void;
  onRefreshOverview: () => Promise<void>;
}

export const AgentWorkspaceView: React.FC<AgentWorkspaceViewProps> = ({
  selectedAgentKey,
  agents,
  centralSkills,
  initialWorkspaceItems,
  onSelectAgent,
  onOpenSkillDetail,
  onOpenAddAgent,
  onRefreshOverview,
}) => {
  const { runWithMask, showErrorModal } = useFeedback();
  const [items, setItems] = useState<ExternalAgentSkill[]>(initialWorkspaceItems || []);
  const [scanning, setScanning] = useState<boolean>(initialWorkspaceItems === null);
  const [scanTargetLabel, setScanTargetLabel] = useState<string>('');
  const [libraryFilter, setLibraryFilter] = useState<string>('');
  const [checkedCentralIds, setCheckedCentralIds] = useState<Set<string>>(new Set());

  // State for viewing any skill inside the personal folder
  const [inspectingExternalSkill, setInspectingExternalSkill] = useState<{
    agentKey: string;
    dirName: string;
    initialItem?: ExternalAgentSkill;
  } | null>(null);

  const enabledAgents = agents.filter((a) => a.enabled);
  const currentAgent =
    agents.find((a) => a.key === selectedAgentKey) || enabledAgents[0] || agents[0];

  const loadWorkspace = async (key: string, signal?: AbortSignal) => {
    const targetAgent = agents.find((a) => a.key === key);
    setScanTargetLabel(
      key === 'ALL'
        ? `全部啟用的 AI 工具 (${enabledAgents.length} 個個人資料夾)`
        : `${targetAgent?.name || key} (${targetAgent?.compactPath || ''})`
    );
    setScanning(true);
    setItems([]);

    try {
      const target = key === 'ALL' ? undefined : key;
      const res = await api.scanAgentWorkspace(target, signal);
      if (signal?.aborted) return;
      setItems(res.items);
      setScanning(false);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setScanning(false);
      showErrorModal('掃描個人資料夾失敗', err.message || '無法讀取個人資料夾');
    }
  };

  useEffect(() => {
    setCheckedCentralIds(new Set());
    const controller = new AbortController();
    loadWorkspace(selectedAgentKey, controller.signal);
    return () => controller.abort();
  }, [selectedAgentKey]);

  const filteredCentralSkills = useMemo(() => {
    const q = libraryFilter.trim().toLowerCase();
    if (!q) return centralSkills;
    return centralSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.dirName.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }, [centralSkills, libraryFilter]);

  const handleManualRescan = async () => {
    await runWithMask(
      {
        loadingTitle: '正在重新掃描個人資料夾...',
        loadingSubtitle: scanTargetLabel,
        successTitle: '個人資料夾掃描完成',
        successMessage: (count) => `掃描完成，共發現 ${count} 個技能目錄。`,
        errorTitle: '重新掃描資料夾失敗',
      },
      async () => {
        const target = selectedAgentKey === 'ALL' ? undefined : selectedAgentKey;
        const res = await api.scanAgentWorkspace(target);
        setItems(res.items);
        await onRefreshOverview();
        return res.items.length;
      }
    );
  };

  const handleAdopt = async (agentKey: string, dirName: string) => {
    const agent = agents.find((a) => a.key === agentKey);
    await runWithMask(
      {
        loadingTitle: `正在將「${dirName}」納管匯入至中央技能庫...`,
        loadingSubtitle: `來源：${agent?.name || agentKey} 個人資料夾`,
        successTitle: '納管匯入成功',
        successMessage: `已成功將「${dirName}」複製納管至中央技能庫 (~/.skills-manager/skills/${dirName})，並建立同步連結！`,
        errorTitle: '納管匯入失敗',
      },
      async () => {
        await api.adoptExternalSkill(agentKey, dirName);
        await onRefreshOverview();
        const target = selectedAgentKey === 'ALL' ? undefined : selectedAgentKey;
        const ws = await api.scanAgentWorkspace(target);
        setItems(ws.items);
      }
    );
  };

  const handleToggleDeploy = async (skillId: string, agentKey: string, deploy: boolean) => {
    const agent = agents.find((a) => a.key === agentKey);
    await runWithMask(
      {
        loadingTitle: deploy
          ? `正在將「${skillId}」部署至 ${agent?.name || agentKey}...`
          : `正在從 ${agent?.name || agentKey} 移除「${skillId}」...`,
        loadingSubtitle: `目標個人資料夾：${agent?.compactPath || agentKey}/${skillId}`,
        successTitle: deploy ? '部署完成' : '已取消掛載',
        successMessage: deploy
          ? `已成功將「${skillId}」掛載至 ${agent?.name || agentKey} 的個人資料夾！`
          : `已從 ${agent?.name || agentKey} 的個人資料夾移除「${skillId}」。`,
        successDetails: `${agent?.resolvedPath || ''}/${skillId}`,
        errorTitle: deploy ? '部署技能失敗' : '取消掛載失敗',
      },
      async () => {
        await api.deploySkill(skillId, agentKey, deploy);
        await onRefreshOverview();
        const target = selectedAgentKey === 'ALL' ? undefined : selectedAgentKey;
        const ws = await api.scanAgentWorkspace(target);
        setItems(ws.items);
      }
    );
  };

  const handleBulkDeployToCurrentAgent = async (skillIds: string[], deploy: boolean) => {
    if (!currentAgent || skillIds.length === 0) return;
    await runWithMask(
      {
        loadingTitle: deploy
          ? `正在將 ${skillIds.length} 個技能高速部署至「${currentAgent.name}」底下...`
          : `正在從「${currentAgent.name}」移除 ${skillIds.length} 個技能...`,
        loadingSubtitle: `目標個人資料夾：${currentAgent.compactPath}`,
        successTitle: deploy
          ? `已部署至 ${currentAgent.name}`
          : `已從 ${currentAgent.name} 移除`,
        successMessage: (res) =>
          deploy
            ? `已成功將 ${res.affectedSkills} 個技能掛載至 ${currentAgent.name} 的個人資料夾 (${currentAgent.compactPath})！`
            : `已從 ${currentAgent.name} 的個人資料夾移除 ${res.affectedSkills} 個技能。`,
        successDetails: currentAgent.resolvedPath,
        errorTitle: deploy ? '批次部署至此工具失敗' : '批次移除失敗',
      },
      async () => {
        const res = await api.batchDeploy(skillIds, [currentAgent.key], deploy, true);
        await onRefreshOverview();
        const ws = await api.scanAgentWorkspace(currentAgent.key);
        setItems(ws.items);
        setCheckedCentralIds(new Set());
        return res;
      }
    );
  };

  const handleDownloadZip = async (skillId: string) => {
    await runWithMask(
      {
        loadingTitle: `正在打包並下載「${skillId}.zip」...`,
        successTitle: 'ZIP 壓縮檔下載完成',
        successMessage: (res) =>
          `已成功下載「${res.filename}」(${(res.sizeBytes / 1024).toFixed(1)} KB)！`,
        errorTitle: '下載 ZIP 失敗',
      },
      () => api.downloadSingleSkillZip(skillId)
    );
  };

  const handleOpenFolder = async (folderPath: string) => {
    await runWithMask(
      {
        loadingTitle: '正在呼叫系統檔案總管開啟個人資料夾...',
        loadingSubtitle: folderPath,
        successTitle: '已開啟個人資料夾',
        successMessage: '已在系統檔案總管 / Finder 開啟指定資料夾：',
        successDetails: folderPath,
        errorTitle: '開啟個人資料夾失敗',
      },
      () => api.openInOSFileManager(folderPath)
    );
  };

  const toggleCheckedCentral = (id: string) => {
    setCheckedCentralIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Opens content viewer for ANY skill in the personal folder (managed or unmanaged)
   */
  const handleViewPersonalFolderSkill = (item: ExternalAgentSkill) => {
    setInspectingExternalSkill({
      agentKey: item.agentKey,
      dirName: item.dirName,
      initialItem: item,
    });
  };

  return (
    <div className="space-y-6">
      {/* Agent Selector Pills + Add Agent Button */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={scanning}
            onClick={() => onSelectAgent('ALL')}
            className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition disabled:opacity-60 ${
              selectedAgentKey === 'ALL'
                ? 'bg-teal-500 text-slate-950'
                : 'bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-700'
            }`}
          >
            全部啟用的 AI 工具 ({enabledAgents.length})
          </button>
          {agents.map((agent) => (
            <button
              type="button"
              key={agent.key}
              disabled={scanning}
              onClick={() => onSelectAgent(agent.key)}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition disabled:opacity-60 ${
                selectedAgentKey === agent.key
                  ? 'bg-teal-500/20 border border-teal-500/50 text-teal-200'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: agent.color }}
              />
              <span>{agent.name}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onOpenAddAgent}
          className="flex items-center gap-1.5 rounded-xl border border-teal-500/40 bg-teal-500/15 px-3.5 py-2 text-xs font-semibold text-teal-300 hover:bg-teal-500/25 transition shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          新增 AI Agent
        </button>
      </div>

      {/* Selected Agent Info Banner */}
      {selectedAgentKey !== 'ALL' && currentAgent && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: currentAgent.color }}
              />
              <h2 className="text-base font-bold text-slate-100">
                {currentAgent.name} — 個人資料夾 Skills 專屬管理
              </h2>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  currentAgent.folderExists
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {currentAgent.folderExists ? '本機目錄已就緒' : '目錄尚未建立 (部署時自動建立)'}
              </span>
            </div>
            <p className="text-xs font-mono text-slate-400">
              個人／全域層級路徑：{currentAgent.compactPath} ({currentAgent.resolvedPath})
            </p>
            {currentAgent.projectPaths && currentAgent.projectPaths.length > 0 && (
              <p className="text-[11px] font-mono text-slate-500">
                專案層級路徑：{currentAgent.projectPaths.join('、')}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                handleBulkDeployToCurrentAgent(
                  centralSkills.map((s) => s.id),
                  true
                )
              }
              className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400 transition"
            >
              <Link2 className="h-3.5 w-3.5" />
              一鍵部署全部 ({centralSkills.length}) 至 {currentAgent.name}
            </button>
            <button
              type="button"
              disabled={scanning}
              onClick={handleManualRescan}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin text-teal-400' : ''}`} />
              重新掃描資料夾
            </button>
            <button
              type="button"
              onClick={() => handleOpenFolder(currentAgent.resolvedPath)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 transition"
            >
              <FolderOpen className="h-3.5 w-3.5 text-teal-400" />
              開啟個人資料夾
            </button>
          </div>
        </div>
      )}

      {/* Strictly Gate Content Until Folder Scan Completes */}
      {scanning ? (
        <div className="rounded-2xl border border-teal-500/30 bg-slate-900/80 p-12 flex flex-col items-center justify-center text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
          <div className="text-sm font-semibold text-slate-100">
            正在掃描個人資料夾：{scanTargetLabel}
          </div>
          <p className="text-xs text-slate-400">
            正在讀取目錄結構、解析 SKILL.md 並比對中央儲存庫雜湊狀態，掃描完成後將自動顯示結果...
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">
                目前實際存在於此個人資料夾中的 Skills ({items.length}) — 點擊卡片或「查看內容」即可檢視與編輯 SKILL.md
              </h3>
              {selectedAgentKey !== 'ALL' && currentAgent && items.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    handleBulkDeployToCurrentAgent(
                      items.map((i) => i.dirName),
                      false
                    )
                  }
                  className="flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
                >
                  <Trash2 className="h-3 w-3" />
                  清空此工具已掛載的全部技能 ({items.length})
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center space-y-2">
                <p className="text-sm text-slate-300">
                  掃描完成：此 AI 工具的個人資料夾中目前尚無任何技能
                </p>
                <p className="text-xs text-slate-500">
                  您可以從下方「新增 / 批次部署技能至 {currentAgent?.name || '此工具'}」勾選或一鍵部署技能。
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {items.map((item) => (
                  <div
                    key={`${item.agentKey}-${item.dirName}`}
                    onClick={() => handleViewPersonalFolderSkill(item)}
                    className="group cursor-pointer select-none rounded-2xl border border-slate-800 bg-slate-900/80 p-4 flex flex-col justify-between gap-3 hover:border-teal-500/50 hover:bg-slate-900 transition"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-sm text-slate-100 truncate group-hover:text-teal-300 transition">
                            {item.name}
                          </span>
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-400 shrink-0">
                            {item.dirName}
                          </span>
                        </div>
                        <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-teal-300 shrink-0">
                          {item.agentName}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 line-clamp-2">
                        {item.description}
                      </p>
                    </div>

                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        {item.managedByCentral ? (
                          <span className="flex items-center gap-1 text-emerald-400 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            已由中央庫納管 ({item.isSymlink ? 'Symlink/Junction' : 'Copy'})
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-400 font-medium">
                            <AlertCircle className="h-3.5 w-3.5" />
                            外部獨立建立 (尚未納管)
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {/* Every skill in the personal folder ALWAYS has a prominent "查看內容" button! */}
                        <button
                          type="button"
                          onClick={() => handleViewPersonalFolderSkill(item)}
                          className="flex items-center gap-1 rounded-lg bg-teal-500/15 border border-teal-500/40 px-2.5 py-1 text-xs font-medium text-teal-300 hover:bg-teal-500 hover:text-slate-950 transition"
                          title="查看與編輯此個人資料夾中技能的 SKILL.md 內容"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          查看內容
                        </button>

                        {!item.managedByCentral ? (
                          <button
                            type="button"
                            onClick={() => handleAdopt(item.agentKey, item.dirName)}
                            className="flex items-center gap-1 rounded-xl bg-amber-500/20 border border-amber-500/40 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/30 transition"
                          >
                            <Import className="h-3.5 w-3.5" />
                            納管匯入
                          </button>
                        ) : (
                          <>
                            {item.centralSkillId && (
                              <button
                                type="button"
                                onClick={() => handleDownloadZip(item.centralSkillId!)}
                                className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:text-teal-300"
                                title="下載此技能 ZIP"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                handleToggleDeploy(item.dirName, item.agentKey, false)
                              }
                              className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
                            >
                              取消掛載
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Dedicated Batch Deploy Picker for Current Agent */}
          {selectedAgentKey !== 'ALL' && currentAgent && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">
                    新增 / 批次部署中央技能至「{currentAgent.name}」底下 ({currentAgent.compactPath})
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    可搜尋、多選勾選或一鍵將多個技能部署至此 AI 工具的個人資料夾
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      if (checkedCentralIds.size === filteredCentralSkills.length) {
                        setCheckedCentralIds(new Set());
                      } else {
                        setCheckedCentralIds(new Set(filteredCentralSkills.map((s) => s.id)));
                      }
                    }}
                    className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-slate-200 hover:bg-slate-700"
                  >
                    {checkedCentralIds.size === filteredCentralSkills.length &&
                    filteredCentralSkills.length > 0
                      ? '取消全選'
                      : `全選顯示項目 (${filteredCentralSkills.length})`}
                  </button>

                  {checkedCentralIds.size > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          handleBulkDeployToCurrentAgent(Array.from(checkedCentralIds), true)
                        }
                        className="rounded-xl bg-teal-500 px-3.5 py-1.5 font-semibold text-slate-950 hover:bg-teal-400"
                      >
                        部署勾選 ({checkedCentralIds.size}) 至 {currentAgent.name}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleBulkDeployToCurrentAgent(Array.from(checkedCentralIds), false)
                        }
                        className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-rose-300 hover:bg-rose-500/20"
                      >
                        從 {currentAgent.name} 移除勾選 ({checkedCentralIds.size})
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  value={libraryFilter}
                  onChange={(e) => setLibraryFilter(e.target.value)}
                  placeholder={`搜尋要部署至 ${currentAgent.name} 的技能名稱...`}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 max-h-96 overflow-y-auto pr-1">
                {filteredCentralSkills.map((skill) => {
                  const deployed = Boolean(skill.deployments[currentAgent.key]?.deployed);
                  const checked = checkedCentralIds.has(skill.id);
                  return (
                    <div
                      key={skill.id}
                      onClick={() => toggleCheckedCentral(skill.id)}
                      className={`cursor-pointer select-none flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs transition ${
                        checked
                          ? 'border-teal-500/60 bg-teal-500/10'
                          : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        {checked ? (
                          <CheckSquare className="h-4 w-4 text-teal-400 shrink-0" />
                        ) : (
                          <Square className="h-4 w-4 text-slate-500 shrink-0" />
                        )}
                        <div className="truncate">
                          <div className="font-medium text-slate-200 truncate">{skill.name}</div>
                          <div className="text-[11px] text-slate-500 font-mono truncate">
                            {skill.dirName}
                          </div>
                        </div>
                      </div>
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 shrink-0"
                      >
                        <button
                          type="button"
                          onClick={() => onOpenSkillDetail(skill.id)}
                          className="rounded-lg bg-slate-800 p-1.5 text-slate-400 hover:text-teal-300"
                          title="查看中央技能庫內容"
                        >
                          <Eye className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleDeploy(skill.id, currentAgent.key, !deployed)
                          }
                          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium transition ${
                            deployed
                              ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
                              : 'bg-slate-800 text-slate-300 hover:bg-teal-500 hover:text-slate-950'
                          }`}
                        >
                          {deployed ? (
                            <>
                              <Link2 className="h-3 w-3" />
                              已部署
                            </>
                          ) : (
                            <>
                              <Plus className="h-3 w-3" />
                              部署
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal to view & edit SKILL.md of ANY skill inside the personal folder */}
      <ExternalSkillDetailModal
        key={
          inspectingExternalSkill
            ? `${inspectingExternalSkill.agentKey}:${inspectingExternalSkill.dirName}`
            : 'closed'
        }
        target={inspectingExternalSkill}
        onClose={() => setInspectingExternalSkill(null)}
        onAdopt={handleAdopt}
        onUpdated={async () => {
          const target = selectedAgentKey === 'ALL' ? undefined : selectedAgentKey;
          const ws = await api.scanAgentWorkspace(target);
          setItems(ws.items);
          await onRefreshOverview();
        }}
      />
    </div>
  );
};
