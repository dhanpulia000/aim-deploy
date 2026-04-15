import { useState, useEffect } from "react";

export default function Dashboard() {
  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [reports, setReports] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedFileType, setSelectedFileType] = useState("");
  const [loadingReports, setLoadingReports] = useState(false);

  const reportTypes = [
    { value: "pc_daily", label: "PC 모니터링 일일 보고서.xlsx" },
    { value: "mobile_daily", label: "Mobile 모니터링 일일 보고서.xlsx" },
  ];

  useEffect(() => {
    const id = localStorage.getItem("agentId");
    if (!id) {
      window.location.href = "/login";
      return;
    }
    setAgentId(id);
    loadAgentData(id);
    loadReports(id);
  }, []);

  const loadAgentData = async (id: string) => {
    try {
      const res = await fetch(`/api/agents/${id}`);
      if (res.ok) {
        const data = await res.json();
        const agent = data.data || data;
        if (agent && agent.name) {
          setAgentName(agent.name);
        }
      }
    } catch (error) {
      console.error("에이전트 데이터 로드 실패:", error);
    }
  };

  const loadReports = async (id: string) => {
    setLoadingReports(true);
    try {
      const res = await fetch(`/api/reports/${id}`);
      if (res.ok) {
        const data = await res.json();
        const list = data.reports || data.data || [];
        setReports(list);
      } else {
        console.error("보고서 로드 실패:", res.statusText);
      }
    } catch (error) {
      console.error("보고서 로드 실패:", error);
    } finally {
      setLoadingReports(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!selectedFileType) {
      alert("파일 유형을 선택하세요");
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileType", selectedFileType);
      formData.append("agentId", agentId);

      const res = await fetch("/api/upload-report", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const result = await res.json();
        console.log("업로드 성공:", result);
        
        // 즉시 UI 업데이트 - 새 보고서를 목록에 추가
        const reportToAdd = result.report || result.data || { id: Date.now(), date: new Date().toISOString().split('T')[0], fileType: selectedFileType, fileName: file.name, status: 'processed' };
        setReports(prev => [...prev, reportToAdd]);
        
        alert("보고서가 업로드되었습니다!");
        setSelectedFileType("");
        // 파일 입력 초기화
        event.target.value = "";
      } else {
        const errorText = await res.text();
        console.error("업로드 실패:", errorText);
        alert("업로드 실패: " + res.statusText);
      }
    } catch (error) {
      alert("업로드 실패: " + error);
    } finally {
      setUploading(false);
    }
  };

  const deleteReport = async (reportId: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;

    try {
      await fetch(`/api/reports/${agentId}/${reportId}`, {
        method: "DELETE",
      });
      alert("보고서가 삭제되었습니다!");
      loadReports(agentId);
    } catch (error) {
      alert("삭제 실패: " + error);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("agentId");
    window.location.href = "/";
  };

  if (!agentId) return null;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">{agentName}의 대시보드</h1>
            <p className="text-sm text-slate-500">ID: {agentId}</p>
          </div>
          <div className="flex gap-3">
            <a
              href="/"
              className="px-4 py-2 bg-white border rounded-lg text-slate-700 hover:bg-slate-50"
            >
              현황판
            </a>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
            >
              로그아웃
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">보고서 업로드</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">파일 유형 선택</label>
              <select
                value={selectedFileType}
                onChange={(e) => setSelectedFileType(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">선택하세요</option>
                {reportTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">엑셀 파일 선택</label>
              <div className="flex gap-3">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileUpload}
                  disabled={!selectedFileType || uploading}
                  className="flex-1 px-3 py-2 border rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                지원 형식: .xlsx, .xls
              </p>
            </div>

            {uploading && (
              <div className="text-center py-4">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="text-sm text-slate-500 mt-2">업로드 중...</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-xl font-semibold mb-4">업로드된 보고서 ({reports.length})</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium">날짜</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">파일 유형</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">파일명</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">상태</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td className="px-4 py-3 text-sm">{report.date}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                        {report.fileType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">{report.fileName}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 rounded text-xs ${
                        report.status === "processed" 
                          ? "bg-green-100 text-green-700" 
                          : "bg-yellow-100 text-yellow-700"
                      }`}>
                        {report.status === "processed" ? "처리됨" : "미처리"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <button
                        onClick={() => deleteReport(report.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loadingReports && (
              <div className="text-center text-slate-500 py-8">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                <p className="text-sm mt-2">로딩 중...</p>
              </div>
            )}
            {!loadingReports && reports.length === 0 && (
              <div className="text-center text-slate-500 py-8">
                업로드된 보고서가 없습니다
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
