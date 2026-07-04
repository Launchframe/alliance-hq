import type { ImageModelProvider } from "@/lib/trains/prompt-templates.shared";

export type ImageGenerationRequest = {
  prompt: string;
  modelType?: string | null;
  portraitUrl?: string | null;
};

export type ImageGenerationResult = {
  imageUrls: string[];
};

export interface ImageGenerationProvider {
  readonly id: ImageModelProvider;
  generateDraft(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
  upscaleSelected?(imageUrl: string): Promise<string>;
}

export function isDataOrHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:");
}
