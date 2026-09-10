import "server-only";

const DEFAULT_OFFICER_INTEL_MODEL = "gpt-4o-mini";

export function isOfficerIntelLlmConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function officerIntelLlmModel(): string {
  return (
    process.env.OFFICER_INTEL_LLM_MODEL?.trim() || DEFAULT_OFFICER_INTEL_MODEL
  );
}
