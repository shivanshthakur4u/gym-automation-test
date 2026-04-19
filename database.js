/**
 * GymBot Pro — Database Service
 * Supabase (PostgreSQL) wrapper
 * Replace with your preferred DB (MongoDB, Firebase, etc.)
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─────────────────────────────────────────
// MEMBERS
// ─────────────────────────────────────────

async function getMemberByPhone(phone) {
  const cleaned = String(phone).replace(/[\s+\-]/g, '').replace(/^91/, '');
  const { data } = await supabase
    .from('members')
    .select('*')
    .or(`phone.eq.${cleaned},phone.eq.91${cleaned}`)
    .single();
  return data;
}

async function getMemberById(id) {
  const { data } = await supabase.from('members').select('*').eq('id', id).single();
  return data;
}

async function getMembers({ status, page = 1, limit = 50, expiredDaysAgo } = {}) {
  let query = supabase.from('members').select('*');

  if (status) query = query.eq('status', status);

  if (expiredDaysAgo) {
    const since = new Date(Date.now() - expiredDaysAgo * 86400000).toISOString();
    const until = new Date(Date.now() - (expiredDaysAgo - 1) * 86400000).toISOString();
    query = query.gte('expiry_date', since).lt('expiry_date', until);
  }

  query = query.range((page - 1) * limit, page * limit - 1);
  const { data } = await query;
  return data || [];
}

async function createMember(memberData) {
  const payload = {
    name: memberData.name,
    phone: cleanPhone(memberData.phone),
    email: memberData.email || null,
    plan: memberData.plan,
    plan_name: memberData.planName,
    join_date: new Date().toISOString(),
    expiry_date: calculateExpiry(memberData.plan),
    status: 'pending',
    batch_time: memberData.batchTime || '7:00 AM',
    fitness_goal: memberData.fitnessGoal || 'general',
    dob: memberData.dob || null,
    sessions_attended: 0,
    checked_in_today: false,
  };

  const { data, error } = await supabase.from('members').insert(payload).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateMember(id, updates) {
  const mapped = mapToSnakeCase(updates);
  const { data, error } = await supabase.from('members').update(mapped).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function getMembersExpiringInDays(days) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + days);
  const dateStr = targetDate.toISOString().split('T')[0];

  const { data } = await supabase
    .from('members')
    .select('*')
    .eq('status', 'active')
    .gte('expiry_date', `${dateStr}T00:00:00`)
    .lte('expiry_date', `${dateStr}T23:59:59`);

  return data || [];
}

async function getMembersExpiredToday() {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('members')
    .select('*')
    .eq('status', 'active')
    .gte('expiry_date', `${today}T00:00:00`)
    .lte('expiry_date', `${today}T23:59:59`);
  return data || [];
}

// ─────────────────────────────────────────
// TRAINERS
// ─────────────────────────────────────────

async function getTrainer(trainerId) {
  const { data } = await supabase.from('trainers').select('*').eq('id', trainerId).single();
  return data;
}

async function assignTrainer(memberId, goal) {
  // Find trainer with least load who specializes in the goal
  const { data: trainers } = await supabase
    .from('trainers')
    .select('*')
    .contains('specializations', [goal])
    .order('current_load', { ascending: true })
    .limit(1);

  const trainer = trainers?.[0];
  if (!trainer) return null;

  await supabase.from('members').update({ trainer_id: trainer.id }).eq('id', memberId);
  await supabase.from('trainers').update({ current_load: trainer.current_load + 1 }).eq('id', trainer.id);
  return trainer;
}

// ─────────────────────────────────────────
// CONVERSATION STATE
// ─────────────────────────────────────────

async function getConversationState(phone) {
  const { data } = await supabase
    .from('conversation_states')
    .select('state')
    .eq('phone', cleanPhone(phone))
    .single();
  return data?.state || 'idle';
}

async function setConversationState(phone, state) {
  const cleaned = cleanPhone(phone);
  await supabase.from('conversation_states').upsert(
    { phone: cleaned, state, updated_at: new Date().toISOString() },
    { onConflict: 'phone' }
  );
}

// ─────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────

async function getAnalyticsOverview() {
  const [
    { count: total },
    { count: active },
    { count: newThisMonth },
    { count: dueThisWeek },
  ] = await Promise.all([
    supabase.from('members').select('*', { count: 'exact', head: true }),
    supabase.from('members').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('members').select('*', { count: 'exact', head: true }).gte('join_date', getMonthStart()),
    supabase.from('members').select('*', { count: 'exact', head: true }).lte('expiry_date', getWeekEnd()).gte('expiry_date', new Date().toISOString()),
  ]);

  return { total, active, newThisMonth, dueThisWeek };
}

async function getMessageStats({ from, to } = {}) {
  let query = supabase.from('message_logs').select('*');
  if (from) query = query.gte('sent_at', from);
  if (to) query = query.lte('sent_at', to);
  const { data } = await query;
  return data || [];
}

// ─────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────

async function logAutomation(memberId, event, metadata = {}) {
  await supabase.from('automation_logs').insert({
    member_id: memberId,
    event,
    metadata,
    created_at: new Date().toISOString(),
  });
}

async function logPaymentReminder(memberId, data) {
  await supabase.from('payment_reminders').insert({
    member_id: memberId,
    ...mapToSnakeCase(data),
  });
}

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

function cleanPhone(phone) {
  return String(phone).replace(/[\s+\-]/g, '').replace(/^91/, '');
}

function calculateExpiry(plan) {
  const days = { monthly: 30, '3month': 90, '6month': 180, annual: 365 };
  const d = new Date();
  d.setDate(d.getDate() + (days[plan] || 30));
  return d.toISOString();
}

function mapToSnakeCase(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    result[key] = v;
  }
  return result;
}

function getMonthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function getWeekEnd() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}

module.exports = {
  getMemberByPhone,
  getMemberById,
  getMembers,
  createMember,
  updateMember,
  getMembersExpiringInDays,
  getMembersExpiredToday,
  getTrainer,
  assignTrainer,
  getConversationState,
  setConversationState,
  getAnalyticsOverview,
  getMessageStats,
  logAutomation,
  logPaymentReminder,
};
