import { IsString, IsEmail, Length } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@tenant.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @Length(6, 100)
  password: string;
}

export class CreateUserDto {
  @ApiProperty()
  tenantId: number;

  @ApiProperty()
  @IsString()
  fullName: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @Length(6, 100)
  password: string;

  @ApiProperty({ enum: ['super_admin', 'admin', 'manager', 'cashier', 'viewer'] })
  @IsString()
  role: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @Length(6, 100)
  newPassword: string;
}
