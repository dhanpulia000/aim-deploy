import { useEffect, useRef, useState, useCallback } from 'react';
import type { RealtimeEvent, RealtimeEventHandlers } from '../types/realtime';

interface UseRealtimeOptions {
  handlers?: RealtimeEventHandlers;
  autoReconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

interface UseRealtimeReturn {
  connected: boolean;
  error: Error | null;
  reconnect: () => void;
  disconnect: () => void;
  sendEvent?: (event: RealtimeEvent) => void;
}

/**
 * WebSocket 실시간 이벤트 훅
 * 
 * - 하나의 WebSocket 인스턴스만 유지
 * - 조용한 재연결 전략 (백오프 포함)
 * - 안전한 에러 처리
 * 
 * @param options - 옵션 객체
 * @returns 연결 상태 및 제어 함수
 */
export function useRealtime(_options: UseRealtimeOptions = {}): UseRealtimeReturn {
  const {
    handlers = {},
    autoReconnect = true,
    reconnectDelay = 5000,
    maxReconnectAttempts = 15 // 백엔드 재시작 등으로 끊겨도 재연결 시도 횟수 확대
  } = _options;

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(true);
  const isConnectingRef = useRef(false);
  
  // handlers를 ref로 저장하여 의존성 문제 해결
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  /**
   * 백오프 딜레이 계산 (min 5s, max 30s)
   */
  const getBackoffDelay = useCallback((attempt: number): number => {
    const baseDelay = reconnectDelay || 5000;
    const backoffDelay = Math.min(baseDelay * Math.pow(1.5, attempt), 30000);
    return Math.max(backoffDelay, 5000); // 최소 5초
  }, [reconnectDelay]);

  const connect = useCallback(() => {
    // 이미 연결 중이거나 열려있으면 중복 연결 방지
    if (isConnectingRef.current) {
      return;
    }

    // 기존 소켓이 있고 CLOSED 상태가 아니면 재사용
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      return;
    }

    try {
      isConnectingRef.current = true;

      // WebSocket URL 구성
      // 개발: Vite 포트와 백엔드 포트가 분리 — AIMGLOBAL 기본 백엔드 9080 (원본 8080과 병행 가능)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const port = window.location.port;
      const backendPort = import.meta.env.VITE_BACKEND_PORT || '9080';
      const devPorts = (import.meta.env.VITE_DEV_FRONTEND_PORTS || '5173,5174,5175')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const isDevelopment =
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
        devPorts.includes(port);
      const wsUrl =
        import.meta.env.VITE_WS_URL ||
        (isDevelopment ? `ws://127.0.0.1:${backendPort}` : `${protocol}//${window.location.host}`);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        isConnectingRef.current = false;
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);

          // Ensure it has at least a type and payload
          if (!raw || typeof raw !== 'object' || !raw.type) {
            return;
          }

          // 타입 가드: RealtimeEvent 형식인지 확인
          if (!raw || typeof raw !== 'object' || !('type' in raw)) {
            // 조용한 처리 (로그 제거)
            return;
          }

          // 레거시 호환: payload가 없으면 래핑
          let eventData: RealtimeEvent;
          const rawData = raw as Record<string, unknown>;
          
          if (!rawData.payload && ('agents' in rawData || 'tickets' in rawData)) {
            // 레거시 형식: { type: 'initial', agents, tickets } -> { type: 'initial_state', payload: { agents, tickets } }
            if (rawData.type === 'initial') {
              eventData = {
                type: 'initial_state',
                payload: {
                  agents: (rawData.agents as any[]) || [],
                  tickets: (rawData.tickets as any[]) || []
                }
              } as RealtimeEvent;
            } else if (rawData.type === 'update') {
              eventData = {
                type: 'state_update',
                payload: {
                  agents: (rawData.agents as any[]) || [],
                  tickets: (rawData.tickets as any[]) || [],
                  timestamp: (rawData.timestamp as number) || Date.now()
                }
              } as RealtimeEvent;
            } else {
              // 조용한 처리 (로그 제거)
              return;
            }
          } else {
            // 타입 검증: payload가 있는 경우
            if (!('payload' in rawData)) {
              // 조용한 처리 (로그 제거)
              return;
            }
            eventData = rawData as RealtimeEvent;
          }

          // 이벤트 타입별 핸들러 호출 (ref를 통해 최신 handlers 사용)
          // 타입 안전성: 각 케이스에서 payload 타입이 자동으로 추론됨
          const currentHandlers = handlersRef.current;
          switch (eventData.type) {
            case 'agent_status_update': {
              // payload 타입: Extract<RealtimeEvent, { type: 'agent_status_update' }>['payload']
              const payload = eventData.payload;
              currentHandlers.onAgentStatusUpdate?.(payload);
              break;
            }
            case 'issue_created': {
              // payload 타입: Extract<RealtimeEvent, { type: 'issue_created' }>['payload']
              const payload = eventData.payload;
              currentHandlers.onIssueCreated?.(payload);
              break;
            }
            case 'issue_updated': {
              const payload = eventData.payload;
              currentHandlers.onIssueUpdated?.(payload);
              break;
            }
            case 'issue_comments_updated': {
              const payload = eventData.payload;
              currentHandlers.onIssueCommentsUpdated?.(payload);
              break;
            }
            case 'sla_violation': {
              // payload 타입: Extract<RealtimeEvent, { type: 'sla_violation' }>['payload']
              const payload = eventData.payload;
              currentHandlers.onSlaViolation?.(payload);
              break;
            }
            case 'initial_state': {
              // payload 타입: Extract<RealtimeEvent, { type: 'initial_state' }>['payload']
              const payload = eventData.payload;
              currentHandlers.onInitialState?.(payload);
              // 레거시 호환
              currentHandlers.onInitial?.(payload);
              break;
            }
            case 'state_update': {
              // payload 타입: Extract<RealtimeEvent, { type: 'state_update' }>['payload']
              const payload = eventData.payload;
              currentHandlers.onStateUpdate?.(payload);
              // 레거시 호환
              currentHandlers.onUpdate?.(payload);
              break;
            }
            default: {
              // 타입 안전성: 모든 케이스를 처리했는지 확인
              // @ts-expect-error - exhaustive check, 변수는 사용되지 않지만 타입 안전성을 위해 필요
              const _: never = eventData;
              // 조용한 처리 (로그 제거)
            }
          }
        } catch (err) {
          // 메시지 파싱 에러는 조용히 처리 (로그 제거)
        }
      };

