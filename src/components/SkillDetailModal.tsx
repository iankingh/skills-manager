import React, { useEffect, useState } from 'react';
import {
  X,
  Download,
  FolderOpen,
  Save,
  Tag,
  FileText,
  Trash2,
  Loader2,
} from 'lucide-react';
import { api } from '../api';
import { AgentConfig, SkillRecord } from '../types';
import { useFeedback } from './FeedbackSystem';

interface SkillDetailModalProps {
  skillId: string | null;
  initialSkill: SkillRecord | null;
  agents: AgentConfig[];
  onClose: () => void;
  onUpdated: (skill: SkillRecord) => Promise<void> | void;
  onDeleted: (skillId: string) => Promise<void> | void;
}

export const SkillDetailModal: React.FC<SkillDetailModalProps> = ({
  skillId,
  initialSkill,
  agents,
  onClose,
  onUpdated,
  onDeleted,
}) => {
  const { runWithMask, showErrorModal } = useFeedback();
  const [skill, setSkill] = useState<SkillRecord | null>(initialSkill);
  const [markdown, setMarkdown] = useState('');
  const [files, setFiles] = useState<{ relativePath: string; sizeBytes: number }[]>([]);
  const [tagInput, setTagInput] = useState(initialSkill ? initialSkill.tags.join(', ') : '');
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (!skillId) {
      setSkill(null);
      setMarkdown('');
      setFiles([]);
      setTagInput('');
      setLoadingDetail(false);
      return;
    }

    setSkill(initialSkill);
    setTagInput(initialSkill ? initialSkill.tags.join(', ') : '');
    setMarkdown('');
    setFiles([]);
    setLoadingDetail(true);

    const controller = new AbortController();
    let isCurrent = true;

    api
      .getSkillDetail(skillId, controller.signal)
      .then((res) => {
        if (!isCurrent || res.skill.id !== skillId) return;
        setSkill(res.skill);
        setMarkdown(res.markdownContent);
        setFiles(res.files);
        setTagInput(res.skill.tags.join(', '));
        setLoadingDetail(false);
      })
      .catch((err: any) => {
        if (!isCurrent || err?.name === 'AbortError') return;
        setLoadingDetail(false);
        showErrorModal(
          `讀取技能「${skillId}」內容失敗`,
          err.message || '無法讀取該技能的 SKILL.md 檔案'
        );
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [skillId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!skillId) return null;

  const activeSkill = skill && skill.id === skillId ? skill : initialSkill;
  const enabledAgents = agents.filter((a) => a.enabled);

  const handleSave = async () => {
    if (!activeSkill || loadingDetail) return;
    const tags = tagInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    await runWithMask(
      {
        loadingTitle: `正在儲存「${activeSkill.name}」的 SKILL.md 與標籤...`,
        loadingSubtitle: '正在寫入中央技能庫並同步至所有已部署的 AI 工具個人資料夾...',
        successTitle: 'SKILL.md 與標籤已儲存',
        successMessage: `已成功更新「${activeSkill.name}」的內容與標籤，並同步至所有已掛載的 AI 工具！`,
        errorTitle: '儲存 SKILL.md 失敗',
      },
      async () => {
        const res = await api.updateSkill(activeSkill.id, {
          tags,
          skillMarkdownContent: markdown,
        });
        setSkill(res.skill);
        await onUpdated(res.skill);
        return res;
      }
    );
  };

  const handleToggleAgent = async (agentKey: string, currentDeployed: boolean) => {
    if (!activeSkill) return;
    const agent = agents.find((a) => a.key === agentKey);
    const agentName = agent?.name || agentKey;

    await runWithMask(
      {
        loadingTitle: !currentDeployed
          ? `正在將「${activeSkill.name}」部署至 ${agentName}...`
          : `正在從 ${agentName} 移除「${activeSkill.name}」...`,
        loadingSubtitle: `目標路徑：${agent?.compactPath || agentKey}/${activeSkill.dirName}`,
        successTitle: !currentDeployed ? '技能部署完成' : '已取消部署',
        successMessage: !currentDeployed
          ? `已成功將「${activeSkill.name}」部署至 ${agentName} 的個人資料夾！`
          : `已從 ${agentName} 的個人資料夾移除「${activeSkill.name}」。`,
        successDetails: `${agent?.resolvedPath || ''}/${activeSkill.dirName}`,
        errorTitle: '切換工具部署狀態失敗',
      },
      async () => {
        const res = await api.deploySkill(activeSkill.id, agentKey, !currentDeployed);
        setSkill(res.skill);
        await onUpdated(res.skill);
        return res;
      }
    );
  };

  const handleDownloadZip = async () => {
    await runWithMask(
      {
        loadingTitle: `正在打包並下載「${skillId}.zip」...`,
        loadingSubtitle: '正在壓縮技能目錄內所有檔案...',
        successTitle: 'ZIP 壓縮檔下載完成',
        successMessage: (res) =>
          `已成功打包並下載「${res.filename}」(${(res.sizeBytes / 1024).toFixed(1)} KB)！`,
        errorTitle: '下載 ZIP 失敗',
      },
      () => api.downloadSingleSkillZip(skillId)
    );
  };

  const handleOpenFolder = async () => {
    if (!activeSkill?.centralPath) return;
    await runWithMask(
      {
        loadingTitle: '正在呼叫系統檔案總管開啟技能目錄...',
        loadingSubtitle: activeSkill.centralPath,
        successTitle: '已開啟本機資料夾',
        successMessage: `已在系統檔案總管開啟目錄：`,
        successDetails: activeSkill.centralPath,
        errorTitle: '開啟資料夾失敗',
      },
      () => api.openInOSFileManager(activeSkill.centralPath)
    );
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/65 backdrop-blur-xs transition-opacity"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-3xl border-l border-slate-800 bg-slate-900 shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="min-w-0 pr-4">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-slate-100 truncate">
                {activeSkill?.name || skillId}
              </h2>
              <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs font-mono text-teal-300">
                {activeSkill?.dirName || skillId}
              </span>
              {activeSkill?.contentHash && (
                <span className="rounded-md bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-400">
                  hash: {activeSkill.contentHash.slice(0, 8)}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1 line-clamp-2">
              {activeSkill?.description || '正在讀取技能描述...'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadZip}
              className="flex items-center gap-1.5 rounded-xl bg-teal-500/15 border border-teal-500/40 px-3 py-1.5 text-xs font-medium text-teal-300 hover:bg-teal-500/25 transition"
              title="下載此 Skill 的 ZIP 壓縮檔"
            >
              <Download className="h-3.5 w-3.5" />
              下載 ZIP
            </button>
            {activeSkill?.centralPath && (
              <button
                type="button"
                onClick={handleOpenFolder}
                className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition"
                title="在檔案總管 / Finder 開啟"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                開啟目錄
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Per-Agent Deployment Toggles */}
          {activeSkill && (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  AI 工具個人資料夾同步部署狀態 (點擊立即切換部署 / 移除)
                </h3>
                <span className="text-[11px] text-slate-500">
                  已啟用 {enabledAgents.length} 個 AI 工具
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {enabledAgents.map((agent) => {
                  const dep = activeSkill.deployments[agent.key];
                  const isDeployed = Boolean(dep?.deployed);
                  return (
                    <button
                      type="button"
                      key={agent.key}
                      onClick={() => handleToggleAgent(agent.key, isDeployed)}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                        isDeployed
                          ? 'border-teal-500/50 bg-teal-500/15 text-teal-200'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                      title={`${agent.name}: ${agent.compactPath}/${activeSkill.dirName}`}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: isDeployed ? '#14B8A6' : '#475569' }}
                      />
                      <span>{agent.name}</span>
                      {isDeployed && (
                        <span className="rounded bg-teal-500/20 px-1.5 py-0.2 text-[10px] text-teal-300">
                          {dep.mode === 'copy' ? 'Copy' : 'Link'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tags & Metadata */}
          {activeSkill && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                  <Tag className="h-3.5 w-3.5 text-teal-400" />
                  標籤管理 (以逗號分隔)
                </label>
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="例如: react, review, security"
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-1.5 text-xs text-slate-400">
                <div className="font-semibold text-slate-300">來源與檔案資訊</div>
                <div>
                  來源類型：{activeSkill.sourceType} ({activeSkill.sourceLabel})
                </div>
                <div>
                  包含檔案：{loadingDetail ? '讀取中...' : `${files.length} 個檔案`}{' '}
                  ({(activeSkill.totalBytes / 1024).toFixed(1)} KB)
                </div>
                <div className="truncate font-mono text-[11px] text-slate-500">
                  路徑：{activeSkill.centralPath}
                </div>
              </div>
            </div>
          )}

          {/* SKILL.md Editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <FileText className="h-4 w-4 text-teal-400" />
                SKILL.md 內容檢視與即時編輯 ({skillId})
              </label>
              <button
                type="button"
                onClick={handleSave}
                disabled={loadingDetail}
                className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-50 transition"
              >
                <Save className="h-3.5 w-3.5" />
                儲存 SKILL.md 與標籤
              </button>
            </div>

            {loadingDetail ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 h-80 gap-3 text-xs text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin text-teal-400" />
                <span>正在從本機讀取「{activeSkill?.name || skillId}」的 SKILL.md 內容...</span>
              </div>
            ) : (
              <textarea
                rows={16}
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                className="w-full rounded-2xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100 focus:border-teal-500 focus:outline-none"
              />
            )}
          </div>

          {/* File list inside skill directory */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
            <h4 className="text-xs font-semibold text-slate-300">
              技能資料夾檔案結構 ({loadingDetail ? '...' : files.length})
            </h4>
            {loadingDetail ? (
              <div className="py-4 text-center text-xs text-slate-500">
                正在掃描技能目錄檔案清單...
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto divide-y divide-slate-800/60 text-xs font-mono">
                {files.map((f) => (
                  <div key={f.relativePath} className="flex justify-between py-1.5 text-slate-300">
                    <span>{f.relativePath}</span>
                    <span className="text-slate-500">{(f.sizeBytes / 1024).toFixed(1)} KB</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-3 bg-slate-950/50">
          <button
            type="button"
            onClick={async () => {
              const targetName = activeSkill?.name || skillId;
              if (window.confirm(`確定要從中央儲存庫與所有 AI 工具中刪除「${targetName}」嗎？`)) {
                await onDeleted(skillId);
                onClose();
              }
            }}
            className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20 transition"
          >
            <Trash2 className="h-3.5 w-3.5" />
            刪除此技能
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-800 px-4 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            關閉 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
