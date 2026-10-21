import { redirect } from "next/navigation";

/** Old Sage Inbox links land on the Dashboard Open items section. */
export default function SageInboxRedirectPage() {
  redirect("/dashboard?open=items#open-items");
}
