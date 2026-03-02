import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ChangePasswordPage() {
  return (
    <div className="p-6 md:p-8 max-w-md">
      <h1 className="font-heading text-2xl font-semibold text-foreground mb-2">Change password</h1>
      <p className="text-foreground-secondary mb-6">
        A secure password change flow can be added here (e.g. current password + new password, then call your auth provider).
      </p>
      <Button asChild variant="outline" size="sm" className="rounded-full">
        <Link href="/settings">Back to Settings</Link>
      </Button>
    </div>
  );
}
