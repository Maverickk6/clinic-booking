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
  indices: [
    {
      name: 'one_confirmed_per_slot',
      columns: ['slotId'],
      unique: true,
      where: "status = 'confirmed'",
    },
  ],
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

/**
 * Generates initial appointment slots for doctors starting from tomorrow at 9:00 AM.
 *
 * @param {number} [count=12] - Number of slots to generate.
 * @returns {Array<{ id: string, provider: string, start: string, end: string }>} Seed slot definitions.
 */
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

/**
 * Seeds the database with default slots after truncating existing bookings and slots.
 *
 * @param {Object} [options] - Seeding options.
 * @param {number} [options.count=12] - Number of slots to seed.
 * @param {DataSource|null} [options.dataSource=null] - Optional existing DataSource instance.
 * @returns {Promise<Array<Object>>} The seeded slots.
 */
export async function lockTablesInOrder(manager) {
  await manager.getRepository(BookingEntity).find({
    select: ['id'],
    order: { id: 'ASC' },
    lock: { mode: 'pessimistic_write' },
  });

  await manager.getRepository(IdempotencyEntity).find({
    select: ['id'],
    order: { id: 'ASC' },
    lock: { mode: 'pessimistic_write' },
  });

  await manager.getRepository(AttemptEntity).find({
    select: ['id'],
    order: { id: 'ASC' },
    lock: { mode: 'pessimistic_write' },
  });

  await manager.getRepository(SlotEntity).find({
    select: ['id'],
    order: { id: 'ASC' },
    lock: { mode: 'pessimistic_write' },
  });
}

export async function seedDatabase({ count = 12, dataSource = null } = {}) {
  const ds = dataSource || (await getDb());
  const slots = createSeedSlots(count);

  await ds.transaction(async (manager) => {
    await lockTablesInOrder(manager);

    // Truncate BookingEntity and SlotEntity together in a single command to satisfy foreign keys
    await manager.query('TRUNCATE TABLE bookings, slots CASCADE');
    await manager.getRepository(IdempotencyEntity).clear();
    await manager.getRepository(AttemptEntity).clear();

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

/**
 * Removes the sslmode parameter from a database URL so TypeORM SSL configuration takes precedence.
 *
 * @param {string} rawUrl - The raw database connection string.
 * @returns {string} Cleaned URL without sslmode query parameter.
 */
function getCleanDatabaseUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete('sslmode');
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Retrieves or initializes the TypeORM DataSource singleton.
 * Validates the database URL at invocation time rather than module load time.
 *
 * @returns {DataSource} Configured TypeORM DataSource.
 * @throws {Error} If no POSTGRES_URL or DATABASE_URL is configured.
 */
export function getDataSource() {
  if (!appDataSource) {
    const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error(
        'No database URL configured. Set POSTGRES_URL or DATABASE_URL in your environment.'
      );
    }

    const shouldUseSsl =
      process.env.POSTGRES_SSL === 'true' ||
      /sslmode=(require|verify-ca|verify-full)/i.test(databaseUrl || '');

    // Safely remove sslmode query param so TypeORM's ssl options take precedence.
    // `verify-ca` and `verify-full` are secure defaults: if a connection is configured
    // for certificate validation and no override is provided, we reject invalid chains.
    // Self-signed connections remain possible only via an explicit opt-out.
    const cleanUrl = getCleanDatabaseUrl(databaseUrl);
    const hasExplicitSslOverride =
      process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== undefined;
    const hasVerifyMode = /sslmode=(verify-ca|verify-full)/i.test(databaseUrl || '');
    const rejectUnauthorized = hasExplicitSslOverride
      ? process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED === 'true'
      : Boolean(process.env.POSTGRES_CA) || hasVerifyMode;

    let sslConfig = false;
    if (shouldUseSsl) {
      sslConfig = {
        rejectUnauthorized,
      };

      if (process.env.POSTGRES_CA) {
        sslConfig.ca = process.env.POSTGRES_CA;
      }
    }

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

let indexCreationPromise = null;
let indexCreated = false;

/**
 * Ensures the partial unique index on confirmed bookings exists in the database.
 * Concurrent callers await the same in-flight creation, and failures propagate
 * without leaving a permanent failed flag.
 *
 * @param {DataSource} ds - Initialized TypeORM DataSource.
 * @returns {Promise<void>}
 */
async function ensurePartialIndex(ds) {
  if (indexCreated) return;
  if (!indexCreationPromise) {
    indexCreationPromise = (async () => {
      try {
        await ds.query(`
          WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                     PARTITION BY slot_id
                     ORDER BY created_at ASC, id ASC
                   ) AS row_num
            FROM bookings
            WHERE status = 'confirmed'
          )
          DELETE FROM bookings b
          USING ranked r
          WHERE b.id = r.id
            AND r.row_num > 1
        `);

        await ds.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_per_slot
          ON bookings (slot_id)
          WHERE status = 'confirmed'
        `);
        indexCreated = true;
      } finally {
        indexCreationPromise = null;
      }
    })();
  }
  await indexCreationPromise;
}

/**
 * Returns an initialized TypeORM DataSource instance with the partial unique index verified.
 *
 * @returns {Promise<DataSource>} The connected and initialized DataSource.
 */
export async function getDb() {
  const ds = getDataSource();

  if (!ds.isInitialized) {
    await ds.initialize();
  }

  // Ensure partial unique index exists and propagate any failure
  await ensurePartialIndex(ds);

  return ds;
}

/**
 * Normalizes an email string by trimming whitespace and converting to lowercase.
 *
 * @param {any} value - The input email value.
 * @returns {string} The normalized email.
 */
export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Normalizes a name string by trimming whitespace.
 *
 * @param {any} value - The input name value.
 * @returns {string} The normalized name.
 */
export function normalizeName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validates that a string matches a standard email format.
 *
 * @param {any} value - The input email to test.
 * @returns {boolean} True if the value is a valid email, false otherwise.
 */
export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
}

/**
 * Computes a SHA-256 hash of a JSON-serializable request body for idempotency comparison.
 *
 * @param {Object} body - Request body object.
 * @returns {string} Hexadecimal SHA-256 digest string.
 */
export function hashBody(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * Calculates the number of whole seconds remaining before the rate limit window clears.
 *
 * @param {Array<number>} times - Millisecond timestamps of attempts within the window.
 * @returns {number} Seconds to wait for Retry-After header (minimum 1).
 */
export function getRetryAfterSeconds(times) {
  if (!Array.isArray(times) || times.length === 0) {
    return 60;
  }

  const oldest = new Date(Math.min(...times)).getTime();
  const delay = 60000 - (Date.now() - oldest);
  return Math.max(1, Math.ceil(delay / 1000));
}
