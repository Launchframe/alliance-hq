import { Suspense } from "react";

import { AdminAlliancesConsole } from "@/components/admin/AdminAlliancesConsole";

export default function AdminAlliancesPage() {
  return (
    <Suspense fallback={null}>
      <AdminAlliancesConsole />
    </Suspense>
  );
}
