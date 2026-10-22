import type { Role } from "@prisma/client";
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: Role;
      regionId: string | null;
      mustChangePassword: boolean;
      /** Epoch ms the password was last set; null when untracked. */
      passwordChangedAt: number | null;
      twoFactorPending?: boolean;
      twoFactorEnabled?: boolean;
      /** Per-login session id, used to prove a second factor was verified for THIS session. */
      sid?: string;
    };
  }

  interface User {
    role: Role;
    regionId: string | null;
    mustChangePassword?: boolean;
    passwordChangedAt?: number | null;
    twoFactorPending?: boolean;
    twoFactorEnabled?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    regionId: string | null;
    mustChangePassword?: boolean;
    passwordChangedAt?: number | null;
    twoFactorPending?: boolean;
    twoFactorEnabled?: boolean;
    /** Epoch ms of sign-in, used to enforce an absolute session ceiling. */
    loginAt?: number;
    /**
     * Random id minted once per sign-in. The 2FA-verify route stamps this value
     * onto the user row only after a real code passes, and the JWT callback
     * clears `twoFactorPending` only when the stamp matches — so the pending
     * gate can never be cleared by a client-asserted flag alone.
     */
    sid?: string;
  }
}
