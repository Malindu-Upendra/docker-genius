import api from './client';

export const login = (data: { email: string; password: string }) =>
  api.post('/auth/login', data);
