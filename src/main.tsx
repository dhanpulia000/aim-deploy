import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import Login from "./Login.tsx";
import { AuthProvider, useAuth } from "./auth/AuthContext.tsx";
import { IssueProvider } from "./contexts/IssueContext.tsx";
import { AppLoadingScreen } from "./components/AppLoadingScreen.tsx";
import { LanguageSwitcher } from "./components/LanguageSwitcher.tsx";
import { cn } from "./utils/cn";
import { agentManualBasePath } from "./utils/agentManual";
import "./i18n/config";
import "./index.css";

// 라우트별 지연 로딩 — 첫 화면(메인/로그인)만 먼저 로드하고 나머지는 해당 경로 진입 시 로드
const App = lazy(() => import("./App.tsx"));
const Admin = lazy(() => import("./Admin.tsx"));
const MonitoringControl = lazy(() => import("./pages/Admin/MonitoringControl.tsx"));
const ClanManagement = lazy(() => import("./pages/Admin/ClanManagement.tsx"));
const CardExchangeManagement = lazy(() => import("./pages/Admin/CardExchangeManagement.tsx"));
const BoardIssueStatsPage = lazy(() => import("./pages/Admin/BoardIssueStatsPage.tsx"));
const BoardListSnapshotPage = lazy(() => import("./pages/Admin/BoardListSnapshotPage.tsx"));
const PartnerVideoArchiving = lazy(() => import("./PartnerVideoArchiving.tsx"));
const DailyReportDownloader = lazy(() => import("./DailyReportDownloader.tsx"));
const WeeklyReportGenerator = lazy(() => import("./WeeklyReportGenerator.tsx"));
const Calendar = lazy(() => import("./Calendar.tsx"));

type TopNavLink = {
  type: "link";
  label: string;
  path: string;
  icon?: "calendar";
  roles?: string[];
};

type TopNavGroupChild = {
  label: string;
  path: string;
  roles?: string[];
};

type TopNavGroup = {
  type: "group";
  menuId: string;
  label: string;
  roles?: string[];
  children: TopNavGroupChild[];
};

type TopNavItem = TopNavLink | TopNavGroup;

type TopNavLinkDef = {
  type: "link";
  labelKey: string;
  path: string;
  icon?: "calendar";
  roles?: string[];
};

type TopNavGroupChildDef = {
  labelKey: string;
  path: string;
  roles?: string[];
};

type TopNavGroupDef = {
  type: "group";
  menuId: string;
  labelKey: string;
  roles?: string[];
  children: TopNavGroupChildDef[];
};

type TopNavItemDef = TopNavLinkDef | TopNavGroupDef;

/** 상단 메뉴에 클랜 항목이 없을 때 알림 폴링을 끕니다. */
const CLAN_ALERT_POLL_ENABLED = false;

const TOP_NAV_DEF: TopNavItemDef[] = [
  { type: "link", labelKey: "nav.main", path: "/" },
  { type: "link", labelKey: "nav.monitoring", path: "/admin/monitoring", roles: ["ADMIN", "LEAD"] },
  { type: "link", labelKey: "nav.dailyReport", path: "/daily-report" },
  {
    type: "group",
    menuId: "board-stats",
    labelKey: "nav.boardStatsGroup",
    children: [
      { labelKey: "nav.boardCounts", path: "/board-issue-stats" },
      { labelKey: "nav.listSnapshots", path: "/board-list-snapshots" }
    ]
  },
  { type: "link", labelKey: "nav.partnerArchiving", path: "/partner-archiving" },
  { type: "link", labelKey: "nav.calendar", path: "/calendar", icon: "calendar" },
  { type: "link", labelKey: "nav.admin", path: "/admin", roles: ["ADMIN", "LEAD"] }
];

function buildTopNav(t: TFunction, defs: TopNavItemDef[]): TopNavItem[] {
  return defs.map((item) => {
    if (item.type === "link") {
      return {
        type: "link",
        label: t(item.labelKey),
        path: item.path,
        icon: item.icon,
        roles: item.roles
      };
    }
    return {
      type: "group",
      menuId: item.menuId,
      label: t(item.labelKey),
      roles: item.roles,
      children: item.children.map((c) => ({
        label: t(c.labelKey),
        path: c.path,
        roles: c.roles
      }))
    };
  });
}

