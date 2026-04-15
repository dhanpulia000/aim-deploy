import { useTranslation } from "react-i18next";
import { classNames } from "../utils/ticketUtils";

interface WebSocketStatusBadgeProps {
  connected: boolean;
  error: Error | null;
  onReconnect: () => void;
}

/**
 * WebSocket 실시간 연결 상태 배지 컴포넌트
 */
export function WebSocketStatusBadge({ connected, error, onReconnect }: WebSocketStatusBadgeProps) {
  const { t } = useTranslation("app");
  return (
    <div
      className={classNames(
        "flex items-center gap-2 rounded-xl px-3 py-2 text-sm",
        connected && !error
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : error
            ? "bg-red-50 text-red-700 border border-red-200"
            : "bg-amber-50 text-amber-700 border border-amber-200"
      )}
      title={
        connected && !error
          ? t("ws.connectedTitle")
          : error
            ? t("ws.errorTitle")
            : t("ws.connectingTitle")
      }
    >
      {connected && !error ? (
        <>
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span>{t("ws.live")}</span>
        </>
      ) : error ? (
        <>
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs font-bold">×</span>
          <span>Failed</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onReconnect(); }}
            className="ml-1 rounded px-2 py-0.5 text-xs font-medium bg-red-100 hover:bg-red-200 text-red-800 transition-colors"
          >
            {t("ws.reconnect")}
          </button>
        </>
      ) : (
        <>
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
          <span>{t("ws.connecting")}</span>
        </>
      )}
    </div>
  );
}
