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

const databaseUrl =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5432/clinic_booking';

let appDataSource = null;

export function getDataSource() {
  if (!appDataSource) {
    appDataSource = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      synchronize: true,
      logging: false,
      entities: [SlotEntity, BookingEntity, IdempotencyEntity, AttemptEntity],
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
  }

  return appDataSource;
}

export async function getDb() {
  const ds = getDataSource();

  if (!ds.isInitialized) {
    await ds.initialize();
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
