/**
 * GymBot Pro — Automation Engine
 * 
 * Brain of the entire system:
 * - Handles all incoming WhatsApp messages
 * - Triggers all automation flows
 * - Manages member conversation state
 */

const whatsapp = require('./whatsapp');
const db = require('./database');
const payments = require('./payments');

// ─────────────────────────────────────────
// CONVERSATION STATE MACHINE
// Bot remembers where each user is in conversation
// ─────────────────────────────────────────

const STATES = {
  IDLE: 'idle',
  AWAITING_MENU_CHOICE: 'awaiting_menu',
  AWAITING_BATCH_CHOICE: 'awaiting_batch',
  AWAITING_PAUSE_CONFIRM: 'awaiting_pause_confirm',
  AWAITING_PAUSE_DAYS: 'awaiting_pause_days',
  AWAITING_TRAINER_QUERY: 'awaiting_trainer_query',
};

/**
 * Main entry point for all incoming WhatsApp messages
 */
async function handleIncomingMessage({ phone, text, msgType, msg, member }) {
  // Mark as read
  if (msg.id) await whatsapp.markAsRead(msg.id);

  // New number — not a member
  if (!member) {
    return await handleUnknownContact(phone, text);
  }

  // Handle interactive replies (button/list)
  if (msgType === 'interactive') {
    const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
    if (reply) {
      return await handleInteractiveReply({ phone, member, replyId: reply.id, replyTitle: reply.title });
    }
  }

  // Get conversation state
  const state = await db.getConversationState(phone);

  // Route based on state first, then keywords
  if (state === STATES.AWAITING_BATCH_CHOICE) {
    return await handleBatchChange(member, text);
  }
  if (state === STATES.AWAITING_PAUSE_DAYS) {
    return await handlePauseDaysInput(member, text);
  }
  if (state === STATES.AWAITING_PAUSE_CONFIRM) {
    return await handlePauseConfirm(member, text);
  }
  if (state === STATES.AWAITING_TRAINER_QUERY) {
    return await handleTrainerQuery(member, text);
  }

  // Keyword routing
  return await routeByKeyword(phone, text, member);
}

/**
 * Route messages by keyword
 */
async function routeByKeyword(phone, text, member) {
  const t = text.toLowerCase();

  if (matchAny(t, ['hi', 'hello', 'hey', 'menu', 'help', 'start'])) {
    return await whatsapp.sendMainMenu(phone, member.name);
  }
  if (matchAny(t, ['status', 'membership', 'expiry', 'expire', 'valid'])) {
    return await sendMemberStatus(member);
  }
  if (matchAny(t, ['renew', 'pay', 'payment', 'extend'])) {
    return await payments.sendPaymentReminder(member);
  }
  if (matchAny(t, ['workout', 'exercise', 'today', 'gym today'])) {
    return await sendTodaysWorkout(member);
  }
  if (matchAny(t, ['diet', 'food', 'nutrition', 'meal', 'eat'])) {
    return await sendDietInfo(member);
  }
  if (matchAny(t, ['trainer', 'coach', 'staff'])) {
    await db.setConversationState(phone, STATES.AWAITING_TRAINER_QUERY);
    return await whatsapp.sendText(phone, '💬 Sure! Type your message for your trainer and I\'ll forward it right away.');
  }
  if (matchAny(t, ['timing', 'schedule', 'batch', 'time'])) {
    return await sendGymTimings(member);
  }
  if (matchAny(t, ['pause', 'freeze', 'hold', 'leave'])) {
    await db.setConversationState(phone, STATES.AWAITING_PAUSE_CONFIRM);
    return await whatsapp.sendButtons(phone, {
      body: `⏸️ Want to pause your membership?\n\nWe'll freeze your remaining days and resume when you're back. How many days do you need off?`,
      buttons: [
        { id: 'pause_yes', title: '✅ Yes, Pause' },
        { id: 'pause_no', title: '❌ No, Cancel' },
      ],
    });
  }
  if (matchAny(t, ['progress', 'track', 'result', 'weight'])) {
    return await sendProgressInfo(member);
  }
  if (matchAny(t, ['bye', 'ok', 'okay', 'thanks', 'thank you', 'done'])) {
    return await whatsapp.sendText(phone, `💪 Anytime, ${member.name.split(' ')[0]}! Keep crushing it. See you at the gym! 🔥`);
  }

  // Default — show menu
  return await whatsapp.sendMainMenu(phone, member.name);
}

