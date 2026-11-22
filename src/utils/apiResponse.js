class ApiResponse {
  constructor(statusCode, data, message = "Success", pagination = null) {
    this.statusCode = statusCode;
    this.success = statusCode < 400;
    this.message = message;
    this.data = data;
    if (pagination) {
      this.pagination = pagination;
    }
  }

  send(res) {
    const payload = {
      success: this.success,
      message: this.message,
      data: this.data,
    };
    if (this.pagination) {
      payload.pagination = this.pagination;
    }
    return res.status(this.statusCode).json(payload);
  }
}

module.exports = ApiResponse;
