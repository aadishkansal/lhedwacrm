import { agentManager } from '../src/modules/agents/services/agent-manager';
import { registry } from '../src/modules/agents/tools';
import { supabaseAdmin } from '../src/modules/workflows/services/admin-client';
import { ModelRegistry } from '../src/modules/agents/services/model-registry';

async function runTest() {
  console.log('--- STARTING AGENT WORKSPACE API TEST ---');
  const db = supabaseAdmin();

  // 1. Verify Tools Listing
  console.log('\n1. Fetching registered tools...');
  const tools = registry.getAll();
  console.log(`Successfully retrieved ${tools.length} tools:`);
  for (const t of tools) {
    console.log(` - ${t.name}: ${t.description}`);
  }
  if (tools.length === 0) {
    throw new Error('No tools found in registry!');
  }

  // 2. Fetch first organization and user
  const { data: orgUser, error: orgUserError } = await db
    .from('organization_users')
    .select('organization_id, user_id')
    .limit(1)
    .single();

  if (orgUserError || !orgUser) {
    console.warn('Skipping DB checks: no organization users found. Set up database first.');
    return;
  }

  const { organization_id: orgId, user_id: userId } = orgUser;
  console.log(`\nActive Organization: ${orgId}`);
  console.log(`Active User: ${userId}`);

  // 3. Check if there is an existing 'finance' agent config and delete it first if present (so we can insert a new one)
  const { data: existingFinance } = await db
    .from('agent_configs')
    .select('id')
    .eq('organization_id', orgId)
    .eq('role', 'finance')
    .maybeSingle();

  if (existingFinance) {
    console.log('Found existing finance agent configuration. Removing it first for clean test seeding...');
    await agentManager.deleteAgent(existingFinance.id, orgId);
  }

  // 4. Create a test agent configuration to delete
  console.log('\n2. Creating temporary agent configuration...');
  const tempAgent = await agentManager.createAgent(
    orgId,
    {
      name: 'Temp Test Agent',
      description: 'Used for deleting configuration verification',
      role: 'finance',
      systemPrompt: 'You are a test finance agent.',
      allowedTools: ['GetInvoiceStatus'],
      model: 'gemini-2.5-flash',
      temperature: 0.2,
      kbAccess: false,
      status: 'active',
    },
    userId
  );
  console.log(`Created agent ID: ${tempAgent.id}, role: ${tempAgent.role}`);

  // Check version exists
  const versionsBefore = await agentManager.getVersions(tempAgent.id, orgId);
  console.log(`Versions logged before delete: ${versionsBefore.length}`);
  if (versionsBefore.length !== 1) {
    throw new Error('Version 1 was not logged correctly!');
  }

  // 5. Delete the configuration
  console.log('\n3. Testing agent configuration deletion...');
  await agentManager.deleteAgent(tempAgent.id, orgId);
  console.log('Deleted agent config.');

  // Check if config exists
  const { data: deletedAgent } = await db
    .from('agent_configs')
    .select('id')
    .eq('id', tempAgent.id)
    .maybeSingle();

  if (deletedAgent) {
    throw new Error('Agent config was not deleted from DB!');
  }
  console.log('Verified: Config removed from DB.');

  // Check if prompt version exists (cascade check)
  const { data: deletedVersion } = await db
    .from('agent_prompt_versions')
    .select('id')
    .eq('agent_id', tempAgent.id)
    .maybeSingle();

  if (deletedVersion) {
    throw new Error('Prompt versions were not cascade-deleted!');
  }
  console.log('Verified: Prompt versions cascade-deleted.');

  // 6. Test model registry checks
  console.log('\n4. Verifying ModelRegistry configurations...');
  const geminiMetadata = ModelRegistry.getModel('gemini-2.5-flash');
  console.log(`Model registry check for gemini-2.5-flash: Provider: ${geminiMetadata.provider}, Actual ID: ${geminiMetadata.id}`);
  if (geminiMetadata.provider !== 'google') {
    throw new Error('Gemini registry configuration mismatch!');
  }

  console.log('\n--- AGENT WORKSPACE API TEST COMPLETED SUCCESSFULLY ---');
}

runTest().catch((err) => {
  console.error('\n❌ Test failed with error:', err.message);
  process.exit(1);
});
