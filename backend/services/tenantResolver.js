/**
 * Maps Meta WhatsApp Cloud API `phone_number_id` (from webhook metadata) to a tenant.
 */

const db = require('./database');
const { defaultTenantId } = require('../lib/defaultTenant');

/**
 * @param {string | undefined} phoneNumberId from value.metadata.phone_number_id
 * @returns {Promise<{ id: string, name: string, slug: string } | null>}
 */
async function resolveTenantFromWebhook(phoneNumberId) {
  const envPhoneId = process.env.WHATSAPP_PHONE_ID;
  try {
    if (phoneNumberId) {
      const t = await db.getTenantByWaPhoneId(phoneNumberId);
      if (t) return t;
      if (envPhoneId && phoneNumberId === envPhoneId) {
        const def = await db.getTenantById(defaultTenantId());
        if (def) return def;
      }
    } else if (envPhoneId) {
      const t = await db.getTenantByWaPhoneId(envPhoneId);
      if (t) return t;
    }

    const fallback = await db.getTenantById(defaultTenantId());
    if (fallback) return fallback;
    return { id: defaultTenantId(), name: 'Default', slug: 'default' };
  } catch {
    return { id: defaultTenantId(), name: 'Default', slug: 'default' };
  }
}

module.exports = { resolveTenantFromWebhook, defaultTenantId };
