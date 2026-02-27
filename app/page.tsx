import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col">
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
            <Link href="/login" className="text-sm text-foreground-secondary hover:text-foreground">
              Log in
            </Link>
            <Button asChild>
              <Link href="/signup">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <h1 className="font-heading text-4xl md:text-5xl font-semibold text-foreground text-center max-w-2xl mb-6">
          Calm, clear communication for co-parenting
        </h1>
        <p className="text-lg text-foreground-secondary text-center max-w-xl mb-10">
          Keep conversations child-focused with AI-mediated messaging. Document
          everything for your family — without the conflict.
        </p>
        <div className="flex flex-wrap gap-4 justify-center">
          <Button asChild size="lg">
            <Link href="/signup">Start free</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/pricing">See pricing</Link>
          </Button>
        </div>
      </main>
      <footer className="border-t border-border py-6">
        <div className="container mx-auto px-4 text-center text-sm text-foreground-secondary">
          MyVow Parenting — Communication you can trust.
        </div>
      </footer>
    </div>
  );
}
