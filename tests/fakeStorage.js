export function createFakeStorage() {
  const objects = new Map();

  return {
    isConfigured: true,
    objects,

    async createUploadUrl({ key, mimeType, expiresIn }) {
      return {
        url: `https://fake-storage.test/upload/${key}?expires=${expiresIn}`,
        headers: { 'Content-Type': mimeType },
      };
    },

    async createDownloadUrl({ key, expiresIn }) {
      return `https://fake-storage.test/download/${key}?expires=${expiresIn}`;
    },

    async headObject(key) {
      return objects.get(key) ?? null;
    },

    async deleteObject(key) {
      objects.delete(key);
    },

    // Test helper: client ne presigned URL par PUT kar diya
    simulateUpload(key, { size, contentType }) {
      objects.set(key, { size, contentType });
    },
  };
}