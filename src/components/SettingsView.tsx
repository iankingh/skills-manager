import React, { useState } from 'react';
import {
  FolderOpen,
  Save,
  Plus,
  Trash2,
  Shield,
  Monitor,
  Sliders,
} from 'lucide-react';
import { api } from '../api';
import { AgentConfig, AppSettings } from '../types';
import { useFeedback } from './FeedbackSystem';

interface SettingsViewProps {
  settings: AppSettings;
  agents: AgentConfig[];
  trayStatus: { active: boolean; enabledInSettings: boolean };
  onOpenAddAgent: () => void;
  onRefresh: () => Promise<void> | void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  agents,
  trayStatus,
  onOpenAddAgent,
  onRefresh,
}) => {
  const { runWithMask, showErrorModal } = useFeedback();
  const [repoPath, setRepoPath] = useState(settings.centralRepoPath);
  const [syncMode, setSyncMode] = useState<'symlink' | 'copy'>(settings.syncMode);
  const [trayEnabled, setTrayEnabled] = useState(settings.trayEnabled);
  const [editingPaths, setEditingPaths] = useState<Record<string, string>>({});

  // Custom agent inline form state
  const [customName, setCustomName] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [customProjectPath, setCustomProjectPath] = useState('.agents/skills/');

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoPath.trim()) {
      showErrorModal('儲存庫路徑不可為空', '請輸入有效的中央技能庫路徑（例如 ~/.skills-manager）。');
      return;
    }
    await runWithMask(
      {
        loadingTitle: '正在儲存並套用核心系統設定...',
        loadingSubtitle: `儲存庫路徑：${repoPath} | 同步模式：${syncMode}`,
        successTitle: '系統核心設定已儲存',
        successMessage: `已成功更新中央儲存庫路徑、同步模式 (${syncMode}) 與 System Tray 設定！`,
        successDetails: repoPath,
        errorTitle: '儲存系統設定失敗',
      },
      async () => {
        await api.updateSettings({
          centralRepoPath: repoPath.trim(),
          syncMode,
          trayEnabled,
        });
        await onRefresh();
      }
    );
  };

  const handleToggleAgentEnabled = async (agent: AgentConfig) => {
    const nextEnabled = !agent.enabled;
    await runWithMask(
      {
        loadingTitle: `${nextEnabled ? '正在啟用' : '正在停用'} AI 工具「${agent.name}」...`,
        successTitle: `${agent.name} 已${nextEnabled ? '啟用' : '停用'}`,
        successMessage: `已${nextEnabled ? '啟用' : '停用'}「${agent.name}」的個人資料夾同步支援。`,
        errorTitle: '更新 AI 工具狀態失敗',
      },
      async () => {
        await api.updateAgent(agent.key, { enabled: nextEnabled });
        await onRefresh();
      }
    );
  };

  const handleSaveAgentCustomPath = async (agent: AgentConfig, overridePath?: string) => {
    const newPath =
      overridePath !== undefined
        ? overridePath
        : editingPaths[agent.key] !== undefined
        ? editingPaths[agent.key]
        : agent.customGlobalPath || agent.defaultGlobalPath;
    if (!newPath.trim()) {
      showErrorModal('路徑不可為空', `請為 ${agent.name} 輸入有效的個人資料夾路徑。`);
      return;
    }

    await runWithMask(
      {
        loadingTitle: `正在更新「${agent.name}」的個人資料夾路徑...`,
        loadingSubtitle: `新路徑：${newPath.trim()}`,
        successTitle: '個人資料夾路徑已更新',
        successMessage: `已成功將「${agent.name}」的 Skills 個人資料夾路徑更新為：`,
        successDetails: newPath.trim(),
        errorTitle: '更新個人資料夾路徑失敗',
      },
      async () => {
        await api.updateAgent(agent.key, {
          customGlobalPath: newPath.trim(),
        });
        setEditingPaths((prev) => ({ ...prev, [agent.key]: newPath.trim() }));
        await onRefresh();
      }
    );
  };

  const handleAddCustomAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || !customPath.trim()) {
      showErrorModal('欄位未填寫完整', '請同時填寫「自訂 Agent 名稱」與「個人／全域層級路徑」。');
      return;
    }
    const nameToCreate = customName.trim();
    const pathToCreate = customPath.trim();
    const projToCreate = customProjectPath.trim() || '.agents/skills/';

    await runWithMask(
      {
        loadingTitle: `正在新增自訂 AI Agent「${nameToCreate}」...`,
        loadingSubtitle: `個人／全域層級路徑：${pathToCreate}`,
        successTitle: '自訂 AI Agent 新增成功',
        successMessage: `已成功新增自訂 AI 工具「${nameToCreate}」並啟用個人資料夾對應！`,
        successDetails: `個人／全域層級：${pathToCreate}
專案層級：${projToCreate}`,
        errorTitle: '新增自訂 AI 工具失敗',
      },
      async () => {
        await api.addCustomAgent({
          name: nameToCreate,
          globalPath: pathToCreate,
          projectPath: projToCreate,
        });
        setCustomName('');
        setCustomPath('');
        setCustomProjectPath('.agents/skills/');
        await onRefresh();
      }
    );
  };

  const handleRemoveCustomAgent = async (agent: AgentConfig) => {
    if (!window.confirm(`確定要刪除自訂工具「${agent.name}」嗎？`)) return;
    await runWithMask(
      {
        loadingTitle: `正在移除自訂工具「${agent.name}」...`,
        successTitle: '已移除自訂工具',
        successMessage: `已從系統移除自訂 AI 工具「${agent.name}」。`,
        errorTitle: '移除自訂工具失敗',
      },
      async () => {
        await api.removeCustomAgent(agent.key);
        await onRefresh();
      }
    );
  };

  const handleOpenFolder = async (folderPath: string) => {
    await runWithMask(
      {
        loadingTitle: '正在呼叫系統檔案總管開啟資料夾...',
        loadingSubtitle: folderPath,
        successTitle: '已開啟本機資料夾',
        successMessage: '已在系統檔案總管 / Finder 開啟目錄：',
        successDetails: folderPath,
        errorTitle: '開啟資料夾失敗',
      },
      () => api.openInOSFileManager(folderPath)
    );
  };

  return (
    <div className="space-y-6">
      {/* Core Local Service & Sync Mode Settings */}
      <form
        onSubmit={handleSaveGeneral}
        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-teal-400" />
            <h2 className="text-sm font-bold text-slate-100">
              中央技能儲存庫與系統常駐列 (System Tray) 設定
            </h2>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-teal-500/15 border border-teal-500/30 px-3 py-0.5 text-[11px] font-medium text-teal-300">
            <Shield className="h-3 w-3" />
            嚴格本機離線模式 (127.0.0.1)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              中央 Skills 儲存庫路徑 (預設 ~/.skills-manager)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-slate-100 focus:border-teal-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleOpenFolder(repoPath)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700"
                title="開啟資料夾"
              >
                <FolderOpen className="h-4 w-4 text-teal-400" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              跨 AI 工具部署同步模式 (Sync Mode)
            </label>
            <select
              value={syncMode}
              onChange={(e) => setSyncMode(e.target.value as 'symlink' | 'copy')}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
            >
              <option value="symlink">
                Symlink / Windows Directory Junction (推薦：零磁碟空間浪費、即時同步)
              </option>
              <option value="copy">
                實體資料夾複製 (Copy Mode：適合跨磁碟區或 WSL 獨立環境)
              </option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={trayEnabled}
              onChange={(e) => setTrayEnabled(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 text-teal-500"
            />
            <Monitor className="h-4 w-4 text-teal-400" />
            <span>
              啟用系統常駐列圖示 (System Tray) — 目前狀態：
              <strong className="ml-1 text-teal-300">
                {trayStatus.active ? '常駐執行中' : '背景服務模式'}
              </strong>
            </span>
          </label>

          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400 transition"
          >
            <Save className="h-3.5 w-3.5" />
            儲存核心設定
          </button>
        </div>
      </form>

      {/* AI 工具 Skills 路徑對照表 (專案層級 vs 個人／全域層級) */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
        <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              AI 工具 Skills 路徑對照表
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              包含內建三款核心工具與您新增的自訂 AI Agent 路徑對照
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenAddAgent}
            className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            新增 AI Agent (含目錄瀏覽器)...
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-300">
                <th className="px-5 py-3 font-semibold">AI 工具</th>
                <th className="px-5 py-3 font-semibold">模組分類</th>
                <th className="px-5 py-3 font-semibold">專案層級 (Project Level)</th>
                <th className="px-5 py-3 font-semibold">個人／全域層級 (Personal / Global Level)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono">
              {agents.map((ag) => (
                <React.Fragment key={ag.key}>
                  <tr className="hover:bg-slate-800/30">
                    <td
                      rowSpan={3}
                      className="px-5 py-3 font-sans font-semibold text-slate-100 align-top border-r border-slate-800/60"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: ag.color }}
                        />
                        <span>{ag.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5 font-sans font-medium text-teal-300">
                      AI Skills
                    </td>
                    <td className="px-5 py-2.5 text-slate-300">
                      {(ag.projectPaths || ['.agents/skills/']).join('、')}
                    </td>
                    <td className="px-5 py-2.5 text-teal-300">
                      {(ag.globalPaths || [ag.defaultGlobalPath]).join('、')}
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="px-5 py-2.5 font-sans font-medium text-violet-300">
                      AI Agents
                    </td>
                    <td className="px-5 py-2.5 text-slate-300">
                      {(ag.agentProjectPaths || ['.agents/agents/']).join('、')}
                    </td>
                    <td className="px-5 py-2.5 text-violet-300">
                      {(ag.agentGlobalPaths || [ag.defaultAgentGlobalPath]).join('、')}
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="px-5 py-2.5 font-sans font-medium text-emerald-300">
                      MCP 設定
                    </td>
                    <td className="px-5 py-2.5 text-slate-300">
                      {(ag.mcpProjectPaths || ['.mcp.json']).join('、')}
                    </td>
                    <td className="px-5 py-2.5 text-emerald-300">
                      {(ag.mcpGlobalPaths || [ag.defaultMcpGlobalPath]).join('、')}
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Custom AI Tool Inline Form */}
      <form
        onSubmit={handleAddCustomAgent}
        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">
            快速新增自訂 AI Agent 與對應路徑
          </h3>
          <button
            type="button"
            onClick={onOpenAddAgent}
            className="text-xs text-teal-400 hover:underline"
          >
            開啟進階新增視窗 (支援本機目錄瀏覽器挑選)...
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="AI 工具名稱 (例如: Cursor)"
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
          />
          <input
            type="text"
            value={customProjectPath}
            onChange={(e) => setCustomProjectPath(e.target.value)}
            placeholder="專案層級 (例如: .cursor/skills/)"
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-slate-100 focus:border-teal-500 focus:outline-none"
          />
          <input
            type="text"
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            placeholder="個人／全域層級 (例如: ~/.cursor/skills/)"
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-slate-100 focus:border-teal-500 focus:outline-none"
          />
          <button
            type="submit"
            className="flex items-center justify-center gap-1.5 rounded-xl bg-teal-500/20 border border-teal-500/40 px-4 py-2 text-xs font-semibold text-teal-300 hover:bg-teal-500/30 transition"
          >
            <Plus className="h-4 w-4" />
            確認新增 Agent
          </button>
        </div>
      </form>

      {/* Supported AI Tools & Personal Folder Paths */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
        <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              各 AI 工具在個人資料夾對應的 Skills 路徑管理 ({agents.length} 款工具)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              可自由啟用/停用工具，或針對任何工具切換/覆寫個人資料夾路徑
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-800/70">
          {agents.map((agent) => {
            const pathVal =
              editingPaths[agent.key] !== undefined
                ? editingPaths[agent.key]
                : agent.customGlobalPath || agent.defaultGlobalPath;
            return (
              <div
                key={agent.key}
                className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 hover:bg-slate-800/30 text-xs"
              >
                <div className="flex items-center gap-3 min-w-[240px]">
                  <input
                    type="checkbox"
                    checked={agent.enabled}
                    onChange={() => handleToggleAgentEnabled(agent)}
                    className="rounded border-slate-700 bg-slate-900 text-teal-500 cursor-pointer"
                  />
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: agent.color }}
                  />
                  <div className="space-y-0.5">
                    <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                      <span>{agent.name}</span>
                      {agent.isCustom && (
                        <span className="rounded bg-teal-500/20 px-1.5 py-0.2 text-[10px] text-teal-300">
                          自訂
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      個人／全域層級: {(agent.globalPaths || [agent.defaultGlobalPath]).join('、')}
                    </div>
                    {agent.projectPaths && agent.projectPaths.length > 0 && (
                      <div className="text-[11px] text-slate-500 font-mono">
                        專案層級: {agent.projectPaths.join('、')}
                      </div>
                    )}
                    {/* Quick Switcher if multiple global paths exist (e.g. GitHub Copilot ~/.copilot/skills/ vs ~/.agents/skills/) */}
                    {agent.globalPaths && agent.globalPaths.length > 1 && (
                      <div className="flex items-center gap-1 pt-1">
                        <span className="text-[10px] text-slate-500">快速切換個人目錄：</span>
                        {agent.globalPaths.map((gp) => (
                          <button
                            key={gp}
                            type="button"
                            onClick={() =>
                              handleSaveAgentCustomPath(agent, gp.replace(/\/+$/, ''))
                            }
                            className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-teal-300 hover:bg-teal-500 hover:text-slate-950 transition"
                          >
                            {gp}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-1 items-center gap-2 max-w-xl">
                  <input
                    type="text"
                    value={pathVal}
                    onChange={(e) =>
                      setEditingPaths({ ...editingPaths, [agent.key]: e.target.value })
                    }
                    className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-200 focus:border-teal-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveAgentCustomPath(agent)}
                    className="rounded-xl bg-slate-800 px-3 py-1.5 text-xs text-teal-300 hover:bg-teal-500 hover:text-slate-950 transition"
                  >
                    更新路徑
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenFolder(agent.resolvedPath)}
                    className="rounded-xl bg-slate-800 p-1.5 text-slate-300 hover:text-teal-300"
                    title="在系統檔案總管開啟此個人資料夾"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                  {agent.isCustom && (
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomAgent(agent)}
                      className="rounded-xl bg-rose-500/10 p-1.5 text-rose-300 hover:bg-rose-500/20"
                      title="刪除自訂工具"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
