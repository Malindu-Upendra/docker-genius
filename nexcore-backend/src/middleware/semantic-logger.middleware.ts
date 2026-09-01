import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { SemanticRequestLog } from '../entities/semantic-request-log.entity';
import { resolvePriorityTier } from '../common/enums/priority-tier.enum';

@Injectable()
export class SemanticLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SemanticLoggerMiddleware.name);

  constructor(
    @InjectRepository(SemanticRequestLog)
    private readonly logRepo: Repository<SemanticRequestLog>,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    const requestId = uuidv4();
    const rawTenantId = (req as any).user?.tenantId ?? req.headers['x-tenant-id'];
    const tenantId: number | null = rawTenantId != null ? Number(rawTenantId) : null;

    // Normalize path — strip query params for tier lookup
    const basePath = req.path.split('?')[0];
    const tier = resolvePriorityTier(req.method, basePath);

    res.on('finish', () => {
      const responseTimeMs = Date.now() - startTime;

      // Fire-and-forget — must NOT block or delay the response. Errors are
      // logged (not silently swallowed): this table is the rule engine's
      // only source of TIER_1 activity, so a silent failure here would
      // make Rule 1/2 permanently unable to fire without any visible cause
      // — exactly what happened before this was added.
      this.logRepo.insert({
        tenantId,
        requestId,
        httpMethod: req.method,
        endpointPath: req.path,
        priorityTier: tier,
        responseTimeMs,
        statusCode: res.statusCode,
        loggedAt: new Date(),
      }).catch((err) => {
        this.logger.error(`Failed to log semantic request: ${err.message}`);
      });
    });

    next();
  }
}