      ws.onerror = () => {
        // 조용한 에러 처리 (로그 제거 - onclose에서 처리)
        isConnectingRef.current = false;
        // onclose에서 재연결 처리하므로 여기서는 에러만 설정
        setError(new Error('WebSocket connection error'));
      };

      ws.onclose = (event) => {
        // 조용한 종료 처리 (로그 제거)
        setConnected(false);
        isConnectingRef.current = false;
        
        // 정상 종료가 아니면 재연결 시도
        const isAbnormalClose = event.code !== 1000 && event.code !== 1001; // 1000 = CLOSE_NORMAL, 1001 = CLOSE_GOING_AWAY
        
        if (shouldReconnectRef.current && autoReconnect && isAbnormalClose) {
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            reconnectAttemptsRef.current++;
            const delay = getBackoffDelay(reconnectAttemptsRef.current - 1);
            
            // 조용한 재연결 (로그 없음 - 백그라운드에서 조용히 재시도)
            reconnectTimeoutRef.current = setTimeout(() => {
              connect();
            }, delay);
          } else {
            // 최대 재시도 횟수 도달 시에만 로그 (한 번만)
            if (reconnectAttemptsRef.current === maxReconnectAttempts) {
              console.warn('[WebSocket] Max reconnect attempts reached. Stopping reconnection attempts.');
            }
            setError(new Error('Failed to reconnect after maximum attempts'));
          }
        }
        
        // 소켓 정리
        wsRef.current = null;
      };
    } catch (err) {
      // 연결 생성 실패도 조용히 처리 (로그 제거)
      isConnectingRef.current = false;
      setError(err instanceof Error ? err : new Error('Failed to create WebSocket connection'));
      
      // 재연결 시도
      if (shouldReconnectRef.current && autoReconnect) {
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = getBackoffDelay(reconnectAttemptsRef.current - 1);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      }
    }
  }, [autoReconnect, maxReconnectAttempts, getBackoffDelay]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    isConnectingRef.current = false;
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, 'Client disconnect');
      } catch (err) {
        // 무시
      }
      wsRef.current = null;
    }
    
    setConnected(false);
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    shouldReconnectRef.current = true;
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect, disconnect]);

  /**
   * 안전한 이벤트 전송
   */
  const sendEvent = useCallback((event: RealtimeEvent) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // 조용한 처리 (로그 제거)
      return;
    }
    
    try {
      ws.send(JSON.stringify(event));
    } catch (err) {
      // 조용한 처리 (로그 제거)
    }
  }, []);

  // IMPORTANT: 빈 의존성 배열로 마운트 시 한 번만 실행
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, []); // 빈 배열로 변경하여 무한 루프 방지

  return {
    connected,
    error,
    reconnect,
    disconnect,
    sendEvent
  };
}
