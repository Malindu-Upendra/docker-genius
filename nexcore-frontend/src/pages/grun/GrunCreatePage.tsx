import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Form, Input, DatePicker, Select, Button, Card, Table, InputNumber,
  Space, Typography, message, Radio, Divider, Tag, Tooltip,
} from 'antd';
import { ArrowLeftOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { createGrun } from '../../api/grun';
import { getGrns, getGrn, getSuppliers } from '../../api/grn';
import { getProducts } from '../../api/products';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { Option } = Select;

const CONDITIONS = [
  { value: 'damaged',       label: 'Damaged' },
  { value: 'expired',       label: 'Expired' },
  { value: 'wrong_item',    label: 'Wrong Item' },
  { value: 'excess',        label: 'Excess' },
  { value: 'quality_issue', label: 'Quality Issue' },
];

type GrunType = 'from_grn' | 'standalone';

interface ReturnItem {
  key: string;
  grnItemId?: string;
  productId: string;
  productName?: string;
  availableQty?: number;
  returnQty: number;
  unitCost: number;
  itemCondition?: string;
  notes?: string;
}

export default function GrunCreatePage() {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [grunType, setGrunType] = useState<GrunType>('from_grn');
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [grns, setGrns] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedGrn, setSelectedGrn] = useState<any>(null);
  const [grnLoading, setGrnLoading] = useState(false);
  const [items, setItems] = useState<ReturnItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getSuppliers().then(r => setSuppliers(r.data ?? []));
    getGrns({ page: 1, limit: 200, status: 'approved' }).then(r => setGrns(r.data.items ?? []));
    getProducts({ limit: 500 }).then(r => setProducts(r.data.items ?? []));
  }, []);

  const handleGrnSelect = async (grnId: string) => {
    setGrnLoading(true);
    setItems([]);
    try {
      const res = await getGrn(grnId);
      const grn = res.data;
      setSelectedGrn(grn);
      form.setFieldValue('supplierId', grn.supplierId);
      // Pre-populate items from GRN
      const preItems: ReturnItem[] = (grn.items ?? []).map((item: any) => ({
        key: item.id,
        grnItemId: item.id,
        productId: item.productId,
        productName: item.productId,
        availableQty: Number(item.netQty ?? item.qty ?? 0),
        returnQty: 0,
        unitCost: Number(item.unitCost),
        itemCondition: undefined,
      }));
      setItems(preItems);
    } finally {
      setGrnLoading(false);
    }
  };

  const addStandaloneItem = () => {
    setItems(prev => [...prev, {
      key: crypto.randomUUID(),
      productId: '',
      returnQty: 1,
      unitCost: 0,
      itemCondition: undefined,
    }]);
  };

  const updateItem = (key: string, field: keyof ReturnItem, value: any) => {
    setItems(prev => prev.map(item => item.key === key ? { ...item, [field]: value } : item));
  };

  const removeItem = (key: string) => {
    setItems(prev => prev.filter(item => item.key !== key));
  };

  const activeItems = items.filter(i => i.returnQty > 0 && i.productId);

  const handleSubmit = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }

    if (activeItems.length === 0) {
      message.error('Add at least one item with a return quantity greater than 0.');
      return;
    }

    const values = form.getFieldsValue();

    const payload = {
      grnId: grunType === 'from_grn' ? values.grnId : undefined,
      supplierId: values.supplierId,
      returnDate: values.returnDate.format('YYYY-MM-DD'),
      returnReason: values.returnReason,
      items: activeItems.map(i => ({
        grnItemId: i.grnItemId ?? undefined,
        productId: i.productId,
        returnQty: i.returnQty,
        unitCost: i.unitCost,
        itemCondition: i.itemCondition ?? undefined,
        notes: i.notes ?? undefined,
      })),
    };

    setSubmitting(true);
    try {
      const res = await createGrun(payload);
      message.success(`GRUN ${res.data.grunNumber} created successfully`);
      navigate('/grun');
    } catch (err: any) {
      message.error(err?.response?.data?.message ?? 'Failed to create GRUN');
    } finally {
      setSubmitting(false);
    }
  };

  const totalReturnValue = activeItems.reduce((s, i) => s + i.returnQty * i.unitCost, 0);

  // Columns for from_grn mode — fixed rows, just fill qty
  const grnItemColumns = [
    { title: 'Product', dataIndex: 'productId', key: 'productId', width: 240,
      render: (v: string) => {
        const p = products.find((pr: any) => pr.id === v);
        return p
          ? <><Text strong>{p.productCode}</Text> — {p.productName}</>
          : <Text code style={{ fontSize: 11 }}>{v}</Text>;
      },
    },
    { title: 'Available Qty', dataIndex: 'availableQty', key: 'availableQty', width: 110, align: 'right' as const },
    { title: 'Return Qty', key: 'returnQty', width: 120,
      render: (_: any, row: ReturnItem) => (
        <InputNumber
          min={0} max={row.availableQty ?? 9999} value={row.returnQty}
          style={{ width: 90 }}
          onChange={v => updateItem(row.key, 'returnQty', v ?? 0)}
        />
      ),
    },
    { title: 'Unit Cost (LKR)', key: 'unitCost', width: 130,
      render: (_: any, row: ReturnItem) => (
        <InputNumber
          min={0} precision={2} value={row.unitCost} style={{ width: 110 }}
          onChange={v => updateItem(row.key, 'unitCost', v ?? 0)}
        />
      ),
    },
    { title: 'Line Total (LKR)', key: 'lineTotal', width: 130, align: 'right' as const,
      render: (_: any, row: ReturnItem) => (
        <Text strong style={{ color: row.returnQty > 0 ? '#cf1322' : undefined }}>
          {(row.returnQty * row.unitCost).toLocaleString('en-LK', { minimumFractionDigits: 2 })}
        </Text>
      ),
    },
    { title: 'Condition', key: 'itemCondition', width: 160,
      render: (_: any, row: ReturnItem) => (
        <Select
          allowClear placeholder="Select" style={{ width: 150 }}
          value={row.itemCondition}
          onChange={v => updateItem(row.key, 'itemCondition', v)}
        >
          {CONDITIONS.map(c => <Option key={c.value} value={c.value}>{c.label}</Option>)}
        </Select>
      ),
    },
    { title: 'Notes', key: 'notes', width: 160,
      render: (_: any, row: ReturnItem) => (
        <Input
          placeholder="Optional" value={row.notes}
          onChange={e => updateItem(row.key, 'notes', e.target.value)}
        />
      ),
    },
  ];

  // Columns for standalone mode — add/remove rows, pick product
  const standaloneColumns = [
    { title: 'Product', key: 'productId', width: 220,
      render: (_: any, row: ReturnItem) => (
        <Select
          showSearch placeholder="Select product" style={{ width: 210 }}
          value={row.productId || undefined}
          optionFilterProp="children"
          onChange={v => {
            const prod = products.find((p: any) => p.id === v);
            updateItem(row.key, 'productId', v);
            if (prod) updateItem(row.key, 'unitCost', Number(prod.costPrice));
          }}
        >
          {products.map((p: any) => (
            <Option key={p.id} value={p.id}>{p.productName} ({p.productCode})</Option>
          ))}
        </Select>
      ),
    },
    { title: 'Return Qty', key: 'returnQty', width: 110,
      render: (_: any, row: ReturnItem) => (
        <InputNumber min={1} value={row.returnQty} style={{ width: 90 }}
          onChange={v => updateItem(row.key, 'returnQty', v ?? 1)} />
      ),
    },
    { title: 'Unit Cost (LKR)', key: 'unitCost', width: 130,
      render: (_: any, row: ReturnItem) => (
        <InputNumber min={0} precision={2} value={row.unitCost} style={{ width: 110 }}
          onChange={v => updateItem(row.key, 'unitCost', v ?? 0)} />
      ),
    },
    { title: 'Line Total (LKR)', key: 'lineTotal', width: 130, align: 'right' as const,
      render: (_: any, row: ReturnItem) => (
        <Text strong style={{ color: '#cf1322' }}>
          {(row.returnQty * row.unitCost).toLocaleString('en-LK', { minimumFractionDigits: 2 })}
        </Text>
      ),
    },
    { title: 'Condition', key: 'itemCondition', width: 160,
      render: (_: any, row: ReturnItem) => (
        <Select allowClear placeholder="Select" style={{ width: 150 }}
          value={row.itemCondition}
          onChange={v => updateItem(row.key, 'itemCondition', v)}>
          {CONDITIONS.map(c => <Option key={c.value} value={c.value}>{c.label}</Option>)}
        </Select>
      ),
    },
    { title: 'Notes', key: 'notes', width: 160,
      render: (_: any, row: ReturnItem) => (
        <Input placeholder="Optional" value={row.notes}
          onChange={e => updateItem(row.key, 'notes', e.target.value)} />
      ),
    },
    { title: '', key: 'remove', width: 48,
      render: (_: any, row: ReturnItem) => (
        <Tooltip title="Remove">
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeItem(row.key)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/grun')}>Back to GRUN List</Button>
      </Space>

      <Title level={3} style={{ marginTop: 0, marginBottom: 20 }}>Create Goods Return Note (GRUN)</Title>

      <Card style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical" initialValues={{ returnDate: dayjs() }}>

          <Form.Item label="Return Type" required>
            <Radio.Group
              value={grunType}
              onChange={e => {
                setGrunType(e.target.value);
                setItems([]);
                setSelectedGrn(null);
                form.resetFields(['grnId', 'supplierId']);
              }}
            >
              <Radio.Button value="from_grn">From an Approved GRN</Radio.Button>
              <Radio.Button value="standalone">Standalone Return</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 24px' }}>
            {grunType === 'from_grn' && (
              <Form.Item name="grnId" label="Source GRN" rules={[{ required: true, message: 'Select a GRN' }]}>
                <Select
                  showSearch placeholder="Select approved GRN" optionFilterProp="children"
                  loading={grnLoading}
                  onChange={handleGrnSelect}
                >
                  {grns.map((g: any) => (
                    <Option key={g.id} value={g.id}>
                      {g.grnNumber} — {dayjs(g.receivedDate).format('DD/MM/YYYY')}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            )}

            <Form.Item name="supplierId" label="Supplier" rules={[{ required: true, message: 'Select a supplier' }]}>
              <Select
                showSearch placeholder="Select supplier" optionFilterProp="children"
                disabled={grunType === 'from_grn' && !!selectedGrn}
              >
                {suppliers.map((s: any) => (
                  <Option key={s.id} value={s.id}>{s.supplierName}</Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item name="returnDate" label="Return Date" rules={[{ required: true, message: 'Select a date' }]}>
              <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
            </Form.Item>

            <Form.Item name="returnReason" label="Return Reason" rules={[{ required: true, message: 'Enter a reason' }]}>
              <Input placeholder="e.g. Damaged goods received" />
            </Form.Item>
          </div>
        </Form>
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Title level={5} style={{ margin: 0 }}>
            Return Items
            {activeItems.length > 0 && (
              <Tag color="red" style={{ marginLeft: 8 }}>
                Total: LKR {totalReturnValue.toLocaleString('en-LK', { minimumFractionDigits: 2 })}
              </Tag>
            )}
          </Title>
          {grunType === 'standalone' && (
            <Button icon={<PlusOutlined />} onClick={addStandaloneItem}>Add Item</Button>
          )}
        </div>

        {grunType === 'from_grn' && !selectedGrn && (
          <Text type="secondary">Select a GRN above to load its items.</Text>
        )}

        {grunType === 'from_grn' && selectedGrn && (
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              Set <strong>Return Qty</strong> to 0 on lines you do not want to return.
            </Text>
            <Table
              dataSource={items}
              columns={grnItemColumns}
              rowKey="key"
              pagination={false}
              size="small"
              loading={grnLoading}
              scroll={{ x: 900 }}
              rowClassName={(row: ReturnItem) => row.returnQty > 0 ? '' : 'ant-table-row-disabled'}
            />
          </>
        )}

        {grunType === 'standalone' && (
          <>
            {items.length === 0
              ? <Text type="secondary">Click "Add Item" to add products to return.</Text>
              : <Table dataSource={items} columns={standaloneColumns} rowKey="key"
                  pagination={false} size="small" scroll={{ x: 900 }} />}
          </>
        )}

        <Divider />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Button onClick={() => navigate('/grun')}>Cancel</Button>
          <Button type="primary" loading={submitting} onClick={handleSubmit}
            disabled={activeItems.length === 0}>
            Create GRUN
          </Button>
        </div>
      </Card>
    </div>
  );
}
