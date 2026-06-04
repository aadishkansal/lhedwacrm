
import { createClient } from '@supabase/supabase-js';
import { Queue, Worker, Job } from 'bullmq';

// Use raw supabase (no path alias)
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const REDIS_OPTS = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
};

async function main() {
  console.log('=== Direct Worker Test ===');

  // Get org/user
  const { data: org } = await db.from('organizations').select('id').limit(1).single();
  const { data: orgUser } = await db.from('organization_users').select('user_id').eq('organization_id', org!.id).limit(1).single();
  const userId = orgUser!.user_id;
  const orgId = org!.id;

  console.log(`Org: ${orgId}, User: ${userId}`);

  // Get or create test contact
  const { data: contact } = await db.from('contacts').select('*').eq('phone', '+15550199').maybeSingle();
  const contactId = contact!.id;
  console.log(`Contact: ${contactId}`);

  // Create automation
  const { data: automation, error: autErr } = await db.from('automations').insert({
    user_id: userId,
    name: 'Direct Worker Test',
    trigger_type: 'project_updated',
    trigger_config: {},
    is_active: true,
  }).select().single();
  if (autErr) throw new Error(`Failed to create automation: ${autErr.message}`);
  console.log(`Automation: ${automation.id}`);

  // Create a simple update_contact_field step
  const { data: step, error: stepErr } = await db.from('automation_steps').insert({
    automation_id: automation.id,
    step_type: 'update_contact_field',
    step_config: { field: 'company', value: 'Direct Test Corp' },
    position: 0,
  }).select().single();
  if (stepErr) throw new Error(`Failed to create step: ${stepErr.message}`);
  console.log(`Step: ${step.id}`);

  // Create the workflow run directly
  const { data: run, error: runErr } = await db.from('workflow_runs').insert({
    organization_id: orgId,
    automation_id: automation.id,
    contact_id: contactId,
    status: 'active',
    variables: { vars: {}, message_text: '', conversation_id: null },
  }).select().single();
  if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);
  console.log(`Run: ${run.id}`);

  // Spin up a LOCAL queue/worker to test the execute-step handler
  const q = new Queue('worker-direct-test', { connection: REDIS_OPTS });
  
  // Create worker that mirrors bullmq-engine's execute-step logic but simplified
  const w = new Worker('worker-direct-test', async (job: Job) => {
    console.log(`\nProcessing job: ${job.name}`, job.data);

    const { data: ste } = await db.from('automation_steps')
      .select('*')
      .eq('automation_id', run.automation_id)
      .gte('position', 0)
      .is('parent_step_id', null)
      .order('position', { ascending: true });
    
    console.log(`Steps fetched: ${ste?.length}`, JSON.stringify(ste?.map(s => ({ id: s.id, type: s.step_type })), null, 2));
    
    if (!ste || ste.length === 0) {
      console.log('No steps found!');
      return;
    }

    for (const s of ste) {
      const cfg = s.step_config as any;
      console.log(`Executing step ${s.id} (${s.step_type})...`);
      
      if (s.step_type === 'update_contact_field') {
        const { error } = await db.from('contacts').update({ [cfg.field]: cfg.value }).eq('id', contactId);
        console.log(`update_contact_field result:`, error ? `ERROR: ${error.message}` : 'OK');
        
        await db.from('workflow_step_executions').insert({
          organization_id: orgId,
          run_id: run.id,
          step_id: s.id,
          status: 'completed',
          attempt_count: 1,
          input_payload: { config: cfg },
          output_payload: { result: `${cfg.field} updated` },
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        });
        console.log('Step execution recorded');
      }
    }
    
    // Mark run completed
    await db.from('workflow_runs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', run.id);
    console.log('Run marked completed');
  }, { connection: REDIS_OPTS });

  w.on('failed', (job, err) => console.error('Job failed:', job?.name, err.message));
  w.on('error', (err) => console.error('Worker error:', err.message));

  // Add the job
  await q.add('test-execute', { runId: run.id });
  console.log('\nJob added, waiting 10s for processing...');
  await new Promise(r => setTimeout(r, 10000));

  // Check result
  const { data: updatedRun } = await db.from('workflow_runs').select('*').eq('id', run.id).single();
  const { data: execs } = await db.from('workflow_step_executions').select('*').eq('run_id', run.id);
  const { data: updatedContact } = await db.from('contacts').select('company').eq('id', contactId).single();

  console.log(`\nRun status: ${updatedRun?.status}`);
  console.log(`Step executions: ${execs?.length}`);
  console.log(`Contact company: ${updatedContact?.company}`);

  if (updatedRun?.status === 'completed' && (execs?.length ?? 0) >= 1) {
    console.log('\n✅ DIRECT WORKER TEST PASSED!');
  } else {
    console.log('\n❌ DIRECT WORKER TEST FAILED!');
  }

  // Cleanup
  await db.from('workflow_step_executions').delete().eq('run_id', run.id);
  await db.from('workflow_runs').delete().eq('id', run.id);
  await db.from('automation_steps').delete().eq('automation_id', automation.id);
  await db.from('automations').delete().eq('id', automation.id);

  await w.close();
  await q.drain();
  await q.close();
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
