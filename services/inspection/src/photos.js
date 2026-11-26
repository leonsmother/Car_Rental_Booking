// services/inspection/src/photos.js
// Photos never pass through Lambda. The browser uploads straight to a PRIVATE S3 bucket
// with a short-lived link we sign, and views photos the same way.
// Only the S3 key is stored in Neon.

const crypto = require('crypto');
const { HttpError } = require('./inspection.validation');

const MAX_BYTES = 5 * 1024 * 1024;            // 5 MB, same limit as the database check
const UPLOAD_URL_SECONDS = 300;
const VIEW_URL_SECONDS = 300;
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png' };

let s3;                                        // created on first use (and replaceable in tests)
function client() {
  if (!s3) {
    const { S3Client } = require('@aws-sdk/client-s3');
    // AWS_ENDPOINT_URL is only set on your PC (Floci). On AWS it is never set, so nothing changes there.
    s3 = new S3Client({ forcePathStyle: Boolean(process.env.AWS_ENDPOINT_URL) });
  }
  return s3;
}
function bucket() {
  if (!process.env.PHOTO_BUCKET) throw new Error('PHOTO_BUCKET is not set');
  return process.env.PHOTO_BUCKET;
}
async function sign(command, seconds) {
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  return getSignedUrl(client(), command, { expiresIn: seconds });
}

// Link for ONE upload (PUT). The content type is part of the signature, so another type is refused by S3.
async function createUploadUrl(reportId, contentType) {
  const ext = EXTENSIONS[contentType];
  if (!ext) throw new HttpError(400, 'Only image/jpeg and image/png photos are allowed');
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const key = `reports/${reportId}/${crypto.randomUUID()}.${ext}`;
  const uploadUrl = await sign(new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), UPLOAD_URL_SECONDS);
  return { uploadUrl, key, contentType, maxBytes: MAX_BYTES, expiresInSeconds: UPLOAD_URL_SECONDS };
}

// A PUT link cannot cap the file size, so we look at the real file before we record it.
// Wrong type or too big: the file is deleted and the request is refused.
async function verifyUploaded(key) {
  const { HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  let head;
  try {
    head = await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
  } catch (err) {
    if (err.name === 'NotFound' || (err.$metadata && err.$metadata.httpStatusCode === 404)) {
      throw new HttpError(400, 'No uploaded file found for this key (the upload link may have expired)');
    }
    throw err;
  }
  const size = head.ContentLength;
  const contentType = head.ContentType;
  if (!EXTENSIONS[contentType] || size > MAX_BYTES || size < 1) {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })).catch(() => {});
    throw new HttpError(400, 'Photo must be a JPEG or PNG of at most 5 MB');
  }
  return { size, contentType };
}

async function createViewUrl(key) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  return sign(new GetObjectCommand({ Bucket: bucket(), Key: key }), VIEW_URL_SECONDS);
}

module.exports = {
  createUploadUrl, verifyUploaded, createViewUrl,
  MAX_BYTES, VIEW_URL_SECONDS, UPLOAD_URL_SECONDS,
  _setClientForTests: (c) => { s3 = c; },
};