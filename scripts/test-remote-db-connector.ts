import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

// Load env
const envPath = './.env.local';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  });
}

async function runTest() {
  console.log('--- STARTING REMOTE DATABASE CONNECTOR TEST ---');
  
  // Dynamically import services after env is loaded
  const { customerContextService } = await import('../src/modules/crm/services/customer-context-service');
  const { salesPortalConnector } = await import('../src/modules/crm/services/sales-portal-connector');
  
  const url = process.env.SALES_PORTAL_SUPABASE_URL;
  const key = process.env.SALES_PORTAL_SUPABASE_SERVICE_ROLE_KEY;
  console.log(`Sales Portal URL: ${url}`);
  console.log(`Key Exists: ${!!key}`);
  
  if (!url || !key) {
    console.error('Remote database credentials missing in env!');
    process.exit(1);
  }
  
  const db = createClient(url, key);
  
  // 1. Fetch first lead
  console.log('\nFetching a lead from the remote database...');
  const { data: firstLead, error: leadError } = await db
    .from('leads')
    .select('id, customer_name, whatsapp_number')
    .limit(1)
    .maybeSingle();
    
  if (leadError) {
    throw new Error(`Failed to query remote leads: ${leadError.message}`);
  }
  
  if (!firstLead) {
    console.warn('No leads found in remote database. Please seed some data first.');
    return;
  }
  
  console.log(`Found Lead ID: ${firstLead.id}`);
  console.log(`Name: ${firstLead.customer_name}`);
  console.log(`WhatsApp: ${firstLead.whatsapp_number}`);
  
  // 2. Fetch Customer Context
  console.log('\nTesting customerContextService.getCustomerContextByContactId...');
  const context = await customerContextService.getCustomerContextByContactId(firstLead.id);
  console.log('Unified Context successfully constructed:');
  console.log(` - Profile Name: ${context.profile.name}`);
  console.log(` - Lead Status: ${context.lead?.status}`);
  console.log(` - Is Converted: ${context.conversion.isConverted}`);
  console.log(` - Proposal Sizing: ${context.proposal?.systemSizeKw} kW`);
  console.log(` - Documents Found: ${context.documents.length}`);
  console.log(` - Follow-ups Found: ${context.followups.length}`);
  
  // 3. Test Sales Portal Connector GET methods
  console.log('\nTesting salesPortalConnector.getCustomer...');
  if (firstLead.whatsapp_number) {
    const customer = await salesPortalConnector.getCustomer(firstLead.whatsapp_number);
    console.log(`Customer Name retrieved via phone: ${customer.name}`);
  }
  
  console.log('\n--- REMOTE DATABASE CONNECTOR TEST COMPLETED SUCCESSFULLY ---');
}

runTest().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
