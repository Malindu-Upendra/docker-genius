import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Client } from './entities/client.entity';
import { ClientGroup } from './entities/client-group.entity';
import { ClientContact } from './entities/client-contact.entity';

export interface CreateClientDto {
  clientCode: string;
  clientName: string;
  clientGroupId?: number;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  taxNumber?: string;
  creditLimit?: number;
  salesRepId?: number;
  paymentTermsId?: number;
}

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
    @InjectRepository(ClientGroup) private readonly groupRepo: Repository<ClientGroup>,
    @InjectRepository(ClientContact) private readonly contactRepo: Repository<ClientContact>,
    private readonly dataSource: DataSource,
  ) {}

  async create(tenantId: number, dto: CreateClientDto): Promise<Client> {
    const existing = await this.clientRepo.findOne({ where: { tenantId, clientCode: dto.clientCode } });
    if (existing) throw new ConflictException(`Client code ${dto.clientCode} already exists`);
    return this.clientRepo.save({ ...dto, tenantId });
  }

  async findAll(tenantId: number, search?: string, groupId?: number, page = 1, limit = 20) {
    const qb = this.clientRepo.createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.isActive = 1');

    if (search) qb.andWhere('(c.clientName LIKE :s OR c.clientCode LIKE :s OR c.email LIKE :s)', { s: `%${search}%` });
    if (groupId) qb.andWhere('c.clientGroupId = :groupId', { groupId });

    const [items, total] = await qb.skip((page - 1) * limit).take(limit).orderBy('c.clientName', 'ASC').getManyAndCount();
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(tenantId: number, id: number): Promise<Client> {
    const client = await this.clientRepo.findOne({ where: { id, tenantId } });
    if (!client) throw new NotFoundException(`Client ${id} not found`);
    return client;
  }

  async update(tenantId: number, id: number, dto: Partial<CreateClientDto>): Promise<Client> {
    const client = await this.findOne(tenantId, id);
    Object.assign(client, dto);
    return this.clientRepo.save(client);
  }

  async delete(tenantId: number, id: number): Promise<void> {
    const client = await this.findOne(tenantId, id);
    client.isActive = false;
    await this.clientRepo.save(client);
  }

  async updateCreditLimit(tenantId: number, id: number, creditLimit: number): Promise<Client> {
    if (creditLimit < 0) throw new BadRequestException('Credit limit cannot be negative');
    const client = await this.findOne(tenantId, id);
    client.creditLimit = creditLimit;
    return this.clientRepo.save(client);
  }

  async getStatement(tenantId: number, clientId: number, fromDate: Date, toDate: Date) {
    return this.dataSource.query(
      `SELECT 'invoice' AS type, i.invoice_number AS reference, i.invoice_date AS txn_date,
          i.total_amount AS debit, 0 AS credit, i.balance_due AS running_balance
        FROM invoices i
        WHERE i.tenant_id = ? AND i.client_id = ? AND i.invoice_date BETWEEN ? AND ?
          AND i.status != 'void'
       UNION ALL
       SELECT 'payment', p.payment_number, p.payment_date, 0, p.amount, -p.amount
        FROM payments p
        WHERE p.tenant_id = ? AND p.client_id = ? AND p.payment_date BETWEEN ? AND ?
          AND p.status = 'confirmed'
       ORDER BY txn_date ASC`,
      [tenantId, clientId, fromDate, toDate, tenantId, clientId, fromDate, toDate],
    );
  }

  async getOutstandingInvoices(tenantId: number, clientId: number) {
    return this.dataSource.query(
      `SELECT i.invoice_number, i.invoice_date, i.due_date, i.total_amount, i.balance_due,
          DATEDIFF(CURDATE(), i.due_date) AS days_overdue
        FROM invoices i
        WHERE i.tenant_id = ? AND i.client_id = ? AND i.balance_due > 0 AND i.status != 'void'
        ORDER BY i.due_date ASC`,
      [tenantId, clientId],
    );
  }

  async getLoyaltyPoints(tenantId: number, clientId: number) {
    const client = await this.findOne(tenantId, clientId);
    return { clientId, loyaltyPoints: client.loyaltyPoints };
  }

  async getAgedReceivables(tenantId: number) {
    return this.dataSource.query(
      `SELECT c.client_code, c.client_name,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) <= 0 THEN i.balance_due ELSE 0 END) AS current_amount,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 1 AND 30 THEN i.balance_due ELSE 0 END) AS days_1_30,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 31 AND 60 THEN i.balance_due ELSE 0 END) AS days_31_60,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 61 AND 90 THEN i.balance_due ELSE 0 END) AS days_61_90,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) > 90 THEN i.balance_due ELSE 0 END) AS over_90_days,
          SUM(i.balance_due) AS total_outstanding
        FROM clients c
        JOIN invoices i ON i.client_id = c.id AND i.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? AND i.balance_due > 0 AND i.status != 'void'
        GROUP BY c.id, c.client_code, c.client_name
        ORDER BY total_outstanding DESC`,
      [tenantId],
    );
  }

  async getDashboardMetrics(tenantId: number) {
    const [total] = await this.dataSource.query('SELECT COUNT(*) AS total FROM clients WHERE tenant_id = ? AND is_active = 1', [tenantId]);
    const [overdue] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT c.id) AS total FROM clients c
       JOIN invoices i ON i.client_id = c.id AND i.tenant_id = c.tenant_id
       WHERE c.tenant_id = ? AND i.balance_due > 0 AND i.due_date < CURDATE() AND i.status != 'void'`, [tenantId]
    );
    const [balance] = await this.dataSource.query(
      'SELECT SUM(current_balance) AS total FROM clients WHERE tenant_id = ?', [tenantId]
    );
    return { totalClients: total.total, overdueClients: overdue.total, totalOutstanding: balance.total };
  }

  // Contacts
  async addContact(tenantId: number, clientId: number, dto: Partial<ClientContact>) {
    return this.contactRepo.save({ ...dto, tenantId, clientId });
  }

  async getContacts(tenantId: number, clientId: number) {
    return this.contactRepo.find({ where: { tenantId, clientId } });
  }

  // Groups
  async createGroup(tenantId: number, dto: Partial<ClientGroup>) {
    return this.groupRepo.save({ ...dto, tenantId });
  }

  async getGroups(tenantId: number) {
    return this.groupRepo.find({ where: { tenantId, isActive: true }, order: { groupName: 'ASC' } });
  }
}
