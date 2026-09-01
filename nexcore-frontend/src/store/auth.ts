export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  tenantId: string;
  tenantCode: string;
}

export function getUser(): AuthUser | null {
  const raw = localStorage.getItem('nexcore_user');
  return raw ? JSON.parse(raw) : null;
}

export function getToken(): string | null {
  return localStorage.getItem('nexcore_token');
}

export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem('nexcore_token', token);
  localStorage.setItem('nexcore_user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('nexcore_token');
  localStorage.removeItem('nexcore_user');
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
