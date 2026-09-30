-- ----------------------------
-- 个人物品收纳模块建表脚本
-- 适配 MySQL 5.7 ~ 8.x，字符集与主库保持一致(utf8mb4)
-- 执行前请确认已 USE 到目标数据库
-- ----------------------------

SET NAMES utf8mb4;

-- ----------------------------
-- Table structure for storage_category
-- ----------------------------
DROP TABLE IF EXISTS `storage_category`;
CREATE TABLE `storage_category` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
    `name` varchar(50) NOT NULL COMMENT '分类名称',
    `icon` varchar(100) NULL COMMENT '分类图标标识',
    `color` varchar(20) NULL COMMENT '分类主题色(如 #4F7CFF)',
    `sort` smallint DEFAULT 0 COMMENT '显示顺序',
    `status` tinyint DEFAULT 1 COMMENT '状态(1-正常 0-禁用)',
    `remark` varchar(255) NULL COMMENT '备注',
    `owner_id` bigint NULL COMMENT '归属用户ID(NULL 表示公共分类)',
    `create_by` bigint NULL COMMENT '创建人ID',
    `create_time` datetime NULL COMMENT '创建时间',
    `update_by` bigint NULL COMMENT '修改人ID',
    `update_time` datetime NULL COMMENT '更新时间',
    `is_deleted` tinyint DEFAULT 0 COMMENT '逻辑删除标识(1-已删除 0-未删除)',
    PRIMARY KEY (`id`) USING BTREE,
    INDEX `idx_owner`(`owner_id` ASC, `is_deleted` ASC) USING BTREE COMMENT '按用户查询索引'
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COMMENT = '收纳分类表';

-- ----------------------------
-- Table structure for storage_tag
-- ----------------------------
DROP TABLE IF EXISTS `storage_tag`;
CREATE TABLE `storage_tag` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
    `name` varchar(50) NOT NULL COMMENT '标签名称',
    `color` varchar(20) NULL COMMENT '标签颜色(如 #FF7A45)',
    `owner_id` bigint NULL COMMENT '归属用户ID(NULL 表示公共标签)',
    `create_by` bigint NULL COMMENT '创建人ID',
    `create_time` datetime NULL COMMENT '创建时间',
    `update_by` bigint NULL COMMENT '修改人ID',
    `update_time` datetime NULL COMMENT '更新时间',
    `is_deleted` tinyint DEFAULT 0 COMMENT '逻辑删除标识(1-已删除 0-未删除)',
    PRIMARY KEY (`id`) USING BTREE,
    INDEX `idx_owner`(`owner_id` ASC, `is_deleted` ASC) USING BTREE COMMENT '按用户查询索引',
    UNIQUE INDEX `uk_owner_name`(`owner_id` ASC, `name` ASC) USING BTREE COMMENT '同一用户下标签名唯一'
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COMMENT = '收纳标签表';

-- ----------------------------
-- Table structure for storage_item
-- ----------------------------
DROP TABLE IF EXISTS `storage_item`;
CREATE TABLE `storage_item` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
    `name` varchar(100) NOT NULL COMMENT '物品名称',
    `category_id` bigint NULL COMMENT '所属分类ID',
    `cover_url` varchar(500) NULL COMMENT '封面图URL',
    `image_urls` json NULL COMMENT '图片URL列表',
    `quantity` int DEFAULT 1 COMMENT '数量',
    `unit` varchar(20) NULL COMMENT '单位(个/件/盒...)',
    `price` decimal(12, 2) NULL COMMENT '单价',
    `purchase_date` date NULL COMMENT '购置日期',
    `expire_date` date NULL COMMENT '过期日期',
    `location` varchar(200) NULL COMMENT '存放位置描述',
    `remark` text NULL COMMENT '备注',
    `status` tinyint DEFAULT 1 COMMENT '状态(1-在库 0-已归档)',
    `owner_id` bigint NOT NULL COMMENT '归属用户ID',
    `create_by` bigint NULL COMMENT '创建人ID',
    `create_time` datetime NULL COMMENT '创建时间',
    `update_by` bigint NULL COMMENT '修改人ID',
    `update_time` datetime NULL COMMENT '更新时间',
    `is_deleted` tinyint DEFAULT 0 COMMENT '逻辑删除标识(1-已删除 0-未删除)',
    PRIMARY KEY (`id`) USING BTREE,
    INDEX `idx_owner_status`(`owner_id` ASC, `status` ASC, `is_deleted` ASC) USING BTREE COMMENT '列表主查询索引',
    INDEX `idx_category`(`category_id` ASC) USING BTREE COMMENT '分类筛选索引',
    INDEX `idx_name`(`name` ASC) USING BTREE COMMENT '名称检索索引'
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COMMENT = '收纳物品表';

