import { NextResponse } from 'next/server';
import { BookingEntity, AttemptEntity, IdempotencyEntity, SlotEntity, getDb, seedDatabase } from '../../lib/db';

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

  if (!Array.isArray(payload?.slots) || payload.slots.length === 0) {
    const seeded = await seedDatabase({ count: 12, dataSource });
    return NextResponse.json({ ok: true, count: seeded.length }, { status: 200 });
  }

  const slots = payload.slots;

  await dataSource.transaction(async (manager) => {
    await manager.getRepository(BookingEntity).clear();
    await manager.getRepository(IdempotencyEntity).clear();
    await manager.getRepository(AttemptEntity).clear();
    await manager.getRepository(SlotEntity).clear();

    await manager.getRepository(SlotEntity).insert(
      slots.map((slot) => ({
        id: String(slot.id || ''),
        provider: String(slot.provider || ''),
        start: new Date(slot.start),
        end: new Date(slot.end),
      }))
    );
  });

  return NextResponse.json({ ok: true, count: slots.length }, { status: 200 });
}
