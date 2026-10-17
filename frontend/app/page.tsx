'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { TipJar } from '@/components/TipJar';
import { WalletMenu } from '@/components/WalletMenu';
import { WalletConnectError, type WalletConnectErrorData } from '@/components/WalletConnectError';
import { categorizeWalletError } from '@/lib/walletErrors';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import {
  FlashIcon,
  BankIcon,
  GlobalIcon,
  UserCircleIcon,
  Analytics01Icon,
  CodeIcon,
} from '@hugeicons/core-free-icons';

interface Feature {
  icon: IconSvgElement;
  title: string;
  body: string;
  color: string;
}

const FEATURES: Feature[] = [
  {
    icon: FlashIcon,
    title: 'Instant Settlement',
    body: 'Built on Stellar. Tips settle in about five seconds with sub-cent fees — fast enough that even the smallest tip makes sense.',
    color: 'bg-brand-yellow',
  },
  {
    icon: BankIcon,
    title: 'Cash Out to Your Bank',
    body: 'Turn tips into local currency and withdraw straight to your bank through a Stellar anchor. No exchange, no detour.',
    color: 'bg-brand-lime',
  },
  {
    icon: GlobalIcon,
    title: 'Multi-Asset',
    body: 'Take tips in XLM or USDC. Supporters send what they hold, you keep track of every asset in one dashboard.',
    color: 'bg-brand-cyan',
  },
  {
    icon: UserCircleIcon,
    title: 'Creator Profiles',
    body: 'A public, shareable page with your donation history. Share one link and start receiving tips today.',
    color: 'bg-brand-pink',
  },
  {
    icon: Analytics01Icon,
    title: 'Live Dashboard',
    body: 'Track earnings, supporters, and messages in real time. Every tip lands on your dashboard the moment it settles.',
    color: 'bg-brand-orange',
  },
  {
    icon: CodeIcon,
    title: 'Zero Platform Fees',
    body: '100% of every tip goes to the creator. No cut, no hidden charges — just the network fee, which is a fraction of a cent.',
    color: 'bg-brand-lilac',
  },
];

interface Step {
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: 'Connect Your Wallet & Create Profile',
    body: 'Connect your Stellar wallet and sign a message to prove ownership, then choose a unique username for your public profile.',
  },
  {
    title: 'Set Your Payout Wallet',
    body: 'In settings, connect the wallet (Freighter, xBull, Albedo, Rabet, or Lobstr) you want to receive tips on. Self-custodial the whole way.',
  },
  {
    title: 'Share Your Link',
    body: 'Get your unique profile link (support-mee.vercel.app/yourname) and share it with your community, fans, or on social media.',
  },
  {
    title: 'Get Tipped, Then Cash Out',
    body: 'Supporters send XLM or USDC tips. Track them live on your dashboard, then withdraw to your bank whenever you want.',
  },
];

interface PlatformStats {
  totalCreators: number;
  totalSignups: number;
  totalVolumeXlm: number;
}

