/**
 * GymBot Pro — Database Service (multi-tenant)
 */

const { createClient } = require('@supabase/supabase-js');
const { defaultTenantId } = require('../lib/defaultTenant');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─────────────────────────────────────────
// MEMBERS
// ─────────────────────────────────────────

function mapMember(m) {
  if (!m) return null;
  return {
    id: m.id,
    tenantId: m.tenant_id,
    name: m.name,
    phone: m.phone,
    email: m.email,
    plan: m.plan,
    planName: m.plan_name,
    joinDate: m.join_date,
    expiryDate: m.expiry_date,
    status: m.status,
    batchTime: m.batch_time,
    fitnessGoal: m.fitness_goal,
    trainerId: m.trainer_id,
    trainerName: m.trainer_name,
    sessionsAttended: m.sessions_attended,
    checkedInToday: m.checked_in_today,
    lastCheckin: m.last_checkin,
    formSubmittedAt: m.form_submitted_at,
    reminder1SentAt: m.reminder1_sent_at,
    reminder2SentAt: m.reminder2_sent_at,
    reminder3SentAt: m.reminder3_sent_at,
    dob: m.dob,
    age: m.age,
    weightKg: m.weight_kg,
    heightCm: m.height_cm,
    healthIssues: m.health_issues,
    pausedUntil: m.paused_until,
    lastPaymentDate: m.last_payment_date,
    lastPaymentAmount: m.last_payment_amount,
    lastPaymentId: m.last_payment_id,
  };
}

function mapTrainer(t) {
  if (!t) return null;
  return {
    id: t.id,
    tenantId: t.tenant_id,
    name: t.name,
    phone: t.phone,
    email: t.email,
    specializations: t.specializations,
    currentLoad: t.current_load,
    maxLoad: t.max_load,
    isActive: t.is_active,
  };
}

async function getMemberByPhone(phone, tenantId = defaultTenantId()) {
  const cleaned = String(phone).replace(/[\s+\-]/g, '').replace(/^91/, '');
  const { data } = await supabase
    .from('members')
    .select('*')
    .eq('tenant_id', tenantId)
    .or(`phone.eq.${cleaned},phone.eq.91${cleaned}`)
    .limit(1)
    .maybeSingle();
  return mapMember(data);
}

async function getMemberById(id, tenantId) {
  let q = supabase.from('members').select('*').eq('id', id);
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data } = await q.maybeSingle();
  return mapMember(data);
}

async function getMembers({ tenantId = defaultTenantId(), status, page = 1, limit = 50, expiredDaysAgo } = {}) {
  let query = supabase.from('members').select('*').eq('tenant_id', tenantId);
  if (status) query = query.eq('status', status);
  if (expiredDaysAgo) {
    const since = new Date(Date.now() - expiredDaysAgo * 86400000).toISOString();
    const until = new Date(Date.now() - (expiredDaysAgo - 1) * 86400000).toISOString();
    query = query.gte('expiry_date', since).lt('expiry_date', until);
  }
  query = query.range((page - 1) * limit, page * limit - 1);
  const { data } = await query;
  return (data || []).map(mapMember);
}

async function createMember(memberData) {
  const tId = memberData.tenantId || defaultTenantId();
  const payload = {
    tenant_id: tId,
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
  return mapMember(data);
}

async function updateMember(id, updates) {
  const mapped = mapToSnakeCase(updates);
  delete mapped.tenant_id;
  const { data, error } = await supabase.from('members').update(mapped).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return mapMember(data);
}

async function getMembersExpiringInDays(days, tenantId = defaultTenantId()) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + days);
  const dateStr = targetDate.toISOString().split('T')[0];
  const { data } = await supabase
    .from('members')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .gte('expiry_date', `${dateStr}T00:00:00`)
    .lte('expiry_date', `${dateStr}T23:59:59`);
  return (data || []).map(mapMember);
}

async function getMembersExpiredToday(tenantId = defaultTenantId()) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('members')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .gte('expiry_date', `${today}T00:00:00`)
    .lte('expiry_date', `${today}T23:59:59`);
  return (data || []).map(mapMember);
}

