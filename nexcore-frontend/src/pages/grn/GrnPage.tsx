import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Tag, Space, Popconfirm, message, Typography, Select } from 'antd';
import { CheckOutlined, CloseOutlined, SendOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { getGrns, submitGrn, approveGrn, rejectGrn } from '../../api/grn';
import dayjs from 'dayjs';

const { Title } = Typography;
const { Option } = Select;

const statusColors: Record<string, string> = {
  draft: 'default', submitted: 'blue', approved: 'green', rejected: 'red', partial: 'orange',
};

export default function GrnPage() {
  const navigate = useNavigate();
  const [grns, setGrns] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>();
  const [loading, setLoading] = useState(false);

  const load = async (p = page, s = status) => {
    setLoading(true);
    try {
      const res = await getGrns({ page: p, limit: 20, status: s });
      setGrns(res.data.items ?? []);
      setTotal(res.data.total ?? 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (id: string) => { await submitGrn(id); message.success('GRN submitted'); load(); };
  const handleApprove = async (id: string) => { await approveGrn(id); message.success('GRN approved — stock updated'); load(); };
  const handleReject = async (id: string) => { await rejectGrn(id, 'Rejected'); message.success('GRN rejected'); load(); };

  const columns = [
    { title: 'GRN #', dataIndex: 'grnNumber', key: 'grnNumber', width: 180 },
    { title: 'Received Date', dataIndex: 'receivedDate', key: 'receivedDate', width: 120, render: (v: any) => dayjs(v).format('DD/MM/YYYY') },
    { title: 'Ref #', dataIndex: 'referenceNumber', key: 'referenceNumber', render: (v: any) => v ?? '—' },
    { title: 'Total Cost', dataIndex: 'totalCost', key: 'totalCost', align: 'right' as const, render: (v: any) => `LKR ${Number(v).toFixed(2)}` },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 110, render: (v: string) => <Tag color={statusColors[v]}>{v.toUpperCase()}</Tag> },
    {
      title: 'Actions', key: 'actions', width: 160,
      render: (_: any, row: any) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/grn/${row.id}`)}>View</Button>
          {row.status === 'draft' && <Button size="small" icon={<SendOutlined />} onClick={() => handleSubmit(row.id)}>Submit</Button>}
          {row.status === 'submitted' && (
            <>
              <Popconfirm title="Approve GRN? This will update stock." onConfirm={() => handleApprove(row.id)}>
                <Button size="small" type="primary" icon={<CheckOutlined />} />
              </Popconfirm>
              <Popconfirm title="Reject this GRN?" onConfirm={() => handleReject(row.id)}>
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
        <Title level={3} style={{ margin: 0 }}>Goods Received Notes (GRN)</Title>
        <Space>
          <Select allowClear placeholder="Filter by status" style={{ width: 160 }}
            onChange={s => { setStatus(s); load(1, s); }}>
            {['draft', 'submitted', 'approved', 'rejected'].map(s => <Option key={s} value={s}>{s.toUpperCase()}</Option>)}
          </Select>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/grn/new')}>New GRN</Button>
        </Space>
      </div>

      <Table
        dataSource={grns}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ current: page, pageSize: 20, total, onChange: (p) => { setPage(p); load(p); } }}
        size="middle"
      />
    </div>
  );
}
