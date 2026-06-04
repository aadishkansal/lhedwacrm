-- ============================================================
-- 039_log_outbound_whatsapp_message_rpc.sql
-- Creates an RPC function to log outbound WhatsApp messages sent by external systems (like the Sales Portal)
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_outbound_whatsapp_message(
  p_phone TEXT,
  p_name TEXT,
  p_organization_id UUID,
  p_message_text TEXT,
  p_meta_message_id TEXT,
  p_content_type TEXT DEFAULT 'text',
  p_template_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with admin privileges to bypass RLS policies
AS $$
DECLARE
  v_normalized_phone TEXT;
  v_contact_id UUID;
  v_conversation_id UUID;
  v_message_id UUID;
BEGIN
  -- 1. Normalize phone: keep only numbers
  v_normalized_phone := regexp_replace(p_phone, '\D', '', 'g');

  -- 2. Find existing contact in this organization using flexible phone matching (last 8 digits match)
  SELECT id INTO v_contact_id 
  FROM public.contacts 
  WHERE organization_id = p_organization_id 
    AND (
      regexp_replace(phone, '\D', '', 'g') = v_normalized_phone
      OR (
        length(regexp_replace(phone, '\D', '', 'g')) >= 8 
        AND length(v_normalized_phone) >= 8 
        AND right(regexp_replace(phone, '\D', '', 'g'), 8) = right(v_normalized_phone, 8)
      )
    )
    AND deleted_at IS NULL
  LIMIT 1;

  -- If not found, create a new contact
  IF v_contact_id IS NULL THEN
    INSERT INTO public.contacts (phone, name, organization_id)
    VALUES (v_normalized_phone, COALESCE(p_name, 'Sales Customer'), p_organization_id)
    RETURNING id INTO v_contact_id;
  END IF;

  -- 3. Find existing conversation for this contact
  SELECT id INTO v_conversation_id
  FROM public.conversations
  WHERE contact_id = v_contact_id
  LIMIT 1;

  -- If not found, create a new conversation
  IF v_conversation_id IS NULL THEN
    INSERT INTO public.conversations (contact_id, status)
    VALUES (v_contact_id, 'open')
    RETURNING id INTO v_conversation_id;
  END IF;

  -- 4. Log the outbound message (sender_type = 'agent')
  INSERT INTO public.messages (
    conversation_id,
    sender_type,
    content_type,
    content_text,
    message_id,
    template_name,
    status,
    created_at
  ) VALUES (
    v_conversation_id,
    'agent',
    p_content_type,
    p_message_text,
    p_meta_message_id,
    p_template_name,
    'sent',
    NOW()
  )
  RETURNING id INTO v_message_id;

  -- 5. Update the conversation header info for the inbox UI
  UPDATE public.conversations SET
    last_message_text = COALESCE(p_message_text, '[' || p_content_type || ']'),
    last_message_at = NOW(),
    updated_at = NOW()
  WHERE id = v_conversation_id;

  RETURN v_message_id;
END;
$$;
