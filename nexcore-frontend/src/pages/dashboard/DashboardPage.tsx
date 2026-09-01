import { useEffect, useState } from 'react';
import { Row, Col, Card, Spin, Table, Typography, Tag } from 'antd';
import {
  ShoppingOutlined, TeamOutlined,
  WarningOutlined, RiseOutlined, FallOutlined, LineChartOutlined,
} from '@ant-design/icons';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title as ChartTitle, Tooltip, Legend, Filler,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { getProductDashboard, getLowStock } from '../../api/products';
import { getClientDashboard } from '../../api/clients';
import { getPaymentDashboard } from '../../api/payments';
import { getMonthlySales, getTopSelling, getDailySales } from '../../api/reports';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, ChartTitle, Tooltip, Legend, Filler,
);

const { Title, Text } = Typography;

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DONUT_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

const cardGradients = [
  { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff' },
  { bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', color: '#fff' },
  { bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', color: '#fff' },
  { bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', color: '#fff' },
  { bg: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', color: '#fff' },
];

export default function DashboardPage() {
  const [productStats, setProductStats] = useState<any>(null);
  const [clientStats, setClientStats] = useState<any>(null);
  const [paymentStats, setPaymentStats] = useState<any>(null);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [monthlySales, setMonthlySales] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [dailySales, setDailySales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getProductDashboard(),
      getClientDashboard(),
      getPaymentDashboard(),
      getLowStock(),
      getMonthlySales(new Date().getFullYear()),
      getTopSelling({ limit: 8 }),
      getDailySales(),
    ]).then(([p, c, pay, ls, ms, top, daily]) => {
      setProductStats(p.data);
      setClientStats(c.data);
      setPaymentStats(pay.data);
      setLowStock(ls.data?.slice(0, 6) ?? []);
      setMonthlySales(ms.data ?? []);
      setTopProducts(top.data ?? []);
      setDailySales(daily.data ?? []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  // ── Monthly Sales Bar Chart ──────────────────────────────────────────────
  const monthlyMap: Record<number, { revenue: number; qty: number }> = {};
  for (const row of monthlySales) {
    const m = Number(row.month_number);
    if (!monthlyMap[m]) monthlyMap[m] = { revenue: 0, qty: 0 };
    monthlyMap[m].revenue += Number(row.net_sales ?? 0);
    monthlyMap[m].qty += Number(row.total_qty ?? 0);
  }
  const monthlyRevenue = MONTH_LABELS.map((_, i) => monthlyMap[i + 1]?.revenue ?? 0);
  const monthlyQty = MONTH_LABELS.map((_, i) => monthlyMap[i + 1]?.qty ?? 0);

  const monthlyChartData = {
    labels: MONTH_LABELS,
    datasets: [
      {
        label: 'Net Revenue (LKR)',
        data: monthlyRevenue,
        backgroundColor: 'rgba(99, 102, 241, 0.8)',
        borderColor: '#6366f1',
        borderWidth: 1,
        borderRadius: 6,
        yAxisID: 'y',
      },
      {
        label: 'Units Sold',
        data: monthlyQty,
        backgroundColor: 'rgba(16, 185, 129, 0.8)',
        borderColor: '#10b981',
        borderWidth: 1,
        borderRadius: 6,
        yAxisID: 'y1',
      },
    ],
  };

  const monthlyChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' as const },
      tooltip: {
        callbacks: {
          label: (ctx: any) =>
            ctx.datasetIndex === 0
              ? `Revenue: LKR ${Number(ctx.raw).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`
              : `Units: ${ctx.raw}`,
        },
      },
    },
    scales: {
      y: { type: 'linear' as const, position: 'left' as const, ticks: { callback: (v: any) => `LKR ${(v / 1000).toFixed(0)}k` } },
      y1: { type: 'linear' as const, position: 'right' as const, grid: { drawOnChartArea: false } },
    },
  };

  // ── Top Products Doughnut ────────────────────────────────────────────────
  const topLabels = topProducts.slice(0, 8).map((r: any) => r.product_name ?? r.product_code);
  const topRevenues = topProducts.slice(0, 8).map((r: any) => Number(r.net_revenue ?? 0));

  const donutData = {
    labels: topLabels,
    datasets: [{
      data: topRevenues,
      backgroundColor: DONUT_COLORS,
      borderColor: '#fff',
      borderWidth: 3,
      hoverOffset: 12,
    }],
  };

  const donutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '60%',
    plugins: {
      legend: { position: 'right' as const, labels: { boxWidth: 14, font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: (ctx: any) =>
            ` LKR ${Number(ctx.raw).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`,
        },
      },
    },
  };

  // ── Daily Sales Line Chart ───────────────────────────────────────────────
  const hourMap: Record<number, { pos: number; inv: number }> = {};
  for (const row of dailySales) {
    const h = Number(row.hour_of_day);
    if (!hourMap[h]) hourMap[h] = { pos: 0, inv: 0 };
    hourMap[h].pos += Number(row.pos_revenue ?? 0);
    hourMap[h].inv += Number(row.invoice_revenue ?? 0);
  }
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const hourLabels = hours.map(h => `${String(h).padStart(2, '0')}:00`);
  const posHourly = hours.map(h => hourMap[h]?.pos ?? 0);
  const invHourly = hours.map(h => hourMap[h]?.inv ?? 0);

  const dailyChartData = {
    labels: hourLabels,
    datasets: [
      {
        label: 'POS Revenue',
        data: posHourly,
        fill: true,
        backgroundColor: 'rgba(99, 102, 241, 0.15)',
        borderColor: '#6366f1',
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.4,
      },
      {
        label: 'Invoice Revenue',
        data: invHourly,
        fill: true,
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        borderColor: '#10b981',
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.4,
      },
    ],
  };

  const dailyChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' as const },
      tooltip: {
        callbacks: {
          label: (ctx: any) =>
            ` LKR ${Number(ctx.raw).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`,
        },
      },
    },
    scales: {
      y: { ticks: { callback: (v: any) => `${(v / 1000).toFixed(0)}k` } },
      x: { ticks: { maxTicksLimit: 12 } },
    },
  };

  // ── Low Stock bar chart ─────────────────────────────────────────────────
  const lowStockChartData = {
    labels: lowStock.map(r => r.product_code ?? r.product_name),
    datasets: [
      {
        label: 'On Hand',
        data: lowStock.map(r => Number(r.qty_on_hand)),
        backgroundColor: lowStock.map(r =>
          Number(r.available_qty) <= 0 ? 'rgba(239, 68, 68, 0.85)' : 'rgba(245, 158, 11, 0.85)'),
        borderRadius: 4,
      },
      {
        label: 'Reorder Level',
        data: lowStock.map(r => Number(r.reorder_level)),
        backgroundColor: 'rgba(203, 213, 225, 0.5)',
        borderColor: '#94a3b8',
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };

  const lowStockChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' as const } },
    scales: { y: { beginAtZero: true } },
  };

  const kpiCards = [
    {
      title: 'Total Products',
      value: productStats?.totalProducts ?? 0,
      icon: <ShoppingOutlined style={{ fontSize: 28 }} />,
      gradient: cardGradients[0],
    },
    {
      title: 'Low Stock Alerts',
      value: productStats?.lowStockCount ?? 0,
      icon: <WarningOutlined style={{ fontSize: 28 }} />,
      gradient: cardGradients[1],
    },
    {
      title: 'Total Clients',
      value: clientStats?.totalClients ?? 0,
      icon: <TeamOutlined style={{ fontSize: 28 }} />,
      gradient: cardGradients[2],
    },
    {
      title: 'Monthly Received',
      value: `LKR ${Number(paymentStats?.monthlyReceived ?? 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`,
      icon: <RiseOutlined style={{ fontSize: 28 }} />,
      gradient: cardGradients[3],
    },
    {
      title: 'Total Overdue',
      value: `LKR ${Number(paymentStats?.overdueAmount ?? 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`,
      icon: <FallOutlined style={{ fontSize: 28 }} />,
      gradient: cardGradients[4],
    },
  ];

  const lowStockColumns = [
    { title: 'Code', dataIndex: 'product_code', key: 'product_code', width: 90 },
    { title: 'Product', dataIndex: 'product_name', key: 'product_name', ellipsis: true },
    { title: 'On Hand', dataIndex: 'qty_on_hand', key: 'qty_on_hand', align: 'right' as const,
      render: (v: any) => Number(v).toFixed(0) },
    { title: 'Reorder', dataIndex: 'reorder_level', key: 'reorder_level', align: 'right' as const,
      render: (v: any) => Number(v).toFixed(0) },
    {
      title: 'Status', key: 'status', width: 100,
      render: (_: any, row: any) =>
        Number(row.available_qty) <= 0
          ? <Tag color="red">Out of Stock</Tag>
          : <Tag color="orange">Low Stock</Tag>,
    },
  ];

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <LineChartOutlined style={{ fontSize: 24, color: '#6366f1' }} />
        <Title level={3} style={{ margin: 0 }}>Dashboard</Title>
        <Text type="secondary" style={{ marginLeft: 8 }}>
          {new Date().toLocaleDateString('en-LK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </Text>
      </div>

      {/* ── KPI Cards ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {kpiCards.map((card, i) => (
          <Col xs={24} sm={12} lg={24 / kpiCards.length} key={i}>
            <Card
              style={{
                background: card.gradient.bg,
                border: 'none',
                borderRadius: 12,
                boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              }}
              bodyStyle={{ padding: '20px 24px' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginBottom: 4 }}>{card.title}</div>
                  <div style={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>{card.value}</div>
                </div>
                <div style={{ color: 'rgba(255,255,255,0.7)' }}>{card.icon}</div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* ── Monthly Sales + Top Products ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={16}>
          <Card
            title={<span style={{ fontWeight: 600 }}>Monthly Sales — {new Date().getFullYear()}</span>}
            style={{ borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
            bodyStyle={{ paddingTop: 8 }}
          >
            <div style={{ height: 280 }}>
              <Bar data={monthlyChartData} options={monthlyChartOptions} />
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card
            title={<span style={{ fontWeight: 600 }}>Top Products by Revenue</span>}
            style={{ borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
            bodyStyle={{ paddingTop: 8 }}
          >
            <div style={{ height: 280 }}>
              {topLabels.length > 0
                ? <Doughnut data={donutData} options={donutOptions} />
                : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8' }}>No sales data</div>}
            </div>
          </Card>
        </Col>
      </Row>

      {/* ── Today's Hourly Sales ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24}>
          <Card
            title={<span style={{ fontWeight: 600 }}>Today's Sales — Hourly Breakdown</span>}
            style={{ borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
            bodyStyle={{ paddingTop: 8 }}
          >
            <div style={{ height: 220 }}>
              <Line data={dailyChartData} options={dailyChartOptions} />
            </div>
          </Card>
        </Col>
      </Row>

      {/* ── Low Stock Chart + Table ── */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title={<span style={{ fontWeight: 600 }}>
              <WarningOutlined style={{ color: '#f59e0b', marginRight: 8 }} />Low Stock — On Hand vs Reorder Level
            </span>}
            style={{ borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
            bodyStyle={{ paddingTop: 8 }}
          >
            <div style={{ height: 240 }}>
              {lowStock.length > 0
                ? <Bar data={lowStockChartData} options={lowStockChartOptions} />
                : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#10b981' }}>All stock levels are healthy</div>}
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={<span style={{ fontWeight: 600 }}>
              <WarningOutlined style={{ color: '#f59e0b', marginRight: 8 }} />Low Stock Alert
            </span>}
            style={{ borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
          >
            <Table
              dataSource={lowStock}
              columns={lowStockColumns}
              rowKey="id"
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