export default function Home() {
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<WalletConnectErrorData | null>(null);
  const [platformStats, setPlatformStats] = useState<PlatformStats>({
    totalCreators: 35,
    totalSignups: 35,
    totalVolumeXlm: 1429,
  });
  const { user, loginWithWallet } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const res = await fetch(`${apiUrl}/api/activity/overview`);
        if (res.ok) {
          const data = await res.json();
          const totalCreators = data.totalCreators || data.users?.length || 35;
          const totalSignups = data.totalSignups || 35;
          const totalVolumeXlm = data.earningsByCurrency?.XLM
            ? Math.round(data.earningsByCurrency.XLM)
            : 1429;
          setPlatformStats({ totalCreators, totalSignups, totalVolumeXlm });
        }
      } catch {
        /* best-effort: keep the fallback stats */
      }
    };
    fetchStats();
  }, []);

  const handleConnectWallet = async () => {
    setConnecting(true);
    setWalletError(null);
    try {
      const { hasProfile } = await loginWithWallet();
      router.push(hasProfile ? '/app' : '/auth/username');
    } catch (err) {
      setWalletError(categorizeWalletError(err));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav
        aria-label="Main Navigation"
        style={{ top: 'var(--offline-banner-h, 0px)' }}
        className="sticky w-full z-50 bg-background border-b-4 border-ink"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center gap-4">
          <div className="text-xl sm:text-2xl font-extrabold text-ink shrink-0 tracking-tight">
            SupportMe
          </div>
          <div className="hidden sm:flex items-center gap-6">
            <a href="#features" className="font-bold text-ink hover:text-primary transition">Features</a>
            <a href="#how-it-works" className="font-bold text-ink hover:text-primary transition">How it Works</a>
            <Link href="/discover" className="font-bold text-ink hover:text-primary transition">Discover</Link>
            <Link href="/leaderboard" className="font-bold text-ink hover:text-primary transition">Leaderboard</Link>
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
              <button
                onClick={handleConnectWallet}
                disabled={connecting}
                className="btn-brutal btn-brutal-primary text-sm sm:text-base"
              >
                {connecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
            )}
          </div>
        </div>
      </nav>

      <div className="w-full bg-ink text-background text-center py-2 px-4 text-xs sm:text-sm font-bold">
        Running on Stellar Testnet — no real funds are used. This is a demo.
      </div>

      <main id="main-content">
        {/* Hero Section */}
        <section className="pt-20 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-8 items-center">
          {/* Left: copy + CTAs */}
          <div className="text-center lg:text-left">
            <div className="mb-6 inline-block card-brutal bg-brand-yellow px-4 py-2 -rotate-1">
              <span className="font-extrabold uppercase tracking-wide text-ink text-sm">
                Tips in crypto · Cash out to your bank
              </span>
            </div>
            <h1 className="text-5xl sm:text-7xl font-extrabold text-ink mb-6 tracking-tight leading-[1.05]">
              Get Tipped.<br />Get Paid.
            </h1>
            <p className="text-xl sm:text-2xl text-ink/80 mb-8 leading-relaxed font-medium">
              A tipping platform built on Stellar. Supporters send XLM or USDC, you cash out to your bank. No middlemen, no platform fees.
            </p>
            {walletError && (
              <WalletConnectError error={walletError} onRetry={handleConnectWallet} className="mb-6" />
            )}
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              {user ? (
                <Link href="/app" className="btn-brutal btn-brutal-primary text-lg">
                  Open App
                </Link>
              ) : (
                <>
                  <button
                    onClick={handleConnectWallet}
                    disabled={connecting}
                    className="btn-brutal btn-brutal-primary text-lg"
                  >
                    {connecting ? 'Connecting...' : 'Become a Creator'}
                  </button>
                  <a href="#features" className="btn-brutal btn-brutal-white text-lg">
                    Learn More
                  </a>
                </>
              )}
            </div>
          </div>

          {/* Right: self-animating tip jar */}
          <div className="flex justify-center lg:justify-end">
            <TipJar />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 border-t-4 border-ink bg-card">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl sm:text-5xl font-extrabold text-center text-ink mb-16 tracking-tight">
            Why Choose SupportMe?
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="card-brutal bg-background p-6 flex flex-col gap-3">
                <div className={`card-brutal ${feature.color} w-14 h-14 flex items-center justify-center shrink-0`}>
                  <HugeiconsIcon icon={feature.icon} size={28} strokeWidth={2} className="text-ink" />
                </div>
                <h3 className="text-xl font-extrabold text-ink">{feature.title}</h3>
                <p className="text-ink/70 font-medium">{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 px-4 sm:px-6 lg:px-8 border-t-4 border-ink">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-4xl sm:text-5xl font-extrabold text-center text-ink mb-16 tracking-tight">
            How It Works
          </h2>
          <div className="space-y-6">
            {STEPS.map((step, i) => (
              <div key={step.title} className="card-brutal bg-background p-6 flex gap-5 items-start">
                <div className="flex-shrink-0 w-12 h-12 bg-primary text-white border-2 border-ink flex items-center justify-center font-extrabold text-lg">
                  {i + 1}
                </div>
                <div>
                  <h3 className="text-2xl font-extrabold text-ink mb-2">{step.title}</h3>
                  <p className="text-ink/70 font-medium">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t-4 border-ink bg-card">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-center text-ink mb-10 tracking-tight">
            Real Platform Traction
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center mb-12">
            <div className="card-brutal bg-brand-lime p-6">
              <div className="text-3xl sm:text-4xl font-extrabold text-ink mb-1">{platformStats.totalCreators}</div>
              <div className="text-ink font-bold text-sm">Active Creators</div>
            </div>
            <div className="card-brutal bg-brand-cyan p-6">
              <div className="text-3xl sm:text-4xl font-extrabold text-ink mb-1">{platformStats.totalSignups}</div>
              <div className="text-ink font-bold text-sm">Platform Users</div>
            </div>
            <div className="card-brutal bg-brand-yellow p-6">
              <div className="text-3xl sm:text-4xl font-extrabold text-ink mb-1">~{platformStats.totalVolumeXlm.toLocaleString()} XLM</div>
              <div className="text-ink font-bold text-sm">Total Tipped</div>
            </div>
            <div className="card-brutal bg-brand-orange p-6">
              <div className="text-3xl sm:text-4xl font-extrabold text-ink mb-1">100%</div>
              <div className="text-ink font-bold text-sm">Self-Custodial</div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6 text-center">
            <div className="card-brutal bg-background p-6">
              <div className="text-2xl font-extrabold text-ink mb-1">~5s</div>
              <div className="text-ink/80 text-sm font-bold">Stellar Settlement Time</div>
            </div>
            <div className="card-brutal bg-background p-6">
              <div className="text-2xl font-extrabold text-ink mb-1">&lt;$0.01</div>
              <div className="text-ink/80 text-sm font-bold">Network Tx Fee</div>
            </div>
            <div className="card-brutal bg-background p-6">
              <div className="text-2xl font-extrabold text-ink mb-1">0%</div>
              <div className="text-ink/80 text-sm font-bold">SupportMe Cut</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t-4 border-ink">
        <div className="max-w-2xl mx-auto text-center card-brutal bg-primary p-12">
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-6 text-white">
            Ready to Get Tipped?
          </h2>
          <p className="text-lg mb-8 text-white/90 font-medium">
            Set up your creator page in minutes. Take tips in crypto, cash out in your currency.
          </p>
          {user ? (
            <Link href="/app" className="btn-brutal btn-brutal-white text-lg inline-block">
              Open App
            </Link>
          ) : (
            <button
              onClick={handleConnectWallet}
              disabled={connecting}
              className="btn-brutal btn-brutal-white text-lg inline-block"
            >
              {connecting ? 'Connecting...' : 'Get Started Now'}
            </button>
          )}
        </div>
      </section>
      </main>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 bg-ink text-background border-t-4 border-ink">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="text-2xl font-extrabold text-background mb-4">SupportMe</div>
              <p className="text-sm text-background/70 font-medium">Tips in crypto, cash out to your bank. Built on Stellar.</p>
            </div>
            <div>
              <h4 className="text-background font-extrabold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-background/70 font-medium">
                <li><a href="#features" className="hover:text-brand-yellow transition">Features</a></li>
                <li><a href="#how-it-works" className="hover:text-brand-yellow transition">How it Works</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-background font-extrabold mb-4">Community</h4>
              <ul className="space-y-2 text-sm text-background/70 font-medium">
                <li>
                  <a
                    href="https://github.com/sammajayi/support-me"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-brand-yellow transition"
                  >
                    GitHub
                  </a>
                </li>
                <li className="text-background/70 cursor-default">Documentation (soon)</li>
                <li className="text-background/70 cursor-default">Discord (soon)</li>
              </ul>
            </div>
            <div>
              <h4 className="text-background font-extrabold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-background/70 font-medium">
                <li className="text-background/70 cursor-default">Privacy (soon)</li>
                <li className="text-background/70 cursor-default">Terms (soon)</li>
                <li className="text-background/70 cursor-default">Contact (soon)</li>
              </ul>
            </div>
          </div>
          <div className="border-t-2 border-background/20 pt-8 text-center text-sm text-background/70 font-medium">
            <p>&copy; 2026 SupportMe. Built on Stellar. Open source and community-driven.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
