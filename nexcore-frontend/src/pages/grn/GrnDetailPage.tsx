import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Descriptions, Table, Tag, Button, Space, Card, Popconfirm,
  message, Typography, Spin, Row, Col, Statistic,
} from 'antd';
import { ArrowLeftOutlined, CheckOutlined, CloseOutlined, SendOutlined } from '@ant-design/icons';
import { getGrn, submitGrn, approveGrn, rejectGrn } from '../../api/grn';
import { getProducts } from '../../api/products';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const statusColors: Record<string, string> = {
  draft: 'default', submitted: 'blue', approved: 'green', rejected: 'red', partial: 'orange',
};

export default function GrnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [grn, setGrn] = useState<any>(null);
  const [productMap, setProductMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [grnRes, prodRes] = await Promise.all([
        getGrn(id!),
        getProducts({ limit: 500 }),
      ]);
      setGrn(grnRes.data);
      const map: Record<string, any> = {};
      for (const p of prodRes.data.items ?? []) map[p.id] = p;
      setProductMap(map);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleSubmit = async () => { await submitGrn(id!); message.success('GRN submitted'); load(); };
  const handleApprove = async () => { await approveGrn(id!); message.success('GRN approved — stock updated'); load(); };
  const handleReject = async () => { await rejectGrn(id!, 'Rejected'); message.success('GRN rejected'); load(); };

  if (loading) return <Spin style={{ display: 'block', marginTop: 80, textAlign: 'center' }} />;
  if (!grn) return <div>GRN not found.</div>;

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
    { title: 'Qty', dataIndex: 'qty', key: 'qty', align: 'right' as const,
      render: (v: any) => <Text strong>{v}</Text> },
    { title: 'Returned (GRUN)', dataIndex: 'returnedQty', key: 'returnedQty', align: 'right' as const,
      render: (v: any) => Number(v) > 0
        ? <Text strong style={{ color: '#d46b08' }}>{v}</Text>
        : <Text type="secondary">0</Text> },
    { title: 'Net in Stock', dataIndex: 'netQty', key: 'netQty', align: 'right' as const,
      render: (v: any) => <Text strong style={{ color: Number(v) > 0 ? '#1677ff' : '#cf1322' }}>{v}</Text> },
    { title: 'Unit Cost (LKR)', dataIndex: 'unitCost', key: 'unitCost', align: 'right' as const,
      render: (v: any) => Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 }) },
    { title: 'Line Total (LKR)', dataIndex: 'lineTotal', key: 'lineTotal', align: 'right' as const,
      render: (v: any) => <Text strong>{Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</Text> },
    { title: 'Batch #', dataIndex: 'batchNumber', key: 'batchNumber', render: (v: any) => v ?? '—' },
    { title: 'Notes', dataIndex: 'notes', key: 'notes', render: (v: any) => v ?? '—' },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/grn')}>Back to GRN List</Button>
      </Space>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          GRN: {grn.grnNumber}&nbsp;
          <Tag color={statusColors[grn.status]} style={{ fontSize: 13 }}>{grn.status.toUpperCase()}</Tag>
        </Title>
        <Space>
          {grn.status === 'draft' && (
            <Button icon={<SendOutlined />} onClick={handleSubmit}>Submit</Button>
          )}
          {grn.status === 'submitted' && (
            <>
              <Popconfirm title="Approve GRN? This will update stock." onConfirm={handleApprove}>
                <Button type="primary" icon={<CheckOutlined />}>Approve</Button>
              </Popconfirm>
              <Popconfirm title="Reject this GRN?" onConfirm={handleReject}>
                <Button danger icon={<CloseOutlined />}>Reject</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="Total Cost (LKR)" value={Number(grn.totalCost).toLocaleString('en-LK', { minimumFractionDigits: 2 })} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Total Quantity" value={Number(grn.totalQuantity)} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Line Items" value={grn.items?.length ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Received Date" value={dayjs(grn.receivedDate).format('DD MMM YYYY')} />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Descriptions title="GRN Details" bordered size="small" column={3}>
          <Descriptions.Item label="GRN Number">{grn.grnNumber}</Descriptions.Item>
          <Descriptions.Item label="Received Date">{dayjs(grn.receivedDate).format('DD/MM/YYYY')}</Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={statusColors[grn.status]}>{grn.status.toUpperCase()}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Reference #">{grn.referenceNumber ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Supplier">{grn.supplierName ?? grn.supplierId}</Descriptions.Item>
          <Descriptions.Item label="Purchase Order">{grn.purchaseOrderId ?? '—'}</Descriptions.Item>
          {grn.approvedBy && (
            <Descriptions.Item label="Approved At">
              {grn.approvedAt ? dayjs(grn.approvedAt).format('DD/MM/YYYY HH:mm') : '—'}
            </Descriptions.Item>
          )}
          {grn.rejectedBy && (
            <>
              <Descriptions.Item label="Rejected At">
                {grn.rejectedAt ? dayjs(grn.rejectedAt).format('DD/MM/YYYY HH:mm') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Rejection Reason">{grn.rejectionReason ?? '—'}</Descriptions.Item>
            </>
          )}
          {grn.notes && <Descriptions.Item label="Notes" span={3}>{grn.notes}</Descriptions.Item>}
        </Descriptions>
      </Card>

      <Card>
        <Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>Received Items</Title>
        <Table
          dataSource={grn.items ?? []}
          columns={itemColumns}
          rowKey="id"
          pagination={false}
          size="small"
          scroll={{ x: 900 }}
          summary={() => {
            const items = grn.items ?? [];
            const totalReturned = items.reduce((s: number, r: any) => s + Number(r.returnedQty ?? 0), 0);
            const totalNet = items.reduce((s: number, r: any) => s + Number(r.netQty ?? 0), 0);
            // cols: # | Product | Qty | Returned(GRUN) | Net in Stock | Unit Cost | Line Total | Batch # | Notes
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={3} align="right">
                  <Text strong>Total</Text>
                </Table.Summary.Cell>
                {/* Returned (GRUN) */}
                <Table.Summary.Cell index={1} align="right">
                  {totalReturned > 0
                    ? <Text strong style={{ color: '#d46b08' }}>{totalReturned}</Text>
                    : <Text type="secondary">0</Text>}
                </Table.Summary.Cell>
                {/* Net in Stock */}
                <Table.Summary.Cell index={2} align="right">
                  <Text strong style={{ color: '#1677ff' }}>{totalNet}</Text>
                </Table.Summary.Cell>
                {/* Unit Cost — no total */}
                <Table.Summary.Cell index={3} />
                {/* Line Total */}
                <Table.Summary.Cell index={4} align="right">
                  <Text strong style={{ color: '#1677ff' }}>
                    LKR {items.reduce((s: number, r: any) => s + Number(r.lineTotal), 0)
                      .toLocaleString('en-LK', { minimumFractionDigits: 2 })}
                  </Text>
                </Table.Summary.Cell>
                {/* Batch # | Notes */}
                <Table.Summary.Cell index={5} colSpan={2} />
              </Table.Summary.Row>
            );
          }}
        />
      </Card>
    </div>
  );
}
