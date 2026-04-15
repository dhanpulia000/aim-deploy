import { Suspense, lazy, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import NotificationSettings from "./NotificationSettings";

const AgentAssistant = lazy(() => import("../pages/Agent/AgentAssistant"));
const Calendar = lazy(() => import("../Calendar"));
const WorkChecklist = lazy(() => import("../pages/Agent/WorkChecklist"));
const WorkGuideManagement = lazy(() => import("../pages/Admin/WorkGuideManagement"));
const WorkNotificationManagement = lazy(() => import("../pages/Admin/WorkNotificationManagement"));
const WorkChecklistManagement = lazy(() => import("../pages/Admin/WorkChecklistManagement"));
const StepFloatingManagement = lazy(() => import("../pages/Admin/StepFloatingManagement"));
const HandoverPage = lazy(() => import("../pages/Agent/HandoverPage"));
const NoticesPage = lazy(() => import("../pages/Notices/NoticesPage"));
const CommentWatchManagement = lazy(() => import("../pages/Admin/CommentWatchManagement"));
const ForumMonitoringPage = lazy(() => import("../pages/ForumMonitoring/ForumMonitoringPage"));

function ViewLoadingFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-slate-500">{t("common.loading")}</div>
    </div>
  );
}

interface ViewRouterProps {
  currentView: string;
  onBackToMain: () => void;
}

/**
 * 뷰 라우터: 메뉴로 연 페이지 본문만 렌더링.
 * 상단 바(로고·메뉴)는 App에서 항상 표시하므로 여기서는 헤더 없이 본문만.
 */
export function ViewRouter({ currentView, onBackToMain: _onBackToMain }: ViewRouterProps) {
  const wrap = (children: ReactNode, maxWidth?: string) => (
    <div className={`p-4 md:p-6 ${maxWidth ?? ""}`}>{children}</div>
  );

  if (currentView === "assistant") {
    return wrap(
      <Suspense fallback={<ViewLoadingFallback />}>
        <AgentAssistant />
      </Suspense>
    );
  }
  if (currentView === "notices") {
    return wrap(
      <Suspense fallback={<ViewLoadingFallback />}>
        <NoticesPage />
      </Suspense>
    );
  }
  if (currentView === "workGuideManagement") {
    return wrap(
      <Suspense fallback={<ViewLoadingFallback />}>
        <WorkGuideManagement />
      </Suspense>
    );
  }
  if (currentView === "workChecklist") {
    return wrap(
      <Suspense fallback={<ViewLoadingFallback />}>
        <WorkChecklist />
      </Suspense>
    );
  }
  if (currentView === "handover") {
    return wrap(
      <Suspense fallback={<ViewLoadingFallback />}>
        <HandoverPage />
      </Suspense>
    );
  }
  if (currentView === "calendar") {
    return wrap(
      <Suspense fallback={<ViewLoadingFallback />}>
        <Calendar />
      </Suspense>
    );
  }
  if (currentView === "workNotificationManagement") {
    return wrap(
      <Suspense fallback={<ViewLoadingFallback />}>
        <WorkNotificationManagement />
      </Suspense>
    );
  }
  if (currentView === "workChecklistManagement") {
    return wrap(
      <Suspense fallback={<ViewLoadingFallback />}>
        <WorkChecklistManagement />
      </Suspense>
    );
  }
  if (currentView === "stepFloatingManagement") {
    return wrap(
      <Suspense fallback={<ViewLoadingFallback />}>
        <StepFloatingManagement />
      </Suspense>
    );
  }
  if (currentView === "notificationSettings") {
    return wrap(<NotificationSettings />, "max-w-4xl mx-auto");
  }
  if (currentView === "commentWatchManagement") {
    return wrap(
      <Suspense fallback={<ViewLoadingFallback />}>
        <CommentWatchManagement />
      </Suspense>
    );
  }
  if (currentView === "forumMonitoring") {
    return wrap(
      <Suspense fallback={<ViewLoadingFallback />}>
        <ForumMonitoringPage />
      </Suspense>,
      "max-w-6xl mx-auto"
    );
  }
  return null;
}
