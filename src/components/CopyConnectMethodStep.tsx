"use client";

import { ConnectStepScreenshot } from "@/components/ConnectStepScreenshot";

export type CopyConnectMethod = "curl" | "authorization";

export const COPY_CONNECT_METHOD_TITLES: Record<CopyConnectMethod, string> = {
  curl: "Copy as cURL",
  authorization: "Copy authorization header",
};

export const COPY_CONNECT_METHOD_CHECKLISTS: Record<CopyConnectMethod, string> =
  {
    curl: "I copied a cURL command",
    authorization: "I copied the authorization header",
  };

type Props = {
  method: CopyConnectMethod;
  onMethodChange: (method: CopyConnectMethod) => void;
};

export function CopyConnectMethodStep({ method, onMethodChange }: Props) {
  if (method === "authorization") {
    return (
      <>
        <p className="text-sm text-[#8b949e]">
          Open the request&apos;s <strong className="text-[#e6edf3]">Headers</strong>{" "}
          tab and copy the{" "}
          <code className="rounded bg-[#0d1117] px-1 font-mono text-[0.85em]">
            authorization
          </code>{" "}
          line (or just the long token after{" "}
          <code className="rounded bg-[#0d1117] px-1 font-mono text-[0.85em]">
            Bearer
          </code>
          ).
        </p>
        <ConnectStepScreenshot
          src="/help/connect/3b-copy-authorization.png"
          alt="Chrome DevTools Headers tab showing the authorization request header with Bearer token highlighted"
          caption="Headers tab → scroll to authorization and copy the full Bearer value"
        />
        <pre className="overflow-x-auto rounded-lg border border-[#30363d] bg-[#0d1117] p-3 font-mono text-xs text-[#e6edf3]">
          authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…
        </pre>
        <p className="mt-4 text-sm">
          <button
            type="button"
            onClick={() => onMethodChange("curl")}
            className="text-[#58a6ff] hover:underline"
          >
            Try copying as a cURL request instead
          </button>
        </p>
      </>
    );
  }

  return (
    <>
      <p className="rounded-lg border border-[#238636]/40 bg-[#238636]/10 px-3 py-2 text-sm">
        <strong className="text-[#3fb950]">Easiest method:</strong> copy the
        whole request in one step — we pull out your login token automatically.
      </p>
      <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm">
        <li>
          Click any request whose URL contains{" "}
          <code className="rounded bg-[#0d1117] px-1.5 py-0.5 font-mono text-[0.9em]">
            base44.app
          </code>
        </li>
        <li>
          <strong>Right-click</strong> that request (or use the row menu)
        </li>
        <li>
          Choose <strong>Copy</strong> → <strong>Copy as cURL</strong>
          <span className="text-[#8b949e]">
            {" "}
            (Chrome, Edge, Brave, and Firefox; Safari includes this too)
          </span>
        </li>
      </ol>
      <p className="mt-3 text-sm text-[#8b949e]">
        Some browsers label it <strong>Copy as cURL (bash)</strong> — either
        works. Paste the full command on the next step.
      </p>
      <ConnectStepScreenshot
        src="/help/connect/3a-copy-as-curl.png"
        alt="Chrome DevTools Network tab with right-click menu open on a UserProfile request, Copy as cURL highlighted"
        caption="Right-click a base44 request → Copy → Copy as cURL"
      />
      <p className="mt-4 text-sm">
        <button
          type="button"
          onClick={() => onMethodChange("authorization")}
          className="text-[#58a6ff] hover:underline"
        >
          Alternate: copy only the authorization header
        </button>
      </p>
    </>
  );
}
