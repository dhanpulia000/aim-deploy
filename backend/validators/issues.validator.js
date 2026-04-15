/**
 * Issues validation schemas
 */

const { z } = require('zod');
const { bodySchema, paramsSchema, querySchema } = require('../middlewares/validation.middleware');

/**
 * Create issue request validation schema
 */
const createIssueSchema = bodySchema(
  z.object({
    title: z.string()
      .min(1, 'Title is required')
      .max(500, 'Title must be at most 500 characters')
      .trim(),
    content: z.string()
      .min(1, 'Content is required')
      .max(10000, 'Content must be at most 10000 characters')
      .trim(),
    sourceUrl: z.string()
      .url('Invalid URL format')
      .max(2000, 'URL must be at most 2000 characters')
      .optional()
      .nullable(),
    categoryId: z.number()
      .int('Category ID must be an integer')
      .positive('Category ID must be positive')
      .optional()
      .nullable(),
    severity: z.number()
      .int('Severity must be an integer')
      .min(1, 'Severity must be at least 1')
      .max(5, 'Severity must be at most 5')
      .optional()
      .nullable(),
    projectId: z.number()
      .int('Project ID must be an integer')
      .positive('Project ID must be positive')
      .optional()
      .nullable()
  })
);

/**
 * Update issue request validation schema
 */
const updateIssueSchema = bodySchema(
  z.object({
    title: z.string()
      .max(500, 'Title must be at most 500 characters')
      .trim()
      .optional(),
    content: z.string()
      .max(10000, 'Content must be at most 10000 characters')
      .trim()
      .optional(),
    status: z.enum(['OPEN', 'TRIAGED', 'IN_PROGRESS', 'RESOLVED'], {
      errorMap: () => ({ message: 'Status must be one of: OPEN, TRIAGED, IN_PROGRESS, RESOLVED' })
    })
      .optional(),
    categoryId: z.number()
      .int('Category ID must be an integer')
      .positive('Category ID must be positive')
      .optional()
      .nullable(),
    severity: z.number()
      .int('Severity must be an integer')
      .min(1, 'Severity must be at least 1')
      .max(5, 'Severity must be at most 5')
      .optional()
      .nullable(),
    assignedAgentId: z.string()
      .uuid('Agent ID must be a valid UUID')
      .optional()
      .nullable()
  })
);

/**
 * Issue ID parameter validation schema
 * Supports UUID, numeric ID, or nanoid format (alphanumeric with underscores/hyphens)
 */
const issueIdSchema = paramsSchema(
  z.object({
    issueId: z.string()
      .min(1, 'Issue ID is required')
      .refine(
        (val) => {
          // Allow UUID, numeric ID, or nanoid format (alphanumeric with underscores/hyphens)
          // nanoid format: typically 21 characters, alphanumeric with underscores/hyphens
          return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val) || // UUID
                 /^\d+$/.test(val) || // Numeric ID
                 /^[a-zA-Z0-9_-]+$/.test(val); // nanoid or similar format
        },
        { message: 'Issue ID must be a valid UUID, numeric ID, or alphanumeric ID' }
      )
  })
);

/**
 * Add comment request validation schema
 */
const addCommentSchema = bodySchema(
  z.object({
    body: z.string()
      .min(1, 'Comment body is required')
      .max(5000, 'Comment must be at most 5000 characters')
      .trim()
  })
);

/**
 * Assign issue request validation schema
 * agentId는 null이거나 빈 문자열일 수 있음 (담당자 해제)
 * Agent ID는 UUID 또는 nanoid 형식 지원
 */
const commentWatchPatchSchema = bodySchema(
  z.object({
    enabled: z.boolean({ required_error: 'enabled is required' }),
    intervalMinutes: z.number().int().min(1).max(24 * 60).optional()
  })
);

const assignIssueSchema = bodySchema(
  z.object({
    agentId: z.preprocess(
      (val) => {
        // 빈 문자열을 null로 변환
        if (val === '' || val === undefined) return null;
        return val;
      },
      z.union([
        z.string().uuid('Agent ID must be a valid UUID'),
        z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Agent ID must be a valid UUID or nanoid format'),
        z.null()
      ]).optional()
    )
  })
);

module.exports = {
  createIssueSchema,
  updateIssueSchema,
  issueIdSchema,
  addCommentSchema,
  assignIssueSchema,
  commentWatchPatchSchema
};












