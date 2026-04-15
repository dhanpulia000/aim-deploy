import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  loadNotificationSettings,
  saveNotificationSettings,
  requestNotificationPermission,
  getNotificationPermission,
  type NotificationSettings,
  type NotificationPermission,
} from '../utils/desktopNotifications';

export default function NotificationSettings() {
  const { t } = useTranslation('pagesAgent');
  const [settings, setSettings] = useState<NotificationSettings>(loadNotificationSettings());
  const [permission, setPermission] = useState<NotificationPermission>(getNotificationPermission());
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    // 설정 변경 시 저장
    saveNotificationSettings(settings);
  }, [settings]);

  const handleRequestPermission = async () => {
    setRequesting(true);
    try {
      const newPermission = await requestNotificationPermission();
      setPermission(newPermission);
    } catch (error) {
      console.error('Error requesting permission:', error);
    } finally {
      setRequesting(false);
    }
  };

  const updateSetting = <K extends keyof NotificationSettings>(
    key: K,
    value: NotificationSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const isPermissionGranted = permission === 'granted';
  const isPermissionDenied = permission === 'denied';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border dark:border-slate-700 p-6">
      <h2 className="text-xl font-semibold mb-4 text-slate-800 dark:text-slate-100">
        {t('notificationSettings.title')}
      </h2>

      {/* 권한 상태 */}
      <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('notificationSettings.browserPermission')}
          </span>
          <span
            className={`text-sm font-medium ${
              isPermissionGranted
                ? 'text-green-600 dark:text-green-400'
                : isPermissionDenied
                ? 'text-red-600 dark:text-red-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {isPermissionGranted
              ? t('notificationSettings.granted')
              : isPermissionDenied
              ? t('notificationSettings.denied')
              : t('notificationSettings.default')}
          </span>
        </div>
        {!isPermissionGranted && (
          <div className="mt-3">
            {isPermissionDenied ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                {t('notificationSettings.deniedHint')}
              </p>
            ) : (
              <button
                onClick={handleRequestPermission}
                disabled={requesting}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {requesting ? t('notificationSettings.requesting') : t('notificationSettings.request')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 알림 설정 */}
      <div className="space-y-4">
        {/* 전체 알림 켜기/끄기 */}
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('notificationSettings.master')}
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t('notificationSettings.masterHint')}
            </p>
          </div>
          <div className="relative">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => updateSetting('enabled', e.target.checked)}
              disabled={!isPermissionGranted}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600"></div>
          </div>
        </label>

        {/* 소리 알림 */}
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('notificationSettings.sound')}
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t('notificationSettings.soundHint')}
            </p>
          </div>
          <div className="relative">
            <input
              type="checkbox"
              checked={settings.soundEnabled}
              onChange={(e) => updateSetting('soundEnabled', e.target.checked)}
              disabled={!settings.enabled || !isPermissionGranted}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600"></div>
          </div>
        </label>

        {/* 새 이슈 알림 */}
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('notificationSettings.newIssue')}
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t('notificationSettings.newIssueHint')}
            </p>
          </div>
          <div className="relative">
            <input
              type="checkbox"
              checked={settings.showOnNewIssue}
              onChange={(e) => updateSetting('showOnNewIssue', e.target.checked)}
              disabled={!settings.enabled || !isPermissionGranted}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600"></div>
          </div>
        </label>

        {/* SLA 위반 알림 */}
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('notificationSettings.sla')}
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t('notificationSettings.slaHint')}
            </p>
          </div>
          <div className="relative">
            <input
              type="checkbox"
              checked={settings.showOnSlaViolation}
              onChange={(e) => updateSetting('showOnSlaViolation', e.target.checked)}
              disabled={!settings.enabled || !isPermissionGranted}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600"></div>
          </div>
        </label>

        {/* 이슈 업데이트 알림 */}
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('notificationSettings.issueUpdate')}
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t('notificationSettings.issueUpdateHint')}
            </p>
          </div>
          <div className="relative">
            <input
              type="checkbox"
              checked={settings.showOnIssueUpdate}
              onChange={(e) => updateSetting('showOnIssueUpdate', e.target.checked)}
              disabled={!settings.enabled || !isPermissionGranted}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600"></div>
          </div>
        </label>
      </div>
    </div>
  );
}
