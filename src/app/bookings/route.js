import { NextResponse } from 'next/server';
import {
  AttemptEntity,
  BookingEntity,
  IdempotencyEntity,
  SlotEntity,
  getDb,
  getRetryAfterSeconds,
  hashBody,
  isValidEmail,
  normalizeEmail,
  normalizeName,
} from '../../lib/db';

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
 * Extracts and normalizes booking fields from an incoming request payload.
 *
 * @param {Object} body - Parsed JSON request body.
 * @returns {{ slot_id: string, name: string, email: string }} Normalized booking data.
 */
function getNormalizedBody(body) {
  const slotId = typeof body?.slot_id === 'string' ? body.slot_id.trim() : '';
  const name = normalizeName(body?.name);
  const email = normalizeEmail(body?.email);

  return { slot_id: slotId, name, email };
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

/**
 * Enforces Level 5 rate limiting of at most 5 attempts per email per minute.
 *
 * @param {import('typeorm').EntityManager} manager - Transactional entity manager.
 * @param {string} email - Normalized email address.
 * @returns {Promise<{ status: number, headers: Object, body: Object }|null>} 429 response info if exceeded, or null.
 */
async function validateRateLimit(manager, email) {
  if (!email) return null;

  const recentAttempts = await manager.getRepository(AttemptEntity).find({
    where: { email },
  });

  const cutoff = Date.now() - 60000;
  const withinWindow = recentAttempts.filter((attempt) => new Date(attempt.createdAt).getTime() > cutoff);

  if (withinWindow.length >= 5) {
    return {
      status: 429,
      headers: { 'Retry-After': String(getRetryAfterSeconds(withinWindow.map((attempt) => new Date(attempt.createdAt).getTime()))) },
      body: { error: 'too many booking attempts' },
    };
  }

  await manager.getRepository(AttemptEntity).insert({ email, createdAt: new Date() });
  return null;
}

/**
 * Handles GET /bookings to list a patient's booking history by email with cursor pagination.
 *
 * @param {Request} request - The incoming HTTP request.
 * @returns {Promise<NextResponse>} 200 with paginated bookings, 400 on invalid input, or 401 unauthorized.
 */
export async function GET(request) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const email = normalizeEmail(searchParams.get('email'));
  const limitValue = Number(searchParams.get('limit') ?? '10');
  const cursorValue = Number(searchParams.get('cursor') ?? '0');

  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }

  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 50) {
    return NextResponse.json({ error: 'invalid limit' }, { status: 400 });
  }

  const dataSource = await getDb();
  const repo = dataSource.getRepository(BookingEntity);
  const startIndex = Number.isFinite(cursorValue) && cursorValue > 0 ? cursorValue : 0;
  const [bookings, total] = await repo.findAndCount({
    where: { email },
    order: { createdAt: 'ASC' },
    skip: startIndex,
    take: limitValue,
  });

  const nextCursor = startIndex + limitValue < total ? String(startIndex + limitValue) : null;
  return NextResponse.json(
    {
      bookings: bookings.map(serializeBooking),
      next_cursor: nextCursor,
    },
    { status: 200 }
  );
}

/**
 * Handles POST /bookings to create an appointment booking.
 * Supports idempotency, concurrency locking, and rate limiting across Levels 1-5.
 *
 * @param {Request} request - The incoming HTTP request.
 * @returns {Promise<NextResponse>} 201 on success, 400 invalid details, 404 not found, 409 conflict, 422 mismatch, or 429 rate limited.
 */
