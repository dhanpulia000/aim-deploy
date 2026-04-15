/**
 * 스텝 플로팅 API 컨트롤러
 */

const stepFloatingService = require('../services/stepFloating.service');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const logger = require('../utils/logger');

function listItems(req, res) {
  try {
    const { position, includeInactive } = req.query || {};
    const items = stepFloatingService.listItems({
      includeInactive: includeInactive === 'true',
      position: position || undefined
    });
    return sendSuccess(res, { items }, 'Items retrieved successfully');
  } catch (err) {
    logger.error('[StepFloating] listItems failed', { error: err.message });
    return sendError(res, 'Failed to retrieve items', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

function getItem(req, res) {
  try {
    const { id } = req.params;
    const item = stepFloatingService.getItem(id);
    if (!item) {
      return sendError(res, 'Item not found', HTTP_STATUS.NOT_FOUND);
    }
    return sendSuccess(res, { item }, 'Item retrieved successfully');
  } catch (err) {
    logger.error('[StepFloating] getItem failed', { error: err.message });
    return sendError(res, 'Failed to retrieve item', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

function createItem(req, res) {
  try {
    const { title, content, position, sortOrder } = req.body || {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return sendValidationError(res, [{ field: 'title', message: 'title is required' }]);
    }
    if (!content || typeof content !== 'string') {
      return sendValidationError(res, [{ field: 'content', message: 'content is required' }]);
    }

    const item = stepFloatingService.createItem({
      title: title.trim(),
      content: String(content).trim(),
      position: position === 'left' ? 'left' : 'right',
      sortOrder
    });

    return sendSuccess(res, { item }, 'Item created successfully', HTTP_STATUS.CREATED);
  } catch (err) {
    logger.error('[StepFloating] createItem failed', { error: err.message });
    return sendError(res, 'Failed to create item', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

function updateItem(req, res) {
  try {
    const { id } = req.params;
    const { title, content, position, sortOrder, isActive } = req.body || {};

    const existing = stepFloatingService.getItem(id);
    if (!existing) {
      return sendError(res, 'Item not found', HTTP_STATUS.NOT_FOUND);
    }

    if (title !== undefined && (!title || typeof title !== 'string' || !title.trim())) {
      return sendValidationError(res, [{ field: 'title', message: 'title cannot be empty' }]);
    }

    const item = stepFloatingService.updateItem(id, {
      title: title !== undefined ? title.trim() : undefined,
      content: content !== undefined ? String(content).trim() : undefined,
      position: position !== undefined ? (position === 'left' ? 'left' : 'right') : undefined,
      sortOrder,
      isActive
    });

    return sendSuccess(res, { item }, 'Item updated successfully');
  } catch (err) {
    logger.error('[StepFloating] updateItem failed', { error: err.message });
    return sendError(res, 'Failed to update item', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

function deleteItem(req, res) {
  try {
    const { id } = req.params;
    const deleted = stepFloatingService.deleteItem(id);
    if (!deleted) {
      return sendError(res, 'Item not found', HTTP_STATUS.NOT_FOUND);
    }
    return sendSuccess(res, {}, 'Item deleted successfully');
  } catch (err) {
    logger.error('[StepFloating] deleteItem failed', { error: err.message });
    return sendError(res, 'Failed to delete item', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

function reorderItems(req, res) {
  try {
    const { itemIds } = req.body || {};
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return sendValidationError(res, [{ field: 'itemIds', message: 'itemIds array is required' }]);
    }

    stepFloatingService.reorderItems(itemIds);
    return sendSuccess(res, {}, 'Items reordered successfully');
  } catch (err) {
    logger.error('[StepFloating] reorderItems failed', { error: err.message });
    return sendError(res, 'Failed to reorder items', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

module.exports = {
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  reorderItems
};
