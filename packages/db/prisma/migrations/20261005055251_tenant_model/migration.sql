-- CreateTable
CREATE TABLE "tenant" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "plan" VARCHAR(16) NOT NULL DEFAULT 'starter',
    "feature_flags" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_code_key" ON "tenant"("code");