/**
 * Handle interactive button/list replies
 */
async function handleInteractiveReply({ phone, member, replyId, replyTitle }) {
  switch (replyId) {
    case 'check_status':
      return await sendMemberStatus(member);

    case 'renew_plan':
      return await payments.sendPaymentReminder(member);

    case 'change_batch':
      await db.setConversationState(phone, STATES.AWAITING_BATCH_CHOICE);
      return await whatsapp.sendButtons(phone, {
        header: '⏰ Choose Your Batch',
        body: 'Select the timing that works best for you:',
        buttons: [
          { id: 'batch_6am', title: '🌅 6:00 AM' },
          { id: 'batch_7am', title: '🌄 7:00 AM' },
          { id: 'batch_8am', title: '☀️ 8:00 AM' },
        ],
      });

    case 'batch_6am': return await confirmBatchChange(member, '6:00 AM');
    case 'batch_7am': return await confirmBatchChange(member, '7:00 AM');
    case 'batch_8am': return await confirmBatchChange(member, '8:00 AM');

    case 'todays_workout':
      return await sendTodaysWorkout(member);

    case 'diet_plan':
      return await sendDietInfo(member);

    case 'progress':
      return await sendProgressInfo(member);

    case 'talk_trainer':
      await db.setConversationState(phone, STATES.AWAITING_TRAINER_QUERY);
      return await whatsapp.sendText(phone, '💬 Type your question for your trainer and I\'ll pass it on!');

    case 'gym_timings':
      return await sendGymTimings(member);

    case 'pause_membership':
      await db.setConversationState(phone, STATES.AWAITING_PAUSE_CONFIRM);
      return await whatsapp.sendButtons(phone, {
        body: '⏸️ Want to pause your membership? We\'ll freeze your remaining days.',
        buttons: [
          { id: 'pause_yes', title: '✅ Yes, Pause It' },
          { id: 'pause_no', title: '❌ No Thanks' },
        ],
      });

    case 'pause_yes':
      await db.setConversationState(phone, STATES.AWAITING_PAUSE_DAYS);
      return await whatsapp.sendText(phone, '📅 How many days do you need to pause? (1–30 days)\n\nJust type the number, e.g. *7*');

    case 'pause_no':
      await db.setConversationState(phone, STATES.IDLE);
      return await whatsapp.sendText(phone, '✅ No problem! Your membership continues as normal. 💪');

    default:
      return await whatsapp.sendMainMenu(phone, member.name);
  }
}

// ─────────────────────────────────────────
// SPECIFIC RESPONSE HANDLERS
// ─────────────────────────────────────────

async function sendMemberStatus(member) {
  const daysLeft = getDaysLeft(member.expiryDate);
  const statusEmoji = daysLeft > 7 ? '✅' : daysLeft > 0 ? '⚠️' : '❌';
  const statusText = daysLeft > 7 ? 'Active' : daysLeft > 0 ? `Expires in ${daysLeft} days!` : 'Expired';

  const msg = `${statusEmoji} *Membership Status*\n\n` +
    `👤 Name: ${member.name}\n` +
    `📋 Plan: ${member.planName}\n` +
    `📅 Expires: ${formatDate(member.expiryDate)}\n` +
    `⏳ Days Left: *${daysLeft > 0 ? daysLeft : 0} days*\n` +
    `🏋️ Batch: ${member.batchTime}\n` +
    `👨‍🏫 Trainer: ${member.trainerName}\n\n` +
    `Status: *${statusText}*`;

  await whatsapp.sendText(member.phone, msg);

  if (daysLeft <= 7 && daysLeft > 0) {
    await delay(1500);
    await payments.sendPaymentReminder(member);
  }
}

