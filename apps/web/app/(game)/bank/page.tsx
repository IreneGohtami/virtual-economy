'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Button, Card, Loader, Panel, Modal } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';

interface Loan {
  id: string;
  principal: number;
  outstandingBalance: number;
  interestRate: number;
  installments: number;
  installmentsPaid: number;
  nextPaymentAt: string;
  status: string;
  createdAt: string;
}

interface BorrowingCapacity {
  maxBorrowable: number;
  currentOutstanding: number;
  netWorth: number;
  availableCapacity: number;
}

export default function BankPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [capacity, setCapacity] = useState<BorrowingCapacity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLoanForm, setShowLoanForm] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [loansData, capacityData] = await Promise.all([
        api.get<{ loans: Loan[] }>('/bank/loans'),
        api.get<BorrowingCapacity>('/bank/capacity'),
      ]);
      setLoans(loansData.loans ?? []);
      setCapacity(capacityData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bank data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleRepay(loanId: string) {
    try {
      await api.post(`/bank/loans/${loanId}/repay`);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to repay loan');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader />
      </div>
    );
  }

  const activeLoans = loans.filter((l) => l.status === 'ACTIVE');
  const pastLoans = loans.filter((l) => l.status !== 'ACTIVE');

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Bank</h1>
        {!showLoanForm && capacity && capacity.availableCapacity >= 100 && (
          <Button variant="primary" size="sm" onClick={() => setShowLoanForm(true)}>
            Request Loan
          </Button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Borrowing Capacity */}
      {capacity && (
        <Card title="Borrowing Capacity">
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Net Worth</span>
              <span className="font-medium">{capacity.netWorth.toFixed(0)} coins</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Max Borrowable (50% NW)</span>
              <span className="font-medium">{capacity.maxBorrowable.toFixed(0)} coins</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Current Outstanding</span>
              <span className="font-medium text-red-600">{capacity.currentOutstanding.toFixed(0)} coins</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Available to Borrow</span>
              <span className="font-medium text-green-700">{capacity.availableCapacity.toFixed(0)} coins</span>
            </div>
            {/* Capacity bar */}
            <div className="mt-2">
              <div className="h-3 w-full bg-gray-200 rounded-full overflow-hidden" role="progressbar" aria-valuenow={capacity.currentOutstanding} aria-valuemax={capacity.maxBorrowable} aria-label="Borrowing capacity used">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all"
                  style={{
                    width: `${capacity.maxBorrowable > 0 ? Math.min(100, (capacity.currentOutstanding / capacity.maxBorrowable) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {capacity.maxBorrowable > 0
                  ? `${((capacity.currentOutstanding / capacity.maxBorrowable) * 100).toFixed(0)}% used`
                  : '0% used'}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Loan Request Form */}
      {showLoanForm && capacity && (
        <LoanRequestForm
          maxAmount={capacity.availableCapacity}
          onSuccess={() => {
            setShowLoanForm(false);
            setLoading(true);
            fetchData();
          }}
          onCancel={() => setShowLoanForm(false)}
        />
      )}

      {/* Active Loans */}
      <Panel title={`Active Loans (${activeLoans.length})`}>
        {activeLoans.length === 0 ? (
          <p className="text-gray-500 text-sm">No active loans.</p>
        ) : (
          <div className="space-y-3">
            {activeLoans.map((loan) => (
              <div
                key={loan.id}
                className="p-3 rounded-lg border border-gray-100 bg-gray-50 space-y-2"
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-900">{loan.principal.toFixed(0)} coins</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                    {loan.interestRate * 100}% per period
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm text-gray-500">
                  <span>Outstanding: {loan.outstandingBalance.toFixed(0)}</span>
                  <span>Installments: {loan.installmentsPaid}/{loan.installments}</span>
                  <span>Next payment: {new Date(loan.nextPaymentAt).toLocaleDateString()}</span>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleRepay(loan.id)}
                >
                  Early Repay
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Past Loans */}
      {pastLoans.length > 0 && (
        <Panel title="Past Loans" collapsible defaultOpen={false}>
          <div className="space-y-2">
            {pastLoans.map((loan) => (
              <div key={loan.id} className="flex justify-between items-center text-sm p-2 border-b border-gray-100">
                <span>{loan.principal.toFixed(0)} coins</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  loan.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {loan.status}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function LoanRequestForm({
  maxAmount,
  onSuccess,
  onCancel,
}: {
  maxAmount: number;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (amount < 100 || amount > maxAmount) return;
    setLoading(true);
    setError(null);
    try {
      await api.post('/bank/loans', { amount });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request loan');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="Request Loan">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="p-2 rounded bg-red-50 text-red-700 text-sm">{error}</div>}
        <div>
          <label htmlFor="loan-amount" className="block text-sm font-medium text-gray-700 mb-1">
            Amount (min 100, max {maxAmount.toFixed(0)})
          </label>
          <input
            id="loan-amount"
            type="number"
            min={100}
            max={maxAmount}
            step={10}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            required
          />
        </div>
        <div className="text-sm text-gray-500 space-y-1">
          <p>Interest: 5% per 5-day period on outstanding balance</p>
          <p>Installments auto-deducted every 5 days</p>
          <p>Early repayment available without penalty</p>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="sm" loading={loading} disabled={amount < 100 || amount > maxAmount}>
            Request Loan
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
