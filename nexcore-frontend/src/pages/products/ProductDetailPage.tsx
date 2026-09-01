import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Descriptions, Table, Tag, Button, Space, Typography,
  Spin, Row, Col, Statistic, Tabs, Progress,
} from 'antd';
import { ArrowLeftOutlined, EditOutlined } from '@ant-design/icons';
import { getProductAvailability } from '../../api/products';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const grnStatusColors: Record<string, string> = {
  draft: 'default', submitted: 'blue', approved: 'green', rejected: 'red', partial: 'orange',
};
const grunStatusColors: Record<string, string> = {
  draft: 'default', submitted: 'blue', approved: 'green', rejected: 'red',
};
const conditionColors: Record<string, string> = {
  damaged: 'red', expired: 'orange', wrong_item: 'purple',
  excess: 'cyan', quality_issue: 'volcano',
};

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProductAvailability(id!)
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spin style={{ display: 'block', marginTop: 80, textAlign: 'center' }} />;
  if (!data) return <div>Product not found.</div>;

  const { product, stock, summary, grnHistory, grunHistory } = data;
  const available = Number(stock.qtyOnHand) - Number(stock.qtyReserved);
  const reorderPct = product.reorderLevel > 0
    ? Math.min(100, Math.round((available / product.reorderLevel) * 100))
    : 100;

  const grnColumns = [
    { title: 'GRN #', dataIndex: 'grn_number', key: 'grn_number', width: 180,
      render: (v: string, row: any) => (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/grn/${row.grn_id}`)}>
          {v}
        </Button>
      ),
    },
    { title: 'Received Date', dataIndex: 'received_date', key: 'received_date', width: 120,
      render: (v: any) => dayjs(v).format('DD/MM/YYYY') },
    { title: 'Supplier', dataIndex: 'supplier_name', key: 'supplier_name' },
    { title: 'Received', dataIndex: 'received_qty', key: 'received_qty', align: 'right' as const },
    { title: 'Accepted', dataIndex: 'accepted_qty', key: 'accepted_qty', align: 'right' as const,
      render: (v: any) => <Text strong style={{ color: '#3f8600' }}>{v}</Text> },
    { title: 'Damaged', dataIndex: 'damaged_qty', key: 'damaged_qty', align: 'right' as const,
      render: (v: any) => Number(v) > 0 ? <Text type="danger">{v}</Text> : <Text type="secondary">0</Text> },
    { title: 'Unit Cost (LKR)', dataIndex: 'unit_cost', key: 'unit_cost', align: 'right' as const,
      render: (v: any) => Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 }) },
    { title: 'Line Total (LKR)', dataIndex: 'line_total', key: 'line_total', align: 'right' as const,
      render: (v: any) => <Text strong>{Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</Text> },
    { title: 'Batch #', dataIndex: 'batch_number', key: 'batch_number',
      render: (v: any) => v ?? '—' },
    { title: 'Expiry', dataIndex: 'expiry_date', key: 'expiry_date',
      render: (v: any) => v ? dayjs(v).format('DD/MM/YYYY') : '—' },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => <Tag color={grnStatusColors[v]}>{v.toUpperCase()}</Tag> },
  ];

  const grunColumns = [
    { title: 'GRUN #', dataIndex: 'grun_number', key: 'grun_number', width: 180,
      render: (v: string, row: any) => (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/grun/${row.grun_id}`)}>
          {v}
        </Button>
      ),
    },
    { title: 'Return Date', dataIndex: 'return_date', key: 'return_date', width: 120,
      render: (v: any) => dayjs(v).format('DD/MM/YYYY') },
    { title: 'Supplier', dataIndex: 'supplier_name', key: 'supplier_name' },
    { title: 'Return Qty', dataIndex: 'return_qty', key: 'return_qty', align: 'right' as const,
      render: (v: any) => <Text strong style={{ color: '#cf1322' }}>{v}</Text> },
    { title: 'Unit Cost (LKR)', dataIndex: 'unit_cost', key: 'unit_cost', align: 'right' as const,
      render: (v: any) => Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 }) },
    { title: 'Line Total (LKR)', dataIndex: 'line_total', key: 'line_total', align: 'right' as const,
      render: (v: any) => <Text strong>{Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</Text> },
    { title: 'Condition', dataIndex: 'item_condition', key: 'item_condition',
      render: (v: string) => v
        ? <Tag color={conditionColors[v] ?? 'default'}>{v.replace('_', ' ').toUpperCase()}</Tag>
        : '—' },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => <Tag color={grunStatusColors[v]}>{v.toUpperCase()}</Tag> },
  ];

  const tabItems = [
    {
      key: 'grn',
      label: `GRN Receipts (${grnHistory.length})`,
      children: (
        <Table
          dataSource={grnHistory}
          columns={grnColumns}
          rowKey={(r: any) => r.grn_id + r.accepted_qty}
          pagination={{ pageSize: 10 }}
          size="small"
          scroll={{ x: 900 }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4} align="right">
                <Text strong>Total Accepted</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <Text strong style={{ color: '#3f8600' }}>
                  {grnHistory.reduce((s: number, r: any) => s + Number(r.accepted_qty), 0)}
                </Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} colSpan={6} />
            </Table.Summary.Row>
          )}
        />
      ),
    },
    {
      key: 'grun',
      label: `GRUN Returns (${grunHistory.length})`,
      children: (
        <Table
          dataSource={grunHistory}
          columns={grunColumns}
          rowKey={(r: any) => r.grun_id + r.return_qty}
          pagination={{ pageSize: 10 }}
          size="small"
          scroll={{ x: 800 }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={3} align="right">
                <Text strong>Total Returned</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <Text strong style={{ color: '#cf1322' }}>
                  {grunHistory.reduce((s: number, r: any) => s + Number(r.return_qty), 0)}
                </Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} colSpan={4} />
            </Table.Summary.Row>
          )}
        />
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/products')}>Back to Products</Button>
      </Space>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            [{product.productCode}] {product.productName}
          </Title>
          <Space style={{ marginTop: 4 }}>
            <Tag color={product.isActive ? 'green' : 'red'}>{product.isActive ? 'Active' : 'Inactive'}</Tag>
            <Tag>{product.productType?.toUpperCase()}</Tag>
          </Space>
        </div>
        <Button icon={<EditOutlined />} onClick={() => navigate('/products')}>Edit in Products</Button>
      </div>

      {/* Stock availability cards */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={4}>
          <Card>
            <Statistic title="On Hand" value={Number(stock.qtyOnHand)}
              valueStyle={{ color: Number(stock.qtyOnHand) > 0 ? '#3f8600' : '#cf1322' }} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="Reserved" value={Number(stock.qtyReserved)}
              valueStyle={{ color: Number(stock.qtyReserved) > 0 ? '#d46b08' : undefined }} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="Available" value={available}
              valueStyle={{ color: available <= Number(product.reorderLevel) ? '#cf1322' : '#3f8600' }} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="On Order" value={Number(stock.qtyOnOrder)}
              valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="Total GRN Received" value={summary.totalReceived} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="Total GRUN Returned" value={summary.totalReturned}
              valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
      </Row>

      {/* Reorder level indicator */}
      {product.reorderLevel > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text>Stock vs Reorder Level ({product.reorderLevel})</Text>
            <Text strong style={{ color: available <= Number(product.reorderLevel) ? '#cf1322' : '#3f8600' }}>
              {available <= Number(product.reorderLevel) ? 'REORDER REQUIRED' : 'OK'}
            </Text>
          </div>
          <Progress
            percent={reorderPct}
            strokeColor={available <= Number(product.reorderLevel) ? '#cf1322' : '#3f8600'}
            format={() => `${available} / ${product.reorderLevel}`}
          />
        </Card>
      )}

      {/* Product details */}
      <Card style={{ marginBottom: 16 }}>
        <Descriptions title="Product Details" bordered size="small" column={4}>
          <Descriptions.Item label="Product Code">{product.productCode}</Descriptions.Item>
          <Descriptions.Item label="Barcode">{product.barcode ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Type"><Tag>{product.productType}</Tag></Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={product.isActive ? 'green' : 'red'}>{product.isActive ? 'Active' : 'Inactive'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Cost Price">
            LKR {Number(product.costPrice).toLocaleString('en-LK', { minimumFractionDigits: 2 })}
          </Descriptions.Item>
          <Descriptions.Item label="Selling Price">
            LKR {Number(product.sellingPrice).toLocaleString('en-LK', { minimumFractionDigits: 2 })}
          </Descriptions.Item>
          <Descriptions.Item label="Tax %">{product.taxPercentage}%</Descriptions.Item>
          <Descriptions.Item label="Reorder Level">{product.reorderLevel}</Descriptions.Item>
          {product.description && (
            <Descriptions.Item label="Description" span={4}>{product.description}</Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* GRN / GRUN history tabs */}
      <Card>
        <Tabs items={tabItems} />
      </Card>
    </div>
  );
}
