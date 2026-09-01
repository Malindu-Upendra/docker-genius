import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsArray, IsNumber, IsString } from 'class-validator';
import { GrnService } from './grn.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId, CurrentUser } from '../../common/decorators/tenant.decorator';

class GrnIdsDto {
  @IsArray() @IsNumber({}, { each: true }) grnIds: number[];
}

class ReasonDto {
  @IsString() reason: string;
}

@ApiTags('grn')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('grn')
export class GrnController {
  constructor(private readonly grnService: GrnService) {}

  @Post()
  create(@TenantId() tenantId: number, @CurrentUser() user: any, @Body() dto: any) {
    return this.grnService.create(tenantId, dto, user.userId);
  }

  @Get()
  findAll(
    @TenantId() tenantId: number,
    @Query('status') status?: string,
    @Query('supplierId') supplierId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.grnService.findAll(tenantId, status, supplierId ? +supplierId : undefined, page, limit);
  }

  @Get('supplier-performance')
  getSupplierPerformance(
    @TenantId() tenantId: number,
    @Query('supplierId') supplierId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.grnService.getSupplierPerformance(tenantId, supplierId ? +supplierId : undefined, fromDate ? new Date(fromDate) : undefined, toDate ? new Date(toDate) : undefined);
  }

  @Get('suppliers')
  getSuppliers(@TenantId() tenantId: number) {
    return this.grnService.getSuppliers(tenantId);
  }

  @Post('suppliers')
  createSupplier(@TenantId() tenantId: number, @Body() dto: any) {
    return this.grnService.createSupplier(tenantId, dto);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.grnService.findOne(tenantId, id);
  }

  @Put(':id/submit')
  submit(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.grnService.submit(tenantId, id);
  }

  @Post('approve')
  bulkApprove(@TenantId() tenantId: number, @CurrentUser() user: any, @Body() body: GrnIdsDto) {
    return this.grnService.bulkProcess(tenantId, body.grnIds, user.userId);
  }

  @Put(':id/approve')
  approve(@TenantId() tenantId: number, @CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.grnService.approve(tenantId, id, user.userId);
  }

  @Put(':id/reject')
  reject(@TenantId() tenantId: number, @CurrentUser() user: any, @Param('id', ParseIntPipe) id: number, @Body() body: ReasonDto) {
    return this.grnService.reject(tenantId, id, user.userId, body.reason);
  }

  @Post('bulk-process')
  bulkProcess(@TenantId() tenantId: number, @CurrentUser() user: any, @Body() body: GrnIdsDto) {
    return this.grnService.bulkProcess(tenantId, body.grnIds, user.userId);
  }
}
