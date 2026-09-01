import api from './client';

export const getClients = (params?: any) => api.get('/clients', { params });
export const getClient = (id: string) => api.get(`/clients/${id}`);
export const createClient = (data: any) => api.post('/clients', data);
export const updateClient = (id: string, data: any) => api.put(`/clients/${id}`, data);
export const deleteClient = (id: string) => api.delete(`/clients/${id}`);
export const getClientStatement = (id: string, fromDate: string, toDate: string) =>
  api.get(`/clients/${id}/statement`, { params: { fromDate, toDate } });
export const getClientOutstanding = (id: string) => api.get(`/clients/${id}/outstanding`);
export const getClientGroups = () => api.get('/clients/groups');
export const getAgedReceivables = () => api.get('/clients/aged-receivables');
export const getClientDashboard = () => api.get('/clients/dashboard');
