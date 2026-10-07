'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, Loader } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';

interface Transaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  referenceType: string | null;
  createdAt: string;
}

const TYPE_DISPLAY: Record<string, { label: string; icon: string }> = {
  LAND_PURCHASE: { label: 'Land Purchase', icon: '🗺️' },
  LAND_RESALE: { label: 'Land Resale', icon: '💰' },
  FACTORY_PURCHASE: { label: 'Factory Built', icon: '🏭' },
  FACTORY_DECONSTRUCTION: { label: 'Factory Deconstructed', icon: '🏚️' },
  FACTORY_MAINTENANCE: { label: 'Maintenance', icon: '🔧' },
  WORKER_WAGE: { label: 'Worker Wage', icon: '👷' },
  WORKER_FIRING_SETTLEMENT: { label: 'Worker Settlement', icon: '📋' },
  MARKETPLACE_SALE: { label: 'Marketplace Sale', icon: '📊' },
  INSTANT_SELL: { label: 'Instant Sell', icon: '⚡' },
  LOAN_DISBURSEMENT: { label: 'Loan Received', icon: '🏦' },
  LOAN_REPAYMENT: { label: 'Loan Payment', icon: '💳' },
  PRODUCTION_COST: { label: 'Production Cost', icon: '⚙️' },
  SHOP_REVENUE: { label: 'Shop Revenue', icon: '🏪' },
  SHOP_DECONSTRUCTION: { label: 'Shop Deconstructed', icon: '🏚️' },
};

function getTypeDisplay(type: string): { label: string; icon: string } {
  return TYPE_DISPLAY[type] || { label: type.replace(/_/g, ' '), icon: '💱' };
}

export default function ActivityPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async () => {
    try {
      const data = await api.get<{ transactions: Transaction[] }>('/players/me/transactions?limit=100');
      setTransactions(data.transactions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Activity Log</h1>
      <p className="text-sm text-gray-500">Your transaction history for this season.</p>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {transactions.length === 0 ? (
        <Card>
          <p className="text-center text-gray-500 py-8">No transactions yet this season.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {transactions.map((tx) => {
            const display = getTypeDisplay(tx.type);
            const isPositive = tx.amount > 0;
            return (
              <div
                key={tx.id}
                className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-100 shadow-sm"
              >
                <span className="text-xl shrink-0" aria-hidden="true">{display.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{display.label}</p>
                  {tx.description && (
                    <p className="text-xs text-gray-500 truncate">{tx.description}</p>
                  )}
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {new Date(tx.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                    {isPositive ? '+' : ''}{tx.amount.toLocaleString()} coins
                  </p>
                  <p className="text-[10px] text-gray-400">
                    Bal: {tx.balanceAfter.toLocaleString()}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
