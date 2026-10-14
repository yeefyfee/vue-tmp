-- CreateTable
CREATE TABLE "sys_dept" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "parent_id" BIGINT DEFAULT 0,
    "tree_path" VARCHAR(255) NOT NULL,
    "sort" SMALLINT NOT NULL DEFAULT 0,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "create_by" BIGINT,
    "create_time" TIMESTAMPTZ(3),
    "update_by" BIGINT,
    "update_time" TIMESTAMPTZ(3),
    "is_deleted" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "sys_dept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_user" (
    "id" BIGSERIAL NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "nickname" VARCHAR(64) NOT NULL,
    "gender" SMALLINT NOT NULL DEFAULT 1,
    "password" VARCHAR(100) NOT NULL,
    "dept_id" BIGINT,
    "avatar" VARCHAR(255),
    "mobile" VARCHAR(20),
    "status" SMALLINT NOT NULL DEFAULT 1,
    "email" VARCHAR(128),
    "create_by" BIGINT,
    "create_time" TIMESTAMPTZ(3),
    "update_by" BIGINT,
    "update_time" TIMESTAMPTZ(3),
    "is_deleted" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "sys_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_user_role" (
    "user_id" BIGINT NOT NULL,
    "role_id" BIGINT NOT NULL,

    CONSTRAINT "sys_user_role_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "sys_user_social" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "openid" VARCHAR(64) NOT NULL,
    "unionid" VARCHAR(64),
    "nickname" VARCHAR(64),
    "avatar" VARCHAR(255),
    "session_key" VARCHAR(128),
    "verified" SMALLINT NOT NULL DEFAULT 1,
    "create_by" BIGINT,
    "create_time" TIMESTAMPTZ(3),
    "update_by" BIGINT,
    "update_time" TIMESTAMPTZ(3),
    "is_deleted" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "sys_user_social_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_role" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "sort" INTEGER,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "data_scope" SMALLINT,
    "create_by" BIGINT,
    "create_time" TIMESTAMPTZ(3),
    "update_by" BIGINT,
    "update_time" TIMESTAMPTZ(3),
    "is_deleted" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "sys_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_role_menu" (
    "role_id" BIGINT NOT NULL,
    "menu_id" BIGINT NOT NULL,

    CONSTRAINT "sys_role_menu_pkey" PRIMARY KEY ("role_id","menu_id")
);

-- CreateTable
CREATE TABLE "sys_role_dept" (
    "role_id" BIGINT NOT NULL,
    "dept_id" BIGINT NOT NULL,

    CONSTRAINT "sys_role_dept_pkey" PRIMARY KEY ("role_id","dept_id")
);

-- CreateTable
CREATE TABLE "sys_menu" (
    "id" BIGSERIAL NOT NULL,
    "parent_id" BIGINT NOT NULL,
    "tree_path" VARCHAR(255),
    "name" VARCHAR(64) NOT NULL,
    "type" CHAR(1) NOT NULL,
    "route_name" VARCHAR(255),
    "route_path" VARCHAR(128),
    "component" VARCHAR(128),
    "perm" VARCHAR(128),
    "always_show" SMALLINT DEFAULT 0,
    "keep_alive" SMALLINT DEFAULT 0,
    "visible" SMALLINT NOT NULL DEFAULT 1,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "icon" VARCHAR(64),
    "redirect" VARCHAR(128),
    "params" JSONB,
    "create_time" TIMESTAMPTZ(3),
    "update_time" TIMESTAMPTZ(3),

    CONSTRAINT "sys_menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_dict" (
    "id" BIGSERIAL NOT NULL,
    "dict_code" VARCHAR(50),
    "name" VARCHAR(50),
    "status" SMALLINT NOT NULL DEFAULT 0,
    "remark" VARCHAR(255),
    "create_by" BIGINT,
    "create_time" TIMESTAMPTZ(3),
    "update_by" BIGINT,
    "update_time" TIMESTAMPTZ(3),
    "is_deleted" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "sys_dict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_dict_item" (
    "id" BIGSERIAL NOT NULL,
    "dict_code" VARCHAR(64) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "value" VARCHAR(50) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "tag_type" VARCHAR(50),
    "remark" VARCHAR(255),
    "create_by" BIGINT,
    "create_time" TIMESTAMPTZ(3),
    "update_by" BIGINT,
    "update_time" TIMESTAMPTZ(3),

    CONSTRAINT "sys_dict_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_config" (
    "id" BIGSERIAL NOT NULL,
    "config_name" VARCHAR(50) NOT NULL,
    "config_key" VARCHAR(50) NOT NULL,
    "config_value" VARCHAR(500) NOT NULL,
    "remark" VARCHAR(500),
    "create_by" BIGINT,
    "create_time" TIMESTAMPTZ(3),
    "update_by" BIGINT,
    "update_time" TIMESTAMPTZ(3),
    "is_deleted" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "sys_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_log" (
    "id" BIGSERIAL NOT NULL,
    "module" SMALLINT NOT NULL,
    "action_type" SMALLINT NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "content" TEXT,
    "operator_id" BIGINT,
    "operator_name" VARCHAR(50),
    "request_uri" VARCHAR(255),
    "request_method" VARCHAR(10),
    "ip" VARCHAR(45),
    "province" VARCHAR(100),
    "city" VARCHAR(100),
    "device" VARCHAR(100),
    "os" VARCHAR(100),
    "browser" VARCHAR(100),
    "status" SMALLINT DEFAULT 1,
    "error_msg" VARCHAR(255),
    "execution_time" INTEGER,
    "create_time" TIMESTAMPTZ(3),

    CONSTRAINT "sys_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gen_table" (
    "id" BIGSERIAL NOT NULL,
    "table_name" VARCHAR(100) NOT NULL,
    "module_name" VARCHAR(100),
    "package_name" VARCHAR(255) NOT NULL,
    "business_name" VARCHAR(100) NOT NULL,
    "entity_name" VARCHAR(100) NOT NULL,
    "author" VARCHAR(50) NOT NULL,
    "parent_menu_id" BIGINT,
    "remove_table_prefix" VARCHAR(20),
    "page_type" VARCHAR(20),
    "create_time" TIMESTAMPTZ(3),
    "update_time" TIMESTAMPTZ(3),
    "is_deleted" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "gen_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gen_table_column" (
    "id" BIGSERIAL NOT NULL,
    "table_id" BIGINT NOT NULL,
    "column_name" VARCHAR(100),
    "column_type" VARCHAR(50),
    "column_length" INTEGER,
    "field_name" VARCHAR(100) NOT NULL,
    "field_type" VARCHAR(100),
    "field_sort" INTEGER,
    "field_comment" VARCHAR(255),
    "max_length" INTEGER,
    "is_required" SMALLINT,
    "is_show_in_list" SMALLINT DEFAULT 0,
    "is_show_in_form" SMALLINT DEFAULT 0,
    "is_show_in_query" SMALLINT DEFAULT 0,
    "query_type" SMALLINT,
    "form_type" SMALLINT,
    "dict_type" VARCHAR(50),
    "create_time" TIMESTAMPTZ(3),
    "update_time" TIMESTAMPTZ(3),

    CONSTRAINT "gen_table_column_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sys_dept_code_key" ON "sys_dept"("code");

-- CreateIndex
CREATE INDEX "idx_user_id" ON "sys_user_social"("user_id");

-- CreateIndex
CREATE INDEX "idx_unionid" ON "sys_user_social"("unionid");

-- CreateIndex
CREATE UNIQUE INDEX "uk_platform_openid" ON "sys_user_social"("platform", "openid");

-- CreateIndex
CREATE UNIQUE INDEX "sys_role_name_key" ON "sys_role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sys_role_code_key" ON "sys_role"("code");

-- CreateIndex
CREATE INDEX "idx_dict_code" ON "sys_dict"("dict_code");

-- CreateIndex
CREATE INDEX "idx_module_action_time" ON "sys_log"("module", "action_type", "create_time");

-- CreateIndex
CREATE INDEX "idx_operator_time" ON "sys_log"("operator_id", "create_time");

-- CreateIndex
CREATE INDEX "idx_time" ON "sys_log"("create_time");

-- CreateIndex
CREATE UNIQUE INDEX "gen_table_table_name_key" ON "gen_table"("table_name");

-- CreateIndex
CREATE INDEX "idx_table_id" ON "gen_table_column"("table_id");
