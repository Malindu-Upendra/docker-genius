import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Descriptions, Table, Tag, Button, Space, Card, Popconfirm,
  message, Typography, Spin, Row, Col, Statistic,
} from 'antd';
import { ArrowLeftOutlined, StopOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { getPayment, approvePayment, cancelPayment, voidPayment } from '../../api/payments';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const statusColors: Record<string, string> = {
  pending: 'orange', confirmed: 'green', void: 'red', refunded: 'purple',
};

const chequeStatusColors: Record<string, string> = {
  pending: 'orange', deposited: 'blue', cleared: 'green', bounced: 'red',
};

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [payment, setPayment] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await getPayment(id!);
      setPayment(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleApprove = async () => {
    await approvePayment(id!);
    message.success('Payment approved — invoice balances updated');
    load();
  };
  const handleCancel = async () => {
    await cancelPayment(id!);
    message.success('Payment cancelled');
    load();
  };
  const handleVoid = async () => {
    await voidPayment(id!);
    message.success('Payment voided — allocations reversed');
    load();
  };

  if (loading) return <Spin style={{ display: 'block', marginTop: 80, textAlign: 'center' }} />;
  if (!payment) return <div>Payment not found.</div>;

  const allocationColumns = [
    { title: '#', key: 'idx', width: 48, render: (_: any, __: any, i: number) => i + 1 },
    { title: 'Invoice', dataIndex: 'invoiceId', key: 'invoiceId',
      render: (v: string, row: any) => (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/invoices/${v}`)}>
          {row.invoiceNumber ?? v}
        </Button>
      ),
    },
    { title: 'Allocated Amount (LKR)', dataIndex: 'allocatedAmount', key: 'allocatedAmount', align: 'right' as const,
      render: (v: any) => <Text strong>{Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</Text> },
    { title: 'Allocated At', dataIndex: 'allocatedAt', key: 'allocatedAt',
      render: (v: any) => v ? dayjs(v).format('DD/MM/YYYY HH:mm') : '—' },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/payments')}>Back to Payments</Button>
      </Space>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          Payment: {payment.paymentNumber}&nbsp;
          <Tag color={statusColors[payment.status]} style={{ fontSize: 13 }}>{payment.status.toUpperCase()}</Tag>
        </Title>
        <Space>
          {payment.status === 'pending' && (
            <>
              <Popconfirm title="Approve this payment? Invoice balances will be reduced." onConfirm={handleApprove}>
                <Button type="primary" icon={<CheckOutlined />}>Approve</Button>
              </Popconfirm>
              <Popconfirm title="Cancel this payment?" onConfirm={handleCancel}>
                <Button danger icon={<CloseOutlined />}>Cancel</Button>
              </Popconfirm>
            </>
          )}
          {payment.status === 'confirmed' && (
            <Popconfirm title="Void this payment? Allocations will be reversed." onConfirm={handleVoid}>
              <Button danger icon={<StopOutlined />}>Void Payment</Button>
            </Popconfirm>
          )}
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="Payment Amount (LKR)"
              value={Number(payment.amount).toLocaleString('en-LK', { minimumFractionDigits: 2 })}
              valueStyle={{ color: '#3f8600' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Invoices Allocated" value={payment.allocations?.length ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Total Allocated (LKR)"
              value={(payment.allocations ?? [])
                .reduce((s: number, a: any) => s + Number(a.allocatedAmount), 0)
                .toLocaleString('en-LK', { minimumFractionDigits: 2 })} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Payment Date" value={dayjs(payment.paymentDate).format('DD MMM YYYY')} />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Descriptions title="Payment Details" bordered size="small" column={3}>
          <Descriptions.Item label="Payment Number">{payment.paymentNumber}</Descriptions.Item>
          <Descriptions.Item label="Payment Date">{dayjs(payment.paymentDate).format('DD/MM/YYYY')}</Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={statusColors[payment.status]}>{payment.status.toUpperCase()}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Client">{payment.clientName ?? payment.clientId}</Descriptions.Item>
          <Descriptions.Item label="Amount">LKR {Number(payment.amount).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</Descriptions.Item>
          <Descriptions.Item label="Reference #">{payment.referenceNumber ?? '—'}</Descriptions.Item>
          {payment.chequeNumber && (
            <>
              <Descriptions.Item label="Cheque #">{payment.chequeNumber}</Descriptions.Item>
              <Descriptions.Item label="Cheque Date">
                {payment.chequeDate ? dayjs(payment.chequeDate).format('DD/MM/YYYY') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Bank">{payment.chequeBank ?? '—'}</Descriptions.Item>
              {payment.chequeStatus && (
                <Descriptions.Item label="Cheque Status">
                  <Tag color={chequeStatusColors[payment.chequeStatus]}>{payment.chequeStatus.toUpperCase()}</Tag>
                </Descriptions.Item>
              )}
            </>
          )}
          {payment.exchangeRate && Number(payment.exchangeRate) !== 1 && (
            <Descriptions.Item label="Exchange Rate">{payment.exchangeRate}</Descriptions.Item>
          )}
          {payment.voidedAt && (
            <Descriptions.Item label="Voided At" span={3}>
              {dayjs(payment.voidedAt).format('DD/MM/YYYY HH:mm')}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="Created At">{dayjs(payment.createdAt).format('DD/MM/YYYY HH:mm')}</Descriptions.Item>
          {payment.notes && <Descriptions.Item label="Notes" span={3}>{payment.notes}</Descriptions.Item>}
        </Descriptions>
      </Card>

      <Card>
        <Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>Invoice Allocations</Title>
        {(payment.allocations ?? []).length === 0 ? (
          <Text type="secondary">No invoice allocations for this payment.</Text>
        ) : (
          <Table
            dataSource={payment.allocations ?? []}
            columns={allocationColumns}
            rowKey="id"
            pagination={false}
            size="small"
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2} align="right">
                  <Text strong>Total Allocated</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Text strong style={{ color: '#1677ff' }}>
                    LKR {(payment.allocations ?? [])
                      .reduce((s: number, a: any) => s + Number(a.allocatedAmount), 0)
                      .toLocaleString('en-LK', { minimumFractionDigits: 2 })}
                  </Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} />
              </Table.Summary.Row>
            )}
          />
        )}
      </Card>
    </div>
  );
}
