import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Form, Input, DatePicker, Select, Button, Card, Table, InputNumber,
  Space, Typography, message, Divider, Tag, Tooltip, Row, Col,
} from 'antd';
import { ArrowLeftOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { createGrn, getSuppliers } from '../../api/grn';
import { getProducts } from '../../api/products';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { Option } = Select;

interface GrnLineItem {
  key: string;
  productId: string;
  productCode?: string;
  productName?: string;
  costPrice?: number;
  qty: number;
  unitCost: number;
  batchNumber?: string;
  expiryDate?: dayjs.Dayjs | null;
}

export default function GrnCreatePage() {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [items, setItems] = useState<GrnLineItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getSuppliers().then(r => setSuppliers(r.data ?? []));
    getProducts({ limit: 500 }).then(r => setProducts(r.data.items ?? []));
  }, []);

  const addItem = () => {
    setItems(prev => [...prev, {
      key: crypto.randomUUID(),
      productId: '',
      qty: 1,
      unitCost: 0,
    }]);
  };

  const updateItem = (key: string, field: keyof GrnLineItem, value: any) => {
    setItems(prev => prev.map(item => item.key !== key ? item : { ...item, [field]: value }));
  };

  const removeItem = (key: string) => setItems(prev => prev.filter(i => i.key !== key));

  const lineTotal = (item: GrnLineItem) => Number(item.qty) * Number(item.unitCost);

  const totalCost = items.reduce((s, i) => s + lineTotal(i), 0);
  const totalQty = items.reduce((s, i) => s + Number(i.qty), 0);

  const handleSubmit = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }

    const validItems = items.filter(i => i.productId);
    if (validItems.length === 0) {
      message.error('Add at least one item before creating the GRN.');
      return;
    }

    const values = form.getFieldsValue();

    const payload = {
      supplierId: values.supplierId,
      referenceNumber: values.referenceNumber || undefined,
      receivedDate: values.receivedDate.format('YYYY-MM-DD'),
      notes: values.notes || undefined,
      items: validItems.map(i => ({
        productId: i.productId,
        orderedQty: Number(i.qty),
        receivedQty: Number(i.qty),
        acceptedQty: Number(i.qty),
        damagedQty: 0,
        unitCost: Number(i.unitCost),
        batchNumber: i.batchNumber || undefined,
        expiryDate: i.expiryDate ? i.expiryDate.format('YYYY-MM-DD') : undefined,
      })),
    };

    setSubmitting(true);
    try {
      const res = await createGrn(payload);
      message.success(`GRN ${res.data.grnNumber} created successfully`);
      navigate(`/grn/${res.data.id}`);
    } catch (err: any) {
      message.error(err?.response?.data?.message ?? 'Failed to create GRN');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      title: 'Product', key: 'productId', width: 240,
      render: (_: any, row: GrnLineItem) => (
        <Select
          showSearch placeholder="Select product" style={{ width: 230 }}
          value={row.productId || undefined}
          optionFilterProp="children"
          onChange={v => {
            const prod = products.find((p: any) => p.id === v);
            updateItem(row.key, 'productId', v);
            if (prod) updateItem(row.key, 'unitCost', Number(prod.costPrice));
          }}
        >
          {products.map((p: any) => (
            <Option key={p.id} value={p.id}>
              {p.productName} <Text type="secondary">({p.productCode})</Text>
            </Option>
          ))}
        </Select>
      ),
    },
    {
      title: 'Qty', key: 'qty', width: 100,
      render: (_: any, row: GrnLineItem) => (
        <InputNumber
          min={1} value={row.qty} style={{ width: 85 }}
          onChange={v => updateItem(row.key, 'qty', v ?? 1)}
        />
      ),
    },
    {
      title: 'Unit Cost (LKR)', key: 'unitCost', width: 140,
      render: (_: any, row: GrnLineItem) => (
        <InputNumber
          min={0} precision={2} value={row.unitCost} style={{ width: 120 }}
          onChange={v => updateItem(row.key, 'unitCost', v ?? 0)}
        />
      ),
    },
    {
      title: 'Line Total (LKR)', key: 'lineTotal', width: 130, align: 'right' as const,
      render: (_: any, row: GrnLineItem) => (
        <Text strong>
          {lineTotal(row).toLocaleString('en-LK', { minimumFractionDigits: 2 })}
        </Text>
      ),
    },
    {
      title: 'Batch #', key: 'batchNumber', width: 130,
      render: (_: any, row: GrnLineItem) => (
        <Input
          placeholder="Optional" value={row.batchNumber}
          style={{ width: 120 }}
          onChange={e => updateItem(row.key, 'batchNumber', e.target.value)}
        />
      ),
    },
    {
      title: 'Expiry Date', key: 'expiryDate', width: 140,
      render: (_: any, row: GrnLineItem) => (
        <DatePicker
          format="DD/MM/YYYY" style={{ width: 130 }}
          value={row.expiryDate ?? null}
          onChange={d => updateItem(row.key, 'expiryDate', d)}
        />
      ),
    },
    {
      title: '', key: 'remove', width: 48,
      render: (_: any, row: GrnLineItem) => (
        <Tooltip title="Remove">
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeItem(row.key)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/grn')}>Back to GRN List</Button>
      </Space>

      <Title level={3} style={{ marginTop: 0, marginBottom: 20 }}>Create Goods Received Note (GRN)</Title>

      <Card style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical" initialValues={{ receivedDate: dayjs() }}>
          <Row gutter={24}>
            <Col span={6}>
              <Form.Item name="supplierId" label="Supplier" rules={[{ required: true, message: 'Select a supplier' }]}>
                <Select showSearch placeholder="Select supplier" optionFilterProp="children">
                  {suppliers.map((s: any) => (
                    <Option key={s.id} value={s.id}>{s.supplierName}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="receivedDate" label="Received Date" rules={[{ required: true, message: 'Select a date' }]}>
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="referenceNumber" label="Reference # (PO / Invoice)">
                <Input placeholder="Supplier invoice or PO number" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="notes" label="Notes">
                <Input placeholder="Optional delivery notes" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Title level={5} style={{ margin: 0 }}>
            Items
            {items.length > 0 && (
              <Space style={{ marginLeft: 12 }}>
                <Tag color="blue">{items.filter(i => i.productId).length} lines</Tag>
                <Tag color="green">Qty: {totalQty}</Tag>
                <Tag color="purple">
                  Total: LKR {totalCost.toLocaleString('en-LK', { minimumFractionDigits: 2 })}
                </Tag>
              </Space>
            )}
          </Title>
          <Button type="primary" icon={<PlusOutlined />} onClick={addItem}>Add Item</Button>
        </div>

        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#aaa' }}>
            <p>No items added yet.</p>
            <Button icon={<PlusOutlined />} onClick={addItem}>Add First Item</Button>
          </div>
        ) : (
          <Table
            dataSource={items}
            columns={columns}
            rowKey="key"
            pagination={false}
            size="small"
            scroll={{ x: 900 }}
            summary={() => (
              <Table.Summary.Row>
                {/* Product | Qty → "Totals" label */}
                <Table.Summary.Cell index={0} colSpan={2} align="right">
                  <Text strong>Totals</Text>
                </Table.Summary.Cell>
                {/* Unit Cost — empty */}
                <Table.Summary.Cell index={1} />
                {/* Line Total */}
                <Table.Summary.Cell index={2} align="right">
                  <Text strong style={{ color: '#1677ff' }}>
                    LKR {totalCost.toLocaleString('en-LK', { minimumFractionDigits: 2 })}
                  </Text>
                </Table.Summary.Cell>
                {/* Batch # | Expiry Date | Remove */}
                <Table.Summary.Cell index={3} colSpan={3} />
              </Table.Summary.Row>
            )}
          />
        )}

        <Divider />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Button onClick={() => navigate('/grn')}>Cancel</Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={items.filter(i => i.productId).length === 0}
            onClick={handleSubmit}
          >
            Create GRN (Draft)
          </Button>
        </div>
      </Card>
    </div>
  );
}
