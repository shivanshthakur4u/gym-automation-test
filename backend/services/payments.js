/**
 * GymBot Pro — Payment Service
 * Razorpay integration for payment link generation + auto-reminders
 */

const Razorpay = require('razorpay');
const db = require('./database');
const whatsapp = require('./whatsapp');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const PLAN_PRICES = {
  monthly:  { amount: 1999,  name: 'Monthly Plan',   days: 30  },
  '3month': { amount: 4999,  name: '3-Month Plan',   days: 90  },
  '6month': { amount: 7999,  name: '6-Month Plan',   days: 180 },
  annual:   { amount: 14999, name: 'Annual Plan',     days: 365 },
};

/**
 * Create a Razorpay payment link and send via WhatsApp
 */
async function sendPaymentReminder(member, reminderNum = 1) {
  const plan = PLAN_PRICES[member.plan] || PLAN_PRICES.monthly;

  // Create Razorpay payment link
  const paymentLink = await razorpay.paymentLink.create({
    amount: plan.amount * 100, // paise
    currency: 'INR',
    description: `${process.env.GYM_NAME} — ${plan.name}`,
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

  const plan = PLAN_PRICES[member.plan] || PLAN_PRICES.monthly;

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

/**
 * Daily cron: Check who needs payment reminders
 */
async function runPaymentReminderCron() {
  const today = new Date();

  // Members expiring in 7 days — reminder 1
  const expIn7 = await db.getMembersExpiringInDays(7);
  for (const member of expIn7) {
    if (!member.reminder1SentAt) {
      await sendPaymentReminder(member, 1);
      await delay(500);
    }
  }

  // Members expiring in 3 days — reminder 2
  const expIn3 = await db.getMembersExpiringInDays(3);
  for (const member of expIn3) {
    if (member.reminder1SentAt && !member.reminder2SentAt) {
      await sendPaymentReminder(member, 2);
      await delay(500);
    }
  }

  // Members expiring in 1 day — reminder 3 (urgent)
  const expIn1 = await db.getMembersExpiringInDays(1);
  for (const member of expIn1) {
    if (member.reminder2SentAt && !member.reminder3SentAt) {
      await sendPaymentReminder(member, 3);
      await delay(500);
    }
  }

  // Members expired today — freeze + notify
  const expiredToday = await db.getMembersExpiredToday();
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

  console.log(`✅ Payment reminder cron: ${expIn7.length + expIn3.length + expIn1.length} reminders sent`);
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  sendPaymentReminder,
  handleSuccessfulPayment,
  runPaymentReminderCron,
  PLAN_PRICES,
};
