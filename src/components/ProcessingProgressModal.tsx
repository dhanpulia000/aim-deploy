import { useTranslation } from "react-i18next";

interface ProcessingProgressModalProps {
  processingProgress: {
    current: number;
    total: number;
    isProcessing: boolean;
  } | null;
}

/**
 * 처리 진행 상황 모달 컴포넌트
 */
export function ProcessingProgressModal({ processingProgress }: ProcessingProgressModalProps) {
  const { t } = useTranslation();
  if (!processingProgress || !processingProgress.isProcessing) {
    return null;
  }

  const percentage = Math.round((processingProgress.current / processingProgress.total) * 100);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">{t("common.processingTitle")}</h3>
        <div className="mb-2">
          <div className="flex justify-between text-sm text-slate-600 mb-2">
            <span>{t("common.processingProgressLabel")}</span>
            <span>
              {processingProgress.current} / {processingProgress.total} ({percentage}%)
            </span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-4 text-center">
          {t("common.processingHint")}
        </p>
      </div>
    </div>
  );
}
