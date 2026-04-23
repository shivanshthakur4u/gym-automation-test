/**
 * GymBot Pro — WhatsApp Business API Service
 * Uses Meta's official WhatsApp Business API
 * 
 * Handles: Template messages, free-form text, interactive buttons, lists
 */

const axios = require('axios');

const WA_API_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}`;
const HEADERS = {
  Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
};

// Must match template language in WhatsApp Manager (e.g. en, en_US, hi). Wrong locale → (#132001)
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';

// ─────────────────────────────────────────
// CORE SEND FUNCTIONS
// ─────────────────────────────────────────

/**
 * Send a pre-approved WhatsApp Template message
 * Templates must be approved by Meta before use
 */
async function sendTemplate(phone, templateName, components = [], language = TEMPLATE_LANG) {
  const payload = {
    messaging_product: 'whatsapp',
    to: formatPhone(phone),
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components,
    },
  };

  return await sendRequest(payload);
}

/**
 * Send a plain text message (only within 24hr customer-initiated window)
 */
async function sendText(phone, text) {
  const payload = {
    messaging_product: 'whatsapp',
    to: formatPhone(phone),
    type: 'text',
    text: { body: text, preview_url: false },
  };

  return await sendRequest(payload);
}

/**
 * Send interactive message with quick-reply buttons
 */
async function sendButtons(phone, { header, body, footer, buttons }) {
  const payload = {
    messaging_product: 'whatsapp',
    to: formatPhone(phone),
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(header && { header: { type: 'text', text: header } }),
      body: { text: body },
      ...(footer && { footer: { text: footer } }),
      action: {
        buttons: buttons.map((b, i) => ({
          type: 'reply',
          reply: { id: b.id || `btn_${i}`, title: b.title },
        })),
      },
    },
  };

  return await sendRequest(payload);
}

/**
 * Send interactive list message (for menus)
 */
async function sendList(phone, { header, body, footer, buttonText, sections }) {
  const payload = {
    messaging_product: 'whatsapp',
    to: formatPhone(phone),
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(header && { header: { type: 'text', text: header } }),
      body: { text: body },
      ...(footer && { footer: { text: footer } }),
      action: {
        button: buttonText || 'Choose Option',
        sections,
      },
    },
  };

  return await sendRequest(payload);
}

/**
 * Send a document/PDF
 */
async function sendDocument(phone, { url, filename, caption }) {
  const payload = {
    messaging_product: 'whatsapp',
    to: formatPhone(phone),
    type: 'document',
    document: { link: url, filename, caption },
  };

  return await sendRequest(payload);
}

/**
 * Send an image
 */
async function sendImage(phone, { url, caption }) {
  const payload = {
    messaging_product: 'whatsapp',
    to: formatPhone(phone),
    type: 'image',
    image: { link: url, caption },
  };

  return await sendRequest(payload);
}

/**
 * Mark a message as read
 */
async function markAsRead(messageId) {
  const payload = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  };
  return await sendRequest(payload);
}

// ─────────────────────────────────────────
// GYM-SPECIFIC MESSAGE BUILDERS
// ─────────────────────────────────────────

/**
 * Send new member welcome + intake form
 */
async function sendWelcomeAndIntakeForm(member, { intakeFormUrl } = {}) {
  const formUrl = intakeFormUrl || process.env.INTAKE_FORM_URL;
  return await sendTemplate(member.phone, 'gym_welcome_intake', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: member.name },
        { type: 'text', text: formUrl || 'https://example.com' },
      ],
    },
  ]);
}

/**
 * Send membership confirmation after form submission
 */
async function sendMembershipConfirmation(member) {
  return await sendTemplate(member.phone, 'membership_confirmed', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: member.name },
        { type: 'text', text: member.planName },
        { type: 'text', text: formatDate(member.expiryDate) },
        { type: 'text', text: member.trainerName || 'our team' },
        { type: 'text', text: member.batchTime || 'your preferred time' },
      ],
    },
  ]);
}

/**
 * Send payment link
 */
async function sendPaymentLink(member, { amount, planName, paymentLink, reminderNum }) {
  return await sendTemplate(member.phone, 'payment_reminder', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: member.name },
        { type: 'text', text: planName },
        { type: 'text', text: `₹${amount}` },
        { type: 'text', text: String(reminderNum) },
        { type: 'text', text: paymentLink },
      ],
    },
    {
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: paymentLink.split('/').pop() }],
    },
  ]);
}

/**
 * Send payment success confirmation
 */
async function sendPaymentSuccess(member, { amount, newExpiry, receiptUrl }) {
  return await sendTemplate(member.phone, 'payment_success', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: member.name },
        { type: 'text', text: `₹${amount}` },
        { type: 'text', text: formatDate(newExpiry) },
        { type: 'text', text: receiptUrl },
      ],
    },
  ]);
}

/**
 * Send morning motivation
 */
async function sendMorningMotivation(member, { quote, workoutFocus, batchTime }) {
  return await sendTemplate(member.phone, 'morning_motivation', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: member.name.split(' ')[0] },
        { type: 'text', text: quote },
        { type: 'text', text: workoutFocus },
        { type: 'text', text: batchTime || '7:00 AM' },
      ],
    },
  ]);
}

/**
 * Send workout plan for the day
 */
async function sendDailyWorkout(member, workoutPlan) {
  const workoutText = workoutPlan.exercises
    .map((e, i) => `${i + 1}. ${e.name} — ${e.sets}×${e.reps}`)
    .join('\n');

  return await sendText(
    member.phone,
    `💪 *Today's Workout — ${workoutPlan.focus}*\n\n${workoutText}\n\n🔥 Tip: ${workoutPlan.tip}\n💧 Drink 3L water today!`
  );
}

