// Utility functions and helpers
export class Utils {
  static formatFileSize(bytes) {
    // Handle edge cases
    if (!bytes || bytes === 0 || isNaN(bytes)) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    // Ensure we don't go out of bounds
    const sizeIndex = Math.min(i, sizes.length - 1);
    const formattedSize = parseFloat(
      (bytes / Math.pow(k, sizeIndex)).toFixed(2)
    );

    return `${formattedSize} ${sizes[sizeIndex]}`;
  }

  static validateFile(file) {
    if (!file) {
      return { valid: false, error: "No file selected" };
    }

    const fileName = file.name || "Unknown file";
    const fileSize = file.size || 0;

    if (fileSize === 0) {
      return { valid: false, error: "Cannot share empty files" };
    }

    // Size limit check (100MB)
    if (fileSize > 100 * 1024 * 1024) {
      return { valid: false, error: "File too large. Maximum size is 100MB." };
    }

    return {
      valid: true,
      fileName,
      fileSize,
      fileType: file.type || "application/octet-stream",
    };
  }

  static generateId() {
    return Math.random().toString(36).substr(2, 9);
  }

  static debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
}
