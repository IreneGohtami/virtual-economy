'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Loader } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';
import { wsClient } from '@/lib/ws-client';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  priority: 'low' | 'normal' | 'high';
  createdAt: string;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Notification[]>([]);
  const toastTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await api.get<Notification[]>('/notifications');
      setNotifications(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Listen for real-time notifications
  useEffect(() => {
    const unsubscribe = wsClient.on('notification', (data) => {
      const notification = data as Notification;
      setNotifications((prev) => [notification, ...prev]);

      // Show toast for high-priority notifications
      if (notification.priority === 'high') {
        setToasts((prev) => [...prev, notification]);
        const timeout = setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== notification.id));
          toastTimeoutsRef.current.delete(notification.id);
        }, 5000);
        toastTimeoutsRef.current.set(notification.id, timeout);
      }
    });

    return () => {
      unsubscribe();
      // Clear all toast timeouts on unmount
      for (const timeout of toastTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
    };
  }, []);

  async function markAsRead(notificationId: string) {
    try {
      await api.post('/notifications/read', { ids: [notificationId] });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
    } catch {
      // Silently fail — not critical
    }
  }

  async function markAllAsRead() {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    try {
      await api.post('/notifications/read', { ids: unreadIds });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // Silently fail
    }
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timeout = toastTimeoutsRef.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      toastTimeoutsRef.current.delete(id);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader />
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 space-y-2" aria-live="polite">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="bg-white border border-gray-200 shadow-lg rounded-lg p-3 max-w-sm animate-slide-in"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{toast.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{toast.message}</p>
                </div>
                <button
                  onClick={() => dismissToast(toast.id)}
                  className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                  aria-label="Dismiss notification"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
              {unreadCount} unread
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" size="sm" onClick={markAllAsRead}>
            Mark all as read
          </Button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Notification list */}
      {notifications.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500">No notifications yet.</p>
          <p className="text-sm text-gray-400 mt-1">You&apos;ll see production updates, trades, and events here.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                notification.read
                  ? 'border-gray-100 bg-white'
                  : 'border-blue-100 bg-blue-50'
              }`}
              onClick={() => !notification.read && markAsRead(notification.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!notification.read) markAsRead(notification.id);
                }
              }}
              aria-label={`${notification.read ? '' : 'Unread: '}${notification.title}`}
            >
              {/* Type icon */}
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs ${
                getTypeStyles(notification.type)
              }`}>
                {getTypeIcon(notification.type)}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm truncate ${notification.read ? 'text-gray-700' : 'text-gray-900 font-medium'}`}>
                    {notification.title}
                  </p>
                  {notification.priority === 'high' && (
                    <span className="flex-shrink-0 w-2 h-2 rounded-full bg-red-500" aria-label="High priority" />
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notification.message}</p>
                <p className="text-xs text-gray-400 mt-1">{formatTime(notification.createdAt)}</p>
              </div>

              {/* Unread indicator */}
              {!notification.read && (
                <div className="flex-shrink-0 w-2 h-2 rounded-full bg-blue-500 mt-2" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getTypeStyles(type: string): string {
  switch (type) {
    case 'production.complete':
    case 'production.progress':
      return 'bg-green-100 text-green-700';
    case 'production.paused':
      return 'bg-yellow-100 text-yellow-700';
    case 'marketplace.trade':
    case 'marketplace.price_update':
      return 'bg-purple-100 text-purple-700';
    case 'event.started':
    case 'event.ended':
      return 'bg-orange-100 text-orange-700';
    case 'worker.status_change':
      return 'bg-indigo-100 text-indigo-700';
    case 'loan.payment_reminder':
      return 'bg-red-100 text-red-700';
    case 'shop.revenue':
      return 'bg-emerald-100 text-emerald-700';
    case 'happiness.warning':
      return 'bg-yellow-100 text-yellow-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function getTypeIcon(type: string): string {
  switch (type) {
    case 'production.complete':
    case 'production.progress':
      return '\u2699';
    case 'production.paused':
      return '\u23F8';
    case 'marketplace.trade':
    case 'marketplace.price_update':
      return '\u{1F4B1}';
    case 'event.started':
    case 'event.ended':
      return '\u26A1';
    case 'worker.status_change':
      return '\u{1F464}';
    case 'loan.payment_reminder':
      return '\u{1F4B3}';
    case 'shop.revenue':
      return '\u{1F3EA}';
    case 'happiness.warning':
      return '\u{1F60A}';
    case 'season.milestone':
      return '\u{1F3C6}';
    default:
      return '\u{1F514}';
  }
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