/**
 * Send weekly diet plan (PDF)
 */
async function sendWeeklyDietPlan(member, dietPlanUrl) {
  return await sendDocument(member.phone, {
    url: dietPlanUrl,
    filename: `diet-plan-week-${getCurrentWeek()}.pdf`,
    caption: `🥗 *Your Personalised Diet Plan — Week ${getCurrentWeek()}*\n\nHi ${member.name.split(' ')[0]}! Follow this plan for best results. Questions? Reply here! 💬`,
  });
}

/**
 * Send milestone celebration
 */
async function sendMilestone(member, { days, achievement }) {
  return await sendTemplate(member.phone, 'milestone_celebration', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: member.name.split(' ')[0] },
        { type: 'text', text: String(days) },
        { type: 'text', text: achievement },
      ],
    },
  ]);
}

/**
 * Send win-back message to lapsed member
 */
async function sendWinBackMessage(member, offerCode) {
  return await sendTemplate(member.phone, 'winback_offer', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: member.name.split(' ')[0] },
        { type: 'text', text: offerCode },
        { type: 'text', text: process.env.GYM_WEBSITE },
      ],
    },
  ]);
}

/**
 * Send birthday greeting
 */
async function sendBirthdayGreeting(member) {
  return await sendTemplate(member.phone, 'birthday_greeting', [
    {
      type: 'body',
      parameters: [{ type: 'text', text: member.name.split(' ')[0] }],
    },
  ]);
}

/**
 * Send main menu (interactive list)
 */
async function sendMainMenu(phone, memberName, { branding } = {}) {
  const title = branding?.botTitle || process.env.BOT_DISPLAY_NAME || 'GymBot Pro';
  const footer = branding?.footerText || 'Reply or choose an option below';
  return await sendList(phone, {
    header: `💪 ${title}`,
    body: `Hi ${memberName}! How can I help you today?`,
    footer,
    buttonText: 'Open Menu',
    sections: [
      {
        title: 'My Membership',
        rows: [
          { id: 'check_status', title: 'My Status', description: 'Check membership & expiry' },
          { id: 'renew_plan', title: 'Renew Plan', description: 'Pay & extend membership' },
          { id: 'change_batch', title: 'Change Batch', description: 'Switch timing/batch' },
        ],
      },
      {
        title: 'Fitness',
        rows: [
          { id: 'todays_workout', title: "Today's Workout", description: 'Get your workout plan' },
          { id: 'diet_plan', title: 'Diet Plan', description: 'Get your diet chart' },
          { id: 'progress', title: 'My Progress', description: 'Track your fitness journey' },
        ],
      },
      {
        title: 'Support',
        rows: [
          { id: 'talk_trainer', title: 'Talk to Trainer', description: 'Connect with your trainer' },
          { id: 'gym_timings', title: 'Gym Timings', description: 'View schedule & batches' },
          { id: 'pause_membership', title: 'Pause / Freeze', description: 'Temporarily pause membership' },
        ],
      },
    ],
  });
}

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

async function sendRequest(payload) {
  try {
    const { data } = await axios.post(`${WA_API_URL}/messages`, payload, { headers: HEADERS });
    console.log(`✅ WA message sent:`, data.messages?.[0]?.id);
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    console.error(`❌ WA send failed:`, errMsg);
    return { success: false, error: errMsg };
  }
}

function formatPhone(phone) {
  // Remove +, spaces, dashes; ensure country code
  const cleaned = String(phone).replace(/[\s+\-]/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) return cleaned;
  if (cleaned.length === 10) return `91${cleaned}`;
  return cleaned;
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function getCurrentWeek() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
}

module.exports = {
  sendTemplate,
  sendText,
  sendButtons,
  sendList,
  sendDocument,
  sendImage,
  markAsRead,
  sendWelcomeAndIntakeForm,
  sendMembershipConfirmation,
  sendPaymentLink,
  sendPaymentSuccess,
  sendMorningMotivation,
  sendDailyWorkout,
  sendWeeklyDietPlan,
  sendMilestone,
  sendWinBackMessage,
  sendBirthdayGreeting,
  sendMainMenu,
};
