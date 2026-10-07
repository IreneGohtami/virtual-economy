// SEA Commodity Tycoon - WebSocket Event Types

import { CommodityCategory, EventType, WorkerStatus } from './enums';

// ============================================================
// Server → Client Event Names
// ============================================================

export enum ServerEvent {
  PRODUCTION_PROGRESS = 'production.progress',
  PRODUCTION_COMPLETE = 'production.complete',
  PRODUCTION_PAUSED = 'production.paused',
  MARKETPLACE_TRADE = 'marketplace.trade',
  MARKETPLACE_PRICE_UPDATE = 'marketplace.price_update',
  WORKER_STATUS_CHANGE = 'worker.status_change',
  EVENT_STARTED = 'event.started',
  EVENT_ENDED = 'event.ended',
  SEASON_MILESTONE = 'season.milestone',
  NOTIFICATION = 'notification',
  LOAN_PAYMENT_REMINDER = 'loan.payment_reminder',
  SHOP_REVENUE = 'shop.revenue',
  FACTORY_OUTPUT_SWITCHED = 'factory.output_switched',
  HAPPINESS_WARNING = 'happiness.warning',
}

// ============================================================
// Client → Server Event Names
// ============================================================

export enum ClientEvent {
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  HEARTBEAT = 'heartbeat',
}

// ============================================================
// Server → Client Payloads
// ============================================================

export interface ProductionProgressPayload {
  jobId: string;
  unitsProduced: number;
  totalYield: number;
}

export interface ProductionCompletePayload {
  jobId: string;
  commodityId: string;
  totalProduced: number;
}

export interface ProductionPausedPayload {
  jobId: string;
  reason: string;
}

export interface MarketplaceTradePayload {
  commodityId: string;
  quantity: number;
  price: number;
  queueDepth: number;
}

export interface MarketplacePriceUpdatePayload {
  commodityId: string;
  newPrice: number;
  change: number;
}

export interface WorkerStatusChangePayload {
  workerId: string;
  oldStatus: WorkerStatus;
  newStatus: WorkerStatus;
}

export interface EventStartedPayload {
  eventId: string;
  type: EventType;
  affectedCategories: CommodityCategory[];
  modifiers: EventModifiers;
}

export interface EventModifiers {
  productionModifier?: number;
  demandModifier?: number;
  priceModifier?: number;
}

export interface EventEndedPayload {
  eventId: string;
}

export interface SeasonMilestonePayload {
  type: string;
  message: string;
}

export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH';
}

export interface LoanPaymentReminderPayload {
  loanId: string;
  amount: number;
  dueAt: string;
}

export interface ShopRevenuePayload {
  shopId: string;
  amount: number;
  commodityConsumed: string;
}

export interface FactoryOutputSwitchedPayload {
  factoryId: string;
  oldOutput: string;
  newOutput: string;
  cooldownUntil: string;
}

export interface HappinessWarningPayload {
  level: string;
  currentHappiness: number;
}

// ============================================================
// Client → Server Payloads
// ============================================================

export interface SubscribePayload {
  channels: string[];
}

export interface UnsubscribePayload {
  channels: string[];
}

export interface HeartbeatPayload {
  timestamp: number;
}

// ============================================================
// Discriminated union of all server events
// ============================================================

export type ServerEventPayload =
  | { event: ServerEvent.PRODUCTION_PROGRESS; data: ProductionProgressPayload }
  | { event: ServerEvent.PRODUCTION_COMPLETE; data: ProductionCompletePayload }
  | { event: ServerEvent.PRODUCTION_PAUSED; data: ProductionPausedPayload }
  | { event: ServerEvent.MARKETPLACE_TRADE; data: MarketplaceTradePayload }
  | { event: ServerEvent.MARKETPLACE_PRICE_UPDATE; data: MarketplacePriceUpdatePayload }
  | { event: ServerEvent.WORKER_STATUS_CHANGE; data: WorkerStatusChangePayload }
  | { event: ServerEvent.EVENT_STARTED; data: EventStartedPayload }
  | { event: ServerEvent.EVENT_ENDED; data: EventEndedPayload }
  | { event: ServerEvent.SEASON_MILESTONE; data: SeasonMilestonePayload }
  | { event: ServerEvent.NOTIFICATION; data: NotificationPayload }
  | { event: ServerEvent.LOAN_PAYMENT_REMINDER; data: LoanPaymentReminderPayload }
  | { event: ServerEvent.SHOP_REVENUE; data: ShopRevenuePayload }
  | { event: ServerEvent.FACTORY_OUTPUT_SWITCHED; data: FactoryOutputSwitchedPayload }
  | { event: ServerEvent.HAPPINESS_WARNING; data: HappinessWarningPayload };

// ============================================================
// Discriminated union of all client events
// ============================================================

export type ClientEventPayload =
  | { event: ClientEvent.SUBSCRIBE; data: SubscribePayload }
  | { event: ClientEvent.UNSUBSCRIBE; data: UnsubscribePayload }
  | { event: ClientEvent.HEARTBEAT; data: HeartbeatPayload };
