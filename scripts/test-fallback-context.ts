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
  console.log('--- STARTING CRM FALLBACK CONTEXT TEST ---');
  const { customerContextService } = await import('../src/modules/crm/services/customer-context-service');
  const { supabaseAdmin } = await import('../src/modules/workflows/services/admin-client');
  const admin = supabaseAdmin();

  // Create a contact locally that is NOT in the remote database
  const nonExistentPhone = '+919999999999';
  console.log(`\nCreating a test contact with non-existent phone ${nonExistentPhone}...`);

  // Remove existing one if any
  await admin.from('contacts').delete().eq('phone', nonExistentPhone);

  const { data: firstOrg } = await admin
    .from('organizations')
    .select('id')
    .limit(1)
    .maybeSingle();

  const { data: contact, error } = await admin
    .from('contacts')
    .insert({
      phone: nonExistentPhone,
      name: 'Non Existent Customer',
      organization_id: firstOrg?.id,
      user_id: 'e25cc7b7-a5bb-4b90-917e-3bec642c98ab'
    })
    .select()
    .single();

  if (error || !contact) {
    throw new Error(`Failed to create test contact: ${error?.message}`);
  }

  console.log(`Created contact locally with ID: ${contact.id}`);

  // Fetch context
  console.log('\nFetching context for this contact...');
  const context = await customerContextService.getCustomerContextByContactId(contact.id);
  console.log('Successfully retrieved context:');
  console.log(JSON.stringify(context, null, 2));

  // Clean up
  await admin.from('contacts').delete().eq('id', contact.id);
  console.log('\nCleaned up test contact.');
  console.log('--- CRM FALLBACK CONTEXT TEST PASSED ---');
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
