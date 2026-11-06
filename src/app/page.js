'use client';

import { useEffect, useMemo, useState } from 'react';

const API_KEY = process.env.NEXT_PUBLIC_CLINIC_API_KEY || 'demo-key-123';

function makeSlots() {
  const start = new Date();
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
    const initialize = async () => {
      await seedData();
    };
    initialize();
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleBook = async (event) => {
    event.preventDefault();
    setError('');
    setResult(null);

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
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-800">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-brand-600 to-sky-500 p-6 text-white shadow-soft md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-100">Clinic booking</p>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">Book a care visit</h1>
          </div>
          <button
            type="button"
            onClick={seedData}
            className="rounded-full border border-white/30 bg-white/10 px-4 py-2 font-medium text-white transition hover:bg-white/20"
          >
            Reset slots
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
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
                    className={`rounded-2xl border p-4 text-left transition ${
                      slot.available
                        ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-400 hover:bg-emerald-100'
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

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
            <h2 className="text-xl font-semibold text-slate-900">New booking</h2>
            <form onSubmit={handleBook} className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Slot ID
                <input
                  name="slot_id"
                  value={form.slot_id}
                  onChange={handleChange}
                  placeholder="s11"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none ring-0 transition focus:border-brand-500 focus:bg-white"
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
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-brand-500 focus:bg-white"
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
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-brand-500 focus:bg-white"
                  required
                />
              </label>

              <button
                type="submit"
                className="w-full rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white transition hover:bg-brand-500"
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

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
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
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-brand-500 focus:bg-white"
              />
              <button
                type="button"
                onClick={handleLookup}
                className="rounded-xl bg-slate-900 px-4 py-2.5 font-medium text-white transition hover:bg-slate-700"
              >
                Search
              </button>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {myBookings.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-slate-500">
                No bookings yet.
              </p>
            ) : (
              myBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between"
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
                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
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
              className="mt-5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Next page
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
