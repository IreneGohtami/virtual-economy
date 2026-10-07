'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Loader, Modal } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';
import { useToast } from '@/lib/toast-context';
import { useWallet } from '@/lib/wallet-context';

interface InventoryItem {
  commodityId: string;
  commoditySlug: string;
  commodityName: string;
  category: string;
  quantity: number;
  storageSize: number;
  marketPrice: number;
}

interface StorageInfo {
  currentUsage: number;
  capacity: number;
  nextTier: StorageTier | null;
}

interface StorageTier {
  capacity: number;
  cost: number;
}

const STORAGE_TIERS: StorageTier[] = [
  { capacity: 750, cost: 250 },
  { capacity: 1000, cost: 500 },
  { capacity: 1500, cost: 1000 },
  { capacity: 2000, cost: 2000 },
  { capacity: 3000, cost: 4000 },
  { capacity: 5000, cost: 8000 },
];

const CATEGORY_COLORS: Record<string, string> = {
  AGRICULTURE: 'bg-green-100 text-green-700',
  ENERGY: 'bg-yellow-100 text-yellow-700',
  METAL: 'bg-gray-100 text-gray-700',
  LIVESTOCK: 'bg-orange-100 text-orange-700',
  FISHERY: 'bg-blue-100 text-blue-700',
  FORESTRY: 'bg-emerald-100 text-emerald-700',
  ELECTRONICS: 'bg-purple-100 text-purple-700',
  AUTOMOTIVE: 'bg-red-100 text-red-700',
};

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [storage, setStorage] = useState<StorageInfo>({ currentUsage: 0, capacity: 500, nextTier: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [sellItem, setSellItem] = useState<InventoryItem | null>(null);

  const fetchInventory = useCallback(async () => {
    try {
      const data = await api.get<{ items: InventoryItem[]; storage: { used: number; capacity: number; available: number } }>('/inventory');
      setItems(data.items ?? []);
      setStorage({
        currentUsage: data.storage?.used ?? 0,
        capacity: data.storage?.capacity ?? 500,
        nextTier: null,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  async function handleUpgrade() {
    setUpgradeLoading(true);
    try {
      await api.post('/inventory/storage/upgrade');
      setShowUpgrade(false);
      setLoading(true);
      fetchInventory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upgrade storage');
    } finally {
      setUpgradeLoading(false);
    }
  }

  function getUsagePercent(): number {
    if (storage.capacity === 0) return 0;
    return Math.min(100, Math.round((storage.currentUsage / storage.capacity) * 100));
  }

  function getNextAvailableTier(): StorageTier | null {
    return STORAGE_TIERS.find((t) => t.capacity > storage.capacity) || null;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader />
      </div>
    );
  }

  const usagePercent = getUsagePercent();
  const nextTier = storage.nextTier || getNextAvailableTier();

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Storage Usage Bar */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-gray-700">Storage</h2>
          <span className="text-sm text-gray-500">
            {storage.currentUsage} / {storage.capacity} units
          </span>
        </div>
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              usagePercent > 90 ? 'bg-red-500' :
              usagePercent > 70 ? 'bg-yellow-500' : 'bg-blue-500'
            }`}
            style={{ width: `${usagePercent}%` }}
            role="progressbar"
            aria-valuenow={storage.currentUsage}
            aria-valuemin={0}
            aria-valuemax={storage.capacity}
            aria-label="Storage usage"
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-gray-500">{usagePercent}% used</span>
          {nextTier && (
            <Button variant="primary" size="sm" onClick={() => setShowUpgrade(true)}>
              Upgrade Storage
            </Button>
          )}
        </div>
      </Card>

      {/* Storage Upgrade Modal */}
      <Modal open={showUpgrade} onClose={() => setShowUpgrade(false)} title="Upgrade Storage">
        <div className="space-y-4">
          {nextTier ? (
            <>
              <p className="text-sm text-gray-600">
                Upgrade your storage from <span className="font-medium">{storage.capacity}</span> to{' '}
                <span className="font-medium">{nextTier.capacity}</span> units.
              </p>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Cost</span>
                  <span className="font-medium text-gray-900">{nextTier.cost} coins</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-gray-500">New Capacity</span>
                  <span className="font-medium text-gray-900">{nextTier.capacity} units</span>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowUpgrade(false)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={handleUpgrade} loading={upgradeLoading}>
                  Upgrade for {nextTier.cost} coins
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">You have reached the maximum storage tier.</p>
          )}
        </div>
      </Modal>

      {/* Inventory Grid */}
      {items.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500">
            Your inventory is empty. Start producing commodities to fill it up.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((item) => (
            <Card key={item.commodityId} padding="sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{item.commodityName}</p>
                  <span className={`inline-block mt-0.5 px-1.5 py-0.5 text-xs rounded-full ${CATEGORY_COLORS[item.category] || 'bg-gray-100 text-gray-600'}`}>
                    {item.category}
                  </span>
                </div>
                <span className="text-lg font-bold text-gray-900">{item.quantity}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                <span>Storage: {item.storageSize} per unit</span>
                <span>Market: {item.marketPrice} coins</span>
              </div>
              <div className="mt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSellItem(item)}
                  className="w-full"
                >
                  Sell
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Sell Modal */}
      <SellModal
        item={sellItem}
        onClose={() => setSellItem(null)}
        onComplete={() => { setSellItem(null); setLoading(true); fetchInventory(); }}
      />
    </div>
  );
}

/** Sell modal with instant-sell and marketplace options */
function SellModal({
  item,
  onClose,
  onComplete,
}: {
  item: InventoryItem | null;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { addToast } = useToast();
  const { refreshWallet } = useWallet();
  const [quantity, setQuantity] = useState(1);
  const [sellMode, setSellMode] = useState<'instant' | 'marketplace'>('instant');
  const [loading, setLoading] = useState(false);

  // Reset quantity when item changes
  useEffect(() => {
    if (item) setQuantity(Math.min(item.quantity, 1));
  }, [item]);

  if (!item) return null;

  const instantPrice = Math.floor(item.marketPrice * 0.9);
  const instantTotal = instantPrice * quantity;
  const marketTotal = item.marketPrice * quantity;

  async function handleSell() {
    if (!item || quantity <= 0) return;
    setLoading(true);

    try {
      if (sellMode === 'instant') {
        await api.post('/marketplace/instant-sell', {
          commodityId: item.commodityId,
          quantity,
        });
        addToast(`Sold ${quantity} ${item.commodityName} for ${instantTotal} coins (instant)`, 'success');
      } else {
        await api.post('/marketplace/list', {
          commodityId: item.commodityId,
          quantity,
        });
        addToast(`Listed ${quantity} ${item.commodityName} on marketplace`, 'success');
      }
      refreshWallet();
      onComplete();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Sell failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title={`Sell ${item.commodityName}`}>
      <div className="space-y-4">
        {/* Quantity */}
        <div>
          <label htmlFor="sell-qty" className="text-sm font-medium text-gray-700">Quantity</label>
          <div className="flex items-center gap-2 mt-1">
            <input
              id="sell-qty"
              type="number"
              min={0}
              max={item.quantity}
              value={quantity}
              onChange={(e) => setQuantity(Math.min(item.quantity, Math.max(0, parseInt(e.target.value) || 0)))}
              className="w-24 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-500">/ {item.quantity} available</span>
            <button
              onClick={() => setQuantity(item.quantity)}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              Max
            </button>
          </div>
        </div>

        {/* Sell mode options */}
        <div className="space-y-2">
          <label
            className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
              sellMode === 'instant' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="sellMode"
              value="instant"
              checked={sellMode === 'instant'}
              onChange={() => setSellMode('instant')}
              className="mt-0.5 text-blue-600"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">Instant Sell to Bank</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Sell immediately at 10% below market price. Get coins instantly.
              </p>
              <p className="text-sm font-bold text-green-700 mt-1">
                {instantPrice} coins/unit × {quantity} = {instantTotal} coins
              </p>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
              sellMode === 'marketplace' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="sellMode"
              value="marketplace"
              checked={sellMode === 'marketplace'}
              onChange={() => setSellMode('marketplace')}
              className="mt-0.5 text-blue-600"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">List on Marketplace</p>
              <p className="text-xs text-gray-500 mt-0.5">
                List at market price. Sells when another player buys.
              </p>
              <p className="text-sm font-bold text-blue-700 mt-1">
                {item.marketPrice} coins/unit × {quantity} = {marketTotal} coins
              </p>
            </div>
          </label>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSell} loading={loading} disabled={quantity <= 0}>
            {sellMode === 'instant' ? `Sell for ${instantTotal} coins` : `List ${quantity} on Market`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
