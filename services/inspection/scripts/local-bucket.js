// node --env-file=.env scripts/local-bucket.js
// Creates the photo bucket inside Floci (your laptop's fake S3). Never touches real AWS:
// it refuses to run unless AWS_ENDPOINT_URL points at your own computer.
const { S3Client, CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');

const endpoint = process.env.AWS_ENDPOINT_URL || '';
const bucket = process.env.PHOTO_BUCKET;

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(endpoint)) {
  console.error('Stopped: AWS_ENDPOINT_URL must be http://localhost:4566 (this script is for Floci only).');
  process.exit(1);
}
if (!bucket) {
  console.error('Stopped: PHOTO_BUCKET is not set in .env');
  process.exit(1);
}

(async () => {
  const s3 = new S3Client({ forcePathStyle: true });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`Bucket "${bucket}" already exists.`);
  } catch (err) {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Bucket "${bucket}" created in Floci.`);
  }
})().catch((err) => { console.error('Failed:', err.message); process.exit(1); });