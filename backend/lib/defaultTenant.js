/** Default tenant UUID — must match `schema_multi_tenant.sql` seed row. */
function defaultTenantId() {
  return process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
}

module.exports = { defaultTenantId };
