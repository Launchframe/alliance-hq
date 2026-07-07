import Image from "next/image";

type Props = {
  src?: string | null;
  alt: string;
  caption?: string;
  className?: string;
};

export function GuideScreenshotSlot({ src, alt, caption, className }: Props) {
  if (!src) {
    return (
      <figure
        className={`mt-4 overflow-hidden rounded-lg border border-dashed border-hq-border bg-hq-canvas/60${className ? ` ${className}` : ""}`}
      >
        <div className="flex min-h-[10rem] flex-col items-center justify-center gap-2 px-4 py-8 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-subtle">
            Screenshot placeholder
          </p>
          <p className="max-w-sm text-xs text-hq-fg-muted">{alt}</p>
        </div>
        {caption ? (
          <figcaption className="border-t border-hq-border px-3 py-2 text-xs text-hq-fg-muted">
            {caption}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  return (
    <figure
      className={`mt-4 overflow-hidden rounded-lg border border-hq-border bg-hq-canvas${className ? ` ${className}` : ""}`}
    >
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-hq-accent"
        title="Open full-size screenshot"
      >
        <Image
          src={src}
          alt={alt}
          width={1920}
          height={1080}
          className="h-auto w-full"
          sizes="(max-width: 672px) 100vw, 672px"
          quality={85}
        />
      </a>
      {caption ? (
        <figcaption className="border-t border-hq-border px-3 py-2 text-xs text-hq-fg-muted">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
