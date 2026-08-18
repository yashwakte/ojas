import { MongoClient, ObjectId } from 'mongodb';

/**
 * Direct database access for the few things the API deliberately offers no endpoint for.
 *
 * Specifically: promoting a freshly registered account to admin. There is no "make me an admin"
 * endpoint by design (bootstrap-admin permanently disables itself once one exists), so a test
 * that needs an admin session has to reach past the API. Everything else in these specs goes
 * through the UI like a real user.
 *
 * Set OJAS_E2E_MONGO_URL to the same connection string the API uses. Specs that need this skip
 * themselves when it's absent, rather than failing, so the rest of the suite still runs.
 */
export const MONGO_URL = process.env.OJAS_E2E_MONGO_URL ?? '';
const DB_NAME = process.env.OJAS_E2E_MONGO_DB ?? 'OjasDb';

export async function withDb<T>(work: (db: ReturnType<MongoClient['db']>) => Promise<T>): Promise<T> {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    return await work(client.db(DB_NAME));
  } finally {
    await client.close();
  }
}

export async function promoteToAdmin(email: string): Promise<void> {
  await withDb(async (db) => {
    await db.collection('users').updateOne({ email: email.toLowerCase() }, { $set: { role: 'admin' } });
  });
}

/**
 * Removes the accounts a spec created along with everything hanging off them - device bindings,
 * invites and refresh tokens - so repeated runs don't accumulate junk in a shared dev database.
 */
export async function deleteUsersByEmail(emails: string[]): Promise<void> {
  await withDb(async (db) => {
    const lowered = emails.map((e) => e.toLowerCase());
    const users = await db.collection('users').find({ email: { $in: lowered } }).toArray();
    const ids = users.map((u) => (u._id as ObjectId).toHexString());

    if (ids.length > 0) {
      await db.collection('staff_devices').deleteMany({ userId: { $in: ids } });
      await db.collection('staff_invites').deleteMany({ userId: { $in: ids } });
      await db.collection('refresh_tokens').deleteMany({ userId: { $in: ids } });
    }
    await db.collection('users').deleteMany({ email: { $in: lowered } });
  });
}
