import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('client_contacts')
@Index(['tenantId', 'clientId'])
export class ClientContact {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  tenantId: number;

  @Column({ name: 'client_id', type: 'int' })
  clientId: number;

  @Column({ name: 'contact_name', type: 'varchar', length: 100 })
  contactName: string;

  @Column({ name: 'position', type: 'varchar', length: 80, nullable: true })
  position: string;

  @Column({ name: 'email', type: 'varchar', length: 150, nullable: true })
  email: string;

  @Column({ name: 'phone', type: 'varchar', length: 30, nullable: true })
  phone: string;

  @Column({ name: 'is_primary', type: 'tinyint', default: 0 })
  isPrimary: boolean;
}
