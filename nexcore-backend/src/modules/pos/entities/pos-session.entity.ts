import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

export enum SessionStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

@Entity('pos_sessions')
@Index(['tenantId', 'cashierId', 'status'])
export class PosSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'cashier_id', type: 'int' })
  cashierId: number;

  @Column({ name: 'session_number', type: 'varchar', length: 50 })
  sessionNumber: string;

  @Column({ name: 'opening_cash', type: 'decimal', precision: 15, scale: 2, default: 0 })
  openingCash: number;

  @Column({ name: 'closing_cash', type: 'decimal', precision: 15, scale: 2, nullable: true })
  closingCash: number;

  @Column({ name: 'status', type: 'enum', enum: SessionStatus, default: SessionStatus.OPEN })
  @Index()
  status: SessionStatus;

  @Column({ name: 'opened_at', type: 'datetime' })
  openedAt: Date;

  @Column({ name: 'closed_at', type: 'datetime', nullable: true })
  closedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
