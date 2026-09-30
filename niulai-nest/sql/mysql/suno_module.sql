-- ----------------------------
-- Suno 音乐模块建表脚本
-- 适配 MySQL 5.7 ~ 8.x，字符集与主库保持一致(utf8mb4)
-- 执行前请确认已 USE 到目标数据库
--
-- 设计要点：
--   1. 本模块为「独立业务域」，与系统管理菜单完全隔离；
--   2. 通过独立的 SUNO 角色 + 专属菜单实现可见性隔离，
--      该角色账号登录后侧边栏只出现 Suno 相关菜单；
--   3. access_key 由后端代理转发，前端不接触密钥，
--      密钥密文存放在 suno_config，可后台维护。
-- ----------------------------

SET NAMES utf8mb4;

-- ----------------------------
-- Table structure for suno_config
-- ----------------------------
DROP TABLE IF EXISTS `suno_config`;
CREATE TABLE `suno_config` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
    `config_name` varchar(64) NOT NULL COMMENT '配置名称',
    `config_key` varchar(64) NOT NULL COMMENT '配置键(如 SUNO_ACCESS_KEY)',
    `config_value` varchar(512) NULL COMMENT '配置值(密钥以 AES 密文存储)',
    `base_url` varchar(255) NULL COMMENT '接口基础地址',
    `remark` varchar(255) NULL COMMENT '备注',
    `status` tinyint DEFAULT 1 COMMENT '状态(1-启用 0-停用)',
    `create_by` bigint NULL COMMENT '创建人ID',
    `create_time` datetime NULL COMMENT '创建时间',
    `update_by` bigint NULL COMMENT '修改人ID',
    `update_time` datetime NULL COMMENT '更新时间',
    `is_deleted` tinyint DEFAULT 0 COMMENT '逻辑删除标识(1-已删除 0-未删除)',
    PRIMARY KEY (`id`) USING BTREE,
    UNIQUE INDEX `uk_config_key`(`config_key` ASC) USING BTREE COMMENT '配置键唯一'
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COMMENT = 'Suno 接入配置表';

-- ----------------------------
-- Table structure for suno_task
-- 说明：一次「提交」= 一条任务；Suno 每次返回 2 个 task_id，
--       因此一条业务任务对应若干条 suno_task 明细(batch_no 相同)。
-- ----------------------------
DROP TABLE IF EXISTS `suno_task`;
CREATE TABLE `suno_task` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
    `batch_no` varchar(40) NOT NULL COMMENT '提交批次号(同一次提交共享)',
    `task_id` bigint NULL COMMENT 'Suno 平台任务ID(数字，用于轮询)',
    `custom_id` varchar(64) NULL COMMENT 'Suno 音乐ID(UUID，用于延长/翻唱/后期)',
    `parent_custom_id` varchar(64) NULL COMMENT '来源音乐ID(延长/翻唱/上传时记录)',
    `task_type` varchar(32) NOT NULL COMMENT '任务类型(generate/sound/extend/cover/upload/whole-song/aligned-lyrics/upsample/video/download-wav/download-mp3/download-m4a/crop/speed)',
    `biz_category` varchar(16) DEFAULT 'music' COMMENT '业务分类(music-音乐 sound-音效 post-后期处理)',
    `title` varchar(255) NULL COMMENT '作品标题',
    `prompt` text NULL COMMENT '歌词/提示词',
    `tags` varchar(512) NULL COMMENT '风格标签',
    `mv` varchar(64) NULL COMMENT '模型版本(chirp-hawk / chirp-hawk-wild / chirp-goose 等)',
    `gpt_description_prompt` text NULL COMMENT '灵感模式描述',
    `make_instrumental` tinyint DEFAULT 0 COMMENT '是否纯音乐(1-是 0-否)',
    `is_max_mode` tinyint DEFAULT 0 COMMENT '是否 MAX 模式(消耗双倍积分)',
    `aug_creativity` tinyint NULL COMMENT '创意度 0-4',
    `request_params` json NULL COMMENT '完整请求参数快照',
    `status` varchar(20) DEFAULT 'pending' COMMENT '任务状态(pending/processing/completed/failed)',
    `errormsg` varchar(512) NULL COMMENT '失败原因',
    `points_refunded` tinyint DEFAULT 0 COMMENT '积分是否已退还(1-是 0-否)',
    `owner_id` bigint NOT NULL COMMENT '归属用户ID(数据隔离边界)',
    `create_by` bigint NULL COMMENT '创建人ID',
    `create_time` datetime NULL COMMENT '创建时间',
    `update_by` bigint NULL COMMENT '修改人ID',
    `update_time` datetime NULL COMMENT '更新时间',
    `is_deleted` tinyint DEFAULT 0 COMMENT '逻辑删除标识(1-已删除 0-未删除)',
    PRIMARY KEY (`id`) USING BTREE,
    UNIQUE INDEX `uk_task_id`(`task_id` ASC) USING BTREE COMMENT '平台任务ID唯一',
    INDEX `idx_owner_status`(`owner_id` ASC, `status` ASC, `is_deleted` ASC) USING BTREE COMMENT '按用户+状态查询',
    INDEX `idx_batch`(`batch_no` ASC) USING BTREE COMMENT '按批次查询',
    INDEX `idx_custom`(`custom_id` ASC) USING BTREE COMMENT '按音乐ID查询'
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COMMENT = 'Suno 任务表';

