import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant.decorator';

class UpdateCreditLimitDto {
  @IsNumber() creditLimit: number;
}

@ApiTags('clients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  create(@TenantId() tenantId: number, @Body() dto: any) {
    return this.clientsService.create(tenantId, dto);
  }

  @Get()
  findAll(
    @TenantId() tenantId: number,
    @Query('search') search?: string,
    @Query('groupId') groupId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.clientsService.findAll(tenantId, search, groupId ? +groupId : undefined, page, limit);
  }

  @Get('dashboard')
  getDashboard(@TenantId() tenantId: number) {
    return this.clientsService.getDashboardMetrics(tenantId);
  }

  @Get('aged-receivables')
  getAgedReceivables(@TenantId() tenantId: number) {
    return this.clientsService.getAgedReceivables(tenantId);
  }

  @Get('groups')
  getGroups(@TenantId() tenantId: number) {
    return this.clientsService.getGroups(tenantId);
  }

  @Post('groups')
  createGroup(@TenantId() tenantId: number, @Body() dto: any) {
    return this.clientsService.createGroup(tenantId, dto);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.clientsService.findOne(tenantId, id);
  }

  @Put(':id')
  update(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.clientsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  delete(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.clientsService.delete(tenantId, id);
  }

  @Put(':id/credit-limit')
  updateCreditLimit(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number, @Body() body: UpdateCreditLimitDto) {
    return this.clientsService.updateCreditLimit(tenantId, id, body.creditLimit);
  }

  @Get(':id/statement')
  getStatement(
    @TenantId() tenantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.clientsService.getStatement(tenantId, id, new Date(fromDate), new Date(toDate));
  }

  @Get(':id/outstanding')
  getOutstanding(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.clientsService.getOutstandingInvoices(tenantId, id);
  }

  @Get(':id/loyalty')
  getLoyalty(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.clientsService.getLoyaltyPoints(tenantId, id);
  }

  @Get(':id/contacts')
  getContacts(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.clientsService.getContacts(tenantId, id);
  }

  @Post(':id/contacts')
  addContact(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.clientsService.addContact(tenantId, id, dto);
  }
}
