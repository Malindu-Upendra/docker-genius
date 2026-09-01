import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { InvoicingService } from './invoicing.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId, CurrentUser } from '../../common/decorators/tenant.decorator';

class ReasonDto {
  @IsString() reason: string;
}

@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invoices')
export class InvoicingController {
  constructor(private readonly invoicingService: InvoicingService) {}

  @Post()
  create(@TenantId() tenantId: number, @CurrentUser() user: any, @Body() dto: any) {
    return this.invoicingService.create(tenantId, dto, user.userId);
  }

  @Get()
  findAll(
    @TenantId() tenantId: number,
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.invoicingService.findAll(tenantId, clientId ? +clientId : undefined, status, page, limit);
  }

  @Get('aging-report')
  getAgingReport(@TenantId() tenantId: number) {
    return this.invoicingService.getAgingReport(tenantId);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.invoicingService.findOne(tenantId, id);
  }

  @Put(':id/confirm')
  confirm(@TenantId() tenantId: number, @CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.invoicingService.confirm(tenantId, id, user.userId);
  }

  @Put(':id/void')
  void(@TenantId() tenantId: number, @CurrentUser() user: any, @Param('id', ParseIntPipe) id: number, @Body() body: ReasonDto) {
    return this.invoicingService.voidInvoice(tenantId, id, user.userId, body.reason);
  }

  @Post(':id/duplicate')
  duplicate(@TenantId() tenantId: number, @CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.invoicingService.duplicate(tenantId, id, user.userId);
  }
}
