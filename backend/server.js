/**
 * GymBot Pro — Main Backend Server
 * Node.js + Express + WhatsApp Business API
 *
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
  res.sendStatus(200); // Always 200 immediately to Meta

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages) return;

    for (const msg of value.messages) {
      const phone = msg.from; // e.g. "919876543210"
      const text = msg.text?.body?.toLowerCase().trim() || '';
      const msgType = msg.type;

      console.log(`📩 Message from ${phone}: "${text}"`);

      // Load or create member
      let member = await db.getMemberByPhone(phone);

      // Route to bot handler
      await automation.handleIncomingMessage({ phone, text, msgType, msg, member });
    }
  } catch (err) {
    console.error('Webhook error:', err);
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
    const formData = req.body;
    const result = await automation.handleNewMemberFormSubmission(formData);
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
    const { status, page = 1, limit = 50 } = req.query;
    const members = await db.getMembers({ status, page, limit });
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
    const member = await db.createMember(req.body);
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
    const { filter, templateName, variables } = req.body;
    const members = await db.getMembers(filter);
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
    const stats = await db.getAnalyticsOverview();
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
// CRON JOBS — Automated scheduled tasks
// ─────────────────────────────────────────

// 6:00 AM — Morning motivation blast
cron.schedule('0 6 * * *', async () => {
  console.log('⏰ Running morning motivation broadcast');
  const members = await db.getMembers({ status: 'active' });
  await automation.sendMorningMotivation(members);
}, { timezone: 'Asia/Kolkata' });

// 10:00 AM — Check payment reminders
cron.schedule('0 10 * * *', async () => {
  console.log('⏰ Checking payment reminders');
  await payments.runPaymentReminderCron();
}, { timezone: 'Asia/Kolkata' });

// 6:00 PM — Evening check-up + missed session notice
cron.schedule('0 18 * * *', async () => {
  console.log('⏰ Evening engagement check');
  await automation.runEveningEngagement();
}, { timezone: 'Asia/Kolkata' });

// Sunday 8:00 AM — Weekly diet & workout plan
cron.schedule('0 8 * * 0', async () => {
  console.log('⏰ Sending weekly plans');
  await automation.sendWeeklyPlans();
}, { timezone: 'Asia/Kolkata' });

// Every day midnight — Birthday & milestone check
cron.schedule('0 0 * * *', async () => {
  console.log('⏰ Checking birthdays and milestones');
  await automation.checkMilestonesAndBirthdays();
}, { timezone: 'Asia/Kolkata' });

// Every 7 days — Win-back lapsed members
cron.schedule('0 9 * * 1', async () => {
  console.log('⏰ Running win-back campaign');
  await automation.runWinBackCampaign();
}, { timezone: 'Asia/Kolkata' });

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
