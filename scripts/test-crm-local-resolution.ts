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
  console.log('--- STARTING CRM LOCAL ID RESOLUTION TEST ---');
  
  // Dynamically import services after env is loaded
  const { customerContextService } = await import('../src/modules/crm/services/customer-context-service');
  const { salesPortalConnector } = await import('../src/modules/crm/services/sales-portal-connector');
  const { supabaseAdmin } = await import('../src/modules/workflows/services/admin-client');
  
  const admin = supabaseAdmin();
  
  // 1. Find or create a contact locally in the CRM with Dileep's phone
  const testPhone = '+91 8871870966';
  console.log(`\nLocating or creating test contact in local CRM database for phone: ${testPhone}...`);
  
  const { data: existingContact } = await admin
    .from('contacts')
    .select('id')
    .eq('phone', testPhone)
    .maybeSingle();
    
  let localContactId: string;
  
  if (existingContact) {
    localContactId = existingContact.id;
    console.log(`Found existing local contact ID: ${localContactId}`);
  } else {
    // Fetch organization_id
    const { data: firstOrg } = await admin
      .from('organizations')
      .select('id')
      .limit(1)
      .maybeSingle();
      
    if (!firstOrg) {
      throw new Error('No organizations found in CRM to link contact');
    }
    
    const { data: newContact, error: createError } = await admin
      .from('contacts')
      .insert({
        phone: testPhone,
        name: 'Dileep Sharma (Local Test)',
        organization_id: firstOrg.id,
        user_id: 'e25cc7b7-a5bb-4b90-917e-3bec642c98ab' // A valid user ID in organization_users or any admin
      })
      .select()
      .single();
      
    if (createError || !newContact) {
      throw new Error(`Failed to create test contact locally: ${createError?.message}`);
    }
    localContactId = newContact.id;
    console.log(`Created new local contact ID: ${localContactId}`);
  }
  
  // 2. Fetch Customer Context by local ID
  console.log('\nTesting customerContextService.getCustomerContextByContactId (using LOCAL CRM contact ID)...');
  const context = await customerContextService.getCustomerContextByContactId(localContactId);
  console.log('Unified Context successfully retrieved using local ID:');
  console.log(` - Profile Name: ${context.profile.name}`);
  console.log(` - Remote Lead ID: ${context.profile.id}`);
  console.log(` - Lead Status: ${context.lead?.status}`);
  console.log(` - Is Converted: ${context.conversion.isConverted}`);
  console.log(` - Proposal Sizing: ${context.proposal?.systemSizeKw} kW`);
  console.log(` - Documents Found: ${context.documents.length}`);
  
  // 3. Test Sales Portal Connector GET methods by local ID
  console.log('\nTesting salesPortalConnector.getCustomerById (using LOCAL CRM contact ID)...');
  const customer = await salesPortalConnector.getCustomerById(localContactId);
  console.log(`Customer Name retrieved via local contact ID: ${customer.name} (Remote ID: ${customer.id})`);
  
  console.log('\nTesting salesPortalConnector.getDocuments (using LOCAL CRM contact ID)...');
  const docs = await salesPortalConnector.getDocuments(localContactId);
  console.log(`Documents successfully retrieved: ${docs.length} found`);
  for (const doc of docs) {
    console.log(` - Document: ${doc.name} (URL: ${doc.url})`);
  }
  
  console.log('\n--- CRM LOCAL ID RESOLUTION TEST COMPLETED SUCCESSFULLY ---');
}

runTest().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
