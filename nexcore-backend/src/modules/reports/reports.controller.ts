import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { IsOptional, IsBoolean, IsNumber, IsString } from 'class-validator';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant.decorator';

// The global ValidationPipe runs with whitelist:true (main.ts), which strips
// any @Body() property that isn't both (a) declared on a real class AND
// (b) carrying at least one class-validator decorator — an inline object
// type literal like `{ research_mode?: boolean }` has no runtime reflection
// metadata at all, and even a plain class with undecorated fields gets its
// properties stripped by class-validator's whitelist pass. This silently
// zeroed out `research_mode` on every bulk-generate call ever made, which
// meant the CPU-burn step gated behind it never actually ran.
class BulkGenerateOptionsDto {
  @IsOptional() @IsBoolean() research_mode?: boolean;
  @IsOptional() @IsNumber() delay_ms?: number;
  @IsOptional() @IsBoolean() isolate_tier3?: boolean;
}

class FinancialAggregateFilterDto {
  @IsOptional() @IsString() fromDate?: string;
  @IsOptional() @IsString() toDate?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() brandId?: string;
}

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // TIER_3: PRIMARY DOCKER-GENIUS research endpoint
  @Post('financial/aggregate')
  @ApiQuery({ name: 'no_cache', required: false, type: Boolean })
  getFinancialAggregate(
    @TenantId() tenantId: string,
    @Body() filter: FinancialAggregateFilterDto,
    @Query('no_cache') no_cache?: string,
  ) {
    return this.reportsService.getFinancialAggregate(tenantId, {
      fromDate: filter.fromDate ? new Date(filter.fromDate) : undefined,
      toDate: filter.toDate ? new Date(filter.toDate) : undefined,
      categoryId: filter.categoryId,
      brandId: filter.brandId,
      no_cache: no_cache === 'true',
    });
  }

  @Get('sales/monthly')
  getMonthlySales(
    @TenantId() tenantId: string,
    @Query('year') year?: string,
    @Query('no_cache') no_cache?: string,
  ) {
    return this.reportsService.getMonthlySales(tenantId, year ? parseInt(year) : undefined, no_cache === 'true');
  }

  @Get('sales/daily')
  getDailySales(
    @TenantId() tenantId: string,
    @Query('date') date?: string,
    @Query('no_cache') no_cache?: string,
  ) {
    return this.reportsService.getDailySales(tenantId, date ? new Date(date) : undefined, no_cache === 'true');
  }

  @Get('inventory/movement')
  getInventoryMovement(
    @TenantId() tenantId: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('productId') productId?: string,
    @Query('no_cache') no_cache?: string,
  ) {
    return this.reportsService.getInventoryMovement(
      tenantId,
      fromDate ? new Date(fromDate) : undefined,
      toDate ? new Date(toDate) : undefined,
      productId,
      no_cache === 'true',
    );
  }

  @Get('inventory/valuation')
  getStockValuation(@TenantId() tenantId: string, @Query('no_cache') no_cache?: string) {
    return this.reportsService.getStockValuation(tenantId, no_cache === 'true');
  }

  @Get('clients/aged-receivables')
  getAgedReceivables(@TenantId() tenantId: string, @Query('no_cache') no_cache?: string) {
    return this.reportsService.getSemanticLogReport(tenantId, undefined, undefined, no_cache === 'true');
  }

  @Get('products/top-selling')
  getTopSelling(
    @TenantId() tenantId: string,
    @Query('limit') limit?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('no_cache') no_cache?: string,
  ) {
    return this.reportsService.getTopSellingProducts(
      tenantId,
      limit ? parseInt(limit) : 20,
      fromDate ? new Date(fromDate) : undefined,
      toDate ? new Date(toDate) : undefined,
      no_cache === 'true',
    );
  }

  @Get('products/profit-margin')
  getProfitMargin(@TenantId() tenantId: string, @Query('no_cache') no_cache?: string) {
    return this.reportsService.getProfitMarginReport(tenantId, no_cache === 'true');
  }

  @Get('semantic-logs')
  getSemanticLogs(
    @TenantId() tenantId: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('no_cache') no_cache?: string,
  ) {
    return this.reportsService.getSemanticLogReport(
      tenantId,
      fromDate ? new Date(fromDate) : undefined,
      toDate ? new Date(toDate) : undefined,
      no_cache === 'true',
    );
  }

  // TIER_3: Bulk generation — PRIMARY load-intensive endpoint for experiments
  @Post('bulk-generate')
  bulkGenerate(
    @TenantId() tenantId: string,
    @Body() options: BulkGenerateOptionsDto,
  ) {
    return this.reportsService.bulkGenerate(tenantId, options);
  }
}
