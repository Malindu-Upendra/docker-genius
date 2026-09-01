import api from './client';

export const getProducts = (params?: any) => api.get('/products', { params });
export const getProduct = (id: string) => api.get(`/products/${id}`);
export const createProduct = (data: any) => api.post('/products', data);
export const updateProduct = (id: string, data: any) => api.put(`/products/${id}`, data);
export const deleteProduct = (id: string) => api.delete(`/products/${id}`);
export const getCategories = () => api.get('/products/categories/list');
export const getBrands = () => api.get('/products/brands/list');
export const getUnits = () => api.get('/products/units/list');
export const getLowStock = () => api.get('/products/low-stock');
export const getProductDashboard = () => api.get('/products/dashboard');
export const adjustStock = (data: any) => api.post('/products/stock/adjust', data);
export const getProductAvailability = (id: string) => api.get(`/products/${id}/availability`);
