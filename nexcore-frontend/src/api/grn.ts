import api from './client';

export const getGrns = (params?: any) => api.get('/grn', { params });
export const getGrn = (id: string) => api.get(`/grn/${id}`);
export const createGrn = (data: any) => api.post('/grn', data);
export const submitGrn = (id: string) => api.put(`/grn/${id}/submit`);
export const approveGrn = (id: string) => api.put(`/grn/${id}/approve`);
export const rejectGrn = (id: string, reason: string) => api.put(`/grn/${id}/reject`, { reason });
export const getSuppliers = () => api.get('/grn/suppliers');
export const createSupplier = (data: any) => api.post('/grn/suppliers', data);