-- ----------------------------
-- Table structure for storage_item_tag
-- ----------------------------
DROP TABLE IF EXISTS `storage_item_tag`;
CREATE TABLE `storage_item_tag` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
    `item_id` bigint NOT NULL COMMENT '物品ID',
    `tag_id` bigint NOT NULL COMMENT '标签ID',
    `create_by` bigint NULL COMMENT '创建人ID',
    `create_time` datetime NULL COMMENT '创建时间',
    `update_by` bigint NULL COMMENT '修改人ID',
    `update_time` datetime NULL COMMENT '更新时间',
    `is_deleted` tinyint DEFAULT 0 COMMENT '逻辑删除标识(1-已删除 0-未删除)',
    PRIMARY KEY (`id`) USING BTREE,
    UNIQUE INDEX `uk_item_tag`(`item_id` ASC, `tag_id` ASC) USING BTREE COMMENT '物品标签唯一索引',
    INDEX `idx_tag`(`tag_id` ASC, `is_deleted` ASC) USING BTREE COMMENT '按标签反查索引'
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COMMENT = '物品标签关联表';

-- ----------------------------
-- 初始化：公共分类（owner_id 为 NULL，所有用户可见）
-- ----------------------------
INSERT INTO `storage_category` (`name`, `icon`, `color`, `sort`, `status`, `remark`, `owner_id`, `create_time`, `create_by`, `is_deleted`)
VALUES
('电子产品', 'devices', '#4F7CFF', 1, 1, '手机、电脑、数码配件等', NULL, now(), 1, 0),
('服饰鞋包', 'checkroom', '#FF7A45', 2, 1, '衣物、鞋帽、箱包', NULL, now(), 1, 0),
('图书文具', 'menu_book', '#36CFC9', 3, 1, '书籍、笔记、办公文具', NULL, now(), 1, 0),
('食品饮料', 'restaurant', '#F759AB', 4, 1, '零食、饮品的保质期管理', NULL, now(), 1, 0),
('医药保健', 'medical_services', '#FF4D4F', 5, 1, '药品、保健品', NULL, now(), 1, 0),
('家居日用', 'home', '#52C41A', 6, 1, '生活用品、清洁用品', NULL, now(), 1, 0),
('工具五金', 'handyman', '#8C8C8C', 7, 1, '维修工具、五金配件', NULL, now(), 1, 0),
('其他', 'more_horiz', '#BFBFBF', 99, 1, '未分类物品', NULL, now(), 1, 0);

-- ----------------------------
-- 初始化：公共标签
-- ----------------------------
INSERT INTO `storage_tag` (`name`, `color`, `owner_id`, `create_time`, `create_by`, `is_deleted`)
VALUES
('常用', '#4F7CFF', NULL, now(), 1, 0),
('备用', '#52C41A', NULL, now(), 1, 0),
('易碎', '#FAAD14', NULL, now(), 1, 0),
('贵重', '#FF4D4F', NULL, now(), 1, 0),
('待处理', '#8C8C8C', NULL, now(), 1, 0);
