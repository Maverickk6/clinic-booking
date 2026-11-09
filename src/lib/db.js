import crypto from 'crypto';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';

export const SlotEntity = new EntitySchema({
  name: 'Slot',
  tableName: 'slots',
  columns: {
    id: { type: 'varchar', primary: true },
    provider: { type: 'varchar', nullable: false },
    start: { type: 'timestamptz', nullable: false },
    end: { type: 'timestamptz', nullable: false },
  },
  relations: {
    bookings: {
      type: 'one-to-many',
      target: 'Booking',
      inverseSide: 'slot',
      cascade: true,
    },
  },
});

export const BookingEntity = new EntitySchema({
  name: 'Booking',
  tableName: 'bookings',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    slotId: { type: 'varchar', name: 'slot_id', nullable: false },
    name: { type: 'varchar', nullable: false },
    email: { type: 'varchar', nullable: false },
    status: { type: 'varchar', nullable: false, default: 'confirmed' },
    createdAt: { type: 'timestamptz', name: 'created_at', createDate: true },
  },
  relations: {
    slot: {
      type: 'many-to-one',
      target: 'Slot',
      joinColumn: { name: 'slot_id', referencedColumnName: 'id' },
      nullable: false,
      onDelete: 'CASCADE',
    },
  },
});

export const IdempotencyEntity = new EntitySchema({
  name: 'IdempotencyKey',
  tableName: 'idempotency_keys',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    key: { type: 'varchar', nullable: false, unique: true },
    bodyHash: { type: 'varchar', name: 'body_hash', nullable: false },
    bookingId: { type: 'uuid', name: 'booking_id', nullable: false },
    createdAt: { type: 'timestamptz', name: 'created_at', createDate: true },
  },
});

export const AttemptEntity = new EntitySchema({
  name: 'BookingAttempt',
  tableName: 'booking_attempts',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    email: { type: 'varchar', nullable: false },
    createdAt: { type: 'timestamptz', name: 'created_at', createDate: true },
  },
});

const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'No database URL configured. Set POSTGRES_URL or DATABASE_URL in your environment.'
  );
}

const shouldUseSsl =
  process.env.POSTGRES_SSL === 'true' || /sslmode=require/i.test(databaseUrl || '');

export function createSeedSlots(count = 12) {
  const providers = ['Dr Ade', 'Dr Moyo', 'Dr Smith', 'Dr Okafor'];
  const start = new Date();
  // Start tomorrow at 9:00 AM to guarantee all seeded slots are in the future
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);

  return Array.from({ length: count }, (_, index) => {
    const provider = providers[index % providers.length];
    const dayOffset = Math.floor(index / providers.length);
    const hourOffset = (index % providers.length) * 2;
    const slotStart = new Date(start.getTime() + dayOffset * 86400000 + hourOffset * 3600000);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60000);

    return {
      id: `seed-${index + 1}`,
      provider,
      start: slotStart.toISOString(),
      end: slotEnd.toISOString(),
    };
  });
}

export async function seedDatabase({ count = 12, dataSource = null } = {}) {
  const ds = dataSource || (await getDb());
  const slots = createSeedSlots(count);

  await ds.transaction(async (manager) => {
    // Use DELETE instead of TRUNCATE to avoid PostgreSQL foreign key truncation constraint errors
    await manager.query('DELETE FROM bookings');
    await manager.query('DELETE FROM idempotency_keys');
    await manager.query('DELETE FROM booking_attempts');
    await manager.query('DELETE FROM slots');

    await manager.getRepository(SlotEntity).insert(
      slots.map((slot) => ({
        id: String(slot.id || ''),
        provider: String(slot.provider || ''),
        start: new Date(slot.start),
        end: new Date(slot.end),
      }))
    );
  });

  return slots;
}

let appDataSource = null;

function getCleanDatabaseUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete('sslmode');
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function getDataSource() {
  if (!appDataSource) {
    // Safely remove sslmode query param so TypeORM's ssl options take precedence
    const cleanUrl = getCleanDatabaseUrl(databaseUrl);
    const sslConfig = shouldUseSsl ? { rejectUnauthorized: false } : false;

    appDataSource = new DataSource({
      type: 'postgres',
      url: cleanUrl,
      synchronize: true,
      logging: false,
      entities: [SlotEntity, BookingEntity, IdempotencyEntity, AttemptEntity],
      ssl: sslConfig,
      extra: {
        ssl: sslConfig,
      },
    });
  }

  return appDataSource;
}

let partialIndexCreated = false;

export async function getDb() {
  const ds = getDataSource();

  if (!ds.isInitialized) {
    await ds.initialize();
  }

  // Ensure partial unique index exists for concurrency-safe slot booking.
  // TypeORM synchronize cannot create partial indexes, so we do it manually once.
  if (!partialIndexCreated) {
    partialIndexCreated = true;
    try {
      await ds.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_per_slot
        ON bookings (slot_id)
        WHERE status = 'confirmed'
      `);
    } catch {
      // Index may already exist under a different name — not fatal.
    }
  }

  return ds;
}

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
}

export function hashBody(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export function getRetryAfterSeconds(times) {
  if (!Array.isArray(times) || times.length === 0) {
    return 60;
  }

  const oldest = new Date(Math.min(...times)).getTime();
  const delay = 60000 - (Date.now() - oldest);
  return Math.max(1, Math.ceil(delay / 1000));
}
