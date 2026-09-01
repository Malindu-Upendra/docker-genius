import { useEffect, useState } from 'react';
import { Table, Button, Input, Space, Tag, Modal, Form, InputNumber, message, Typography, Popconfirm } from 'antd';
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { getClients, createClient, updateClient, deleteClient } from '../../api/clients';

const { Title } = Typography;

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async (p = page, s = search) => {
    setLoading(true);
    try {
      const res = await getClients({ page: p, limit: 20, search: s || undefined });
      setClients(res.data.items ?? []);
      setTotal(res.data.total ?? 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); form.resetFields(); setModalOpen(true); };
  const openEdit = (row: any) => { setEditing(row); form.setFieldsValue(row); setModalOpen(true); };

  const handleSave = async (values: any) => {
    try {
      if (editing) {
        await updateClient(editing.id, values);
        message.success('Client updated');
      } else {
        await createClient(values);
        message.success('Client created');
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      message.error(e.response?.data?.message ?? 'Error saving client');
    }
  };

  const columns = [
    { title: 'Code', dataIndex: 'clientCode', key: 'clientCode', width: 110 },
    { title: 'Name', dataIndex: 'clientName', key: 'clientName' },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { title: 'Phone', dataIndex: 'phone', key: 'phone', width: 130 },
    { title: 'Balance', dataIndex: 'currentBalance', key: 'currentBalance', align: 'right' as const, render: (v: any) => <span style={{ color: Number(v) > 0 ? '#cf1322' : 'inherit' }}>LKR {Number(v).toFixed(2)}</span> },
    { title: 'Credit Limit', dataIndex: 'creditLimit', key: 'creditLimit', align: 'right' as const, render: (v: any) => `LKR ${Number(v).toFixed(2)}` },
    { title: 'Status', dataIndex: 'isActive', key: 'isActive', width: 90, render: (v: any) => <Tag color={v ? 'green' : 'red'}>{v ? 'Active' : 'Inactive'}</Tag> },
    {
      title: 'Actions', key: 'actions', width: 120,
      render: (_: any, row: any) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          <Popconfirm title="Deactivate client?" onConfirm={() => deleteClient(row.id).then(() => { message.success('Deactivated'); load(); })}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Clients</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Add Client</Button>
      </div>

      <Input
        placeholder="Search by name, code or email..."
        prefix={<SearchOutlined />}
        value={search}
        onChange={e => { setSearch(e.target.value); load(1, e.target.value); }}
        style={{ marginBottom: 16, maxWidth: 400 }}
        allowClear
      />

      <Table dataSource={clients} columns={columns} rowKey="id" loading={loading}
        pagination={{ current: page, pageSize: 20, total, onChange: (p) => { setPage(p); load(p); } }}
        size="middle"
      />

      <Modal title={editing ? 'Edit Client' : 'New Client'} open={modalOpen}
        onCancel={() => setModalOpen(false)} onOk={() => form.submit()} width={600} okText="Save">
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="clientCode" label="Client Code" rules={[{ required: true }]}>
            <Input disabled={!!editing} />
          </Form.Item>
          <Form.Item name="clientName" label="Client Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contactPerson" label="Contact Person"><Input /></Form.Item>
          <Space style={{ width: '100%' }} styles={{ item: { flex: 1 } }}>
            <Form.Item name="email" label="Email" style={{ flex: 1 }}><Input type="email" /></Form.Item>
            <Form.Item name="phone" label="Phone" style={{ flex: 1 }}><Input /></Form.Item>
          </Space>
          <Form.Item name="address" label="Address"><Input.TextArea rows={2} /></Form.Item>
          <Space style={{ width: '100%' }} styles={{ item: { flex: 1 } }}>
            <Form.Item name="creditLimit" label="Credit Limit" style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: '100%' }} precision={2} />
            </Form.Item>
            <Form.Item name="taxNumber" label="Tax Number" style={{ flex: 1 }}><Input /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
