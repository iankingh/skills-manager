import React, { useEffect, useRef, useState } from 'react';
import {
  Cpu,
  Plus,
  Upload,
  Download,
  Trash2,
  FolderOpen,
  FileCode,
  Eye,
  Save,
  X,
  Import,
  Send,
  CheckSquare,
  Square,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { api } from '../api';
import {
  AgentConfig,
  ExternalMcpItem,
  McpServerRecord,
} from '../types';
import { useFeedback } from './FeedbackSystem';

interface McpViewProps {
  mcpServers: McpServerRecord[];
  agents: AgentConfig[];
  onRefreshOverview: () => Promise<void>;
}

export const McpView: React.FC<McpViewProps> = ({
  mcpServers,
  agents,
  onRefreshOverview,
}) => {
  const { runWithMask, showErrorModal } = useFeedback();
  const [externalMcp, setExternalMcp] = useState<ExternalMcpItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; message: string; latencyMs: number }>
  >({});

  const handleTestMcp = async (srv: McpServerRecord) => {
    setTestingId(srv.id);
    try {
      const res = await api.testMcpServer(srv.id);
      setTestResults((prev) => ({
        ...prev,
        [srv.id]: {
          ok: res.result.ok,
          message: res.result.message,
          latencyMs: res.result.latencyMs,
        },
      }));
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [srv.id]: {
          ok: false,
          message: err?.message || '測試失敗',
          latencyMs: 0,
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  // Upsert Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [serverId, setServerId] = useState('');
  const [serverName, setServerName] = useState('');
  const [serverDesc, setServerDesc] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'sse' | 'http'>('stdio');
  const [command, setCommand] = useState('npx');
  const [argsText, setArgsText] = useState('-y @modelcontextprotocol/server-filesystem /path');
  const [envText, setEnvText] = useState('{}');
  const [url, setUrl] = useState('http://127.0.0.1:3001/mcp');

  // Raw Config File Viewer/Editor Drawer
  const [rawEditor, setRawEditor] = useState<{
    agentKey: string;
    agentName: string;
    configPath: string;
    content: string;
  } | null>(null);

  // Batch deploy modal
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployTargetIds, setDeployTargetIds] = useState<string[]>([]);
  const [checkedAgentKeys, setCheckedAgentKeys] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadExternal = async () => {
    try {
      const res = await api.listMcp();
      setExternalMcp(res.externalMcp);
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    loadExternal();
  }, [mcpServers.length]);

  const handleToggleAgentMcp = async (srv: McpServerRecord, agentKey: string) => {
    const currentlyDeployed = Boolean(srv.deployments[agentKey]?.deployed);
    const agent = agents.find((a) => a.key === agentKey);
    await runWithMask(
      {
        loadingTitle: !currentlyDeployed
          ? `正在將 MCP「${srv.name}」寫入 ${agent?.name} 設定檔...`
          : `正在從 ${agent?.name} 設定檔移除 MCP「${srv.name}」...`,
        loadingSubtitle: `目標設定檔：${agent?.compactMcpPath}`,
        successTitle: !currentlyDeployed ? 'MCP 伺服器已掛載' : '已移除 MCP 掛載',
        successMessage: !currentlyDeployed
          ? `已成功將 MCP「${srv.id}」同步寫入 ${agent?.name} 的設定檔 (${agent?.compactMcpPath})！`
          : `已從 ${agent?.name} 的設定檔移除「${srv.id}」。`,
        errorTitle: '同步 MCP 設定失敗',
      },
      async () => {
        await api.batchDeployMcp([srv.id], [agentKey], !currentlyDeployed);
        await onRefreshOverview();
        await loadExternal();
      }
    );
  };

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverId.trim()) {
      showErrorModal('欄位未填寫', '請輸入 MCP Server ID');
      return;
    }

    let parsedEnv: Record<string, string> = {};
    if (envText.trim()) {
      try {
        parsedEnv = JSON.parse(envText);
      } catch {
        showErrorModal('環境變數 JSON 格式錯誤', '請確認環境變數 (env) 為有效的 JSON 物件格式，例如 {"KEY": "VALUE"}');
        return;
      }
    }

    // Parse arguments preserving quoted strings (e.g. "C:\\Program Files\\nodejs\\node.exe")
    const args = (argsText.trim().match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((token) =>
      token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token
    );

    await runWithMask(
      {
        loadingTitle: `正在儲存 MCP 伺服器「${serverId.trim()}」...`,
        successTitle: 'MCP 伺服器已儲存',
        successMessage: `已成功儲存 MCP 伺服器「${serverName.trim() || serverId.trim()}」！`,
        errorTitle: '儲存 MCP 伺服器失敗',
      },
      async () => {
        await api.upsertMcpServer({
          id: serverId.trim(),
          name: serverName.trim() || serverId.trim(),
          description: serverDesc.trim(),
          transport,
          command: command.trim(),
          args,
          env: parsedEnv,
          url: url.trim(),
        });
        setModalOpen(false);
        await onRefreshOverview();
      }
    );
  };

  const handleOpenRawConfig = async (agentKey: string) => {
    await runWithMask(
      {
        loadingTitle: '正在讀取本機 MCP 設定檔內容...',
        showSuccessDialog: false,
        errorTitle: '讀取 MCP 設定檔失敗',
      },
      async () => {
        const res = await api.getRawMcpConfig(agentKey);
        setRawEditor({
          agentKey: res.agentKey,
          agentName: res.agentName,
          configPath: res.configPath,
          content: res.content,
        });
      }
    );
  };

  const handleSaveRawConfig = async () => {
    if (!rawEditor) return;
    await runWithMask(
      {
        loadingTitle: `正在儲存 ${rawEditor.agentName} 的 MCP 設定檔...`,
        loadingSubtitle: rawEditor.configPath,
        successTitle: 'MCP 設定檔已儲存',
        successMessage: `已成功寫入 ${rawEditor.configPath}！`,
        errorTitle: '儲存 MCP 設定檔失敗 (請檢查語法格式)',
      },
      async () => {
        await api.saveRawMcpConfig(rawEditor.agentKey, rawEditor.content);
        await onRefreshOverview();
        await loadExternal();
      }
    );
  };

  const handleImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await runWithMask(
      {
        loadingTitle: '正在匯入 MCP 設定檔...',
        successTitle: 'MCP 匯入完成',
        successMessage: (res) => `已成功匯入 ${res.importedCount} 個 MCP 伺服器設定！`,
        errorTitle: '匯入 MCP 設定失敗',
      },
      async () => {
        const res = await api.importMcpFiles(files);
        await onRefreshOverview();
        return res;
      }
    );
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openEditModal = (srv?: McpServerRecord) => {
    if (srv) {
      setServerId(srv.id);
      setServerName(srv.name);
      setServerDesc(srv.description);
      setTransport(srv.transport);
      setCommand(srv.command);
      setArgsText((srv.args || []).map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' '));
      setEnvText(JSON.stringify(srv.env || {}, null, 2));
      setUrl(srv.url || 'http://127.0.0.1:3001/mcp');
    } else {
      setServerId('');
      setServerName('');
      setServerDesc('');
      setTransport('stdio');
      setCommand('npx');
      setArgsText('-y @modelcontextprotocol/server-filesystem /path');
      setEnvText('{}');
      setUrl('http://127.0.0.1:3001/mcp');
    }
    setModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Per-Tool Config File Cards */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                MCP (Model Context Protocol) 伺服器統一管理中心
              </h3>
              <p className="text-xs text-slate-400">
                一鍵將 MCP Server 同步寫入 GitHub Copilot (<code className="text-emerald-300">~/.copilot/mcp-config.json</code>)、Claude Code (<code className="text-emerald-300">~/.claude.json</code>) 與 OpenAI Codex (<code className="text-emerald-300">~/.codex/config.toml</code>)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                runWithMask(
                  {
                    loadingTitle: '正在從專案資料夾 (./skills, ./agents, ./mcp) 增量同步範例...',
                    successTitle: '專案範例同步完成',
                    successMessage: (res) =>
                      `已同步專案範例資料夾：新增 ${res.addedSkills} 個技能、${res.addedSubagents} 個 Agent、${res.addedMcp} 個 MCP！`,
                  },
                  async () => {
                    const res = await api.syncProjectSeeds(false);
                    await onRefreshOverview();
                    await loadExternal();
                    return res;
                  }
                )
              }
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
              title="將專案目錄下 ./skills、./agents、./mcp 中尚未載入的範例補齊至中央庫"
            >
              <RefreshCw className="h-3.5 w-3.5 text-teal-400" />
              同步專案範例資料夾
            </button>
            <button
              type="button"
              onClick={() => {
                const ids =
                  selectedIds.size > 0
                    ? Array.from(selectedIds)
                    : mcpServers.map((m) => m.id);
                setDeployTargetIds(ids);
                setCheckedAgentKeys(new Set(agents.filter((a) => a.enabled).map((a) => a.key)));
                setDeployModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-teal-500/40 bg-teal-500/15 px-3.5 py-2 text-xs font-semibold text-teal-200 hover:bg-teal-500/25 transition"
            >
              <Send className="h-3.5 w-3.5 text-teal-400" />
              部署 MCP 至指定工具...
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
            >
              <Upload className="h-3.5 w-3.5 text-teal-400" />
              匯入 JSON / ZIP
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.zip"
              multiple
              className="hidden"
              onChange={(e) => handleImportFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() =>
                runWithMask(
                  {
                    loadingTitle: '正在打包並下載 MCP 設定 (.zip)...',
                    successTitle: 'MCP ZIP 下載完成',
                    successMessage: (res) =>
                      `已下載「${res.filename}」(${(res.sizeBytes / 1024).toFixed(1)} KB)！`,
                  },
                  () =>
                    api.exportMcpZip(
                      selectedIds.size > 0 ? Array.from(selectedIds) : []
                    )
                )
              }
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
            >
              <Download className="h-3.5 w-3.5 text-teal-400" />
              下載 MCP (.zip)
            </button>
            <button
              type="button"
              onClick={() => openEditModal()}
              className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              新增 MCP Server
            </button>
          </div>
        </div>

        {/* Direct Raw Config File Access per AI Tool */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
          {agents.map((ag) => (
            <div
              key={ag.key}
              className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 flex items-center justify-between gap-2"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: ag.color }}
                  />
                  <span>{ag.name}</span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.2 font-mono text-[10px] text-slate-400">
                    {ag.mcpFormat === 'toml-codex' ? 'TOML' : 'JSON'}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-emerald-300 truncate">
                  個人：{ag.compactMcpPath}
                </div>
                <div className="font-mono text-[10px] text-slate-500 truncate">
                  專案：{(ag.mcpProjectPaths || ['.mcp.json']).join('、')}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleOpenRawConfig(ag.key)}
                  className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] text-teal-300 hover:bg-teal-500 hover:text-slate-950 transition"
                  title="檢視與直接編輯此工具的 MCP 設定檔原始碼"
                >
                  <FileCode className="h-3.5 w-3.5" />
                  編輯設定檔
                </button>
                <button
                  type="button"
                  onClick={() => api.openInOSFileManager(ag.resolvedMcpPath)}
                  className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:text-teal-300"
                  title="開啟所在目錄"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Central MCP Server Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {mcpServers.map((srv) => {
          const isSelected = selectedIds.has(srv.id);
          return (
            <div
              key={srv.id}
              onClick={() => openEditModal(srv)}
              className={`cursor-pointer select-none rounded-2xl border p-5 transition flex flex-col justify-between gap-4 ${
                isSelected
                  ? 'border-teal-500/60 bg-teal-500/5'
                  : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(srv.id)) next.delete(srv.id);
                          else next.add(srv.id);
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
                    <h4 className="font-bold text-sm text-slate-100">{srv.name}</h4>
                    <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-teal-300">
                      {srv.id}
                    </span>
                  </div>

                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5"
                  >
                    <button
                      type="button"
                      disabled={testingId === srv.id}
                      onClick={() => handleTestMcp(srv)}
                      className="flex items-center gap-1 rounded-lg border border-teal-500/40 bg-teal-500/10 px-2.5 py-1 text-[11px] font-medium text-teal-300 hover:bg-teal-500 hover:text-slate-950 disabled:opacity-50 transition"
                      title="直接啟動並發送 MCP JSON-RPC initialize 測試連線"
                    >
                      {testingId === srv.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      測試連線
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(srv)}
                      className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-teal-500 hover:text-slate-950 transition"
                    >
                      <Eye className="h-3 w-3" />
                      查看 / 編輯
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`確定要刪除 MCP「${srv.name}」嗎？`)) return;
                        await runWithMask(
                          {
                            loadingTitle: `正在刪除 MCP「${srv.name}」...`,
                            successTitle: 'MCP 已刪除',
                            successMessage: `已從中央庫與所有工具移除 MCP「${srv.name}」。`,
                          },
                          async () => {
                            await api.deleteMcpServers([srv.id]);
                            await onRefreshOverview();
                            await loadExternal();
                          }
                        );
                      }}
                      className="rounded-lg bg-rose-500/10 p-1.5 text-rose-300 hover:bg-rose-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-400">{srv.description}</p>

                <div className="rounded-xl bg-slate-950 border border-slate-800/80 px-3 py-2 font-mono text-[11px] text-slate-300 truncate">
                  {srv.transport === 'stdio'
                    ? `$ ${srv.command} ${(srv.args || []).join(' ')}`
                    : `${srv.transport.toUpperCase()}: ${srv.url}`}
                </div>

                {testResults[srv.id] && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`rounded-xl border px-3 py-2 text-[11px] flex items-start gap-2 ${
                      testResults[srv.id].ok
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                        : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                    }`}
                  >
                    {testResults[srv.id].ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <span className="break-all">{testResults[srv.id].message}</span>
                  </div>
                )}
              </div>

              <div
                onClick={(e) => e.stopPropagation()}
                className="border-t border-slate-800/80 pt-3 space-y-1.5"
              >
                <div className="text-[10px] text-slate-500">
                  點擊下方工具按鈕即可將此 MCP 寫入 / 移除該工具的設定檔：
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {agents.map((ag) => {
                    const dep = srv.deployments[ag.key];
                    const deployed = Boolean(dep?.deployed);
                    return (
                      <button
                        type="button"
                        key={ag.key}
                        onClick={() => handleToggleAgentMcp(srv, ag.key)}
                        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                          deployed
                            ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                            : 'border-slate-800 bg-slate-950/60 text-slate-500 hover:text-slate-300'
                        }`}
                        title={`${ag.name}: ${ag.compactMcpPath}`}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: deployed ? ag.color : '#475569' }}
                        />
                        <span>{ag.name}</span>
                        {deployed && <span className="text-[10px]">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Currently Configured MCP Servers inside Personal Config Files */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">
          目前實際存在於各工具個人設定檔中的 MCP Servers ({externalMcp.length})
        </h3>
        {externalMcp.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            各工具個人設定檔中目前尚無 MCP 伺服器，點擊上方卡片即可一鍵寫入。
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {externalMcp.map((ext) => (
              <div
                key={`${ext.agentKey}-${ext.serverId}`}
                className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-100">{ext.serverId}</span>
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                      {ext.agentName}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-400 truncate">
                    {ext.url || `${ext.command} ${(ext.args || []).join(' ')}`}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenRawConfig(ext.agentKey)}
                    className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-slate-300 hover:text-teal-300"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    查看設定檔
                  </button>
                  {!ext.managedByCentral && (
                    <button
                      type="button"
                      onClick={() =>
                        runWithMask(
                          {
                            loadingTitle: `正在將 MCP「${ext.serverId}」納管匯入中央庫...`,
                            successTitle: '納管匯入完成',
                            successMessage: `已將「${ext.serverId}」納管至中央 MCP 儲存庫！`,
                          },
                          async () => {
                            await api.adoptExternalMcp(ext.agentKey, ext.serverId);
                            await onRefreshOverview();
                            await loadExternal();
                          }
                        )
                      }
                      className="flex items-center gap-1 rounded-lg bg-amber-500/20 border border-amber-500/40 px-2.5 py-1 text-amber-300"
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

      {/* Add / Edit MCP Modal */}
      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100">
                設定 MCP (Model Context Protocol) 伺服器
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveServer} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Server ID (鍵值) *</label>
                  <input
                    required
                    type="text"
                    value={serverId}
                    onChange={(e) => setServerId(e.target.value)}
                    placeholder="例如: sqlite-local"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">顯示名稱</label>
                  <input
                    type="text"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    placeholder="例如: 本機 SQLite MCP"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">用途說明</label>
                <input
                  type="text"
                  value={serverDesc}
                  onChange={(e) => setServerDesc(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">傳輸協定 (Transport)</label>
                <select
                  value={transport}
                  onChange={(e) => setTransport(e.target.value as any)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                >
                  <option value="stdio">stdio (本機執行檔 / npx / node / python / uvx)</option>
                  <option value="http">http (本機 Streamable HTTP 端點)</option>
                  <option value="sse">sse (本機 Server-Sent Events 端點)</option>
                </select>
              </div>

              {transport === 'stdio' ? (
                <>
                  <div>
                    <label className="block text-slate-400 mb-1">執行指令 (Command) *</label>
                    <input
                      required
                      type="text"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="例如: npx、node、python3"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">參數 (Args - 以空白分隔)</label>
                    <input
                      type="text"
                      value={argsText}
                      onChange={(e) => setArgsText(e.target.value)}
                      placeholder="-y @modelcontextprotocol/server-filesystem /path"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">環境變數 (Env JSON)</label>
                    <textarea
                      rows={3}
                      value={envText}
                      onChange={(e) => setEnvText(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 font-mono text-slate-100"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-slate-400 mb-1">本機服務網址 (Local URL) *</label>
                  <input
                    required
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="http://127.0.0.1:3001/mcp"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl bg-slate-800 px-4 py-2 text-slate-300"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-teal-500 px-5 py-2 font-semibold text-slate-950"
                >
                  儲存 MCP Server
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch Deploy MCP Modal */}
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
                選擇目標工具同步 MCP 設定 ({deployTargetIds.length} 項)
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
                          設定檔：{ag.compactMcpPath}
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
                onClick={async () => {
                  const keys = Array.from(checkedAgentKeys);
                  await runWithMask(
                    {
                      loadingTitle: '正在從勾選的工具移除 MCP...',
                      successTitle: '已移除 MCP',
                      successMessage: '已成功更新工具設定檔！',
                    },
                    async () => {
                      await api.batchDeployMcp(deployTargetIds, keys, false);
                      setDeployModalOpen(false);
                      await onRefreshOverview();
                      await loadExternal();
                    }
                  );
                }}
                className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300"
              >
                從勾選工具移除
              </button>
              <button
                type="button"
                onClick={async () => {
                  const keys = Array.from(checkedAgentKeys);
                  await runWithMask(
                    {
                      loadingTitle: '正在將 MCP 同步寫入勾選的工具設定檔...',
                      successTitle: 'MCP 同步完成',
                      successMessage: '已成功將所選 MCP 寫入目標工具設定檔！',
                    },
                    async () => {
                      await api.batchDeployMcp(deployTargetIds, keys, true);
                      setDeployModalOpen(false);
                      await onRefreshOverview();
                      await loadExternal();
                    }
                  );
                }}
                className="rounded-xl bg-teal-500 px-5 py-2 text-xs font-semibold text-slate-950"
              >
                立即寫入勾選工具 ({checkedAgentKeys.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Raw Config File Editor Drawer */}
      {rawEditor && (
        <div
          onClick={() => setRawEditor(null)}
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
                    {rawEditor.agentName} — MCP 設定檔原始碼檢視與編輯
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400 mt-0.5 break-all">
                    {rawEditor.configPath}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveRawConfig}
                    className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-teal-400"
                  >
                    <Save className="h-3.5 w-3.5" />
                    儲存設定檔
                  </button>
                  <button
                    type="button"
                    onClick={() => setRawEditor(null)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <textarea
                value={rawEditor.content}
                onChange={(e) =>
                  setRawEditor({ ...rawEditor, content: e.target.value })
                }
                className="flex-1 w-full rounded-2xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100 focus:border-teal-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
