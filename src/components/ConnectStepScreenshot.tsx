import Image from "next/image";

type Props = {
  src: string;
  alt: string;
  caption?: string;
};

export function ConnectStepScreenshot({ src, alt, caption }: Props) {
  return (
    <figure className="mt-4 overflow-hidden rounded-lg border border-[#30363d] bg-[#0d1117]">
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
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
      {caption && (
        <figcaption className="border-t border-[#30363d] px-3 py-2 text-xs text-[#8b949e]">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
