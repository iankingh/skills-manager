import React, { useEffect, useState } from 'react';
import {
  X,
  Plus,
  Folder,
  ArrowUpLeft,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { api } from '../api';
import { AgentConfig, DirectoryBrowseResponse } from '../types';
import { useFeedback } from './FeedbackSystem';

interface AddAgentModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: (agents: AgentConfig[]) => Promise<void> | void;
}

const COLOR_PRESETS = [
  '#14B8A6', // Teal
  '#3B82F6', // Blue
  '#8B5CF6', // Violet
  '#D97757', // Coral
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#06B6D4', // Cyan
];

const QUICK_TEMPLATES = [
  { name: 'Cursor', globalPath: '~/.cursor/skills/', projectPath: '.cursor/skills/', color: '#3B82F6' },
  { name: 'Gemini CLI', globalPath: '~/.gemini/skills/', projectPath: '.gemini/skills/', color: '#06B6D4' },
  { name: 'Windsurf', globalPath: '~/.codeium/windsurf/skills/', projectPath: '.windsurf/skills/', color: '#14B8A6' },
  { name: 'Cline', globalPath: '~/.cline/skills/', projectPath: '.cline/skills/', color: '#F59E0B' },
  { name: 'Roo Code', globalPath: '~/.roo/skills/', projectPath: '.roo/skills/', color: '#EC4899' },
];

export const AddAgentModal: React.FC<AddAgentModalProps> = ({
  open,
  onClose,
  onAdded,
}) => {
  const { runWithMask, showErrorModal } = useFeedback();
  const [name, setName] = useState('');
  const [globalPath, setGlobalPath] = useState('');
  const [projectPath, setProjectPath] = useState('.agents/skills/');
  const [color, setColor] = useState(COLOR_PRESETS[0]);

  const [showBrowser, setShowBrowser] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [browseData, setBrowseData] = useState<DirectoryBrowseResponse | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setGlobalPath('');
      setProjectPath('.agents/skills/');
      setColor(COLOR_PRESETS[0]);
      setShowBrowser(false);
    }
  }, [open]);

  const loadDirectory = async (dir?: string) => {
    setBrowsing(true);
    try {
      const res = await api.browseDirectory(dir);
      setBrowseData(res);
    } catch (err: any) {
      showErrorModal('讀取目錄失敗', err.message || '無法讀取指定的本機目錄');
    } finally {
      setBrowsing(false);
    }
  };

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !globalPath.trim()) {
      showErrorModal('欄位未填寫完整', '請輸入「AI 工具名稱」與「個人／全域層級路徑」。');
      return;
    }

    const agentName = name.trim();
    const agentGlobal = globalPath.trim();
    const agentProject = projectPath.trim() || '.agents/skills/';

    await runWithMask(
      {
        loadingTitle: `正在新增 AI Agent「${agentName}」...`,
        loadingSubtitle: `個人／全域層級：${agentGlobal} | 專案層級：${agentProject}`,
        successTitle: '新增 AI Agent 成功',
        successMessage: `已成功新增 AI 工具「${agentName}」，現在可隨時將技能部署至其個人資料夾！`,
        successDetails: `個人／全域層級：${agentGlobal}
專案層級：${agentProject}`,
        errorTitle: '新增 AI Agent 失敗',
      },
      async () => {
        const res = await api.addCustomAgent({
          name: agentName,
          globalPath: agentGlobal,
          projectPath: agentProject,
          color,
        });
        await onAdded(res.agents);
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
        className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-400">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                新增 AI 工具 (Add AI Agent)
              </h2>
              <p className="text-xs text-slate-400">
                設定新 AI 工具的名稱、專案層級路徑與個人／全域層級 Skills 資料夾路徑
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {/* Quick Templates */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-slate-400">
              快速套用常見 AI 工具範本 (點擊自動填入，亦可自行輸入任意名稱與路徑)：
            </span>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TEMPLATES.map((tpl) => (
                <button
                  type="button"
                  key={tpl.name}
                  onClick={() => {
                    setName(tpl.name);
                    setGlobalPath(tpl.globalPath);
                    setProjectPath(tpl.projectPath);
                    setColor(tpl.color);
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-slate-300 hover:border-teal-500/50 hover:text-teal-300 transition"
                >
                  <Sparkles className="h-3 w-3 text-teal-400" />
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1">
                AI 工具名稱 (Agent Name) *
              </label>
              <input
                required
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如: Cursor、Gemini CLI、My Agent"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                識別顏色
              </label>
              <div className="flex items-center gap-1.5 pt-1.5">
                {COLOR_PRESETS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setColor(c)}
                    className={`h-5 w-5 rounded-full transition ${
                      color === c ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-300">
                個人／全域層級路徑 (Personal / Global Level Path) *
              </label>
              <button
                type="button"
                onClick={() => {
                  const next = !showBrowser;
                  setShowBrowser(next);
                  if (next && !browseData) loadDirectory();
                }}
                className="text-xs text-teal-400 hover:underline"
              >
                {showBrowser ? '隱藏本機目錄瀏覽器' : '開啟本機目錄瀏覽器挑選...'}
              </button>
            </div>
            <input
              required
              type="text"
              value={globalPath}
              onChange={(e) => setGlobalPath(e.target.value)}
              placeholder="例如: ~/.cursor/skills/ 或 ~/.agents/skills/"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-mono text-slate-100 focus:border-teal-500 focus:outline-none"
            />

            {showBrowser && (
              <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs">
                  <span className="font-mono text-slate-300 truncate">
                    📂 {browseData?.compactCurrentDir || '讀取中...'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {browseData && (
                      <button
                        type="button"
                        onClick={() => setGlobalPath(browseData.compactCurrentDir)}
                        className="rounded-lg bg-teal-500/20 border border-teal-500/40 px-2 py-0.5 text-[11px] text-teal-300"
                      >
                        使用目前目錄
                      </button>
                    )}
                    {browseData?.parentDir && (
                      <button
                        type="button"
                        disabled={browsing}
                        onClick={() => loadDirectory(browseData.parentDir!)}
                        className="flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700"
                      >
                        <ArrowUpLeft className="h-3 w-3" />
                        上一層
                      </button>
                    )}
                  </div>
                </div>
                {browsing ? (
                  <div className="p-4 flex items-center justify-center gap-2 text-xs text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin text-teal-400" />
                    <span>正在讀取目錄...</span>
                  </div>
                ) : (
                  <div className="max-h-40 overflow-y-auto divide-y divide-slate-800/60 text-xs">
                    {browseData?.directories.map((dir) => (
                      <div
                        key={dir.fullPath}
                        className="flex items-center justify-between px-3 py-1.5 hover:bg-slate-900"
                      >
                        <button
                          type="button"
                          onClick={() => loadDirectory(dir.fullPath)}
                          className="flex items-center gap-2 text-left text-slate-200 hover:text-teal-300 flex-1 truncate"
                        >
                          <Folder className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                          <span className="truncate">{dir.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setGlobalPath(dir.compactPath)}
                          className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-teal-300 hover:bg-teal-500 hover:text-slate-950"
                        >
                          選取
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              專案層級路徑對照 (Project Level Path, 選填)
            </label>
            <input
              type="text"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="例如: .cursor/skills/、.agents/skills/"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-mono text-slate-100 focus:border-teal-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400 transition"
            >
              <Plus className="h-4 w-4" />
              確認新增 Agent
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
