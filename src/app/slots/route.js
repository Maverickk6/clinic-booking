import { NextResponse } from 'next/server';
import { BookingEntity, SlotEntity, getDb } from '../../lib/db';

const expectedKey = process.env.CLINIC_API_KEY || 'demo-key-123';

function rejectUnauthorized(request) {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(request) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get('provider');
  const dataSource = await getDb();
  const slotRepo = dataSource.getRepository(SlotEntity);
  const bookingRepo = dataSource.getRepository(BookingEntity);

  const slots = await slotRepo.find({
    order: { start: 'ASC' },
  });

  const filtered = provider ? slots.filter((slot) => slot.provider === provider) : slots;
  const payload = await Promise.all(
    filtered.map(async (slot) => {
      const booked = await bookingRepo.count({
        where: { slotId: slot.id, status: 'confirmed' },
      });

      return {
        id: slot.id,
        provider: slot.provider,
        start: new Date(slot.start).toISOString(),
        end: new Date(slot.end).toISOString(),
        available: booked === 0,
      };
    })
  );

  return NextResponse.json({ slots: payload }, { status: 200 });
}