-- ----------------------------
-- Table structure for suno_asset
-- 说明：任务 completed 后落库的作品资产，是「我的作品库」的数据源。
-- ----------------------------
DROP TABLE IF EXISTS `suno_asset`;
CREATE TABLE `suno_asset` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
    `task_pk` bigint NULL COMMENT '关联 suno_task 主键ID',
    `custom_id` varchar(64) NOT NULL COMMENT 'Suno 音乐ID(UUID)',
    `title` varchar(255) NULL COMMENT '作品标题',
    `image_url` varchar(500) NULL COMMENT '封面图地址',
    `audio_url` varchar(500) NULL COMMENT '音频地址(mp3Url)',
    `video_url` varchar(500) NULL COMMENT 'MV 视频地址',
    `duration` int DEFAULT 0 COMMENT '音频时长(秒)',
    `tags` varchar(512) NULL COMMENT '风格标签',
    `lyrics` text NULL COMMENT '歌词',
    `mv` varchar(64) NULL COMMENT '生成模型版本',
    `asset_type` varchar(16) DEFAULT 'music' COMMENT '资产类型(music-音乐 sound-音效 video-MV)',
    `is_instrumental` tinyint DEFAULT 0 COMMENT '是否纯音乐',
    `is_liked` tinyint DEFAULT 0 COMMENT '是否收藏(1-是 0-否)',
    `owner_id` bigint NOT NULL COMMENT '归属用户ID(数据隔离边界)',
    `create_by` bigint NULL COMMENT '创建人ID',
    `create_time` datetime NULL COMMENT '创建时间',
    `update_by` bigint NULL COMMENT '修改人ID',
    `update_time` datetime NULL COMMENT '更新时间',
    `is_deleted` tinyint DEFAULT 0 COMMENT '逻辑删除标识(1-已删除 0-未删除)',
    PRIMARY KEY (`id`) USING BTREE,
    UNIQUE INDEX `uk_owner_custom`(`owner_id` ASC, `custom_id` ASC) USING BTREE COMMENT '同一用户下音乐ID唯一',
    INDEX `idx_owner`(`owner_id` ASC, `is_deleted` ASC, `create_time` ASC) USING BTREE COMMENT '按用户查询'
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COMMENT = 'Suno 作品资产表';

