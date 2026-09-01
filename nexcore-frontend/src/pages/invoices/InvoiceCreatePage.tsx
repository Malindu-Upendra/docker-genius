import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Form, Input, DatePicker, Select, Button, Card, Table, InputNumber,
  Space, Typography, message, Divider, Tag, Tooltip, Row, Col,
} from 'antd';
import { ArrowLeftOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { createInvoice } from '../../api/invoices';
import { getClients } from '../../api/clients';
import { getProducts } from '../../api/products';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { Option } = Select;

interface InvoiceLineItem {
  key: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPercentage: number;
  taxPercentage: number;
}

const lineNet = (item: InvoiceLineItem) => {
  const gross = item.quantity * item.unitPrice;
  const disc = gross * (item.discountPercentage / 100);
  const tax = (gross - disc) * (item.taxPercentage / 100);
  return gross - disc + tax;
};

export default function InvoiceCreatePage() {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [clients, setClients] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [items, setItems] = useState<InvoiceLineItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getClients({ limit: 500 }).then(r => setClients(r.data.items ?? []));
    getProducts({ limit: 500 }).then(r => setProducts(r.data.items ?? []));
  }, []);

  const addItem = () => {
    setItems(prev => [...prev, {
      key: crypto.randomUUID(),
      productId: '', quantity: 1, unitPrice: 0, discountPercentage: 0, taxPercentage: 0,
    }]);
  };

  const updateItem = (key: string, field: keyof InvoiceLineItem, value: any) => {
    setItems(prev => prev.map(i => i.key !== key ? i : { ...i, [field]: value }));
  };

  const removeItem = (key: string) => setItems(prev => prev.filter(i => i.key !== key));

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const headerDiscount = Number(form.getFieldValue('discountAmount') ?? 0);
  const totalTax = items.reduce((s, i) => {
    const gross = i.quantity * i.unitPrice;
    const disc = gross * (i.discountPercentage / 100);
    return s + (gross - disc) * (i.taxPercentage / 100);
  }, 0);
  const totalAmount = subtotal - headerDiscount + totalTax;

  const handleSubmit = async () => {
    try { await form.validateFields(); } catch { return; }
    const validItems = items.filter(i => i.productId);
    if (validItems.length === 0) {
      message.error('Add at least one item.');
      return;
    }
    const values = form.getFieldsValue();
    const payload = {
      clientId: values.clientId,
      invoiceDate: values.invoiceDate.format('YYYY-MM-DD'),
      dueDate: values.dueDate ? values.dueDate.format('YYYY-MM-DD') : undefined,
      notes: values.notes || undefined,
      discountAmount: Number(values.discountAmount ?? 0),
      items: validItems.map(i => ({
        productId: i.productId,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        discountPercentage: Number(i.discountPercentage),
        taxPercentage: Number(i.taxPercentage),
      })),
    };
    setSubmitting(true);
    try {
      const res = await createInvoice(payload);
      message.success(`Invoice ${res.data.invoiceNumber} created`);
      navigate(`/invoices/${res.data.id}`);
    } catch (err: any) {
      message.error(err?.response?.data?.message ?? 'Failed to create invoice');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      title: 'Product', key: 'productId', width: 260,
      render: (_: any, row: InvoiceLineItem) => (
        <Select
          showSearch placeholder="Select product" style={{ width: 250 }}
          value={row.productId || undefined}
          optionFilterProp="children"
          onChange={v => {
            const prod = products.find((p: any) => p.id === v);
            updateItem(row.key, 'productId', v);
            if (prod) {
              updateItem(row.key, 'unitPrice', Number(prod.sellingPrice));
              updateItem(row.key, 'taxPercentage', Number(prod.taxPercentage ?? 0));
            }
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
      title: 'Qty', key: 'quantity', width: 90,
      render: (_: any, row: InvoiceLineItem) => (
        <InputNumber min={1} value={row.quantity} style={{ width: 80 }}
          onChange={v => updateItem(row.key, 'quantity', v ?? 1)} />
      ),
    },
    {
      title: 'Unit Price (LKR)', key: 'unitPrice', width: 140,
      render: (_: any, row: InvoiceLineItem) => (
        <InputNumber min={0} precision={2} value={row.unitPrice} style={{ width: 125 }}
          onChange={v => updateItem(row.key, 'unitPrice', v ?? 0)} />
      ),
    },
    {
      title: 'Disc %', key: 'discountPercentage', width: 90,
      render: (_: any, row: InvoiceLineItem) => (
        <InputNumber min={0} max={100} precision={2} value={row.discountPercentage} style={{ width: 80 }}
          onChange={v => updateItem(row.key, 'discountPercentage', v ?? 0)} />
      ),
    },
    {
      title: 'Tax %', key: 'taxPercentage', width: 90,
      render: (_: any, row: InvoiceLineItem) => (
        <InputNumber min={0} max={100} precision={2} value={row.taxPercentage} style={{ width: 80 }}
          onChange={v => updateItem(row.key, 'taxPercentage', v ?? 0)} />
      ),
    },
    {
      title: 'Line Total (LKR)', key: 'lineTotal', width: 130, align: 'right' as const,
      render: (_: any, row: InvoiceLineItem) => (
        <Text strong>{lineNet(row).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</Text>
      ),
    },
    {
      title: '', key: 'remove', width: 48,
      render: (_: any, row: InvoiceLineItem) => (
        <Tooltip title="Remove">
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeItem(row.key)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/invoices')}>Back to Invoices</Button>
      </Space>

      <Title level={3} style={{ marginTop: 0, marginBottom: 20 }}>Create Invoice</Title>

      <Card style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical" initialValues={{ invoiceDate: dayjs() }}>
          <Row gutter={24}>
            <Col span={7}>
              <Form.Item name="clientId" label="Client" rules={[{ required: true, message: 'Select a client' }]}>
                <Select showSearch placeholder="Select client" optionFilterProp="children">
                  {clients.map((c: any) => (
                    <Option key={c.id} value={c.id}>{c.clientName}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="invoiceDate" label="Invoice Date" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="dueDate" label="Due Date">
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="discountAmount" label="Header Discount (LKR)">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="notes" label="Notes">
                <Input placeholder="Optional" />
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
                <Tag color="purple">
                  Total: LKR {totalAmount.toLocaleString('en-LK', { minimumFractionDigits: 2 })}
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
                <Table.Summary.Cell index={0} colSpan={5} align="right">
                  <Text strong>Total</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Text strong style={{ color: '#1677ff' }}>
                    LKR {totalAmount.toLocaleString('en-LK', { minimumFractionDigits: 2 })}
                  </Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} />
              </Table.Summary.Row>
            )}
          />
        )}

        <Divider />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Button onClick={() => navigate('/invoices')}>Cancel</Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={items.filter(i => i.productId).length === 0}
            onClick={handleSubmit}
          >
            Create Invoice (Draft)
          </Button>
        </div>
      </Card>
    </div>
  );
}
