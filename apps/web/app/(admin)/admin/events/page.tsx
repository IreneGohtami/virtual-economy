'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Button, Card, Loader, Panel } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';

const EVENT_TYPES = [
  'FLOOD',
  'LIVESTOCK_DISEASE',
  'STORM',
  'FOREST_FIRE',
  'EXCELLENT_HARVEST',
  'INFRASTRUCTURE_PROGRAM',
  'EV_INCENTIVE',
] as const;

const CATEGORIES = [
  'AGRICULTURE',
  'ENERGY',
  'METAL',
  'LIVESTOCK',
  'FISHERY',
  'FORESTRY',
  'ELECTRONICS',
  'AUTOMOTIVE',
] as const;

interface GameEvent {
  id: string;
  eventType: string;
  name: string;
  durationMinutes: number;
  affectedCategories: string[];
  productionModifier?: number;
  demandModifier?: number;
  priceModifier?: number;
  startedAt: string;
  endsAt?: string;
}

export default function EventsPage() {
  const [activeEvents, setActiveEvents] = useState<GameEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Form state
  const [eventType, setEventType] = useState<string>(EVENT_TYPES[0]);
  const [name, setName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [productionModifier, setProductionModifier] = useState('');
  const [demandModifier, setDemandModifier] = useState('');
  const [priceModifier, setPriceModifier] = useState('');

  const fetchEvents = useCallback(async () => {
    try {
      const data = await api.get<{ events: GameEvent[] }>('/events/active');
      const events = data.events || [];
      setActiveEvents(events);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const handleTriggerEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        eventType,
        name,
        durationMinutes: parseInt(durationMinutes, 10),
        affectedCategories: selectedCategories,
      };
      if (productionModifier) body.productionModifier = parseFloat(productionModifier);
      if (demandModifier) body.demandModifier = parseFloat(demandModifier);
      if (priceModifier) body.priceModifier = parseFloat(priceModifier);

      await api.post('/events/trigger', body);
      setName('');
      setSelectedCategories([]);
      setProductionModifier('');
      setDemandModifier('');
      setPriceModifier('');
      await fetchEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger event');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEndEvent = async (eventId: string) => {
    setActionLoading(true);
    setError(null);
    try {
      await api.post(`/events/${eventId}/end`);
      await fetchEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end event');
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
      <h1 className="text-2xl font-bold text-gray-900">Event Management</h1>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Active Events */}
      <Panel title="Active Events">
        {activeEvents.length === 0 ? (
          <p className="text-gray-500 text-sm">No active events.</p>
        ) : (
          <div className="space-y-3">
            {activeEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div>
                  <p className="font-medium text-gray-900">{event.name}</p>
                  <p className="text-xs text-gray-500">
                    {event.eventType} · {event.durationMinutes}min ·{' '}
                    {event.affectedCategories.join(', ')}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Started: {new Date(event.startedAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleEndEvent(event.id)}
                  loading={actionLoading}
                >
                  End
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Trigger Event Form */}
      <Card title="Trigger Event">
        <form onSubmit={handleTriggerEvent} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="eventType" className="block text-sm font-medium text-gray-700 mb-1">
                Event Type
              </label>
              <select
                id="eventType"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="eventName" className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input
                id="eventName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="durationMinutes" className="block text-sm font-medium text-gray-700 mb-1">
              Duration (minutes)
            </label>
            <input
              id="durationMinutes"
              type="number"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              min="1"
              required
            />
          </div>

          {/* Categories */}
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-2">
              Affected Categories
            </span>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <label
                  key={cat}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                    selectedCategories.includes(cat)
                      ? 'bg-blue-100 text-blue-700 border-blue-300'
                      : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedCategories.includes(cat)}
                    onChange={() => toggleCategory(cat)}
                    className="sr-only"
                  />
                  {cat.replace(/_/g, ' ')}
                </label>
              ))}
            </div>
          </div>

          {/* Modifiers */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="productionModifier" className="block text-sm font-medium text-gray-700 mb-1">
                Production Modifier
              </label>
              <input
                id="productionModifier"
                type="number"
                step="0.01"
                value={productionModifier}
                onChange={(e) => setProductionModifier(e.target.value)}
                placeholder="e.g. 0.5"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="demandModifier" className="block text-sm font-medium text-gray-700 mb-1">
                Demand Modifier
              </label>
              <input
                id="demandModifier"
                type="number"
                step="0.01"
                value={demandModifier}
                onChange={(e) => setDemandModifier(e.target.value)}
                placeholder="e.g. 1.5"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="priceModifier" className="block text-sm font-medium text-gray-700 mb-1">
                Price Modifier
              </label>
              <input
                id="priceModifier"
                type="number"
                step="0.01"
                value={priceModifier}
                onChange={(e) => setPriceModifier(e.target.value)}
                placeholder="e.g. 1.2"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          <Button type="submit" loading={actionLoading}>
            Trigger Event
          </Button>
        </form>
      </Card>
    </div>
  );
}
