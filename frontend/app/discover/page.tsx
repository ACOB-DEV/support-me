'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { HugeiconsIcon } from '@hugeicons/react';
import { Search01Icon, FireIcon, Clock01Icon, FileEmptyIcon } from '@hugeicons/core-free-icons';
import { Skeleton } from '@/components/Skeleton';
import { WalletMenu } from '@/components/WalletMenu';
import { TestnetBadge } from '@/components/TestnetBadge';
import { useAuth } from '@/context/AuthContext';
import { API_URL } from '@/lib/api';

type Sort = 'newest' | 'most-supported';

interface Creator {
  id: number;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  _count: { donations: number };
}

interface CreatorsResponse {
  items: Creator[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// The API is expected to return { items, pagination }, but an error payload,
// an empty body, or a backend shape change could hand us anything. Validate
// before touching `.length` or nested fields so a bad response degrades to
// the empty/error state instead of crashing the whole page.
function isCreatorsResponse(data: unknown): data is CreatorsResponse {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as Partial<CreatorsResponse>;
  return (
    Array.isArray(candidate.items) &&
    typeof candidate.pagination === 'object' &&
    candidate.pagination !== null &&
    typeof candidate.pagination.totalPages === 'number'
  );
}

const SORTS: { value: Sort; label: string; icon: typeof Search01Icon }[] = [
  { value: 'newest', label: 'Newest', icon: Clock01Icon },
  { value: 'most-supported', label: 'Most Supported', icon: FireIcon },
];

export default function DiscoverPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [creators, setCreators] = useState<Creator[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [loadMoreError, setLoadMoreError] = useState('');

  // Debounce the search box so we don't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Fresh search: query or sort changed, so start over from page 1.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setLoadMoreError('');

    const params = new URLSearchParams({ sort, page: '1', limit: '20' });
    if (debouncedQuery) params.set('q', debouncedQuery);

    fetch(`${API_URL}/api/creators?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load creators');
        return res.json().catch(() => null) as Promise<unknown>;
      })
      .then((data) => {
        if (cancelled) return;
        if (!isCreatorsResponse(data)) {
          setCreators([]);
          setPage(1);
          setTotalPages(1);
          setError('Something went wrong loading creators. Please try again.');
          return;
        }
        setCreators(data.items);
        setPage(1);
        setTotalPages(data.pagination.totalPages);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, sort]);

  // Failures leave `page` and `creators` untouched, so retrying re-requests the
  // same page and already-loaded results stay on screen.
  const loadMore = async () => {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const nextPage = page + 1;
      const params = new URLSearchParams({ sort, page: String(nextPage), limit: '20' });
      if (debouncedQuery) params.set('q', debouncedQuery);
      const res = await fetch(`${API_URL}/api/creators?${params}`);
      if (!res.ok) throw new Error('Failed to load more creators');
      const data: unknown = await res.json().catch(() => null);
      if (!isCreatorsResponse(data)) throw new Error('Unexpected response');
      setCreators((prev) => [...prev, ...data.items]);
      setPage(nextPage);
    } catch {
      setLoadMoreError("Couldn't load more creators. Check your connection and try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Public-facing navigation consistent with marketing site */}
      <nav
        style={{ top: 'var(--offline-banner-h, 0px)' }}
        className="sticky w-full z-50 bg-background border-b-4 border-ink"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Link href="/" className="text-xl sm:text-2xl font-extrabold text-ink shrink-0 tracking-tight">
              SupportMe
            </Link>
            <TestnetBadge />
          </div>
          <div className="hidden sm:flex items-center gap-6">
            <Link href="/#features" className="font-bold text-ink hover:text-primary transition">Features</Link>
            <Link href="/#how-it-works" className="font-bold text-ink hover:text-primary transition">How it Works</Link>
            <Link href="/discover" className="font-bold text-primary underline underline-offset-4">Discover</Link>
            {user && (
              <Link href="/app" className="font-bold text-ink hover:text-primary transition">
                App
              </Link>
            )}
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {user ? (
              <WalletMenu />
            ) : (
              <Link href="/" className="btn-brutal btn-brutal-primary text-sm">
                Connect Wallet
              </Link>
            )}
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-4xl font-extrabold text-ink tracking-tight mb-2">Discover Creators</h1>
        <p className="text-muted font-medium mb-8">Find creators to support on SupportMe.</p>

        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="relative flex-1">
            <HugeiconsIcon
              icon={Search01Icon}
              size={20}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40 pointer-events-none"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or username…"
              aria-label="Search creators"
              className="w-full card-brutal pl-10 pr-4 py-2.5 font-medium text-ink placeholder:text-ink/40 focus:outline-none"
            />
          </div>
          <div className="flex gap-2 shrink-0">
            {SORTS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSort(s.value)}
                aria-pressed={sort === s.value}
                className={`btn-brutal flex items-center gap-2 px-4 py-2.5 text-sm ${
                  sort === s.value ? 'btn-brutal-primary' : 'btn-brutal-white'
                }`}
              >
                <HugeiconsIcon icon={s.icon} size={16} strokeWidth={2} />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="card-brutal bg-brand-pink p-4 mb-6 text-ink font-bold">{error}</div>
        )}

        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="card-brutal p-5">
                <Skeleton className="h-16 w-16 rounded-full mb-4" />
                <Skeleton className="h-5 w-32 mb-2" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : creators.length === 0 ? (
          <div className="card-brutal bg-card p-12 text-center">
            <HugeiconsIcon icon={FileEmptyIcon} size={40} strokeWidth={1.5} className="mx-auto mb-4 text-ink/30" />
            <p className="text-lg font-extrabold text-ink mb-1">
              {debouncedQuery ? `No creators found for "${debouncedQuery}"` : 'No creators yet'}
            </p>
            <p className="text-muted font-medium">
              {debouncedQuery ? 'Try a different name or username.' : 'Check back soon!'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {creators.map((creator) => {
                const name = creator.displayName || creator.username;
                return (
                  <Link
                    key={creator.id}
                    href={`/${creator.username}`}
                    className="card-brutal bg-card p-5 flex flex-col hover:-translate-y-0.5 transition-transform"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      {creator.avatarUrl ? (
                        <Image
                          src={creator.avatarUrl}
                          alt={name}
                          width={56}
                          height={56}
                          className="w-14 h-14 rounded-full object-cover border-2 border-ink shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-primary text-white border-2 border-ink flex items-center justify-center font-extrabold text-xl shrink-0">
                          {name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-extrabold text-ink truncate">{name}</p>
                        <p className="text-sm text-muted truncate">@{creator.username}</p>
                      </div>
                    </div>
                    {creator.bio && (
                      <p className="text-sm text-ink/70 font-medium line-clamp-2 mb-3">{creator.bio}</p>
                    )}
                    <p className="text-xs font-bold text-muted mt-auto uppercase tracking-wide">
                      {creator._count.donations} {creator._count.donations === 1 ? 'tip' : 'tips'} received
                    </p>
                  </Link>
                );
              })}
            </div>

            {page < totalPages && (
              <div className="text-center mt-8">
                {loadMoreError && (
                  <p role="alert" className="mb-3 font-bold text-ink">
                    {loadMoreError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="btn-brutal btn-brutal-white"
                >
                  {loadingMore ? 'Loading…' : loadMoreError ? 'Retry' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
