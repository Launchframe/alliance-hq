export type AshedAllianceRow = {
  id?: string;
  tag?: string;
  name?: string;
  owner_id?: string;
  owner_email?: string;
  collaborators?: string[];
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
