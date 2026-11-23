const cloudinary = require("cloudinary").v2;

const isConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET &&
  process.env.CLOUDINARY_CLOUD_NAME !== "your_cloud_name"
);

if (isConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/**
 * Upload an image buffer to Cloudinary with fallback for dev/offline mode
 * @param {Buffer} buffer - Image file buffer from Multer
 * @param {string} folder - Target Cloudinary folder
 * @param {string} filename - Optional file reference
 * @returns {Promise<{ url: string, publicId: string }>}
 */
async function uploadToCloudinary(buffer, folder = "civicpulse/issues", filename = "issue-photo") {
  if (!buffer) {
    return { url: null, publicId: null };
  }

  if (isConfigured) {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: "image",
          transformation: [{ quality: "auto", fetch_format: "auto" }],
        },
        (error, result) => {
          if (error) return reject(error);
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
          });
        }
      );
      uploadStream.end(buffer);
    });
  }

  // Graceful fallback when Cloudinary API credentials are not set in local development
  const base64Data = buffer.toString("base64");
  const fallbackUrl = `data:image/jpeg;base64,${base64Data}`;
  return {
    url: fallbackUrl,
    publicId: `dev_${Date.now()}_${filename.replace(/[^a-zA-Z0-9]/g, "")}`,
  };
}

module.exports = {
  cloudinary,
  isConfigured,
  uploadToCloudinary,
};
