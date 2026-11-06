import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_PATH = path.join(DATA_DIR, 'clinic.json');

const EMPTY_STORE = {
  slots: [],
  bookings: [],
  idempotency: [],
  attempts: {},
};

let writeQueue = Promise.resolve();

export async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DATA_PATH);
  } catch {
    await fs.writeFile(DATA_PATH, JSON.stringify(EMPTY_STORE, null, 2));
  }
}

export async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  const parsed = JSON.parse(raw || '{}');

  return {
    ...EMPTY_STORE,
    ...parsed,
    slots: Array.isArray(parsed.slots) ? parsed.slots : [],
    bookings: Array.isArray(parsed.bookings) ? parsed.bookings : [],
    idempotency: Array.isArray(parsed.idempotency) ? parsed.idempotency : [],
    attempts: parsed.attempts && typeof parsed.attempts === 'object' ? parsed.attempts : {},
  };
}

export async function writeStore(nextState) {
  await ensureStore();
  const tmpPath = `${DATA_PATH}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(nextState, null, 2));
  await fs.rename(tmpPath, DATA_PATH);
}

export async function withWriteLock(task) {
  const previous = writeQueue;
  let release;
  writeQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    return await task();
  } finally {
    release();
  }
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

export function buildError(message, status = 400) {
  return {
    status,
    body: { error: message },
  };
}

export function getRetryAfterSeconds(attemptTimes) {
  if (!Array.isArray(attemptTimes) || attemptTimes.length === 0) {
    return 60;
  }

  const oldest = new Date(Math.min(...attemptTimes)).getTime();
  const diff = 60000 - (Date.now() - oldest);
  return Math.max(1, Math.ceil(diff / 1000));
}
