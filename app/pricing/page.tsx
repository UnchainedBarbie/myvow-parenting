import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const tiers = [
  {
    name: "Essential",
    price: 14,
    mostPopular: false,
    features: [
      "Parenting calendar",
      "Child profiles",
      "Document storage",
      "Expense tracking",
      "Basic messaging",
      "Shared tasks",
      "Personal notes",
      "Sage AI reflection",
      "Court-ready documentation exports included",
    ],
  },
  {
    name: "Peace",
    price: 26,
    mostPopular: true,
    features: [
      "Everything in Essential",
      "AI-assisted messaging moderation",
      "Delivery windows",
      "Cool-off timers",
      "Message flags",
      "Incident documentation",
      "Conversation archiving",
      "Structured communication exports",
    ],
  },
  {
    name: "Clarity",
    price: 48,
    mostPopular: false,
    features: [
      "Everything in Peace",
      "Conversation analytics",
      "Pattern detection",
      "Incident timeline builder",
      "Exportable evidence logs",
      "Attorney / mediator access sharing",
    ],
  },
];

export default function PricingPage() {
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
      <main className="container mx-auto px-4 py-16">
        <h1 className="font-heading text-3xl font-semibold text-center text-foreground mb-4">
          Simple pricing per parent
        </h1>
        <p className="text-center text-foreground-secondary mb-12 max-w-2xl mx-auto">
          Three tiers so you can choose what fits your family. Billed monthly per parent. Court-ready documentation included on every plan.
        </p>
        <div className="grid gap-6 md:grid-cols-3 max-w-5xl mx-auto">
          {tiers.map((tier) => (
            <Card
              key={tier.name}
              className={`shadow-card relative flex h-full flex-col ${tier.mostPopular ? "ring-2 ring-foreground/10" : ""}`}
            >
              {tier.mostPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-3 py-0.5 text-xs font-medium text-background">
                  Most Popular
                </div>
              )}
              <CardHeader className={tier.mostPopular ? "pt-6" : ""}>
                <CardTitle className="font-heading">{tier.name}</CardTitle>
                <p className="text-2xl font-body font-semibold text-foreground">
                  ${tier.price}
                  <span className="text-sm font-normal text-foreground-secondary">/parent/month</span>
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col min-h-0">
                <ul className="text-sm text-foreground-secondary space-y-2 mb-6 flex-1">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <span className="text-foreground shrink-0">•</span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild className="w-full mt-auto shrink-0">
                  <Link href="/signup">Get started</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-center text-sm text-foreground-secondary mt-10 max-w-2xl mx-auto">
          All plans include a 7-day free trial. Kids accounts: 2 included free per parent, $3/month each after that.
        </p>
      </main>
    </div>
  );
}
