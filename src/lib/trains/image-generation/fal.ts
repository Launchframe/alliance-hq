import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
} from "@/lib/trains/image-generation/provider";

const FAL_FLUX_ENDPOINT =
  "https://fal.run/fal-ai/flux/dev/image-to-image";

export class FalImageProvider implements ImageGenerationProvider {
  readonly id = "fal" as const;

  async generateDraft(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult> {
    if (process.env.E2E_TEST === "true") {
      const label = encodeURIComponent(request.prompt.slice(0, 40) || "Conductor");
      return {
        imageUrls: [
          `https://placehold.co/512x512/0d1117/f7931a?text=${label}`,
        ],
      };
    }

    const apiKey = process.env.FAL_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("FAL_API_KEY is not configured for fal.ai image generation.");
    }

    if (!request.portraitUrl?.trim()) {
      throw new Error("fal.ai generation requires a conductor portrait reference.");
    }

    const res = await fetch(FAL_FLUX_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: request.prompt,
        image_url: request.portraitUrl,
        strength: 0.75,
        num_images: 1,
      }),
    });

    const payload = (await res.json()) as {
      images?: Array<{ url?: string }>;
      detail?: string;
      error?: string;
    };

    if (!res.ok) {
      throw new Error(
        payload.detail ?? payload.error ?? "fal.ai image generation failed.",
      );
    }

    const url = payload.images?.[0]?.url;
    if (!url) {
      throw new Error("fal.ai returned no image URL.");
    }

    return { imageUrls: [url] };
  }
}
