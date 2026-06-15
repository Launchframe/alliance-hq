import { redirect } from "@/i18n/navigation";

import { AdminPortalShell } from "@/components/admin/AdminPortalShell";
import { requirePageSession } from "@/lib/session";
import { sessionIsPlatformMaintainer } from "@/lib/rbac/context";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/admin");
  const allowed = await sessionIsPlatformMaintainer(session.id);
  if (!allowed) {
    redirect({ href: "/dashboard", locale });
  }

  return <AdminPortalShell>{children}</AdminPortalShell>;
}
