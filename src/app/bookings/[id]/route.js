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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request, { params }) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;

  const { id } = await params;
  if (!id || !UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'booking not found' }, { status: 404 });
  }

  const dataSource = await getDb();
  let booking;
  try {
    booking = await dataSource.getRepository(BookingEntity).findOneBy({ id });
  } catch {
    return NextResponse.json({ error: 'booking not found' }, { status: 404 });
  }

  if (!booking) {
    return NextResponse.json({ error: 'booking not found' }, { status: 404 });
  }

  return NextResponse.json(serializeBooking(booking), { status: 200 });
}

export async function DELETE(request, { params }) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;

  const { id } = await params;
  if (!id || !UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'booking not found' }, { status: 404 });
  }

  const dataSource = await getDb();
  const bookingRepo = dataSource.getRepository(BookingEntity);

  let booking;
  try {
    booking = await bookingRepo.findOneBy({ id });
  } catch {
    return NextResponse.json({ error: 'booking not found' }, { status: 404 });
  }

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
