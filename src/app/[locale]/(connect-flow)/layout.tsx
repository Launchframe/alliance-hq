import { ConnectPageFooter } from "@/components/ConnectPageFooter";
import { ConnectSignOutLink } from "@/components/auth/ConnectSignOutLink";

export default function ConnectFlowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[#0d1117] text-[#e6edf3]">
      <header className="flex justify-end px-4 pt-4">
        <ConnectSignOutLink />
      </header>
      <div className="flex-1 px-4 py-10">{children}</div>
      <ConnectPageFooter />
    </div>
  );
}
