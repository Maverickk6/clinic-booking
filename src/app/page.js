'use client';

import { useEffect, useMemo, useState } from 'react';

const API_KEY = process.env.NEXT_PUBLIC_CLINIC_API_KEY || 'demo-key-123';

function makeSlots() {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);

  const slots = [];
  const providers = ['Dr Ade', 'Dr Moyo', 'Dr Smith'];

  for (let day = 0; day < 5; day += 1) {
    providers.forEach((provider, index) => {
      const slotStart = new Date(start.getTime() + day * 86400000 + index * 3600000);
      const slotEnd = new Date(slotStart.getTime() + 30 * 60000);
      slots.push({
        id: `s${day + 1}${index + 1}`,
        provider,
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
      });
    });
  }

  return slots;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
    ...(options.headers || {}),
  };

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

export default function Home() {
  const [slots, setSlots] = useState([]);
  const [form, setForm] = useState({ slot_id: '', name: '', email: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [myBookings, setMyBookings] = useState([]);
  const [emailFilter, setEmailFilter] = useState('');
  const [cursor, setCursor] = useState(null);

  const bookingSummary = useMemo(() => {
    if (!slots.length) return 'Loading slots...';
    const available = slots.filter((slot) => slot.available).length;
    return `${available} of ${slots.length} slots open`;
  }, [slots]);

  const selectedSlot = slots.find((slot) => slot.id === form.slot_id) || null;

  const loadSlots = async () => {
    try {
      const data = await apiFetch('/slots');
      setSlots(data.slots || []);
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  const seedData = async () => {
    try {
      await apiFetch('/reset', {
        method: 'POST',
        body: JSON.stringify({ slots: makeSlots() }),
      });
      await loadSlots();
    } catch (seedError) {
      setError(seedError.message);
    }
  };

  useEffect(() => {
    // Run once on mount — load slots from DB, seed only if DB is empty
    const initialize = async () => {
      try {
        const data = await apiFetch('/slots');
        const existing = data.slots || [];
        if (existing.length === 0) {
          // DB is empty on first deploy — seed with fresh slots
          await apiFetch('/reset', {
            method: 'POST',
            body: JSON.stringify({ slots: makeSlots() }),
          });
          const seeded = await apiFetch('/slots');
          setSlots(seeded.slots || []);
        } else {
          setSlots(existing);
        }
      } catch (initError) {
        setError(initError.message);
      }
    };
    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleBook = async (event) => {
    event.preventDefault();
    setError('');
    setResult(null);

    if (!selectedSlot) {
      setError('Please select an available appointment slot first.');
      return;
    }

    try {
      const booking = await apiFetch('/bookings', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setResult(booking);
      setForm({ slot_id: '', name: '', email: '' });
      await loadSlots();
    } catch (bookingError) {
      setError(bookingError.message);
    }
  };

  const handleLookup = async () => {
    if (!emailFilter.trim()) return;
    try {
      setError('');
      const response = await apiFetch(`/bookings?email=${encodeURIComponent(emailFilter.trim())}&limit=10`);
      setMyBookings(response.bookings || []);
      setCursor(response.next_cursor);
    } catch (lookupError) {
      setError(lookupError.message);
    }
  };

  const handleLoadNextPage = async () => {
    if (!cursor) return;
    try {
      const response = await apiFetch(
        `/bookings?email=${encodeURIComponent(emailFilter.trim())}&limit=10&cursor=${encodeURIComponent(cursor)}`
      );
      setMyBookings(response.bookings || []);
      setCursor(response.next_cursor);
    } catch (lookupError) {
      setError(lookupError.message);
    }
  };

  const cancelBooking = async (id) => {
    try {
      const booking = await apiFetch(`/bookings/${id}`, { method: 'DELETE' });
      setResult(booking);
      await loadSlots();
      await handleLookup();
    } catch (cancelError) {
      setError(cancelError.message);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#e0f2fe_0%,#ecfeff_18%,#f8fafc_48%,#f1f5f9_100%)] px-4 py-10 text-slate-800">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 overflow-hidden rounded-[32px] border border-slate-800/40 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 text-white shadow-[0_30px_80px_-35px_rgba(14,116,144,0.8)]">
          <div className="grid gap-6 p-6 md:p-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.8)]" />
                Premium care
              </div>

              <div>
                <p className="text-sm font-medium uppercase tracking-[0.22em] text-cyan-200/80">Clinic booking</p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-5xl">Book a care visit with confidence.</h1>
              </div>

              <p className="max-w-xl text-sm text-slate-300 md:text-base">
                Faster scheduling, clearer patient records, and a more polished experience for every appointment.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={seedData}
                  className="rounded-full bg-cyan-400 px-5 py-2.5 font-semibold text-slate-950 shadow-lg shadow-cyan-500/30 transition hover:-translate-y-0.5 hover:bg-cyan-300"
                >
                  Reset slots
                </button>
              </div>
            </div>

            <div className="relative flex items-center justify-center">
              <div className="absolute inset-6 rounded-full bg-cyan-500/20 blur-3xl" />
              <div className="relative w-full max-w-md rounded-[30px] border border-white/10 bg-white/5 p-4 shadow-[0_25px_70px_-30px_rgba(34,211,238,0.6)] backdrop-blur-sm">
                <svg viewBox="0 0 420 300" className="h-auto w-full" aria-label="Medical appointment illustration" role="img">
                  <defs>
                    <linearGradient id="panelGlow" x1="0%" x2="100%" y1="0%" y2="100%">
                      <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.9" />
                      <stop offset="50%" stopColor="#a5f3fc" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="#e0f2fe" stopOpacity="0.7" />
                    </linearGradient>
                  </defs>
                  <rect x="26" y="24" width="368" height="248" rx="28" fill="rgba(15,23,42,0.55)" stroke="rgba(255,255,255,0.08)" />
                  <circle cx="102" cy="96" r="42" fill="url(#panelGlow)" opacity="0.8" />
                  <circle cx="298" cy="74" r="26" fill="rgba(56,189,248,0.28)" />
                  <path d="M120 208c18-28 52-44 90-44s72 16 90 44" fill="none" stroke="rgba(103,232,249,0.8)" strokeWidth="10" strokeLinecap="round" />
                  <rect x="170" y="104" width="82" height="82" rx="24" fill="#f8fafc" opacity="0.96" />
                  <path d="M206 126v35m-18-18h36" stroke="#0f172a" strokeWidth="8" strokeLinecap="round" />
                  <path d="M82 190h78" stroke="rgba(255,255,255,0.6)" strokeWidth="10" strokeLinecap="round" />
                  <path d="M258 190h78" stroke="rgba(255,255,255,0.6)" strokeWidth="10" strokeLinecap="round" />
                  <rect x="62" y="126" width="102" height="58" rx="18" fill="rgba(14,165,233,0.12)" stroke="rgba(103,232,249,0.38)" />
                  <rect x="260" y="126" width="96" height="62" rx="18" fill="rgba(20,184,166,0.12)" stroke="rgba(45,212,191,0.35)" />
                  <path d="M90 152h44M90 165h56" stroke="rgba(255,255,255,0.8)" strokeWidth="6" strokeLinecap="round" />
                  <path d="M286 152h42M286 165h52" stroke="rgba(255,255,255,0.8)" strokeWidth="6" strokeLinecap="round" />
                </svg>
              </div>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[28px] border border-cyan-100 bg-white/90 p-6 shadow-[0_18px_45px_-22px_rgba(14,116,144,0.35)] backdrop-blur-sm transition duration-200 hover:-translate-y-1 hover:shadow-[0_25px_60px_-28px_rgba(14,116,144,0.45)]">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Available appointments</h2>
                <p className="mt-1 text-sm text-slate-500">{bookingSummary}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {slots.length === 0 ? (
                <p className="text-slate-500">No slots available.</p>
              ) : (
                slots.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, slot_id: slot.id }))}
                    disabled={!slot.available}
                    className={`group rounded-2xl border p-4 text-left transition duration-200 ${
                      slot.available
                        ? 'border-emerald-200 bg-emerald-50 hover:-translate-y-1 hover:border-emerald-400 hover:bg-emerald-100 hover:shadow-[0_16px_30px_-22px_rgba(16,185,129,0.7)]'
                        : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-700">{slot.provider}</span>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          slot.available ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-slate-600'
                        }`}
                      >
                        {slot.available ? 'Open' : 'Booked'}
                      </span>
                    </div>

                    <div className="mt-3 space-y-1 text-sm">
                      <p>{formatDate(slot.start)}</p>
                      <p className="text-slate-500">to {formatDate(slot.end)}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-cyan-100 bg-white/90 p-6 shadow-[0_18px_45px_-22px_rgba(14,116,144,0.35)] backdrop-blur-sm transition duration-200 hover:-translate-y-1 hover:shadow-[0_25px_60px_-28px_rgba(14,116,144,0.45)]">
            <h2 className="text-xl font-semibold text-slate-900">New booking</h2>
            <form onSubmit={handleBook} className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Selected slot
                <input
                  name="slot_id"
                  value={selectedSlot ? `${selectedSlot.provider} · ${formatDate(selectedSlot.start)}` : ''}
                  readOnly
                  placeholder="Choose an available appointment above"
                  className="mt-1 w-full rounded-xl border border-cyan-100 bg-cyan-50/60 px-3 py-2.5 text-slate-800 outline-none transition focus:border-cyan-500 focus:bg-white"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Full name
                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  placeholder="Ada Obi"
                  className="mt-1 w-full rounded-xl border border-cyan-100 bg-cyan-50/60 px-3 py-2.5 text-slate-800 outline-none transition focus:border-cyan-500 focus:bg-white"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Email
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="ada@example.com"
                  className="mt-1 w-full rounded-xl border border-cyan-100 bg-cyan-50/60 px-3 py-2.5 text-slate-800 outline-none transition focus:border-cyan-500 focus:bg-white"
                  required
                />
              </label>

              <button
                type="submit"
                disabled={!selectedSlot}
                className="w-full rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-4 py-3 font-semibold text-white shadow-lg shadow-cyan-300/40 transition duration-200 hover:-translate-y-0.5 hover:from-cyan-500 hover:to-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Book appointment
              </button>
            </form>
          </section>
        </div>

        <div className="mt-6 space-y-4">
          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <p className="font-semibold">Booking confirmed</p>
              <p className="mt-1">ID: {result.id}</p>
              <p>Slot: {result.slot_id}</p>
            </div>
          )}
        </div>

        <section className="mt-8 rounded-[28px] border border-cyan-100 bg-white/90 p-6 shadow-[0_18px_45px_-22px_rgba(14,116,144,0.35)] backdrop-blur-sm transition duration-200 hover:-translate-y-1 hover:shadow-[0_25px_60px_-28px_rgba(14,116,144,0.45)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Your bookings</h2>
              <p className="mt-1 text-sm text-slate-500">Look up your patient history</p>
            </div>

            <div className="flex w-full max-w-md gap-3">
              <input
                value={emailFilter}
                onChange={(event) => setEmailFilter(event.target.value)}
                placeholder="Search by email"
                className="w-full rounded-xl border border-cyan-100 bg-cyan-50/60 px-3 py-2.5 text-slate-800 outline-none transition focus:border-cyan-500 focus:bg-white"
              />
              <button
                type="button"
                onClick={handleLookup}
                className="rounded-xl bg-slate-800 px-4 py-2.5 font-medium text-white transition duration-200 hover:-translate-y-0.5 hover:bg-slate-700"
              >
                Search
              </button>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {myBookings.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-cyan-100 bg-cyan-50/40 px-4 py-8 text-center text-slate-500">
                No bookings yet.
              </p>
            ) : (
              myBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="flex flex-col gap-3 rounded-2xl border border-cyan-100 bg-cyan-50/40 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-cyan-50 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-semibold text-slate-900">{booking.name}</p>
                    <p className="text-sm text-slate-600">{booking.email}</p>
                    <p className="mt-1 text-sm text-slate-500">Slot: {booking.slot_id}</p>
                    <p className="text-xs uppercase tracking-wide text-slate-400">{booking.status}</p>
                  </div>
                  {booking.status !== 'cancelled' && (
                    <button
                      type="button"
                      onClick={() => cancelBooking(booking.id)}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition duration-200 hover:-translate-y-0.5 hover:bg-rose-100"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {cursor && (
            <button
              type="button"
              onClick={handleLoadNextPage}
              className="mt-5 rounded-xl border border-cyan-100 bg-white px-4 py-2.5 font-medium text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-cyan-50"
            >
              Next page
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
