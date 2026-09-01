import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Steps, Form, Input, DatePicker, Select, Button, Card, InputNumber,
  Table, Space, Typography, message, Divider, Row, Col, Alert,
} from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, CheckOutlined } from '@ant-design/icons';
import { createPayment, getOutstandingInvoices } from '../../api/payments';
import { getClients } from '../../api/clients';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { Option } = Select;

const PAYMENT_METHODS = [
  { id: 'cash', name: 'Cash' },
  { id: 'cheque', name: 'Cheque' },
  { id: 'bank_transfer', name: 'Bank Transfer' },
  { id: 'card', name: 'Card' },
];

interface Allocation {
  invoiceId: string;
  amount: number;
}

export default function PaymentCreatePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form] = Form.useForm();
  const [clients, setClients] = useState<any[]>([]);
  const [outstandingInvoices, setOutstandingInvoices] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [step0Values, setStep0Values] = useState<any>(null);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getClients({ limit: 500 }).then(r => setClients(r.data.items ?? []));
  }, []);

  const paymentAmount = Number(step0Values?.amount ?? form.getFieldValue('amount') ?? 0);
  const totalAllocated = Object.values(allocations).reduce((s, v) => s + v, 0);
  const remaining = paymentAmount - totalAllocated;

  const handleNext = async () => {
    try { await form.validateFields(); } catch { return; }
    const values = form.getFieldsValue();
    setStep0Values(values);
    setLoadingInvoices(true);
    try {
      const res = await getOutstandingInvoices(values.clientId);
      setOutstandingInvoices(res.data ?? []);
    } catch {
      message.error('Could not load outstanding invoices');
    } finally {
      setLoadingInvoices(false);
    }
    setStep(1);
  };

  const setAlloc = (invoiceId: string, value: number) => {
    setAllocations(prev => ({ ...prev, [invoiceId]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const values = step0Values ?? form.getFieldsValue(true);
      const allocationList: Allocation[] = Object.entries(allocations)
        .filter(([, amt]) => amt > 0)
        .map(([invoiceId, amount]) => ({ invoiceId, amount }));

      const payload = {
        clientId: values.clientId,
        paymentMethodId: values.paymentMethodId,
        paymentDate: values.paymentDate?.format?.('YYYY-MM-DD') ?? values.paymentDate,
        amount: Number(values.amount),
        referenceNumber: values.referenceNumber || undefined,
        chequeNumber: values.chequeNumber || undefined,
        chequeDate: values.chequeDate ? (values.chequeDate?.format?.('YYYY-MM-DD') ?? values.chequeDate) : undefined,
        chequeBank: values.chequeBank || undefined,
        notes: values.notes || undefined,
        allocations: allocationList,
      };

      const res = await createPayment(payload);
      message.success(`Payment ${res.data.paymentNumber} created`);
      navigate(`/payments/${res.data.id}`);
    } catch (err: any) {
      message.error(err?.response?.data?.message ?? 'Failed to create payment');
    } finally {
      setSubmitting(false);
    }
  };

  const paymentMethod = form.getFieldValue('paymentMethodId');

  const invoiceColumns = [
    { title: 'Invoice #', dataIndex: 'invoice_number', key: 'invoice_number', width: 150 },
    { title: 'Date', dataIndex: 'invoice_date', key: 'invoice_date', width: 110,
      render: (v: any) => dayjs(v).format('DD/MM/YYYY') },
    { title: 'Due Date', dataIndex: 'due_date', key: 'due_date', width: 110,
      render: (v: any) => {
        if (!v) return '—';
        const overdue = Number(v) > 0;
        return <span style={{ color: overdue ? '#cf1322' : undefined }}>{dayjs(v).format('DD/MM/YYYY')}</span>;
      },
    },
    { title: 'Balance Due (LKR)', dataIndex: 'balance_due', key: 'balance_due', align: 'right' as const,
      render: (v: any) => <Text strong style={{ color: '#cf1322' }}>
        {Number(v).toLocaleString('en-LK', { minimumFractionDigits: 2 })}
      </Text> },
    {
      title: 'Allocate (LKR)', key: 'allocate', width: 160, align: 'right' as const,
      render: (_: any, row: any) => (
        <InputNumber
          min={0}
          max={Math.min(Number(row.balance_due), remaining + (allocations[row.id] ?? 0))}
          precision={2}
          value={allocations[row.id] ?? 0}
          style={{ width: 140 }}
          onChange={v => setAlloc(row.id, v ?? 0)}
        />
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/payments')}>Back to Payments</Button>
      </Space>

      <Title level={3} style={{ marginTop: 0, marginBottom: 20 }}>New Payment</Title>

      <Steps
        current={step}
        style={{ marginBottom: 24 }}
        items={[
          { title: 'Payment Details', description: 'Customer & amount' },
          { title: 'Allocate Invoices', description: 'Select open invoices' },
        ]}
      />

      {/* ── Step 0: Payment header ── */}
      {step === 0 && (
        <Card>
          <Form form={form} layout="vertical" initialValues={{ paymentDate: dayjs() }}>
            <Row gutter={24}>
              <Col span={8}>
                <Form.Item name="clientId" label="Customer" rules={[{ required: true, message: 'Select a customer' }]}>
                  <Select showSearch placeholder="Select customer" optionFilterProp="children">
                    {clients.map((c: any) => <Option key={c.id} value={c.id}>{c.clientName}</Option>)}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item name="amount" label="Payment Amount (LKR)" rules={[{ required: true, message: 'Enter amount' }]}>
                  <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item name="paymentMethodId" label="Payment Method" rules={[{ required: true }]}>
                  <Select placeholder="Select method">
                    {PAYMENT_METHODS.map(m => <Option key={m.id} value={m.id}>{m.name}</Option>)}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="paymentDate" label="Payment Date" rules={[{ required: true }]}>
                  <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={24}>
              <Col span={6}>
                <Form.Item name="referenceNumber" label="Reference #">
                  <Input placeholder="Bank ref, receipt #..." />
                </Form.Item>
              </Col>
              {paymentMethod === 'cheque' && (
                <>
                  <Col span={5}>
                    <Form.Item name="chequeNumber" label="Cheque #">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col span={5}>
                    <Form.Item name="chequeDate" label="Cheque Date">
                      <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
                    </Form.Item>
                  </Col>
                  <Col span={5}>
                    <Form.Item name="chequeBank" label="Bank">
                      <Input />
                    </Form.Item>
                  </Col>
                </>
              )}
              <Col span={paymentMethod === 'cheque' ? 3 : 18}>
                <Form.Item name="notes" label="Notes">
                  <Input placeholder="Optional" />
                </Form.Item>
              </Col>
            </Row>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="primary" icon={<ArrowRightOutlined />} onClick={handleNext} loading={loadingInvoices}>
                Next: Allocate Invoices
              </Button>
            </div>
          </Form>
        </Card>
      )}

      {/* ── Step 1: Invoice allocation ── */}
      {step === 1 && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Space>
              <Text>Payment Amount:</Text>
              <Text strong style={{ color: '#1677ff' }}>
                LKR {paymentAmount.toLocaleString('en-LK', { minimumFractionDigits: 2 })}
              </Text>
              <Divider type="vertical" />
              <Text>Allocated:</Text>
              <Text strong style={{ color: '#3f8600' }}>
                LKR {totalAllocated.toLocaleString('en-LK', { minimumFractionDigits: 2 })}
              </Text>
              <Divider type="vertical" />
              <Text>Remaining:</Text>
              <Text strong style={{ color: remaining < 0 ? '#cf1322' : remaining === 0 ? '#3f8600' : '#fa8c16' }}>
                LKR {remaining.toLocaleString('en-LK', { minimumFractionDigits: 2 })}
              </Text>
            </Space>
          </div>

          {remaining < 0 && (
            <Alert type="error" message="Total allocated exceeds payment amount." style={{ marginBottom: 12 }} />
          )}

          {outstandingInvoices.length === 0 ? (
            <Alert
              type="info"
              message="No outstanding invoices found for this customer."
              description="You can still submit the payment without allocations."
              style={{ marginBottom: 16 }}
            />
          ) : (
            <Table
              dataSource={outstandingInvoices}
              columns={invoiceColumns}
              rowKey="id"
              pagination={false}
              size="small"
              scroll={{ x: 700 }}
            />
          )}

          <Divider />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button icon={<ArrowLeftOutlined />} onClick={() => setStep(0)}>Back</Button>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              loading={submitting}
              disabled={remaining < 0}
              onClick={handleSubmit}
            >
              Create Payment (Pending)
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
