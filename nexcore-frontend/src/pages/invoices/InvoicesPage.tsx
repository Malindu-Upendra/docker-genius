import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Tag, Space, message, Typography, Popconfirm } from 'antd';
import { PlusOutlined, CheckOutlined, StopOutlined, CopyOutlined, EyeOutlined } from '@ant-design/icons';
import { getInvoices, confirmInvoice, voidInvoice, duplicateInvoice } from '../../api/invoices';

import dayjs from 'dayjs';

const { Title } = Typography;

const statusColors: Record<string, string> = {
  draft: 'default', confirmed: 'blue', partial: 'orange', paid: 'green', void: 'red',
};

export default function InvoicesPage() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const load = async (p = page) => {
    setLoading(true);
    try {
      const res = await getInvoices({ page: p, limit: 20 });
      setInvoices(res.data.items ?? []);
      setTotal(res.data.total ?? 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleConfirm = async (id: string) => {
    await confirmInvoice(id);
    message.success('Invoice confirmed');
    load();
  };

  const handleVoid = async (id: string) => {
    await voidInvoice(id, 'Voided by user');
    message.success('Invoice voided');
    load();
  };

  const handleDuplicate = async (id: string) => {
    await duplicateInvoice(id);
    message.success('Invoice duplicated');
    load();
  };

  const columns = [
    { title: 'Invoice #', dataIndex: 'invoiceNumber', key: 'invoiceNumber', width: 150 },
    { title: 'Client', dataIndex: 'clientName', key: 'clientName', ellipsis: true },
    { title: 'Date', dataIndex: 'invoiceDate', key: 'invoiceDate', width: 110, render: (v: any) => dayjs(v).format('DD/MM/YYYY') },
    { title: 'Due Date', dataIndex: 'dueDate', key: 'dueDate', width: 110, render: (v: any) => v ? dayjs(v).format('DD/MM/YYYY') : '—' },
    { title: 'Total', dataIndex: 'totalAmount', key: 'totalAmount', align: 'right' as const, render: (v: any) => `LKR ${Number(v).toFixed(2)}` },
    { title: 'Balance', dataIndex: 'balanceDue', key: 'balanceDue', align: 'right' as const, render: (v: any) => <span style={{ color: Number(v) > 0 ? '#cf1322' : '#3f8600' }}>LKR {Number(v).toFixed(2)}</span> },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 100, render: (v: string) => <Tag color={statusColors[v]}>{v.toUpperCase()}</Tag> },
    {
      title: 'Actions', key: 'actions', width: 160,
      render: (_: any, row: any) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/invoices/${row.id}`)}>View</Button>
          {row.status === 'draft' && <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleConfirm(row.id)} />}
          {['draft', 'confirmed'].includes(row.status) && (
            <Popconfirm title="Void this invoice?" onConfirm={() => handleVoid(row.id)}>
              <Button size="small" danger icon={<StopOutlined />} />
            </Popconfirm>
          )}
          <Button size="small" icon={<CopyOutlined />} onClick={() => handleDuplicate(row.id)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Invoices</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/invoices/new')}>New Invoice</Button>
      </div>

      <Table
        dataSource={invoices}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ current: page, pageSize: 20, total, onChange: (p) => { setPage(p); load(p); } }}
        size="middle"
      />
    </div>
  );
}
