import Link from "next/link";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-[#8b949e]">
          Alliance tools built on top of Ashed. Upload videos, manage scores,
          and jump to native Ashed pages from the sidebar.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/tools/video-upload"
          className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 hover:border-[#58a6ff]"
        >
          <h2 className="font-medium">Upload from video</h2>
          <p className="mt-1 text-sm text-[#8b949e]">
            Drop a screen recording — we extract scoreboard frames and send them
            to Ashed.
          </p>
        </Link>

        <a
          href="https://ashed.online/reports"
          target="_blank"
          rel="noreferrer"
          className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 hover:border-[#58a6ff]"
        >
          <h2 className="font-medium">View reports on Ashed ↗</h2>
          <p className="mt-1 text-sm text-[#8b949e]">
            Open the full Ashed reports dashboard in a new tab.
          </p>
        </a>
      </div>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="text-sm font-medium text-[#8b949e]">About Alliance HQ</h2>
        <p className="mt-2 text-sm">
          This app extends{" "}
          <a
            href="https://ashed.online"
            target="_blank"
            rel="noreferrer"
            className="text-[#58a6ff] hover:underline"
          >
            ashed.online
          </a>{" "}
          with alliance-specific tools. All core data and OCR processing remain
          on Ashed — we add convenience features the main app does not ship yet.
        </p>
      </section>
    </div>
  );
}
