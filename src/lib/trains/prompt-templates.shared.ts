import type { ConductorMechanismType } from "@/lib/trains/types";

export const PROMPT_TEMPLATE_TYPES = ["image", "announcement"] as const;
export type PromptTemplateType = (typeof PROMPT_TEMPLATE_TYPES)[number];

export const PROMPT_VISIBILITY_LEVELS = [
  "private",
  "internal",
  "public",
] as const;
export type PromptVisibility = (typeof PROMPT_VISIBILITY_LEVELS)[number];

export const IMAGE_MODEL_PROVIDERS = ["craiyon", "fal"] as const;
export type ImageModelProvider = (typeof IMAGE_MODEL_PROVIDERS)[number];

export const GENERATED_IMAGE_QUALITIES = ["draft", "final"] as const;
export type GeneratedImageQuality = (typeof GENERATED_IMAGE_QUALITIES)[number];

export const GENERATED_IMAGE_STATUSES = [
  "pending",
  "generating",
  "completed",
  "failed",
] as const;
export type GeneratedImageStatus = (typeof GENERATED_IMAGE_STATUSES)[number];

export type PromptTemplateRevisionSummary = {
  id: string;
  revisionNumber: number;
  title: string;
  body: string;
  visibility: PromptVisibility;
  conductorMechanism: ConductorMechanismType | null;
  seasonKey: string | null;
  eventTag: string | null;
  createdByDisplayName: string | null;
  createdAt: string;
};

export type PromptTemplateSummary = {
  id: string;
  templateType: PromptTemplateType;
  title: string;
  visibility: PromptVisibility;
  conductorMechanism: ConductorMechanismType | null;
  seasonKey: string | null;
  eventTag: string | null;
  targetConductorAshedMemberId: string | null;
  targetConductorMemberName: string | null;
  isDefault: boolean;
  createdByDisplayName: string | null;
  lastUsedAt: string | null;
  finalizedImageCount: number;
  latestFinalizedImageUrl: string | null;
  currentRevision: PromptTemplateRevisionSummary;
  createdAt: string;
  updatedAt: string;
};

export type PromptTemplateDetail = PromptTemplateSummary & {
  revisions: PromptTemplateRevisionSummary[];
};

export type CreatePromptTemplateInput = {
  templateType: PromptTemplateType;
  title: string;
  body: string;
  visibility: PromptVisibility;
  conductorMechanism?: ConductorMechanismType | null;
  seasonKey?: string | null;
  eventTag?: string | null;
  targetConductorAshedMemberId?: string | null;
  isDefault?: boolean;
};

export type UpdatePromptTemplateInput = {
  title?: string;
  body?: string;
  visibility?: PromptVisibility;
  conductorMechanism?: ConductorMechanismType | null;
  seasonKey?: string | null;
  eventTag?: string | null;
  targetConductorAshedMemberId?: string | null;
  isDefault?: boolean;
};

export type ConductorGeneratedImage = {
  id: string;
  conductorRecordId: string;
  promptTemplateId: string | null;
  promptBodyUsed: string;
  modelProvider: ImageModelProvider;
  modelType: string | null;
  quality: GeneratedImageQuality;
  status: GeneratedImageStatus;
  storageKey: string | null;
  downloadUrl: string | null;
  externalImageUrls: string[];
  selectedExternalUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  finalizedAt: string | null;
};

export type ConductorPortraitPayload = {
  url: string | null;
  source: "lastwar" | "hq_avatar" | "upload" | null;
  memberName: string;
};

export type ListPromptTemplatesQuery = {
  type?: PromptTemplateType;
  visibility?: PromptVisibility;
  conductorMechanism?: ConductorMechanismType;
  seasonKey?: string;
  search?: string;
  conductorMemberId?: string;
};
