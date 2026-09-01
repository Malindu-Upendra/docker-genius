import { useState, useEffect } from 'react';
import { Input, Button, InputNumber, Divider, Typography, message, Tag, Space, Spin, Empty } from 'antd';
import { ScanOutlined, DeleteOutlined, CheckOutlined, CloseOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { getCategories, getProducts } from '../../api/products';

const { Title, Text } = Typography;

const CATEGORY_COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2', '#faad14', '#f5222d'];

interface CartItem {
  productId: string;
  productCode: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  taxPercentage: number;
}

export default function PosPage() {
  const navigate = useNavigate();
  const [barcode, setBarcode] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionNumber, setSessionNumber] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [categories, setCategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const initSession = async () => {
      try {
        const existing = await api.get('/pos/sessions/current');
        if (existing.data?.id) {
          setSessionId(existing.data.id);
          setSessionNumber(existing.data.sessionNumber);
        } else {
          const res = await api.post('/pos/sessions', { openingCash: 0 });
          setSessionId(res.data.id);
          setSessionNumber(res.data.sessionNumber);
        }
      } catch {
        message.error('Could not initialise POS session');
      } finally {
        setSessionReady(true);
      }
    };

    const loadCatalog = async () => {
      const [catRes, prodRes] = await Promise.all([
        getCategories(),
        getProducts({ limit: 500 }),
      ]);
      setCategories(catRes.data ?? []);
      setProducts(prodRes.data.items ?? []);
    };

    initSession();
    loadCatalog();
  }, []);

  const scanBarcode = async () => {
    if (!barcode.trim()) return;
    try {
      const res = await api.get(`/pos/products/scan?barcode=${barcode}`);
      addToCart(res.data);
      setBarcode('');
    } catch {
      message.error(`Product not found: ${barcode}`);
    }
  };

  const addToCart = (product: any) => {
    const id = product.id;
    const code = product.product_code ?? product.productCode;
    const name = product.product_name ?? product.productName;
    const price = Number(product.selling_price ?? product.sellingPrice);
    const tax = Number(product.tax_percentage ?? product.taxPercentage ?? 0);
    setCart(prev => {
      const existing = prev.find(i => i.productId === id);
      if (existing) return prev.map(i => i.productId === id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { productId: id, productCode: code, productName: name, unitPrice: price, quantity: 1, taxPercentage: tax }];
    });
  };

  const removeFromCart = (productId: string) => setCart(prev => prev.filter(i => i.productId !== productId));
  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) { removeFromCart(productId); return; }
    setCart(prev => prev.map(i => i.productId === productId ? { ...i, quantity: qty } : i));
  };

  const subtotal = cart.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const tax = cart.reduce((s, i) => s + i.quantity * i.unitPrice * (i.taxPercentage / 100), 0);
  const total = subtotal + tax;

  const checkout = async () => {
    if (!sessionId || cart.length === 0) return;
    setProcessing(true);
    try {
      await api.post('/pos/checkout', {
        sessionId,
        items: cart.map(i => ({
          productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice,
          taxAmount: i.quantity * i.unitPrice * (i.taxPercentage / 100),
        })),
        payments: [{ paymentMethodId: 'cash', amount: total }],
      });
      message.success(`Checkout complete — LKR ${total.toFixed(2)}`);
      setCart([]);
    } catch (e: any) {
      message.error(e.response?.data?.message ?? 'Checkout failed');
    } finally {
      setProcessing(false);
    }
  };

  // Filter products by selected category and search
  const visibleProducts = products.filter(p => {
    const matchCat = !selectedCategory || p.categoryId === selectedCategory;
    const q = search.toLowerCase();
    const matchSearch = !q || p.productName?.toLowerCase().includes(q) || p.productCode?.toLowerCase().includes(q);
    return matchCat && matchSearch && p.isActive;
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#f0f2f5', display: 'flex', flexDirection: 'column' }}>

      {/* ── Top bar ── */}
      <div style={{
        height: 56, background: '#fff', borderBottom: '1px solid #e8e8e8',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', flexShrink: 0,
      }}>
        <Title level={4} style={{ margin: 0, color: '#1677ff' }}>Point of Sale</Title>
        <Space>
          {!sessionReady ? <Spin size="small" /> : <Tag color="green">{sessionNumber}</Tag>}
          <Button icon={<CloseOutlined />} onClick={() => navigate('/dashboard')}>Exit POS</Button>
        </Space>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', gap: 0 }}>

        {/* ── Left: catalogue ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 16, paddingRight: 8 }}>

          {/* Barcode + search */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexShrink: 0 }}>
            <Space.Compact style={{ flex: 1 }}>
              <Input
                prefix={<ScanOutlined />}
                placeholder="Scan barcode and press Enter..."
                value={barcode}
                onChange={e => setBarcode(e.target.value)}
                onPressEnter={scanBarcode}
              />
              <Button onClick={scanBarcode}>Scan</Button>
            </Space.Compact>
            <Input.Search
              placeholder="Search products..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              allowClear
              style={{ flex: 1 }}
            />
          </div>

          {/* Category boxes */}
          <div style={{
            display: 'flex', gap: 8, flexWrap: 'wrap',
            marginBottom: 12, flexShrink: 0,
          }}>
            <div
              onClick={() => setSelectedCategory(null)}
              style={{
                padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
                background: !selectedCategory ? '#1677ff' : '#fff',
                color: !selectedCategory ? '#fff' : '#333',
                border: `2px solid ${!selectedCategory ? '#1677ff' : '#d9d9d9'}`,
                fontWeight: 600, fontSize: 13, userSelect: 'none',
                transition: 'all 0.15s',
              }}
            >
              All
            </div>
            {categories.map((cat, idx) => {
              const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
              const active = selectedCategory === cat.id;
              return (
                <div
                  key={cat.id}
                  onClick={() => setSelectedCategory(active ? null : cat.id)}
                  style={{
                    padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
                    background: active ? color : '#fff',
                    color: active ? '#fff' : color,
                    border: `2px solid ${color}`,
                    fontWeight: 600, fontSize: 13, userSelect: 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  {cat.categoryName}
                </div>
              );
            })}
          </div>

          {/* Product grid */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {visibleProducts.length === 0 ? (
              <Empty description="No products found" style={{ marginTop: 60 }} />
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 10,
              }}>
                {visibleProducts.map(p => {
                  const inCart = cart.find(i => i.productId === p.id);
                  return (
                    <div
                      key={p.id}
                      onClick={() => addToCart(p)}
                      style={{
                        background: '#fff',
                        border: inCart ? '2px solid #1677ff' : '1px solid #e8e8e8',
                        borderRadius: 10, padding: '12px 10px',
                        cursor: 'pointer', textAlign: 'center',
                        position: 'relative', userSelect: 'none',
                        transition: 'box-shadow 0.15s',
                        boxShadow: inCart ? '0 0 0 2px #e6f4ff' : undefined,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.12)')}
                      onMouseLeave={e => (e.currentTarget.style.boxShadow = inCart ? '0 0 0 2px #e6f4ff' : 'none')}
                    >
                      {inCart && (
                        <div style={{
                          position: 'absolute', top: 6, right: 6,
                          background: '#1677ff', color: '#fff',
                          borderRadius: '50%', width: 20, height: 20,
                          fontSize: 11, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {inCart.quantity}
                        </div>
                      )}
                      <div style={{
                        fontSize: 11, color: '#999', marginBottom: 4,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {p.productCode}
                      </div>
                      <div style={{
                        fontSize: 13, fontWeight: 600, color: '#222',
                        marginBottom: 6, lineHeight: 1.3,
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      }}>
                        {p.productName}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1677ff' }}>
                        LKR {Number(p.sellingPrice).toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: cart + checkout ── */}
        <div style={{
          width: 340, background: '#fff',
          borderLeft: '1px solid #e8e8e8',
          display: 'flex', flexDirection: 'column',
          flexShrink: 0,
        }}>
          {/* Cart header */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
            <Space>
              <ShoppingCartOutlined style={{ fontSize: 16 }} />
              <Text strong>Cart</Text>
              {cart.length > 0 && <Tag color="blue">{cart.length} items</Tag>}
            </Space>
          </div>

          {/* Cart items */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {cart.length === 0 ? (
              <Empty description="Cart is empty" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 40 }} />
            ) : (
              cart.map(item => (
                <div key={item.productId} style={{
                  padding: '10px 16px', borderBottom: '1px solid #f5f5f5',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.productName}
                    </div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                      LKR {item.unitPrice.toFixed(2)} × {item.quantity}
                    </div>
                  </div>
                  <InputNumber
                    size="small" min={1} value={item.quantity}
                    onChange={v => updateQty(item.productId, v ?? 1)}
                    style={{ width: 60 }}
                  />
                  <Text strong style={{ width: 72, textAlign: 'right', fontSize: 13 }}>
                    {(item.unitPrice * item.quantity).toFixed(2)}
                  </Text>
                  <Button
                    size="small" type="text" danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeFromCart(item.productId)}
                  />
                </div>
              ))
            )}
          </div>

          {/* Totals + checkout */}
          <div style={{ padding: 16, borderTop: '1px solid #e8e8e8', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text type="secondary">Subtotal</Text>
              <Text>LKR {subtotal.toFixed(2)}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text type="secondary">Tax</Text>
              <Text>LKR {tax.toFixed(2)}</Text>
            </div>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <Title level={4} style={{ margin: 0 }}>Total</Title>
              <Title level={4} style={{ margin: 0, color: '#1677ff' }}>LKR {total.toFixed(2)}</Title>
            </div>
            <Button
              type="primary" size="large" block
              icon={<CheckOutlined />}
              onClick={checkout}
              loading={processing}
              disabled={cart.length === 0 || !sessionId}
            >
              Complete Checkout
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
