import { NextResponse } from 'next/server';
import { BookingEntity, AttemptEntity, IdempotencyEntity, SlotEntity, getDb, seedDatabase } from '../../lib/db';

/**
 * Handles POST /reset to clear all existing bookings and replace slots.
 * If slots payload is absent or invalid, seeds default future slots.
 * If slots is an explicitly provided array (including an empty array), replaces slots accordingly.
 *
 * @param {Request} request - The incoming HTTP request.
 * @returns {Promise<NextResponse>} 200 with result count, 400 invalid payload, or 401 unauthorized.
 */
export async function POST(request) {
  const apiKey = request.headers.get('X-API-Key');
  const expectedKey = process.env.CLINIC_API_KEY || 'demo-key-123';

  if (!apiKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const dataSource = await getDb();

  // If slots is absent or not an array, seed default slots
  if (!Array.isArray(payload?.slots)) {
    const seeded = await seedDatabase({ count: 12, dataSource });
    return NextResponse.json({ ok: true, count: seeded.length }, { status: 200 });
  }

  const slots = payload.slots;

  await dataSource.transaction(async (manager) => {
    // Truncate BookingEntity and SlotEntity together in a single command to satisfy foreign keys
    await manager.query('TRUNCATE TABLE bookings, slots CASCADE');
    await manager.getRepository(IdempotencyEntity).clear();
    await manager.getRepository(AttemptEntity).clear();

    if (slots.length > 0) {
      await manager.getRepository(SlotEntity).insert(
        slots.map((slot) => ({
          id: String(slot.id || ''),
          provider: String(slot.provider || ''),
          start: new Date(slot.start),
          end: new Date(slot.end),
        }))
      );
    }
  });

  return NextResponse.json({ ok: true, count: slots.length }, { status: 200 });
}
