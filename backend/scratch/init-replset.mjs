import mongoose from 'mongoose';

try {
  await mongoose.connect('mongodb://127.0.0.1:27019/?directConnection=true', {
    serverSelectionTimeoutMS: 5000,
  });
  const result = await mongoose.connection.db.command({
    replSetInitiate: {
      _id: 'rs0',
      members: [{ _id: 0, host: '127.0.0.1:27019' }],
    },
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ name: error?.name, message: error?.message, code: error?.code }, null, 2));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
