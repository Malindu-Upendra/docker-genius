import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId, CurrentUser } from '../../common/decorators/tenant.decorator';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  create(@TenantId() tenantId: number, @CurrentUser() user: any, @Body() dto: any) {
    return this.paymentsService.create(tenantId, dto, user.userId);
  }

  @Get()
  findAll(
    @TenantId() tenantId: number,
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.paymentsService.findAll(tenantId, clientId ? +clientId : undefined, status, page, limit);
  }

  @Get('dashboard')
  getDashboard(@TenantId() tenantId: number) {
    return this.paymentsService.getDashboard(tenantId);
  }

  @Get('aged-receivables')
  getAgedReceivables(@TenantId() tenantId: number) {
    return this.paymentsService.getAgedReceivables(tenantId);
  }

  @Get('collection-report')
  getCollectionReport(
    @TenantId() tenantId: number,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.paymentsService.getCollectionReport(tenantId, fromDate ? new Date(fromDate) : undefined, toDate ? new Date(toDate) : undefined);
  }

  @Get('outstanding/:clientId')
  getOutstanding(@TenantId() tenantId: number, @Param('clientId', ParseIntPipe) clientId: number) {
    return this.paymentsService.getOutstandingByClient(tenantId, clientId);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.paymentsService.findOne(tenantId, id);
  }

  @Put(':id/approve')
  approvePayment(@TenantId() tenantId: number, @CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.paymentsService.approve(tenantId, id, user.userId);
  }

  @Put(':id/cancel')
  cancelPayment(@TenantId() tenantId: number, @CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.paymentsService.cancel(tenantId, id, user.userId);
  }

  @Put(':id/void')
  voidPayment(@TenantId() tenantId: number, @CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.paymentsService.voidPayment(tenantId, id, user.userId);
  }
}
