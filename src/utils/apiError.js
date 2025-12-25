class ApiError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message
   * @param {{ code?: string, details?: any }=} meta
   */
  constructor(statusCode, message, meta) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = meta?.code;
    this.details = meta?.details;
  }
}

module.exports = {
  ApiError
};

