import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, CreateUserDto, ChangePasswordDto } from './dto/login.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('users')
  @UseGuards(JwtAuthGuard)
  createUser(@Body() dto: CreateUserDto) {
    return this.authService.createUser(dto);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  changePassword(
    @Request() req,
    @Body() body: ChangePasswordDto,
  ) {
    return this.authService.changePassword(req.user.userId, body.currentPassword, body.newPassword);
  }
}
