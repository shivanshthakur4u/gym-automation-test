const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAdmin } = require('../middleware/adminAuth');

/**
 * Integration Routes
 * Handles CRUD operations for integrations, WhatsApp providers, and event logs
 */

module.exports = function createIntegrationRoutes(db, integrationService, waProviderService) {
  const router = express.Router();

  // ─────────────────────────────────────────
  // INTEGRATIONS CRUD
  // ─────────────────────────────────────────

  // GET /api/integrations — List all integrations for tenant
  router.get('/integrations', requireAdmin, async (req, res) => {
    try {
      const tenantId = req.query.tenantId;
      const integrations = await integrationService.getIntegrations(tenantId);
      res.json({ success: true, data: integrations });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/integrations — Create new integration
  router.post('/integrations',
    requireAdmin,
    body('name').trim().notEmpty(),
    body('type').isIn(['webhook_outbound', 'whatsapp_provider', 'crm', 'payment', 'custom']),
    body('provider').trim().notEmpty(),
    body('config').isObject(),
    body('events').isArray(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      try {
        const tenantId = req.query.tenantId;
        const integration = await integrationService.createIntegration(tenantId, req.body);
        res.status(201).json({ success: true, data: integration });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // PUT /api/integrations/:id — Update integration
  router.put('/integrations/:id',
    requireAdmin,
    body('name').trim().notEmpty(),
    body('type').isIn(['webhook_outbound', 'whatsapp_provider', 'crm', 'payment', 'custom']),
    body('provider').trim().notEmpty(),
    body('config').isObject(),
    body('events').isArray(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      try {
        const tenantId = req.query.tenantId;
        const integration = await integrationService.updateIntegration(tenantId, req.params.id, req.body);
        res.json({ success: true, data: integration });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // DELETE /api/integrations/:id — Delete integration
  router.delete('/integrations/:id', requireAdmin, async (req, res) => {
    try {
      const tenantId = req.query.tenantId;
      await integrationService.deleteIntegration(tenantId, req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/integrations/:id/logs — Get event logs for integration
  router.get('/integrations/:id/logs', requireAdmin, async (req, res) => {
    try {
      const tenantId = req.query.tenantId;
      const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
      const logs = await integrationService.getEventLogs(tenantId, req.params.id, limit);
      res.json({ success: true, data: logs });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/integrations/:id/test — Test integration (fire sample event)
  router.post('/integrations/:id/test', requireAdmin, async (req, res) => {
    try {
      const tenantId = req.query.tenantId;
      const integrations = await integrationService.getIntegrations(tenantId);
      const integration = integrations.find(i => i.id === req.params.id);
      if (!integration) return res.status(404).json({ success: false, error: 'Integration not found' });

      const samplePayload = {
        name: 'Test Member',
        phone: '9876543210',
        plan: 'monthly',
        status: 'active'
      };

      const result = await integrationService.invokeIntegration(
        tenantId,
        integration,
        'test.event',
        samplePayload,
        null
      );

      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─────────────────────────────────────────
  // WHATSAPP PROVIDERS CRUD
  // ─────────────────────────────────────────

  // GET /api/whatsapp-providers — List all providers for tenant
  router.get('/whatsapp-providers', requireAdmin, async (req, res) => {
    try {
      const tenantId = req.query.tenantId;
      const providers = await waProviderService.getProviders(tenantId);
      res.json({ success: true, data: providers });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/whatsapp-providers/active — Get currently active provider
  router.get('/whatsapp-providers/active', requireAdmin, async (req, res) => {
    try {
      const tenantId = req.query.tenantId;
      const provider = await waProviderService.getActiveProvider(tenantId);
      res.json({ success: true, data: provider });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/whatsapp-providers — Create new provider
  router.post('/whatsapp-providers',
    requireAdmin,
    body('provider').isIn(['meta_cloud', 'wati', 'twilio', 'messagebird', 'vonage', 'custom']),
    body('label').trim().notEmpty(),
    body('config').isObject(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      try {
        const tenantId = req.query.tenantId;
        const provider = await waProviderService.createProvider(tenantId, req.body);
        res.status(201).json({ success: true, data: provider });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // PUT /api/whatsapp-providers/:id — Update provider
  router.put('/whatsapp-providers/:id',
    requireAdmin,
    body('label').trim().notEmpty(),
    body('config').isObject(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      try {
        const tenantId = req.query.tenantId;
        const provider = await waProviderService.updateProvider(tenantId, req.params.id, req.body);
        res.json({ success: true, data: provider });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // DELETE /api/whatsapp-providers/:id — Delete provider
  router.delete('/whatsapp-providers/:id', requireAdmin, async (req, res) => {
    try {
      const tenantId = req.query.tenantId;
      await waProviderService.deleteProvider(tenantId, req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/whatsapp-providers/:id/test — Send test message
  router.post('/whatsapp-providers/:id/test',
    requireAdmin,
    body('phone').matches(/^\d{10}$/),
    body('message').trim().notEmpty(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      try {
        const tenantId = req.query.tenantId;
        const providers = await waProviderService.getProviders(tenantId);
        const provider = providers.find(p => p.id === req.params.id);
        if (!provider) return res.status(404).json({ success: false, error: 'Provider not found' });

        const result = await waProviderService.sendMessage(
          tenantId,
          req.body.phone,
          req.body.message
        );

        res.json({ success: true, data: result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  return router;
};
