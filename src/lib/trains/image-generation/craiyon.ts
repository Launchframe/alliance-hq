import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
} from "@/lib/trains/image-generation/provider";

const CRAIYON_V3_URL = "https://api.craiyon.com/v3";
const CRAIYON_UPSCALE_URL = "https://api.craiyon.com/upscale";
const DRAFT_COUNT = 9;

type CraiyonResponse = {
  images?: string[];
  error?: string;
};

function base64ToDataUrl(base64: string): string {
  const trimmed = base64.trim();
  if (trimmed.startsWith("data:")) return trimmed;
  return `data:image/jpeg;base64,${trimmed}`;
}

function extractBase64FromUrl(url: string): string | null {
  if (url.startsWith("data:image")) {
    const comma = url.indexOf(",");
    if (comma === -1) return null;
    return url.slice(comma + 1);
  }
  return null;
}

async function fetchImageAsBase64(url: string): Promise<string> {
  const embedded = extractBase64FromUrl(url);
  if (embedded) return embedded;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Could not download the selected image for upscaling.");
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer.toString("base64");
}

function e2ePlaceholderUrls(prompt: string): string[] {
  const label = encodeURIComponent(prompt.slice(0, 40) || "Conductor");
  return Array.from({ length: DRAFT_COUNT }, (_, index) => {
    return `https://placehold.co/512x512/161b22/58a6ff?text=${label}+${index + 1}`;
  });
}

export class CraiyonImageProvider implements ImageGenerationProvider {
  readonly id = "craiyon" as const;

  async generateDraft(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult> {
    if (process.env.E2E_TEST === "true") {
      return { imageUrls: e2ePlaceholderUrls(request.prompt) };
    }

    const token = process.env.CRAIYON_API_TOKEN?.trim();
    const body: Record<string, string> = {
      prompt: request.prompt,
      model: request.modelType?.trim() || "art",
      negative_prompt: "",
    };
    if (token) body.token = token;

    const res = await fetch(CRAIYON_V3_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await res.json()) as CraiyonResponse;
    if (!res.ok) {
      throw new Error(payload.error ?? "Craiyon image generation failed.");
    }

    const images = (payload.images ?? []).map(base64ToDataUrl);
    if (images.length === 0) {
      throw new Error("Craiyon returned no images.");
    }

    while (images.length < DRAFT_COUNT) {
      images.push(images[images.length - 1]!);
    }

    return { imageUrls: images.slice(0, DRAFT_COUNT) };
  }

  async upscaleSelected(imageUrl: string): Promise<string> {
    if (process.env.E2E_TEST === "true") {
      return imageUrl;
    }

    const token = process.env.CRAIYON_API_TOKEN?.trim();
    const image = await fetchImageAsBase64(imageUrl);
    const body: Record<string, string> = { image };
    if (token) body.token = token;

    const res = await fetch(CRAIYON_UPSCALE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await res.json()) as CraiyonResponse;
    if (!res.ok) {
      throw new Error(payload.error ?? "Craiyon upscale failed.");
    }

    const upscaled = payload.images?.[0];
    if (!upscaled) {
      throw new Error("Craiyon upscale returned no image.");
    }

    return base64ToDataUrl(upscaled);
  }
}
