'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Loader, Modal, Panel } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';
import { useAuth } from '@/app/providers';
import { useToast } from '@/lib/toast-context';
import { useWallet } from '@/lib/wallet-context';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AllListingsCommodity {
  commodity: string;
  commodityId: string;
  currentPrice: number;
  listings: AllListingsEntry[];
}

interface AllListingsEntry {
  id: string;
  playerId: string;
  playerName: string;
  quantity: number;
  remainingQuantity: number;
  listedAt: string;
  queuePosition: number;
}

interface MyListing {
  id: string;
  commodityId: string;
  quantity: number;
  remainingQuantity: number;
  listedAt: string;
  status: string;
}

interface CommodityPrice {
  commodityId: string;
  commoditySlug?: string;
  price: number;
}

interface InventoryItem {
  commodityId: string;
  commoditySlug: string;
  commodityName: string;
  quantity: number;
}

type ModalMode = 'buy' | 'sell' | 'instant-sell' | 'delist-confirm' | null;

// ─── Component ───────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const { player } = useAuth();
  const { addToast } = useToast();
  const { refreshWallet } = useWallet();

  const [allListings, setAllListings] = useState<AllListingsCommodity[]>([]);
  const [myListings, setMyListings] = useState<MyListing[]>([]);
  const [prices, setPrices] = useState<CommodityPrice[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Collapsible state for commodity sections
  const [expandedCommodities, setExpandedCommodities] = useState<Set<string>>(new Set());

  // Modal state
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedCommodityId, setSelectedCommodityId] = useState<string | null>(null);
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [actionLoading, setActionLoading] = useState(false);

  // ─── Data Fetching ──────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [allListingsData, myListingsData, pricesData, inventoryData] = await Promise.all([
        api.get<{ listings: AllListingsCommodity[] }>('/marketplace/all-listings'),
        api.get<{ listings: MyListing[] }>('/marketplace/my-listings'),
        api.get<{ prices: CommodityPrice[] }>('/marketplace/prices'),
        api.get<{ items: InventoryItem[] }>('/inventory'),
      ]);
      setAllListings(allListingsData.listings ?? []);
      setMyListings(myListingsData.listings ?? []);
      setPrices(pricesData.prices ?? []);
      setInventory(inventoryData.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load marketplace data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Derived Data ───────────────────────────────────────────────────────────

  /** Map from commodityId to commodity name from all-listings */
  const commodityNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of allListings) {
      map[c.commodityId] = c.commodity;
    }
    // Also from prices/inventory as fallback
    for (const p of prices) {
      if (p.commoditySlug && !map[p.commodityId]) {
        map[p.commodityId] = p.commoditySlug;
      }
    }
    for (const i of inventory) {
      if (!map[i.commodityId]) {
        map[i.commodityId] = i.commodityName;
      }
    }
    return map;
  }, [allListings, prices, inventory]);

  /** Get queue position for a specific listing ID */
  function getQueuePosition(listingId: string): number | null {
    for (const commodity of allListings) {
      const entry = commodity.listings.find((l) => l.id === listingId);
      if (entry) return entry.queuePosition;
    }
    return null;
  }

  function getOwnedQuantity(commodityId: string): number {
    return inventory.find((i) => i.commodityId === commodityId)?.quantity || 0;
  }

  function getCommodityPrice(commodityId: string): number {
    const listing = allListings.find((c) => c.commodityId === commodityId);
    if (listing) return listing.currentPrice;
    const price = prices.find((p) => p.commodityId === commodityId);
    return price?.price ?? 0;
  }

  function getTotalAvailable(commodityId: string): number {
    const commodity = allListings.find((c) => c.commodityId === commodityId);
    if (!commodity) return 0;
    return commodity.listings.reduce((sum, l) => sum + l.remainingQuantity, 0);
  }

  // ─── Collapse Toggle ───────────────────────────────────────────────────────

  function toggleCommodity(commodityId: string) {
    setExpandedCommodities((prev) => {
      const next = new Set(prev);
      if (next.has(commodityId)) {
        next.delete(commodityId);
      } else {
        next.add(commodityId);
      }
      return next;
    });
  }

  // ─── Modal Handlers ─────────────────────────────────────────────────────────

  function openBuyModal(commodityId: string) {
    setSelectedCommodityId(commodityId);
    setModalMode('buy');
    setQuantity(1);
  }

  function openSellModal(commodityId: string) {
    setSelectedCommodityId(commodityId);
    setModalMode('sell');
    setQuantity(1);
  }

  function openInstantSellModal(commodityId: string) {
    setSelectedCommodityId(commodityId);
    setModalMode('instant-sell');
    setQuantity(1);
  }

  function openDelistConfirm(listingId: string) {
    setSelectedListingId(listingId);
    setModalMode('delist-confirm');
  }

  function closeModal() {
    setModalMode(null);
    setSelectedCommodityId(null);
    setSelectedListingId(null);
    setQuantity(1);
  }

  async function handleBuy() {
    if (!selectedCommodityId) return;
    setActionLoading(true);
    try {
      await api.post('/marketplace/buy', {
        commodityId: selectedCommodityId,
        quantity,
      });
      addToast(`Purchased ${quantity} units`, 'success');
      refreshWallet();
      closeModal();
      setLoading(true);
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Purchase failed', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSell() {
    if (!selectedCommodityId) return;
    setActionLoading(true);
    try {
      await api.post('/marketplace/list', {
        commodityId: selectedCommodityId,
        quantity,
      });
      addToast(`Listed ${quantity} units for sale`, 'success');
      closeModal();
      setLoading(true);
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Listing failed', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleInstantSell() {
    if (!selectedCommodityId) return;
    setActionLoading(true);
    try {
      await api.post('/marketplace/instant-sell', {
        commodityId: selectedCommodityId,
        quantity,
      });
      const price = getCommodityPrice(selectedCommodityId);
      const total = Math.floor(price * 0.9 * quantity);
      addToast(`Instant sold for ${total} coins`, 'success');
      refreshWallet();
      closeModal();
      setLoading(true);
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Instant sell failed', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelist() {
    if (!selectedListingId) return;
    setActionLoading(true);
    try {
      await api.delete(`/marketplace/listings/${selectedListingId}`);
      addToast('Listing cancelled, items returned to inventory', 'success');
      closeModal();
      setLoading(true);
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delist failed', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader />
      </div>
    );
  }

  const selectedPrice = selectedCommodityId ? getCommodityPrice(selectedCommodityId) : 0;
  const selectedName = selectedCommodityId ? (commodityNameMap[selectedCommodityId] ?? 'Unknown') : '';
  const selectedOwned = selectedCommodityId ? getOwnedQuantity(selectedCommodityId) : 0;

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Marketplace</h1>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* ─── Top Half: Market Listings (FIFO Queue) ──────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Market Listings</h2>

        {allListings.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No active listings on the marketplace.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {allListings.map((commodity) => {
              const isExpanded = expandedCommodities.has(commodity.commodityId);
              const totalAvailable = commodity.listings.reduce(
                (sum, l) => sum + l.remainingQuantity,
                0,
              );

              return (
                <div
                  key={commodity.commodityId}
                  className="card"
                >
                  {/* Commodity Header */}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => toggleCommodity(commodity.commodityId)}
                      className="flex items-center gap-2 text-left flex-1"
                    >
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="font-medium text-gray-900">{commodity.commodity}</span>
                      <span className="badge badge-blue">{commodity.currentPrice} coins</span>
                      <span className="text-xs text-gray-500">
                        {totalAvailable} available
                      </span>
                    </button>

                    <div className="flex items-center gap-1">
                      <Button variant="primary" size="sm" onClick={() => openBuyModal(commodity.commodityId)}>
                        Buy
                      </Button>
                      {getOwnedQuantity(commodity.commodityId) > 0 && (
                        <>
                          <Button variant="secondary" size="sm" onClick={() => openSellModal(commodity.commodityId)}>
                            List for Sale
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openInstantSellModal(commodity.commodityId)}>
                            Instant Sell
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Expanded FIFO Queue */}
                  {isExpanded && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      {commodity.listings.length === 0 ? (
                        <p className="text-xs text-gray-400">No listings in queue</p>
                      ) : (
                        <table className="table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Seller</th>
                              <th className="text-right">Remaining Qty</th>
                              <th className="text-right">Listed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {commodity.listings.map((entry) => {
                              const isCurrentPlayer = player?.id === entry.playerId;
                              return (
                                <tr
                                  key={entry.id}
                                  className={isCurrentPlayer ? '!bg-blue-50' : ''}
                                >
                                  <td className="font-medium text-gray-500">
                                    {entry.queuePosition}
                                  </td>
                                  <td>
                                    <span className={isCurrentPlayer ? 'font-semibold text-blue-700' : ''}>
                                      {entry.playerName}
                                    </span>
                                    {isCurrentPlayer && (
                                      <span className="badge badge-blue ml-2">You</span>
                                    )}
                                  </td>
                                  <td className="text-right font-medium">
                                    {entry.remainingQuantity}
                                  </td>
                                  <td className="text-right text-gray-500">
                                    {new Date(entry.listedAt).toLocaleDateString()}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Bottom Half: My Listings ────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">My Listings</h2>

        {myListings.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">You have no active listings.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Commodity</th>
                  <th className="text-right">Original Qty</th>
                  <th className="text-right">Remaining Qty</th>
                  <th className="text-right">Listed Date</th>
                  <th className="text-right">Queue #</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {myListings.map((listing) => {
                  const name = commodityNameMap[listing.commodityId] ?? 'Unknown';
                  const queuePos = getQueuePosition(listing.id);

                  return (
                    <tr key={listing.id}>
                      <td className="font-medium">{name}</td>
                      <td className="text-right">{listing.quantity}</td>
                      <td className="text-right">{listing.remainingQuantity}</td>
                      <td className="text-right text-gray-500">
                        {new Date(listing.listedAt).toLocaleDateString()}
                      </td>
                      <td className="text-right">
                        {queuePos !== null ? (
                          <span className="badge badge-gray">#{queuePos}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="text-right">
                        {listing.status === 'ACTIVE' && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => openDelistConfirm(listing.id)}
                          >
                            Delist
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Buy Modal ───────────────────────────────────────────────────────── */}
      <Modal open={modalMode === 'buy'} onClose={closeModal} title="Buy from Marketplace">
        {selectedCommodityId && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Commodity</span>
                <span className="font-medium">{selectedName}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Current Price</span>
                <span className="font-medium">{selectedPrice} coins/unit</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Available</span>
                <span className="font-medium">{getTotalAvailable(selectedCommodityId)} units</span>
              </div>
            </div>

            <div>
              <label htmlFor="buy-quantity" className="label">
                Quantity
              </label>
              <input
                id="buy-quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="input"
              />
            </div>

            <div className="bg-blue-50 rounded-lg p-3 text-sm">
              <div className="flex justify-between font-medium">
                <span>Total Cost</span>
                <span>{selectedPrice * quantity} coins</span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={closeModal}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleBuy} loading={actionLoading}>
                Confirm Purchase
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── List for Sale Modal ─────────────────────────────────────────────── */}
      <Modal open={modalMode === 'sell'} onClose={closeModal} title="List for Sale">
        {selectedCommodityId && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Commodity</span>
                <span className="font-medium">{selectedName}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Market Price</span>
                <span className="font-medium">{selectedPrice} coins/unit</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">You own</span>
                <span className="font-medium">{selectedOwned}</span>
              </div>
            </div>

            <div>
              <label htmlFor="sell-quantity" className="label">
                Quantity to list
              </label>
              <input
                id="sell-quantity"
                type="number"
                min={1}
                max={selectedOwned}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="input"
              />
            </div>

            <p className="text-xs text-gray-500">
              Items listed will sell at the current market price via FIFO queue.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={closeModal}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSell} loading={actionLoading}>
                List for Sale
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Instant Sell Modal ──────────────────────────────────────────────── */}
      <Modal open={modalMode === 'instant-sell'} onClose={closeModal} title="Instant Sell">
        {selectedCommodityId && (
          <div className="space-y-4">
            <div className="alert alert-warning">
              <p className="font-medium">90% of market price</p>
              <p className="text-xs mt-0.5">
                Instant sell gives you immediate coins at a 10% discount from market price.
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Commodity</span>
                <span className="font-medium">{selectedName}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Market Price</span>
                <span className="font-medium">{selectedPrice} coins/unit</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Instant Price (90%)</span>
                <span className="font-medium">{Math.floor(selectedPrice * 0.9)} coins/unit</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">You own</span>
                <span className="font-medium">{selectedOwned}</span>
              </div>
            </div>

            <div>
              <label htmlFor="instant-sell-quantity" className="label">
                Quantity
              </label>
              <input
                id="instant-sell-quantity"
                type="number"
                min={1}
                max={selectedOwned}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="input"
              />
            </div>

            <div className="bg-green-50 rounded-lg p-3 text-sm">
              <div className="flex justify-between font-medium">
                <span>You will receive</span>
                <span className="text-green-700">{Math.floor(selectedPrice * 0.9 * quantity)} coins</span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={closeModal}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleInstantSell} loading={actionLoading}>
                Instant Sell for {Math.floor(selectedPrice * 0.9 * quantity)} coins
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Delist Confirmation Modal ───────────────────────────────────────── */}
      <Modal open={modalMode === 'delist-confirm'} onClose={closeModal} title="Cancel Listing">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to cancel this listing? The remaining items will be returned to your inventory.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={closeModal}>Keep Listed</Button>
            <Button variant="danger" size="sm" onClick={handleDelist} loading={actionLoading}>
              Confirm Delist
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
