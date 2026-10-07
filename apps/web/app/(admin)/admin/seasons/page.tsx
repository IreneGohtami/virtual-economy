'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Button, Card, Loader, Modal, Panel } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';

interface Season {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  configuration?: Record<string, unknown>;
  createdAt?: string;
}

function daysBetween(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function daysRemaining(endsAt: string): number {
  const ms = new Date(endsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toInputDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export default function SeasonsPage() {
  const [currentSeason, setCurrentSeason] = useState<Season | null>(null);
  const [history, setHistory] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Form state
  const [endDate, setEndDate] = useState(toInputDate(addDays(new Date(), 30)));
  const [editingEndDate, setEditingEndDate] = useState(false);
  const [newEndDate, setNewEndDate] = useState('');
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showDateConfirm, setShowDateConfirm] = useState(false);
  const [durationDays, setDurationDays] = useState('30');
  const [mapWidth, setMapWidth] = useState('');
  const [mapHeight, setMapHeight] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [current, hist] = await Promise.all([
        api.get<Season | null>('/season/current').catch(() => null),
        api
          .get<{ seasons: Season[] }>('/season/history')
          .then((d) => d.seasons || [])
          .catch(() => []),
      ]);
      setCurrentSeason(current);
      setHistory(hist || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load season data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Bidirectional sync: end date <-> duration
  const handleEndDateChange = (value: string) => {
    setEndDate(value);
    const diff = daysBetween(toInputDate(new Date()), value);
    setDurationDays(String(Math.max(1, diff)));
  };

  const handleDurationChange = (value: string) => {
    setDurationDays(value);
    const days = parseInt(value, 10);
    if (!isNaN(days) && days > 0) {
      setEndDate(toInputDate(addDays(new Date(), days)));
    }
  };

  const handleStartSeason = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setError(null);
    try {
      const body: Record<string, number> = {};
      if (durationDays) body.durationDays = parseInt(durationDays, 10);
      if (mapWidth) body.mapWidth = parseInt(mapWidth, 10);
      if (mapHeight) body.mapHeight = parseInt(mapHeight, 10);
      await api.post('/admin/season/start', body);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start season');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateEndDate = async () => {
    if (!currentSeason || !newEndDate) return;
    setActionLoading(true);
    setError(null);
    try {
      await api.post(`/admin/season/${currentSeason.id}/update-end-date`, {
        endsAt: new Date(newEndDate).toISOString(),
      });
      setEditingEndDate(false);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update end date');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEndSeason = async () => {
    if (!currentSeason) return;
    setActionLoading(true);
    setError(null);
    try {
      await api.post('/admin/season/end', { seasonId: currentSeason.id });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end season');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Season Management</h1>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Current Season */}
      <Card title="Current Season">
        {currentSeason ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Status</span>
                <p className="font-medium text-green-700">{currentSeason.status}</p>
              </div>
              <div>
                <span className="text-gray-500">Started</span>
                <p className="font-medium text-gray-900">{formatDate(currentSeason.startsAt)}</p>
              </div>
              <div>
                <span className="text-gray-500">Ends</span>
                <p className="font-medium text-gray-900">
                  {currentSeason.endsAt ? formatDate(currentSeason.endsAt) : '—'}
                </p>
              </div>
              <div>
                <span className="text-gray-500">Duration</span>
                <p className="font-medium text-gray-900">
                  {currentSeason.endsAt
                    ? `${daysBetween(currentSeason.startsAt, currentSeason.endsAt)} days`
                    : '—'}
                </p>
              </div>
            </div>

            {/* Countdown */}
            {currentSeason.endsAt && currentSeason.status === 'ACTIVE' && (
              <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
                <svg
                  className="w-5 h-5 text-blue-600 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-blue-800 font-medium">
                  {daysRemaining(currentSeason.endsAt)} days remaining
                </span>
              </div>
            )}

            <div>
              <span className="text-gray-500 text-sm">Season ID</span>
              <p className="text-xs font-mono text-gray-600 break-all">{currentSeason.id}</p>
            </div>

            {/* Edit End Date */}
            {!editingEndDate ? (
              <Button variant="secondary" className="mr-2" onClick={() => {
                setEditingEndDate(true);
                setNewEndDate(currentSeason.endsAt ? toInputDate(new Date(currentSeason.endsAt)) : '');
              }}>
                Change End Date
              </Button>
            ) : (
              <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div>
                  <label htmlFor="newEndDate" className="block text-sm font-medium text-gray-700 mb-1">
                    New End Date
                  </label>
                  <input
                    id="newEndDate"
                    type="date"
                    value={newEndDate}
                    onChange={(e) => setNewEndDate(e.target.value)}
                    min={toInputDate(addDays(new Date(), 1))}
                    className="px-3 py-2 mr-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                  <Button variant="primary" size="sm" className="mr-2" onClick={handleUpdateEndDate} loading={actionLoading}>
                    Save
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setEditingEndDate(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <Button variant="danger" onClick={() => setShowEndConfirm(true)} loading={actionLoading}>
              End Season
            </Button>
          </div>
        ) : (
          <p className="text-gray-500">No active season.</p>
        )}
      </Card>

      {/* Start New Season */}
      {!currentSeason && (
        <Card title="Start New Season">
          <form onSubmit={handleStartSeason} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-1">
                  End Date
                </label>
                <input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => handleEndDateChange(e.target.value)}
                  min={toInputDate(addDays(new Date(), 1))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label htmlFor="durationDays" className="block text-sm font-medium text-gray-700 mb-1">
                  Duration (days)
                </label>
                <input
                  id="durationDays"
                  type="number"
                  value={durationDays}
                  onChange={(e) => handleDurationChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  min="1"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Season will end on {endDate ? formatDate(endDate) : '—'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="mapWidth" className="block text-sm font-medium text-gray-700 mb-1">
                  Map Width (optional)
                </label>
                <input
                  id="mapWidth"
                  type="number"
                  value={mapWidth}
                  onChange={(e) => setMapWidth(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  min="1"
                />
              </div>
              <div>
                <label htmlFor="mapHeight" className="block text-sm font-medium text-gray-700 mb-1">
                  Map Height (optional)
                </label>
                <input
                  id="mapHeight"
                  type="number"
                  value={mapHeight}
                  onChange={(e) => setMapHeight(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  min="1"
                />
              </div>
            </div>

            <Button type="submit" loading={actionLoading}>
              Start Season
            </Button>
          </form>
        </Card>
      )}

      {/* Confirmation: Change End Date */}
      <Modal open={showDateConfirm} onClose={() => setShowDateConfirm(false)} title="Confirm End Date Change">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Are you sure you want to change the season end date to <strong>{newEndDate ? formatDate(newEndDate) : '—'}</strong>?
          </p>
          <p className="text-xs text-gray-500">
            This will affect all players and the season countdown.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" size="sm" onClick={() => setShowDateConfirm(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => { setShowDateConfirm(false); handleUpdateEndDate(); }} loading={actionLoading}>
              Confirm Change
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirmation: End Season */}
      <Modal open={showEndConfirm} onClose={() => setShowEndConfirm(false)} title="Confirm End Season">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Are you sure you want to <strong>end the current season immediately</strong>?
          </p>
          <p className="text-xs text-red-600">
            This action cannot be undone. All production will stop, marketplace listings will be cancelled, and final standings will be calculated.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" size="sm" onClick={() => setShowEndConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={() => { setShowEndConfirm(false); handleEndSeason(); }} loading={actionLoading}>
              End Season Now
            </Button>
          </div>
        </div>
      </Modal>

      {/* Season History */}
      <Panel title="Season History">
        {history.length === 0 ? (
          <p className="text-gray-500 text-sm">No past seasons.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 font-medium text-gray-500">ID</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-500">Start</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-500">End</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-500">Duration</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((season) => (
                  <tr key={season.id} className="border-b border-gray-100">
                    <td className="py-2 px-2 text-xs text-gray-600 font-mono">
                      {season.id.slice(0, 8)}...
                    </td>
                    <td className="py-2 px-2 text-gray-900">{formatDate(season.startsAt)}</td>
                    <td className="py-2 px-2 text-gray-900">
                      {season.endsAt ? formatDate(season.endsAt) : '—'}
                    </td>
                    <td className="py-2 px-2 text-gray-900">
                      {season.endsAt ? `${daysBetween(season.startsAt, season.endsAt)}d` : '—'}
                    </td>
                    <td className="py-2 px-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          season.status === 'ACTIVE'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {season.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
