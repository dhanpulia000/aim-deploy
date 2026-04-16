import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";

type TriggerAlertRow = {
  topic: string;
  author: string;
  postNumber: number;
  keywords: string;
  message: string;
  link: string;
  time: string;
};

type DuplicateAlertRow = {
  newTopic: string;
  newTopicLink: string;
  originalTopic: string;
  originalTopicLink: string;
  matchType: string;
  similarity: number;
  time: string;
};

const ITEMS_PER_PAGE = 20;

function formatTimeKst(value: string) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("en-US", { timeZone: "Asia/Seoul" });
  } catch {
    return value;
  }
}

export default function InzoiStandaloneAlertsPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triggerRows, setTriggerRows] = useState<TriggerAlertRow[]>([]);
  const [duplicateRows, setDuplicateRows] = useState<DuplicateAlertRow[]>([]);
  const [triggerPage, setTriggerPage] = useState(1);
  const [duplicatePage, setDuplicatePage] = useState(1);

  const authHeaders = useMemo(() => createAuthHeaders(token), [token]);
  const triggerTotalPages = Math.max(
    1,
    Math.ceil(triggerRows.length / ITEMS_PER_PAGE),
  );
  const duplicateTotalPages = Math.max(
    1,
    Math.ceil(duplicateRows.length / ITEMS_PER_PAGE),
  );
  const triggerPageRows = useMemo(() => {
    const start = (triggerPage - 1) * ITEMS_PER_PAGE;
    return triggerRows.slice(start, start + ITEMS_PER_PAGE);
  }, [triggerRows, triggerPage]);
  const duplicatePageRows = useMemo(() => {
    const start = (duplicatePage - 1) * ITEMS_PER_PAGE;
    return duplicateRows.slice(start, start + ITEMS_PER_PAGE);
  }, [duplicateRows, duplicatePage]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [triggerRes, duplicateRes] = await Promise.all([
        fetch("/api/monitoring/inzoi-standalone/trigger-alerts?limit=200", {
          headers: authHeaders ?? undefined,
        }),
        fetch("/api/monitoring/inzoi-standalone/duplicate-alerts?limit=200", {
          headers: authHeaders ?? undefined,
        }),
      ]);

      if (!triggerRes.ok || !duplicateRes.ok) {
        throw new Error(`HTTP ${triggerRes.status}/${duplicateRes.status}`);
      }

      const triggerJson = await triggerRes.json();
      const duplicateJson = await duplicateRes.json();

      const triggerData = Array.isArray(triggerJson?.data)
        ? triggerJson.data
        : [];
      const duplicateData = Array.isArray(duplicateJson?.data)
        ? duplicateJson.data
        : [];

      setTriggerRows(triggerData);
      setDuplicateRows(duplicateData);
      setTriggerPage(1);
      setDuplicatePage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (triggerPage > triggerTotalPages) {
      setTriggerPage(triggerTotalPages);
    }
  }, [triggerPage, triggerTotalPages]);

  useEffect(() => {
    if (duplicatePage > duplicateTotalPages) {
      setDuplicatePage(duplicateTotalPages);
    }
  }, [duplicatePage, duplicateTotalPages]);

  return (
    <div className="w-full p-2 md:p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            inZOI Forum Alerts
          </h1>
          <p className="text-sm text-slate-500">
            Tables mirrored from standalone monitor notifications.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Failed to load inZOI standalone alerts: {error}
        </div>
      )}

      <div className="flex flex-col gap-6 2xl:flex-row 2xl:items-start">
        <section className="w-full 2xl:flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3">
            <span className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
              <span role="img" aria-label="alert">
                🚨
              </span>
              <span>Trigger Word Detected (inZOI Forum)</span>
            </span>
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-3 py-2 text-left">Topic</th>
                  <th className="px-3 py-2 text-left">Author</th>
                  <th className="px-3 py-2 text-left">Post #</th>
                  <th className="px-3 py-2 text-left">Keyword(s)</th>
                  <th className="px-3 py-2 text-left">Message</th>
                  <th className="px-3 py-2 text-left">Link</th>
                  <th className="px-3 py-2 text-left">Time</th>
                </tr>
              </thead>
              <tbody>
                {triggerPageRows.map((row, idx) => (
                  <tr
                    key={`${row.link}-${row.time}-${idx}`}
                    className="border-t border-slate-100"
                  >
                    <td className="px-3 py-2 w-[200px] min-w-[200px] max-w-[200px] truncate" title={row.topic || ""}>
                      {row.topic || "-"}
                    </td>
                    <td className="px-3 py-2">{row.author || "-"}</td>
                    <td className="px-3 py-2">{row.postNumber ?? "-"}</td>
                    <td className="px-3 py-2">{row.keywords || "-"}</td>
                    <td
                      className="px-3 py-2 max-w-[220px] truncate"
                      title={row.message || ""}
                    >
                      {row.message || "-"}
                    </td>
                    <td className="px-3 py-2">
                      {row.link ? (
                        <a
                          href={row.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          Open
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatTimeKst(row.time)}
                    </td>
                  </tr>
                ))}
                {triggerRows.length === 0 && (
                  <tr>
                    <td
                      className="px-3 py-6 text-center text-slate-500"
                      colSpan={7}
                    >
                      No trigger alerts yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
            <span>
              Page {triggerPage} of {triggerTotalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTriggerPage((p) => Math.max(1, p - 1))}
                disabled={triggerPage <= 1}
                className="rounded border border-slate-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() =>
                  setTriggerPage((p) => Math.min(triggerTotalPages, p + 1))
                }
                disabled={triggerPage >= triggerTotalPages}
                className="rounded border border-slate-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <section className="w-full 2xl:w-[620px] 2xl:flex-none rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3">
            <span className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
              <span role="img" aria-label="warning">
                ⚠️
              </span>
              <span>Possible Duplicate Topic Detected</span>
            </span>
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-3 py-2 text-left">New Topic</th>
                  <th className="px-3 py-2 text-left">Original Topic</th>
                  <th className="px-3 py-2 text-left">Match Type</th>
                  <th className="px-3 py-2 text-left">Similarity</th>
                  <th className="px-3 py-2 text-left">Time</th>
                </tr>
              </thead>
              <tbody>
                {duplicatePageRows.map((row, idx) => (
                  <tr
                    key={`${row.newTopicLink}-${row.time}-${idx}`}
                    className="border-t border-slate-100"
                  >
                    <td className="px-3 py-2">
                      {row.newTopicLink ? (
                        <a
                          href={row.newTopicLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {row.newTopic || "-"}
                        </a>
                      ) : (
                        row.newTopic || "-"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.originalTopicLink ? (
                        <a
                          href={row.originalTopicLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {row.originalTopic || "-"}
                        </a>
                      ) : (
                        row.originalTopic || "-"
                      )}
                    </td>
                    <td className="px-3 py-2">{row.matchType || "-"}</td>
                    <td className="px-3 py-2">
                      {Number.isFinite(row.similarity)
                        ? `${(row.similarity * 100).toFixed(2)}%`
                        : "-"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatTimeKst(row.time)}
                    </td>
                  </tr>
                ))}
                {duplicateRows.length === 0 && (
                  <tr>
                    <td
                      className="px-3 py-6 text-center text-slate-500"
                      colSpan={5}
                    >
                      No duplicate alerts yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
            <span>
              Page {duplicatePage} of {duplicateTotalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDuplicatePage((p) => Math.max(1, p - 1))}
                disabled={duplicatePage <= 1}
                className="rounded border border-slate-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() =>
                  setDuplicatePage((p) => Math.min(duplicateTotalPages, p + 1))
                }
                disabled={duplicatePage >= duplicateTotalPages}
                className="rounded border border-slate-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
