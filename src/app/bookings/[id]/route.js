import { NextResponse } from 'next/server';
import { BookingEntity, getDb } from '../../../lib/db';

const publicKey = process.env.CLINIC_API_KEY || 'demo-key-123';

/**
 * Validates the X-API-Key request header against the configured clinic API key.
 *
 * @param {Request} request - The incoming HTTP request.
 * @returns {NextResponse|null} 401 response if unauthorized, or null if valid.
 */
function rejectUnauthorized(request) {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey || apiKey !== publicKey) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

/**
 * Serializes a booking entity into the standardized API response format.
 *
 * @param {Object} booking - The BookingEntity database record.
 * @returns {Object} Serialized booking object conforming to OpenAPI schema.
 */
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Handles GET /bookings/:id to retrieve a single booking by ID.
 *
 * @param {Request} request - The incoming HTTP request.
 * @param {Object} context - Route parameters containing the booking id.
 * @returns {Promise<NextResponse>} 200 with booking data, 401 unauthorized, or 404 not found.
 */
export async function GET(request, { params }) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;

  const { id } = await params;
  if (!id || !UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'booking not found' }, { status: 404 });
  }

  let dataSource;
  try {
    dataSource = await getDb();
  } catch (error) {
    console.error(`Database initialization error for booking ${id}:`, error);
    return NextResponse.json({ error: 'database error' }, { status: 500 });
  }

  let booking;
  try {
    booking = await dataSource.getRepository(BookingEntity).findOneBy({ id });
  } catch (error) {
    console.error(`Database lookup error for booking ${id}:`, error);
    return NextResponse.json({ error: 'database error' }, { status: 500 });
  }

  if (!booking) {
    return NextResponse.json({ error: 'booking not found' }, { status: 404 });
  }

  return NextResponse.json(serializeBooking(booking), { status: 200 });
}

/**
 * Handles DELETE /bookings/:id to cancel a booking and release its slot.
 *
 * @param {Request} request - The incoming HTTP request.
 * @param {Object} context - Route parameters containing the booking id.
 * @returns {Promise<NextResponse>} 200 with cancelled booking, 401 unauthorized, 404 not found, or 409 conflict.
 */
export async function DELETE(request, { params }) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;

  const { id } = await params;
  if (!id || !UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'booking not found' }, { status: 404 });
  }

  let dataSource;
  try {
    dataSource = await getDb();
  } catch (error) {
    console.error(`Database initialization error during cancel for booking ${id}:`, error);
    return NextResponse.json({ error: 'database error' }, { status: 500 });
  }

  const bookingRepo = dataSource.getRepository(BookingEntity);

  let booking;
  try {
    booking = await bookingRepo.findOneBy({ id });
  } catch (error) {
    console.error(`Database lookup error during cancel for booking ${id}:`, error);
    return NextResponse.json({ error: 'database error' }, { status: 500 });
  }

  if (!booking) {
    return NextResponse.json({ error: 'booking not found' }, { status: 404 });
  }

  if (booking.status === 'cancelled') {
    return NextResponse.json({ error: 'booking already cancelled' }, { status: 409 });
  }

  booking.status = 'cancelled';
  try {
    await bookingRepo.save(booking);
  } catch (error) {
    console.error(`Database save error during cancel for booking ${id}:`, error);
    return NextResponse.json({ error: 'database error' }, { status: 500 });
  }
  return NextResponse.json(serializeBooking(booking), { status: 200 });
}
