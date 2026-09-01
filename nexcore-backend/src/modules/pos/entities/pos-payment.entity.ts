import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('pos_payments')
@Index(['tenantId', 'transactionId'])
export class PosPayment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  tenantId: number;

  @Column({ name: 'transaction_id', type: 'int' })
  transactionId: number;

  @Column({ name: 'payment_method_id', type: 'int' })
  paymentMethodId: number;

  @Column({ name: 'amount', type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ name: 'reference_number', type: 'varchar', length: 100, nullable: true })
  referenceNumber: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
