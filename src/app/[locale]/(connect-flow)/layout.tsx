import { ConnectPageFooter } from "@/components/ConnectPageFooter";
import { ConnectSignOutLink } from "@/components/auth/ConnectSignOutLink";
import { ShellActivityBoundary } from "@/components/ashed-shell/ShellActivityBoundary";
import { auth } from "@/lib/auth";

export default async function ConnectFlowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <ShellActivityBoundary>
      <div className="flex min-h-screen flex-col bg-hq-canvas text-hq-fg">
        <header className="flex justify-end px-4 pt-4">
          {session?.user ? <ConnectSignOutLink /> : null}
        </header>
        <div className="flex-1 px-4 py-10">{children}</div>
        <ConnectPageFooter />
      </div>
    </ShellActivityBoundary>
  );
}
