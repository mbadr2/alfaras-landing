const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const ORDERS_FILE = path.join(__dirname, 'orders.json');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'alfaras2024';

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadOrders() {
  try {
    if (!fs.existsSync(ORDERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
}

function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });
  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  const req = https.request(options, () => {});
  req.on('error', () => {});
  req.write(body);
  req.end();
}

function buildOrderMessage(order) {
  let lines = [
    `🛒 <b>طلب جديد #${order.id}</b>`,
    '',
    `👤 ${order.name}`,
    `📱 ${order.phone}`,
    `🏙️ ${order.governorate}`,
    `📍 ${order.address}`,
  ];
  if (order.address2) lines.push(`🏠 ${order.address2}`);
  lines.push(`⏰ ${order.deliveryTime}`);
  lines.push('');
  lines.push('🛍️ <b>المنتجات:</b>');
  for (const item of order.items) {
    lines.push(`  • ${item.name} × ${item.qty} — ${(item.price * item.qty).toLocaleString()} د.ع`);
  }
  lines.push('');
  lines.push(`💰 <b>الإجمالي: ${order.total.toLocaleString()} د.ع</b>`);
  lines.push('💳 الدفع عند التسليم');
  return lines.join('\n');
}

function statusLabel(status) {
  const map = { new: 'جديد', confirmed: 'مؤكد', shipping: 'قيد التوصيل', delivered: 'مُسلَّم', cancelled: 'ملغي' };
  return map[status] || status;
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API ───────────────────────────────────────────────────────────────────────

// POST /api/order — place new order
app.post('/api/order', (req, res) => {
  const { name, phone, governorate, address, address2, deliveryTime, items, total } = req.body;
  if (!name || !phone || !governorate || !address || !deliveryTime || !items || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ success: false, error: 'بيانات الطلب غير مكتملة' });
  }
  const orders = loadOrders();
  const orderId = orders.length ? Math.max(...orders.map(o => o.id)) + 1 : 1;
  const order = {
    id: orderId,
    name,
    phone,
    governorate,
    address,
    address2: address2 || '',
    deliveryTime,
    items,
    total: Number(total) || 0,
    status: 'new',
    createdAt: new Date().toISOString()
  };
  orders.push(order);
  saveOrders(orders);
  sendTelegram(buildOrderMessage(order));
  res.json({ success: true, orderId, total: order.total });
});

// GET /api/orders — admin list
app.get('/api/orders', (req, res) => {
  if (req.headers['x-admin'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  const orders = loadOrders();
  res.json([...orders].reverse());
});

// PATCH /api/orders/:id — update order
app.patch('/api/orders/:id', (req, res) => {
  if (req.headers['x-admin'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  const id = parseInt(req.params.id, 10);
  const orders = loadOrders();
  const idx = orders.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: 'الطلب غير موجود' });

  const prevStatus = orders[idx].status;
  Object.assign(orders[idx], req.body, { id }); // prevent id overwrite
  saveOrders(orders);

  const updated = orders[idx];
  if (req.body.status && req.body.status !== prevStatus) {
    const emoji = { confirmed: '✅', shipping: '🚚', delivered: '🎁', cancelled: '❌' }[req.body.status] || 'ℹ️';
    sendTelegram(`${emoji} طلب #${id} — ${statusLabel(req.body.status)}`);
  }
  res.json(updated);
});

// Catch-all → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
