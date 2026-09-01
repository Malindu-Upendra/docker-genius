import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsArray, IsNumber, IsString } from 'class-validator';
import { GrunService } from './grun.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId, CurrentUser } from '../../common/decorators/tenant.decorator';

class GrunIdsDto {
  @IsArray() @IsNumber({}, { each: true }) grunIds: number[];
}

class ReasonDto {
  @IsString() reason: string;
}

@ApiTags('grun')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('grun')
export class GrunController {
  constructor(private readonly grunService: GrunService) {}

  @Post()
  create(@TenantId() tenantId: number, @CurrentUser() user: any, @Body() dto: any) {
    return this.grunService.create(tenantId, dto, user.userId);
  }

  @Get()
  findAll(
    @TenantId() tenantId: number,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.grunService.findAll(tenantId, status, page, limit);
  }

  @Get('summary-report')
  getSummary(
    @TenantId() tenantId: number,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.grunService.getSummaryReport(tenantId, fromDate ? new Date(fromDate) : undefined, toDate ? new Date(toDate) : undefined);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.grunService.findOne(tenantId, id);
  }

  @Put(':id/submit')
  submit(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.grunService.submit(tenantId, id);
  }

  @Post('approve')
  approveMultiple(@TenantId() tenantId: number, @CurrentUser() user: any, @Body() body: GrunIdsDto) {
    const results = body.grunIds.map(id => this.grunService.approve(tenantId, id, user.userId).catch(e => ({ id, error: e.message })));
    return Promise.all(results);
  }

  @Put(':id/approve')
  approve(@TenantId() tenantId: number, @CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.grunService.approve(tenantId, id, user.userId);
  }

  @Put(':id/reject')
  reject(@TenantId() tenantId: number, @CurrentUser() user: any, @Param('id', ParseIntPipe) id: number, @Body() body: ReasonDto) {
    return this.grunService.reject(tenantId, id, user.userId, body.reason);
  }
}
