import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  FileArchive,
  FolderOpen,
  FilePlus2,
  Upload,
  CheckCircle2,
  Folder,
  ArrowUpLeft,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { api } from '../api';
import { DirectoryBrowseResponse, SkillRecord } from '../types';
import { useFeedback } from './FeedbackSystem';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: (skills: SkillRecord[]) => Promise<void> | void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  open,
  onClose,
  onImported,
}) => {
  const { runWithMask, showErrorModal } = useFeedback();
  const [activeTab, setActiveTab] = useState<'zip' | 'folder' | 'manual'>('zip');
  const [browsingDir, setBrowsingDir] = useState(false);

  // Local path & browser state
  const [localPathInput, setLocalPathInput] = useState('');
  const [browseData, setBrowseData] = useState<DirectoryBrowseResponse | null>(null);
  const [showBrowser, setShowBrowser] = useState(true);

  // Manual creation state
  const [manualDirName, setManualDirName] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualDesc, setManualDesc] = useState('');
  const [manualTags, setManualTags] = useState('custom, offline');
  const [manualBody, setManualBody] = useState(
    '# 技能執行規範\n\n請在此處撰寫提供給 AI Agent (Claude Code / Cursor / Codex / Gemini CLI) 的提示詞與步驟說明。'
  );

  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && activeTab === 'folder') {
      loadDirectory();
    }
  }, [open, activeTab]);

  const loadDirectory = async (dir?: string) => {
    setBrowsingDir(true);
    try {
      const res = await api.browseDirectory(dir);
      setBrowseData(res);
      setLocalPathInput(res.currentDir);
    } catch (err: any) {
      showErrorModal('讀取本機目錄失敗', err.message || '無法讀取指定的本機目錄');
    } finally {
      setBrowsingDir(false);
    }
  };

  if (!open) return null;

  const handleZipSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const names = Array.from(files).map((f) => f.name).join(', ');
    await runWithMask(
      {
        loadingTitle: '正在解壓縮並匯入 ZIP 壓縮檔...',
        loadingSubtitle: `正在驗證並匯入：${names}`,
        successTitle: 'ZIP 壓縮檔匯入成功',
        successMessage: (res) =>
          `已成功從壓縮檔「${names}」匯入 ${res.importedCount} 個技能至中央技能庫！`,
        errorTitle: 'ZIP 壓縮檔匯入失敗',
      },
      async () => {
        const res = await api.importZipFiles(files);
        await onImported(res.skills);
        onClose();
        return res;
      }
    );
    if (zipInputRef.current) zipInputRef.current.value = '';
  };

  const handleFolderUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const firstRel = (files[0] as any).webkitRelativePath || '';
    const folderName = firstRel.split('/')[0] || 'uploaded-skill';

    await runWithMask(
      {
        loadingTitle: `正在匯入所選資料夾「${folderName}」...`,
        loadingSubtitle: `正在讀取 ${files.length} 個檔案並解析 SKILL.md 結構...`,
        successTitle: '本機資料夾匯入成功',
        successMessage: (res) =>
          `已成功從資料夾「${folderName}」匯入 ${res.importedCount} 個技能至中央技能庫！`,
        errorTitle: '資料夾匯入失敗',
      },
      async () => {
        const res = await api.importFolderUpload(files, folderName);
        await onImported(res.skills);
        onClose();
        return res;
      }
    );
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const handleLocalPathImport = async (targetPath?: string) => {
    const pathToUse = (targetPath || localPathInput).trim();
    if (!pathToUse) {
      showErrorModal('路徑不可為空', '請輸入或從下方目錄瀏覽器選擇有效的本機資料夾路徑。');
      return;
    }

    await runWithMask(
      {
        loadingTitle: '正在從本機磁碟路徑匯入技能...',
        loadingSubtitle: `目標路徑：${pathToUse}`,
        successTitle: '本機路徑匯入成功',
        successMessage: (res) =>
          `已成功從「${pathToUse}」匯入 ${res.importedCount} 個技能至中央技能庫！`,
        errorTitle: '本機路徑匯入失敗',
      },
      async () => {
        const res = await api.importLocalPath(pathToUse);
        await onImported(res.skills);
        onClose();
        return res;
      }
    );
  };

  const handleManualCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetName = (manualName || manualDirName).trim();
    if (!targetName) {
      showErrorModal('欄位未填寫完整', '請輸入技能資料夾代號 (Slug) 與描述。');
      return;
    }

    await runWithMask(
      {
        loadingTitle: `正在建立新技能「${targetName}」...`,
        loadingSubtitle: '正在寫入 SKILL.md 並更新本機索引...',
        successTitle: '新技能建立成功',
        successMessage: `已成功建立技能「${targetName}」並存入中央技能庫！`,
        errorTitle: '建立新技能失敗',
      },
      async () => {
        await api.createManualSkill({
          dirName: manualDirName || manualName,
          name: manualName || manualDirName,
          description: manualDesc,
          tags: manualTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          markdownBody: manualBody,
        });
        const overview = await api.getOverview();
        await onImported(overview.skills);
        onClose();
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
        className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-500/15 text-teal-400">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                離線匯入與建立 AI Agent Skills
              </h2>
              <p className="text-xs text-slate-400">
                支援 .zip / .skill 壓縮檔、本機資料夾直接匯入，完全不經過任何外部網路
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

        {/* Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 px-6 pt-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('zip')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              activeTab === 'zip'
                ? 'border-teal-400 text-teal-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileArchive className="h-4 w-4" />
            ZIP / .skill 壓縮檔匯入
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('folder')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              activeTab === 'folder'
                ? 'border-teal-400 text-teal-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FolderOpen className="h-4 w-4" />
            本機資料夾匯入
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              activeTab === 'manual'
                ? 'border-teal-400 text-teal-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FilePlus2 className="h-4 w-4" />
            手動建立 SKILL.md
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {activeTab === 'zip' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleZipSelect(e.dataTransfer.files);
                }}
                onClick={() => zipInputRef.current?.click()}
                className="cursor-pointer rounded-2xl border-2 border-dashed border-slate-700 hover:border-teal-500/60 bg-slate-950/60 p-10 text-center transition group"
              >
                <FileArchive className="mx-auto h-12 w-12 text-slate-500 group-hover:text-teal-400 transition" />
                <p className="mt-3 text-sm font-medium text-slate-200">
                  點擊選擇或拖曳 <span className="text-teal-400">.zip</span> /{' '}
                  <span className="text-teal-400">.skill</span> 壓縮檔至此處
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  支援單一技能壓縮包，或包含多個子技能資料夾 (`SKILL.md`) 的整包 ZIP 匯入
                </p>
                <input
                  ref={zipInputRef}
                  type="file"
                  accept=".zip,.skill"
                  multiple
                  className="hidden"
                  onChange={(e) => handleZipSelect(e.target.files)}
                />
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 text-xs text-slate-400 space-y-1">
                <div className="font-medium text-slate-300 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-teal-400" />
                  離線安全解壓縮機制
                </div>
                <p>
                  系統會在本機自動過濾不安全的相對路徑 (`..`) 與 `__MACOSX` 暫存檔，並自動遞迴偵測壓縮包內所有含有 `SKILL.md` 的技能目錄匯入至 `~/.skills-manager/skills`。
                </p>
              </div>
            </div>
          )}

          {activeTab === 'folder' && (
            <div className="space-y-4">
              {/* Option A: Browser native directory upload */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-slate-200">
                    方式一：使用系統視窗挑選整個資料夾
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    直接從檔案總管 / Finder 選取本機上的技能資料夾（支援單一技能或多技能母資料夾）
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="rounded-xl bg-teal-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400 transition shrink-0"
                >
                  選擇本機資料夾...
                </button>
                <input
                  ref={folderInputRef}
                  type="file"
                  {...({ webkitdirectory: '', directory: '' } as any)}
                  multiple
                  className="hidden"
                  onChange={(e) => handleFolderUpload(e.target.files)}
                />
              </div>

              {/* Option B: Direct local path or built-in local folder browser */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-slate-200">
                      方式二：指定本機路徑或瀏覽本機目錄
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      由 Node.js 本機服務直接讀取磁碟路徑並匯入至中央儲存庫
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowBrowser(!showBrowser)}
                    className="text-xs text-teal-400 hover:underline"
                  >
                    {showBrowser ? '隱藏目錄瀏覽器' : '展開目錄瀏覽器'}
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={localPathInput}
                    onChange={(e) => setLocalPathInput(e.target.value)}
                    placeholder="例如：~/my-skills/react-best-practices 或 D:\skills\my-skill"
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs text-slate-100 focus:border-teal-500 focus:outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => handleLocalPathImport()}
                    className="rounded-xl bg-teal-500/20 border border-teal-500/40 px-4 py-2 text-xs font-semibold text-teal-300 hover:bg-teal-500/30 transition shrink-0"
                  >
                    匯入此路徑
                  </button>
                </div>

                {showBrowser && (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/90 overflow-hidden">
                    <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 bg-slate-950/60 text-xs">
                      <span className="font-mono text-slate-300 truncate">
                        📂 {browseData?.compactCurrentDir || '讀取中...'}
                      </span>
                      {browseData?.parentDir && (
                        <button
                          type="button"
                          disabled={browsingDir}
                          onClick={() => loadDirectory(browseData.parentDir!)}
                          className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-slate-300 hover:bg-slate-700 shrink-0"
                        >
                          <ArrowUpLeft className="h-3.5 w-3.5" />
                          上一層
                        </button>
                      )}
                    </div>
                    {browsingDir ? (
                      <div className="p-6 flex items-center justify-center gap-2 text-xs text-slate-400">
                        <Loader2 className="h-4 w-4 animate-spin text-teal-400" />
                        <span>正在讀取目錄結構...</span>
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto divide-y divide-slate-800/60">
                        {browseData?.directories.map((dir) => (
                          <div
                            key={dir.fullPath}
                            className="flex items-center justify-between px-3 py-2 hover:bg-slate-800/50 text-xs"
                          >
                            <button
                              type="button"
                              onClick={() => loadDirectory(dir.fullPath)}
                              className="flex items-center gap-2 text-left text-slate-200 hover:text-teal-300 flex-1 truncate"
                            >
                              <Folder className="h-4 w-4 text-teal-400 shrink-0" />
                              <span className="truncate">{dir.name}</span>
                              {dir.hasSkillMd && (
                                <span className="rounded-full bg-teal-500/20 border border-teal-500/40 px-2 py-0.5 text-[10px] text-teal-300">
                                  含 SKILL.md
                                </span>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLocalPathImport(dir.fullPath)}
                              className="rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] text-teal-300 hover:bg-teal-500 hover:text-slate-950 transition ml-2 shrink-0"
                            >
                              匯入此資料夾
                            </button>
                          </div>
                        ))}
                        {browseData?.directories.length === 0 && (
                          <div className="p-4 text-center text-xs text-slate-500">
                            此目錄下沒有子資料夾
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'manual' && (
            <form onSubmit={handleManualCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    技能資料夾代號 (Slug) *
                  </label>
                  <input
                    required
                    type="text"
                    value={manualDirName}
                    onChange={(e) => setManualDirName(e.target.value)}
                    placeholder="例如: api-security-audit"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-teal-500 focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    顯示名稱 (Name)
                  </label>
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="例如: API Security Audit"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  技能簡述 (Description - 供 AI 工具判斷觸發時機) *
                </label>
                <input
                  required
                  type="text"
                  value={manualDesc}
                  onChange={(e) => setManualDesc(e.target.value)}
                  placeholder="說明此 Skill 的用途與觸發條件..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  標籤 (以逗號分隔)
                </label>
                <input
                  type="text"
                  value={manualTags}
                  onChange={(e) => setManualTags(e.target.value)}
                  placeholder="security, backend, review"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  SKILL.md 指令內容 (Markdown)
                </label>
                <textarea
                  rows={6}
                  value={manualBody}
                  onChange={(e) => setManualBody(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-100 font-mono focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400 transition"
                >
                  <Sparkles className="h-4 w-4" />
                  建立並存入中央技能庫
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
