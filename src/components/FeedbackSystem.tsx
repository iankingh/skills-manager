import React, { createContext, useContext, useState, useCallback } from 'react';
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  X,
  Copy,
  Check,
} from 'lucide-react';

interface ActiveMaskState {
  title: string;
  subtitle?: string;
}

interface ErrorModalState {
  title: string;
  message: string;
  details?: string;
}

interface ResultModalState {
  title: string;
  message: string;
  details?: string;
}

interface FeedbackContextValue {
  isBusy: boolean;
  runWithMask: <T>(
    options: {
      loadingTitle: string;
      loadingSubtitle?: string;
      successTitle?: string;
      successMessage?: string | ((result: T) => string);
      successDetails?: string | ((result: T) => string | undefined);
      errorTitle?: string;
      showSuccessDialog?: boolean;
    },
    fn: () => Promise<T>
  ) => Promise<T | undefined>;
  showErrorModal: (title: string, message: string, details?: string) => void;
  showSuccessModal: (title: string, message: string, details?: string) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export const useFeedback = (): FeedbackContextValue => {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error('useFeedback must be used within a FeedbackProvider');
  }
  return ctx;
};

export const FeedbackProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [mask, setMask] = useState<ActiveMaskState | null>(null);
  const [errorModal, setErrorModal] = useState<ErrorModalState | null>(null);
  const [resultModal, setResultModal] = useState<ResultModalState | null>(null);
  const [copiedError, setCopiedError] = useState(false);

  const showErrorModal = useCallback(
    (title: string, message: string, details?: string) => {
      setMask(null);
      setResultModal(null);
      setErrorModal({ title, message, details });
    },
    []
  );

  const showSuccessModal = useCallback(
    (title: string, message: string, details?: string) => {
      setMask(null);
      setResultModal({ title, message, details });
    },
    []
  );

  const runWithMask = useCallback(
    async <T,>(
      options: {
        loadingTitle: string;
        loadingSubtitle?: string;
        successTitle?: string;
        successMessage?: string | ((result: T) => string);
        successDetails?: string | ((result: T) => string | undefined);
        errorTitle?: string;
        showSuccessDialog?: boolean;
      },
      fn: () => Promise<T>
    ): Promise<T | undefined> => {
      const startTime = Date.now();
      setMask({
        title: options.loadingTitle,
        subtitle:
          options.loadingSubtitle ||
          '請稍候，正在執行本機磁碟與同步操作，完成後將顯示執行結果...',
      });

      try {
        const result = await fn();
        // Ensure the mask is visible for at least 260ms so the user clearly sees the execution state
        const elapsed = Date.now() - startTime;
        if (elapsed < 260) {
          await new Promise((r) => setTimeout(r, 260 - elapsed));
        }
        setMask(null);

        if (options.successMessage && options.showSuccessDialog !== false) {
          const msg =
            typeof options.successMessage === 'function'
              ? options.successMessage(result)
              : options.successMessage;
          const det =
            typeof options.successDetails === 'function'
              ? options.successDetails(result)
              : options.successDetails;
          setResultModal({
            title: options.successTitle || '執行完成',
            message: msg,
            details: det,
          });
        }
        return result;
      } catch (err: any) {
        setMask(null);
        const errMsg =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
            ? err
            : '發生未預期的本機執行錯誤';
        setErrorModal({
          title: options.errorTitle || `${options.loadingTitle} — 執行失敗`,
          message: errMsg,
          details: err?.stack ? String(err.stack).split('\n').slice(0, 3).join('\n') : undefined,
        });
        return undefined;
      }
    },
    []
  );

  const handleCopyError = () => {
    if (!errorModal) return;
    const text = `[${errorModal.title}]\n${errorModal.message}${
      errorModal.details ? `\n${errorModal.details}` : ''
    }`;
    navigator.clipboard?.writeText(text);
    setCopiedError(true);
    setTimeout(() => setCopiedError(false), 2000);
  };

  return (
    <FeedbackContext.Provider
      value={{
        isBusy: Boolean(mask),
        runWithMask,
        showErrorModal,
        showSuccessModal,
      }}
    >
      {children}

      {/* 1. Full-Screen Blocking Execution Mask (執行中遮罩) */}
      {mask && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-xs select-none">
          <div className="w-full max-w-md rounded-2xl border border-teal-500/40 bg-slate-900 p-6 shadow-2xl text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-500/15 border border-teal-500/30 text-teal-400">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-slate-100">{mask.title}</h3>
              {mask.subtitle && (
                <p className="text-xs text-slate-400 leading-relaxed">
                  {mask.subtitle}
                </p>
              )}
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div className="bg-teal-400 h-full w-2/3 animate-pulse rounded-full" />
            </div>
          </div>
        </div>
      )}

      {/* 2. Centered Execution Result Modal (執行成功與狀態結果彈跳視窗) */}
      {resultModal && !errorModal && (
        <div
          onClick={() => setResultModal(null)}
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-emerald-500/40 bg-slate-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100">
                    {resultModal.title}
                  </h3>
                  <span className="text-[11px] text-emerald-400 font-medium">
                    本機操作已成功完成
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setResultModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 text-xs text-slate-200 leading-relaxed">
              {resultModal.message}
              {resultModal.details && (
                <div className="mt-2 pt-2 border-t border-slate-800/80 font-mono text-[11px] text-slate-400 break-all">
                  {resultModal.details}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                autoFocus
                onClick={() => setResultModal(null)}
                className="rounded-xl bg-teal-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400 transition"
              >
                確定 (OK)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Centered Error Popup Modal (執行錯誤訊息彈跳視窗) */}
      {errorModal && (
        <div
          onClick={() => setErrorModal(null)}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border-2 border-rose-500/60 bg-slate-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400 shrink-0">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-rose-200">
                    {errorModal.title}
                  </h3>
                  <span className="text-xs text-rose-400">
                    執行過程中發生錯誤，請檢視以下錯誤原因
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setErrorModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-xl border border-rose-500/30 bg-slate-950 p-4 space-y-2">
              <div className="text-xs font-semibold text-rose-300 break-words leading-relaxed">
                {errorModal.message}
              </div>
              {errorModal.details && (
                <pre className="text-[11px] font-mono text-slate-400 overflow-x-auto whitespace-pre-wrap pt-2 border-t border-slate-800">
                  {errorModal.details}
                </pre>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleCopyError}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs text-slate-300 hover:bg-slate-700 transition"
              >
                {copiedError ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    已複製錯誤訊息
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    複製錯誤訊息
                  </>
                )}
              </button>

              <button
                type="button"
                autoFocus
                onClick={() => setErrorModal(null)}
                className="rounded-xl bg-rose-500 px-5 py-2 text-xs font-semibold text-white hover:bg-rose-400 transition"
              >
                關閉視窗
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
};
