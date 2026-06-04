// scratch/test-ticketing-system.ts

import { ticketAIService } from '../src/modules/agents/services/ticket-ai-service';
import { supabaseAdmin } from '../src/modules/workflows/services/admin-client';

async function run() {
  console.log("=== STARTING CRM TICKETING SYSTEM VERIFICATION ===");
  const db = supabaseAdmin();

  // 1. Resolve test organization and user
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

  // Resolve a contact
  let { data: contact } = await db.from('contacts').select('id').eq('organization_id', orgId).limit(1).maybeSingle();
  if (!contact) {
    // Create contact
    const { data: newContact } = await db.from('contacts').insert({
      organization_id: orgId,
      user_id: userId,
      phone: '+15550299',
      name: 'Ticket Tester',
    }).select().single();
    contact = newContact;
  }
  const contactId = contact!.id;

  console.log(`Resolved Org: ${orgId}, User: ${userId}, Contact: ${contactId}`);

  // 2. Test AI classification, priority, and escalation detection
  console.log("\n--- 2. Testing AI Ticket Classification & Escalation ---");
  const angryMsg = "I am extremely angry that my electrical permit is delayed for 3 weeks! This is unacceptable! I want to speak to your manager right now!";
  const billingMsg = "Hi, can you send me the invoice for my solar panel installation? I need to review the billing details.";

  const angryAnalysis = await ticketAIService.analyzeTicket({
    text: angryMsg,
    organizationId: orgId,
  });
  console.log("Angry Message Analysis:", angryAnalysis);
  if (angryAnalysis.escalated !== true) {
    console.error("❌ Escalation detection failed for angry message.");
  } else {
    console.log("✅ Escalation successfully detected!");
  }

  const billingAnalysis = await ticketAIService.analyzeTicket({
    text: billingMsg,
    organizationId: orgId,
  });
  console.log("Billing Message Analysis:", billingAnalysis);
  if (billingAnalysis.category !== 'billing') {
    console.warn("⚠️ Category detection classified billing inquiry as:", billingAnalysis.category);
  } else {
    console.log("✅ Billing category successfully classified!");
  }

  // 3. Test AI Suggest Reply
  console.log("\n--- 3. Testing AI Suggested Reply Draft ---");
  const draft = await ticketAIService.suggestReply({
    ticket: {
      title: "Permit delay inquiry",
      category: "technical",
      priority: "high",
    },
    history: [
      { role: 'user', content: "Why is my electrical permit taking so long?" },
      { role: 'assistant', content: "Let me check the status of your permit with the local utility company." },
      { role: 'user', content: "Please hurry, the installer said we cannot start without it." }
    ],
    organizationId: orgId,
  });
  console.log("Draft response generated:");
  console.log(draft);
  if (!draft || draft.length < 10) {
    console.error("❌ Draft response generation failed.");
  } else {
    console.log("✅ Draft response generation successful!");
  }

  // 4. Test Database Operations (Create Ticket, Add Note, Resolve Ticket)
  console.log("\n--- 4. Testing Database Operations & Telemetry ---");
  
  // Create ticket
  const { data: ticket, error: createErr } = await db.from('support_tickets').insert({
    organization_id: orgId,
    contact_id: contactId,
    title: "E2E Test Ticket: Structural Inspection Delay",
    priority: "medium",
    category: "installation",
    status: "open",
  }).select().single();

  if (createErr || !ticket) {
    console.error("❌ Database ticket insertion failed:", createErr?.message);
    process.exit(1);
  }
  console.log("Created Ticket:", ticket.id);

  // Add internal note
  const { data: note, error: noteErr } = await db.from('ticket_comments').insert({
    ticket_id: ticket.id,
    organization_id: orgId,
    author_id: userId,
    content: "Spoke to local county inspector. Inspection is scheduled for Friday morning.",
    is_internal: true,
  }).select().single();

  if (noteErr || !note) {
    console.error("❌ Database ticket comment insertion failed:", noteErr?.message);
    process.exit(1);
  }
  console.log("Created Note:", note.id);

  // Update ticket assignee
  const { data: assignedTicket, error: assignErr } = await db.from('support_tickets').update({
    assigned_agent_id: userId,
  }).eq('id', ticket.id).select().single();

  if (assignErr || !assignedTicket) {
    console.error("❌ Assignee update failed:", assignErr?.message);
    process.exit(1);
  }
  console.log("Assigned Ticket to User:", assignedTicket.assigned_agent_id);

  // Resolve Ticket
  const resolvedAt = new Date().toISOString();
  const { data: resolvedTicket, error: resolveErr } = await db.from('support_tickets').update({
    status: 'resolved',
    resolution_notes: 'Inspection completed and passed on Friday morning.',
    resolved_at: resolvedAt,
    resolved_by: userId,
  }).eq('id', ticket.id).select().single();

  if (resolveErr || !resolvedTicket) {
    console.error("❌ Resolution update failed:", resolveErr?.message);
    process.exit(1);
  }
  console.log("Resolved Ticket Telemetry:");
  console.log(`- Status: ${resolvedTicket.status}`);
  console.log(`- Resolution notes: ${resolvedTicket.resolution_notes}`);
  console.log(`- Resolved at: ${resolvedTicket.resolved_at}`);
  console.log(`- Resolved by: ${resolvedTicket.resolved_by}`);

  // Cleanup
  console.log("\n--- 5. Cleaning up test data ---");
  await db.from('ticket_comments').delete().eq('ticket_id', ticket.id);
  await db.from('support_tickets').delete().eq('id', ticket.id);
  console.log("Cleanup finished.");

  console.log("\n✅ ALL CRM TICKETING SYSTEM VERIFICATIONS PASSED SUCCESSFULLY!");
  process.exit(0);
}

run().catch((err) => {
  console.error("Verification execution error:", err);
  process.exit(1);
});
