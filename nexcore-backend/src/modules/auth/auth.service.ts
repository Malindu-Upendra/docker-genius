import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../tenants/user.entity';
import { Tenant } from '../tenants/tenant.entity';
import { LoginDto, CreateUserDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email, isActive: true } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const tenant = await this.tenantRepo.findOne({ where: { id: user.tenantId, isActive: true } });
    if (!tenant) throw new UnauthorizedException('Invalid credentials');

    user.lastLoginAt = new Date();
    await this.userRepo.save(user);

    const payload = { sub: user.id, tenantId: tenant.id, email: user.email, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role, tenantId: tenant.id },
    };
  }

  async createUser(dto: CreateUserDto): Promise<User> {
    const existing = await this.userRepo.findOne({ where: { tenantId: dto.tenantId, email: dto.email } });
    if (existing) throw new ConflictException('Email already registered for this tenant');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.userRepo.create({ ...dto, passwordHash } as any);
    return this.userRepo.save(user) as any;
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepo.save(user);
  }
}
