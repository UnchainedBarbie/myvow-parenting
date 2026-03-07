import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center focus:outline-none">
            <div style={{ isolation: "isolate" }}>
              <Image
                src="/Horiztonal%20logo%20translucent.png"
                alt="MyVow Parenting"
                width={160}
                height={48}
                className="h-auto w-[160px] object-contain object-left"
                style={{ mixBlendMode: "multiply" }}
              />
            </div>
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              href="/pricing"
              className="text-sm text-foreground-secondary hover:text-foreground"
            >
              Pricing
            </Link>
            <Link
              href="/contact"
              className="text-sm text-foreground-secondary hover:text-foreground"
            >
              Contact
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
      <main className="container mx-auto px-4 py-24 md:py-32">
        <section className="mx-auto max-w-2xl text-center">
          <h1 className="font-heading text-3xl font-semibold text-foreground mb-8">
            Why I built this
          </h1>
          <div className="font-body text-foreground space-y-6 text-left">
            <p>
              I&apos;m Allison, a mom who needed to be free from my ex. I built MyVow
              because I needed to stop communicating with him directly, document
              everything cleanly for court, and create a structure that made it easier
              for both of us to just behave. Not because we wanted to. Because the app
              made cooperation easier than conflict.
            </p>
            <p>
              I couldn&apos;t find a tool that did all of that. So I built it.
            </p>
            <p>
              Every feature in MyVow exists because I needed it.
            </p>
          </div>
          <p className="mt-12 text-sm text-foreground-secondary">
            MyVow Parenting — built from experience, designed for your children.
          </p>
        </section>
      </main>
    </div>
  );
}
