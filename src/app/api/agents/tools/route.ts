import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { registry } from '@/modules/agents/tools';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Force register/load of tools registry exports if not already initiated
    const tools = registry.getAll().map((t) => ({
      name: t.name,
      description: t.description,
    }));

    return NextResponse.json({ tools });
  } catch (error: any) {
    console.error('[API Tools GET] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
