import { NextResponse } from 'next/server';
import supabase from '@/libs/supabase';

const AIRTABLE_BASE = 'appm77rMuwqoMG0HW';
const LANDLORDS_TABLE = 'tblB7mcwzBupm7kDS';

async function findLandlordInAirtable(email) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${LANDLORDS_TABLE}?filterByFormula=({Email}="${email}")`,
    { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
  );
  const data = await res.json();
  return data.records?.[0] ?? null;
}

async function createLandlordInAirtable(landlordUser, landlordSupabaseId, listingTitle) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${LANDLORDS_TABLE}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          fldUnVcdL5u0Mc3TU: landlordUser.name || 'Unknown',
          fldkXAAT6AA4tpEZN: landlordUser.email,
          fldLBrfX30onGz50E: listingTitle,
          fldThChWaPMGCWDDi: 'New',
          fldY2SoGULu4KO6uG: 'Listing Added',
          fldeP7dIarXo9M27L: `Supabase landlord_id: ${landlordSupabaseId}`,
        },
        typecast: true,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable create failed: ${err}`);
  }
}

async function updateLandlordInAirtable(airtableRecordId, existingProperties, listingTitle) {
  const updatedProperties = existingProperties
    ? `${existingProperties}\n${listingTitle}`
    : listingTitle;

  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${LANDLORDS_TABLE}/${airtableRecordId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          fldLBrfX30onGz50E: updatedProperties,
          fldY2SoGULu4KO6uG: 'Listing Added',
        },
        typecast: true,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable update failed: ${err}`);
  }
}

export async function POST(request) {
  const secret = request.headers.get('x-webhook-secret');
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const listing = body.record;

  const listingId = listing.id;
  if (!listingId) {
    return NextResponse.json({ skipped: 'No listing id' });
  }

  // Fetch landlord user_ids from listing_landlords (landlord_id no longer on listings)
  const { data: landlordRows } = await supabase
    .from('listing_landlords')
    .select('user_id')
    .eq('listing_id', listingId);
  const landlordIds = (landlordRows ?? []).map((r) => r.user_id);

  const listingTitle = listing.title || listing.address || 'Unknown address';

  if (landlordIds.length === 0) {
    return NextResponse.json({ skipped: 'No landlords for listing' });
  }

  // Fetch all landlord users from Supabase in one query
  const { data: landlordUsers, error } = await supabase
    .from('users')
    .select('id, email, name')
    .in('id', landlordIds);

  if (error) {
    console.error('[new-listing webhook] Supabase error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];

  for (const landlordUser of landlordUsers ?? []) {
    if (!landlordUser.email) {
      results.push({ id: landlordUser.id, skipped: 'No email' });
      continue;
    }

    try {
      const existing = await findLandlordInAirtable(landlordUser.email);

      if (!existing) {
        await createLandlordInAirtable(landlordUser, landlordUser.id, listingTitle);
        console.log(`[new-listing webhook] Created Airtable landlord record for ${landlordUser.email}`);
        results.push({ id: landlordUser.id, action: 'created' });
      } else {
        const existingProperties = existing.fields['fldLBrfX30onGz50E'] || '';
        await updateLandlordInAirtable(existing.id, existingProperties, listingTitle);
        console.log(`[new-listing webhook] Updated Airtable landlord record for ${landlordUser.email}`);
        results.push({ id: landlordUser.id, action: 'updated' });
      }
    } catch (err) {
      console.error(`[new-listing webhook] Failed for ${landlordUser.email}:`, err.message);
      results.push({ id: landlordUser.id, error: err.message });
    }
  }

  return NextResponse.json({ success: true, results });
}
