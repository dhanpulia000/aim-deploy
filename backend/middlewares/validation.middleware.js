/**
 * Input validation middleware using Zod
 * Validates request body, query, and params before controller execution
 */

const { z } = require('zod');
const { sendValidationError } = require('../utils/http');
const logger = require('../utils/logger');

/**
 * Create validation middleware from Zod schema
 * @param {Object} schema - Zod schema object with body, query, params properties
 * @returns {Function} Express middleware function
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      // Combine all request data
      const dataToValidate = {
        body: req.body || {},
        query: req.query || {},
        params: req.params || {}
      };

      // Validate using Zod schema
      const result = schema.safeParse(dataToValidate);

      if (!result.success) {
        // Format Zod errors to match our validation error format
        // Zod uses 'issues' not 'errors'
        const errors = (result.error.issues || []).map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code
        }));

        logger.warn('Validation failed', {
          errors,
          path: req.path,
          method: req.method
        });

        return sendValidationError(res, errors);
      }

      // Replace request data with validated data
      if (result.data.body) {
        req.body = result.data.body;
      }
      if (result.data.query) {
        req.query = result.data.query;
      }
      if (result.data.params) {
        req.params = result.data.params;
      }

      next();
    } catch (error) {
      logger.error('Validation middleware error', {
        error: error.message,
        stack: error.stack,
        path: req.path,
        method: req.method,
        body: req.body
      });
      
      // 응답이 아직 전송되지 않았을 때만 에러 응답 전송
      if (!res.headersSent) {
        return sendValidationError(res, [{
          field: 'general',
          message: `Validation error occurred: ${error.message}`
        }]);
      }
      
      // 응답이 이미 전송된 경우 next로 에러 전달
      next(error);
    }
  };
}

/**
 * Helper to create a schema that validates only body
 * @param {z.ZodObject} bodySchema - Zod schema for request body
 * @returns {Object} Full schema object
 */
function bodySchema(bodySchema) {
  return z.object({
    body: bodySchema,
    query: z.object({}).passthrough(),
    params: z.object({}).passthrough()
  });
}

/**
 * Helper to create a schema that validates only query
 * @param {z.ZodObject} querySchema - Zod schema for request query
 * @returns {Object} Full schema object
 */
function querySchema(querySchema) {
  return z.object({
    body: z.object({}).passthrough(),
    query: querySchema,
    params: z.object({}).passthrough()
  });
}

/**
 * Helper to create a schema that validates only params
 * @param {z.ZodObject} paramsSchema - Zod schema for request params
 * @returns {Object} Full schema object
 */
function paramsSchema(paramsSchema) {
  return z.object({
    body: z.object({}).passthrough(),
    query: z.object({}).passthrough(),
    params: paramsSchema
  });
}

module.exports = {
  validate,
  bodySchema,
  querySchema,
  paramsSchema,
  z // Export Zod for schema creation
};




