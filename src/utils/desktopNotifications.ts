/**
 * 데스크톱 알림 유틸리티
 * 브라우저 Notification API를 사용한 데스크톱 알림 기능
 */

export interface NotificationOptions {
  title: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  requireInteraction?: boolean;
  silent?: boolean;
  data?: any;
  onClick?: () => void;
}

export type NotificationPermission = 'default' | 'granted' | 'denied';

/**
 * 알림 권한 상태 확인
 */
export function getNotificationPermission(): NotificationPermission {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission as NotificationPermission;
}

/**
 * 알림 권한 요청
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    console.warn('This browser does not support desktop notifications');
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  if (Notification.permission === 'denied') {
    return 'denied';
  }

  try {
    const permission = await Notification.requestPermission();
    return permission as NotificationPermission;
  } catch (error) {
    console.error('Error requesting notification permission:', error);
    return 'denied';
  }
}

/**
 * 데스크톱 알림 표시
 */
export function showDesktopNotification(options: NotificationOptions): Notification | null {
  if (!('Notification' in window)) {
    console.warn('[Notifications] This browser does not support desktop notifications');
    return null;
  }

  if (Notification.permission !== 'granted') {
    console.warn('[Notifications] Notification permission not granted', { permission: Notification.permission });
    return null;
  }

  try {
    // soundEnabled 설정 확인하여 silent 옵션 결정
    const settings = loadNotificationSettings();
    const shouldBeSilent = options.silent !== undefined ? options.silent : !settings.soundEnabled;

    // Notification 생성자에 전달할 옵션 (브라우저 표준 속성만)
    const notificationOptions: {
      body?: string;
      icon?: string;
      badge?: string;
      tag?: string;
      requireInteraction?: boolean;
      silent?: boolean;
      data?: any;
    } = {
      body: options.body,
      icon: options.icon || '/favicon.png',
      badge: options.badge || '/vite.svg',
      tag: options.tag,
      requireInteraction: options.requireInteraction || false,
      silent: shouldBeSilent,
      data: options.data,
    };

    const notification = new Notification(options.title, notificationOptions);

    // 알림 클릭 시 처리
    if (options.onClick) {
      notification.onclick = (event) => {
        event.preventDefault();
        window.focus();
        options.onClick?.();
        notification.close();
      };
    }

    // 알림 자동 닫기 (5초 후)
    setTimeout(() => {
      notification.close();
    }, 5000);

    return notification;
  } catch (error) {
    console.error('Error showing desktop notification:', error);
    return null;
  }
}

/**
 * 알림 설정 관리
 */
export interface NotificationSettings {
  enabled: boolean;
  soundEnabled: boolean;
  showOnNewIssue: boolean;
  showOnSlaViolation: boolean;
  showOnIssueUpdate: boolean;
}

const SETTINGS_KEY = 'desktopNotificationSettings';

const defaultSettings: NotificationSettings = {
  enabled: true,
  soundEnabled: true,
  showOnNewIssue: true,
  showOnSlaViolation: true,
  showOnIssueUpdate: false,
};

/**
 * 알림 설정 로드
 */
export function loadNotificationSettings(): NotificationSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error('Error loading notification settings:', error);
  }
  return { ...defaultSettings };
}

/**
 * 알림 설정 저장
 */
export function saveNotificationSettings(settings: NotificationSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Error saving notification settings:', error);
  }
}

/**
 * 알림 소리 재생
 */
export function playNotificationSound(): void {
  try {
    // 간단한 beep 소리 생성
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800; // 800Hz
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch (error) {
    console.error('Error playing notification sound:', error);
  }
}

/**
 * 새 이슈 알림
 */
export function notifyNewIssue(issue: { id: string; title: string; severity?: string; source?: string }): void {
  const settings = loadNotificationSettings();

  if (!settings.enabled || !settings.showOnNewIssue) {
    return;
  }

  const severityLabel = issue.severity === 'SEV1' ? '🔴 긴급' : 
                       issue.severity === 'SEV2' ? '🟠 중요' : 
                       issue.severity === 'SEV3' ? '🟡 보통' : 'ℹ️ 정보';

  showDesktopNotification({
    title: `새 이슈: ${severityLabel}`,
    body: issue.title || '제목 없음',
    tag: `issue-${issue.id}`,
    requireInteraction: issue.severity === 'SEV1',
    data: { type: 'issue', id: issue.id },
    silent: !settings.soundEnabled, // soundEnabled가 false면 silent: true
    onClick: () => {
      // 이슈 상세 페이지로 이동하거나 이슈 선택
      window.dispatchEvent(new CustomEvent('selectIssue', { detail: { issueId: issue.id } }));
    },
  });

  if (settings.soundEnabled) {
    playNotificationSound();
  }
}

/**
 * SLA 위반 알림
 */
export function notifySlaViolation(issue: { id: string; title: string; slaStatus?: string }): void {
  const settings = loadNotificationSettings();
  
  if (!settings.enabled || !settings.showOnSlaViolation) {
    return;
 }

 showDesktopNotification({
    title: '⚠️ SLA 위반',
    body: issue.title || '제목 없음',
    tag: `sla-${issue.id}`,
    requireInteraction: true,
    data: { type: 'sla', id: issue.id },
    silent: !settings.soundEnabled, // soundEnabled가 false면 silent: true
    onClick: () => {
      window.dispatchEvent(new CustomEvent('selectIssue', { detail: { issueId: issue.id } }));
    },
  });

  if (settings.soundEnabled) {
    playNotificationSound();
  }
}

/**
 * 이슈 업데이트 알림
 */
export function notifyIssueUpdate(issue: { id: string; title: string; status?: string }): void {
  const settings = loadNotificationSettings();
  
  if (!settings.enabled || !settings.showOnIssueUpdate) {
    return;
  }

  showDesktopNotification({
    title: `이슈 업데이트: ${issue.status || '상태 변경'}`,
    body: issue.title || '제목 없음',
    tag: `update-${issue.id}`,
    requireInteraction: false,
    data: { type: 'update', id: issue.id },
    silent: !settings.soundEnabled, // soundEnabled가 false면 silent: true
    onClick: () => {
      window.dispatchEvent(new CustomEvent('selectIssue', { detail: { issueId: issue.id } }));
    },
  });

  if (settings.soundEnabled) {
    playNotificationSound();
  }
}
