import { z } from 'zod';

/**
 * Input schemas, shared between API routes and the forms that post to them so
 * client and server can never drift apart on what's acceptable.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254) // RFC 5321 maximum
  .email('Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'That password is too long')
  // Length beats composition rules for real-world strength, so there's no
  // symbol/digit requirement — just enough length to make guessing costly.
  .refine((v) => v.trim().length >= 10, 'Password cannot be mostly whitespace');

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(80, 'Name is too long');

export const signupSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  workspaceName: z
    .string()
    .trim()
    .min(2, 'Workspace name is too short')
    .max(60, 'Workspace name is too long'),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(['ADMIN', 'AGENT']).default('AGENT'),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(10),
  name: nameSchema,
  password: passwordSchema,
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
