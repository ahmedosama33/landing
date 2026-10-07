export class BotspaceError extends Error {}

// Read lazily: missing credentials must never prevent frontend builds or API startup.
export function readBotspaceConfig(env = name => process.env[name]) {
  const apiKey = env('BOTSPACE_API_KEY');
  const channelId = env('BOTSPACE_CHANNEL_ID');
  if (!apiKey || !channelId) throw new BotspaceError('BotSpace configuration is incomplete.');
  let url;
  try { url = new URL(env('BOTSPACE_BASE_URL') || 'https://public-api.bot.space'); }
  catch { throw new BotspaceError('BotSpace URL configuration is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new BotspaceError('BotSpace URL configuration is invalid.');
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(channelId)) throw new BotspaceError('BotSpace channel configuration is invalid.');
  return { apiKey, channelId, baseUrl: url.origin };
}
