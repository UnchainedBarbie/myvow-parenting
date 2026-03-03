import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ContactForm } from "@/components/contacts/contact-form";
import { ContactList, type ContactRow } from "@/components/contacts/contact-list";

export default async function ContactsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = getServiceRoleClient();
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const caseId = membership?.case_id ?? null;

  if (!caseId) {
    return (
      <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
        <div className="mb-4">
          <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
            Contacts
          </h1>
          <p className="text-xs md:text-sm text-foreground-secondary leading-snug">
            Keep doctors, teachers, and other key adults organized for your kids.
          </p>
        </div>
        <div className="rounded-card border border-border bg-background-secondary p-8 text-center">
          <p className="text-foreground-secondary">
            Create or join a case in Settings to add and manage contacts.
          </p>
        </div>
      </div>
    );
  }

  const { data: children } = await admin
    .from("children")
    .select("id, first_name, profile_image")
    .eq("case_id", caseId)
    .is("deleted_at", null)
    .order("first_name");

  const { data: contactsRaw } = await admin
    .from("contacts")
    .select(
      "id, name, role, organization, phone, email, address, notes, visibility, is_emergency, created_at, updated_at, deleted_at"
    )
    .eq("case_id", caseId)
    .is("deleted_at", null)
    .order("name", { ascending: true });

  const contactIds = (contactsRaw ?? []).map((c) => c.id as string);
  const { data: contactChildrenRows } =
    contactIds.length > 0
      ? await admin
          .from("contact_children")
          .select("contact_id, child_id")
          .in("contact_id", contactIds)
      : { data: [] };

  const childMap = (children ?? []).reduce(
    (acc, c) => {
      acc[c.id as string] = {
        first_name: c.first_name as string,
        profile_image: (c.profile_image as string | null) ?? null,
      };
      return acc;
    },
    {} as Record<string, { first_name: string; profile_image: string | null }>
  );

  const contactToChildIds = (contactChildrenRows ?? []).reduce(
    (acc, row) => {
      const r = row as { contact_id: string; child_id: string };
      if (!acc[r.contact_id]) acc[r.contact_id] = [];
      acc[r.contact_id].push(r.child_id);
      return acc;
    },
    {} as Record<string, string[]>
  );

  const contacts: ContactRow[] = (contactsRaw ?? []).map((c) => {
    const id = c.id as string;
    const childIds = contactToChildIds[id] ?? [];
    const childNames =
      childIds.length === 0
        ? []
        : childIds.map((cid) => childMap[cid]?.first_name ?? cid);
    return {
      id,
      name: (c.name as string) ?? "",
      role: (c.role as string | null) ?? null,
      organization: (c.organization as string | null) ?? null,
      phone: (c.phone as string | null) ?? null,
      email: (c.email as string | null) ?? null,
      address: (c.address as string | null) ?? null,
      notes: (c.notes as string | null) ?? null,
      visibility: (c.visibility as string | null) ?? "parents",
      is_emergency: (c.is_emergency as boolean | null) ?? false,
      child_ids: childIds,
      child_names: childNames,
    };
  });

  return (
    <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
      <div className="mb-4">
        <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
          Contacts
        </h1>
        <p className="text-xs md:text-sm text-foreground-secondary leading-snug">
          Keep doctors, teachers, and other key adults organized for your kids.
        </p>
      </div>
      <div className="space-y-2">
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,28%)_minmax(0,1fr)] items-start">
          <ContactForm caseId={caseId} children={children ?? []} />
          <ContactList contacts={contacts} children={children ?? []} />
        </div>
      </div>
    </div>
  );
}

