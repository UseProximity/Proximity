import { NextResponse } from 'next/server';

const AIRTABLE_BASE = 'appm77rMuwqoMG0HW';
const STUDENTS_TABLE = 'tbl7iz7uy5zLTRdvz';
const LANDLORDS_TABLE = 'tblB7mcwzBupm7kDS';

export async function POST(request) {
  const secret = request.headers.get('x-webhook-secret');
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const record = body.record;

  const { id, role, name = 'Unknown', email = '', created_at } = record;

  if (role === 'super') {
    return NextResponse.json({ skipped: true });
  }

  let tableId, fields;

  if (role === 'landlord') {
    tableId = LANDLORDS_TABLE;
    fields = {
      fldUnVcdL5u0Mc3TU: name,
      fldkXAAT6AA4tpEZN: email,
      fldAN4BbtkKtKWMcf: created_at,
      fldThChWaPMGCWDDi: 'New',
      fldY2SoGULu4KO6uG: 'Account Created',
      fldeP7dIarXo9M27L: `Supabase user ID: ${id}`,
    };
  } else if (role === 'student') {
    tableId = STUDENTS_TABLE;
    fields = {
      fldo9n9JObCn8pJ3n: name,
      fldq64me1z1VqmYW9: email,
      fld9If7eaVBeP2nEQ: created_at,
      fldpWbPmd3TsIOdDl: 'New',
      fldOdtxthVkEJrzsF: `Supabase user ID: ${id} | Signed up via platform`,
    };
  } else {
    return NextResponse.json({ skipped: `Unknown role: ${role}` });
  }

  const airtableRes = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${tableId}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields, typecast: true }),
    }
  );

  if (!airtableRes.ok) {
    const err = await airtableRes.text();
    console.error('[new-user webhook] Airtable error:', err);
    return NextResponse.json({ error: err }, { status: 500 });
  }

  console.log(`[new-user webhook] Created Airtable ${role} record for ${email}`);
  return NextResponse.json({ success: true, role });
}
