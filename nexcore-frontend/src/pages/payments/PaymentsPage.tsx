import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Tag, Space, Popconfirm, message, Typography, Statistic, Row, Col, Card } from 'antd';
import { StopOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { getPayments, voidPayment, getPaymentDashboard } from '../../api/payments';
import dayjs from 'dayjs';

const { Title } = Typography;

const statusColors: Record<string, string> = { pending: 'orange', confirmed: 'green', void: 'red', refunded: 'purple' };

export default function PaymentsPage() {
  const navigate = useNavigate();
  const [payments, setPayments] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<any>(null);

  const load = async (p = page) => {
    setLoading(true);
    try {
      const res = await getPayments({ page: p, limit: 20 });
      setPayments(res.data.items ?? []);
      setTotal(res.data.total ?? 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getPaymentDashboard().then(r => setDashboard(r.data));
  }, []);

  const handleVoid = async (id: string) => {
    await voidPayment(id);
    message.success('Payment voided');
    load();
  };

  const columns = [
    { title: 'Payment #', dataIndex: 'paymentNumber', key: 'paymentNumber', width: 160 },
    { title: 'Client', dataIndex: 'clientName', key: 'clientName', ellipsis: true },
    { title: 'Date', dataIndex: 'paymentDate', key: 'paymentDate', width: 110, render: (v: any) => dayjs(v).format('DD/MM/YYYY') },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right' as const, render: (v: any) => `LKR ${Number(v).toFixed(2)}` },
    { title: 'Reference', dataIndex: 'referenceNumber', key: 'referenceNumber', render: (v: any) => v ?? '—' },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 100, render: (v: string) => <Tag color={statusColors[v]}>{v.toUpperCase()}</Tag> },
    {
      title: 'Actions', key: 'actions', width: 130,
      render: (_: any, row: any) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/payments/${row.id}`)}>View</Button>
          {row.status === 'confirmed' && (
            <Popconfirm title="Void this payment?" onConfirm={() => handleVoid(row.id)}>
              <Button size="small" danger icon={<StopOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Payments</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/payments/new')}>New Payment</Button>
      </div>

      {dashboard && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Card><Statistic title="This Month Received" value={Number(dashboard.monthlyReceived ?? 0).toFixed(2)} suffix="LKR" valueStyle={{ color: '#3f8600' }} /></Card>
          </Col>
          <Col span={8}>
            <Card><Statistic title="Total Overdue" value={Number(dashboard.overdueAmount ?? 0).toFixed(2)} suffix="LKR" valueStyle={{ color: '#cf1322' }} /></Card>
          </Col>
        </Row>
      )}

      <Table
        dataSource={payments}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ current: page, pageSize: 20, total, onChange: (p) => { setPage(p); load(p); } }}
        size="middle"
      />
    </div>
  );
}