-- ----------------------------
-- Table structure for suno_points_log
-- 说明：本地记录每次调用的积分流水，便于成本核算与对账。
-- ----------------------------
DROP TABLE IF EXISTS `suno_points_log`;
CREATE TABLE `suno_points_log` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
    `owner_id` bigint NOT NULL COMMENT '归属用户ID',
    `biz_id` varchar(64) NULL COMMENT '关联业务ID(批次号/任务ID)',
    `biz_type` varchar(32) NULL COMMENT '业务类型(与 task_type 对齐)',
    `points` int DEFAULT 0 COMMENT '变动积分数(消耗为正数)',
    `change_type` tinyint DEFAULT 1 COMMENT '变动类型(1-消耗 2-充值 3-手动调整 4-退还)',
    `balance` int NULL COMMENT '变动后平台余额快照',
    `remark` varchar(255) NULL COMMENT '备注',
    `create_by` bigint NULL COMMENT '创建人ID',
    `create_time` datetime NULL COMMENT '创建时间',
    `update_by` bigint NULL COMMENT '修改人ID',
    `update_time` datetime NULL COMMENT '更新时间',
    `is_deleted` tinyint DEFAULT 0 COMMENT '逻辑删除标识(1-已删除 0-未删除)',
    PRIMARY KEY (`id`) USING BTREE,
    INDEX `idx_owner`(`owner_id` ASC, `is_deleted` ASC) USING BTREE COMMENT '按用户查询'
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COMMENT = 'Suno 积分流水表';

-- ----------------------------
-- 初始化：接入配置(密钥请自行替换为密文或明文，后端支持自动解密)
-- ----------------------------
INSERT INTO `suno_config` (`config_name`, `config_key`, `config_value`, `base_url`, `remark`, `status`, `create_time`, `is_deleted`)
VALUES ('Suno 接入密钥', 'SUNO_ACCESS_KEY', 'your-access-key-here', 'https://open.suno.cn', '商户后台创建的 API 密钥', 1, now(), 0);

-- ----------------------------
-- 初始化：字典数据
-- ----------------------------
INSERT INTO `sys_dict` (`id`, `dict_code`, `name`, `status`, `remark`, `create_time`, `is_deleted`)
VALUES (100, 'suno_task_type', 'Suno任务类型', 0, 'Suno 任务类型', now(), 0),
       (101, 'suno_task_status', 'Suno任务状态', 0, 'Suno 任务状态', now(), 0),
       (102, 'suno_model', 'Suno模型版本', 0, 'Suno 生成模型版本', now(), 0);

INSERT INTO `sys_dict_item` (`id`, `dict_code`, `value`, `label`, `status`, `sort`, `create_time`)
VALUES
  -- 任务类型
  (1001, 'suno_task_type', 'generate', '生成音乐', 1, 1, now()),
  (1002, 'suno_task_type', 'sound', '生成音效', 2, 1, now()),
  (1003, 'suno_task_type', 'extend', '延长', 3, 1, now()),
  (1004, 'suno_task_type', 'cover', '翻唱', 4, 1, now()),
  (1005, 'suno_task_type', 'upload', '上传参考', 5, 1, now()),
  (1006, 'suno_task_type', 'whole-song', '合成整首', 6, 1, now()),
  (1007, 'suno_task_type', 'aligned-lyrics', '歌词对齐', 7, 1, now()),
  (1008, 'suno_task_type', 'upsample', 'Remaster', 8, 1, now()),
  (1009, 'suno_task_type', 'video', '生成MV', 9, 1, now()),
  (1010, 'suno_task_type', 'download-wav', '转WAV', 10, 1, now()),
  (1011, 'suno_task_type', 'download-mp3', '转MP3', 11, 1, now()),
  (1012, 'suno_task_type', 'download-m4a', '转M4A', 12, 1, now()),
  (1013, 'suno_task_type', 'crop', '裁剪', 13, 1, now()),
  (1014, 'suno_task_type', 'speed', '变速', 14, 1, now()),
  -- 任务状态
  (1021, 'suno_task_status', 'pending', '排队中', 1, 1, now()),
  (1022, 'suno_task_status', 'processing', '生成中', 2, 1, now()),
  (1023, 'suno_task_status', 'completed', '已完成', 3, 1, now()),
  (1024, 'suno_task_status', 'failed', '已失败', 4, 1, now()),
  -- 模型版本
  (1041, 'suno_model', 'chirp-hawk', 'Suno V6', 1, 1, now()),
  (1042, 'suno_model', 'chirp-hawk-wild', 'Suno V6-wild', 2, 1, now()),
  (1043, 'suno_model', 'chirp-goose', 'Suno V6-mini', 3, 1, now()),
  (1044, 'suno_model', 'chirp-crow', '音效模型', 4, 1, now()),
  (1045, 'suno_model', 'chirp-fenix', '音效模型Plus', 5, 1, now());

