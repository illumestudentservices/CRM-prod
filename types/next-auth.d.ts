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
  }
}
