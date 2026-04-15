export interface MetricsOverviewProps {
  totalIssues: number;
  issuesByStatus: { status: string; count: number }[];
  todayCount: number;
}

export default function MetricsOverview({ 
  totalIssues, 
  issuesByStatus, 
  todayCount 
}: MetricsOverviewProps) {
  // Fallback 값들
  const defaultTotalIssues = totalIssues ?? 0;
  const defaultTodayCount = todayCount ?? 0;
  const defaultStatusData = issuesByStatus && issuesByStatus.length > 0 
    ? issuesByStatus 
    : [{ status: "N/A", count: 0 }];

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {/* 총 이슈 수 */}
      <div className="bg-white rounded-2xl border shadow-sm p-6">
        <div className="text-sm font-medium text-slate-500 mb-2">총 이슈 수</div>
        <div className="text-3xl font-bold text-slate-800">{defaultTotalIssues.toLocaleString()}</div>
        <div className="text-xs text-slate-400 mt-1">전체 이슈</div>
      </div>

      {/* 오늘 생성된 이슈 */}
      <div className="bg-white rounded-2xl border shadow-sm p-6">
        <div className="text-sm font-medium text-slate-500 mb-2">오늘 생성</div>
        <div className="text-3xl font-bold text-blue-600">{defaultTodayCount.toLocaleString()}</div>
        <div className="text-xs text-slate-400 mt-1">오늘 새로 생성된 이슈</div>
      </div>

      {/* 상태별 이슈 수 */}
      <div className="bg-white rounded-2xl border shadow-sm p-6 lg:col-span-2">
        <div className="text-sm font-medium text-slate-500 mb-4">상태별 이슈 수</div>
        <div className="grid grid-cols-2 gap-3">
          {defaultStatusData.map((item) => (
            <div key={item.status} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-sm font-medium text-slate-700">{item.status}</span>
              <span className="text-xl font-bold text-slate-800">{item.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
