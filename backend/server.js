/**
 * GymBot Pro — Main Backend Server
 * Handles: Member onboarding, payments, engagement, automation triggers
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { body, validationResult } = require('express-validator');

const whatsapp = require('./services/whatsapp');
const db = require('./services/database');
const automation = require('./services/automation');
const payments = require('./services/payments');
const gymConfig = require('./services/gymConfig');
const { requireAdmin } = require('./middleware/adminAuth');
const { resolveTenantFromWebhook } = require('./services/tenantResolver');
const { issueAdminToken } = require('./services/authService');
const { defaultTenantId } = require('./lib/defaultTenant');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cors());
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Railway / probes often use HEAD (not only GET) — both must return 200
app.get('/health', (req, res) => {
  res.status(200).type('text').send('ok');
});
app.head('/health', (req, res) => {
  res.status(200).end();
});

// ─────────────────────────────────────────
// WEBHOOK — WhatsApp incoming messages
// ─────────────────────────────────────────

// Verify webhook (Meta requirement)
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Receive messages from WhatsApp
app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages) return;

    const phoneNumberId = value.metadata?.phone_number_id;
    const tenant = await resolveTenantFromWebhook(phoneNumberId);
    if (!tenant || !tenant.id) {
      await db.logErrorEvent({
        source: 'webhook:whatsapp:tenant',
        message: 'Could not resolve tenant for inbound message',
        context: { phone_number_id: phoneNumberId },
      });
      return;
    }
    const tenantId = tenant.id;

    for (const msg of value.messages) {
      try {
        const phone = msg.from;
        const text = msg.text?.body?.toLowerCase().trim() || '';
        const msgType = msg.type;
        console.log(`📩 [${tenantId}] Message from ${phone}: "${text}"`);
        const member = await db.getMemberByPhone(phone, tenantId);
        await automation.handleIncomingMessage({ phone, text, msgType, msg, member, tenantId });
      } catch (e) {
        const err = e && e instanceof Error ? e : new Error(String(e));
        await db.logErrorEvent({
          source: 'webhook:whatsapp:message',
          message: err.message,
          stack: err.stack,
          context: { from: msg?.from, type: msg?.type, tenantId },
          tenantId,
        });
        console.error('WhatsApp message handler error:', err);
      }
    }
  } catch (err) {
    const e = err && err instanceof Error ? err : new Error(String(err));
    await db.logErrorEvent({
      source: 'webhook:whatsapp',
      message: e.message,
      stack: e.stack,
      context: { phase: 'outer' },
    });
    console.error('Webhook error:', e);
  }
});

// Payment status callback (Razorpay)
app.post('/webhook/payment', async (req, res) => {
  try {
    const { payload } = req.body;
    const payment = payload?.payment?.entity;
    if (!payment) return res.sendStatus(400);

    const memberId = payment.notes?.member_id;
    const amount = payment.amount / 100; // paise to rupees
    const status = payment.status;

    if (status === 'captured') {
      await payments.handleSuccessfulPayment({ memberId, amount, paymentId: payment.id });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Payment webhook error:', err);
    res.sendStatus(500);
  }
});

// Google Forms — await handler so response tells you if DB actually updated (still fast if DB is quick)
app.post('/webhook/form', async (req, res) => {
  try {
    const formData = { ...req.body, tenantId: req.body.tenantId || req.query.tenantId };
    const tenantId = formData.tenantId || defaultTenantId();
    const result = await automation.handleNewMemberFormSubmission(formData, tenantId);
    res.status(200).json(result);
  } catch (err) {
    console.error('Form webhook error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────
// MEMBER API
// ─────────────────────────────────────────

app.get('/api/members', async (req, res) => {
  try {
    const { status, page = 1, limit = 50, tenantId = defaultTenantId() } = req.query;
    const members = await db.getMembers({ status, page, limit, tenantId });
    res.json({ success: true, data: members });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/members', [
  body('name').notEmpty(),
  body('phone').matches(/^[6-9]\d{9}$/),
  body('plan').isIn(['monthly', '3month', '6month', 'annual']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const tenantId = req.body.tenantId || defaultTenantId();
    const member = await db.createMember({ ...req.body, tenantId });
    await automation.triggerOnboarding(member);
    res.json({ success: true, data: member });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/members/:id', async (req, res) => {
  try {
    const member = await db.getMemberById(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    res.json({ success: true, data: member });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/members/:id', async (req, res) => {
  try {
    const member = await db.updateMember(req.params.id, req.body);
    res.json({ success: true, data: member });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────
// MANUAL TRIGGERS (from dashboard)
// ─────────────────────────────────────────

app.post('/api/trigger/send-message', async (req, res) => {
  try {
    const { memberId, templateName, variables } = req.body;
    const member = await db.getMemberById(memberId);
    const result = await whatsapp.sendTemplate(member.phone, templateName, variables);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/trigger/broadcast', async (req, res) => {
  try {
    const { filter = {}, templateName, variables, tenantId } = req.body;
    const members = await db.getMembers({ ...filter, tenantId: tenantId || defaultTenantId() });
    const results = await automation.broadcastMessage(members, templateName, variables);
    res.json({ success: true, sent: results.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/trigger/payment-reminder/:memberId', async (req, res) => {
  try {
    const member = await db.getMemberById(req.params.memberId);
    await payments.sendPaymentReminder(member);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────

app.get('/api/analytics/overview', async (req, res) => {
  try {
    const tenantId = req.query.tenantId || defaultTenantId();
    const stats = await db.getAnalyticsOverview(tenantId);
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/analytics/messages', async (req, res) => {
  try {
    const { from, to } = req.query;
    const stats = await db.getMessageStats({ from, to });
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────
// AUTH — JWT (optional; API key still works on any admin route)
// ─────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const key = process.env.ADMIN_API_KEY;
  if (!key) {
    return res.status(503).json({ success: false, error: 'ADMIN_API_KEY is not configured on the server' });
  }
  const { apiKey } = req.body || {};
  if (apiKey !== key) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
  const token = issueAdminToken();
  res.json({ success: true, data: { token, expiresIn: process.env.JWT_EXPIRES_IN || '7d' } });
});

// ─────────────────────────────────────────
// ADMIN — White-label, tenants, trainers (Bearer ADMIN_API_KEY or JWT)
// ─────────────────────────────────────────

app.get('/api/admin/tenants', requireAdmin, async (req, res) => {
  try {
    let rows = await db.listAllTenants();
    if (!rows || !rows.length) {
      const row = await db.getTenantById(defaultTenantId());
      rows = row ? [row] : [];
    }
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/tenants', requireAdmin, async (req, res) => {
  try {
    const { name, slug, waPhoneNumberId } = req.body || {};
    if (!name || !slug) {
      return res.status(400).json({ success: false, error: 'name and slug are required' });
    }
    const t = await db.createTenant({ name, slug, waPhoneNumberId });
    res.json({ success: true, data: t });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/tenants/:tenantId/config', requireAdmin, async (req, res) => {
  try {
    const data = await gymConfig.getRuntimeConfig(req.params.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/tenants/:tenantId/config', requireAdmin, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const allowed = [
      'brandName', 'supportPhone', 'websiteUrl', 'intakeFormUrl', 'cdnBaseUrl',
      'address', 'timezone', 'phoneNumberId', 'automations', 'planPrices',
    ];
    const partial = {};
    for (const k of allowed) {
      if (body[k] !== undefined) partial[k] = body[k];
    }
    const data = await gymConfig.updateRuntimeConfig(partial, req.params.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Legacy: /api/admin/config?tenantId=
app.get('/api/admin/config', requireAdmin, async (req, res) => {
  try {
    const tid = req.query.tenantId || defaultTenantId();
    const data = await gymConfig.getRuntimeConfig(tid);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/config', requireAdmin, async (req, res) => {
  try {
    const tid = req.query.tenantId || req.body?.tenantId || defaultTenantId();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const allowed = [
      'brandName', 'supportPhone', 'websiteUrl', 'intakeFormUrl', 'cdnBaseUrl',
      'address', 'timezone', 'phoneNumberId', 'automations', 'planPrices',
    ];
    const partial = {};
    for (const k of allowed) {
      if (body[k] !== undefined) partial[k] = body[k];
    }
    const data = await gymConfig.updateRuntimeConfig(partial, tid);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/tenants/:tenantId/trainers', requireAdmin, async (req, res) => {
  try {
    const data = await db.listTrainers(req.params.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/tenants/:tenantId/trainers', requireAdmin, async (req, res) => {
  try {
    const t = await db.createTrainer(req.params.tenantId, req.body);
    res.json({ success: true, data: t });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/admin/tenants/:tenantId/trainers/:id', requireAdmin, async (req, res) => {
  try {
    const t = await db.updateTrainer(req.params.tenantId, req.params.id, req.body);
    res.json({ success: true, data: t });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/errors', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const tenantId = req.query.tenantId || null;
    const data = await db.getRecentErrorEvents({ limit, tenantId });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/health', requireAdmin, async (req, res) => {
  try {
    const tid = req.query.tenantId || defaultTenantId();
    const stats = await db.getAnalyticsOverview(tid);
    res.json({
      success: true,
      data: {
        supabase: 'ok',
        membersIndexed: true,
        stats,
        time: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, data: { supabase: 'error' } });
  }
});

// ─────────────────────────────────────────
// CRON JOBS — Automated scheduled tasks
// ─────────────────────────────────────────

function cronGuards(name, fn) {
  return async () => {
    try {
      await fn();
    } catch (e) {
      const err = e && e instanceof Error ? e : new Error(String(e));
      await db.logErrorEvent({ source: `cron:${name}`, message: err.message, stack: err.stack, context: {} });
      console.error(`Cron ${name} failed:`, err);
    }
  };
}

async function eachTenantIds() {
  try {
    const list = await db.listActiveTenants();
    if (!list || !list.length) {
      return [defaultTenantId()];
    }
    return list.map((t) => t.id);
  } catch {
    return [defaultTenantId()];
  }
}

// 6:00 AM — Morning motivation blast
cron.schedule('0 6 * * *', cronGuards('morning_motivation', async () => {
  console.log('⏰ Running morning motivation broadcast');
  for (const tid of await eachTenantIds()) {
    const members = await db.getMembers({ status: 'active', tenantId: tid });
    await automation.sendMorningMotivation(members, tid);
  }
}), { timezone: 'Asia/Kolkata' });

// 10:00 AM — Check payment reminders
cron.schedule('0 10 * * *', cronGuards('payment_reminders', async () => {
  console.log('⏰ Checking payment reminders');
  await payments.runPaymentReminderCron();
}), { timezone: 'Asia/Kolkata' });

// 6:00 PM — Evening check-up + missed session notice
cron.schedule('0 18 * * *', cronGuards('evening_engagement', async () => {
  console.log('⏰ Evening engagement check');
  for (const tid of await eachTenantIds()) {
    await automation.runEveningEngagement(tid);
  }
}), { timezone: 'Asia/Kolkata' });

// Sunday 8:00 AM — Weekly diet & workout plan
cron.schedule('0 8 * * 0', cronGuards('weekly_plans', async () => {
  console.log('⏰ Sending weekly plans');
  for (const tid of await eachTenantIds()) {
    await automation.sendWeeklyPlans(null, tid);
  }
}), { timezone: 'Asia/Kolkata' });

// Every day midnight — Birthday & milestone check
cron.schedule('0 0 * * *', cronGuards('milestones', async () => {
  console.log('⏰ Checking birthdays and milestones');
  for (const tid of await eachTenantIds()) {
    await automation.checkMilestonesAndBirthdays(tid);
  }
}), { timezone: 'Asia/Kolkata' });

// Every 7 days — Win-back lapsed members
cron.schedule('0 9 * * 1', cronGuards('winback', async () => {
  console.log('⏰ Running win-back campaign');
  for (const tid of await eachTenantIds()) {
    await automation.runWinBackCampaign(tid);
  }
}), { timezone: 'Asia/Kolkata' });

// ─────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  if (err && err.status === 400 && 'body' in err) {
    return res.status(400).send('Invalid JSON');
  }
  console.error(err);
  res.sendStatus(500);
});

const PORT = Number(process.env.PORT) || 3000;

process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection', reason);
});

// Bind all interfaces — required on Railway/Docker or the edge proxy returns 502
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 GymBot Pro listening on http://0.0.0.0:${PORT} (PORT env=${process.env.PORT ?? 'unset'})`);
  console.log(`📱 WhatsApp webhook: POST /webhook/whatsapp`);
  console.log(`💳 Payment webhook: POST /webhook/payment`);
  console.log(`❤️ Health: GET /health or HEAD /health`);
});

server.on('error', (err) => {
  console.error('Server failed to listen:', err);
});

module.exports = app;
