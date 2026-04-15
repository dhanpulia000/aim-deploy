/**
 * Authentication validation schemas
 */

const { z } = require('zod');
const { bodySchema } = require('../middlewares/validation.middleware');

/**
 * Login request validation schema
 */
const loginSchema = bodySchema(
  z.object({
    email: z.string()
      .email('Invalid email format')
      .min(1, 'Email is required')
      .max(255, 'Email must be at most 255 characters')
      .trim(),
    password: z.string()
      .min(1, 'Password is required')
      .max(100, 'Password must be at most 100 characters')
  })
);

/**
 * Create user request validation schema
 */
const loginOtpSchema = bodySchema(
  z.object({
    loginChallengeId: z.string().min(1, 'loginChallengeId is required').max(64).trim(),
    code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits')
  })
);

const loginOtpResendSchema = bodySchema(
  z.object({
    loginChallengeId: z.string().min(1, 'loginChallengeId is required').max(64).trim()
  })
);

const createUserSchema = bodySchema(
  z.object({
    email: z.string()
      .email('Invalid email format')
      .min(1, 'Email is required')
      .max(255, 'Email must be at most 255 characters')
      .trim(),
    password: z.string()
      .min(8, 'Password must be at least 8 characters')
      .max(100, 'Password must be at most 100 characters'),
    name: z.string()
      .min(1, 'Name is required')
      .max(100, 'Name must be at most 100 characters')
      .trim()
      .optional(),
    role: z.enum(['ADMIN', 'LEAD', 'AGENT', 'VIEWER'], {
      errorMap: () => ({ message: 'Role must be one of: ADMIN, LEAD, AGENT, VIEWER' })
    })
      .optional()
      .default('AGENT')
  })
);

module.exports = {
  loginSchema,
  loginOtpSchema,
  loginOtpResendSchema,
  createUserSchema
};












