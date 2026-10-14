/**
 * PeluVida OS 根 commitlint 配置（CROSS-03 Conventional Commits）
 *
 * 规范要点：
 * - 类型枚举：feat/fix/docs/style/refactor/perf/test/build/ci/revert/chore
 *   （CROSS-03 任务列举 8 类 + Conventional 标准的 style/build/revert；不保留 wip——临时提交不进库）
 * - 描述（subject）：中文祈使句，≤50 字（subject-max-length 强制；祈使句为约定，cz prompt 引导）
 * - header 总长 ≤100 字符
 *
 * 校验入口：.husky/commit-msg（pnpm exec commitlint --edit）
 */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat", // 新增功能
        "fix", // 修复缺陷
        "docs", // 文档变更
        "style", // 代码格式（不影响功能的格式修正）
        "refactor", // 代码重构（不含 bug 修复、功能新增）
        "perf", // 性能优化
        "test", // 测试新增或改动
        "build", // 构建流程、外部依赖变更
        "ci", // CI 配置、脚本
        "revert", // 回滚 commit
        "chore", // 构建过程或辅助工具变更
      ],
    ],
    "type-empty": [2, "never"],
    "subject-empty": [2, "never"],
    // 中文描述不受英文大小写规则约束
    "subject-case": [0],
    // CROSS-03：中文祈使句 ≤50 字
    "subject-max-length": [2, "always", 50],
    "header-max-length": [2, "always", 100],
    // 描述结尾不允许句号（中英文一视同仁的约定按默认英文句号强制；中文句号靠约定）
    "subject-full-stop": [2, "never", "."],
  },
  // cz-git 交互式提示（pnpm commit）——祈使句约定在此引导
  prompt: {
    messages: {
      type: "选择你要提交的类型:",
      scope: "选择一个提交范围（可选）:",
      customScope: "请输入自定义的提交范围:",
      subject: "填写简短精炼的变更描述（中文祈使句，≤50 字）:\n",
      body: "填写更加详细的变更描述（可选）。使用 \"|\" 换行:\n",
      breaking: "列举非兼容性重大的变更（可选）。使用 \"|\" 换行:\n",
      footerPrefixesSelect: "选择关联 issue 前缀（可选）:",
      footer: "列举关联 issue (可选) 例如: #31:\n",
      confirmCommit: "是否提交或修改 commit?",
    },
    types: [
      { value: "feat", name: "特性:     ✨  新增功能" },
      { value: "fix", name: "修复:     🐛  修复缺陷" },
      { value: "docs", name: "文档:     📝  文档变更" },
      { value: "style", name: "格式:     🌈  代码格式（空格、分号等）" },
      { value: "refactor", name: "重构:     🔄  代码重构" },
      { value: "perf", name: "性能:     🚀  性能优化" },
      { value: "test", name: "测试:     🧪  测试新增或改动" },
      { value: "build", name: "构建:     📦️  构建流程、依赖变更" },
      { value: "ci", name: "集成:     ⚙️   CI 配置、脚本" },
      { value: "revert", name: "回退:     ↩️   回滚 commit" },
      { value: "chore", name: "其他:     🛠️   辅助工具与库变更" },
    ],
    useEmoji: false,
    allowCustomScopes: true,
    allowEmptyScopes: true,
    upperCaseSubject: false,
    allowBreakingChanges: ["feat", "fix"],
    skipQuestions: ["body", "breaking", "footer", "footerPrefixes"],
    maxSubjectLength: 50,
    minSubjectLength: 0,
  },
};
