import "server-only";

const DEFAULT_OFFICER_INTEL_MODEL = "gpt-4o-mini";
const DEFAULT_OFFICER_INTEL_EMBED_MODEL = "text-embedding-3-small";

export function isOfficerIntelLlmConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function officerIntelLlmModel(): string {
  return (
    process.env.OFFICER_INTEL_LLM_MODEL?.trim() || DEFAULT_OFFICER_INTEL_MODEL
  );
}

export function officerIntelEmbedModel(): string {
  return (
    process.env.OFFICER_INTEL_EMBED_MODEL?.trim() ||
    DEFAULT_OFFICER_INTEL_EMBED_MODEL
  );
}
