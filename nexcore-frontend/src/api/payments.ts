import api from './client';

export const getPayments = (params?: any) => api.get('/payments', { params });
export const getPayment = (id: string) => api.get(`/payments/${id}`);
export const createPayment = (data: any) => api.post('/payments', data);
export const approvePayment = (id: string) => api.put(`/payments/${id}/approve`);
export const cancelPayment = (id: string) => api.put(`/payments/${id}/cancel`);
export const voidPayment = (id: string) => api.put(`/payments/${id}/void`);
export const getOutstandingInvoices = (clientId: string) => api.get(`/payments/outstanding/${clientId}`);
export const getAgedReceivables = () => api.get('/payments/aged-receivables');
export const getCollectionReport = (params?: any) => api.get('/payments/collection-report', { params });
export const getPaymentDashboard = () => api.get('/payments/dashboard');
