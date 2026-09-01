import { useState } from 'react';
import { Card, Button, Table, Typography, message, Tag, Tabs } from 'antd';
import { BarChartOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { getFinancialAggregate, getMonthlySales, getTopSelling, getStockValuation, bulkGenerate } from '../../api/reports';

const { Title, Text } = Typography;

export default function ReportsPage() {
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [financialData, setFinancialData] = useState<any[]>([]);
  const [monthlySales, setMonthlySales] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [stockValuation, setStockValuation] = useState<any[]>([]);

  const run = async (key: string, fn: () => Promise<any>, setter: (d: any) => void) => {
    setLoading(l => ({ ...l, [key]: true }));
    try {
      const res = await fn();
      setter(res.data ?? []);
    } catch (e: any) {
      message.error(e.response?.data?.message ?? `Failed to load ${key}`);
    } finally {
      setLoading(l => ({ ...l, [key]: false }));
    }
  };

  const financialCols = [
    { title: 'Product', dataIndex: 'product_name', key: 'product_name' },
    { title: 'Category', dataIndex: 'category_name', key: 'category_name' },
    { title: 'Qty Sold', dataIndex: 'total_qty_sold', key: 'total_qty_sold', align: 'right' as const, render: (v: any) => Number(v).toFixed(2) },
    { title: 'Revenue', dataIndex: 'net_revenue', key: 'net_revenue', align: 'right' as const, render: (v: any) => `LKR ${Number(v).toFixed(2)}` },
    { title: 'COGS', dataIndex: 'total_cogs', key: 'total_cogs', align: 'right' as const, render: (v: any) => `LKR ${Number(v).toFixed(2)}` },
    { title: 'Gross Profit', dataIndex: 'gross_profit', key: 'gross_profit', align: 'right' as const, render: (v: any) => <Text style={{ color: Number(v) >= 0 ? '#3f8600' : '#cf1322' }}>LKR {Number(v).toFixed(2)}</Text> },
    { title: 'Margin %', dataIndex: 'gross_margin_pct', key: 'gross_margin_pct', align: 'right' as const, render: (v: any) => `${Number(v).toFixed(1)}%` },
  ];

  const monthlyCols = [
    { title: 'Month', dataIndex: 'month_name', key: 'month_name' },
    { title: 'Category', dataIndex: 'category_name', key: 'category_name' },
    { title: 'Invoices', dataIndex: 'invoice_count', key: 'invoice_count', align: 'right' as const },
    { title: 'Net Sales', dataIndex: 'net_sales', key: 'net_sales', align: 'right' as const, render: (v: any) => `LKR ${Number(v).toFixed(2)}` },
    { title: 'Tax', dataIndex: 'tax_collected', key: 'tax_collected', align: 'right' as const, render: (v: any) => `LKR ${Number(v).toFixed(2)}` },
  ];

  const topCols = [
    { title: 'Product', dataIndex: 'product_name', key: 'product_name' },
    { title: 'Category', dataIndex: 'category_name', key: 'category_name' },
    { title: 'Qty Sold', dataIndex: 'total_qty_sold', key: 'total_qty_sold', align: 'right' as const },
    { title: 'Revenue', dataIndex: 'net_revenue', key: 'net_revenue', align: 'right' as const, render: (v: any) => `LKR ${Number(v).toFixed(2)}` },
    { title: 'Margin %', dataIndex: 'margin_pct', key: 'margin_pct', align: 'right' as const, render: (v: any) => `${Number(v).toFixed(1)}%` },
  ];

  const stockCols = [
    { title: 'Product', dataIndex: 'product_name', key: 'product_name' },
    { title: 'Category', dataIndex: 'category_name', key: 'category_name' },
    { title: 'On Hand', dataIndex: 'qty_on_hand', key: 'qty_on_hand', align: 'right' as const, render: (v: any) => Number(v).toFixed(2) },
    { title: 'Cost Value', dataIndex: 'cost_value', key: 'cost_value', align: 'right' as const, render: (v: any) => `LKR ${Number(v).toFixed(2)}` },
    { title: 'Selling Value', dataIndex: 'selling_value', key: 'selling_value', align: 'right' as const, render: (v: any) => `LKR ${Number(v).toFixed(2)}` },
  ];

  const tabItems = [
    {
      key: 'financial',
      label: 'Financial Aggregate',
      children: (
        <Card extra={<Button type="primary" loading={loading.financial} icon={<BarChartOutlined />} onClick={() => run('financial', () => getFinancialAggregate(), setFinancialData)}>Run Report</Button>}>
          <Tag color="red" style={{ marginBottom: 12 }}>TIER 3 — Primary Research Endpoint</Tag>
          <Table dataSource={financialData} columns={financialCols} rowKey="product_code" size="small" scroll={{ x: 800 }} pagination={{ pageSize: 15 }} />
        </Card>
      ),
    },
    {
      key: 'monthly',
      label: 'Monthly Sales',
      children: (
        <Card extra={<Button type="primary" loading={loading.monthly} onClick={() => run('monthly', () => getMonthlySales(), setMonthlySales)}>Run Report</Button>}>
          <Table dataSource={monthlySales} columns={monthlyCols} rowKey={(r) => `${r.month_number}-${r.category_name}`} size="small" pagination={{ pageSize: 20 }} />
        </Card>
      ),
    },
    {
      key: 'top',
      label: 'Top Products',
      children: (
        <Card extra={<Button type="primary" loading={loading.top} onClick={() => run('top', () => getTopSelling({ limit: 20 }), setTopProducts)}>Run Report</Button>}>
          <Table dataSource={topProducts} columns={topCols} rowKey="product_name" size="small" pagination={false} />
        </Card>
      ),
    },
    {
      key: 'stock',
      label: 'Stock Valuation',
      children: (
        <Card extra={<Button type="primary" loading={loading.stock} onClick={() => run('stock', getStockValuation, setStockValuation)}>Run Report</Button>}>
          <Table dataSource={stockValuation} columns={stockCols} rowKey="product_name" size="small" pagination={{ pageSize: 15 }} />
        </Card>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Reports</Title>
        <Button
          danger
          icon={<ThunderboltOutlined />}
          loading={loading.bulk}
          onClick={() => run('bulk', () => bulkGenerate({ research_mode: true, delay_ms: 200 }), () => message.success('Bulk report generation complete'))}
        >
          Bulk Generate (Research Load)
        </Button>
      </div>

      <Tabs items={tabItems} />
    </div>
  );
}
