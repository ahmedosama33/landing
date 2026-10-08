import { BotspaceError } from '../config/botspace.js';

export async function sendEnquiryTemplate(store, client, id, logger = console, env = name => process.env[name]) {
  // Preview builds also use NODE_ENV=production. Never message from a preview.
  if (env('BOTSPACE_AUTO_SEND') !== 'true' || env('NODE_ENV') !== 'production'
    || (env('VERCEL_ENV') && env('VERCEL_ENV') !== 'production')) return false;
  const templateId = env('BOTSPACE_TEMPLATE_ID')?.trim();
  let fields;
  try { fields = JSON.parse(env('BOTSPACE_TEMPLATE_VARIABLE_FIELDS') || '[]'); } catch { fields = null; }
  if (!templateId || templateId.length > 200 || !Array.isArray(fields) || fields.some(field => field !== 'fullName')) {
    logger.error('botspace_template_configuration_invalid');
    return false;
  }
  const row = await store.claimBotspaceTemplate(id, templateId);
  if (!row) return false;
  let result;
  try {
    result = await client.sendTemplateMessage(row, fields.map(field => row[field]), templateId);
    if (result.skipped) throw new BotspaceError('Template send was not attempted; reconcile configuration.');
    await store.update(id, { botspaceTemplateStatus: result.status === 'FAILED' ? 'failed' : 'accepted',
      botspaceTemplateError: null, botspaceLastMessageId: result.id,
      botspaceLastMessageStatus: result.status, botspaceConversationId: result.conversationId });
    return result.status !== 'FAILED';
  } catch (error) {
    const reason = error instanceof BotspaceError ? error.message : 'Template send outcome uncertain; reconcile before retry.';
    logger.error('botspace_template_needs_reconciliation', { enquiry_id: String(id), reason });
    try {
      await store.update(id, { botspaceTemplateStatus: 'needs_reconciliation', botspaceTemplateError: reason,
        ...(result?.id ? { botspaceLastMessageId: result.id, botspaceLastMessageStatus: result.status,
          botspaceConversationId: result.conversationId } : {}) });
    } catch { logger.error('botspace_template_status_write_failed', { enquiry_id: String(id) }); }
    return false;
  }
}
