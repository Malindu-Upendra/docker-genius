import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum PaymentStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  VOID = 'void',
  REFUNDED = 'refunded',
}

export enum ChequeStatus {
  PENDING = 'pending',
  DEPOSITED = 'deposited',
  CLEARED = 'cleared',
  BOUNCED = 'bounced',
}

@Entity('payments')
@Index(['tenantId', 'paymentNumber'], { unique: true })
@Index(['tenantId', 'clientId', 'status'])
export class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'payment_number', type: 'varchar', length: 50 })
  paymentNumber: string;

  @Column({ name: 'client_id', type: 'int' })
  clientId: number;

  @Column({ name: 'payment_method_id', type: 'int' })
  paymentMethodId: number;

  @Column({ name: 'payment_date', type: 'date' })
  paymentDate: Date;

  @Column({ name: 'amount', type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ name: 'currency_id', type: 'int', nullable: true })
  currencyId: number;

  @Column({ name: 'exchange_rate', type: 'decimal', precision: 15, scale: 6, default: 1 })
  exchangeRate: number;

  @Column({ name: 'base_amount', type: 'decimal', precision: 15, scale: 2, nullable: true })
  baseAmount: number;

  @Column({ name: 'status', type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  @Index()
  status: PaymentStatus;

  @Column({ name: 'reference_number', type: 'varchar', length: 100, nullable: true })
  referenceNumber: string;

  @Column({ name: 'cheque_number', type: 'varchar', length: 50, nullable: true })
  chequeNumber: string;

  @Column({ name: 'cheque_date', type: 'date', nullable: true })
  chequeDate: Date;

  @Column({ name: 'cheque_bank', type: 'varchar', length: 100, nullable: true })
  chequeBank: string;

  @Column({ name: 'cheque_status', type: 'enum', enum: ChequeStatus, nullable: true })
  chequeStatus: ChequeStatus;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string;

  @Column({ name: 'created_by', type: 'int' })
  createdBy: number;

  @Column({ name: 'voided_by', type: 'int', nullable: true })
  voidedBy: number;

  @Column({ name: 'voided_at', type: 'datetime', nullable: true })
  voidedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
