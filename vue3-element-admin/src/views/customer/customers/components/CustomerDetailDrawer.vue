<template>
  <el-drawer
    v-model="visible"
    :title="t('customer.detail.title')"
    :size="drawerSize"
    :close-on-click-modal="false"
    destroy-on-close
    class="customer-detail"
    @closed="handleClosed"
  >
    <div v-loading="detailLoading" class="customer-detail__body">
      <DataState
        v-if="detailError"
        variant="error"
        :title="t('customer.detail.errorTitle')"
        :description="detailError"
        :action-text="t('customer.detail.retry')"
        @action="loadDetail"
      />

      <template v-else-if="detail">
        <!-- 宠主卡（PRD《页面功能》§客户详情页：「头部为宠主卡」；
             会员等级 / 累计消费 / 标签依赖 Order / Membership 模型，
             P0 阶段未建模 ⇒ 按《Web规范》§权限与视图 1「无权限字段直接不渲染」不渲染，
             而非渲染 0 值） -->
        <div class="customer-detail__card">
          <div class="customer-detail__card-row">
            <span class="customer-detail__name">{{ detail.name }}</span>
            <el-tag :type="lifecycleTagType(detail.lifecycle)" size="small">
              {{ lifecycleLabel(detail.lifecycle) }}
            </el-tag>
            <el-tag v-if="hasActiveBlacklist" type="danger" size="small" effect="dark">
              {{ t("customer.value.blacklistActive") }}
            </el-tag>
          </div>
          <div class="customer-detail__card-row customer-detail__card-row--sub">
            <span class="customer-detail__mobile">{{ detail.mobile }}</span>
            <span class="customer-detail__divider">·</span>
            <span>{{ storeName(detail.storeId) }}</span>
          </div>
        </div>

        <el-tabs v-model="activeTab" class="customer-detail__tabs">
          <!-- ① 档案 -->
          <el-tab-pane :label="t('customer.detail.tab.profile')" name="profile">
            <el-descriptions :column="1" border size="small" class="customer-detail__desc">
              <el-descriptions-item :label="t('customer.field.name')">
                {{ detail.name }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('customer.field.mobile')">
                {{ detail.mobile }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('customer.field.gender')">
                {{ genderLabel(detail.gender) }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('customer.field.birthday')">
                {{ detail.birthday ?? t("customer.value.unset") }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('customer.field.source')">
                {{ sourceLabel(detail.source) }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('customer.field.store')">
                {{ storeName(detail.storeId) }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('customer.field.lifecycle')">
                <el-tag :type="lifecycleTagType(detail.lifecycle)" size="small">
                  {{ lifecycleLabel(detail.lifecycle) }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item :label="t('customer.field.remark')">
                {{ detail.remark || t("customer.value.unset") }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('customer.field.createdAt')">
                {{ formatTime(detail.createdAt) }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('customer.field.updatedAt')">
                {{ formatTime(detail.updatedAt) }}
              </el-descriptions-item>
            </el-descriptions>
            <p class="customer-detail__hint">{{ t("customer.detail.profile.desc") }}</p>
          </el-tab-pane>

          <!-- ② 宠物（FR-2 多宠物归属） -->
          <el-tab-pane :label="t('customer.detail.tab.pets')" name="pets" lazy>
            <div class="customer-detail__panel">
              <div class="customer-detail__panel-head">
                <span class="customer-detail__panel-title">
                  {{ t("customer.detail.pets.title") }}
                </span>
                <el-tooltip :content="t('customer.action.refresh')" placement="top">
                  <el-button class="page-icon-btn" size="small" @click="loadPets">
                    <el-icon><Refresh /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>

              <TableSkeleton v-if="petsLoading && !petsLoaded" :column-count="3" :row-count="3" />

              <DataState
                v-else-if="petsError"
                variant="error"
                :title="t('customer.detail.pets.errorTitle')"
                :description="petsError"
                :action-text="t('customer.detail.pets.retry')"
                @action="loadPets"
              />

              <DataState
                v-else-if="pets.length === 0"
                variant="empty"
                :title="t('customer.detail.pets.emptyTitle')"
                :description="t('customer.detail.pets.emptyDesc')"
              />

              <el-table
                v-else
                v-loading="petsLoading"
                :data="pets"
                size="small"
                :max-height="300"
                class="customer-detail__table"
              >
                <el-table-column
                  :label="t('customer.detail.pets.columnName')"
                  min-width="150"
                  show-overflow-tooltip
                >
                  <template #default="{ row }">
                    <span class="customer-detail__pet-name">
                      {{ petName(row as CustomerPetItem) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column
                  :label="t('customer.detail.pets.columnType')"
                  width="80"
                  align="center"
                >
                  <template #default="{ row }">
                    {{ petTypeLabel((row as CustomerPetItem).pet?.petType ?? null) }}
                  </template>
                </el-table-column>
                <el-table-column
                  :label="t('customer.detail.pets.columnPrimary')"
                  width="80"
                  align="center"
                >
                  <template #default="{ row }">
                    <el-tag v-if="(row as CustomerPetItem).isPrimary" type="primary" size="small">
                      {{ t("customer.value.primaryPet") }}
                    </el-tag>
                    <span v-else class="customer-detail__muted">
                      {{ t("customer.value.commonPet") }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column :label="t('customer.detail.pets.columnCompleteness')" width="120">
                  <template #default="{ row }">
                    <el-progress
                      :percentage="(row as CustomerPetItem).pet?.profileCompleteness ?? 0"
                      :stroke-width="8"
                      :show-text="true"
                    />
                  </template>
                </el-table-column>
                <el-table-column
                  :label="t('table.actions')"
                  width="80"
                  align="center"
                  fixed="right"
                >
                  <template #default="{ row }">
                    <!-- 归属变更的唯一合法通道是「转移申请 + 审批」（FR-2 / BR-4）⇒ 此处只提供
                         发起入口，不提供直接解绑；无 `customer:transfer:create` 权限则不渲染 -->
                    <el-button
                      v-if="canTransferCreate"
                      type="primary"
                      size="small"
                      link
                      @click="openTransfer(row as CustomerPetItem)"
                    >
                      {{ t("customer.transferForm.entry") }}
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>

              <p class="customer-detail__hint">{{ t("customer.detail.pets.desc") }}</p>
            </div>
          </el-tab-pane>

          <!-- ③ 触达记录（FR-3） -->
          <el-tab-pane :label="t('customer.detail.tab.reach')" name="reach" lazy>
            <div class="customer-detail__panel">
              <div class="customer-detail__filter">
                <el-select
                  v-model="reachParams.channel"
                  :placeholder="t('customer.detail.reach.channelPlaceholder')"
                  clearable
                  size="small"
                  class="customer-detail__filter-item"
                >
                  <el-option
                    v-for="option in CHANNEL_OPTIONS"
                    :key="option.value"
                    :label="t(option.labelKey)"
                    :value="option.value"
                  />
                </el-select>
                <el-select
                  v-model="reachParams.result"
                  :placeholder="t('customer.detail.reach.resultPlaceholder')"
                  clearable
                  size="small"
                  class="customer-detail__filter-item"
                >
                  <el-option
                    v-for="option in RESULT_OPTIONS"
                    :key="option.value"
                    :label="t(option.labelKey)"
                    :value="option.value"
                  />
                </el-select>
                <el-date-picker
                  v-model="reachRange"
                  type="daterange"
                  value-format="YYYY-MM-DD"
                  size="small"
                  unlink-panels
                  :start-placeholder="t('customer.detail.reach.dateStart')"
                  :end-placeholder="t('customer.detail.reach.dateEnd')"
                  class="customer-detail__filter-range"
                />
                <el-button size="small" type="primary" @click="queryReach">
                  {{ t("customer.detail.reach.search") }}
                </el-button>
                <el-button size="small" @click="resetReachQuery">
                  {{ t("customer.detail.reach.reset") }}
                </el-button>
              </div>

              <div class="customer-detail__panel-head">
                <span class="customer-detail__panel-title">
                  {{ t("customer.detail.reach.title") }}
                </span>
                <el-button
                  v-if="canReachCreate"
                  v-hasPerm="'customer:reach:create'"
                  type="primary"
                  size="small"
                  @click="openReachDialog"
                >
                  {{ t("customer.detail.reach.add") }}
                </el-button>
              </div>

              <TableSkeleton v-if="reachLoading && !reachLoaded" :column-count="4" :row-count="3" />

              <DataState
                v-else-if="reachError"
                variant="error"
                :title="t('customer.detail.reach.errorTitle')"
                :description="reachError"
                :action-text="t('customer.detail.reach.retry')"
                @action="loadReach"
              />

              <DataState
                v-else-if="reachList.length === 0"
                :variant="reachFiltered ? 'filtered' : 'empty'"
                :title="
                  reachFiltered
                    ? t('customer.detail.reach.filteredTitle')
                    : t('customer.detail.reach.emptyTitle')
                "
                :description="
                  reachFiltered
                    ? t('customer.detail.reach.filteredDesc')
                    : t('customer.detail.reach.emptyDesc')
                "
                :action-text="reachFiltered ? t('customer.detail.reach.clearFilter') : ''"
                @action="resetReachQuery"
              />

              <el-table
                v-else
                v-loading="reachLoading"
                :data="reachList"
                size="small"
                :max-height="300"
                class="customer-detail__table"
              >
                <el-table-column
                  :label="t('customer.detail.reach.columnChannel')"
                  width="110"
                  align="center"
                >
                  <template #default="{ row }">
                    <el-tag size="small" effect="plain">
                      {{ channelLabel((row as ReachLogItem).channel) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column
                  :label="t('customer.detail.reach.columnResult')"
                  width="90"
                  align="center"
                >
                  <template #default="{ row }">
                    <el-tag
                      v-if="(row as ReachLogItem).result !== null"
                      :type="resultTagType((row as ReachLogItem).result)"
                      size="small"
                    >
                      {{ resultLabel((row as ReachLogItem).result) }}
                    </el-tag>
                    <span v-else class="customer-detail__muted">
                      {{ t("customer.value.resultUnacked") }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column
                  :label="t('customer.detail.reach.columnContent')"
                  min-width="140"
                  show-overflow-tooltip
                >
                  <template #default="{ row }">
                    {{ reachContent(row as ReachLogItem) }}
                  </template>
                </el-table-column>
                <el-table-column :label="t('customer.detail.reach.columnReachedAt')" width="130">
                  <template #default="{ row }">
                    {{ formatTime((row as ReachLogItem).reachedAt) }}
                  </template>
                </el-table-column>
              </el-table>

              <pagination
                v-if="reachTotal > 0"
                v-model:total="reachTotal"
                v-model:page="reachParams.pageNum"
                v-model:limit="reachParams.pageSize"
                layout="total, prev, pager, next"
                :page-sizes="[10, 20, 50]"
                @pagination="loadReach"
              />
            </div>
          </el-tab-pane>

          <!-- ④ 触达偏好（FR-3） -->
          <el-tab-pane :label="t('customer.detail.tab.preference')" name="preference" lazy>
            <div class="customer-detail__panel">
              <div class="customer-detail__panel-head">
                <span class="customer-detail__panel-title">
                  {{ t("customer.detail.preference.title") }}
                </span>
                <el-tooltip :content="t('customer.action.refresh')" placement="top">
                  <el-button class="page-icon-btn" size="small" @click="loadPreference">
                    <el-icon><Refresh /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>

              <TableSkeleton v-if="prefLoading && !prefLoaded" :column-count="1" :row-count="4" />

              <DataState
                v-else-if="prefError"
                variant="error"
                :title="t('customer.detail.preference.errorTitle')"
                :description="prefError"
                :action-text="t('customer.detail.preference.retry')"
                @action="loadPreference"
              />

              <template v-else>
                <el-form label-position="top" size="small" class="customer-detail__form">
                  <el-form-item :label="t('customer.detail.preference.allowed')">
                    <el-select
                      v-model="prefAllowed"
                      multiple
                      collapse-tags
                      collapse-tags-tooltip
                      clearable
                      placeholder=""
                      class="w-full"
                      :disabled="!canPreferenceUpdate"
                    >
                      <el-option
                        v-for="option in CHANNEL_OPTIONS"
                        :key="option.value"
                        :label="t(option.labelKey)"
                        :value="option.value"
                      />
                    </el-select>
                    <div class="customer-detail__hint customer-detail__hint--inline">
                      {{ t("customer.detail.preference.allowedHint") }}
                    </div>
                  </el-form-item>

                  <el-form-item :label="t('customer.detail.preference.blocked')">
                    <el-select
                      v-model="prefBlocked"
                      multiple
                      collapse-tags
                      collapse-tags-tooltip
                      clearable
                      placeholder=""
                      class="w-full"
                      :disabled="!canPreferenceUpdate"
                    >
                      <el-option
                        v-for="option in CHANNEL_OPTIONS"
                        :key="option.value"
                        :label="t(option.labelKey)"
                        :value="option.value"
                      />
                    </el-select>
                    <div class="customer-detail__hint customer-detail__hint--inline">
                      {{ t("customer.detail.preference.blockedHint") }}
                    </div>
                  </el-form-item>

                  <el-form-item :label="t('customer.detail.preference.dnd')">
                    <div class="customer-detail__dnd">
                      <el-switch
                        v-model="prefDndEnabled"
                        :disabled="!canPreferenceUpdate"
                        :active-text="t('customer.detail.preference.dndEnabled')"
                      />
                      <el-time-select
                        v-model="prefDndStart"
                        start="00:00"
                        step="00:15"
                        end="23:45"
                        :disabled="!canPreferenceUpdate || !prefDndEnabled"
                        :placeholder="t('customer.detail.preference.dndStart')"
                        class="customer-detail__time"
                      />
                      <span class="customer-detail__muted">→</span>
                      <el-time-select
                        v-model="prefDndEnd"
                        start="00:00"
                        step="00:15"
                        end="23:45"
                        :disabled="!canPreferenceUpdate || !prefDndEnabled"
                        :placeholder="t('customer.detail.preference.dndEnd')"
                        class="customer-detail__time"
                      />
                    </div>
                    <div class="customer-detail__hint customer-detail__hint--inline">
                      {{ t("customer.detail.preference.dndHint") }}
                    </div>
                  </el-form-item>
                </el-form>

                <div class="customer-detail__panel-foot">
                  <el-button
                    v-if="canPreferenceUpdate"
                    v-hasPerm="'customer:reach:preference:update'"
                    type="primary"
                    size="small"
                    :loading="prefSaving"
                    @click="savePreference"
                  >
                    {{ t("customer.detail.preference.save") }}
                  </el-button>
                  <el-button size="small" @click="applyPreferenceForm">
                    {{ t("customer.detail.preference.reset") }}
                  </el-button>
                </div>

                <p class="customer-detail__hint">{{ t("customer.detail.preference.desc") }}</p>
              </template>
            </div>
          </el-tab-pane>

          <!-- ⑤ 黑名单（FR-4） -->
          <el-tab-pane :label="t('customer.detail.tab.blacklist')" name="blacklist" lazy>
            <div class="customer-detail__panel">
              <div class="customer-detail__filter">
                <el-select
                  v-model="blParams.scope"
                  :placeholder="t('customer.detail.blacklist.scopePlaceholder')"
                  clearable
                  size="small"
                  class="customer-detail__filter-item"
                >
                  <el-option :label="t('customer.value.scopeTenant')" value="tenant" />
                  <el-option :label="t('customer.value.scopeStore')" value="store" />
                </el-select>
                <el-select
                  v-model="blParams.status"
                  :placeholder="t('customer.detail.blacklist.statusPlaceholder')"
                  clearable
                  size="small"
                  class="customer-detail__filter-item"
                >
                  <el-option
                    :label="t('customer.value.blacklistActive')"
                    :value="BlacklistStatus.ACTIVE"
                  />
                  <el-option
                    :label="t('customer.value.blacklistReleased')"
                    :value="BlacklistStatus.RELEASED"
                  />
                </el-select>
                <el-button size="small" type="primary" @click="queryBlacklist">
                  {{ t("customer.detail.reach.search") }}
                </el-button>
                <el-button size="small" @click="resetBlacklistQuery">
                  {{ t("customer.detail.reach.reset") }}
                </el-button>
              </div>

              <div class="customer-detail__panel-head">
                <span class="customer-detail__panel-title">
                  {{ t("customer.detail.blacklist.title") }}
                </span>
                <el-button
                  v-if="canBlacklistCreate"
                  v-hasPerm="'customer:blacklist:create'"
                  type="danger"
                  size="small"
                  @click="openBlacklistDialog"
                >
                  {{ t("customer.detail.blacklist.add") }}
                </el-button>
              </div>

              <el-alert
                v-if="hasActiveBlacklist"
                :title="t('customer.detail.blacklist.activeTip')"
                type="error"
                :closable="false"
                show-icon
                class="customer-detail__alert"
              />

              <TableSkeleton v-if="blLoading && !blLoaded" :column-count="3" :row-count="3" />

              <DataState
                v-else-if="blError"
                variant="error"
                :title="t('customer.detail.blacklist.errorTitle')"
                :description="blError"
                :action-text="t('customer.detail.blacklist.retry')"
                @action="loadBlacklist"
              />

              <DataState
                v-else-if="blList.length === 0"
                :variant="blFiltered ? 'filtered' : 'empty'"
                :title="
                  blFiltered
                    ? t('customer.detail.blacklist.filteredTitle')
                    : t('customer.detail.blacklist.emptyTitle')
                "
                :description="
                  blFiltered
                    ? t('customer.detail.blacklist.filteredDesc')
                    : t('customer.detail.blacklist.emptyDesc')
                "
                :action-text="blFiltered ? t('customer.detail.blacklist.clearFilter') : ''"
                @action="resetBlacklistQuery"
              />

              <el-table
                v-else
                v-loading="blLoading"
                :data="blList"
                size="small"
                :max-height="300"
                class="customer-detail__table"
              >
                <el-table-column
                  :label="t('customer.detail.blacklist.columnScope')"
                  width="86"
                  align="center"
                >
                  <template #default="{ row }">
                    {{ scopeLabel((row as BlacklistItem).storeId) }}
                  </template>
                </el-table-column>
                <el-table-column
                  :label="t('customer.detail.blacklist.columnStatus')"
                  width="86"
                  align="center"
                >
                  <template #default="{ row }">
                    <el-tag
                      :type="
                        (row as BlacklistItem).status === BlacklistStatus.ACTIVE ? 'danger' : 'info'
                      "
                      size="small"
                    >
                      {{ blacklistStatusLabel((row as BlacklistItem).status) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column
                  :label="t('customer.detail.blacklist.columnReason')"
                  min-width="200"
                >
                  <template #default="{ row }">
                    <div class="customer-detail__record">
                      <span class="customer-detail__record-main">
                        {{ (row as BlacklistItem).reason }}
                      </span>
                      <span
                        v-if="(row as BlacklistItem).releaseReason"
                        class="customer-detail__record-sub"
                      >
                        {{ t("customer.detail.blacklist.columnReleaseReason") }}：{{
                          (row as BlacklistItem).releaseReason
                        }}
                      </span>
                      <span class="customer-detail__record-time">
                        {{ formatTime((row as BlacklistItem).createdAt) }}
                      </span>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column
                  v-if="canBlacklistRelease"
                  fixed="right"
                  :label="t('table.actions')"
                  width="76"
                  align="center"
                >
                  <template #default="{ row }">
                    <el-button
                      v-if="(row as BlacklistItem).status === BlacklistStatus.ACTIVE"
                      v-hasPerm="'customer:blacklist:release'"
                      type="primary"
                      size="small"
                      link
                      @click="handleRelease(row as BlacklistItem)"
                    >
                      {{ t("customer.detail.blacklist.release") }}
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>

              <pagination
                v-if="blTotal > 0"
                v-model:total="blTotal"
                v-model:page="blParams.pageNum"
                v-model:limit="blParams.pageSize"
                layout="total, prev, pager, next"
                :page-sizes="[10, 20, 50]"
                @pagination="loadBlacklist"
              />
            </div>
          </el-tab-pane>
        </el-tabs>
      </template>
    </div>
  </el-drawer>

  <!-- 记录触达（FR-3：黑名单硬拦截 + 触达偏好软拦截都在服务端前置校验） -->
  <el-dialog
    v-model="reachDialogVisible"
    :title="t('customer.detail.reach.form.title')"
    width="420px"
    append-to-body
    destroy-on-close
  >
    <el-form
      ref="reachFormRef"
      :model="reachForm"
      :rules="reachRules"
      label-position="top"
      size="small"
    >
      <el-form-item :label="t('customer.detail.reach.form.channel')" prop="channel">
        <el-select v-model="reachForm.channel" class="w-full" clearable>
          <el-option
            v-for="option in CHANNEL_OPTIONS"
            :key="option.value"
            :label="t(option.labelKey)"
            :value="option.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('customer.detail.reach.form.template')" prop="template">
        <el-input
          v-model="reachForm.template"
          maxlength="64"
          clearable
          :placeholder="t('customer.detail.reach.form.templatePlaceholder')"
        />
      </el-form-item>
      <el-form-item :label="t('customer.detail.reach.form.content')" prop="content">
        <el-input
          v-model="reachForm.content"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          :placeholder="t('customer.detail.reach.form.contentPlaceholder')"
        />
      </el-form-item>
      <el-form-item :label="t('customer.detail.reach.form.result')" prop="result">
        <el-select
          v-model="reachForm.result"
          class="w-full"
          clearable
          :placeholder="t('customer.detail.reach.form.resultPlaceholder')"
        >
          <el-option
            v-for="option in RESULT_OPTIONS"
            :key="option.value"
            :label="t(option.labelKey)"
            :value="option.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('customer.detail.reach.form.reachedAt')" prop="reachedAt">
        <el-date-picker
          v-model="reachForm.reachedAt"
          type="datetime"
          value-format="YYYY-MM-DD HH:mm:ss"
          class="w-full"
          :placeholder="t('customer.detail.reach.form.reachedAtPlaceholder')"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button size="small" @click="reachDialogVisible = false">
        {{ t("customer.detail.reach.form.cancel") }}
      </el-button>
      <el-button size="small" type="primary" :loading="reachSubmitting" @click="submitReachLog">
        {{ t("customer.detail.reach.form.submit") }}
      </el-button>
    </template>
  </el-dialog>

  <!-- 加入黑名单（FR-4） -->
  <el-dialog
    v-model="blDialogVisible"
    :title="t('customer.detail.blacklist.addForm.title')"
    width="420px"
    append-to-body
    destroy-on-close
  >
    <el-form ref="blFormRef" :model="blForm" :rules="blRules" label-position="top" size="small">
      <el-form-item :label="t('customer.detail.blacklist.addForm.scope')" prop="scope">
        <el-radio-group v-model="blForm.scope">
          <el-radio :value="BlacklistScope.TENANT">
            {{ t("customer.value.scopeTenant") }}
          </el-radio>
          <el-radio :value="BlacklistScope.STORE">
            {{ t("customer.value.scopeStore") }}
          </el-radio>
        </el-radio-group>
        <div class="customer-detail__hint customer-detail__hint--inline">
          {{
            blForm.scope === BlacklistScope.TENANT
              ? t("customer.detail.blacklist.addForm.scopeTenantHint")
              : t("customer.detail.blacklist.addForm.scopeStoreHint")
          }}
        </div>
      </el-form-item>
      <el-form-item
        v-if="blForm.scope === BlacklistScope.STORE"
        :label="t('customer.detail.blacklist.addForm.store')"
        prop="storeId"
      >
        <el-select
          v-model="blForm.storeId"
          class="w-full"
          clearable
          :placeholder="t('customer.detail.blacklist.addForm.storePlaceholder')"
        >
          <el-option
            v-for="store in storeOptions"
            :key="store.id"
            :label="store.name"
            :value="store.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('customer.detail.blacklist.addForm.reason')" prop="reason">
        <el-input
          v-model="blForm.reason"
          type="textarea"
          :rows="3"
          maxlength="255"
          show-word-limit
          :placeholder="t('customer.detail.blacklist.addForm.reasonPlaceholder')"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button size="small" @click="blDialogVisible = false">
        {{ t("customer.detail.blacklist.addForm.cancel") }}
      </el-button>
      <el-button size="small" type="danger" :loading="blSubmitting" @click="submitBlacklist">
        {{ t("customer.detail.blacklist.addForm.submit") }}
      </el-button>
    </template>
  </el-dialog>

  <!-- 发起宠物归属转移（FR-2；归属变更须审批，MVP-WEB-04-03） -->
  <PetTransferDialog
    v-model="transferVisible"
    :pet="transferPet"
    :from-customer-id="props.customerId"
    @refresh="handleTransferCreated"
  />
</template>

<script setup lang="ts">
import type { FormInstance, FormRules } from "element-plus";
import { ElMessage, ElMessageBox } from "element-plus";
import { Refresh } from "@element-plus/icons-vue";

import CustomerAPI from "@/api/customer";
import type {
  BlacklistItem,
  BlacklistQueryParams,
  CustomerItem,
  CustomerPetItem,
  CustomerSourceOption,
  ReachLogItem,
  ReachLogQueryParams,
} from "@/api/customer";
import StoreAPI from "@/api/store";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import PetTransferDialog from "./PetTransferDialog.vue";
import { usePageTable } from "@/composables";
import {
  BlacklistScope,
  BlacklistStatus,
  CustomerGender,
  CustomerLifecycle,
  CustomerPetType,
  DeviceEnum,
  ReachChannel,
  ReachResult,
} from "@/enums";
import { useAppStore } from "@/stores";
import { hasPerm } from "@/utils/auth";
import { formatTableDateTime } from "@/utils/format";
import { isApiError } from "@/utils/request";

/**
 * 客户详情抽屉（MVP-WEB-04-02）
 *
 * 规格来源：PRD《Web端页面清单》（路径 `customers/:customer_id`，模块「客户」，
 * 可见角色 超管 / 总部 / 店长 / 前台 / 财务 / 运营）+《页面功能》§客户详情页
 * （「头部为宠主卡…页签含宠物…」）+《客户管理》FR-2 多宠物归属 / FR-3 触达渠道与
 * 偏好 / FR-4 两级黑名单 +《Customer API》端点清单 +《Web规范》
 * （§页面模式 1 详情用右侧抽屉、§表单规范、§空态/加载/错误态、§表格规范、§权限与视图）。
 *
 * 呈现形态（**有意选择，非跳页**）：《Web规范》§页面模式 1「详情一律用**右侧抽屉**
 * 呈现而非跳页，保留列表上下文」——故 `customers/:customer_id` 以列表页内抽屉落地，
 * 不新增独立路由。抽屉开关是**交互瞬态**，不写进地址栏：工作区组件按 `route.fullPath`
 * （含 query）重建（踩坑 95），把抽屉状态写进 query 会在每次开合时整页重建、
 * 列表重新拉取并丢失滚动位置与勾选。
 *
 * 页面结构：宠主卡（姓名 / 手机号 / 分层 / 归属门店 / 黑名单生效标记）+ 五个页签：
 *  ① 档案 —— 全字段只读（编辑入口随「客户编辑」任务上线，本任务不渲染，避免死链）；
 *  ② 宠物 —— FR-2 归属列表（只读：归属变更的唯一合法通道是「转移申请 + 审批」，
 *            后端 `unbindPet` 对现行归属关联直接抛 A0519，故不渲染解绑入口；
 *            宠物档案页亦未上线，故不做跳转）；
 *  ③ 触达记录 —— FR-3 分页（渠道 / 结果 / 触达时间闭区间）+「记录触达」写入口；
 *  ④ 触达偏好 —— FR-3 读（GET 兜底默认）+ 写（PUT 整存整取）；
 *  ⑤ 黑名单 —— FR-4 分页（范围 / 状态）+ 拉黑 + 解除（**必填解除原因**）。
 *
 * 不渲染的项（PRD《Web规范》§权限与视图 1：无权限/未上线字段直接不渲染，而非渲染后隐藏）：
 *  · 会员等级 / 累计消费 / 标签 / 复购概率 —— 依赖 Order / Payment / Membership 模型，
 *    P0 阶段未建模，无数据源；
 *  · 详情页页签「订单 / 预约 / 会员卡」与操作区「新建预约 / 新建订单 / 储值 / 发券」 —— 同上；
 *  · 快捷动作「发券 / 储值」 —— 依赖营销与会员域。
 *
 * 三态齐备：每个页签各自独立实现「骨架屏 / 空态（区分从未有数据与筛选无结果）/ 错误态
 * （可读原因 + 重试）」，互不牵连（PRD《Web规范》§空态/加载/错误态 1）。
 */
defineOptions({ name: "CustomerDetailDrawer", inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** 抽屉可见性（v-model） */
    modelValue: boolean;
    /** 客户 ID（打开时必填） */
    customerId?: string;
  }>(),
  { customerId: "" }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** 档案类数据发生写变更（触达偏好会 bump `customer.version`/`updated_at`），列表页据此刷新 */
  refresh: [];
}>();

const { t } = useI18n();
const appStore = useAppStore();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

/** 抽屉宽度：《Web规范》§布局与栅格 2「可选右侧明细抽屉（宽 480px）」；md 及以下整页 */
const drawerSize = computed(() => (appStore.device === DeviceEnum.DESKTOP ? "480px" : "100%"));

/** 写权限（无权限 ⇒ 入口整体不渲染，PRD《Web规范》§权限与视图 1） */
const canReachCreate = computed(() => hasPerm("customer:reach:create"));
const canPreferenceUpdate = computed(() => hasPerm("customer:reach:preference:update"));
const canBlacklistCreate = computed(() => hasPerm("customer:blacklist:create"));
const canBlacklistRelease = computed(() => hasPerm("customer:blacklist:release"));
const canTransferCreate = computed(() => hasPerm("customer:transfer:create"));

// ── 选项常量（值走枚举，标签走 i18n）──────────────────────────────────────
const CHANNEL_OPTIONS: Array<{ value: number; labelKey: string }> = [
  { value: ReachChannel.INAPP, labelKey: "customer.value.reachChannelInapp" },
  { value: ReachChannel.SERVICE_ACCOUNT, labelKey: "customer.value.reachChannelServiceAccount" },
  { value: ReachChannel.SUBSCRIBE_MESSAGE, labelKey: "customer.value.reachChannelSubscribe" },
  { value: ReachChannel.SMS, labelKey: "customer.value.reachChannelSms" },
];

const RESULT_OPTIONS: Array<{ value: number; labelKey: string }> = [
  { value: ReachResult.SUCCESS, labelKey: "customer.value.reachResultSuccess" },
  { value: ReachResult.FAILED, labelKey: "customer.value.reachResultFailed" },
];

const LIFECYCLE_LABEL_KEYS: Record<number, string> = {
  [CustomerLifecycle.NEW]: "customer.value.lifecycleNew",
  [CustomerLifecycle.ACTIVE]: "customer.value.lifecycleActive",
  [CustomerLifecycle.DORMANT]: "customer.value.lifecycleDormant",
  [CustomerLifecycle.LOST]: "customer.value.lifecycleLost",
};

// ── 通用渲染helper ─────────────────────────────────────────────────────
function formatTime(value: unknown): string {
  return formatTableDateTime(value as string, {
    today: t("time.today"),
    yesterday: t("time.yesterday"),
    beforeYesterday: t("time.beforeYesterday"),
  });
}

function genderLabel(gender: number | null): string {
  if (gender === CustomerGender.MALE) return t("customer.value.genderMale");
  if (gender === CustomerGender.FEMALE) return t("customer.value.genderFemale");
  if (gender === CustomerGender.UNKNOWN) return t("customer.value.genderUnknown");
  return t("customer.value.unset");
}

function lifecycleLabel(lifecycle: number | null): string {
  const key = lifecycle === null ? undefined : LIFECYCLE_LABEL_KEYS[lifecycle];
  return key ? t(key) : t("customer.value.unset");
}

function lifecycleTagType(
  lifecycle: number | null
): "primary" | "success" | "warning" | "danger" | "info" {
  if (lifecycle === CustomerLifecycle.NEW) return "primary";
  if (lifecycle === CustomerLifecycle.ACTIVE) return "success";
  if (lifecycle === CustomerLifecycle.DORMANT) return "warning";
  if (lifecycle === CustomerLifecycle.LOST) return "danger";
  return "info";
}

function channelLabel(channel: number): string {
  const matched = CHANNEL_OPTIONS.find((option) => option.value === channel);
  return matched ? t(matched.labelKey) : String(channel);
}

function resultLabel(result: number | null): string {
  const matched = RESULT_OPTIONS.find((option) => option.value === result);
  return matched ? t(matched.labelKey) : t("customer.value.unset");
}

function resultTagType(result: number | null): "success" | "danger" | "info" {
  if (result === ReachResult.SUCCESS) return "success";
  if (result === ReachResult.FAILED) return "danger";
  return "info";
}

function petTypeLabel(petType: number | null): string {
  if (petType === CustomerPetType.DOG) return t("customer.value.petTypeDog");
  if (petType === CustomerPetType.CAT) return t("customer.value.petTypeCat");
  if (petType === CustomerPetType.OTHER) return t("customer.value.petTypeOther");
  return t("customer.value.unset");
}

function petName(row: CustomerPetItem): string {
  return row.pet?.name ?? row.petName ?? t("customer.detail.pets.unnamed");
}

// ── 发起宠物归属转移（MVP-WEB-04-03 · FR-2）─────────────────────────────
/** 转移对话框可见性（交互瞬态，不写地址栏） */
const transferVisible = ref(false);
const transferPet = ref<{ id: string; name: string } | null>(null);

/** 打开转移对话框（宠物 id 以关联主档为准，回退到冗余 petId） */
function openTransfer(row: CustomerPetItem): void {
  const petId = row.pet?.id ?? row.petId;
  if (!petId) return;
  transferPet.value = { id: petId, name: petName(row) };
  transferVisible.value = true;
}

/**
 * 转移申请已创建：**不刷新宠物列表**（申请不改归属，宠物仍在原主人名下），
 * 但告知父组件刷新列表——「在途申请」会影响该客户能否被合并（A0528）。
 */
function handleTransferCreated(): void {
  emit("refresh");
}

function reachContent(row: ReachLogItem): string {
  const content = row.content?.trim();
  if (content) return content;
  const template = row.template?.trim();
  return template || t("customer.value.unset");
}

function blacklistStatusLabel(status: number): string {
  return status === BlacklistStatus.ACTIVE
    ? t("customer.value.blacklistActive")
    : t("customer.value.blacklistReleased");
}

function scopeLabel(storeId: string | null): string {
  return storeId ? t("customer.value.scopeStore") : t("customer.value.scopeTenant");
}

// ── 门店选项（归属门店名映射 + 拉黑门店下拉）────────────────────────────
const storeOptions = ref<Array<{ id: string; name: string }>>([]);
const storeNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const store of storeOptions.value) map.set(store.id, store.name);
  return map;
});

function storeName(storeId: string | null): string {
  if (!storeId) return t("customer.value.tenantLevel");
  return storeNameMap.value.get(storeId) ?? `${storeId.slice(0, 8)}…`;
}

async function fetchStoreOptions(): Promise<void> {
  try {
    const data = await StoreAPI.getPage({
      pageNum: 1,
      pageSize: 100,
      sortBy: "createdAt",
      order: "ASC",
    });
    storeOptions.value = (data.list ?? []).map((item) => ({ id: item.id, name: item.name }));
  } catch {
    // 门店选项拉取失败不阻断详情（门店列回退为 ID 短码）；无 store:list 权限的角色命中此分支属预期
    storeOptions.value = [];
  }
}

// ── 客户来源选项（标签唯一来源为后端 source-options）────────────────────
const sourceOptions = ref<CustomerSourceOption[]>([]);

async function fetchSourceOptions(): Promise<void> {
  try {
    sourceOptions.value = await CustomerAPI.getSourceOptions();
  } catch {
    sourceOptions.value = [];
  }
}

function sourceLabel(source: number | null): string {
  if (source === null || source === undefined) return t("customer.value.unset");
  return sourceOptions.value.find((item) => item.value === source)?.label ?? String(source);
}

// ── ① 客户详情 ────────────────────────────────────────────────────────────
const detail = ref<CustomerItem | null>(null);
const detailLoading = ref(false);
const detailError = ref("");
const activeTab = ref<"profile" | "pets" | "reach" | "preference" | "blacklist">("profile");

async function loadDetail(): Promise<void> {
  if (!props.customerId) return;
  detailLoading.value = true;
  detailError.value = "";
  try {
    detail.value = await CustomerAPI.getDetail(props.customerId);
  } catch (error) {
    detail.value = null;
    detailError.value = isApiError(error) ? error.message : String(error ?? "");
  } finally {
    detailLoading.value = false;
  }
}

// ── ② 宠物（FR-2）────────────────────────────────────────────────────────
const pets = ref<CustomerPetItem[]>([]);
const petsLoading = ref(false);
const petsLoaded = ref(false);
const petsError = ref("");

async function loadPets(): Promise<void> {
  if (!props.customerId) return;
  petsLoading.value = true;
  petsError.value = "";
  try {
    pets.value = await CustomerAPI.listPets(props.customerId);
    petsLoaded.value = true;
  } catch (error) {
    petsError.value = isApiError(error) ? error.message : String(error ?? "");
  } finally {
    petsLoading.value = false;
  }
}

// ── ③ 触达记录（FR-3）────────────────────────────────────────────────────
const REACH_PAGE_SIZE = 10;

const {
  loading: reachLoading,
  list: reachList,
  total: reachTotal,
  params: reachParams,
  fetchData: fetchReach,
} = usePageTable<ReachLogItem, ReachLogQueryParams>({
  initialParams: {
    pageNum: 1,
    pageSize: REACH_PAGE_SIZE,
    sortBy: "reachedAt",
    order: "DESC",
    channel: undefined,
    result: undefined,
    reachedAtStart: undefined,
    reachedAtEnd: undefined,
  },
  request: (params) => CustomerAPI.getReachLogs(props.customerId, params),
});

const reachLoaded = ref(false);
const reachError = ref("");
const reachRange = ref<[string, string] | null>(null);

watch(reachRange, (range) => {
  reachParams.reachedAtStart = range?.[0];
  reachParams.reachedAtEnd = range?.[1];
});

/** 下拉清空归一化：`el-select` 清空置空串，而 channel/result 是 `@IsIn + @Type(Number)`
 *  ⇒ 空串会被转成 0 且不在值域，造成真 HTTP 400（同踩坑 101 的隐式转换陷阱） */
watch(
  () => reachParams.channel,
  (value) => {
    if (value === ("" as unknown) || value === null || !Number.isFinite(Number(value))) {
      reachParams.channel = undefined;
    }
  }
);

watch(
  () => reachParams.result,
  (value) => {
    if (value === ("" as unknown) || value === null || !Number.isFinite(Number(value))) {
      reachParams.result = undefined;
    }
  }
);

const reachFiltered = computed(
  () =>
    reachParams.channel !== undefined ||
    reachParams.result !== undefined ||
    Boolean(reachParams.reachedAtStart) ||
    Boolean(reachParams.reachedAtEnd)
);

async function loadReach(): Promise<void> {
  if (!props.customerId) return;
  reachError.value = "";
  try {
    await fetchReach();
    reachLoaded.value = true;
  } catch (error) {
    reachError.value = isApiError(error) ? error.message : String(error ?? "");
  }
}

function queryReach(): void {
  reachParams.pageNum = 1;
  void loadReach();
}

function resetReachQuery(): void {
  reachRange.value = null;
  reachParams.channel = undefined;
  reachParams.result = undefined;
  reachParams.reachedAtStart = undefined;
  reachParams.reachedAtEnd = undefined;
  reachParams.pageNum = 1;
  void loadReach();
}

// 记录触达
const reachDialogVisible = ref(false);
const reachSubmitting = ref(false);
const reachFormRef = ref<FormInstance>();
const reachForm = reactive<{
  channel: number | undefined;
  template: string;
  content: string;
  result: number | undefined;
  reachedAt: string;
}>({ channel: undefined, template: "", content: "", result: undefined, reachedAt: "" });

const reachRules = computed<FormRules>(() => ({
  channel: [
    { required: true, message: t("customer.detail.reach.form.channelRequired"), trigger: "change" },
  ],
  template: [
    {
      validator: (_rule, value: string, callback) => {
        const text = String(value ?? "").trim();
        if (!text) return callback();
        return text.length <= 64
          ? callback()
          : callback(new Error(t("customer.detail.reach.form.templateLength")));
      },
      trigger: "blur",
    },
  ],
  content: [
    {
      validator: (_rule, value: string, callback) => {
        const text = String(value ?? "");
        if (!text) return callback();
        return text.length <= 500
          ? callback()
          : callback(new Error(t("customer.detail.reach.form.contentLength")));
      },
      trigger: "blur",
    },
  ],
}));

function openReachDialog(): void {
  reachForm.channel = undefined;
  reachForm.template = "";
  reachForm.content = "";
  reachForm.result = undefined;
  reachForm.reachedAt = "";
  reachDialogVisible.value = true;
  void nextTick(() => reachFormRef.value?.clearValidate());
}

async function submitReachLog(): Promise<void> {
  const valid = await reachFormRef.value?.validate().then(
    () => true,
    () => false
  );
  if (!valid || reachForm.channel === undefined) return;

  const payload = {
    channel: reachForm.channel,
    ...(reachForm.template.trim() ? { template: reachForm.template.trim() } : {}),
    ...(reachForm.content.trim() ? { content: reachForm.content.trim() } : {}),
    ...(reachForm.result === undefined ? {} : { result: reachForm.result }),
    ...(reachForm.reachedAt ? { reachedAt: reachForm.reachedAt } : {}),
  };

  reachSubmitting.value = true;
  try {
    await CustomerAPI.createReachLog(props.customerId, payload);
    ElMessage.success(t("customer.detail.reach.form.success"));
    reachDialogVisible.value = false;
    reachParams.pageNum = 1;
    await loadReach();
  } catch {
    // 失败文案（A0522 黑名单硬拦截 / A0527 偏好拒收）由请求层统一渲染可读原因，此处不再重复弹窗
  } finally {
    reachSubmitting.value = false;
  }
}

// ── ④ 触达偏好（FR-3）────────────────────────────────────────────────────
const prefLoading = ref(false);
const prefLoaded = ref(false);
const prefError = ref("");
const prefSaving = ref(false);

const prefAllowed = ref<number[]>([]);
const prefBlocked = ref<number[]>([]);
const prefDndEnabled = ref(false);
const prefDndStart = ref("22:00");
const prefDndEnd = ref("08:00");

/** 把服务端归一结果回填到表单（`allowedChannels=null` ⇒ 空数组 = 不设白名单） */
function applyPreferenceForm(): void {
  prefAllowed.value = [];
  prefBlocked.value = [];
  prefDndEnabled.value = false;
  prefDndStart.value = "22:00";
  prefDndEnd.value = "08:00";
  void loadPreference();
}

async function loadPreference(): Promise<void> {
  if (!props.customerId) return;
  prefLoading.value = true;
  prefError.value = "";
  try {
    const data = await CustomerAPI.getReachPreference(props.customerId);
    prefAllowed.value = [...(data.allowedChannels ?? [])];
    prefBlocked.value = [...(data.blockedChannels ?? [])];
    prefDndEnabled.value = data.doNotDisturb?.enabled ?? false;
    prefDndStart.value = data.doNotDisturb?.start ?? "22:00";
    prefDndEnd.value = data.doNotDisturb?.end ?? "08:00";
    prefLoaded.value = true;
  } catch (error) {
    prefError.value = isApiError(error) ? error.message : String(error ?? "");
  } finally {
    prefLoading.value = false;
  }
}

async function savePreference(): Promise<void> {
  prefSaving.value = true;
  try {
    const data = await CustomerAPI.updateReachPreference(props.customerId, {
      // 空数组归一为 null（= 不设白名单，默认允许全部渠道），与后端 shared 归一语义一致
      allowedChannels:
        prefAllowed.value.length > 0 ? [...prefAllowed.value].sort((a, b) => a - b) : null,
      blockedChannels: [...prefBlocked.value].sort((a, b) => a - b),
      doNotDisturb: {
        enabled: prefDndEnabled.value,
        start: prefDndStart.value,
        end: prefDndEnd.value,
      },
    });
    prefAllowed.value = [...(data.allowedChannels ?? [])];
    prefBlocked.value = [...(data.blockedChannels ?? [])];
    prefDndEnabled.value = data.doNotDisturb?.enabled ?? false;
    prefDndStart.value = data.doNotDisturb?.start ?? "22:00";
    prefDndEnd.value = data.doNotDisturb?.end ?? "08:00";
    ElMessage.success(t("customer.detail.preference.saved"));
    // 偏好写入会 bump customer.version / updated_at ⇒ 列表需刷新（updatedAt 为列表必带列）
    emit("refresh");
  } catch {
    // 失败文案由请求层统一渲染
  } finally {
    prefSaving.value = false;
  }
}

// ── ⑤ 黑名单（FR-4）──────────────────────────────────────────────────────
const BL_PAGE_SIZE = 10;

const {
  loading: blLoading,
  list: blList,
  total: blTotal,
  params: blParams,
  fetchData: fetchBlacklist,
} = usePageTable<BlacklistItem, BlacklistQueryParams>({
  initialParams: {
    pageNum: 1,
    pageSize: BL_PAGE_SIZE,
    sortBy: "createdAt",
    order: "DESC",
    scope: undefined,
    storeId: undefined,
    status: undefined,
  },
  request: (params) => CustomerAPI.getBlacklist(props.customerId, params),
});

const blLoaded = ref(false);
const blError = ref("");
const hasActiveBlacklist = ref(false);

/** 下拉清空归一化（scope 是 `@IsIn(["store","tenant"])`、status 是 `@IsIn([0,1])`，空串必 400） */
watch(
  () => blParams.scope,
  (value) => {
    if (value === ("" as unknown) || value === null) blParams.scope = undefined;
  }
);

watch(
  () => blParams.status,
  (value) => {
    const raw = value as unknown;
    if (raw === "" || raw === null || raw === undefined) {
      blParams.status = undefined;
      return;
    }
    if (Number(raw) !== BlacklistStatus.ACTIVE && Number(raw) !== BlacklistStatus.RELEASED) {
      blParams.status = undefined;
    }
  }
);

const blFiltered = computed(() => blParams.scope !== undefined || blParams.status !== undefined);

async function loadBlacklist(): Promise<void> {
  if (!props.customerId) return;
  blError.value = "";
  try {
    await fetchBlacklist();
    blLoaded.value = true;
  } catch (error) {
    blError.value = isApiError(error) ? error.message : String(error ?? "");
  }
}

/**
 * 黑名单生效标记（宠主卡徽标 / 页签告警条）
 *
 * 独立轻量查询（`status=1` + `pageSize=1`）而非从当前页数据推导：黑名单列表带
 * 分页与筛选，用当前页推断「是否存在生效记录」在翻页/筛选后会得出错误结论。
 */
async function loadBlacklistSummary(): Promise<void> {
  if (!props.customerId) return;
  try {
    const data = await CustomerAPI.getBlacklist(props.customerId, {
      pageNum: 1,
      pageSize: 1,
      status: BlacklistStatus.ACTIVE,
    });
    hasActiveBlacklist.value = (data.total ?? 0) > 0;
  } catch {
    hasActiveBlacklist.value = false;
  }
}

function queryBlacklist(): void {
  blParams.pageNum = 1;
  void loadBlacklist();
}

function resetBlacklistQuery(): void {
  blParams.scope = undefined;
  blParams.status = undefined;
  blParams.pageNum = 1;
  void loadBlacklist();
}

// 拉黑
const blDialogVisible = ref(false);
const blSubmitting = ref(false);
const blFormRef = ref<FormInstance>();
const blForm = reactive<{ scope: BlacklistScope; storeId: string; reason: string }>({
  scope: BlacklistScope.TENANT,
  storeId: "",
  reason: "",
});

const blRules = computed<FormRules>(() => ({
  scope: [
    {
      required: true,
      message: t("customer.detail.blacklist.addForm.scopeRequired"),
      trigger: "change",
    },
  ],
  storeId: [
    {
      validator: (_rule, value: string, callback) => {
        if (blForm.scope !== BlacklistScope.STORE) return callback();
        return String(value ?? "").trim()
          ? callback()
          : callback(new Error(t("customer.detail.blacklist.addForm.storeRequired")));
      },
      trigger: "change",
    },
  ],
  reason: [
    {
      required: true,
      message: t("customer.detail.blacklist.addForm.reasonRequired"),
      trigger: "blur",
    },
    {
      validator: (_rule, value: string, callback) => {
        const text = String(value ?? "").trim();
        if (!text)
          return callback(new Error(t("customer.detail.blacklist.addForm.reasonRequired")));
        return text.length <= 255
          ? callback()
          : callback(new Error(t("customer.detail.blacklist.addForm.reasonLength")));
      },
      trigger: "blur",
    },
  ],
}));

function openBlacklistDialog(): void {
  blForm.scope = BlacklistScope.TENANT;
  blForm.storeId = "";
  blForm.reason = "";
  blDialogVisible.value = true;
  void nextTick(() => blFormRef.value?.clearValidate());
}

async function submitBlacklist(): Promise<void> {
  const valid = await blFormRef.value?.validate().then(
    () => true,
    () => false
  );
  if (!valid) return;

  blSubmitting.value = true;
  try {
    await CustomerAPI.addBlacklist(props.customerId, {
      scope: blForm.scope,
      ...(blForm.scope === BlacklistScope.STORE ? { storeId: blForm.storeId } : {}),
      reason: blForm.reason.trim(),
    });
    ElMessage.success(t("customer.detail.blacklist.addForm.success"));
    blDialogVisible.value = false;
    blParams.pageNum = 1;
    await Promise.all([loadBlacklist(), loadBlacklistSummary()]);
  } catch {
    // 失败文案（A0525 同范围已在生效 / A0524 门店无效）由请求层统一渲染
  } finally {
    blSubmitting.value = false;
  }
}

/**
 * 解除黑名单
 *
 * PRD《客户管理》BR-2「移出黑名单必须填写原因并记录审计日志」/ 验收要点 3「移出需权限
 * 与原因」⇒ 用强确认对话框强制填写原因，原因随请求落 `blacklist.release_reason`；
 * 文案写明影响范围（PRD《交互规范》§确认与撤销 2）。
 */
async function handleRelease(row: BlacklistItem): Promise<void> {
  const customerName = detail.value?.name ?? "";
  try {
    const { value } = await ElMessageBox.prompt(
      t("customer.detail.blacklist.releaseForm.confirmText", { name: customerName }),
      t("customer.detail.blacklist.releaseForm.title"),
      {
        confirmButtonText: t("customer.detail.blacklist.releaseForm.submit"),
        cancelButtonText: t("customer.detail.blacklist.releaseForm.cancel"),
        inputPlaceholder: t("customer.detail.blacklist.releaseForm.reasonPlaceholder"),
        inputValidator: (input: string) => {
          const text = String(input ?? "").trim();
          if (!text) return t("customer.detail.blacklist.releaseForm.reasonRequired");
          if (text.length > 255) return t("customer.detail.blacklist.releaseForm.reasonLength");
          return true;
        },
        inputErrorMessage: t("customer.detail.blacklist.releaseForm.reasonRequired"),
        type: "warning",
      }
    );

    await CustomerAPI.releaseBlacklist(props.customerId, row.id, {
      reason: String(value ?? "").trim(),
    });
    ElMessage.success(t("customer.detail.blacklist.releaseForm.success"));
    await Promise.all([loadBlacklist(), loadBlacklistSummary()]);
  } catch {
    // 用户取消（cancel）或请求失败：取消不提示，失败文案由请求层渲染
  }
}

// ── 生命周期：打开 → 初始化；页签切换 → 懒加载 ──────────────────────────
/**
 * 每个页签独立懒加载：既避免打开抽屉瞬间并发 5 个请求（后端存在 IP 级限流
 * 1s/10 次，踩坑 113），也让「未访问的页签不出请求」成为可验证行为。
 */
function ensureTabData(tab: typeof activeTab.value): void {
  if (tab === "pets" && !petsLoaded.value) return void loadPets();
  if (tab === "reach" && !reachLoaded.value) return void loadReach();
  if (tab === "preference" && !prefLoaded.value) return void loadPreference();
  if (tab === "blacklist" && !blLoaded.value) return void loadBlacklist();
}

watch(activeTab, (tab) => ensureTabData(tab));

function resetAll(): void {
  detail.value = null;
  detailError.value = "";
  activeTab.value = "profile";

  pets.value = [];
  petsLoaded.value = false;
  petsError.value = "";

  reachList.value = [];
  reachTotal.value = 0;
  reachLoaded.value = false;
  reachError.value = "";
  reachRange.value = null;
  Object.assign(reachParams, {
    pageNum: 1,
    pageSize: REACH_PAGE_SIZE,
    sortBy: "reachedAt",
    order: "DESC",
    channel: undefined,
    result: undefined,
    reachedAtStart: undefined,
    reachedAtEnd: undefined,
  });

  prefLoaded.value = false;
  prefError.value = "";
  prefAllowed.value = [];
  prefBlocked.value = [];
  prefDndEnabled.value = false;
  prefDndStart.value = "22:00";
  prefDndEnd.value = "08:00";

  blList.value = [];
  blTotal.value = 0;
  blLoaded.value = false;
  blError.value = "";
  hasActiveBlacklist.value = false;
  Object.assign(blParams, {
    pageNum: 1,
    pageSize: BL_PAGE_SIZE,
    sortBy: "createdAt",
    order: "DESC",
    scope: undefined,
    storeId: undefined,
    status: undefined,
  });
}

watch(
  () => props.modelValue,
  (opened) => {
    if (!opened || !props.customerId) return;
    resetAll();
    void loadDetail();
    void fetchStoreOptions();
    void fetchSourceOptions();
    void loadBlacklistSummary();
  },
  { immediate: true }
);

/** 抽屉关闭动画结束后的清理（`destroy-on-close` 之外再兜一层，防止 keep-alive 下残留） */
function handleClosed(): void {
  resetAll();
}
</script>

<style lang="scss" scoped>
.customer-detail {
  &__body {
    display: flex;
    flex-direction: column;
    min-height: 200px;
  }

  /* 宠主卡 */
  &__card {
    padding: 12px 16px;
    margin-bottom: 8px;
    background: var(--el-fill-color-lighter);
    border-radius: 8px;
  }

  &__card-row {
    display: flex;
    gap: 8px;
    align-items: center;

    &--sub {
      margin-top: 4px;
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }
  }

  &__name {
    font-size: 16px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__mobile {
    font-variant-numeric: tabular-nums;
  }

  &__divider {
    color: var(--el-text-color-placeholder);
  }

  /* 页签 */
  &__tabs {
    :deep(.el-tabs__header) {
      margin-bottom: 12px;
    }
  }

  &__panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__panel-head {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }

  &__panel-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__panel-foot {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  /* 筛选行（页签内，480px 窄宽下允许换行）*/
  &__filter {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  &__filter-item {
    width: 120px;
  }

  &__filter-range {
    width: 230px !important;
  }

  &__table {
    width: 100%;
  }

  /* 黑名单「原因 + 解除原因 + 时间」堆叠块 */
  &__record {
    display: flex;
    flex-direction: column;
    line-height: 1.5;
  }

  &__record-main {
    color: var(--el-text-color-primary);
  }

  &__record-sub {
    font-size: 12px;
    color: var(--el-color-danger);
  }

  &__record-time {
    font-size: 12px;
    color: var(--el-text-color-placeholder);
  }

  &__pet-name {
    font-weight: 500;
  }

  &__muted {
    font-size: 12px;
    color: var(--el-text-color-placeholder);
  }

  &__hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);

    &--inline {
      margin-top: 2px;
    }
  }

  &__alert {
    margin-bottom: 4px;
  }

  &__dnd {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
  }

  &__time {
    width: 110px;
  }

  &__form {
    :deep(.el-form-item) {
      margin-bottom: 14px;
    }
  }

  &__desc {
    :deep(.el-descriptions__label) {
      width: 96px;
      font-weight: 400;
      color: var(--el-text-color-secondary);
    }
  }
}
</style>
