import { getZohoConfig } from './config/zoho.js';
import { createZohoClient, safeSyncError } from './services/zohoService.js';

try {
  getZohoConfig();
  console.log('Zoho config: OK');
  const client = createZohoClient();
  await client.getZohoAccessToken();
  console.log('OAuth: OK');
  await client.checkConnection();
  console.log('CRM API: OK');
} catch (error) {
  console.error(safeSyncError(error));
  process.exitCode = 1;
}
