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
      twoFactorPending?: boolean;
      twoFactorEnabled?: boolean;
    };
  }

  interface User {
    role: Role;
    regionId: string | null;
    mustChangePassword?: boolean;
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
    twoFactorPending?: boolean;
    twoFactorEnabled?: boolean;
  }
}
