import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './tenant.entity';

interface TenantInput {
  tenantCode: string;
  companyName: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  country?: string;
  timezone?: string;
  baseCurrency?: string;
}

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async create(dto: TenantInput): Promise<Tenant> {
    const existing = await this.tenantRepo.findOne({ where: { tenantCode: dto.tenantCode } });
    if (existing) throw new ConflictException(`Tenant code ${dto.tenantCode} already exists`);
    const tenant = this.tenantRepo.create(dto);
    return this.tenantRepo.save(tenant);
  }

  async findAll(): Promise<Tenant[]> {
    return this.tenantRepo.find({ where: { isActive: true } });
  }

  async findOne(id: number): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);
    return tenant;
  }

  async findByCode(tenantCode: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { tenantCode } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantCode} not found`);
    return tenant;
  }

  async update(id: number, dto: Partial<TenantInput>): Promise<Tenant> {
    const tenant = await this.findOne(id);
    Object.assign(tenant, dto);
    return this.tenantRepo.save(tenant);
  }

  async deactivate(id: number): Promise<void> {
    const tenant = await this.findOne(id);
    tenant.isActive = false;
    await this.tenantRepo.save(tenant);
  }
}
