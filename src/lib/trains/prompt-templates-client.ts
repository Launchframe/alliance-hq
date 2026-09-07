import type {
  ConductorGeneratedImage,
  ConductorPortraitPayload,
  CreatePromptTemplateInput,
  ListPromptTemplatesQuery,
  PromptTemplateDetail,
  PromptTemplateSummary,
  UpdatePromptTemplateInput,
} from "@/lib/trains/prompt-templates.shared";
import type { ImageModelProvider } from "@/lib/trains/prompt-templates.shared";

async function parseJson<T>(res: Response): Promise<T & { error?: string }> {
  return (await res.json()) as T & { error?: string };
}

function buildQuery(params: ListPromptTemplatesQuery): string {
  const search = new URLSearchParams();
  if (params.type) search.set("type", params.type);
  if (params.visibility) search.set("visibility", params.visibility);
  if (params.conductorMechanism) {
    search.set("conductorMechanism", params.conductorMechanism);
  }
  if (params.seasonKey) search.set("seasonKey", params.seasonKey);
  if (params.search) search.set("search", params.search);
  if (params.conductorMemberId) {
    search.set("conductorMemberId", params.conductorMemberId);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchPromptTemplates(
  query: ListPromptTemplatesQuery = {},
): Promise<PromptTemplateSummary[]> {
  const res = await fetch(`/api/trains/prompts${buildQuery(query)}`);
  const body = await parseJson<{ templates: PromptTemplateSummary[] }>(res);
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to load prompt templates.");
  }
  return body.templates ?? [];
}

export async function fetchPromptTemplate(
  id: string,
): Promise<PromptTemplateDetail> {
  const res = await fetch(`/api/trains/prompts/${id}`);
  const body = await parseJson<{ template: PromptTemplateDetail }>(res);
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to load prompt template.");
  }
  if (!body.template) {
    throw new Error("Prompt template not found.");
  }
  return body.template;
}

export async function createPromptTemplate(
  input: CreatePromptTemplateInput,
): Promise<PromptTemplateDetail> {
  const res = await fetch("/api/trains/prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await parseJson<{ template: PromptTemplateDetail }>(res);
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to create prompt template.");
  }
  if (!body.template) {
    throw new Error("Create prompt template returned no template.");
  }
  return body.template;
}

export async function updatePromptTemplate(
  id: string,
  input: UpdatePromptTemplateInput,
): Promise<PromptTemplateDetail> {
  const res = await fetch(`/api/trains/prompts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await parseJson<{ template: PromptTemplateDetail }>(res);
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to update prompt template.");
  }
  if (!body.template) {
    throw new Error("Update prompt template returned no template.");
  }
  return body.template;
}

export async function generateConductorImages(input: {
  conductorRecordId: string;
  promptBody: string;
  promptTemplateId?: string | null;
  modelProvider: ImageModelProvider;
  modelType?: string | null;
  portraitUrl?: string | null;
}): Promise<ConductorGeneratedImage> {
  const res = await fetch(
    `/api/trains/conductor/${input.conductorRecordId}/images`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptBody: input.promptBody,
        promptTemplateId: input.promptTemplateId ?? null,
        modelProvider: input.modelProvider,
        modelType: input.modelType ?? "art",
        portraitUrl: input.portraitUrl ?? null,
      }),
    },
  );
  const body = await parseJson<{ image: ConductorGeneratedImage }>(res);
  if (!res.ok) {
    throw new Error(body.error ?? "Image generation failed.");
  }
  if (!body.image) {
    throw new Error("Image generation returned no image record.");
  }
  return body.image;
}

export async function finalizeConductorImage(input: {
  conductorRecordId: string;
  imageId: string;
  selectedExternalUrl: string;
}): Promise<ConductorGeneratedImage> {
  const res = await fetch(
    `/api/trains/conductor/${input.conductorRecordId}/images/${input.imageId}/finalize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selectedExternalUrl: input.selectedExternalUrl,
      }),
    },
  );
  const body = await parseJson<{ image: ConductorGeneratedImage }>(res);
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to finalize image.");
  }
  if (!body.image) {
    throw new Error("Finalize image returned no image record.");
  }
  return body.image;
}

export async function fetchConductorPortrait(
  conductorRecordId: string,
): Promise<ConductorPortraitPayload> {
  const res = await fetch(
    `/api/trains/conductor/${conductorRecordId}/portrait`,
  );
  const body = await parseJson<{ portrait: ConductorPortraitPayload }>(res);
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to load conductor portrait.");
  }
  return (
    body.portrait ?? {
      url: null,
      source: null,
      memberName: "",
    }
  );
}

export async function fetchMemberPortrait(input: {
  allianceTag: string;
  memberId: string;
}): Promise<{ url: string | null; source: string | null }> {
  const res = await fetch(
    `/api/alliance/${encodeURIComponent(input.allianceTag)}/members/${encodeURIComponent(input.memberId)}/portrait`,
  );
  const body = await parseJson<{ url: string | null; source: string | null }>(
    res,
  );
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to load member portrait.");
  }
  return { url: body.url ?? null, source: body.source ?? null };
}

/** Sort templates for wizard display: member-scoped → history → season/mechanism → rest. */
export function sortPromptTemplatesForConductor(input: {
  templates: PromptTemplateSummary[];
  conductorMemberId: string | null;
  seasonKey: string | null;
  conductorMechanism: string | null;
  previouslyUsedTemplateIds: string[];
}): PromptTemplateSummary[] {
  const { templates, conductorMemberId, seasonKey, conductorMechanism } =
    input;
  const usedSet = new Set(input.previouslyUsedTemplateIds);

  function tier(template: PromptTemplateSummary): number {
    if (
      conductorMemberId &&
      template.targetConductorAshedMemberId === conductorMemberId
    ) {
      return 0;
    }
    if (usedSet.has(template.id)) return 1;
    const seasonMatch =
      !template.seasonKey || template.seasonKey === seasonKey;
    const mechanismMatch =
      !template.conductorMechanism ||
      template.conductorMechanism === conductorMechanism;
    if (seasonMatch && mechanismMatch) return 2;
    return 3;
  }

  return [...templates].sort((a, b) => {
    const tierDiff = tier(a) - tier(b);
    if (tierDiff !== 0) return tierDiff;
    const aUsed = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
    const bUsed = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
    return bUsed - aUsed;
  });
}
