import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { PlayerSeason } from './player-season.entity';
import { Factory } from './factory.entity';
import { WorkerAssignment } from './worker-assignment.entity';
import { Inventory } from './inventory.entity';
import { MarketListing } from './market-listing.entity';
import { Loan } from './loan.entity';
import { Shop } from './shop.entity';
import { WalletTransaction } from './wallet-transaction.entity';
import { Notification } from './notification.entity';

@Entity('players')
export class Player {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ name: 'auth_provider', type: 'varchar', length: 20 })
  authProvider!: string;

  @Column({ name: 'auth_provider_id', type: 'varchar', length: 255, nullable: true })
  authProviderId!: string | null;

  @Column({ name: 'display_name', type: 'varchar', length: 50, unique: true })
  displayName!: string;

  @Column({ name: 'avatar_config', type: 'jsonb', default: '{}' })
  avatarConfig!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'last_active_at', type: 'timestamptz', default: () => 'NOW()' })
  lastActiveAt!: Date;

  @Column({ type: 'varchar', length: 20, default: 'player' })
  role!: string;

  @OneToMany(() => PlayerSeason, (ps) => ps.player)
  playerSeasons!: PlayerSeason[];

  @OneToMany(() => Factory, (f) => f.player)
  factories!: Factory[];

  @OneToMany(() => WorkerAssignment, (wa) => wa.player)
  workerAssignments!: WorkerAssignment[];

  @OneToMany(() => Inventory, (inv) => inv.player)
  inventories!: Inventory[];

  @OneToMany(() => MarketListing, (ml) => ml.player)
  marketListings!: MarketListing[];

  @OneToMany(() => Loan, (l) => l.player)
  loans!: Loan[];

  @OneToMany(() => Shop, (s) => s.player)
  shops!: Shop[];

  @OneToMany(() => WalletTransaction, (wt) => wt.player)
  walletTransactions!: WalletTransaction[];

  @OneToMany(() => Notification, (n) => n.player)
  notifications!: Notification[];
}
