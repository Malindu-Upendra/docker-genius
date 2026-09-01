import api from './client';

export const getInvoices = (params?: any) => api.get('/invoices', { params });
export const getInvoice = (id: string) => api.get(`/invoices/${id}`);
export const createInvoice = (data: any) => api.post('/invoices', data);
export const confirmInvoice = (id: string) => api.put(`/invoices/${id}/confirm`);
export const voidInvoice = (id: string, reason: string) => api.put(`/invoices/${id}/void`, { reason });
export const duplicateInvoice = (id: string) => api.post(`/invoices/${id}/duplicate`);
export const getAgingReport = () => api.get('/invoices/aging-report');
