export type AshedAllianceRow = {
  id?: string;
  tag?: string;
  name?: string;
  owner_id?: string;
  owner_email?: string;
  collaborators?: string[];
  /** Last War state server number (Ashed Alliance entity). */
  server_number?: number | string | null;
};

export type AshedUserRef = {
  email: string;
  id?: string;
};

export type AllianceAccessRole = "owner" | "maintainer";

export type AccessibleAlliance = {
  id: string;
  tag: string;
  name?: string;
  accessRole: AllianceAccessRole;
};

/** HQ membership row for sidebar alliance picker */
export type SessionAllianceOption = {
  id: string;
  tag: string | null;
  name: string;
  slug: string;
  roleName: string;
};
