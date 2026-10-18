'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppNav } from '@/components/AppNav';
import { ActivitySkeleton } from '@/components/ActivitySkeleton';
import { API_URL } from '@/lib/api';

type EarningsByCurrency = Record<string, number>;

interface OverviewData {
  totalSignups: number;
  totalCreators: number;
  earningsByCurrency: EarningsByCurrency;
}

export default function ActivityPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [earningsCurrency, setEarningsCurrency] = useState<string | null>(null);

  const currencies = data
    ? Object.keys(data.earningsByCurrency).sort((a, b) => {
        const order = ['XLM', 'USDC'];
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      })
    : [];

  useEffect(() => {
    if (currencies.length > 0 && (!earningsCurrency || !currencies.includes(earningsCurrency))) {
      setEarningsCurrency(currencies[0]);
    }
  }, [currencies, earningsCurrency]);

  useEffect(() => {
    const fetchOverview = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/activity/overview`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to load activity overview');
        }
        setData(await res.json());
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    fetchOverview();
  }, []);

  if (loading) {
    return <ActivitySkeleton />;
  }

  // Nothing has happened on the platform yet — no signups, no creators, no
  // earnings. Zeroed stat cards and an empty table read as broken here, so
  // show an encouraging empty state with a CTA to become the first creator.
  const isEmpty = !!data && data.totalSignups === 0 && data.totalCreators === 0;

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-4xl font-extrabold text-ink tracking-tight mb-3">Community Activity</h1>
        <p className="text-muted font-medium max-w-2xl mb-8">
          Platform-wide totals for everyone curious how SupportMe is growing — supporters, creators
          and anyone evaluating the platform. These numbers are aggregated across all accounts:
          individual names, wallet addresses and earnings are never listed here.
        </p>

        {error && (
          <div className="card-brutal bg-brand-pink p-4 mb-6 text-ink font-bold">{error}</div>
        )}

        {isEmpty ? (
          <div className="card-brutal bg-card p-10 text-center">
            <h2 className="text-2xl font-extrabold text-ink mb-2">No activity yet</h2>
            <p className="text-muted font-medium mb-6 max-w-md mx-auto">
              Once creators join and start receiving tips, sign-ups and earnings will show up
              here. Create your own page and share it to become the community&apos;s first
              supporter story.
            </p>
            <Link href="/auth/username" className="btn-brutal btn-brutal-primary">
              Create your page
            </Link>
          </div>
        ) : (
          <>
            {/* Headline stats */}
            <div className="grid md:grid-cols-3 gap-6 mb-8">
              <div className="card-brutal bg-brand-cyan p-6">
                <p className="text-ink text-sm font-bold uppercase tracking-wide">Sign-ups</p>
                <p className="text-ink/70 text-xs font-medium mt-1">Accounts created on SupportMe</p>
                <p className="text-4xl font-extrabold text-ink mt-2 tabular-nums">
                  {data?.totalSignups ?? 0}
                </p>
              </div>
              <div className="card-brutal bg-brand-lime p-6">
                <p className="text-ink text-sm font-bold uppercase tracking-wide">Creators</p>
                <p className="text-ink/70 text-xs font-medium mt-1">Accounts with a creator page</p>
                <p className="text-4xl font-extrabold text-ink mt-2 tabular-nums">
                  {data?.totalCreators ?? 0}
                </p>
              </div>
              <div className="card-brutal bg-card p-6">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-ink text-sm font-bold uppercase tracking-wide">Total Creator earnings</p>
                  {currencies.length > 1 && (
                    <div className="flex border-2 border-ink rounded-lg overflow-hidden shrink-0">
                      {currencies.map((currency) => (
                        <button
                          key={currency}
                          type="button"
                          onClick={() => setEarningsCurrency(currency)}
                          className={`px-2.5 py-1 text-xs font-bold transition-colors ${
                            earningsCurrency === currency
                              ? 'bg-ink text-white'
                              : 'bg-transparent text-ink hover:bg-accent-bg'
                          }`}
                        >
                          {currency}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-ink/70 text-xs font-medium mt-1">
                  Verified donations received by all creators combined, per currency
                </p>
                {currencies.length > 0 && earningsCurrency ? (
                  <p className="text-4xl font-extrabold text-ink mt-2 tabular-nums">
                    {(data?.earningsByCurrency[earningsCurrency] ?? 0).toFixed(2)}{' '}
                    <span className="text-xl">{earningsCurrency}</span>
                  </p>
                ) : (
                  <p className="text-4xl font-extrabold text-ink/40 mt-2 tabular-nums">—</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
