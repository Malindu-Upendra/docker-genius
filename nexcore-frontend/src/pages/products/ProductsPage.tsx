import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Input, Space, Tag, Modal, Form, InputNumber, Select, message, Typography, Popconfirm } from 'antd';
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import { getProducts, createProduct, updateProduct, deleteProduct, getCategories, getBrands, getUnits } from '../../api/products';

const { Title } = Typography;
const { Option } = Select;

export default function ProductsPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [form] = Form.useForm();

  const load = async (p = page, s = search) => {
    setLoading(true);
    try {
      const res = await getProducts({ page: p, limit: 20, search: s || undefined });
      setProducts(res.data.items ?? []);
      setTotal(res.data.total ?? 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getCategories().then(r => setCategories(r.data ?? []));
    getBrands().then(r => setBrands(r.data ?? []));
    getUnits().then(r => setUnits(r.data ?? []));
  }, []);

  const openCreate = () => { setEditing(null); form.resetFields(); setModalOpen(true); };
  const openEdit = (row: any) => { setEditing(row); form.setFieldsValue(row); setModalOpen(true); };

  const handleSave = async (values: any) => {
    try {
      if (editing) {
        await updateProduct(editing.id, values);
        message.success('Product updated');
      } else {
        await createProduct(values);
        message.success('Product created');
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      message.error(e.response?.data?.message ?? 'Error saving product');
    }
  };

  const handleDelete = async (id: string) => {
    await deleteProduct(id);
    message.success('Product deactivated');
    load();
  };

  const columns = [
    { title: 'Code', dataIndex: 'productCode', key: 'productCode', width: 110 },
    { title: 'Name', dataIndex: 'productName', key: 'productName' },
    { title: 'Selling Price', dataIndex: 'sellingPrice', key: 'sellingPrice', render: (v: any) => `LKR ${Number(v).toFixed(2)}`, align: 'right' as const },
    { title: 'Cost Price', dataIndex: 'costPrice', key: 'costPrice', render: (v: any) => `LKR ${Number(v).toFixed(2)}`, align: 'right' as const },
    { title: 'Tax %', dataIndex: 'taxPercentage', key: 'taxPercentage', render: (v: any) => `${v}%`, width: 80 },
    { title: 'Status', dataIndex: 'isActive', key: 'isActive', width: 90, render: (v: any) => <Tag color={v ? 'green' : 'red'}>{v ? 'Active' : 'Inactive'}</Tag> },
    {
      title: 'Actions', key: 'actions', width: 130,
      render: (_: any, row: any) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/products/${row.id}`)} />
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          <Popconfirm title="Deactivate this product?" onConfirm={() => handleDelete(row.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Products</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Add Product</Button>
      </div>

      <Input
        placeholder="Search by name, code or barcode..."
        prefix={<SearchOutlined />}
        value={search}
        onChange={e => { setSearch(e.target.value); load(1, e.target.value); }}
        style={{ marginBottom: 16, maxWidth: 400 }}
        allowClear
      />

      <Table
        dataSource={products}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ current: page, pageSize: 20, total, onChange: (p) => { setPage(p); load(p); } }}
        size="middle"
      />

      <Modal
        title={editing ? 'Edit Product' : 'New Product'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        width={600}
        okText="Save"
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="productCode" label="Product Code" rules={[{ required: true }]}>
            <Input disabled={!!editing} />
          </Form.Item>
          <Form.Item name="productName" label="Product Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="barcode" label="Barcode">
            <Input />
          </Form.Item>
          <Form.Item name="categoryId" label="Category">
            <Select allowClear placeholder="Select category">
              {categories.map(c => <Option key={c.id} value={c.id}>{c.categoryName}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="brandId" label="Brand">
            <Select allowClear placeholder="Select brand">
              {brands.map(b => <Option key={b.id} value={b.id}>{b.brandName}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="unitId" label="Unit">
            <Select allowClear placeholder="Select unit">
              {units.map(u => <Option key={u.id} value={u.id}>{u.unitName}</Option>)}
            </Select>
          </Form.Item>
          <Space style={{ width: '100%' }} styles={{ item: { flex: 1 } }}>
            <Form.Item name="costPrice" label="Cost Price" style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: '100%' }} precision={2} />
            </Form.Item>
            <Form.Item name="sellingPrice" label="Selling Price" style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: '100%' }} precision={2} />
            </Form.Item>
            <Form.Item name="taxPercentage" label="Tax %" style={{ flex: 1 }}>
              <InputNumber min={0} max={100} style={{ width: '100%' }} precision={2} />
            </Form.Item>
          </Space>
          <Form.Item name="reorderLevel" label="Reorder Level">
            <InputNumber min={0} style={{ width: '100%' }} precision={2} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