-- ----------------------------
-- 初始化：Suno 独立角色与专属账号
-- 账号：suno / 123456（与系统默认密码哈希一致，登录后请立即修改）
-- ----------------------------
INSERT INTO `sys_role` (`id`, `name`, `code`, `sort`, `status`, `data_scope`, `create_time`, `is_deleted`)
VALUES (100, 'Suno 音乐员', 'SUNO', 100, 1, 4, now(), 0);

INSERT INTO `sys_user` (`id`, `username`, `nickname`, `gender`, `password`, `avatar`, `mobile`, `status`, `email`, `create_time`, `is_deleted`)
VALUES (100, 'suno', 'Suno 音乐员', 1, '$2a$10$xVWsNOhHrCxh5UbpCE7/HuJ.PAOKcYAqRxD2CO2nVnJS.IAXkr5aq', NULL, NULL, 1, NULL, now(), 0);

INSERT INTO `sys_user_role` (`user_id`, `role_id`) VALUES (100, 100);

-- ----------------------------
-- 初始化：Suno 专属菜单(仅分配给 SUNO 角色，实现「只展示该内容」)
-- 目录 200 → 菜单 201/202/203/204
-- ----------------------------
INSERT INTO `sys_menu` (`id`, `parent_id`, `tree_path`, `name`, `type`, `route_name`, `route_path`, `component`, `perm`, `always_show`, `keep_alive`, `visible`, `sort`, `icon`, `redirect`)
VALUES
  (200, 0,   '200',   'Suno 音乐', 'C', NULL,            '/suno',    'Layout',            NULL, 1, 0, 1, 1, 'microphone', '/suno/studio'),
  (201, 200, '200,200', '创作台',   'M', 'SunoStudio',   'studio',   'suno/studio/index', 'suno:studio:use',  0, 1, 1, 1, 'magic-stick', NULL),
  (202, 200, '200,200', '任务中心', 'M', 'SunoTask',     'task',     'suno/task/index',   'suno:task:list',   0, 1, 1, 2, 'list',        NULL),
  (203, 200, '200,200', '我的作品', 'M', 'SunoAsset',    'asset',    'suno/asset/index',  'suno:asset:list',  0, 1, 1, 3, 'headset',     NULL),
  (204, 200, '200,200', '接入配置', 'M', 'SunoConfig',   'config',   'suno/config/index', 'suno:config:update', 0, 1, 1, 4, 'setting',   NULL);

-- 按钮权限
INSERT INTO `sys_menu` (`id`, `parent_id`, `tree_path`, `name`, `type`, `perm`, `always_show`, `keep_alive`, `visible`, `sort`)
VALUES
  (20101, 201, '200,200,201', '生成音乐', 'B', 'suno:music:generate', 0, 0, 1, 1),
  (20102, 201, '200,200,201', '生成音效', 'B', 'suno:sound:generate', 0, 0, 1, 2),
  (20103, 201, '200,200,201', '上传参考', 'B', 'suno:music:upload',   0, 0, 1, 3),
  (20201, 202, '200,200,202', '查询任务', 'B', 'suno:task:query',     0, 0, 1, 1),
  (20202, 202, '200,200,202', '删除任务', 'B', 'suno:task:delete',    0, 0, 1, 2),
  (20301, 203, '200,200,203', '后期处理', 'B', 'suno:asset:post',     0, 0, 1, 1),
  (20302, 203, '200,200,203', '收藏作品', 'B', 'suno:asset:like',     0, 0, 1, 2),
  (20303, 203, '200,200,203', '删除作品', 'B', 'suno:asset:delete',   0, 0, 1, 3);

-- 角色-菜单关联：SUNO 角色仅绑定 Suno 目录及其子节点
INSERT INTO `sys_role_menu` (`role_id`, `menu_id`)
VALUES
  (100, 200), (100, 201), (100, 202), (100, 203), (100, 204),
  (100, 20101), (100, 20102), (100, 20103),
  (100, 20201), (100, 20202),
  (100, 20301), (100, 20302), (100, 20303);
