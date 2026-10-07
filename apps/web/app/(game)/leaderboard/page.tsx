'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, Loader } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';
import { useAuth } from '@/app/providers';

interface LeaderboardEntry {
  rank: number;
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  netWorth: number;
  specialty: string | null;
}

export default function LeaderboardPage() {
  const { player } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const data = await api.get<{ leaderboard: LeaderboardEntry[] }>('/economy/leaderboard');
      setEntries(data.leaderboard ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      </div>
    );
  }

  const myEntry = entries.find((e) => e.playerId === player?.id);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Leaderboard</h1>

      {/* Current player position highlight */}
      {myEntry && (
        <Card className="border-blue-200 bg-blue-50">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
              #{myEntry.rank}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 truncate">{myEntry.displayName} (You)</p>
              {myEntry.specialty && (
                <p className="text-xs text-blue-600">{myEntry.specialty}</p>
              )}
            </div>
            <div className="text-right">
              <p className="font-bold text-gray-900">{myEntry.netWorth.toLocaleString()}</p>
              <p className="text-xs text-gray-500">coins</p>
            </div>
          </div>
        </Card>
      )}

      {/* Leaderboard list */}
      {entries.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500">No players on the leaderboard yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const isMe = entry.playerId === player?.id;
            const isTop3 = entry.rank <= 3;
            return (
              <div
                key={entry.playerId}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  isMe
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-gray-100 bg-white hover:bg-gray-50'
                }`}
              >
                {/* Rank */}
                <div
                  className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm ${
                    entry.rank === 1
                      ? 'bg-yellow-400 text-yellow-900'
                      : entry.rank === 2
                      ? 'bg-gray-300 text-gray-800'
                      : entry.rank === 3
                      ? 'bg-orange-300 text-orange-900'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {isTop3 ? getMedal(entry.rank) : entry.rank}
                </div>

                {/* Avatar and name */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600 flex-shrink-0">
                    {entry.avatarUrl ? (
                      <img
                        src={entry.avatarUrl}
                        alt={`${entry.displayName}'s avatar`}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      entry.displayName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-sm truncate ${isMe ? 'font-semibold' : 'font-medium'} text-gray-900`}>
                      {entry.displayName}{isMe ? ' (You)' : ''}
                    </p>
                    {entry.specialty && (
                      <p className="text-xs text-gray-400">{entry.specialty}</p>
                    )}
                  </div>
                </div>

                {/* Net worth */}
                <div className="text-right flex-shrink-0">
                  <p className="font-semibold text-gray-900 text-sm">{entry.netWorth.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">coins</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getMedal(rank: number): string {
  switch (rank) {
    case 1: return '\u{1F947}';
    case 2: return '\u{1F948}';
    case 3: return '\u{1F949}';
    default: return String(rank);
  }
}