// ─────────────────────────────────────────
// TRAINERS
// ─────────────────────────────────────────

async function getTrainer(trainerId, tenantId = defaultTenantId()) {
  const { data, error } = await supabase
    .from('trainers')
    .select('*')
    .eq('id', trainerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function listTrainers(tenantId = defaultTenantId()) {
  const { data, error } = await supabase
    .from('trainers')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(mapTrainer);
}

async function createTrainer(tenantId, { name, phone, email, specializations, maxLoad = 30 }) {
  const specs = Array.isArray(specializations) && specializations.length
    ? specializations
    : ['general'];
  const { data, error } = await supabase
    .from('trainers')
    .insert({
      tenant_id: tenantId,
      name,
      phone: cleanPhone(phone),
      email: email || null,
      specializations: specs,
      max_load: maxLoad,
      current_load: 0,
      is_active: true,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapTrainer(data);
}

async function updateTrainer(tenantId, trainerId, updates) {
  const mapped = mapToSnakeCase(updates);
  delete mapped.tenant_id;
  const { data, error } = await supabase
    .from('trainers')
    .update(mapped)
    .eq('id', trainerId)
    .eq('tenant_id', tenantId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapTrainer(data);
}

async function assignTrainer(memberId, goal, tenantId = defaultTenantId()) {
  const { data: trainers, error } = await supabase
    .from('trainers')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .contains('specializations', [goal])
    .order('current_load', { ascending: true })
    .limit(1);
  if (error) return null;
  const trainer = trainers?.[0];
  if (!trainer) return null;
  await supabase.from('members').update({ trainer_id: trainer.id }).eq('id', memberId).eq('tenant_id', tenantId);
  await supabase
    .from('trainers')
    .update({ current_load: trainer.current_load + 1 })
    .eq('id', trainer.id);
  return trainer;
}

// ─────────────────────────────────────────
// CONVERSATION STATE
// ─────────────────────────────────────────

async function getConversationState(phone, tenantId = defaultTenantId()) {
  const { data } = await supabase
    .from('conversation_states')
    .select('state')
    .eq('phone', cleanPhone(phone))
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return data?.state || 'idle';
}

async function setConversationState(phone, state, tenantId = defaultTenantId(), metadata) {
  const row = {
    phone: cleanPhone(phone),
    tenant_id: tenantId,
    state,
    updated_at: new Date().toISOString(),
  };
  if (metadata !== undefined) row.metadata = metadata;
  await supabase.from('conversation_states').upsert(row, { onConflict: 'tenant_id,phone' });
}

// ─────────────────────────────────────────
// TENANTS
// ─────────────────────────────────────────

async function listActiveTenants() {
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, slug, wa_phone_number_id, is_active')
    .eq('is_active', true);
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return data || [];
}

async function listAllTenants() {
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, slug, wa_phone_number_id, is_active')
    .order('created_at', { ascending: true });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return data || [];
}

async function getTenantById(id) {
  const { data, error } = await supabase.from('tenants').select('*').eq('id', id).maybeSingle();
  if (error) return null;
  return data;
}

async function getTenantByWaPhoneId(waPhoneNumberId) {
  if (!waPhoneNumberId) return null;
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, slug, wa_phone_number_id, is_active')
    .eq('wa_phone_number_id', String(waPhoneNumberId))
    .eq('is_active', true)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function createTenant({ name, slug, waPhoneNumberId }) {
  const { data, error } = await supabase
    .from('tenants')
    .insert({
      name,
      slug,
      wa_phone_number_id: waPhoneNumberId || null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateTenantWaPhone(tenantId, waPhoneNumberId) {
  const { data, error } = await supabase
    .from('tenants')
    .update({ wa_phone_number_id: waPhoneNumberId || null })
    .eq('id', tenantId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ─────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────

async function getAnalyticsOverview(tenantId = defaultTenantId()) {
  const t = tenantId;
  const [
    { count: total },
    { count: active },
    { count: newThisMonth },
    { count: dueThisWeek },
  ] = await Promise.all([
    supabase.from('members').select('*', { count: 'exact', head: true }).eq('tenant_id', t),
    supabase
      .from('members')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', t)
      .eq('status', 'active'),
    supabase
      .from('members')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', t)
      .gte('join_date', getMonthStart()),
    supabase
      .from('members')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', t)
      .lte('expiry_date', getWeekEnd())
      .gte('expiry_date', new Date().toISOString()),
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
// GYM CONFIG
// ─────────────────────────────────────────

async function getGymInstanceConfig(tenantId = defaultTenantId()) {
  const tid = String(tenantId);
  const { data: byTenant, error: e1 } = await supabase
    .from('gym_instance_config')
    .select('*')
    .eq('tenant_id', tid)
    .maybeSingle();
  if (!e1 && byTenant) return byTenant;
  const { data: byId, error: e2 } = await supabase
    .from('gym_instance_config')
    .select('*')
    .or(`id.eq.${tid},id.eq.default`)
    .limit(1)
    .maybeSingle();
  if (e2) {
    if (e2.code === 'PGRST116' || /does not exist|schema cache/i.test(e2.message || '')) {
      return null;
    }
    console.warn('gym_instance_config read:', e2.message);
    return null;
  }
  return byId || null;
}

async function upsertGymInstanceConfig(updates, tenantId = defaultTenantId()) {
  const patch = mapGymConfigToRow(updates);
  const tid = String(tenantId);
  patch.tenant_id = tid;
  patch.id = tid;
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('gym_instance_config')
    .upsert(patch, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function mapGymConfigToRow(u) {
  if (!u || typeof u !== 'object') return {};
  const o = {};
  if (u.brandName != null) o.brand_name = u.brandName;
  if (u.supportPhone != null) o.support_phone = u.supportPhone;
  if (u.websiteUrl != null) o.website_url = u.websiteUrl;
  if (u.intakeFormUrl != null) o.intake_form_url = u.intakeFormUrl;
  if (u.cdnBaseUrl != null) o.cdn_base_url = u.cdnBaseUrl;
  if (u.address != null) o.address = u.address;
  if (u.timezone != null) o.timezone = u.timezone;
  if (u.phoneNumberId != null) o.phone_number_id = u.phoneNumberId;
  if (u.automations != null) o.automations = u.automations;
  if (u.planPrices != null) o.plan_prices = u.planPrices;
  return o;
}

// ─────────────────────────────────────────
// ERROR LOG
// ─────────────────────────────────────────

async function logErrorEvent({ source, message, detail, stack, context, tenantId }) {
  const tid = tenantId != null ? tenantId : (context && (context.tenantId || context.tenant_id)) || null;
  try {
    await supabase.from('error_events').insert({
      source: String(source).slice(0, 200),
      message: message != null ? String(message).slice(0, 2000) : null,
      detail: detail != null ? String(detail).slice(0, 2000) : null,
      stack: stack != null ? String(stack).slice(0, 8000) : null,
      context: context && typeof context === 'object' ? context : {},
      tenant_id: tid,
    });
  } catch (e) {
    console.error('logErrorEvent failed', e);
  }
}

async function getRecentErrorEvents({ limit = 50, tenantId } = {}) {
  let q = supabase
    .from('error_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, limit)));
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
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
  defaultTenantId,
  getMemberByPhone,
  getMemberById,
  getMembers,
  createMember,
  updateMember,
  getMembersExpiringInDays,
  getMembersExpiredToday,
  getTrainer,
  listTrainers,
  createTrainer,
  updateTrainer,
  assignTrainer,
  getConversationState,
  setConversationState,
  getAnalyticsOverview,
  getMessageStats,
  logAutomation,
  logPaymentReminder,
  getGymInstanceConfig,
  upsertGymInstanceConfig,
  logErrorEvent,
  getRecentErrorEvents,
  mapMember,
  mapTrainer,
  listActiveTenants,
  listAllTenants,
  getTenantById,
  getTenantByWaPhoneId,
  createTenant,
  updateTenantWaPhone,
};
