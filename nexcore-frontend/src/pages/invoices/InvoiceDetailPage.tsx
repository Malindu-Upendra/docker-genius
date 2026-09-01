import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Descriptions, Table, Tag, Button, Space, Card, Popconfirm,
  message, Typography, Spin, Row, Col, Statistic,
} from 'antd';
import { ArrowLeftOutlined, CheckOutlined, StopOutlined, CopyOutlined } from '@ant-design/icons';
import { getInvoice, confirmInvoice, voidInvoice, duplicateInvoice } from '../../api/invoices';
import { getProducts } from '../../api/products';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const statusColors: Record<string, string> = {
  draft: 'default', confirmed: 'blue', partial: 'orange', paid: 'green', void: 'red',
};

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<any>(null);
  const [productMap, setProductMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [invoiceRes, prodRes] = await Promise.all([
        getInvoice(id!),
        getProducts({ limit: 500 }),
      ]);
      setInvoice(invoiceRes.data);
      const map: Record<string, any> = {};
      for (const p of prodRes.data.items ?? []) map[p.id] = p;
      setProductMap(map);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleConfirm = async () => { await confirmInvoice(id!); message.success('Invoice confirmed'); load(); };
  const handleVoid = async () => { await voidInvoice(id!, 'Voided by user'); message.success('Invoice voided'); load(); };
  const handleDuplicate = async () => {
    await duplicateInvoice(id!);
    message.success('Invoice duplicated — check invoice list');
    navigate('/invoices');
  };

  if (loading) return <Spin style={{ display: 'block', marginTop: 80, textAlign: 'center' }} />;
  if (!invoice) return <div>Invoice not found.</div>;

  const isOverdue = invoice.dueDate && dayjs(invoice.dueDate).isBefore(dayjs()) && Number(invoice.balanceDue) > 0;

  const itemColumns = [
    { title: '#', key: 'idx', width: 48, render: (_: any, __: any, i: number) => i + 1 },
    {
      title: 'Product', dataIndex: 'productId', key: 'productId', width: 240,
      render: (v: string) => {
        const p = productMap[v];
        return p
          ? <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/products/${v}`)}>
              <Text strong>{p.productCode}</Text> — {p.productName}
            </Button>
          : <Text code style={{ fontSize: 11 }}>{v}</Text>;
      },
    },
    { title: 'Qty', dataIndex: 'quantity', key: 'quantity', align: 'right' as const },
    { title: 'Unit Price (LKR)', dataIndex: 'unitPrice', key: 'unitPrice', align: 'right' as const,
      render: (v: any) => Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 }) },
    { title: 'Discount %', dataIndex: 'discountPercentage', key: 'discountPercentage', align: 'right' as const,
      render: (v: any) => Number(v) > 0 ? `${v}%` : '—' },
    { title: 'Discount (LKR)', dataIndex: 'discountAmount', key: 'discountAmount', align: 'right' as const,
      render: (v: any) => Number(v) > 0
        ? <Text type="danger">- {Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</Text>
        : '—' },
    { title: 'Tax %', dataIndex: 'taxPercentage', key: 'taxPercentage', align: 'right' as const,
      render: (v: any) => Number(v) > 0 ? `${v}%` : '—' },
    { title: 'Tax (LKR)', dataIndex: 'taxAmount', key: 'taxAmount', align: 'right' as const,
      render: (v: any) => Number(v) > 0
        ? Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 })
        : '—' },
    { title: 'Line Total (LKR)', dataIndex: 'lineTotal', key: 'lineTotal', align: 'right' as const,
      render: (v: any) => <Text strong>{Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</Text> },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/invoices')}>Back to Invoices</Button>
      </Space>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Invoice: {invoice.invoiceNumber}&nbsp;
            <Tag color={statusColors[invoice.status]} style={{ fontSize: 13 }}>{invoice.status.toUpperCase()}</Tag>
            {isOverdue && <Tag color="red">OVERDUE</Tag>}
          </Title>
        </div>
        <Space>
          {invoice.status === 'draft' && (
            <Popconfirm title="Confirm this invoice?" onConfirm={handleConfirm}>
              <Button type="primary" icon={<CheckOutlined />}>Confirm</Button>
            </Popconfirm>
          )}
          {['draft', 'confirmed'].includes(invoice.status) && (
            <Popconfirm title="Void this invoice?" onConfirm={handleVoid}>
              <Button danger icon={<StopOutlined />}>Void</Button>
            </Popconfirm>
          )}
          <Button icon={<CopyOutlined />} onClick={handleDuplicate}>Duplicate</Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="Total Amount (LKR)"
              value={Number(invoice.totalAmount).toLocaleString('en-LK', { minimumFractionDigits: 2 })} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Amount Paid (LKR)"
              value={Number(invoice.amountPaid).toLocaleString('en-LK', { minimumFractionDigits: 2 })}
              valueStyle={{ color: '#3f8600' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Balance Due (LKR)"
              value={Number(invoice.balanceDue).toLocaleString('en-LK', { minimumFractionDigits: 2 })}
              valueStyle={{ color: Number(invoice.balanceDue) > 0 ? '#cf1322' : '#3f8600' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Line Items" value={invoice.items?.length ?? 0} />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Descriptions title="Invoice Details" bordered size="small" column={3}>
          <Descriptions.Item label="Invoice Number">{invoice.invoiceNumber}</Descriptions.Item>
          <Descriptions.Item label="Invoice Date">{dayjs(invoice.invoiceDate).format('DD/MM/YYYY')}</Descriptions.Item>
          <Descriptions.Item label="Due Date">
            {invoice.dueDate
              ? <span style={{ color: isOverdue ? '#cf1322' : undefined }}>{dayjs(invoice.dueDate).format('DD/MM/YYYY')}</span>
              : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Client">{invoice.clientName ?? invoice.clientId}</Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={statusColors[invoice.status]}>{invoice.status.toUpperCase()}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Created At">{dayjs(invoice.createdAt).format('DD/MM/YYYY HH:mm')}</Descriptions.Item>
          <Descriptions.Item label="Subtotal">LKR {Number(invoice.subtotal).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</Descriptions.Item>
          <Descriptions.Item label="Discount">LKR {Number(invoice.discountAmount).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</Descriptions.Item>
          <Descriptions.Item label="Tax">LKR {Number(invoice.taxAmount).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</Descriptions.Item>
          {invoice.voidedAt && (
            <>
              <Descriptions.Item label="Voided At">{dayjs(invoice.voidedAt).format('DD/MM/YYYY HH:mm')}</Descriptions.Item>
              <Descriptions.Item label="Void Reason" span={2}>{invoice.voidReason ?? '—'}</Descriptions.Item>
            </>
          )}
          {invoice.notes && <Descriptions.Item label="Notes" span={3}>{invoice.notes}</Descriptions.Item>}
        </Descriptions>
      </Card>

      <Card>
        <Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>Invoice Items</Title>
        <Table
          dataSource={invoice.items ?? []}
          columns={itemColumns}
          rowKey="id"
          pagination={false}
          size="small"
          scroll={{ x: 900 }}
          summary={() => {
            const items = invoice.items ?? [];
            const subtotal = items.reduce((s: number, r: any) => s + Number(r.lineTotal), 0);
            return (
              <>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={8} align="right"><Text strong>Total</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Text strong style={{ color: '#1677ff' }}>
                      LKR {subtotal.toLocaleString('en-LK', { minimumFractionDigits: 2 })}
                    </Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </>
            );
          }}
        />
      </Card>
    </div>
  );
}
