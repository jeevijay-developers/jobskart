/** Maximum resume generations per candidate over their lifetime (enforced in Postgres by a trigger). */
export const MAX_RESUME_VERSIONS = 5;

export const RESUME_VERSION_LIMIT_MESSAGE = `You have reached your limit of ${MAX_RESUME_VERSIONS} resume generations.`;

export const RESUME_VERSION_NAME_MAX = 60;