function filterTopNavByRole(items: TopNavItem[], userRole: string | null): TopNavItem[] {
  const out: TopNavItem[] = [];
  for (const item of items) {
    if (item.type === "link") {
      if (item.roles?.length && !item.roles.includes(userRole || "")) continue;
      out.push(item);
    } else {
      if (item.roles?.length && !item.roles.includes(userRole || "")) continue;
      const children = item.children.filter(
        (c) => !c.roles?.length || c.roles.includes(userRole || "")
      );
      if (children.length === 0) continue;
      out.push({ ...item, children });
    }
  }
  return out;
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

interface LayoutProps {
  currentPath: string;
  navigate: (path: string) => void;
  children: React.ReactNode;
}

function AppLayout({ currentPath, navigate, children, userRole }: LayoutProps & { userRole?: string | null }) {
  const { t, i18n } = useTranslation();
  const { token, selectedProjectId } = useAuth();
  const [clanAlertCount, setClanAlertCount] = useState<number>(0);
  const [postMgmtOpen, setPostMgmtOpen] = useState(false);
  const postMgmtRef = useRef<HTMLDivElement | null>(null);

  const navItems = useMemo(() => {
    const built = buildTopNav(t, TOP_NAV_DEF);
    return filterTopNavByRole(built, userRole ?? null);
  }, [t, i18n.language, userRole]);

  useEffect(() => {
    setPostMgmtOpen(false);
  }, [currentPath]);

  useEffect(() => {
    if (!postMgmtOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (postMgmtRef.current && !postMgmtRef.current.contains(e.target as Node)) {
        setPostMgmtOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPostMgmtOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [postMgmtOpen]);

  const isActivePath = useCallback(
    (path: string) => {
      if (path === "/") {
        return currentPath === "/";
      }

      // "관리"(/admin)는 정확히 /admin 일 때만 활성화 (하위 경로는 별도 메뉴로 처리)
      if (path === "/admin") {
        return currentPath === "/admin";
      }

      // 기타 메뉴는 자신 또는 자신의 하위 경로에서만 활성화
      return currentPath === path || currentPath.startsWith(`${path}/`);
    },
    [currentPath]
  );

  // 클랜 게시글 알림 개수(메뉴에 클랜이 있을 때만)
  useEffect(() => {
    if (!CLAN_ALERT_POLL_ENABLED) {
      setClanAlertCount(0);
      return;
    }
    const fetchClanAlertCount = async () => {
      try {
        const params = new URLSearchParams();
        if (selectedProjectId) {
          params.append('projectId', selectedProjectId.toString());
        }
        // 알림 개수만 계산 (서버 부하 완화: 1000건으로 제한, 배지 정확도와 성능 균형)
        params.append('limit', '1000');
        
        const headers: HeadersInit = {};
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        const res = await fetch(`/api/issues/clan?${params.toString()}`, {
          headers,
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const body = await res.json();
          const data = body.data || body;
          const issues = data.issues || [];
          
          // localStorage에서 해제된 알림 로드
          const saved = localStorage.getItem('clanDismissedAlerts');
          const dismissedAlerts: Record<string, string[]> = saved ? JSON.parse(saved) : {};
          
          // 해제되지 않은 알림이 있는 게시글 개수 계산
          const count = issues.filter((issue: any) => {
            if (!issue.alerts || issue.alerts.length === 0) return false;
            const dismissed = dismissedAlerts[issue.id] || [];
            const activeAlerts = issue.alerts.filter((alert: any) => !dismissed.includes(alert.type));
            return activeAlerts.length > 0;
          }).length;
          
          setClanAlertCount(count);
        }
      } catch {
        // 백엔드 연결 불가 시 조용히 실패 (배지만 0으로 유지)
      }
    };

    let poll: ReturnType<typeof setInterval> | undefined;
    const startDelay = setTimeout(() => {
      void fetchClanAlertCount();
      poll = setInterval(() => void fetchClanAlertCount(), 60000);
    }, 500);

    
    // localStorage 변경 감지하여 알림 개수 즉시 갱신
    // storage 이벤트는 다른 탭에서만 발생하므로 CustomEvent 사용
    const handleCustomStorageChange = () => {
      fetchClanAlertCount();
    };
    window.addEventListener('clanDismissedAlertsChanged', handleCustomStorageChange);
    
    // 다른 탭에서 localStorage 변경 감지
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'clanDismissedAlerts') {
        fetchClanAlertCount();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      clearTimeout(startDelay);
      if (poll) clearInterval(poll);
      window.removeEventListener('clanDismissedAlertsChanged', handleCustomStorageChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [token, selectedProjectId]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* z-index: 본문(main)보다 위에 두어 드롭다운이 페이지 상단 도구줄(예: App 메뉴 버튼)에 가리지 않게 함 */}
      <header className="relative z-40 glass-effect border-b border-slate-200/50 backdrop-blur-md shadow-soft">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            {/* 로고 - 왼쪽 끝 */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => navigate('/')}
                className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
                title={t("common.logoTitle")}
              >
                <img 
                  src="/latis-logo.png" 
                  alt="Latis Global Communications" 
                  className="h-10 w-auto drop-shadow-sm"
                  onError={(e) => {
                    // 이미지 로드 실패 시 대체 텍스트 로고 표시
                    const target = e.target as HTMLImageElement;
                    if (target.parentElement && !target.parentElement.querySelector('.logo-fallback')) {
                      target.style.display = 'none';
                      const fallback = document.createElement('div');
                      fallback.className = 'logo-fallback flex items-center gap-2';
                      fallback.innerHTML = `
                        <div class="flex gap-0.5">
                          <div class="w-3 h-3 rounded bg-orange-500"></div>
                          <div class="w-3 h-3 rounded bg-blue-500"></div>
                          <div class="w-3 h-3 rounded bg-orange-600"></div>
                          <div class="w-3 h-3 rounded bg-red-500"></div>
                        </div>
                        <span class="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Latis</span>
                      `;
                      target.parentElement.appendChild(fallback);
                    }
                  }}
                />
              </button>
            </div>
            {/* 메뉴 - 오른쪽 끝 */}
            <nav className="flex flex-wrap gap-2 items-center">
              {navItems.map((item) => {
                if (item.type === "group") {
                  const anyChildActive = item.children.some((c) => isActivePath(c.path));
                  const showClanBadge =
                    clanAlertCount > 0 && item.children.some((c) => c.path === "/clan");
                  return (
                    <div
                      key={item.menuId}
                      ref={postMgmtRef}
                      className={cn("relative", postMgmtOpen && "z-50")}
                    >
                      <button
                        type="button"
                        onClick={() => setPostMgmtOpen((o) => !o)}
                        aria-expanded={postMgmtOpen}
                        aria-haspopup="menu"
                        className={cn(
                          "ui-btn relative gap-1",
                          anyChildActive || postMgmtOpen
                            ? "ui-btn-primary shadow-medium"
                            : "ui-btn-ghost text-slate-600"
                        )}
                      >
                        {item.label}
                        <svg
                          className={cn("h-3.5 w-3.5 opacity-80 transition-transform", postMgmtOpen && "rotate-180")}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                          aria-hidden
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                        {showClanBadge && (
                          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold shadow-sm bg-gradient-to-r from-red-500 to-red-600 text-white">
                            {clanAlertCount > 99 ? "99+" : clanAlertCount}
                          </span>
                        )}
                      </button>
                      {postMgmtOpen && (
                        <div
                          role="menu"
                          className="absolute right-0 z-[100] mt-1 min-w-[12.5rem] rounded-xl border border-slate-200/90 bg-white py-1 shadow-xl dark:border-slate-600 dark:bg-slate-800"
                        >
                          {item.children.map((child) => {
                            const childActive = isActivePath(child.path);
                            const childClanBadge = child.path === "/clan" && clanAlertCount > 0;
                            return (
                              <button
                                key={child.path}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  navigate(child.path);
                                  setPostMgmtOpen(false);
                                }}
                                className={cn(
                                  "relative flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium transition-colors",
                                  childActive
                                    ? "bg-blue-50 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100"
                                    : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/60"
                                )}
                              >
                                <span className="min-w-0">
                                  <span className="block leading-snug">{child.label}</span>
                                </span>
                                {childClanBadge && (
                                  <span className="flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                    {clanAlertCount > 99 ? "99+" : clanAlertCount}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                const active = isActivePath(item.path);
                const hasIcon = item.icon === "calendar";

                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className={cn(
                      "ui-btn relative",
                      active ? "ui-btn-primary shadow-medium" : "ui-btn-ghost text-slate-600"
                    )}
                  >
                    {hasIcon && <CalendarIcon className="h-4 w-4" />}
                    {item.label}
                  </button>
                );
              })}
              <LanguageSwitcher className="shrink-0" />
              {/* 사용설명서 링크 */}
              <a
                href={agentManualBasePath(i18n)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-white/60 backdrop-blur-sm shadow-sm transition-all duration-300 flex items-center gap-1.5"
                title={t("common.userManualTitle")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                {t("common.userManual")}
              </a>
            </nav>
          </div>
        </div>
      </header>
      <main className="relative z-0 flex-1">{children}</main>
    </div>
  );
}

function Router() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const { user, loading } = useAuth();
  const redirectCountRef = useRef(0); // 리다이렉트 횟수 추적 (무한 루프 방지)

  useEffect(() => {
    const handleNavigation = () => {
      setCurrentPath(window.location.pathname);
    };

    // popstate 이벤트 (뒤로/앞으로 가기)
    window.addEventListener("popstate", handleNavigation);
    
    // 사파리 호환성: location 변경 감지 (pushState/replaceState 감지)
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    
    window.history.pushState = function(...args) {
      originalPushState.apply(window.history, args);
      handleNavigation();
    };
    
    window.history.replaceState = function(...args) {
      originalReplaceState.apply(window.history, args);
      handleNavigation();
    };
    
    // 초기 경로 설정
    handleNavigation();
    
    return () => {
      window.removeEventListener("popstate", handleNavigation);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, []);

  const navigate = useCallback((path: string) => {
    if (window.location.pathname === path) {
      // 이미 "/" 인데 메인화면 클릭 시, 앱 내부 뷰(체크리스트 관리 등)를 메인으로 되돌리기
      if (path === "/") {
        window.dispatchEvent(new CustomEvent("app:goToMainView"));
      }
      return;
    }
    window.history.pushState(null, "", path);
    setCurrentPath(path);
  }, []);

  // 로딩 중이거나 토큰이 있는데 사용자 정보가 아직 로드되지 않은 경우 로딩 화면 표시
  // 사파리 호환성: localStorage 체크를 try-catch로 감싸서 시크릿 모드 등에서도 작동하도록
  let hasToken = false;
  try {
    hasToken = !!localStorage.getItem("authToken");
  } catch (e) {
    // localStorage 접근 실패 (시크릿 모드 등)
    console.warn("[Router] Failed to check authToken", e);
  }
  
  if (loading || (hasToken && !user)) {
    return <AppLoadingScreen />;
  }

  if (currentPath === "/login") {
    if (user) {
      // 로그인 페이지에 있는데 이미 로그인되어 있으면 메인 화면으로
      // 모바일 최적화: 리다이렉트 횟수 제한 (무한 루프 방지)
      if (redirectCountRef.current < 3) {
        redirectCountRef.current += 1;
        try {
          window.history.replaceState(null, "", "/");
          setCurrentPath("/");
          // 성공 후 카운터 리셋
          setTimeout(() => { redirectCountRef.current = 0; }, 1000);
        } catch (e) {
          console.warn("[Router] Failed to navigate from login", e);
        }
      } else {
        console.error("[Router] Too many redirects, stopping to prevent loop");
        redirectCountRef.current = 0;
      }
      return (
        <Suspense fallback={<AppLoadingScreen />}>
          <App />
        </Suspense>
      );
    }
    redirectCountRef.current = 0; // 로그인 페이지에 있고 user가 없으면 리셋
    return <Login onLoginSuccess={() => {
      // 로그인 성공 후 경로 변경 (한 번만 실행되도록 보장)
      // 사용자 정보가 이미 로드된 상태이므로 안전하게 이동 가능
      if (user && redirectCountRef.current < 3) {
        redirectCountRef.current += 1;
        try {
          window.history.replaceState(null, "", "/");
          setCurrentPath("/");
          setTimeout(() => { redirectCountRef.current = 0; }, 1000);
        } catch (e) {
          console.warn("[Router] Failed to navigate after login", e);
          // fallback: 페이지 리로드
          window.location.replace("/");
        }
      }
    }} />;
  }

  if (!user) {
    // 로그인되지 않은 상태에서 보호된 페이지 접근 시 로그인 페이지로
    // 단, 이미 로그인 페이지에 있으면 무한 루프 방지
    const loginCallback = () => {
      if (user && redirectCountRef.current < 3) {
        redirectCountRef.current += 1;
        try {
          window.history.replaceState(null, "", "/");
          setCurrentPath("/");
          setTimeout(() => { redirectCountRef.current = 0; }, 1000);
        } catch (e) {
          console.warn("[Router] Failed to navigate after login", e);
          window.location.replace("/");
        }
      }
    };
    
    if (currentPath !== "/login") {
      // 모바일 최적화: 리다이렉트 횟수 제한
      if (redirectCountRef.current < 3) {
        redirectCountRef.current += 1;
        try {
          window.history.replaceState(null, "", "/login");
          setCurrentPath("/login");
          setTimeout(() => { redirectCountRef.current = 0; }, 1000);
        } catch (e) {
          console.warn("[Router] Failed to navigate to login", e);
          window.location.replace("/login");
        }
        return <Login onLoginSuccess={loginCallback} />;
      } else {
        console.error("[Router] Too many redirects to login, stopping");
        redirectCountRef.current = 0;
      }
    }
    redirectCountRef.current = 0;
    return <Login onLoginSuccess={loginCallback} />;
  }

  let page: React.ReactNode;
  if (currentPath === "/admin") {
    page = <Suspense fallback={<AppLoadingScreen />}><Admin /></Suspense>;
  } else if (currentPath === "/admin/monitoring") {
    page = <Suspense fallback={<AppLoadingScreen />}><MonitoringControl /></Suspense>;
  } else if (currentPath === "/clan") {
    page = <Suspense fallback={<AppLoadingScreen />}><ClanManagement /></Suspense>;
  } else if (currentPath === "/card-exchange") {
    page = <Suspense fallback={<AppLoadingScreen />}><CardExchangeManagement /></Suspense>;
  } else if (currentPath === "/board-issue-stats") {
    page = <Suspense fallback={<AppLoadingScreen />}><BoardIssueStatsPage /></Suspense>;
  } else if (currentPath === "/board-list-snapshots") {
    page = <Suspense fallback={<AppLoadingScreen />}><BoardListSnapshotPage /></Suspense>;
  } else if (currentPath === "/partner-archiving") {
    page = <Suspense fallback={<AppLoadingScreen />}><PartnerVideoArchiving /></Suspense>;
  } else if (currentPath === "/daily-report") {
    page = <Suspense fallback={<AppLoadingScreen />}><DailyReportDownloader /></Suspense>;
  } else if (currentPath === "/weekly-report") {
    page = <Suspense fallback={<AppLoadingScreen />}><WeeklyReportGenerator /></Suspense>;
  } else if (currentPath === "/calendar") {
    page = <Suspense fallback={<AppLoadingScreen />}><Calendar /></Suspense>;
  } else {
    page = (
      <Suspense fallback={<AppLoadingScreen />}>
        <App />
      </Suspense>
    );
  }

  return (
    <AppLayout currentPath={currentPath} navigate={navigate} userRole={user?.role}>
      {page}
    </AppLayout>
  );
}

// StrictMode는 개발 중 이펙트·요청을 두 번 실행해 체감 로딩이 느려질 수 있어 비활성화합니다.
// HMR 등으로 본 모듈이 다시 평가될 때 createRoot 중복 호출을 막아 DOM 오류를 줄입니다.
const rootEl = document.getElementById("root");
if (rootEl) {
  type RootHolder = { __aimReactRoot?: ReturnType<typeof ReactDOM.createRoot> };
  const holder = rootEl as RootHolder;
  const root = holder.__aimReactRoot ?? ReactDOM.createRoot(rootEl);
  holder.__aimReactRoot = root;
  root.render(
    <AuthProvider>
      <IssueProvider>
        <Router />
      </IssueProvider>
    </AuthProvider>
  );
}

