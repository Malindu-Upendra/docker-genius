import { Entity, Column, PrimaryGeneratedColumn, Index, CreateDateColumn } from 'typeorm';
import { PriorityTier } from '../common/enums/priority-tier.enum';

@Entity('semantic_request_logs')
@Index(['priorityTier', 'loggedAt'])
@Index(['tenantId', 'loggedAt'])
@Index(['endpointPath', 'loggedAt'])
export class SemanticRequestLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int', nullable: true })
  tenantId: number;

  @Column({ name: 'request_id', type: 'varchar', length: 36, unique: true })
  requestId: string;

  @Column({ name: 'http_method', type: 'varchar', length: 10 })
  httpMethod: string;

  @Column({ name: 'endpoint_path', type: 'varchar', length: 255 })
  @Index()
  endpointPath: string;

  @Column({ name: 'priority_tier', type: 'enum', enum: PriorityTier, default: PriorityTier.TIER_2 })
  @Index()
  priorityTier: PriorityTier;

  @Column({ name: 'response_time_ms', type: 'int', unsigned: true })
  @Index()
  responseTimeMs: number;

  @Column({ name: 'status_code', type: 'smallint', unsigned: true })
  statusCode: number;

  @CreateDateColumn({ name: 'logged_at' })
  @Index()
  loggedAt: Date;
}