export async function POST(request) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const normalized = getNormalizedBody(payload);
  const email = normalized.email;
  const idempotencyKey = request.headers.get('Idempotency-Key');

  const dataSource = await getDb();
  let response;

  try {
    await dataSource.transaction(async (manager) => {
      const rateLimitResult = await validateRateLimit(manager, email || '');
      if (rateLimitResult) {
        response = NextResponse.json(rateLimitResult.body, {
          status: rateLimitResult.status,
          headers: rateLimitResult.headers,
        });
        return;
      }

      if (!normalized.slot_id || !normalized.name || !normalized.email) {
        response = NextResponse.json({ error: 'missing or invalid booking details' }, { status: 400 });
        return;
      }

      if (!isValidEmail(normalized.email)) {
        response = NextResponse.json({ error: 'invalid email' }, { status: 400 });
        return;
      }

      const slotRepo = manager.getRepository(SlotEntity);
      const bookingRepo = manager.getRepository(BookingEntity);
      const idempotencyRepo = manager.getRepository(IdempotencyEntity);

      // Acquire a row lock on the slot to serialize concurrent booking attempts
      const slot = await slotRepo.findOne({
        where: { id: normalized.slot_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!slot) {
        response = NextResponse.json({ error: 'slot not found' }, { status: 404 });
        return;
      }

      // Level 4: Idempotency check BEFORE slot-start and conflict checks so a retry always
      // returns the original successful booking even if the slot has since started or been booked.
      if (idempotencyKey) {
        const existingKey = await idempotencyRepo.findOne({ where: { key: idempotencyKey } });
        if (existingKey) {
          if (existingKey.bodyHash !== hashBody(normalized)) {
            response = NextResponse.json({ error: 'idempotency key reused with a different body' }, { status: 422 });
            return;
          }

          const original = await bookingRepo.findOneBy({ id: existingKey.bookingId });
          if (!original) {
            response = NextResponse.json({ error: 'booking not found' }, { status: 404 });
            return;
          }
          response = NextResponse.json(serializeBooking(original), { status: 201 });
          return;
        }
      }

      const slotStart = new Date(slot.start).getTime();
      if (slotStart <= Date.now()) {
        response = NextResponse.json({ error: 'slot has already started' }, { status: 400 });
        return;
      }

      const existingConfirmed = await bookingRepo.count({
        where: { slotId: normalized.slot_id, status: 'confirmed' },
      });

      if (existingConfirmed > 0) {
        response = NextResponse.json({ error: 'slot already booked' }, { status: 409 });
        return;
      }

      const insert = await bookingRepo.insert({
        slotId: normalized.slot_id,
        name: normalized.name,
        email: normalized.email,
        status: 'confirmed',
      });

      const created = await bookingRepo.findOneBy({ id: insert.identifiers[0].id });

      if (idempotencyKey) {
        await idempotencyRepo.insert({
          key: idempotencyKey,
          bodyHash: hashBody(normalized),
          bookingId: created.id,
        });
      }

      response = NextResponse.json(serializeBooking(created), { status: 201 });
    });
  } catch (error) {
    // Separate idempotency-key conflicts from slot uniqueness conflicts
    if (idempotencyKey && error?.code === '23505') {
      try {
        const idempotencyRepo = dataSource.getRepository(IdempotencyEntity);
        const bookingRepo = dataSource.getRepository(BookingEntity);
        const existingKey = await idempotencyRepo.findOne({ where: { key: idempotencyKey } });
        if (existingKey) {
          if (existingKey.bodyHash !== hashBody(normalized)) {
            return NextResponse.json({ error: 'idempotency key reused with a different body' }, { status: 422 });
          }
          const original = await bookingRepo.findOneBy({ id: existingKey.bookingId });
          if (original) {
            return NextResponse.json(serializeBooking(original), { status: 201 });
          }
        }
      } catch (idempErr) {
        console.error('Error resolving concurrent idempotency collision:', idempErr);
      }
    }

    // If a database-level unique constraint on slot is violated during race conditions
    if (error?.code === '23505' || /duplicate key|unique constraint|one_confirmed_per_slot/i.test(error?.message || '')) {
      return NextResponse.json({ error: 'slot already booked' }, { status: 409 });
    }

    console.error('Booking transaction failed:', error?.stack || error);
    return NextResponse.json({ error: 'unexpected error' }, { status: 500 });
  }

  return response || NextResponse.json({ error: 'unexpected error' }, { status: 500 });
}
