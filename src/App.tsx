import React, { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Upload,
  Download,
  Search,
  Layers,
  HardDrive,
  Settings,
  ShieldCheck,
  FolderOpen,
  Plus,
  Trash2,
  CheckSquare,
  Square,
  LayoutGrid,
  List,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Eye,
  Send,
  Bot,
  Cpu,
} from 'lucide-react';
import { api } from './api';
import { ExternalAgentSkill, OverviewResponse, Preset, SkillRecord } from './types';
import { ImportModal } from './components/ImportModal';
import { SkillDetailModal } from './components/SkillDetailModal';
import { BatchDeployModal } from './components/BatchDeployModal';
import { AddAgentModal } from './components/AddAgentModal';
import { AiAgentsView } from './components/AiAgentsView';
import { McpView } from './components/McpView';
import { AgentWorkspaceView } from './components/AgentWorkspaceView';
import { BackupView } from './components/BackupView';
import { SettingsView } from './components/SettingsView';
import { useFeedback } from './components/FeedbackSystem';

/**
 * Normalizes search query so `-`, `_`, and spaces match equivalently (matching upstream v1.42.0).
 */
function normalizeSearchToken(input: string): string {
  return input.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

export function App() {
  const { runWithMask, showErrorModal } = useFeedback();

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [initialWorkspaceItems, setInitialWorkspaceItems] = useState<ExternalAgentSkill[] | null>(null);
  const [initialBootScanning, setInitialBootScanning] = useState<boolean>(true);
  const [bootStageText, setBootStageText] = useState<string>('正在連線至本機 Node.js 服務 (127.0.0.1)...');
  const [bootError, setBootError] = useState<string | null>(null);

  const [activeNav, setActiveNav] = useState<'library' | 'subagents' | 'mcp' | 'workspace' | 'backups' | 'settings'>('library');
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [selectedSource, setSelectedSource] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Modals & Selection
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [addAgentModalOpen, setAddAgentModalOpen] = useState(false);
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());

  // Target Agent Deployment Modal state
  const [batchDeployModalState, setBatchDeployModalState] = useState<{
    open: boolean;
    title?: string;
    skillIds: string[];
  }>({ open: false, skillIds: [] });

  // Preset creation inline state
  const [creatingPreset, setCreatingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  /**
   * Fast background data refresh
   */
  const refreshDataSilently = async () => {
    const overviewRes = await api.getOverview();
    setOverview(overviewRes);
    return overviewRes;
  };

  /**
   * Initial Boot Scan Gate
   */
  const runInitialBootScan = async () => {
    setInitialBootScanning(true);
    setBootError(null);
    setBootStageText('步驟 1/3：正在掃描中央技能庫 (~/.skills-manager/skills) 與 SKILL.md 索引...');

    try {
      const overviewRes = await api.getOverview();
      setBootStageText(
        `步驟 2/3：正在掃描 ${overviewRes.agents.filter((a) => a.enabled).length} 款已啟用 AI 工具的個人資料夾部署狀態...`
      );

      const workspaceRes = await api.scanAgentWorkspace();
      setBootStageText('步驟 3/3：正在完成 SHA-256 內容雜湊與連結驗證...');

      setOverview(overviewRes);
      setInitialWorkspaceItems(workspaceRes.items);
      setInitialBootScanning(false);
    } catch (err: any) {
      setBootError(err.message || '無法連線至本機 Node.js 服務');
    }
  };

  /**
   * Manual Full Rescan with Full-Screen Mask & Result Modal
   */
  const handleManualFullScan = async () => {
    await runWithMask(
      {
        loadingTitle: '正在重新掃描中央技能庫與各 AI 工具個人資料夾...',
        loadingSubtitle: '正在讀取 ~/.skills-manager/skills 與 GitHub Copilot、Claude Code、OpenAI Codex 的個人資料夾狀態...',
        successTitle: '全機掃描完成',
        successMessage: (res) =>
          `已完成同步掃描：中央技能庫共 ${res.overviewRes.skills.length} 個技能，已啟用的 AI 工具個人資料夾共偵測到 ${res.workspaceRes.items.length} 個掛載項目。`,
        errorTitle: '重新掃描失敗',
      },
      async () => {
        const [overviewRes, workspaceRes] = await Promise.all([
          api.getOverview(),
          api.scanAgentWorkspace(),
        ]);
        setOverview(overviewRes);
        setInitialWorkspaceItems(workspaceRes.items);
        return { overviewRes, workspaceRes };
      }
    );
  };

  useEffect(() => {
    runInitialBootScan();
  }, []);

  const skills = overview?.skills || [];
  const subagents = overview?.subagents || [];
  const mcpServers = overview?.mcpServers || [];
  const agents = overview?.agents || [];
  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents]);
  const presets = overview?.presets || [];

  const activeDetailSkill = useMemo(
    () => (detailSkillId ? skills.find((s) => s.id === detailSkillId) || null : null),
    [skills, detailSkillId]
  );

  const allTags = useMemo(() => {
    const set = new Set<string>();
    skills.forEach((s) => s.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [skills]);

  const filteredSkills = useMemo(() => {
    const q = normalizeSearchToken(searchQuery);
    return skills.filter((skill) => {
      if (selectedTag === 'UNTAGGED' && skill.tags.length > 0) return false;
      if (selectedTag !== 'ALL' && selectedTag !== 'UNTAGGED' && !skill.tags.includes(selectedTag)) {
        return false;
      }
      if (selectedSource !== 'ALL' && skill.sourceType !== selectedSource) {
        return false;
      }
      if (!q) return true;
      const haystack = normalizeSearchToken(
        `${skill.name} ${skill.dirName} ${skill.description} ${skill.tags.join(' ')}`
      );
      return haystack.includes(q);
    });
  }, [skills, searchQuery, selectedTag, selectedSource]);

  const toggleSelectSkill = (id: string) => {
    setSelectedSkillIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenSkillDetail = (skillId: string) => {
    setDetailSkillId(skillId);
  };

  const openTargetDeployPicker = (skillIds: string[], customTitle?: string) => {
    if (skillIds.length === 0) {
      showErrorModal('尚無可部署的技能', '請先勾選或確保列表中有至少一個技能。');
      return;
    }
    setBatchDeployModalState({
      open: true,
      title: customTitle,
      skillIds,
    });
  };

  const handleToggleAgentOnCard = async (
    e: React.MouseEvent,
    skill: SkillRecord,
    agentKey: string
  ) => {
    e.stopPropagation();
    const currentlyDeployed = Boolean(skill.deployments[agentKey]?.deployed);
    const agent = agents.find((a) => a.key === agentKey);
    const agentName = agent?.name || agentKey;

    await runWithMask(
      {
        loadingTitle: !currentlyDeployed
          ? `正在將「${skill.name}」部署至 ${agentName}...`
          : `正在從 ${agentName} 移除「${skill.name}」...`,
        loadingSubtitle: `目標個人資料夾：${agent?.compactPath || agentKey}/${skill.dirName}`,
        successTitle: !currentlyDeployed ? '技能部署成功' : '已取消部署',
        successMessage: !currentlyDeployed
          ? `已成功將「${skill.name}」掛載至 ${agentName} 個人資料夾！`
          : `已從 ${agentName} 個人資料夾移除「${skill.name}」。`,
        successDetails: `${agent?.resolvedPath || ''}/${skill.dirName}`,
        errorTitle: !currentlyDeployed ? '部署技能失敗' : '移除技能部署失敗',
      },
      async () => {
        const res = await api.deploySkill(skill.id, agentKey, !currentlyDeployed);
        setOverview((prev) =>
          prev
            ? {
                ...prev,
                skills: prev.skills.map((s) => (s.id === res.skill.id ? res.skill : s)),
              }
            : prev
        );
      }
    );
  };

  const handleDownloadSingleZipOnCard = async (e: React.MouseEvent, skillId: string) => {
    e.stopPropagation();
    await runWithMask(
      {
        loadingTitle: `正在打包並下載「${skillId}.zip」...`,
        loadingSubtitle: '正在壓縮技能目錄內所有檔案...',
        successTitle: 'ZIP 壓縮檔下載完成',
        successMessage: (res) =>
          `已成功打包並下載「${res.filename}」(${(res.sizeBytes / 1024).toFixed(1)} KB)！`,
        errorTitle: '下載技能 ZIP 失敗',
      },
      () => api.downloadSingleSkillZip(skillId)
    );
  };

  const handleExportZipBundle = async (skillIds: string[], filename: string) => {
    await runWithMask(
      {
        loadingTitle: `正在打包並下載「${filename}」...`,
        loadingSubtitle:
          skillIds.length > 0
            ? `正在壓縮所選的 ${skillIds.length} 個技能目錄...`
            : `正在壓縮中央儲存庫全部 ${skills.length} 個技能目錄...`,
        successTitle: 'ZIP 壓縮包下載完成',
        successMessage: (res) =>
          `已成功匯出並下載「${res.filename}」(${(res.sizeBytes / 1024).toFixed(1)} KB)！`,
        errorTitle: '匯出 ZIP 壓縮包失敗',
      },
      () => api.exportSkillsZipBundle(skillIds, filename)
    );
  };

  const handleApplyPreset = async (preset: Preset) => {
    const nextDeploy = !preset.active;
    await runWithMask(
      {
        loadingTitle: nextDeploy
          ? `正在啟用並高速部署場景「${preset.name}」...`
          : `正在停用場景「${preset.name}」並移除掛載...`,
        loadingSubtitle: `涵蓋 ${preset.skillIds.length} 個技能 × ${enabledAgents.length} 款已啟用 AI 工具`,
        successTitle: nextDeploy ? '場景已啟用並同步部署' : '場景已停用',
        successMessage: nextDeploy
          ? `已成功將場景「${preset.name}」內的 ${preset.skillIds.length} 個技能部署至所有已啟用的 AI 工具個人資料夾！`
          : `已停用場景「${preset.name}」並從已啟用的 AI 工具移除對應掛載。`,
        errorTitle: '切換場景失敗',
      },
      async () => {
        const res = await api.applyPreset(preset.id, nextDeploy);
        setOverview((prev) =>
          prev ? { ...prev, presets: res.presets, skills: res.skills } : prev
        );
      }
    );
  };

  const handleCreatePresetFromSelection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) {
      showErrorModal('場景名稱不可為空', '請輸入新場景預設組合的名稱。');
      return;
    }
    const ids =
      selectedSkillIds.size > 0
        ? Array.from(selectedSkillIds)
        : filteredSkills.map((s) => s.id);
    if (ids.length === 0) {
      showErrorModal('無可用技能', '請先勾選或確保列表中有至少一個技能可加入場景。');
      return;
    }
    const nameToCreate = newPresetName.trim();

    await runWithMask(
      {
        loadingTitle: `正在建立新場景「${nameToCreate}」...`,
        successTitle: '場景預設組合已建立',
        successMessage: `已成功建立場景「${nameToCreate}」（包含 ${ids.length} 個技能）！`,
        errorTitle: '建立場景失敗',
      },
      async () => {
        const res = await api.createPreset({
          name: nameToCreate,
          description: `包含 ${ids.length} 個技能的快速組合`,
          skillIds: ids,
        });
        setNewPresetName('');
        setCreatingPreset(false);
        setOverview((prev) => (prev ? { ...prev, presets: res.presets } : prev));
      }
    );
  };

  const handleBatchDeployAllEnabled = async (deploy: boolean) => {
    const ids = Array.from(selectedSkillIds);
    if (ids.length === 0) return;
    if (enabledAgents.length === 0) {
      showErrorModal('無已啟用的 AI 工具', '請先選擇指定工具或至「工具路徑與系統設定」啟用至少一款 AI 工具。');
      return;
    }

    await runWithMask(
      {
        loadingTitle: deploy
          ? `正在高速批次部署 ${ids.length} 個技能至所有已啟用的 AI 工具...`
          : `正在從所有已啟用的 AI 工具批次移除 ${ids.length} 個技能...`,
        loadingSubtitle: `目標工具：${enabledAgents.map((a) => a.name).join('、')}`,
        successTitle: deploy ? '批次部署完成' : '批次取消部署完成',
        successMessage: (res) =>
          deploy
            ? `已成功將所選的 ${res.affectedSkills} 個技能同步掛載至 ${res.affectedAgents} 款 AI 工具的個人資料夾！`
            : `已從 ${res.affectedAgents} 款 AI 工具的個人資料夾移除所選的 ${res.affectedSkills} 個技能。`,
        errorTitle: deploy ? '批次部署失敗' : '批次取消部署失敗',
      },
      async () => {
        const res = await api.batchDeploy(
          ids,
          enabledAgents.map((a) => a.key),
          deploy
        );
        setOverview((prev) =>
          prev
            ? {
                ...prev,
                skills: res.skills,
                agents: res.agents || prev.agents,
              }
            : prev
        );
        return res;
      }
    );
  };

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedSkillIds);
    if (ids.length === 0) return;
    if (!window.confirm(`確定要從中央儲存庫與所有 AI 工具中永久刪除所選的 ${ids.length} 個技能嗎？`)) {
      return;
    }

    await runWithMask(
      {
        loadingTitle: `正在刪除所選的 ${ids.length} 個技能...`,
        loadingSubtitle: `正在清理各 AI 工具個人資料夾掛載與中央技能庫目錄...`,
        successTitle: '批次刪除完成',
        successMessage: `已永久刪除所選的 ${ids.length} 個技能並清除所有對應掛載。`,
        errorTitle: '批次刪除失敗',
      },
      async () => {
        const res = await api.deleteSkills(ids);
        setSelectedSkillIds(new Set());
        setOverview((prev) => (prev ? { ...prev, skills: res.skills } : prev));
      }
    );
  };

  const handleOpenRepoFolder = async () => {
    if (!overview?.centralRepoPath) return;
    await runWithMask(
      {
        loadingTitle: '正在呼叫系統檔案總管開啟中央儲存庫...',
        loadingSubtitle: overview.centralRepoPath,
        successTitle: '已開啟中央儲存庫資料夾',
        successMessage: '已在系統檔案總管 / Finder 開啟目錄：',
        successDetails: overview.centralRepoPath,
        errorTitle: '開啟儲存庫資料夾失敗',
      },
      () => api.openInOSFileManager(overview.centralRepoPath)
    );
  };

  // ==================== Startup Scan Gate ====================
  if (initialBootScanning || !overview) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl text-center space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-cyan-600 text-slate-950 font-black text-3xl shadow-lg shadow-teal-500/20">
            S
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/15 border border-teal-500/30 px-3 py-1 text-xs font-semibold text-teal-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              100% 純本機離線服務
            </div>
            <h1 className="text-xl font-bold text-slate-100">
              正在掃描本機 AI Skills 儲存庫...
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              請稍候，系統正在完整掃描您的中央技能庫與各 AI 工具個人資料夾，掃描完成後將自動進入管理畫面。
            </p>
          </div>

          {bootError ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-300">
                {bootError}
              </div>
              <button
                type="button"
                onClick={runInitialBootScan}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-teal-400 transition"
              >
                <RefreshCw className="h-4 w-4" />
                重新掃描並連線
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3 text-left text-xs">
              <div className="flex items-center gap-2.5 text-teal-300 font-medium">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>{bootStageText}</span>
              </div>
              <div className="space-y-1.5 pl-6 text-[11px] text-slate-400">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-teal-400" />
                  <span>檢查 ~/.skills-manager/skills 中央索引</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-teal-400" />
                  <span>檢查 GitHub Copilot、Claude Code、OpenAI Codex 個人目錄部署連結</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Sidebar */}
      <aside className="w-68 border-r border-slate-800/80 bg-slate-900/60 flex flex-col justify-between p-4 shrink-0">
        <div className="space-y-6">
          {/* Brand Logo */}
          <div className="flex items-center gap-3 px-2 pt-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-cyan-600 text-slate-950 font-black text-lg shadow-lg shadow-teal-500/20">
              S
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-bold text-sm tracking-tight text-slate-100">
                  Skills Manager
                </h1>
                <span className="rounded-md bg-teal-500/20 border border-teal-500/40 px-1.5 py-0.2 text-[10px] font-semibold text-teal-300">
                  OFFLINE
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                React + Node.js + System Tray
              </p>
            </div>
          </div>

          {/* Primary Navigation: Clearly separates AI Skills, AI Agents, and MCP */}
          <nav className="space-y-1">
            <button
              type="button"
              onClick={() => setActiveNav('library')}
              className={`w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition ${
                activeNav === 'library'
                  ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Boxes className="h-4 w-4 text-teal-400" />
                AI Skills 技能庫
              </span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                {skills.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveNav('subagents')}
              className={`w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition ${
                activeNav === 'subagents'
                  ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Bot className="h-4 w-4 text-violet-400" />
                AI Agents 代理庫
              </span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                {subagents.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveNav('mcp')}
              className={`w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition ${
                activeNav === 'mcp'
                  ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Cpu className="h-4 w-4 text-emerald-400" />
                MCP 伺服器管理
              </span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                {mcpServers.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveNav('workspace')}
              className={`w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition ${
                activeNav === 'workspace'
                  ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Layers className="h-4 w-4" />
                各 AI 工具個人資料夾
              </span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                {enabledAgents.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveNav('backups')}
              className={`w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition ${
                activeNav === 'backups'
                  ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <HardDrive className="h-4 w-4" />
                本機 ZIP 備份與紀錄
              </span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                {overview.snapshots.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveNav('settings')}
              className={`w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition ${
                activeNav === 'settings'
                  ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Settings className="h-4 w-4" />
                工具路徑與系統設定
              </span>
            </button>
          </nav>

          {/* Quick Jump to Individual AI Agent Personal Folders */}
          <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
            <div className="px-3 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                AI 工具個人資料夾
              </span>
              <button
                type="button"
                onClick={() => setAddAgentModalOpen(true)}
                className="flex items-center gap-0.5 rounded-md bg-teal-500/15 border border-teal-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-teal-300 hover:bg-teal-500 hover:text-slate-950 transition"
                title="新增自訂 AI Agent"
              >
                <Plus className="h-2.5 w-2.5" />
                新增 Agent
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-0.5 pr-1">
              {enabledAgents.map((agent) => {
                const deployedCount = skills.filter(
                  (s) => s.deployments[agent.key]?.deployed
                ).length;
                return (
                  <button
                    type="button"
                    key={agent.key}
                    onClick={() => {
                      setSelectedAgentKey(agent.key);
                      setActiveNav('workspace');
                    }}
                    className={`w-full flex items-center justify-between rounded-xl px-3 py-2 text-xs transition ${
                      activeNav === 'workspace' && selectedAgentKey === agent.key
                        ? 'bg-slate-800 text-teal-300 font-medium'
                        : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: agent.color }}
                      />
                      <span className="truncate">{agent.name}</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {deployedCount}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Offline & Tray Status Footer */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3.5 space-y-2 text-[11px]">
          <div className="flex items-center gap-2 text-teal-300 font-semibold">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>100% 純本機無外網模式</span>
          </div>
          <div className="text-slate-400 font-mono truncate">
            庫位址: {overview.compactCentralRepoPath}
          </div>
          <div className="flex items-center justify-between text-slate-400 pt-1 border-t border-slate-800/80">
            <span>
              System Tray:{' '}
              {overview.trayStatus.active ? '🟢 常駐中' : '⚪ 本機背景服務'}
            </span>
            <button
              type="button"
              onClick={handleOpenRepoFolder}
              className="text-teal-400 hover:underline flex items-center gap-1"
            >
              <FolderOpen className="h-3 w-3" />
              開啟
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="border-b border-slate-800/80 bg-slate-900/40 px-8 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              {activeNav === 'library' && 'AI Skills 技能庫管理 (SKILL.md 技能模組)'}
              {activeNav === 'subagents' && 'AI Agents 專屬角色代理庫 (Subagents / Custom Agents)'}
              {activeNav === 'mcp' && 'MCP (Model Context Protocol) 本機伺服器管理'}
              {activeNav === 'workspace' && '各 AI 工具個人資料夾對應管理 (Global Workspaces)'}
              {activeNav === 'backups' && '本機離線 ZIP 備份快照與紀錄'}
              {activeNav === 'settings' && 'AI Skills / AI Agents / MCP 路徑對照與系統設定'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              統一管理 GitHub Copilot、Claude Code、OpenAI Codex 在個人／全域目錄下的 Skills
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleManualFullScan}
              className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 transition"
              title="重新掃描本機技能庫與所有工具資料夾"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重新掃描
            </button>

            <button
              type="button"
              onClick={() => {
                const ids =
                  selectedSkillIds.size > 0
                    ? Array.from(selectedSkillIds)
                    : filteredSkills.map((s) => s.id);
                openTargetDeployPicker(
                  ids,
                  selectedSkillIds.size > 0
                    ? `將已勾選的 ${selectedSkillIds.size} 個技能部署至指定 AI 工具`
                    : `將列表中的 ${ids.length} 個技能部署至指定 AI 工具`
                );
              }}
              className="flex items-center gap-1.5 rounded-xl border border-teal-500/40 bg-teal-500/15 px-3.5 py-2 text-xs font-semibold text-teal-200 hover:bg-teal-500/25 transition"
            >
              <Send className="h-3.5 w-3.5 text-teal-400" />
              {selectedSkillIds.size > 0
                ? `部署已選 (${selectedSkillIds.size}) 至指定工具...`
                : '部署至指定 AI 工具...'}
            </button>

            <button
              type="button"
              onClick={() =>
                handleExportZipBundle(
                  selectedSkillIds.size > 0 ? Array.from(selectedSkillIds) : [],
                  selectedSkillIds.size > 0
                    ? `selected-skills-${selectedSkillIds.size}.zip`
                    : `all-skills-${new Date().toISOString().slice(0, 10)}.zip`
                )
              }
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
            >
              <Download className="h-3.5 w-3.5 text-teal-400" />
              {selectedSkillIds.size > 0
                ? `下載已選 (${selectedSkillIds.size}) ZIP`
                : '下載全部 Skills (.zip)'}
            </button>

            <button
              type="button"
              onClick={() => setImportModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400 shadow-lg shadow-teal-500/15 transition"
            >
              <Upload className="h-3.5 w-3.5" />
              匯入 ZIP / 本機資料夾
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-8 overflow-y-auto space-y-6 relative">
          {activeNav === 'library' && (
            <>
              {/* Presets Bar */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-teal-400" />
                    場景預設組合 (Presets — 點擊可部署至全部啟用工具，或點擊「指定工具」挑選目標 AI 工具)：
                  </span>
                  <button
                    type="button"
                    onClick={() => setCreatingPreset(!creatingPreset)}
                    className="flex items-center gap-1 text-xs text-teal-400 hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    將目前選取建立為新場景
                  </button>
                </div>

                {creatingPreset && (
                  <form onSubmit={handleCreatePresetFromSelection} className="flex gap-2">
                    <input
                      type="text"
                      value={newPresetName}
                      onChange={(e) => setNewPresetName(e.target.value)}
                      placeholder="輸入場景名稱 (例如：前端 React 審查組合)..."
                      className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100"
                    />
                    <button
                      type="submit"
                      className="rounded-xl bg-teal-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950"
                    >
                      儲存場景
                    </button>
                  </form>
                )}

                <div className="flex flex-wrap gap-2">
                  {presets.map((preset) => (
                    <div
                      key={preset.id}
                      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition ${
                        preset.active
                          ? 'border-teal-500/50 bg-teal-500/15 text-teal-200'
                          : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleApplyPreset(preset)}
                        className="flex items-center gap-1.5 font-medium"
                        title={preset.description}
                      >
                        <span>{preset.active ? '✓' : '○'}</span>
                        <span>{preset.name}</span>
                        <span className="rounded-full bg-slate-800 px-1.5 py-0.2 text-[10px] text-slate-400">
                          {preset.skillIds.length}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          openTargetDeployPicker(
                            preset.skillIds,
                            `將場景「${preset.name}」部署至指定 AI 工具`
                          )
                        }
                        className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-teal-300 hover:bg-teal-500 hover:text-slate-950 transition"
                        title="選擇要將此場景部署到哪幾個 AI 工具"
                      >
                        指定工具
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleExportZipBundle(
                            preset.skillIds,
                            `preset-${preset.name}.zip`
                          )
                        }
                        className="text-slate-400 hover:text-teal-300"
                        title="下載此場景所有技能 (.zip)"
                      >
                        <Download className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Search, Source Filter, Tag Filter & View Switcher */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[260px]">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="搜尋技能名稱、資料夾代號、描述或標籤 (連字號 -、底線 _ 與空白自動視為相同)..."
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 pl-10 pr-4 py-2 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedSource}
                    onChange={(e) => setSelectedSource(e.target.value)}
                    className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200 focus:border-teal-500 focus:outline-none"
                  >
                    <option value="ALL">所有來源 ({skills.length})</option>
                    <option value="zip">ZIP 壓縮包匯入</option>
                    <option value="local-folder">本機資料夾匯入</option>
                    <option value="adopted">AI 工具個人資料夾納管</option>
                    <option value="manual">手動建立</option>
                  </select>

                  <div className="flex rounded-xl border border-slate-800 bg-slate-900 p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode('grid')}
                      className={`rounded-lg p-1.5 ${
                        viewMode === 'grid'
                          ? 'bg-slate-800 text-teal-300'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="卡片檢視"
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('list')}
                      className={`rounded-lg p-1.5 ${
                        viewMode === 'list'
                          ? 'bg-slate-800 text-teal-300'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="列表檢視"
                    >
                      <List className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Tag Filter Pills & Batch Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedTag('ALL')}
                    className={`rounded-lg px-2.5 py-1 text-xs transition ${
                      selectedTag === 'ALL'
                        ? 'bg-teal-500 text-slate-950 font-semibold'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    全部標籤
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedTag('UNTAGGED')}
                    className={`rounded-lg px-2.5 py-1 text-xs transition ${
                      selectedTag === 'UNTAGGED'
                        ? 'bg-teal-500 text-slate-950 font-semibold'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    未分類 (Untagged)
                  </button>
                  {allTags.map((tag) => (
                    <button
                      type="button"
                      key={tag}
                      onClick={() => setSelectedTag(tag)}
                      className={`rounded-lg px-2.5 py-1 text-xs transition ${
                        selectedTag === tag
                          ? 'bg-teal-500 text-slate-950 font-semibold'
                          : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>

                {/* Multi-select Batch Operations */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedSkillIds.size === filteredSkills.length) {
                        setSelectedSkillIds(new Set());
                      } else {
                        setSelectedSkillIds(new Set(filteredSkills.map((s) => s.id)));
                      }
                    }}
                    className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-slate-300 hover:bg-slate-800"
                  >
                    {selectedSkillIds.size === filteredSkills.length && filteredSkills.length > 0
                      ? '取消全選'
                      : `全選目前列表 (${filteredSkills.length})`}
                  </button>

                  {selectedSkillIds.size > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          openTargetDeployPicker(
                            Array.from(selectedSkillIds),
                            `將所選的 ${selectedSkillIds.size} 個技能部署至指定 AI 工具`
                          )
                        }
                        className="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-1 font-semibold text-slate-950 hover:bg-teal-400"
                      >
                        <Send className="h-3 w-3" />
                        部署至指定 AI 工具 ({selectedSkillIds.size})...
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBatchDeployAllEnabled(true)}
                        className="rounded-lg bg-teal-500/20 border border-teal-500/40 px-2.5 py-1 text-teal-300 hover:bg-teal-500/30"
                      >
                        快速部署至所有已啟用工具
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBatchDeployAllEnabled(false)}
                        className="rounded-lg bg-slate-800 px-2.5 py-1 text-slate-300 hover:bg-slate-700"
                      >
                        從所有工具取消部署
                      </button>
                      <button
                        type="button"
                        onClick={handleBatchDelete}
                        className="flex items-center gap-1 rounded-lg bg-rose-500/15 border border-rose-500/30 px-2.5 py-1 text-rose-300 hover:bg-rose-500/25"
                      >
                        <Trash2 className="h-3 w-3" />
                        批次刪除 ({selectedSkillIds.size})
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Skills Grid / List */}
              <div
                className={
                  viewMode === 'grid'
                    ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'
                    : 'space-y-2.5'
                }
              >
                {filteredSkills.map((skill) => {
                  const isSelected = selectedSkillIds.has(skill.id);
                  const isDetailOpen = detailSkillId === skill.id;
                  return (
                    <div
                      key={skill.id}
                      onClick={() => handleOpenSkillDetail(skill.id)}
                      className={`group cursor-pointer select-none rounded-2xl border p-5 transition flex flex-col justify-between gap-4 ${
                        isDetailOpen
                          ? 'border-teal-400 bg-teal-500/10 ring-1 ring-teal-400/50'
                          : isSelected
                          ? 'border-teal-500/60 bg-teal-500/5'
                          : 'border-slate-800/90 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSelectSkill(skill.id);
                              }}
                              className="text-slate-400 hover:text-teal-400 shrink-0 p-0.5"
                            >
                              {isSelected ? (
                                <CheckSquare className="h-4 w-4 text-teal-400" />
                              ) : (
                                <Square className="h-4 w-4" />
                              )}
                            </button>
                            <h3 className="font-bold text-sm text-slate-100 truncate group-hover:text-teal-300 transition">
                              {skill.name}
                            </h3>
                          </div>

                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1.5 shrink-0"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                openTargetDeployPicker(
                                  [skill.id],
                                  `將「${skill.name}」部署至指定 AI 工具`
                                )
                              }
                              className="flex items-center gap-1 rounded-lg bg-teal-500/15 border border-teal-500/30 px-2 py-1 text-[11px] font-medium text-teal-300 hover:bg-teal-500 hover:text-slate-950 transition"
                              title="選擇要部署的目標 AI 工具"
                            >
                              <Send className="h-3 w-3" />
                              指定工具
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenSkillDetail(skill.id)}
                              className="flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-teal-500 hover:text-slate-950 transition"
                              title="查看與編輯此 Skill 的 SKILL.md 內容"
                            >
                              <Eye className="h-3 w-3" />
                              內容
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDownloadSingleZipOnCard(e, skill.id)}
                              className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:bg-teal-500 hover:text-slate-950 transition"
                              title="下載此 Skill 的 ZIP 壓縮檔"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                          {skill.description}
                        </p>

                        {skill.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {skill.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-md bg-slate-800/90 px-2 py-0.5 text-[10px] text-teal-300"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Agent Deployment Badges Row */}
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="border-t border-slate-800/80 pt-3 space-y-1.5"
                      >
                        <div className="text-[10px] text-slate-500 flex items-center justify-between">
                          <span>點擊下方 AI 工具標籤即可掛載 / 移除個人資料夾同步：</span>
                          <span className="font-mono">{skill.fileCount} files</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {enabledAgents.map((agent) => {
                            const dep = skill.deployments[agent.key];
                            const deployed = Boolean(dep?.deployed);
                            return (
                              <button
                                type="button"
                                key={agent.key}
                                onClick={(e) =>
                                  handleToggleAgentOnCard(e, skill, agent.key)
                                }
                                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                                  deployed
                                    ? 'border-teal-500/50 bg-teal-500/15 text-teal-200'
                                    : 'border-slate-800 bg-slate-950/60 text-slate-500 hover:border-slate-700 hover:text-slate-300'
                                }`}
                                title={`${agent.name} (${agent.compactPath}/${skill.dirName})`}
                              >
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{
                                    backgroundColor: deployed ? agent.color : '#475569',
                                  }}
                                />
                                <span>{agent.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {activeNav === 'subagents' && (
            <AiAgentsView
              subagents={subagents}
              agents={agents}
              onRefreshOverview={async () => {
                await refreshDataSilently();
              }}
            />
          )}

          {activeNav === 'mcp' && (
            <McpView
              mcpServers={mcpServers}
              agents={agents}
              onRefreshOverview={async () => {
                await refreshDataSilently();
              }}
            />
          )}

          {activeNav === 'workspace' && (
            <AgentWorkspaceView
              selectedAgentKey={selectedAgentKey}
              agents={agents}
              centralSkills={skills}
              initialWorkspaceItems={initialWorkspaceItems}
              onSelectAgent={setSelectedAgentKey}
              onOpenSkillDetail={handleOpenSkillDetail}
              onOpenAddAgent={() => setAddAgentModalOpen(true)}
              onRefreshOverview={async () => {
                await refreshDataSilently();
              }}
            />
          )}

          {activeNav === 'backups' && (
            <BackupView
              snapshots={overview.snapshots}
              activityLogs={overview.activityLogs}
              onRefresh={async () => {
                await refreshDataSilently();
              }}
            />
          )}

          {activeNav === 'settings' && (
            <SettingsView
              settings={overview.settings}
              agents={overview.agents}
              trayStatus={overview.trayStatus}
              onOpenAddAgent={() => setAddAgentModalOpen(true)}
              onRefresh={async () => {
                await refreshDataSilently();
              }}
            />
          )}
        </div>
      </main>

      {/* Modals */}
      <ImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={async () => {
          await refreshDataSilently();
        }}
      />

      <AddAgentModal
        open={addAgentModalOpen}
        onClose={() => setAddAgentModalOpen(false)}
        onAdded={async () => {
          await refreshDataSilently();
        }}
      />

      <BatchDeployModal
        open={batchDeployModalState.open}
        title={batchDeployModalState.title}
        targetSkillIds={batchDeployModalState.skillIds}
        skills={skills}
        agents={agents}
        onClose={() => setBatchDeployModalState((prev) => ({ ...prev, open: false }))}
        onCompleted={(updatedSkills, updatedAgents) => {
          setOverview((prev) =>
            prev
              ? {
                  ...prev,
                  skills: updatedSkills,
                  agents: updatedAgents || prev.agents,
                }
              : prev
          );
        }}
      />

      {/* Keyed by detailSkillId so React always mounts a fresh instance for the newly clicked skill */}
      <SkillDetailModal
        key={detailSkillId || 'closed'}
        skillId={detailSkillId}
        initialSkill={activeDetailSkill}
        agents={agents}
        onClose={() => setDetailSkillId(null)}
        onUpdated={async (updatedSkill) => {
          setOverview((prev) =>
            prev
              ? {
                  ...prev,
                  skills: prev.skills.map((s) =>
                    s.id === updatedSkill.id ? updatedSkill : s
                  ),
                }
              : prev
          );
        }}
        onDeleted={async (id) => {
          await runWithMask(
            {
              loadingTitle: `正在刪除技能「${id}」...`,
              loadingSubtitle: '正在從所有已掛載的 AI 工具個人資料夾與中央儲存庫移除...',
              successTitle: '技能已刪除',
              successMessage: `已成功從中央儲存庫與所有 AI 工具移除技能「${id}」。`,
              errorTitle: '刪除技能失敗',
            },
            async () => {
              const res = await api.deleteSkills([id]);
              setOverview((prev) => (prev ? { ...prev, skills: res.skills } : prev));
            }
          );
        }}
      />
    </div>
  );
}
