import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Descriptions, Table, Tag, Button, Space, Card, Popconfirm,
  message, Typography, Spin, Row, Col, Statistic,
} from 'antd';
import { ArrowLeftOutlined, CheckOutlined, CloseOutlined, SendOutlined } from '@ant-design/icons';
import { getGrun, submitGrun, approveGrun, rejectGrun } from '../../api/grun';
import { getProducts } from '../../api/products';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const statusColors: Record<string, string> = {
  draft: 'default', submitted: 'blue', approved: 'green', rejected: 'red',
};

const conditionColors: Record<string, string> = {
  damaged: 'red', expired: 'orange', wrong_item: 'purple',
  excess: 'cyan', quality_issue: 'volcano',
};

export default function GrunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [grun, setGrun] = useState<any>(null);
  const [productMap, setProductMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [grunRes, prodRes] = await Promise.all([
        getGrun(id!),
        getProducts({ limit: 500 }),
      ]);
      setGrun(grunRes.data);
      const map: Record<string, any> = {};
      for (const p of prodRes.data.items ?? []) map[p.id] = p;
      setProductMap(map);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleSubmit = async () => { await submitGrun(id!); message.success('GRUN submitted'); load(); };
  const handleApprove = async () => { await approveGrun(id!); message.success('GRUN approved — stock reduced'); load(); };
  const handleReject = async () => { await rejectGrun(id!, 'Rejected'); message.success('GRUN rejected'); load(); };

  if (loading) return <Spin style={{ display: 'block', marginTop: 80, textAlign: 'center' }} />;
  if (!grun) return <div>GRUN not found.</div>;

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
    { title: 'Return Qty', dataIndex: 'returnQty', key: 'returnQty', align: 'right' as const,
      render: (v: any) => <Text strong style={{ color: '#cf1322' }}>{v}</Text> },
    { title: 'Unit Cost (LKR)', dataIndex: 'unitCost', key: 'unitCost', align: 'right' as const,
      render: (v: any) => Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 }) },
    { title: 'Line Total (LKR)', dataIndex: 'lineTotal', key: 'lineTotal', align: 'right' as const,
      render: (v: any) => <Text strong>{Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</Text> },
    { title: 'Condition', dataIndex: 'itemCondition', key: 'itemCondition',
      render: (v: string) => v ? <Tag color={conditionColors[v] ?? 'default'}>{v.replace('_', ' ').toUpperCase()}</Tag> : '—' },
    { title: 'GRN Item Ref', dataIndex: 'grnItemId', key: 'grnItemId', ellipsis: true,
      render: (v: any) => v ? <Text code style={{ fontSize: 11 }}>{v}</Text> : '—' },
    { title: 'Notes', dataIndex: 'notes', key: 'notes', render: (v: any) => v ?? '—' },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/grun')}>Back to GRUN List</Button>
      </Space>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          GRUN: {grun.grunNumber}&nbsp;
          <Tag color={statusColors[grun.status]} style={{ fontSize: 13 }}>{grun.status.toUpperCase()}</Tag>
        </Title>
        <Space>
          {grun.status === 'draft' && (
            <Button icon={<SendOutlined />} onClick={handleSubmit}>Submit</Button>
          )}
          {grun.status === 'submitted' && (
            <>
              <Popconfirm title="Approve GRUN? This will reduce stock." onConfirm={handleApprove}>
                <Button type="primary" icon={<CheckOutlined />}>Approve</Button>
              </Popconfirm>
              <Popconfirm title="Reject this GRUN?" onConfirm={handleReject}>
                <Button danger icon={<CloseOutlined />}>Reject</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="Total Return Value (LKR)" value={Number(grun.totalCost).toLocaleString('en-LK', { minimumFractionDigits: 2 })} valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Total Return Qty" value={Number(grun.totalQuantity)} valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Line Items" value={grun.items?.length ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Return Date" value={dayjs(grun.returnDate).format('DD MMM YYYY')} />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Descriptions title="GRUN Details" bordered size="small" column={3}>
          <Descriptions.Item label="GRUN Number">{grun.grunNumber}</Descriptions.Item>
          <Descriptions.Item label="Return Date">{dayjs(grun.returnDate).format('DD/MM/YYYY')}</Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={statusColors[grun.status]}>{grun.status.toUpperCase()}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Type">
            <Tag>{grun.grunType === 'from_grn' ? 'From GRN' : 'Standalone'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Supplier">{grun.supplierName ?? grun.supplierId}</Descriptions.Item>
          {grun.grnId && (
            <Descriptions.Item label="Linked GRN">
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/grn/${grun.grnId}`)}>
                View GRN
              </Button>
            </Descriptions.Item>
          )}
          {grun.returnReason && (
            <Descriptions.Item label="Return Reason" span={3}>{grun.returnReason}</Descriptions.Item>
          )}
          {grun.supplierCreditNote && (
            <Descriptions.Item label="Supplier Credit Note">{grun.supplierCreditNote}</Descriptions.Item>
          )}
          {grun.approvedBy && (
            <Descriptions.Item label="Approved At">
              {grun.approvedAt ? dayjs(grun.approvedAt).format('DD/MM/YYYY HH:mm') : '—'}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      <Card>
        <Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>Return Items</Title>
        <Table
          dataSource={grun.items ?? []}
          columns={itemColumns}
          rowKey="id"
          pagination={false}
          size="small"
          scroll={{ x: 800 }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4} align="right">
                <Text strong>Total</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <Text strong style={{ color: '#cf1322' }}>
                  LKR {(grun.items ?? []).reduce((s: number, r: any) => s + Number(r.lineTotal), 0)
                    .toLocaleString('en-LK', { minimumFractionDigits: 2 })}
                </Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} colSpan={3} />
            </Table.Summary.Row>
          )}
        />
      </Card>
    </div>
  );
}
