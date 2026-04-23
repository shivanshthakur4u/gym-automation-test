/**
 * Merges environment variables with database-backed gym config (per tenant).
 */

const db = require('./database');
const { defaultTenantId } = require('../lib/defaultTenant');

const CACHE_TTL_MS = 45 * 1000;
/** @type {Map<string, { at: number, value: object }>} */
const cache = new Map();

const DEFAULT_AUTOMATIONS = {
  morningMotivation: true,
  paymentReminders: true,
  eveningEngagement: true,
  weeklyDiet: true,
  milestonesBirthdays: true,
  winback: true,
  autoOnboard: true,
};

function deepMergeAutomations(overrides) {
  return { ...DEFAULT_AUTOMATIONS, ...(overrides && typeof overrides === 'object' ? overrides : {}) };
}

function resetCache(tenantId) {
  if (tenantId) cache.delete(String(tenantId));
  else cache.clear();
}

function cacheKey(tenantId) {
  return String(tenantId || defaultTenantId());
}

/**
 * @param {string} [tenantId]
 */
async function getRuntimeConfig(tenantId) {
  const tid = tenantId || defaultTenantId();
  const now = Date.now();
  const ck = cacheKey(tid);
  const hit = cache.get(ck);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return hit.value;
  }

  const row = await db.getGymInstanceConfig(tid);
  const automations = deepMergeAutomations(row?.automations);
  const planPrices = mergePlanPricesFromEnvAndDb(row?.plan_prices);

  const merged = {
    tenantId: tid,
    brandName: row?.brand_name || process.env.GYM_NAME || 'Your Gym',
    supportPhone: row?.support_phone || process.env.GYM_PHONE || '',
    websiteUrl: row?.website_url || process.env.GYM_WEBSITE || '',
    intakeFormUrl: row?.intake_form_url || process.env.INTAKE_FORM_URL || '',
    cdnBaseUrl: row?.cdn_base_url || process.env.CDN_URL || process.env.GYM_WEBSITE || '',
    address: row?.address || process.env.GYM_ADDRESS || '',
    timezone: row?.timezone || 'Asia/Kolkata',
    phoneNumberId: row?.phone_number_id || process.env.WHATSAPP_PHONE_ID || null,
    automations,
    planPrices,
  };

  cache.set(ck, { at: now, value: merged });
  return merged;
}

function mergePlanPricesFromEnvAndDb(dbPrices) {
  const defaults = {
    monthly: { amount: 1999, name: 'Monthly Plan', days: 30 },
    '3month': { amount: 4999, name: '3-Month Plan', days: 90 },
    '6month': { amount: 7999, name: '6-Month Plan', days: 180 },
    annual: { amount: 14999, name: 'Annual Plan', days: 365 },
  };
  if (!dbPrices || typeof dbPrices !== 'object') {
    return defaults;
  }
  const out = { ...defaults };
  for (const k of Object.keys(dbPrices)) {
    const p = dbPrices[k];
    if (p && typeof p.amount === 'number') {
      out[k] = {
        amount: p.amount,
        name: typeof p.name === 'string' && p.name ? p.name : defaults[k]?.name || k,
        days: Number.isFinite(p.days) ? p.days : (defaults[k]?.days || 30),
      };
    }
  }
  return out;
}

async function updateRuntimeConfig(partial, tenantId) {
  const tid = tenantId || defaultTenantId();
  await db.upsertGymInstanceConfig(partial, tid);
  if (partial.phoneNumberId != null) {
    try {
      await db.updateTenantWaPhone(tid, partial.phoneNumberId);
    } catch (_) {
      /* tenants table may not exist yet */
    }
  }
  resetCache(tid);
  return getRuntimeConfig(tid);
}

function progressUrlForMember(memberId, tenantId) {
  return getRuntimeConfig(tenantId).then((c) => {
    const base = c.websiteUrl || process.env.GYM_WEBSITE || '';
    return base ? `${base.replace(/\/$/, '')}/progress/${memberId}` : '';
  });
}

module.exports = {
  getRuntimeConfig,
  updateRuntimeConfig,
  resetCache,
  DEFAULT_AUTOMATIONS,
  progressUrlForMember,
};
