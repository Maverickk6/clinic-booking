import { NextResponse } from 'next/server';
import { BookingEntity, getDb } from '../../../lib/db';

const publicKey = process.env.CLINIC_API_KEY || 'demo-key-123';

function rejectUnauthorized(request) {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey || apiKey !== publicKey) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

function serializeBooking(booking) {
  return {
    id: booking.id,
    slot_id: booking.slotId,
    name: booking.name,
    email: booking.email,
    status: booking.status,
    created_at: booking.createdAt instanceof Date ? booking.createdAt.toISOString() : booking.createdAt,
  };
}

export async function GET(request, { params }) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;

  const { id } = await params;
  const dataSource = await getDb();
  const booking = await dataSource.getRepository(BookingEntity).findOneBy({ id });

  if (!booking) {
    return NextResponse.json({ error: 'booking not found' }, { status: 404 });
  }

  return NextResponse.json(serializeBooking(booking), { status: 200 });
}

export async function DELETE(request, { params }) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;

  const { id } = await params;
  const dataSource = await getDb();
  const bookingRepo = dataSource.getRepository(BookingEntity);

  const booking = await bookingRepo.findOneBy({ id });
  if (!booking) {
    return NextResponse.json({ error: 'booking not found' }, { status: 404 });
  }

  if (booking.status === 'cancelled') {
    return NextResponse.json({ error: 'booking already cancelled' }, { status: 409 });
  }

  booking.status = 'cancelled';
  await bookingRepo.save(booking);
  return NextResponse.json(serializeBooking(booking), { status: 200 });
}
