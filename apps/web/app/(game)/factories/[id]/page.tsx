'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';
import { FactoryDetail, FactoryDetailData } from '../components/FactoryDetail';

export default function FactoryDetailPage() {
  const params = useParams<{ id: string }>();
  const [factory, setFactory] = useState<FactoryDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFactory = useCallback(async () => {
    if (!params.id) return;
    try {
      const data = await api.get<FactoryDetailData>(`/factories/${params.id}`);
      setFactory(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load factory');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchFactory();
  }, [fetchFactory]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader />
      </div>
    );
  }

  if (error || !factory) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error || 'Factory not found'}
        </div>
        <Link
          href="/factories"
          className="mt-4 inline-block text-sm text-blue-600 hover:text-blue-700"
        >
          &larr; Back to factories
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <Link
        href="/factories"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to factories
      </Link>

      <FactoryDetail factory={factory} onRefresh={fetchFactory} />
    </div>
  );
}
