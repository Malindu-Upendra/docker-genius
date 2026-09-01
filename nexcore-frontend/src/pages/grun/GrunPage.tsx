import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Tag, Space, Popconfirm, message, Typography, Select } from 'antd';
import { CheckOutlined, CloseOutlined, SendOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import api from '../../api/client';
import dayjs from 'dayjs';

const { Title } = Typography;
const { Option } = Select;

const statusColors: Record<string, string> = { draft: 'default', submitted: 'blue', approved: 'green', rejected: 'red' };

export default function GrunPage() {
  const navigate = useNavigate();
  const [gruns, setGruns] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>();
  const [loading, setLoading] = useState(false);

  const load = async (p = page, s = status) => {
    setLoading(true);
    try {
      const res = await api.get('/grun', { params: { page: p, limit: 20, status: s } });
      setGruns(res.data.items ?? []);
      setTotal(res.data.total ?? 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (id: string) => { await api.put(`/grun/${id}/submit`); message.success('GRUN submitted'); load(); };
  const handleApprove = async (id: string) => { await api.put(`/grun/${id}/approve`); message.success('GRUN approved — stock reduced'); load(); };
  const handleReject = async (id: string) => { await api.put(`/grun/${id}/reject`, { reason: 'Rejected' }); message.success('GRUN rejected'); load(); };

  const columns = [
    { title: 'GRUN #', dataIndex: 'grunNumber', key: 'grunNumber', width: 180 },
    { title: 'Return Date', dataIndex: 'returnDate', key: 'returnDate', width: 120, render: (v: any) => dayjs(v).format('DD/MM/YYYY') },
    { title: 'Type', dataIndex: 'grunType', key: 'grunType', width: 120, render: (v: string) => <Tag>{v === 'from_grn' ? 'From GRN' : 'Standalone'}</Tag> },
    { title: 'Return Value', dataIndex: 'totalCost', key: 'totalCost', align: 'right' as const, render: (v: any) => `LKR ${Number(v).toFixed(2)}` },
    { title: 'Reason', dataIndex: 'returnReason', key: 'returnReason', render: (v: any) => v ?? '—' },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 110, render: (v: string) => <Tag color={statusColors[v]}>{v.toUpperCase()}</Tag> },
    {
      title: 'Actions', key: 'actions', width: 160,
      render: (_: any, row: any) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/grun/${row.id}`)}>View</Button>
          {row.status === 'draft' && <Button size="small" icon={<SendOutlined />} onClick={() => handleSubmit(row.id)}>Submit</Button>}
          {row.status === 'submitted' && (
            <>
              <Popconfirm title="Approve GRUN? This will reduce stock." onConfirm={() => handleApprove(row.id)}>
                <Button size="small" type="primary" icon={<CheckOutlined />} />
              </Popconfirm>
              <Popconfirm title="Reject this GRUN?" onConfirm={() => handleReject(row.id)}>
                <Button size="small" danger icon={<CloseOutlined />} />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Goods Return Notes (GRUN)</Title>
        <Space>
          <Select allowClear placeholder="Filter by status" style={{ width: 160 }} onChange={s => { setStatus(s); load(1, s); }}>
            {['draft', 'submitted', 'approved', 'rejected'].map(s => <Option key={s} value={s}>{s.toUpperCase()}</Option>)}
          </Select>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/grun/new')}>New GRUN</Button>
        </Space>
      </div>
      <Table dataSource={gruns} columns={columns} rowKey="id" loading={loading}
        pagination={{ current: page, pageSize: 20, total, onChange: (p) => { setPage(p); load(p); } }} size="middle" />
    </div>
  );
}
