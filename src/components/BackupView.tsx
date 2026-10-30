import React, { useState } from 'react';
import {
  Archive,
  Download,
  RotateCcw,
  Trash2,
  ShieldCheck,
  Clock,
  Plus,
} from 'lucide-react';
import { api } from '../api';
import { ActivityLogEntry, BackupSnapshot } from '../types';
import { useFeedback } from './FeedbackSystem';

interface BackupViewProps {
  snapshots: BackupSnapshot[];
  activityLogs: ActivityLogEntry[];
  onRefresh: () => Promise<void> | void;
}

export const BackupView: React.FC<BackupViewProps> = ({
  snapshots,
  activityLogs,
  onRefresh,
}) => {
  const { runWithMask } = useFeedback();
  const [note, setNote] = useState('');

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    const snapNote = note.trim() || '手動建立本機離線 ZIP 備份';
    await runWithMask(
      {
        loadingTitle: '正在打包建立本機離線 ZIP 快照備份...',
        loadingSubtitle: `備註：${snapNote}`,
        successTitle: '本機 ZIP 快照建立完成',
        successMessage: (res) =>
          `已成功建立快照「${res.snapshot.filename}」(${res.snapshot.skillCount} 個技能，${(
            res.snapshot.sizeBytes / 1024
          ).toFixed(1)} KB)！`,
        successDetails: (res) => res.snapshot.filePath,
        errorTitle: '建立本機快照失敗',
      },
      async () => {
        const res = await api.createSnapshot(snapNote);
        setNote('');
        await onRefresh();
        return res;
      }
    );
  };

  const handleDownloadFullBackup = async () => {
    await runWithMask(
      {
        loadingTitle: '正在打包並下載完整技能庫 (.zip)...',
        loadingSubtitle: '正在壓縮中央儲存庫內所有技能目錄...',
        successTitle: '完整技能庫 ZIP 下載完成',
        successMessage: (res) =>
          `已成功打包並下載「${res.filename}」(${(res.sizeBytes / 1024).toFixed(1)} KB)！`,
        errorTitle: '匯出完整技能庫 ZIP 失敗',
      },
      () => api.exportSkillsZipBundle([], 'skills-library-full-backup.zip')
    );
  };

  const handleDownloadSnapshot = async (filename: string) => {
    await runWithMask(
      {
        loadingTitle: `正在下載備份快照「${filename}」...`,
        successTitle: '快照 ZIP 下載完成',
        successMessage: (res) =>
          `已成功下載備份檔「${res.filename}」(${(res.sizeBytes / 1024).toFixed(1)} KB)！`,
        errorTitle: '下載備份快照失敗',
      },
      () => api.downloadSnapshotZip(filename)
    );
  };

  const handleRestore = async (filename: string) => {
    if (
      !window.confirm(
        `確定要從快照「${filename}」還原嗎？還原前系統會自動為您當前的狀態建立一份安全備份快照。`
      )
    ) {
      return;
    }
    await runWithMask(
      {
        loadingTitle: `正在還原快照「${filename}」...`,
        loadingSubtitle: '正在先建立還原前安全備份，並解壓縮還原技能庫...',
        successTitle: '快照版本還原完成',
        successMessage: (res) =>
          `已從快照「${filename}」成功還原 ${res.restoredCount} 個技能！（還原前的狀態已自動另存為安全快照）`,
        errorTitle: '還原快照失敗',
      },
      async () => {
        const res = await api.restoreSnapshot(filename);
        await onRefresh();
        return res;
      }
    );
  };

  const handleDelete = async (filename: string) => {
    if (!window.confirm(`確定要刪除本機備份檔案「${filename}」嗎？`)) return;
    await runWithMask(
      {
        loadingTitle: `正在刪除備份快照「${filename}」...`,
        successTitle: '備份快照已刪除',
        successMessage: `已從本機刪除備份檔案「${filename}」。`,
        errorTitle: '刪除備份快照失敗',
      },
      async () => {
        await api.deleteSnapshot(filename);
        await onRefresh();
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Offline Backup Guarantee Banner */}
      <div className="rounded-2xl border border-teal-500/30 bg-teal-500/10 p-5 flex items-start gap-3.5">
        <ShieldCheck className="h-6 w-6 text-teal-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs">
          <h2 className="text-sm font-bold text-teal-200">
            100% 純本機離線 ZIP 快照備份中心 (無任何雲端或外部 Git 連線)
          </h2>
          <p className="text-teal-100/80 leading-relaxed">
            已完全移除原版對 GitHub OAuth 與遠端 Git 伺服器的聯網同步功能。所有快照均以標準{' '}
            <code className="text-teal-300">.zip</code> 格式儲存於您個人目錄的{' '}
            <code className="text-teal-300">~/.skills-manager/backups/</code>，可隨時一鍵下載攜帶、匯入或瞬間還原。
          </p>
        </div>
      </div>

      {/* Create Snapshot Form */}
      <form
        onSubmit={handleCreateSnapshot}
        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-wrap items-center gap-3"
      >
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="輸入備份版本備註（例如：調整 Claude Code 與 Cursor 技能組合前備份）..."
          className="flex-1 min-w-[240px] rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
        />
        <button
          type="submit"
          className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-teal-400 transition"
        >
          <Plus className="h-4 w-4" />
          立即建立本機 ZIP 快照
        </button>
        <button
          type="button"
          onClick={handleDownloadFullBackup}
          className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
        >
          <Download className="h-4 w-4 text-teal-400" />
          直接下載完整技能庫 (.zip)
        </button>
      </form>

      {/* Snapshots Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
        <div className="border-b border-slate-800 px-5 py-3.5 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Archive className="h-4 w-4 text-teal-400" />
            本機歷史快照列表 ({snapshots.length})
          </h3>
        </div>
        {snapshots.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            目前尚無本機備份快照，點擊上方「立即建立本機 ZIP 快照」即可隨時建立還原點。
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {snapshots.map((snap) => (
              <div
                key={snap.filename}
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 hover:bg-slate-800/40 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-semibold text-slate-200">{snap.note}</div>
                  <div className="font-mono text-[11px] text-slate-400">
                    {snap.filename} · {snap.skillCount} 個技能 ·{' '}
                    {(snap.sizeBytes / 1024).toFixed(1)} KB ·{' '}
                    {new Date(snap.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownloadSnapshot(snap.filename)}
                    className="flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-1.5 text-slate-200 hover:bg-slate-700"
                  >
                    <Download className="h-3.5 w-3.5 text-teal-400" />
                    下載 ZIP
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRestore(snap.filename)}
                    className="flex items-center gap-1 rounded-xl bg-teal-500/15 border border-teal-500/40 px-3 py-1.5 text-teal-300 hover:bg-teal-500/25"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    還原此版本
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(snap.filename)}
                    className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-300 hover:bg-rose-500/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity Logs */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
        <div className="border-b border-slate-800 px-5 py-3.5 flex items-center gap-2">
          <Clock className="h-4 w-4 text-teal-400" />
          <h3 className="text-sm font-semibold text-slate-200">
            本機操作紀錄 (Activity Log)
          </h3>
        </div>
        <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/60 text-xs">
          {activityLogs.map((log) => (
            <div key={log.id} className="px-5 py-2.5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 truncate">
                <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-teal-300 shrink-0">
                  {log.action}
                </span>
                <span className="text-slate-200 truncate">{log.summary}</span>
              </div>
              <span className="text-[11px] text-slate-500 shrink-0">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
          {activityLogs.length === 0 && (
            <div className="p-6 text-center text-slate-500">尚無本機操作紀錄</div>
          )}
        </div>
      </div>
    </div>
  );
};