async function sendTodaysWorkout(member) {
  const day = new Date().getDay();
  const workouts = getWorkoutSchedule(member.fitnessGoal || 'general');
  const todayWorkout = workouts[day];

  const exerciseList = todayWorkout.exercises.map((e, i) =>
    `${i + 1}. *${e.name}* — ${e.sets} sets × ${e.reps}`
  ).join('\n');

  return await whatsapp.sendText(member.phone,
    `💪 *Today's Workout — ${todayWorkout.focus}*\n\n${exerciseList}\n\n` +
    `🔥 Pro tip: ${todayWorkout.tip}\n\n` +
    `💧 Remember: 3 litres water today!\n` +
    `⏰ Your batch: *${member.batchTime}*`
  );
}

async function sendDietInfo(member) {
  const goal = member.fitnessGoal || 'general';
  const diet = getDietRecommendation(goal);

  return await whatsapp.sendText(member.phone,
    `🥗 *Your Diet Plan — ${capitalise(goal)} Goal*\n\n` +
    `🌅 *Breakfast:* ${diet.breakfast}\n` +
    `☀️ *Lunch:* ${diet.lunch}\n` +
    `🌙 *Dinner:* ${diet.dinner}\n` +
    `🍎 *Snacks:* ${diet.snacks}\n\n` +
    `💊 Supplements: ${diet.supplements}\n\n` +
    `_Your weekly detailed plan is sent every Sunday! Reply DIET for PDF_ 📄`
  );
}

async function sendGymTimings(member) {
  return await whatsapp.sendText(member.phone,
    `🕐 *Gym Schedule*\n\n` +
    `🌅 Batch 1: 6:00 AM – 7:00 AM\n` +
    `🌄 Batch 2: 7:00 AM – 8:00 AM\n` +
    `☀️ Batch 3: 8:00 AM – 9:00 AM\n` +
    `🏋️ Open Gym: 9:00 AM – 12:00 PM\n` +
    `🌆 Evening 1: 5:00 PM – 6:00 PM\n` +
    `🌇 Evening 2: 6:00 PM – 7:00 PM\n` +
    `🌃 Evening 3: 7:00 PM – 8:00 PM\n\n` +
    `📍 Your current batch: *${member.batchTime}*\n\n` +
    `To change batch, reply *BATCH*`
  );
}

async function sendProgressInfo(member) {
  return await whatsapp.sendText(member.phone,
    `📊 *Your Progress — ${member.name.split(' ')[0]}*\n\n` +
    `📅 Member since: ${formatDate(member.joinDate)}\n` +
    `🔢 Days completed: *${getDaysCompleted(member.joinDate)}*\n` +
    `✅ Sessions attended: ${member.sessionsAttended || '—'}\n` +
    `🎯 Goal: ${capitalise(member.fitnessGoal || 'General Fitness')}\n\n` +
    `📈 For detailed progress tracking including weight, measurements & photos, visit your profile at:\n` +
    `${process.env.GYM_WEBSITE}/progress/${member.id}\n\n` +
    `💪 Keep going ${member.name.split(' ')[0]}! Consistency is key!`
  );
}

async function handleTrainerQuery(member, text) {
  const trainer = await db.getTrainer(member.trainerId);
  if (trainer) {
    await whatsapp.sendText(trainer.phone,
      `📩 *Message from member: ${member.name}*\n\n"${text}"\n\nReply to this to connect with them.`
    );
  }
  await db.setConversationState(member.phone, STATES.IDLE);
  return await whatsapp.sendText(member.phone,
    `✅ Your message has been sent to ${trainer?.name || 'your trainer'}! They'll reply shortly. 💬`
  );
}

async function handlePauseDaysInput(member, text) {
  const days = parseInt(text);
  if (isNaN(days) || days < 1 || days > 30) {
    return await whatsapp.sendText(member.phone, '❌ Please enter a number between 1 and 30.');
  }
  const newExpiry = new Date(member.expiryDate);
  newExpiry.setDate(newExpiry.getDate() + days);
  await db.updateMember(member.id, {
    pausedUntil: new Date(Date.now() + days * 86400000),
    expiryDate: newExpiry,
    status: 'paused',
  });
  await db.setConversationState(member.phone, STATES.IDLE);
  return await whatsapp.sendText(member.phone,
    `⏸️ *Membership Paused!*\n\n` +
    `Your ${days}-day pause has been set.\n` +
    `Your membership resumes automatically on *${formatDate(newExpiry)}*\n\n` +
    `Take care and we'll see you back! 💪`
  );
}

