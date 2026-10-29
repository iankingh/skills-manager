import React, { useEffect, useState } from 'react';
import {
  X,
  FolderOpen,
  Save,
  FileText,
  Loader2,
  Import,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { api } from '../api';
import { ExternalAgentSkill } from '../types';
import { useFeedback } from './FeedbackSystem';

interface ExternalSkillDetailModalProps {
  target: { agentKey: string; dirName: string; initialItem?: ExternalAgentSkill } | null;
  onClose: () => void;
  onAdopt: (agentKey: string, dirName: string) => Promise<void>;
  onUpdated: () => Promise<void> | void;
}

export const ExternalSkillDetailModal: React.FC<ExternalSkillDetailModalProps> = ({
  target,
  onClose,
  onAdopt,
  onUpdated,
}) => {
  const { runWithMask, showErrorModal } = useFeedback();
  const [item, setItem] = useState<ExternalAgentSkill | null>(target?.initialItem || null);
  const [markdown, setMarkdown] = useState('');
  const [files, setFiles] = useState<{ relativePath: string; sizeBytes: number }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!target) {
      setItem(null);
      setMarkdown('');
      setFiles([]);
      setLoading(false);
      return;
    }

    setItem(target.initialItem || null);
    setMarkdown('');
    setFiles([]);
    setLoading(true);

    const controller = new AbortController();
    let active = true;

    api
      .getExternalAgentSkillDetail(target.agentKey, target.dirName, controller.signal)
      .then((res) => {
        if (!active) return;
        setItem(res.item);
        setMarkdown(res.markdownContent);
        setFiles(res.files);
        setLoading(false);
      })
      .catch((err: any) => {
        if (!active || err?.name === 'AbortError') return;
        setLoading(false);
        showErrorModal(
          `讀取個人資料夾技能「${target.dirName}」內容失敗`,
          err.message || '無法讀取該技能的 SKILL.md 內容'
        );
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [target?.agentKey, target?.dirName]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!target) return null;

  const displayItem = item || target.initialItem;

  const handleSaveContent = async () => {
    await runWithMask(
      {
        loadingTitle: `正在儲存個人資料夾中「${target.dirName}」的 SKILL.md...`,
        loadingSubtitle: displayItem?.fullPath,
        successTitle: 'SKILL.md 內容已儲存',
        successMessage: `已成功更新 ${displayItem?.agentName || target.agentKey} 個人資料夾中「${
          target.dirName
        }」的 SKILL.md 內容！`,
        errorTitle: '儲存 SKILL.md 失敗',
      },
      async () => {
        const res = await api.updateExternalAgentSkillContent(
          target.agentKey,
          target.dirName,
          markdown
        );
        setItem(res.item);
        await onUpdated();
      }
    );
  };

  const handleOpenFolder = async () => {
    if (!displayItem?.fullPath) return;
    await runWithMask(
      {
        loadingTitle: '正在開啟技能所在個人資料夾...',
        loadingSubtitle: displayItem.fullPath,
        successTitle: '已開啟資料夾',
        successMessage: '已在系統檔案總管 / Finder 開啟目錄：',
        successDetails: displayItem.fullPath,
        errorTitle: '開啟資料夾失敗',
      },
      () => api.openInOSFileManager(displayItem.fullPath)
    );
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/65 backdrop-blur-xs"
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
                {displayItem?.name || target.dirName}
              </h2>
              <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs font-mono text-teal-300">
                {target.dirName}
              </span>
              <span className="rounded-md bg-teal-500/15 border border-teal-500/30 px-2 py-0.5 text-[11px] text-teal-300">
                {displayItem?.agentName || target.agentKey} 個人資料夾
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 line-clamp-2">
              {displayItem?.description || '正在讀取技能描述...'}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {displayItem && !displayItem.managedByCentral && (
              <button
                type="button"
                onClick={async () => {
                  await onAdopt(target.agentKey, target.dirName);
                  onClose();
                }}
                className="flex items-center gap-1.5 rounded-xl bg-amber-500/20 border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/30 transition"
              >
                <Import className="h-3.5 w-3.5" />
                納管匯入中央庫
              </button>
            )}
            {displayItem?.fullPath && (
              <button
                type="button"
                onClick={handleOpenFolder}
                className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition"
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Status & Path Info */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300">個人資料夾實際路徑與狀態</span>
              {displayItem?.managedByCentral ? (
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  已由中央庫納管 ({displayItem.isSymlink ? 'Symlink / Junction' : 'Copy'})
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-400 font-medium">
                  <AlertCircle className="h-3.5 w-3.5" />
                  存在於個人資料夾的獨立技能 (可隨時點右上角納管匯入中央庫)
                </span>
              )}
            </div>
            <div className="font-mono text-[11px] text-slate-400 break-all">
              實際路徑：{displayItem?.fullPath}
            </div>
            {displayItem?.isSymlink && displayItem.symlinkTarget && (
              <div className="font-mono text-[11px] text-teal-400 break-all">
                連結目標：{displayItem.symlinkTarget}
              </div>
            )}
          </div>

          {/* SKILL.md Viewer & Editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <FileText className="h-4 w-4 text-teal-400" />
                SKILL.md 內容檢視與編輯 ({target.dirName})
              </label>
              <button
                type="button"
                disabled={loading}
                onClick={handleSaveContent}
                className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-50 transition"
              >
                <Save className="h-3.5 w-3.5" />
                儲存 SKILL.md 變更
              </button>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 h-80 gap-3 text-xs text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin text-teal-400" />
                <span>正在從個人資料夾讀取「{target.dirName}」的 SKILL.md 內容...</span>
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

          {/* File Tree */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
            <h4 className="text-xs font-semibold text-slate-300">
              此技能目錄包含的檔案 ({loading ? '...' : files.length})
            </h4>
            {loading ? (
              <div className="py-4 text-center text-xs text-slate-500">正在讀取檔案列表...</div>
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
        <div className="flex items-center justify-end border-t border-slate-800 px-6 py-3 bg-slate-950/50">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-800 px-5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            關閉 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
