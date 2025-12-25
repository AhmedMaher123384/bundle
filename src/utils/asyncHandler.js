/**
 * Wraps async Express handlers and forwards errors to next().
 * @param {(req: any, res: any, next: any) => Promise<any>} handler
 * @returns {(req: any, res: any, next: any) => void}
 */
function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = {
  asyncHandler
};