async function handlePauseConfirm(member, text) {
  await db.setConversationState(member.phone, STATES.IDLE);
  return await whatsapp.sendText(member.phone, '✅ No problem! Membership continues normally.');
}

async function confirmBatchChange(member, newBatch) {
  await db.updateMember(member.id, { batchTime: newBatch });
  await db.setConversationState(member.phone, STATES.IDLE);
  return await whatsapp.sendText(member.phone,
    `✅ *Batch Updated!*\n\nYou've been moved to the *${newBatch}* batch starting tomorrow.\n\n` +
    `Our trainer will confirm your spot. See you then! 💪`
  );
}

async function handleUnknownContact(phone, text) {
  return await whatsapp.sendText(phone,
    `👋 Hi there! Welcome to *${process.env.GYM_NAME || 'GymBot Pro'}!*\n\n` +
    `I don't have your details yet. To get started:\n` +
    `1️⃣ Visit our gym to register\n` +
    `2️⃣ Or call us: ${process.env.GYM_PHONE}\n` +
    `3️⃣ Or visit: ${process.env.GYM_WEBSITE}\n\n` +
    `💪 We'd love to have you on your fitness journey!`
  );
}

// ─────────────────────────────────────────
// SCHEDULED AUTOMATION TRIGGERS
// ─────────────────────────────────────────

async function triggerOnboarding(member) {
  console.log(`🚀 Triggering onboarding for ${member.name}`);
  await whatsapp.sendWelcomeAndIntakeForm(member);
  await db.logAutomation(member.id, 'onboarding_started');
}

async function handleNewMemberFormSubmission(formData) {
  const phone = cleanPhone(formData.phone);
  const member = await db.getMemberByPhone(phone);
  if (!member) {
    console.warn('Form webhook: no member in DB for phone', phone, '(member must exist before form submit)');
    return { ok: false, reason: 'member_not_found' };
  }

  // Update member from form data
  await db.updateMember(member.id, {
    fitnessGoal: formData.goal,
    healthIssues: formData.healthIssues,
    age: formData.age,
    weight: formData.weight,
    height: formData.height,
    status: 'active',
    formSubmittedAt: new Date(),
  });

  // Assign trainer based on goal
  const trainer = await db.assignTrainer(member.id, formData.goal);

  // Small delay then send confirmation
  await delay(2000);
  await whatsapp.sendMembershipConfirmation({
    ...member,
    trainerName: trainer?.name,
    planName: getPlanName(member.plan),
  });

  return { ok: true, memberId: member.id };
}

async function sendMorningMotivation(members) {
  const quotes = getMorningQuotes();
  let sent = 0;

  for (const member of members) {
    try {
      const quote = quotes[Math.floor(Math.random() * quotes.length)];
      const workout = getDayFocus(new Date().getDay());
      await whatsapp.sendMorningMotivation(member, {
        quote,
        workoutFocus: workout,
        batchTime: member.batchTime,
      });
      sent++;
      await delay(300); // Rate limit: ~3/sec
    } catch (err) {
      console.error(`Failed morning msg for ${member.name}:`, err.message);
    }
  }

  console.log(`✅ Morning motivation sent to ${sent} members`);
}

async function sendWeeklyPlans(members) {
  if (!members) members = await db.getMembers({ status: 'active' });
  let sent = 0;

  for (const member of members) {
    try {
      const dietUrl = await getDietPlanUrl(member);
      await whatsapp.sendWeeklyDietPlan(member, dietUrl);
      sent++;
      await delay(500);
    } catch (err) {
      console.error(`Failed weekly plan for ${member.name}:`, err.message);
    }
  }

  console.log(`✅ Weekly plans sent to ${sent} members`);
}

async function checkMilestonesAndBirthdays() {
  const today = new Date();
  const members = await db.getMembers({ status: 'active' });

  for (const member of members) {
    try {
      // Birthday check
      const dob = new Date(member.dob);
      if (dob.getDate() === today.getDate() && dob.getMonth() === today.getMonth()) {
        await whatsapp.sendBirthdayGreeting(member);
      }

      // Milestone check
      const daysCompleted = getDaysCompleted(member.joinDate);
      const milestones = [7, 30, 60, 90, 180, 365];
      if (milestones.includes(daysCompleted)) {
        const achievement = getMilestoneAchievement(daysCompleted);
        await whatsapp.sendMilestone(member, { days: daysCompleted, achievement });
      }

      await delay(300);
    } catch (err) {
      console.error(`Milestone check failed for ${member.name}:`, err.message);
    }
  }
}

