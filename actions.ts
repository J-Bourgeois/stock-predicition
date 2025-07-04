"use server";

import prisma from "./lib/prisma";
import { hash } from "bcryptjs";
import { z } from "zod";
import { compare } from "bcryptjs";
import { cookies } from "next/headers";
import { encrypt, verifyJwt } from "@/lib/session";
import { redirect } from "next/navigation";

const signupSchema = z.object({
  name: z
    .string()
    .min(2, { message: "Name must be at least 2 characters long" }),
  email: z.string().email().trim(),
  password: z
    .string()
    .min(6, { message: "Password must be at least 6 characters long" })
    .trim(),
});

const logInSchema = z.object({
  email: z.string().email().trim(),
  password: z
    .string()
    .min(6, { message: "Password must be at least 6 characters long" })
    .trim(),
});

const nameSchema = z.object({
  currentName: z
    .string()
    .min(2, { message: "Name must be at least 2 characters long" }),
  newName: z
    .string()
    .min(2, { message: "Name must be at least 2 characters long" }),
});

const emailSchema = z.object({
  currentEmail: z.string().email().trim(),
  newEmail: z.string().email().trim(),
});

const passwordSchema = z.object({
  currentPassword: z
    .string()
    .min(6, { message: "Password must be at least 6 characters long" })
    .trim(),
  newPassword: z
    .string()
    .min(6, { message: "Password must be at least 6 characters long" })
    .trim(),
});

export async function signUp(prevState: any, formdata: FormData) {
  const parsed = signupSchema.safeParse(Object.fromEntries(formdata));

  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return {
      errors: {
        email: ["A user with this email already exists"],
      },
    };
  }

  const hashedPassword = await hash(password, 10);

  await prisma.user.create({
    data: {
      name,
      email,
      hashedPassword: hashedPassword,
      Portfolio: {
        create: {},
      },
    },
  });

  redirect("/login?signup=success");
}

export async function logIn(prevState: any, formdata: FormData) {
  const result = logInSchema.safeParse(Object.fromEntries(formdata));

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const { email, password } = result.data;

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await compare(password, user.hashedPassword))) {
    return {
      errors: {
        email: ["Invalid email or password"],
      },
    };
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const token = await encrypt({ sub: user.id, email: user.email });

  (await cookies()).set("token", token, {
    httpOnly: true,
    secure: true,
    expires: expiresAt,
  });

  redirect(`/${user.id}/portfolio`);
}

export async function logOut() {
  (await cookies()).delete("token");
}

export async function addPortfolioStock(stockTicker: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  const session = await verifyJwt(token);

  if (!session) return;

  const { email } = session as { email: string };

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      Portfolio: {
        include: {
          stockSelections: {
            include: {
              stock: true,
            },
          },
        },
      },
    },
  });

  const usersPortfolio = user?.Portfolio[0];

  if (!usersPortfolio) {
    return { error: "Portfolio not found" };
  }

  const alreadyHaveStock = usersPortfolio?.stockSelections.some((selection) => {
    return selection.stock.symbol === stockTicker;
  });

  if (alreadyHaveStock) {
    return { error: "Stock is already in portfolio" };
  }

  const stock = await prisma.stock.findUnique({
    where: { symbol: stockTicker },
  });

  if (!stock) {
    return { error: "Stock not found" };
  }

  await prisma.stocksSelection.create({
    data: {
      portfolioId: usersPortfolio.id,
      stockId: stock.id,
    },
  });

  return { message: "Stock added to portfolio!" };
}

export async function removePortfolioStock(stockTicker: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  const session = await verifyJwt(token);

  if (!session) return;

  const { email } = session as { email: string };

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      Portfolio: {
        include: {
          stockSelections: {
            include: {
              stock: true,
            },
          },
        },
      },
    },
  });

  const usersPortfolio = user?.Portfolio[0];

  if (!usersPortfolio) {
    return { error: "Portfolio not found" };
  }

  const stockToDelete = usersPortfolio?.stockSelections.find((selection) => {
    return selection.stock.symbol === stockTicker;
  });

  if (!stockToDelete) {
    return { error: "Stock is not in portfolio" };
  }

  await prisma.stocksSelection.delete({
    where: {
      id: stockToDelete.id,
    },
  });
}

export async function changeName(prevState: any, formdata: FormData) {
  const result = nameSchema.safeParse(Object.fromEntries(formdata));

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  const session = await verifyJwt(token);

  if (!session) return;

  const { email } = session as { email: string };

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    return {
      errors: {
        currentName: ["User not found. Try again later"],
      },
    };
  }

  if (result.data.currentName !== user?.name) {
    return {
      errors: {
        currentName: ["Current name doesn't match name on file"],
      },
    };
  }

  if (result.data.currentName === result.data.newName) {
    return {
      errors: {
        currentName: ["Current name cannot be same as new name"],
        newName: ["Current name cannot be same as new name"],
      },
    };
  }

  await prisma.user.update({
    where: {
      email: email,
    },
    data: {
      name: result.data.newName,
    },
  });

  return { success: true };
}

export async function changeEmail(prevState: any, formdata: FormData) {
  const result = emailSchema.safeParse(Object.fromEntries(formdata));

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  const session = await verifyJwt(token);

  if (!session) return;

  const { email } = session as { email: string };

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    return {
      errors: {
        currentEmail: ["User not found. Try again later"],
      },
    };
  }

  if (result.data.currentEmail !== user?.email) {
    return {
      errors: {
        currentEmail: ["Current email doesn't match email on file"],
      },
    };
  }

  if (result.data.currentEmail === result.data.newEmail) {
    return {
      errors: {
        currentEmail: ["Current email cannot be the same as new email"],
        newEmail: ["Current email cannot be the same as new email"],
      },
    };
  }

  await prisma.user.update({
    where: {
      email: email,
    },
    data: {
      email: result.data.newEmail,
    },
  });

  logOut();
  redirect("/login?emailChange=success");
}

export async function changePassword(prevState: any, formdata: FormData) {
  const result = passwordSchema.safeParse(Object.fromEntries(formdata));

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const { currentPassword, newPassword } = result.data;

  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  const session = await verifyJwt(token);

  if (!session) return;

  const { email } = session as { email: string };

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    return {
      errors: {
        currentPassword: ["User not found. Please try again"],
        newPassword: ["User not found. Please try again"],
      },
    };
  }

  const isCurrentPasswordValid = await compare(
    currentPassword,
    user.hashedPassword
  );
  if (!isCurrentPasswordValid) {
    return {
      errors: {
        currentPassword: ["Current password is incorrect"],
      },
    };
  }

  const isSamePassword = await compare(newPassword, user.hashedPassword);
  if (isSamePassword) {
    return {
      errors: {
        newPassword: [
          "New password must be diffrent from the current password",
        ],
      },
    };
  }

  const newHashedPassword = await hash(newPassword, 10);

  await prisma.user.update({
    where: {
      email,
    },
    data: {
      hashedPassword: newHashedPassword,
    },
  });

  logOut();
  redirect("/login?passwordChange=success");
}
