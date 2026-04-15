// Mock Data Service - 실제 API로 교체 가능한 데이터 서비스 레이어

import type { Agent, Ticket } from '../types';

export class DataService {
  static getAgents(): Promise<Agent[]> {
    // 실제로는: return fetch('/api/agents').then(res => res.json());
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve([
          { id: "a1", name: "Jin", status: "busy", handling: 2, todayResolved: 8, avgHandleSec: 320, channelFocus: ["PUBG PC"], isActive: true },
          { id: "a2", name: "Ara", status: "available", handling: 0, todayResolved: 5, avgHandleSec: 410, channelFocus: ["PUBG MOBILE", "PUBG NEW STATE"], isActive: true },
          { id: "a3", name: "Min", status: "away", handling: 0, todayResolved: 3, avgHandleSec: 520, channelFocus: ["PUBG MOBILE"], isActive: true },
          { id: "a4", name: "Hyeon", status: "busy", handling: 1, todayResolved: 10, avgHandleSec: 290, channelFocus: ["PUBG PC", "PUBG ESPORTS"], isActive: true },
        ]);
      }, 500);
    });
  }

  static getTickets(): Promise<Ticket[]> {
    // 실제로는: return fetch('/api/tickets').then(res => res.json());
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve([
          { id: "t101", title: "[버그] 결제 실패 보고 증가", source: "discord", createdAt: Date.now()-1000*60*7, slaDeadlineAt: Date.now()+1000*60*8, severity: 1, sentiment: "neg", status: "TRIAGED", tags: ["결제","버그"], link: "#" },
          { id: "t102", title: "렉 심함 - 주말 오후 서버", source: "naver", createdAt: Date.now()-1000*60*20, slaDeadlineAt: Date.now()+1000*60*30, severity: 2, sentiment: "neg", status: "OPEN", tags: ["렉","서버"], link: "#" },
          { id: "t103", title: "신규 유저 가이드 좋네요", source: "discord", createdAt: Date.now()-1000*60*2, severity: 3, sentiment: "pos", status: "OPEN", link: "#" },
          { id: "t104", title: "카페 이벤트 당첨자 공지 문의", source: "naver", createdAt: Date.now()-1000*60*90, severity: 3, sentiment: "neu", status: "IN_PROGRESS", assigneeId: "a2", link: "#" },
        ]);
      }, 500);
    });
  }

  // WebSocket 연결 예시
  static connectWebSocket(url: string, onMessage: (data: any) => void): WebSocket | null {
    try {
      const ws = new WebSocket(url);
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        onMessage(data);
      };
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      ws.onclose = () => {
        console.log('WebSocket connection closed');
      };
      return ws;
    } catch (error) {
      console.error('Failed to connect to WebSocket:', error);
      return null;
    }
  }
}

