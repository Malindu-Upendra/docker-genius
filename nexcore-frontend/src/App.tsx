import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/auth/LoginPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import ProductsPage from './pages/products/ProductsPage';
import ProductDetailPage from './pages/products/ProductDetailPage';
import ClientsPage from './pages/clients/ClientsPage';
import GrnPage from './pages/grn/GrnPage';
import GrnDetailPage from './pages/grn/GrnDetailPage';
import GrnCreatePage from './pages/grn/GrnCreatePage';
import GrunPage from './pages/grun/GrunPage';
import GrunDetailPage from './pages/grun/GrunDetailPage';
import GrunCreatePage from './pages/grun/GrunCreatePage';
import InvoicesPage from './pages/invoices/InvoicesPage';
import InvoiceDetailPage from './pages/invoices/InvoiceDetailPage';
import InvoiceCreatePage from './pages/invoices/InvoiceCreatePage';
import PosPage from './pages/pos/PosPage';
import PaymentsPage from './pages/payments/PaymentsPage';
import PaymentDetailPage from './pages/payments/PaymentDetailPage';
import PaymentCreatePage from './pages/payments/PaymentCreatePage';
import ReportsPage from './pages/reports/ReportsPage';
import { isAuthenticated } from './store/auth';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="products/:id" element={<ProductDetailPage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="grn" element={<GrnPage />} />
            <Route path="grn/new" element={<GrnCreatePage />} />
            <Route path="grn/:id" element={<GrnDetailPage />} />
            <Route path="grun" element={<GrunPage />} />
            <Route path="grun/new" element={<GrunCreatePage />} />
            <Route path="grun/:id" element={<GrunDetailPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="invoices/new" element={<InvoiceCreatePage />} />
            <Route path="invoices/:id" element={<InvoiceDetailPage />} />
            <Route path="pos" element={<PosPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="payments/new" element={<PaymentCreatePage />} />
            <Route path="payments/:id" element={<PaymentDetailPage />} />
            <Route path="reports" element={<ReportsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}
