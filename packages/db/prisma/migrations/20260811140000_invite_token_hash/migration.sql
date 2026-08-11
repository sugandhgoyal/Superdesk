-- Store invite tokens as SHA-256 hashes rather than plaintext.
--
-- Safe as a destructive change here because no invites have been issued yet.
-- Had there been live invites, the migration would have to add the column as
-- nullable, backfill by re-issuing links, and drop the old column separately.

DROP INDEX IF EXISTS "Invite_token_key";
ALTER TABLE "Invite" DROP COLUMN IF EXISTS "token";

ALTER TABLE "Invite" ADD COLUMN "tokenHash" TEXT NOT NULL;
ALTER TABLE "Invite" ADD COLUMN "revokedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");
