const axios = require('axios');

/**
 * WhatsApp Providers Service - Supports multiple WhatsApp vendors
 * Meta Cloud, WATI, Twilio, MessageBird, Vonage, custom
 */

class WAProviderService {
  constructor(db) {
    this.db = db;
  }

  // Get active provider for tenant
  async getActiveProvider(tenantId) {
    try {
      const { data, error } = await this.db.client
        .from('whatsapp_providers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    } catch (err) {
      console.error('[WAProviderService] getActiveProvider error:', err);
      return null;
    }
  }

  // List all providers for tenant
  async getProviders(tenantId) {
    try {
      const { data, error } = await this.db.client
        .from('whatsapp_providers')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[WAProviderService] getProviders error:', err);
      return [];
    }
  }

  // Send message via active provider
  async sendMessage(tenantId, toPhone, message, templateName = null) {
    const provider = await this.getActiveProvider(tenantId);
    if (!provider) throw new Error('No active WhatsApp provider configured');

    const handler = this.getProviderHandler(provider.provider);
    return handler.call(this, provider.config, toPhone, message, templateName);
  }

  // Provider-specific handlers
  getProviderHandler(provider) {
    const handlers = {
      meta_cloud: this.sendViaMeta,
      wati: this.sendViaWATI,
      twilio: this.sendViaTwilio,
      messagebird: this.sendViaMessageBird,
      vonage: this.sendViaVonage,
      custom: this.sendViaCustom
    };
    return handlers[provider] || handlers.meta_cloud;
  }

  // Meta Cloud WhatsApp Business API
  async sendViaMeta(config, toPhone, message, templateName) {
    const { phone_id, token, api_url = 'https://graph.instagram.com' } = config;
    if (!phone_id || !token) throw new Error('Meta provider missing phone_id or token');

    const url = `${api_url}/v18.0/${phone_id}/messages`;
    const payload = templateName
      ? {
          messaging_product: 'whatsapp',
          to: toPhone,
          type: 'template',
          template: { name: templateName, language: { code: 'en_US' } }
        }
      : {
          messaging_product: 'whatsapp',
          to: toPhone,
          type: 'text',
          text: { body: message }
        };

    const response = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return response.data;
  }

  // WATI (https://www.wati.io/)
  async sendViaWATI(config, toPhone, message, templateName) {
    const { token, api_url = 'https://backend.wati.io' } = config;
    if (!token) throw new Error('WATI provider missing token');

    const url = `${api_url}/api/v1/sendSessionMessage/${toPhone}`;
    const response = await axios.post(url, { messageText: message }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return response.data;
  }

  // Twilio WhatsApp
  async sendViaTwilio(config, toPhone, message, templateName) {
    const { account_sid, auth_token, twilio_phone } = config;
    if (!account_sid || !auth_token) throw new Error('Twilio missing account_sid or auth_token');

    const url = `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/Messages.json`;
    const response = await axios.post(url, {
      To: `whatsapp:+${toPhone}`,
      From: `whatsapp:${twilio_phone}`,
      Body: message
    }, {
      auth: { username: account_sid, password: auth_token }
    });

    return response.data;
  }

  // MessageBird WhatsApp
  async sendViaMessageBird(config, toPhone, message, templateName) {
    const { api_key, channel_id } = config;
    if (!api_key) throw new Error('MessageBird missing api_key');

    const url = 'https://api.messagebird.com/v1/messages';
    const response = await axios.post(url, {
      to: toPhone,
      type: 'whatsapp',
      body: message,
      channelId: channel_id
    }, {
      headers: { Authorization: `AccessKey ${api_key}` }
    });

    return response.data;
  }

  // Vonage (Nexmo) WhatsApp
  async sendViaVonage(config, toPhone, message, templateName) {
    const { api_key, api_secret, from_number } = config;
    if (!api_key || !api_secret) throw new Error('Vonage missing api_key or api_secret');

    const url = 'https://api.vonage.com/v1/messages';
    const timestamp = Math.floor(Date.now() / 1000);

    const response = await axios.post(url, {
      to: toPhone,
      from: from_number || 'GymBot',
      message_type: 'text',
      text: message,
      channel: 'whatsapp'
    }, {
      headers: {
        'Authorization': `Bearer ${api_key}`,
      }
    });

    return response.data;
  }

  // Custom HTTP endpoint
  async sendViaCustom(config, toPhone, message, templateName) {
    const { webhook_url, auth_header } = config;
    if (!webhook_url) throw new Error('Custom provider missing webhook_url');

    const headers = { 'Content-Type': 'application/json' };
    if (auth_header) headers['Authorization'] = auth_header;

    const response = await axios.post(webhook_url, {
      to: toPhone,
      message,
      templateName
    }, { headers });

    return response.data;
  }

  // CRUD: Create provider
  async createProvider(tenantId, data) {
    try {
      // If setting as active, deactivate others
      if (data.is_active) {
        await this.db.client
          .from('whatsapp_providers')
          .update({ is_active: false })
          .eq('tenant_id', tenantId);
      }

      const { data: result, error } = await this.db.client
        .from('whatsapp_providers')
        .insert({
          tenant_id: tenantId,
          provider: data.provider,
          label: data.label,
          config: data.config,
          is_active: data.is_active || false
        })
        .select()
        .single();
      if (error) throw error;
      return result;
    } catch (err) {
      console.error('[WAProviderService] createProvider error:', err);
      throw err;
    }
  }

  // CRUD: Update provider
  async updateProvider(tenantId, providerId, data) {
    try {
      // If setting as active, deactivate others
      if (data.is_active) {
        await this.db.client
          .from('whatsapp_providers')
          .update({ is_active: false })
          .eq('tenant_id', tenantId)
          .neq('id', providerId);
      }

      const { data: result, error } = await this.db.client
        .from('whatsapp_providers')
        .update({
          label: data.label,
          config: data.config,
          is_active: data.is_active
        })
        .eq('id', providerId)
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (error) throw error;
      return result;
    } catch (err) {
      console.error('[WAProviderService] updateProvider error:', err);
      throw err;
    }
  }

  // CRUD: Delete provider
  async deleteProvider(tenantId, providerId) {
    try {
      const { error } = await this.db.client
        .from('whatsapp_providers')
        .delete()
        .eq('id', providerId)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[WAProviderService] deleteProvider error:', err);
      throw err;
    }
  }
}

module.exports = WAProviderService;
