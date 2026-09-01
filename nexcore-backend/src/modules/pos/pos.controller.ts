import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';
import { PosService } from './pos.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId, CurrentUser } from '../../common/decorators/tenant.decorator';

class OpenSessionDto {
  @IsNumber() openingCash: number;
}

class CloseSessionDto {
  @IsNumber() closingCash: number;
}

@ApiTags('pos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pos')
export class PosController {
  constructor(private readonly posService: PosService) {}

  // TIER_1: Session management
  @Post('sessions')
  openSession(@TenantId() tenantId: number, @CurrentUser() user: any, @Body() body: OpenSessionDto) {
    return this.posService.openSession(tenantId, user.userId, body.openingCash);
  }

  @Get('sessions/current')
  getCurrentSession(@TenantId() tenantId: number, @CurrentUser() user: any) {
    return this.posService.getSession(tenantId, user.userId);
  }

  @Put('sessions/:id/close')
  closeSession(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number, @Body() body: CloseSessionDto) {
    return this.posService.closeSession(tenantId, id, body.closingCash);
  }

  // TIER_1: Product lookup
  @Get('products/scan')
  scanBarcode(@TenantId() tenantId: number, @Query('barcode') barcode: string) {
    return this.posService.scanBarcode(tenantId, barcode);
  }

  @Get('products/search')
  searchProducts(@TenantId() tenantId: number, @Query('q') q: string) {
    return this.posService.searchProducts(tenantId, q);
  }

  // TIER_1: PRIMARY checkout endpoint
  @Post('checkout')
  checkout(@TenantId() tenantId: number, @CurrentUser() user: any, @Body() dto: any) {
    return this.posService.completeCheckout(tenantId, dto, user.userId);
  }

  // TIER_1: Transactions
  @Post('transactions')
  createTransaction(@TenantId() tenantId: number, @CurrentUser() user: any, @Body() dto: any) {
    return this.posService.completeCheckout(tenantId, dto, user.userId);
  }

  @Get('transactions')
  getTransactions(
    @TenantId() tenantId: number,
    @Query('sessionId') sessionId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.posService.getTransactions(tenantId, sessionId ? +sessionId : undefined, page, limit);
  }

  @Get('transactions/:id')
  getTransaction(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.posService.getTransaction(tenantId, id);
  }

  @Put('transactions/:id/void')
  voidTransaction(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.posService.voidTransaction(tenantId, id);
  }
}
