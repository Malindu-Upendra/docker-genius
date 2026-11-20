import { Controller, Get } from '@nestjs/common';
import { getPoolStats } from './cpu-burn-pool';

// Deliberately unguarded (no JwtAuthGuard) — polled by the governor
// dashboard (a trusted local process, not an end-user client) so it can
// show the TIER_3 worker-thread isolation pool's live occupancy.
@Controller('internal')
export class MonitoringController {
  @Get('pool-stats')
  poolStats() {
    return getPoolStats();
  }
}
