import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const tiers = [
  {
    name: "Base",
    price: 25,
    description: "Essential messaging and documentation.",
  },
  {
    name: "Standard",
    price: 35,
    description: "Expenses, calendar, and more export options.",
  },
  {
    name: "Premium",
    price: 50,
    description: "Full features and priority support.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="font-heading text-xl font-semibold text-primary-dark">
            MyVow Parenting
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-foreground-secondary hover:text-foreground">
              Log in
            </Link>
            <Button asChild>
              <Link href="/signup">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-16">
        <h1 className="font-heading text-3xl font-semibold text-center text-foreground mb-4">
          Simple pricing per parent
        </h1>
        <p className="text-center text-foreground-secondary mb-12 max-w-lg mx-auto">
          Three tiers so you can choose what fits your family. Billed monthly per parent.
        </p>
        <div className="grid gap-6 md:grid-cols-3 max-w-4xl mx-auto">
          {tiers.map((tier) => (
            <Card key={tier.name} className="shadow-card">
              <CardHeader>
                <CardTitle className="font-heading">{tier.name}</CardTitle>
                <p className="text-2xl font-body font-semibold text-foreground">
                  ${tier.price}
                  <span className="text-sm font-normal text-foreground-secondary">/parent/month</span>
                </p>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground-secondary mb-6">
                  {tier.description}
                </p>
                <Button asChild className="w-full">
                  <Link href="/signup">Get started</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
