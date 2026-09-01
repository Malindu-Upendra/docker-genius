import { useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Typography, theme } from 'antd';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import {
  DashboardOutlined, ShoppingOutlined, TeamOutlined, InboxOutlined,
  RollbackOutlined, FileTextOutlined, DollarOutlined, BarChartOutlined,
  LogoutOutlined, UserOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { clearAuth, getUser } from '../../store/auth';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/products', icon: <ShoppingOutlined />, label: 'Products' },
  { key: '/clients', icon: <TeamOutlined />, label: 'Clients' },
  { key: '/grn', icon: <InboxOutlined />, label: 'GRN' },
  { key: '/grun', icon: <RollbackOutlined />, label: 'GRUN' },
  { key: '/invoices', icon: <FileTextOutlined />, label: 'Invoices' },
  { key: '/pos', icon: <ShopOutlined />, label: 'Point of Sale' },
  { key: '/payments', icon: <DollarOutlined />, label: 'Payments' },
  { key: '/reports', icon: <BarChartOutlined />, label: 'Reports' },
];

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const user = getUser();
  const { token } = theme.useToken();

  const handleLogout = () => {
    clearAuth();
    navigate('/login');
  };

  const userMenu = {
    items: [
      { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'logout') handleLogout();
    },
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        trigger={null}
        width={220}
        style={{ background: token.colorBgContainer, borderRight: `1px solid ${token.colorBorderSecondary}` }}
      >
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          {collapsed
            ? <Text strong style={{ fontSize: 18, color: token.colorPrimary }}>N</Text>
            : <Text strong style={{ fontSize: 16, color: token.colorPrimary }}>NexCore ERP</Text>
          }
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ border: 'none', marginTop: 8 }}
        />
      </Sider>

      <Layout>
        <Header style={{
          padding: '0 24px',
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span
            style={{ cursor: 'pointer', fontSize: 18 }}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </span>

          <Dropdown menu={userMenu} placement="bottomRight">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} style={{ background: token.colorPrimary }} />
              <Text style={{ maxWidth: 120 }} ellipsis>{user?.fullName ?? user?.email}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>[{user?.tenantCode}]</Text>
            </div>
          </Dropdown>
        </Header>

        <Content style={{ margin: 24, padding: 24, background: token.colorBgContainer, borderRadius: token.borderRadius, minHeight: 'calc(100vh - 112px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
