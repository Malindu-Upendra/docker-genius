import api from './client';

export const getGruns = (params?: any) => api.get('/grun', { params });
export const getGrun = (id: string) => api.get(`/grun/${id}`);
export const createGrun = (data: any) => api.post('/grun', data);
export const submitGrun = (id: string) => api.put(`/grun/${id}/submit`);
export const approveGrun = (id: string) => api.put(`/grun/${id}/approve`);
export const rejectGrun = (id: string, reason: string) => api.put(`/grun/${id}/reject`, { reason });