async function runEveningEngagement() {
  const members = await db.getMembers({ status: 'active' });
  const absentToday = members.filter(m => !m.checkedInToday);

  for (const member of absentToday) {
    try {
      await whatsapp.sendText(member.phone,
        `Hey ${member.name.split(' ')[0]}! 👋 Missed you at the gym today.\n\n` +
        `💪 No worries — tomorrow is a fresh start! Your *${member.batchTime}* batch awaits.\n\n` +
        `Remember: Every session counts! 🔥`
      );
      await delay(400);
    } catch (err) {
      console.error(`Evening msg failed for ${member.name}:`, err.message);
    }
  }
}

async function runWinBackCampaign() {
  const lapsedMembers = await db.getMembers({ status: 'expired', expiredDaysAgo: 7 });

  for (const member of lapsedMembers) {
    try {
      const offerCode = `WIN${member.id.slice(-4).toUpperCase()}`;
      await whatsapp.sendWinBackMessage(member, offerCode);
      await db.logAutomation(member.id, 'winback_sent');
      await delay(500);
    } catch (err) {
      console.error(`Win-back failed for ${member.name}:`, err.message);
    }
  }
}

async function broadcastMessage(members, templateName, variables) {
  const results = [];
  for (const member of members) {
    try {
      const result = await whatsapp.sendTemplate(member.phone, templateName, variables);
      results.push({ memberId: member.id, ...result });
      await delay(300);
    } catch (err) {
      results.push({ memberId: member.id, success: false, error: err.message });
    }
  }
  return results;
}

// ─────────────────────────────────────────
// DATA HELPERS
// ─────────────────────────────────────────

function getWorkoutSchedule(goal) {
  const base = {
    0: { focus: 'Rest & Recovery', tip: 'Light stretching or yoga today!', exercises: [{ name: 'Full Body Stretch', sets: 3, reps: '60s hold' }, { name: 'Foam Rolling', sets: 1, reps: '15 min' }] },
    1: { focus: 'Chest & Triceps', tip: 'Focus on mind-muscle connection!', exercises: [{ name: 'Bench Press', sets: 4, reps: 10 }, { name: 'Incline DB Press', sets: 3, reps: 12 }, { name: 'Cable Flyes', sets: 3, reps: 15 }, { name: 'Tricep Dips', sets: 3, reps: 12 }, { name: 'Skull Crushers', sets: 3, reps: 12 }] },
    2: { focus: 'Back & Biceps', tip: 'Drive with your elbows on rows!', exercises: [{ name: 'Deadlifts', sets: 4, reps: 8 }, { name: 'Pull-ups', sets: 3, reps: 10 }, { name: 'Barbell Row', sets: 3, reps: 12 }, { name: 'Barbell Curls', sets: 3, reps: 12 }, { name: 'Hammer Curls', sets: 3, reps: 15 }] },
    3: { focus: 'Legs & Glutes', tip: 'Go deep on squats for max gains!', exercises: [{ name: 'Squats', sets: 4, reps: 10 }, { name: 'Leg Press', sets: 3, reps: 12 }, { name: 'Romanian Deadlift', sets: 3, reps: 12 }, { name: 'Leg Curls', sets: 3, reps: 15 }, { name: 'Calf Raises', sets: 4, reps: 20 }] },
    4: { focus: 'Shoulders & Abs', tip: 'Control the weight on laterals!', exercises: [{ name: 'Military Press', sets: 4, reps: 10 }, { name: 'Lateral Raises', sets: 3, reps: 15 }, { name: 'Front Raises', sets: 3, reps: 12 }, { name: 'Plank', sets: 3, reps: '60s' }, { name: 'Cable Crunches', sets: 3, reps: 20 }] },
    5: { focus: 'Full Body HIIT', tip: 'Rest 30s between circuits!', exercises: [{ name: 'Burpees', sets: 4, reps: 12 }, { name: 'Box Jumps', sets: 3, reps: 10 }, { name: 'Battle Ropes', sets: 3, reps: '30s' }, { name: 'KB Swings', sets: 3, reps: 20 }, { name: 'Sprint Intervals', sets: 6, reps: '20s on/40s off' }] },
    6: { focus: 'Active Recovery', tip: 'A 30-min walk counts as training!', exercises: [{ name: 'Light Cardio', sets: 1, reps: '20 min' }, { name: 'Stretching', sets: 1, reps: '15 min' }] },
  };
  return base;
}

