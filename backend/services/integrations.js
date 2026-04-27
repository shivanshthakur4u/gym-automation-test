const axios = require('axios');

/**
 * Integration Service - Manages outbound webhooks & event dispatch
 * Supports n8n, Zapier, Make.com, and custom HTTP endpoints
 */

class IntegrationService {
  constructor(db) {
    this.db = db;
  }

  // List all active integrations for a tenant
  async getIntegrations(tenantId) {
    try {
      const { data, error } = await this.db.client
        .from('integrations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true);
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[IntegrationService] getIntegrations error:', err);
      return [];
    }
  }

  // Get integrations by event type
  async getIntegrationsByEvent(tenantId, eventType) {
    try {
      const { data, error } = await this.db.client
        .from('integrations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .filter('events', 'cs', `{"${eventType}"}`);  // contains array element
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[IntegrationService] getIntegrationsByEvent error:', err);
      return [];
    }
  }

  // Fire event to all subscribed integrations
  async fireEvent(tenantId, eventType, payload, memberId = null) {
    const integrations = await this.getIntegrationsByEvent(tenantId, eventType);
    const results = [];

    for (const integration of integrations) {
      const result = await this.invokeIntegration(tenantId, integration, eventType, payload, memberId);
      results.push(result);
    }

    return results;
  }

  // Invoke a single integration
  async invokeIntegration(tenantId, integration, eventType, payload, memberId) {
    const startTime = Date.now();
    const enrichedPayload = {
      event: eventType,
      tenantId,
      memberId,
      timestamp: new Date().toISOString(),
      data: payload
    };

    let response = null;
    let success = false;
    let error = null;
    let statusCode = null;
    let duration = Date.now() - startTime;

    try {
      // Route to provider-specific handler
      const handler = this.getProviderHandler(integration.provider);
      response = await handler.call(this, integration.config, enrichedPayload);
      statusCode = response.status;
      success = response.status >= 200 && response.status < 300;
      duration = Date.now() - startTime;
    } catch (err) {
      error = err.message;
      statusCode = err.response?.status || 0;
      success = false;
      duration = Date.now() - startTime;
    }

    // Log the event
    await this.logIntegrationEvent(tenantId, integration.id, eventType, enrichedPayload, statusCode, response?.data, duration, success, error);

    // Update integration last_triggered_at / last_error
    if (success) {
      await this.db.client
        .from('integrations')
        .update({ last_triggered_at: new Date().toISOString(), last_error: null })
        .eq('id', integration.id);
    } else {
      await this.db.client
        .from('integrations')
        .update({ last_error: error })
        .eq('id', integration.id);
    }

    return { integrationId: integration.id, success, statusCode, error, duration };
  }

  // Provider-specific handlers
  getProviderHandler(provider) {
    const handlers = {
      n8n: this.handleN8n,
      zapier: this.handleZapier,
      make: this.handleMake,
      webhook: this.handleWebhook,
      custom: this.handleWebhook
    };
    return handlers[provider] || handlers.webhook;
  }

  // Generic HTTP webhook handler (n8n, Zapier, Make, custom endpoints)
  async handleWebhook(config, payload) {
    const url = config.url || config.webhook_url;
    if (!url) throw new Error('No webhook URL configured');

    const headers = {
      'Content-Type': 'application/json',
      ...(config.headers || {})
    };

    // Add custom headers from config
    if (config.auth_header) {
      headers['Authorization'] = config.auth_header;
    }

    const response = await axios.post(url, payload, {
      headers,
      timeout: 10000
    });

    return response;
  }

  // n8n-specific (uses same webhook pattern)
  async handleN8n(config, payload) {
    return this.handleWebhook(config, payload);
  }

  // Zapier-specific (uses same webhook pattern)
  async handleZapier(config, payload) {
    return this.handleWebhook(config, payload);
  }

  // Make.com-specific (uses same webhook pattern)
  async handleMake(config, payload) {
    return this.handleWebhook(config, payload);
  }

  // Log integration event
  async logIntegrationEvent(tenantId, integrationId, eventType, payload, statusCode, responseBody, duration, success, error) {
    try {
      await this.db.client
        .from('integration_event_logs')
        .insert({
          tenant_id: tenantId,
          integration_id: integrationId,
          event_type: eventType,
          payload,
          response_status: statusCode,
          response_body: responseBody ? JSON.stringify(responseBody).substring(0, 500) : null,
          duration_ms: duration,
          success,
          error
        });
    } catch (err) {
      console.error('[IntegrationService] logIntegrationEvent error:', err);
    }
  }

  // CRUD: Create integration
  async createIntegration(tenantId, data) {
    try {
      const { data: result, error } = await this.db.client
        .from('integrations')
        .insert({
          tenant_id: tenantId,
          name: data.name,
          type: data.type || 'webhook_outbound',
          provider: data.provider || 'custom',
          config: data.config || {},
          events: data.events || [],
          is_active: data.is_active !== false
        })
        .select()
        .single();
      if (error) throw error;
      return result;
    } catch (err) {
      console.error('[IntegrationService] createIntegration error:', err);
      throw err;
    }
  }

  // CRUD: Update integration
  async updateIntegration(tenantId, integrationId, data) {
    try {
      const { data: result, error } = await this.db.client
        .from('integrations')
        .update({
          name: data.name,
          type: data.type,
          provider: data.provider,
          config: data.config,
          events: data.events,
          is_active: data.is_active
        })
        .eq('id', integrationId)
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (error) throw error;
      return result;
    } catch (err) {
      console.error('[IntegrationService] updateIntegration error:', err);
      throw err;
    }
  }

  // CRUD: Delete integration
  async deleteIntegration(tenantId, integrationId) {
    try {
      const { error } = await this.db.client
        .from('integrations')
        .delete()
        .eq('id', integrationId)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[IntegrationService] deleteIntegration error:', err);
      throw err;
    }
  }

  // Get integration event logs
  async getEventLogs(tenantId, integrationId, limit = 50) {
    try {
      const { data, error } = await this.db.client
        .from('integration_event_logs')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('integration_id', integrationId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[IntegrationService] getEventLogs error:', err);
      return [];
    }
  }
}

module.exports = IntegrationService;
