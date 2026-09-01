import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

export enum TransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  VOID = 'void',
  REFUNDED = 'refunded',
  HELD = 'held',
}

@Entity('pos_transactions')
@Index(['tenantId', 'sessionId'])
@Index(['tenantId', 'transactionNumber'], { unique: true })
export class PosTransaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'session_id', type: 'int' })
  sessionId: number;

  @Column({ name: 'transaction_number', type: 'varchar', length: 50 })
  transactionNumber: string;

  @Column({ name: 'client_id', type: 'int', nullable: true })
  clientId: number;

  @Column({ name: 'status', type: 'enum', enum: TransactionStatus, default: TransactionStatus.PENDING })
  @Index()
  status: TransactionStatus;

  @Column({ name: 'subtotal', type: 'decimal', precision: 15, scale: 2, default: 0 })
  subtotal: number;

  @Column({ name: 'discount_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  discountAmount: number;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  taxAmount: number;

  @Column({ name: 'total_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalAmount: number;

  @Column({ name: 'amount_tendered', type: 'decimal', precision: 15, scale: 2, default: 0 })
  amountTendered: number;

  @Column({ name: 'change_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  changeAmount: number;

  @Column({ name: 'loyalty_points_earned', type: 'int', default: 0 })
  loyaltyPointsEarned: number;

  @Column({ name: 'loyalty_points_redeemed', type: 'int', default: 0 })
  loyaltyPointsRedeemed: number;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn({ name: 'transaction_time' })
  transactionTime: Date;
}