function getDietRecommendation(goal) {
  const plans = {
    weightloss: {
      breakfast: 'Oats + 3 egg whites + green tea',
      lunch: 'Brown rice (1 cup) + grilled chicken + salad',
      dinner: 'Dal + sabzi + 2 rotis',
      snacks: 'Fruit + handful almonds',
      supplements: 'Protein shake (post workout), Multivitamin',
    },
    muscle: {
      breakfast: '5 whole eggs + oats + banana + milk',
      lunch: 'White rice + chicken breast + dal',
      dinner: 'Paneer/eggs + rotis + sabzi',
      snacks: 'Mass gainer shake, peanut butter banana toast',
      supplements: 'Whey protein, Creatine 5g, BCAA',
    },
    general: {
      breakfast: '2 eggs + toast + fruit',
      lunch: 'Balanced thali: rice/roti + dal + sabzi',
      dinner: 'Light: soup + salad + protein',
      snacks: 'Nuts, fruits, yogurt',
      supplements: 'Multivitamin, Omega-3',
    },
  };
  return plans[goal] || plans.general;
}

function getMorningQuotes() {
  return [
    'The only bad workout is the one that didn\'t happen! 💪',
    'Success starts the moment you decide to begin. Start NOW! 🔥',
    'Your body can do it. It\'s your mind you need to convince! 🧠',
    'Every rep brings you closer to your goal. Don\'t stop! 💯',
    'Champions aren\'t born. They\'re built in the gym, one rep at a time! 🏆',
    'Pain is temporary. Pride is forever. Let\'s GO! 🔥',
    'The difference between try and triumph is a little umph! 💪',
    'Rise & grind! Today is another chance to get stronger! ⚡',
  ];
}

function getMilestoneAchievement(days) {
  const map = {
    7: 'completed your first full week — you\'re officially on track!',
    30: 'hit 30 days! Habits are forming — you\'re unstoppable!',
    60: 'crushed 60 days! You\'re in the top 20% of members!',
    90: 'smashed 90 days! 3 months strong — you\'re a gym warrior!',
    180: 'completed 6 months! You are an absolute fitness champion!',
    365: 'completed ONE FULL YEAR! You\'re a true legend! 🏆',
  };
  return map[days] || `completed ${days} amazing days!`;
}

function getDayFocus(dayNum) {
  const days = ['Rest & Recovery', 'Chest & Triceps', 'Back & Biceps', 'Legs', 'Shoulders & Abs', 'Full Body HIIT', 'Active Recovery'];
  return days[dayNum];
}

async function getDietPlanUrl(member) {
  return `${process.env.CDN_URL}/diet-plans/${member.fitnessGoal || 'general'}-week.pdf`;
}

function getPlanName(plan) {
  return { monthly: 'Monthly Plan', '3month': '3-Month Plan', '6month': '6-Month Plan', annual: 'Annual Plan' }[plan] || plan;
}

function getDaysLeft(expiryDate) {
  return Math.ceil((new Date(expiryDate) - Date.now()) / 86400000);
}

function getDaysCompleted(joinDate) {
  return Math.floor((Date.now() - new Date(joinDate)) / 86400000);
}

function matchAny(text, keywords) {
  return keywords.some(k => text.includes(k));
}

function cleanPhone(phone) {
  return String(phone).replace(/[\s+\-]/g, '');
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  handleIncomingMessage,
  triggerOnboarding,
  handleNewMemberFormSubmission,
  sendMorningMotivation,
  sendWeeklyPlans,
  checkMilestonesAndBirthdays,
  runEveningEngagement,
  runWinBackCampaign,
  broadcastMessage,
};
