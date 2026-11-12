import { NextResponse } from 'next/server';
import { BookingEntity, AttemptEntity, IdempotencyEntity, SlotEntity, getDb, lockTablesInOrder, seedDatabase } from '../../lib/db';

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

  let payload = {};
  try {
    payload = (await request.json()) || {};
  } catch {
    payload = {};
  }

  let dataSource;
  try {
    dataSource = await getDb();
  } catch (error) {
    return NextResponse.json(
      { error: 'Database unavailable', details: error.message },
      { status: 500 }
    );
  }

  try {
    // Missing or malformed payloads seed defaults; an explicit empty array is treated as a full reset.
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.slots)) {
      const seeded = await seedDatabase({ count: 12, dataSource });
      return NextResponse.json({ ok: true, count: seeded.length }, { status: 200 });
    }

    const slots = payload.slots;

    await dataSource.transaction(async (manager) => {
      await lockTablesInOrder(manager);
      await manager.query('TRUNCATE TABLE bookings, idempotency_keys, booking_attempts, slots CASCADE');

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
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to reset slots', details: error.message },
      { status: 500 }
    );
  }
}
