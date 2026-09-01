import { Form, Input, Button, Card, Typography, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { login } from '../../api/auth';
import { setAuth } from '../../store/auth';

const { Title, Text } = Typography;

export default function LoginPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const handleLogin = async (values: any) => {
    try {
      const res = await login(values);
      setAuth(res.data.access_token, res.data.user);
      message.success('Welcome to NexCore ERP');
      navigate('/dashboard');
    } catch (err: any) {
      message.error(err.response?.data?.message ?? 'Login failed');
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#f0f2f5',
    }}>
      <Card style={{ width: 400, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={2} style={{ margin: 0, color: '#1677ff' }}>NexCore ERP</Title>
          <Text type="secondary">Sign in to your account</Text>
        </div>

        <Form form={form} layout="vertical" onFinish={handleLogin}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input prefix={<UserOutlined />} placeholder="admin@company.com" size="large" />
          </Form.Item>

          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="••••••••" size="large" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block size="large">
              Sign In
            </Button>
          </Form.Item>
        </Form>

        <div style={{ marginTop: 16, padding: '12px', background: '#f6f8fa', borderRadius: 6 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Demo: admin@colomboretail.lk / test123
          </Text>
        </div>
      </Card>
    </div>
  );
}
