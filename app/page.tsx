import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  MessageCircle,
  Calendar as CalendarIcon,
  Receipt,
  FileText,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center">
            <Image
              src="/Horiztonal%20log.png"
              alt="MyVow Parenting"
              width={140}
              height={40}
              className="h-auto w-[140px] object-contain object-left"
            />
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              href="/pricing"
              className="text-sm text-foreground-secondary hover:text-foreground"
            >
              Pricing
            </Link>
            <Link
              href="/login"
              className="text-sm text-foreground-secondary hover:text-foreground"
            >
              Log in
            </Link>
            <Button asChild>
              <Link href="/signup">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Hero />
        <VowSection />
        <FeatureStrip />
      </main>

      <footer className="border-t border-border py-6 mt-8">
        <div className="container mx-auto px-4 text-center text-sm text-foreground-secondary">
          MyVow Parenting — Communication you can trust.
        </div>
      </footer>
    </div>
  );
}

function Hero() {
  return (
    <section className="border-b border-border/60 bg-gradient-to-b from-background to-background-secondary/40">
      <div className="container mx-auto px-4 py-10 md:py-14 lg:py-16">
        <div className="grid gap-10 lg:gap-12 md:grid-cols-2 items-center">
          {/* Left: Copy */}
          <div className="space-y-6">
            <h1 className="font-heading text-3xl md:text-4xl lg:text-5xl font-semibold text-foreground">
              Your children deserve better than the patterns we inherited.
            </h1>
            <div className="space-y-3">
              <p className="text-base md:text-lg text-foreground">
                Raising children is hard. MyVow helps parents do it with
                intention.
              </p>
              <p className="text-sm md:text-base text-foreground-secondary max-w-xl">
                Tools for communication, coordination, and accountability —
                designed to keep adult conflict from harming children.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" aria-label="Start free with MyVow Parenting">
                <Link href="/signup">Start free</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                aria-label="See MyVow Parenting pricing"
              >
                <Link href="/pricing">See pricing</Link>
              </Button>
            </div>
            <p className="text-[11px] md:text-xs text-foreground-secondary">
              Parenting lasts a lifetime — even when relationships don&apos;t.
            </p>
          </div>

          {/* Right: Product preview with dove watermark */}
          <div className="relative mt-6 md:mt-0 flex justify-end">
            <div className="pointer-events-none absolute -right-10 bottom-0 hidden md:block">
              <Image
                src="/dove-translucent.png"
                alt=""
                width={400}
                height={400}
                aria-hidden
                className="w-[320px] lg:w-[380px] opacity-20 mix-blend-multiply select-none"
              />
            </div>
            <div className="relative z-10">
              <ProductPreviewPanel />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProductPreviewPanel() {
  return (
    <div className="mx-auto max-w-md w-full rounded-2xl border border-border bg-card shadow-lg shadow-black/5 p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-secondary">
          Inside MyVow
        </p>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-foreground-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span>Calm, structured tools</span>
        </span>
      </div>
      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-background px-3 py-2.5 flex items-start gap-2">
          <div className="mt-0.5 rounded-full bg-emerald-50 p-1.5 text-emerald-700">
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">
              AI-guided messages
            </p>
            <p className="text-[11px] text-foreground-secondary">
              Draft replies that stay child-focused when communication is hard.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background px-3 py-2.5 flex items-start gap-2">
          <div className="mt-0.5 rounded-full bg-sky-50 p-1.5 text-sky-700">
            <CalendarIcon className="h-3.5 w-3.5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">
              Shared calendar
            </p>
            <p className="text-[11px] text-foreground-secondary">
              See pickups, appointments, and school events in one calm view.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background px-3 py-2.5 flex items-start gap-2">
          <div className="mt-0.5 rounded-full bg-amber-50 p-1.5 text-amber-700">
            <Receipt className="h-3.5 w-3.5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">
              Expenses
            </p>
            <p className="text-[11px] text-foreground-secondary">
              Track shared costs with clear splits and gentle follow-up.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background px-3 py-2.5 flex items-start gap-2">
          <div className="mt-0.5 rounded-full bg-slate-50 p-1.5 text-slate-700">
            <FileText className="h-3.5 w-3.5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">
              Documents
            </p>
            <p className="text-[11px] text-foreground-secondary">
              Keep important files, notes, and agreements in one organized place.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function VowSection() {
  return (
    <section className="border-b border-border/60 bg-background">
      <div className="container mx-auto px-4 py-10 md:py-12">
        <div className="max-w-3xl space-y-6">
          <h2 className="font-heading text-xl md:text-2xl font-semibold text-foreground">
            The MyVow
          </h2>
          <p className="text-sm md:text-base text-foreground-secondary max-w-xl">
            Every parent using MyVow begins with a simple commitment:
          </p>
          <div className="rounded-2xl border border-border bg-muted/60 px-4 py-4 md:px-5 md:py-5">
            <p className="text-sm md:text-base font-medium italic text-foreground">
              “I vow not to let adult conflict harm my children.”
            </p>
          </div>
          <p className="text-sm md:text-base text-foreground-secondary max-w-xl">
            MyVow helps parents keep that promise through calm structure, clear
            coordination, and guidance when communication gets hard.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-background-secondary/40 px-3 py-3">
              <p className="text-sm font-medium text-foreground">
                Calm, structured communication
              </p>
              <p className="mt-1 text-[11px] md:text-xs text-foreground-secondary">
                Keep conversations focused on children instead of old arguments.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background-secondary/40 px-3 py-3">
              <p className="text-sm font-medium text-foreground">
                Shared parenting coordination tools
              </p>
              <p className="mt-1 text-[11px] md:text-xs text-foreground-secondary">
                See schedules, costs, and key information in one calm place.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background-secondary/40 px-3 py-3">
              <p className="text-sm font-medium text-foreground">
                AI guidance when conversations become difficult
              </p>
              <p className="mt-1 text-[11px] md:text-xs text-foreground-secondary">
                Get gentle suggestions when you need help finding the right
                words.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background-secondary/40 px-3 py-3">
              <p className="text-sm font-medium text-foreground">
                Clear documentation when accountability matters
              </p>
              <p className="mt-1 text-[11px] md:text-xs text-foreground-secondary">
                Keep a calm record of what was shared, decided, and paid.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureStrip() {
  return (
    <section className="bg-background-secondary/40">
      <div className="container mx-auto px-4 py-10 md:py-12">
        <h2 className="font-heading text-lg md:text-xl font-semibold text-foreground mb-4">
          How MyVow helps
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-background px-4 py-4">
            <p className="text-sm font-medium text-foreground">
              AI-guided messaging
            </p>
            <p className="mt-1 text-[11px] md:text-xs text-foreground-secondary">
              Keep conversations child-focused and calm, even when emotions run
              high.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-4">
            <p className="text-sm font-medium text-foreground">
              All-in-one coordination
            </p>
            <p className="mt-1 text-[11px] md:text-xs text-foreground-secondary">
              Calendar, expenses, and documents in one place, for married and
              co-parenting families.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-4">
            <p className="text-sm font-medium text-foreground">
              Clear records
            </p>
            <p className="mt-1 text-[11px] md:text-xs text-foreground-secondary">
              Export and organize information when you need it, without
              reliving every disagreement.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
