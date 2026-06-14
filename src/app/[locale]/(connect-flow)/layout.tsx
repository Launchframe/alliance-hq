import { ConnectPageFooter } from "@/components/ConnectPageFooter";

export default function ConnectFlowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[#0d1117] text-[#e6edf3]">
      <div className="flex-1 px-4 py-10">{children}</div>
      <ConnectPageFooter />
    </div>
  );
}
