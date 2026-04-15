import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type UserRole = "ADMIN" | "LEAD" | "AGENT" | "VIEWER" | string;

export type AuthUser = {
  id: number;
  email: string;
  name?: string | null;
  role?: UserRole | null;
};

export type ChannelSummary = {
  id: number;
  name?: string | null;
  type: string;
  externalId: string;
  isActive: boolean;
};

export type ProjectSummary = {
  id: number;
  name: string;
  description?: string | null;
  channels?: ChannelSummary[];
};

/** 비밀번호 검증 후 이메일 OTP가 필요할 때 login() 반환 */
export type LoginOtpRequired = {
  requiresOtp: true;
  loginChallengeId: string;
  expiresInSeconds: number;
  emailMasked: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  projects: ProjectSummary[];
  selectedProjectId: number | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void | LoginOtpRequired>;
  completeLoginWithOtp: (loginChallengeId: string, code: string) => Promise<void>;
  resendLoginOtp: (loginChallengeId: string) => Promise<{ expiresInSeconds: number }>;
  logout: () => void;
  selectProject: (projectId: number | null) => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function getStoredNumber(key: string): number | null {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const parsed = Number(stored);
    return Number.isNaN(parsed) ? null : parsed;
  } catch (e) {
    console.warn(`[Auth] Failed to read ${key} from localStorage`, e);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // 모바일 브라우저에서 localStorage 접근 실패 시 null 반환
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem("authToken");
    } catch (e) {
      console.warn("[Auth] Failed to read token from localStorage (may be in private mode)", e);
      return null;
    }
  });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  // 초기값을 null로 설정하여 "전체 프로젝트"가 기본값이 되도록 함
  // localStorage의 값은 프로젝트 목록 로드 후 검증됨
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchCurrentUser() {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const res = await fetch("/api/auth/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          throw new Error("Failed to load user");
        }

        const body = await res.json();
        if (cancelled) return;
        // sendSuccess 응답 형식: { success: true, data: { user: { ... } } }
        // 또는 레거시 형식: { user: { ... } }
        const me = body.data?.user || body.data || body.user || null;
        setUser(me);
      } catch (error) {
        console.error("[Auth] Failed to verify token", error);
        if (cancelled) return;
        setUser(null);
        try {
          localStorage.removeItem("authToken");
        } catch (e) {
          console.warn("[Auth] Failed to remove token from localStorage", e);
        }
        setToken(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchCurrentUser();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const fetchProjects = async () => {
    if (!token || !user) {
      setProjects([]);
      return;
    }

    try {
      const res = await fetch("/api/projects", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error("Failed to load projects");
      }

      const body = await res.json();

      const list: ProjectSummary[] = body.data || body.projects || [];
      setProjects(list);
      setSelectedProjectId((prev) => {
        // localStorage에서 저장된 프로젝트 ID 가져오기
        const storedProjectId = getStoredNumber("selectedProjectId");
        
        // 1. 이미 설정된 값이 있고 유효하면 유지
        if (prev && list.some((project) => project.id === prev)) {
          return prev;
        }
        
        // 2. localStorage에 저장된 값이 있고 유효하면 사용
        if (storedProjectId && list.some((project) => project.id === storedProjectId)) {
          return storedProjectId;
        }
        
        // 3. 유효하지 않으면 "전체 프로젝트" (null)로 설정
        try {
          localStorage.removeItem("selectedProjectId");
        } catch (e) {
          console.warn("[Auth] Failed to remove selectedProjectId from localStorage", e);
        }
        return null;
      });
    } catch (error) {
      console.error("[Auth] Failed to load projects", error);
      setProjects([]);
    }
  };

  useEffect(() => {
    async function loadProjects() {
      await fetchProjects();
    }

    loadProjects();
  }, [token, user]);

  const applyAuthToken = useCallback((newToken: string, newUser: AuthUser | null) => {
    try {
      localStorage.setItem("authToken", newToken);
    } catch (e) {
      console.error("[Auth] Failed to save token to localStorage", e);
      console.warn("[Auth] Token saved in memory only. Page refresh will require re-login.");
    }
    setToken(newToken);
    if (newUser) {
      setUser(newUser);
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<void | LoginOtpRequired> => {
      try {
        localStorage.removeItem("authToken");
      } catch (e) {
        console.warn("[Auth] Failed to clear localStorage (may be in private mode)", e);
      }
      setToken(null);
      setUser(null);

      let res: Response;
      try {
        res = await fetch("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });
      } catch (error) {
        console.error("Login fetch error:", error);
        const errorMessage =
          error instanceof TypeError && error.message.includes("Failed to fetch")
            ? "서버에 연결할 수 없습니다. 네트워크 연결을 확인해주세요."
            : "서버에 연결할 수 없습니다. 네트워크를 확인해주세요.";
        throw new Error(errorMessage);
      }

      const text = await res.text();
      if (!text || text.trim() === "") {
        console.error("Empty response from login API", { status: res.status, url: res.url });
        const isServerError = res.status >= 500;
        throw new Error(
          isServerError
            ? "서버에서 응답을 받지 못했습니다. AIMGLOBAL 백엔드(기본 포트 9080)가 실행 중인지 확인하고, 서버 로그를 확인해주세요."
            : "서버에서 빈 응답을 받았습니다. 잠시 후 다시 시도해주세요."
        );
      }

      let body: any;
      try {
        body = JSON.parse(text);
      } catch (error) {
        console.error("Failed to parse login response:", error, "Response text:", text);
        throw new Error("서버 응답을 파싱할 수 없습니다. 잠시 후 다시 시도해주세요.");
      }

      if (!res.ok) {
        const message = body?.error || body?.message || "로그인에 실패했습니다.";
        throw new Error(message);
      }

      const payload = body.data || body;
      if (payload.loginChallengeId && !payload.token) {
        return {
          requiresOtp: true,
          loginChallengeId: payload.loginChallengeId,
          expiresInSeconds: payload.expiresInSeconds ?? 600,
          emailMasked: payload.emailMasked ?? "",
        };
      }

      const newToken: string | undefined = payload.token;
      const newUser: AuthUser | null = payload.user || null;

      if (!newToken) {
        throw new Error("토큰을 받을 수 없습니다. 관리자에게 문의하세요.");
      }

      applyAuthToken(newToken, newUser);
    },
    [applyAuthToken]
  );

  const completeLoginWithOtp = useCallback(
    async (loginChallengeId: string, code: string) => {
      let res: Response;
      try {
        res = await fetch("/api/auth/login/otp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ loginChallengeId, code }),
        });
      } catch (error) {
        console.error("Login OTP fetch error:", error);
        const errorMessage =
          error instanceof TypeError && error.message.includes("Failed to fetch")
            ? "서버에 연결할 수 없습니다. 네트워크 연결을 확인해주세요."
            : "서버에 연결할 수 없습니다. 네트워크를 확인해주세요.";
        throw new Error(errorMessage);
      }

      const text = await res.text();
      if (!text || text.trim() === "") {
        throw new Error("서버에서 응답을 받지 못했습니다.");
      }

      let body: any;
      try {
        body = JSON.parse(text);
      } catch (error) {
        console.error("Failed to parse login OTP response:", error);
        throw new Error("서버 응답을 파싱할 수 없습니다.");
      }

      if (!res.ok) {
        const message = body?.error || body?.message || "인증 코드가 올바르지 않습니다.";
        throw new Error(message);
      }

      const payload = body.data || body;
      const newToken: string | undefined = payload.token;
      const newUser: AuthUser | null = payload.user || null;

      if (!newToken) {
        throw new Error("토큰을 받을 수 없습니다. 관리자에게 문의하세요.");
      }

      applyAuthToken(newToken, newUser);
    },
    [applyAuthToken]
  );

  const resendLoginOtp = useCallback(async (loginChallengeId: string) => {
    let res: Response;
    try {
      res = await fetch("/api/auth/login/otp/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ loginChallengeId }),
      });
    } catch (error) {
      console.error("Resend OTP fetch error:", error);
      throw new Error("네트워크 오류로 코드를 다시 보낼 수 없습니다.");
    }

    const text = await res.text();
    if (!text || text.trim() === "") {
      throw new Error("서버에서 응답을 받지 못했습니다.");
    }

    let body: any;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new Error("서버 응답을 파싱할 수 없습니다.");
    }

    if (!res.ok) {
      const message = body?.message || "재전송에 실패했습니다.";
      const err = new Error(message) as Error & { status?: number; retryAfterSeconds?: number };
      err.status = res.status;
      const detail = body?.error;
      if (detail && typeof detail === "object" && "retryAfterSeconds" in detail) {
        err.retryAfterSeconds = Number((detail as { retryAfterSeconds?: number }).retryAfterSeconds);
      }
      throw err;
    }

    const payload = body.data || body;
    return {
      expiresInSeconds: payload.expiresInSeconds ?? 600,
    };
  }, []);

  const logout = () => {
    try {
      localStorage.removeItem("authToken");
      localStorage.removeItem("selectedProjectId");
    } catch (e) {
      console.warn("[Auth] Failed to clear localStorage on logout", e);
    }
    setToken(null);
    setUser(null);
    setProjects([]);
    setSelectedProjectId(null);
  };

  const selectProject = (projectId: number | null) => {
    setSelectedProjectId(projectId);
    try {
      if (projectId) {
        localStorage.setItem("selectedProjectId", projectId.toString());
      } else {
        localStorage.removeItem("selectedProjectId");
      }
    } catch (e) {
      console.warn("[Auth] Failed to save selectedProjectId to localStorage", e);
    }
  };

  const refreshUser = async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      // Handle 401 (Unauthorized) - token is invalid/expired, treat as not logged in
      if (res.status === 401) {
        // Not authenticated: clear user and token, but this is not a fatal error
        setUser(null);
        setToken(null);
        try {
          localStorage.removeItem("authToken");
        } catch (e) {
          console.warn("[Auth] Failed to remove token from localStorage", e);
        }
        return;
      }

      // Handle other errors (500, etc.)
      if (!res.ok) {
        console.error("[Auth] Failed to load user", res.status, res.statusText);
        return;
      }

      // Success: parse and set user
      const body = await res.json();
      // sendSuccess 응답 형식: { success: true, data: { user: { ... } } }
      // 또는 레거시 형식: { user: { ... } }
      const me = body.data?.user || body.data || body.user || null;
      setUser(me);
      
      // 프로젝트 목록도 새로고침
      if (me) {
        await fetchProjects();
      }
    } catch (error) {
      // Network error or JSON parse error
      console.error("[Auth] Failed to refresh user", error);
    }
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      projects,
      selectedProjectId,
      loading,
      login,
      completeLoginWithOtp,
      resendLoginOtp,
      logout,
      selectProject,
      refreshUser,
    }),
    [user, token, projects, selectedProjectId, loading, login, completeLoginWithOtp, resendLoginOtp],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}


