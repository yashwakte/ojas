# MongoDB backup & restore

Ojas runs on Atlas's **Free (M0)** tier. M0 clusters are not eligible for Atlas's built-in
continuous cloud backups at all — that only becomes available from M10 upward (~$60+/month).
Left alone, this means **there is no way to recover the database** if it were ever lost or
corrupted. This is the manual safety net that exists in place of that, until the app outgrows the
free tier and the real thing becomes worth paying for.

## What actually happens

`.github/workflows/mongodb-backup.yml` runs on a daily schedule (20:30 UTC, off-peak for Ojas's
customer base) and can also be triggered on demand from the Actions tab (`workflow_dispatch`). Each
run:

1. Connects with a dedicated **read-only** Atlas user (`backup-reader`, `readAnyDatabase`), stored
   as the `MONGODB_BACKUP_URI` repo secret — never the API's own read/write connection string. A
   leaked backup credential should never be able to write or delete anything.
2. Runs `mongodump` to produce a single compressed archive of the whole `OjasDb` database.
3. **Restores that same archive into a throwaway MongoDB container inside the same CI run**, then
   checks a real document count came back out of the `users` collection. A "successful" dump of
   nothing, or an archive that turns out not to actually restore, would otherwise only be
   discovered the day someone needs it — so every backup proves itself the day it's taken, not
   just on the rare day it's needed.
4. Uploads the archive as a build artifact, kept for 30 days.

If either the dump or the restore-verification step fails, the workflow run fails loudly (visible
in the Actions tab and, if GitHub notifications are on, by email) rather than silently producing
nothing.

## Recovery point and retention

- **Recovery point objective: up to ~24 hours.** Backups are daily, so in the worst case a restore
  loses up to a day of orders/accounts/changes. There's no continuous/point-in-time recovery on
  this plan.
- **Retention: 30 days.** Older artifacts age out and are gone — this is a rolling window, not an
  archive. GitHub Actions artifacts aren't designed as long-term storage; this is a stopgap, not a
  permanent solution (see "Known limitations" below).

## How to actually restore

1. Go to the repo's **Actions** tab → **MongoDB Backup** → pick the run to restore from → download
   the `ojas-mongodb-backup-<run id>` artifact (a `.zip` containing `ojas-backup.archive`).
2. On a machine with [MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools)
   installed, unzip it and run:
   ```
   mongorestore --uri="<full read/write Atlas connection string>" --archive=ojas-backup.archive --gzip --drop
   ```
   `--drop` replaces existing collections with the backup's contents rather than merging — deliberate
   for a real recovery, but **never rehearse a restore with `--drop` against the real production URI**;
   rehearse against a scratch database or a temporary cluster instead, exactly like the CI job does.
3. Confirm the restored data looks right (spot-check a few recent orders/users) before considering
   the incident resolved.

There is currently no scripted one-command restore-to-production — this is a deliberately manual,
slow-down-and-look step, not something to automate further while it's still rare enough to warrant
a human actually checking each time.

## Known limitations

- **No true long-term retention.** 30 days of rolling backups, not an indefinite archive. If a bad
  change goes unnoticed for over a month, there's nothing to recover from.
- **Restoring into production is still a manual, hands-on step.** Deliberate for now, but worth
  revisiting if this ever needs to happen under time pressure.
- **The real fix is upgrading the Atlas cluster to M10+** once Ojas's revenue justifies it — that
  turns this whole workflow into "documentation for how self-service backups used to work" and
  replaces it with Atlas's actual continuous backup + point-in-time restore.
