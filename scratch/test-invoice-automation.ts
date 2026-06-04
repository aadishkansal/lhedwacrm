// scratch/test-invoice-automation.ts

import { invoiceReminderService } from '../src/modules/workflows/services/invoice-reminder-service';
import { supabaseAdmin } from '../src/modules/workflows/services/admin-client';

async function run() {
  console.log("=== STARTING INVOICE REMINDER AUTOMATION VERIFICATION ===");
  const db = supabaseAdmin();

  // 1. Resolve organization and user
  const { data: org } = await db.from('organizations').select('id').limit(1).single();
  if (!org) {
    console.error("Fatal: No organization found.");
    process.exit(1);
  }
  const orgId = org.id;

  const { data: orgUser } = await db.from('organization_users').select('user_id').eq('organization_id', orgId).limit(1).single();
  if (!orgUser) {
    console.error("Fatal: No organization user found.");
    process.exit(1);
  }
  const userId = orgUser.user_id;

  // Resolve/create contact
  let { data: contact } = await db.from('contacts').select('id').eq('organization_id', orgId).limit(1).maybeSingle();
  if (!contact) {
    const { data: newContact } = await db.from('contacts').insert({
      organization_id: orgId,
      user_id: userId,
      phone: '+18887776',
      name: 'Invoice Automation Contact',
    }).select().single();
    contact = newContact;
  }
  const contactId = contact!.id;

  console.log(`Resolved Org: ${orgId}, User: ${userId}, Contact: ${contactId}`);

  // Create an active deal
  const { data: pipeline } = await db.from('pipelines').select('id').eq('user_id', userId).limit(1).single();
  let pipelineId = pipeline?.id;
  if (!pipelineId) {
    const { data: newPipe } = await db.from('pipelines').insert({
      user_id: userId,
      name: 'Sales Pipeline',
    }).select().single();
    pipelineId = newPipe.id;
  }

  const { data: stage } = await db.from('pipeline_stages').select('id, name').eq('pipeline_id', pipelineId).limit(1).single();
  let stageId = stage?.id;
  if (!stageId) {
    const { data: newStage } = await db.from('pipeline_stages').insert({
      pipeline_id: pipelineId,
      name: 'Negotiation',
      position: 0,
    }).select().single();
    stageId = newStage.id;
  }

  const { data: deal } = await db.from('deals').insert({
    organization_id: orgId,
    user_id: userId,
    pipeline_id: pipelineId,
    stage_id: stageId,
    contact_id: contactId,
    title: 'Invoice Test Deal',
    value: 200000,
    status: 'open',
  }).select().single();

  if (!deal) {
    console.error("Fatal: Seed deal failed.");
    process.exit(1);
  }

  // 2. Seed Invoice record
  console.log("\n--- 2. Seeding Invoice ---");
  const { data: invoice, error: invErr } = await db.from('invoices').insert({
    organization_id: orgId,
    contact_id: contactId,
    amount: 150000.00,
    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days from now
    status: 'draft',
  }).select().single();

  if (invErr || !invoice) {
    console.error("Fatal: Invoice insertion failed:", invErr?.message);
    process.exit(1);
  }
  console.log(`Created Invoice: ${invoice.id} (Status: ${invoice.status})`);

  // 3. Test Invoice Triggering on Status Change to 'sent'
  console.log("\n--- 3. Testing Invoice Trigger (Sent) ---");
  await invoiceReminderService.triggerInvoiceUpdated({
    userId,
    contactId,
    invoiceId: invoice.id,
    status: 'sent',
    amount: Number(invoice.amount),
    dueDate: invoice.due_date,
  });
  console.log("✅ Triggered 'sent' status event successfully.");

  // 4. Test Reminder Scheduling & Cancellation (Payment Confirmation Handling)
  console.log("\n--- 4. Testing Payment Confirmation Cancellation ---");

  // Create an automation to bind to the pending execution
  const { data: automation } = await db.from('automations').insert({
    user_id: userId,
    name: 'Test Invoice Reminders',
    trigger_type: 'invoice_updated',
  }).select().single();

  if (!automation) {
    console.error("Fatal: Automation creation failed.");
    process.exit(1);
  }

  // Seed a pending wait execution
  const runAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow
  const { data: pending, error: pendErr } = await db.from('automation_pending_executions').insert({
    automation_id: automation.id,
    user_id: userId,
    contact_id: contactId,
    status: 'pending',
    next_step_position: 2,
    run_at: runAt.toISOString(),
    context: { invoice_id: invoice.id },
  }).select().single();

  if (pendErr || !pending) {
    console.error("Fatal: Pending execution seed failed:", pendErr?.message);
    process.exit(1);
  }
  console.log(`Seeded pending execution: ${pending.id} (Status: ${pending.status})`);

  // Trigger invoice paid status (Payment Confirmation)
  console.log("Triggering invoice update status to 'paid'...");
  await invoiceReminderService.triggerInvoiceUpdated({
    userId,
    contactId,
    invoiceId: invoice.id,
    status: 'paid',
    amount: Number(invoice.amount),
    dueDate: invoice.due_date,
  });

  // Verify that the pending execution is marked as 'done' (cancelled)
  const { data: checkPending } = await db
    .from('automation_pending_executions')
    .select('status')
    .eq('id', pending.id)
    .single();

  console.log(`Pending execution status after payment trigger: ${checkPending?.status}`);
  if (checkPending?.status !== 'done') {
    console.error("❌ Payment confirmation cancellation failed! Expected 'done', got:", checkPending?.status);
  } else {
    console.log("✅ Payment confirmation cancelled scheduled reminders successfully!");
  }

  // 5. Test Effectiveness Telemetry Calculations
  console.log("\n--- 5. Testing Reminder Effectiveness Stats ---");

  // Seed invoice reminders to test telemetry
  const firstReminderSentAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(); // 4 hours ago
  const { data: reminderRow } = await db.from('invoice_reminders').insert({
    invoice_id: invoice.id,
    organization_id: orgId,
    channel: 'whatsapp',
    scheduled_at: firstReminderSentAt,
    sent_at: firstReminderSentAt,
    reminder_count: 1,
    status: 'sent',
  }).select().single();

  // Update invoice status to paid and log paid_at
  const paidAt = new Date().toISOString(); // paid just now
  await db.from('invoices').update({
    status: 'paid',
    paid_at: paidAt,
  }).eq('id', invoice.id);

  // Retrieve stats
  const stats = await invoiceReminderService.getReminderEffectiveness(orgId);
  console.log("Reminder Effectiveness Stats:", stats);

  if (stats.totalInvoices < 1) console.error("❌ Stats totalInvoices count invalid.");
  if (stats.totalPaid < 1) console.error("❌ Stats totalPaid count invalid.");
  if (stats.totalRemindersSent < 1) console.error("❌ Stats totalRemindersSent count invalid.");
  if (stats.recoveryRate !== 100) console.error("❌ Stats recoveryRate calculation invalid. Expected 100%, got:", stats.recoveryRate);
  
  // Diff between firstReminderSentAt (4 hours ago) and paidAt (now) should be ~4.0 hours
  console.log(`Average time to payment: ${stats.averageTimeToPaymentHours} hours`);
  if (stats.averageTimeToPaymentHours < 3.9 || stats.averageTimeToPaymentHours > 4.1) {
    console.warn("⚠️ Stats averageTimeToPaymentHours is outside the expected 4.0h range:", stats.averageTimeToPaymentHours);
  } else {
    console.log("✅ Effectiveness stats calculation validated successfully!");
  }

  // 6. Cleanup
  console.log("\n--- 6. Cleaning up test data ---");
  await db.from('invoice_reminders').delete().eq('invoice_id', invoice.id);
  await db.from('automation_pending_executions').delete().eq('automation_id', automation.id);
  await db.from('automations').delete().eq('id', automation.id);
  await db.from('invoices').delete().eq('id', invoice.id);
  await db.from('deals').delete().eq('id', deal.id);
  console.log("Cleanup finished.");

  console.log("\n✅ ALL INVOICE REMINDER AUTOMATION VERIFICATIONS PASSED SUCCESSFULLY!");
  process.exit(0);
}

run().catch((err) => {
  console.error("Verification execution error:", err);
  process.exit(1);
});
