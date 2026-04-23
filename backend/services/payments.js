/**
 * GymBot Pro — Payment Service
 * Razorpay integration for payment link generation + auto-reminders
 */

const Razorpay = require('razorpay');
const db = require('./database');
const whatsapp = require('./whatsapp');
const gymConfig = require('./gymConfig');
const { defaultTenantId } = require('../lib/defaultTenant');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const PLAN_DEFAULTS = {
  monthly:  { amount: 1999,  name: 'Monthly Plan',   days: 30  },
  '3month': { amount: 4999,  name: '3-Month Plan',   days: 90  },
  '6month': { amount: 7999,  name: '6-Month Plan',   days: 180 },
  annual:   { amount: 14999, name: 'Annual Plan',     days: 365 },
};

/**
 * Create a Razorpay payment link and send via WhatsApp
 */
async function sendPaymentReminder(member, reminderNum = 1) {
  const rc = await gymConfig.getRuntimeConfig(member.tenantId || defaultTenantId());
  const planTable = { ...PLAN_DEFAULTS, ...rc.planPrices };
  const plan = planTable[member.plan] || planTable.monthly;
  const brand = rc.brandName || process.env.GYM_NAME || 'Gym';

  const paymentLink = await razorpay.paymentLink.create({
    amount: plan.amount * 100, // paise
    currency: 'INR',
    description: `${brand} — ${plan.name}`,
    customer: {
      name: member.name,
      contact: `+91${member.phone}`,
    },
    notify: { sms: false, email: false }, // We handle WA
    reminder_enable: false,               // We handle reminders
    notes: {
      member_id: member.id,
      plan: member.plan,
    },
    callback_url: `${process.env.SERVER_URL}/webhook/payment`,
    callback_method: 'get',
    expire_by: Math.floor(Date.now() / 1000) + 7 * 86400, // 7 days
  });

  // Send via WhatsApp
  await whatsapp.sendPaymentLink(member, {
    amount: plan.amount,
    planName: plan.name,
    paymentLink: paymentLink.short_url,
    reminderNum,
  });

  // Log reminder
  await db.logPaymentReminder(member.id, {
    reminderNum,
    paymentLinkId: paymentLink.id,
    amount: plan.amount,
    sentAt: new Date(),
  });

  console.log(`💳 Payment reminder #${reminderNum} sent to ${member.name}: ${paymentLink.short_url}`);
  return paymentLink;
}

/**
 * Handle successful payment (called from webhook)
 */
async function handleSuccessfulPayment({ memberId, amount, paymentId }) {
  const member = await db.getMemberById(memberId);
  if (!member) return;

  const rc = await gymConfig.getRuntimeConfig(member.tenantId || defaultTenantId());
  const planTable = { ...PLAN_DEFAULTS, ...rc.planPrices };
  const plan = planTable[member.plan] || planTable.monthly;

  // Calculate new expiry
  const currentExpiry = new Date(member.expiryDate);
  const newExpiry = currentExpiry > new Date()
    ? new Date(currentExpiry.getTime() + plan.days * 86400000)
    : new Date(Date.now() + plan.days * 86400000);

  // Update member
  await db.updateMember(memberId, {
    expiryDate: newExpiry,
    status: 'active',
    lastPaymentDate: new Date(),
    lastPaymentAmount: amount,
    lastPaymentId: paymentId,
  });

  // Generate receipt URL
  const receiptUrl = `${process.env.SERVER_URL}/receipt/${paymentId}`;

  // Send confirmation via WhatsApp
  await whatsapp.sendPaymentSuccess(member, {
    amount,
    newExpiry,
    receiptUrl,
  });

  await db.logAutomation(memberId, 'payment_received', { amount, paymentId });
  console.log(`✅ Payment processed: ${member.name} — ₹${amount}`);
}

/** Run the payment / expiry flow for a single tenant */
async function runPaymentRemindersForTenant(tenantId) {
  const rc = await gymConfig.getRuntimeConfig(tenantId);
  if (rc.automations && rc.automations.paymentReminders === false) {
    console.log('⏭️ Payment reminder cron skipped (disabled in config) tenant', tenantId);
    return;
  }

  const expIn7 = await db.getMembersExpiringInDays(7, tenantId);
  for (const member of expIn7) {
    if (!member.reminder1SentAt) {
      await sendPaymentReminder(member, 1);
      await delay(500);
    }
  }

  const expIn3 = await db.getMembersExpiringInDays(3, tenantId);
  for (const member of expIn3) {
    if (member.reminder1SentAt && !member.reminder2SentAt) {
      await sendPaymentReminder(member, 2);
      await delay(500);
    }
  }

  const expIn1 = await db.getMembersExpiringInDays(1, tenantId);
  for (const member of expIn1) {
    if (member.reminder2SentAt && !member.reminder3SentAt) {
      await sendPaymentReminder(member, 3);
      await delay(500);
    }
  }

  const expiredToday = await db.getMembersExpiredToday(tenantId);
  for (const member of expiredToday) {
    await db.updateMember(member.id, { status: 'expired' });
    await whatsapp.sendText(member.phone,
      `⚠️ *Membership Expired*\n\n` +
      `Hi ${member.name.split(' ')[0]}, your membership expired today.\n\n` +
      `Renew now to continue your fitness journey! 💪\n` +
      `Reply *RENEW* to get your payment link instantly.`
    );
    await delay(500);
  }

  console.log(
    `✅ Payment reminder cron tenant ${tenantId}: 7d=${expIn7.length} 3d=${expIn3.length} 1d=${expIn1.length} expiredToday=${expiredToday.length}`
  );
}

/**
 * Daily cron: Check who needs payment reminders (all active tenants)
 */
async function runPaymentReminderCron() {
  let list = await db.listActiveTenants();
  if (!list || !list.length) {
    list = [{ id: defaultTenantId() }];
  }
  for (const t of list) {
    await runPaymentRemindersForTenant(t.id);
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  sendPaymentReminder,
  handleSuccessfulPayment,
  runPaymentReminderCron,
  PLAN_PRICES: PLAN_DEFAULTS,
};
